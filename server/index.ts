import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { db, getMeta, setMeta, getSetting, setSetting, logActivity, nowIso } from './lib/db'
import * as sync from './services/sync'
import * as market from './services/market'
import * as packs from './services/packs'
import * as binders from './services/binders'
import * as pricesources from './services/pricesources'
import * as grading from './services/grading'
import * as trading from './services/trading'
import * as conventions from './services/conventions'
import * as vendor from './services/vendor'
import * as shop from './services/shop'
import * as finance from './services/finance'
import * as staff from './services/staff'
import * as bulk from './services/bulk'
import * as grabbags from './services/grabbags'
import * as pnl from './services/pnl'
import * as shopstats from './services/shopstats'
import * as polish from './services/polish'
import * as tax from './services/tax'
import * as salesTax from './services/salestax'
import * as auctions from './services/auctions'
import * as estate from './services/estate'
import { conventionSummary, backfillAcquiredRefs } from './services/convention-summary'
import { netWorthSeries, backfillNetWorthHistory, recordSnapshot } from './services/networth'
import { collectorStats } from './services/collector-stats'
import * as packbattles from './services/packbattles'
import * as tournaments from './services/tournaments'
import * as streaming from './services/streaming'
import * as sponsors from './services/sponsors'
import * as resale from './services/resale'
import * as schedule from './services/schedule'
import * as sealed from './services/sealed'
import { resolvePrice, gradedPrices, round2 } from './services/market'

const app = new Hono()
const PORT = Number(process.env.TCGLIFE_PORT || 8787) // ignore ambient PORT (dev proxies expect 8787)

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function ensureGameState() {
  const row = db.prepare('SELECT id FROM game_state WHERE id = 1').get()
  if (!row) {
    db.prepare('INSERT INTO game_state (id, cash, created_at, last_tick_at) VALUES (1, 1000, ?, ?)').run(nowIso(), nowIso())
    logActivity('system', 'Welcome to TCG Life. $1,000 starting cash. The market is waiting.')
  }
}

function ensurePackCatalog() {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO pack_products (id, set_id, name, kind, msrp, market_price, packs, cards_per_pack, release_date, description)
     SELECT @id, @setId, @name, @kind, @msrp, @market, @packs, @cpp, s.release_date, NULL FROM sets s WHERE s.id = @setId`,
  )
  const tx = db.transaction(() => {
    for (const p of packs.PRODUCTS) {
      insert.run({
        id: `${p.setId}-${p.kind}`,
        setId: p.setId,
        name: p.name,
        kind: p.kind,
        msrp: p.msrp,
        market: p.kind === 'booster' ? p.msrp : null, // sealed premiums estimated at purchase time
        packs: p.packs,
        cpp: p.cardsPerPack,
      })
    }
  })
  tx()
  console.log('[server] pack catalog seeded:', packs.PRODUCTS.length, 'products')
}

function rebuildPullTables() {
  // Products must exist before pull tables (FK constraint) — every synced set
  // gets era-appropriate products, then a booster pull table. Rebuild ALL
  // booster tables, not just missing ones — classifier fixes must be able to
  // repair tables built by older code.
  sealed.ensureFullCatalog()
  const setIds = db.prepare(`
    SELECT DISTINCT c.set_id AS id FROM cards c
    JOIN pack_products pp ON pp.id = c.set_id || '-booster'
  `).all() as { id: string }[]
  for (const { id } of setIds) {
    try { packs.buildPullTable(id) } catch (e) { console.error('[packs] pull table failed for', id, e) }
  }
  setMeta('pullTablesBuiltAt', nowIso())
}

function maybeRebuildPullTables() {
  const builtAt = getMeta('pullTablesBuiltAt')
  const cardsSynced = getMeta('cardsLastSyncedAt')
  if (!builtAt || (cardsSynced && cardsSynced > builtAt)) rebuildPullTables()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonRows<T>(rows: T[]) { return rows }

function cardWithPrices(row: Record<string, unknown>): Record<string, unknown> {
  const cardId = row.id as string
  const price = resolvePrice(cardId)
  return { ...row, price }
}

// ---------------------------------------------------------------------------
// Game state / sync
// ---------------------------------------------------------------------------

app.get('/api/state', (c) => {
  ensureGameState()
  maybeRebuildPullTables()
  market.tick()
  resale.resaleTick()
  schedule.calendarTick()
  maybeRecordNetWorthSnapshot()
  const state = market.getGameState()
  // collection is priced per-card in JS (price lookup is per-card)
  const invRows = db.prepare(`SELECT card_id, variant, condition, quantity, graded_grade FROM inventory WHERE status IN ('collection','grading')`).all() as { card_id: string; variant: string; condition: string; quantity: number; graded_grade: string | null }[]
  let collectionTotal = 0
  for (const r of invRows) collectionTotal += r.quantity * (r.graded_grade ? market.gradedPriceOf(r.card_id, r.graded_grade).usd : market.valueOf(r.card_id, r.variant, (r.condition as market.Condition) || 'NM'))

  const sealedRows = db.prepare('SELECT product_id, quantity, cost FROM sealed_inventory').all() as { product_id: string; quantity: number; cost: number }[]
  let sealedValue = 0
  for (const r of sealedRows) sealedValue += r.quantity * (sealed.priceOf(r.product_id).market || r.cost) // market value — sealed appreciates

  const listedRows = db.prepare(`SELECT card_id, variant, condition, quantity, listing_price FROM inventory WHERE status = 'listed'`).all() as { card_id: string; variant: string; condition: string; quantity: number; listing_price: number | null }[]
  const listedValue = listedRows.reduce((a, r) => a + r.quantity * (r.listing_price ?? market.valueOf(r.card_id, r.variant, (r.condition as market.Condition) || 'NM')), 0)

  // Debt is a negative asset — net worth nets out every outstanding loan.
  const debt = (db.prepare(`SELECT COALESCE(SUM(balance),0) AS n FROM loans WHERE status = 'active'`).get() as { n: number }).n

  const syncP = sync.getSyncProgress()
  const cardCount = (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n
  const setCount = (db.prepare('SELECT COUNT(*) AS n FROM sets').get() as { n: number }).n
  const binderStats = binders.getStats()

  return c.json({
    cash: round2(state.cash),
    collectionValue: round2(collectionTotal),
    inventoryValue: round2(listedValue + sealedValue),
    netWorth: round2(state.cash + collectionTotal + listedValue + sealedValue - debt),
    sync: { ...syncP, cardCount, setCount, lastSnapshotAt: getMeta('lastSnapshotAt') },
    binders: binderStats,
    apiConfigured: Boolean(process.env.POKEMONTCG_API_KEY || getSetting('pokemontcgApiKey')),
  })
})

app.get('/api/sync/progress', (c) => c.json(sync.getSyncProgress()))

app.post('/api/sync/restart', (c) => {
  setMeta('sync:set', '') // reset checkpoint
  sync.startSyncLoop()
  return c.json({ ok: true })
})

app.get('/api/activity', (c) => {
  const rows = db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT 50').all()
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// Sets & cards
// ---------------------------------------------------------------------------

app.get('/api/sets', (c) => {
  const rows = db.prepare(`
    SELECT s.*, COUNT(c.id) AS cards_synced
    FROM sets s LEFT JOIN cards c ON c.set_id = s.id
    GROUP BY s.id ORDER BY s.release_date DESC
  `).all()
  return c.json(jsonRows(rows))
})

app.get('/api/sets/:id', (c) => {
  const setId = c.req.param('id')
  const set = db.prepare('SELECT * FROM sets WHERE id = ?').get(setId)
  if (!set) return c.json({ error: 'Set not found' }, 404)
  const cards = (db.prepare('SELECT * FROM cards WHERE set_id = ? ORDER BY position ASC').all(setId) as Record<string, unknown>[]).map(cardWithPrices)
  const owned = db.prepare(`SELECT card_id, SUM(quantity) AS qty, condition, variant, status FROM inventory WHERE status IN ('collection','grading') GROUP BY card_id`).all() as { card_id: string; qty: number }[]
  const ownedMap = new Map(owned.map((o) => [o.card_id, o.qty]))
  const withOwned = cards.map((card) => ({
    ...card,
    ownedQty: ownedMap.get(card.id as string) ?? 0,
  })) as unknown as { id: string; price: { usd: number | null }; ownedQty: number; [k: string]: unknown }[]
  const ownedCount = withOwned.filter((x) => x.ownedQty > 0).length
  const total = cards.length
  const missingValue = withOwned.filter((x) => x.ownedQty === 0).reduce((a, x) => a + (x.price.usd ?? 0), 0)
  const totalValue = withOwned.reduce((a, x) => a + (x.price.usd ?? 0) * (x.ownedQty || 0), 0)
  return c.json({
    set,
    cards: withOwned,
    completion: { owned: ownedCount, total, pct: total > 0 ? Math.round((ownedCount / total) * 100) : 0, missingValue: round2(missingValue), collectionValue: round2(totalValue) },
  })
})

app.get('/api/cards/search', (c) => {
  const q = (c.req.query('q') || '').trim()
  const setId = c.req.query('setId')
  const rarity = c.req.query('rarity')
  const type = c.req.query('type')
  const ownedOnly = c.req.query('owned') === '1'
  const sort = c.req.query('sort') || 'price_desc'
  const limit = Math.min(Number(c.req.query('limit') || 60), 250)
  const offset = Number(c.req.query('offset') || 0)

  const where: string[] = []
  const params: unknown[] = []
  if (q) { where.push(`(c.name LIKE ? OR c.number = ? OR s.name LIKE ?)`); params.push(`%${q}%`, q, `%${q}%`) }
  if (setId) { where.push('c.set_id = ?'); params.push(setId) }
  if (rarity) { where.push('c.rarity = ?'); params.push(rarity) }
  if (type) { where.push(`c.types LIKE ?`); params.push(`%"${type}"%`) }
  if (ownedOnly) { where.push(`EXISTS (SELECT 1 FROM inventory i WHERE i.card_id = c.id AND i.status IN ('collection','grading'))`) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const orderSql: Record<string, string> = {
    price_desc: 'market_price DESC', price_asc: 'market_price ASC', name_asc: 'c.name COLLATE NOCASE ASC',
    set_desc: 's.release_date DESC', number_asc: 's.release_date DESC, c.position ASC',
  }
  const sql = `
    SELECT c.*, s.name AS set_name, s.series AS set_series,
           (SELECT market FROM price_records pr WHERE pr.card_id = c.id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) AS market_price,
           (SELECT retrieved_at FROM price_records pr WHERE pr.card_id = c.id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) AS market_at
    FROM cards c JOIN sets s ON s.id = c.set_id
    ${whereSql}
    ORDER BY ${orderSql[sort] ?? orderSql.price_desc} NULLS LAST
    LIMIT ? OFFSET ?`
  const rows = db.prepare(sql).all(...params, limit, offset) as Record<string, unknown>[]
  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM cards c JOIN sets s ON s.id = c.set_id ${whereSql}`).get(...params) as { n: number }
  // Attach owned quantities for the cards on this page
  const ownedMap = new Map<string, number>()
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id as string)
    const owned = db.prepare(
      `SELECT card_id, SUM(quantity) AS qty FROM inventory WHERE status IN ('collection','grading') AND card_id IN (${ids.map(() => '?').join(',')}) GROUP BY card_id`,
    ).all(...ids) as { card_id: string; qty: number }[]
    for (const o of owned) ownedMap.set(o.card_id, o.qty)
  }
  const priced = rows.map(cardWithPrices).map((r) => ({ ...r, ownedQty: ownedMap.get(r.id as string) ?? 0 }))
  return c.json({ total: totalRow.n, cards: priced })
})

app.get('/api/cards/facets', (c) => {
  const rarities = db.prepare(`SELECT rarity, COUNT(*) AS n FROM cards WHERE rarity IS NOT NULL GROUP BY rarity ORDER BY n DESC`).all()
  const types = db.prepare(`SELECT types FROM cards WHERE types IS NOT NULL`).all() as { types: string }[]
  const typeSet = new Set<string>()
  for (const t of types) for (const x of JSON.parse(t.types) as string[]) typeSet.add(x)
  return c.json({ rarities, types: [...typeSet].sort() })
})

app.get('/api/cards/:id', (c) => {
  const id = c.req.param('id')
  const card = db.prepare(`
    SELECT c.*, s.name AS set_name, s.series AS set_series, s.release_date AS set_release_date,
           s.symbol_url AS set_symbol_url, s.printed_total AS set_printed_total, s.total AS set_total
    FROM cards c JOIN sets s ON s.id = c.set_id WHERE c.id = ?
  `).get(id) as Record<string, unknown> | undefined
  if (!card) return c.json({ error: 'Card not found' }, 404)

  const priceRows = db.prepare(`
    SELECT kind, variant, low, mid, high, market, direct_low, avg1, avg7, avg30, retrieved_at
    FROM price_records WHERE card_id = ? ORDER BY retrieved_at DESC LIMIT 40
  `).all(id)

  // Latest tcgplayer per variant + history for the primary variant
  const latest: Record<string, unknown>[] = []
  const seen = new Set<string>()
  for (const r of priceRows as Record<string, unknown>[]) {
    const v = r.variant as string
    if (r.kind === 'tcgplayer' && !seen.has(v)) { seen.add(v); latest.push(r) }
  }
  const primary = resolvePrice(id)
  const historyVariant = primary.variant
  const history = market.priceHistory(id, historyVariant).slice(-90)
  const graded = gradedPrices(id)

  const owned = db.prepare(`SELECT id, condition, variant, quantity, status, listing_price, graded_grade, cost_basis, acquired_at, favorite FROM inventory WHERE card_id = ? AND status != 'sold' ORDER BY acquired_at DESC`).all(id)
  const wishlisted = Boolean(db.prepare('SELECT 1 FROM wishlist WHERE card_id = ?').get(id))

  return c.json({
    card: { ...card, price: primary },
    priceRows: latest,
    history: history.map((h) => ({ value: h.market, at: h.retrieved_at })),
    gradedPrices: graded,
    owned,
    wishlisted,
  })
})

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------

app.get('/api/market/listings', (c) => {
  market.ensureMarketFeed()
  const cardId = c.req.query('cardId')
  const q = (c.req.query('q') || '').trim().toLowerCase()
  let rows
  if (cardId) {
    rows = db.prepare(`
      SELECT l.*, c.name, c.image_small, c.rarity, s.name AS set_name
      FROM listings l JOIN cards c ON c.id = l.card_id JOIN sets s ON s.id = c.set_id
      WHERE l.card_id = ? ORDER BY (l.price + l.shipping) ASC LIMIT 60
    `).all(cardId)
  } else if (q) {
    rows = db.prepare(`
      SELECT l.*, c.name, c.image_small, c.rarity, s.name AS set_name
      FROM listings l JOIN cards c ON c.id = l.card_id JOIN sets s ON s.id = c.set_id
      WHERE LOWER(c.name) LIKE ? ORDER BY l.listed_at DESC LIMIT 80
    `).all(`%${q}%`)
  } else {
    rows = db.prepare(`
      SELECT l.*, c.name, c.image_small, c.rarity, s.name AS set_name
      FROM listings l JOIN cards c ON c.id = l.card_id JOIN sets s ON s.id = c.set_id
      ORDER BY l.listed_at DESC LIMIT 80
    `).all()
  }
  // Attach market anchors
  const out = (rows as Record<string, unknown>[]).map((r) => {
    const row = r as { card_id: string; variant: string; condition: string; graded_grade: string | null }
    const price = row.graded_grade
      ? { usd: market.gradedPriceOf(row.card_id, row.graded_grade).usd, source: 'live' as const, retrievedAt: null, kind: 'pc-graded', variant: row.graded_grade, low: null, high: null }
      : resolvePrice(row.card_id, (r.variant as string) || 'normal', 'NM')
    const total = (r.price as number) + (r.shipping as number)
    const anchor = price.usd ?? 0
    return { ...r, market: price, total, delta: anchor > 0 ? total / anchor - 1 : 0 }
  })
  return c.json(out)
})

app.post('/api/market/buy/:listingId', (c) => {
  const id = c.req.param('listingId')
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id) as { id: string; card_id: string; variant: string; condition: string; price: number; shipping: number } | undefined
  if (!listing) return c.json({ error: 'Listing gone — another buyer got it.' }, 404)
  const total = round2(listing.price + listing.shipping)
  const state = market.getGameState()
  if (state.cash < total) return c.json({ error: 'Not enough cash' }, 400)
  db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(total)
  db.prepare('DELETE FROM listings WHERE id = ?').run(id)
  db.prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
              VALUES (?, ?, ?, 1, 'collection', 'market', ?, ?)`).run(listing.card_id, listing.variant, listing.condition, total, nowIso())
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(listing.card_id) as { name: string }).name
  logActivity('buy', `Bought ${name} (${listing.condition}) for $${total.toFixed(2)} incl. shipping`, -total)
  return c.json({ ok: true, total, message: `${name} purchased for $${total.toFixed(2)}` })
})

app.post('/api/market/buy-direct', async (c) => {
  const body = await c.req.json<{ cardId: string; condition?: string }>()
  const price = resolvePrice(body.cardId, 'normal', 'NM')
  if (price.usd == null) return c.json({ error: 'No market price yet — sync this set first' }, 400)
  const total = round2(price.usd)
  const state = market.getGameState()
  if (state.cash < total) return c.json({ error: `Not enough cash (need $${total.toFixed(2)})` }, 400)
  db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(total)
  db.prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
              VALUES (?, 'normal', 'NM', 1, 'collection', 'market', ?, ?)`).run(body.cardId, total, nowIso())
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(body.cardId) as { name: string }).name
  logActivity('buy', `Bought ${name} (NM) at market for $${total.toFixed(2)}`, -total)
  return c.json({ ok: true, total, message: `${name} purchased at market for $${total.toFixed(2)}` })
})

// ---------------------------------------------------------------------------
// Inventory & selling
// ---------------------------------------------------------------------------

app.get('/api/inventory', (c) => {
  grading.resolveGrading()
  const rows = db.prepare(`
    SELECT i.*, c.name, c.image_small, c.image_large, c.rarity, c.number, s.name AS set_name
    FROM inventory i JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
    WHERE i.status != 'sold'
    ORDER BY i.acquired_at DESC
  `).all() as Record<string, unknown>[]
  const out = rows.map((r) => {
    const inv = r as { card_id: string; variant: string; condition: string; graded_grade: string | null }
    const value = market.valueOfRow(inv)
    const gradingHint = inv.graded_grade || (r.quantity as number) > 1 ? null : grading.gradingAdviceFor(inv.card_id, inv.condition)
    return { ...r, value, gradingHint, source: resolvePrice(inv.card_id, inv.variant || 'normal', (inv.condition as market.Condition) || 'NM') }
  })
  return c.json(out)
})

app.post('/api/inventory/list', async (c) => {
  const body = await c.req.json<{ id: number; price: number }>()
  const row = db.prepare(`SELECT * FROM inventory WHERE id = ? AND status = 'collection'`).get(body.id) as { id: number; card_id: string; quantity: number } | undefined
  if (!row) return c.json({ error: 'Item not available to list' }, 400)
  if (!body.price || body.price <= 0) return c.json({ error: 'Invalid price' }, 400)
  db.prepare(`UPDATE inventory SET status = 'listed', listing_price = ?, listed_at = ? WHERE id = ?`).run(round2(body.price), nowIso(), body.id)
  binders.cleanupSlotsForInventory([body.id]) // listing a slotted card frees its pocket
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(row.card_id) as { name: string }).name
  logActivity('listing', `Listed ${name} for $${body.price.toFixed(2)}`)
  return c.json({ ok: true })
})

app.post('/api/inventory/cancel', (c) => {
  const id = Number(c.req.query('id'))
  db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL WHERE id = ? AND status = 'listed'
    AND id NOT IN (SELECT inventory_id FROM auctions WHERE status = 'live' AND inventory_id IS NOT NULL)`).run(id)
  return c.json({ ok: true })
})

app.post('/api/inventory/favorite', async (c) => {
  const body = await c.req.json<{ id: number }>()
  db.prepare('UPDATE inventory SET favorite = 1 - favorite WHERE id = ?').run(body.id)
  return c.json({ ok: true })
})

app.get('/api/sales', (c) => {
  return c.json(db.prepare(`
    SELECT sh.*, c.name, c.image_small FROM sale_history sh JOIN cards c ON c.id = sh.card_id
    ORDER BY sh.id DESC LIMIT 100
  `).all())
})

// ---------------------------------------------------------------------------
// Pack shop
// ---------------------------------------------------------------------------

app.get('/api/shop/products', (c) => {
  ensurePackCatalog() // sets may have finished syncing after boot
  sealed.ensureFullCatalog() // every set gets era-appropriate products
  const rows = db.prepare(`
    SELECT p.*, s.name AS set_name, s.symbol_url AS set_symbol
    FROM pack_products p JOIN sets s ON s.id = p.set_id
    ORDER BY s.release_date DESC,
      CASE p.kind WHEN 'booster' THEN 1 WHEN 'bundle' THEN 2 WHEN 'etb' THEN 3 WHEN 'display' THEN 4 ELSE 5 END
  `).all() as Record<string, unknown>[]
  const out = rows.map((r) => {
    const detail = sealed.priceDetail(r.id as string)
    const est = packs.estimatePackValue(r.set_id as string)
    return { ...r, market_price: detail.market, price_source: detail.source, oop: detail.oop, oop_months: detail.oopMonths, oop_status: detail.status, est }
  })
  return c.json(out)
})

app.post('/api/shop/buy/:productId', async (c) => {
  const body = await c.req.json<{ qty?: number; openNow?: boolean }>()
  const qty = Math.max(1, Math.min(body.qty ?? 1, 36))
  try {
    const result = packs.buySealed(c.req.param('productId'), qty)
    if (body.openNow) {
      const opened = openAll(c.req.param('productId'), qty)
      return c.json({ ok: true, ...result, opened })
    }
    return c.json({ ok: true, ...result })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Purchase failed' }, 400)
  }
})

function openAll(productId: string, qty: number) {
  const sessions: { sessionId: string; cards: { cardId: string; isHit: boolean; value: number }[]; totalValue: number; spent: number }[] = []
  for (let i = 0; i < qty; i++) {
    try { sessions.push(packs.openSealed(productId)) } catch { break }
  }
  return sessions
}

app.post('/api/packs/open', async (c) => {
  const body = await c.req.json<{ productId: string }>()
  try {
    const result = packs.openSealed(body.productId)
    return c.json(result)
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Open failed' }, 400)
  }
})

app.get('/api/pulls', (c) => {
  return c.json(db.prepare(`
    SELECT ph.*, c.name, c.image_small, c.rarity, s.name AS set_name
    FROM pull_history ph JOIN cards c ON c.id = ph.card_id JOIN sets s ON s.id = c.set_id
    ORDER BY ph.id DESC LIMIT 400
  `).all())
})

app.get('/api/pulls/summary', (c) => {
  const rows = db.prepare(`
    SELECT session_id, SUM(value) AS total_value, COUNT(*) AS card_count, MAX(opened_at) AS opened_at,
           SUM(is_hit) AS hits
    FROM pull_history GROUP BY session_id ORDER BY opened_at DESC LIMIT 30
  `).all() as { session_id: string; total_value: number; card_count: number; opened_at: string; hits: number }[]
  const spent = db.prepare(`SELECT product_id, quantity, cost, acquired_at FROM sealed_inventory`).all() as { product_id: string; quantity: number; cost: number; acquired_at: string }[]
  // Enrich with live market value + OOP info — sealed stock is an appreciating position.
  const sealedEnriched = spent.map((s) => {
    const d = sealed.priceDetail(s.product_id)
    const product = db.prepare(`SELECT name FROM pack_products WHERE id = ?`).get(s.product_id) as { name: string } | undefined
    const marketValue = round2(s.quantity * (d.market || s.cost))
    const basis = round2(s.quantity * s.cost)
    return { ...s, name: product?.name ?? s.product_id, market_price: d.market, source: d.source, oop: d.oop, oop_months: d.oopMonths, status: d.status, market_value: marketValue, basis, unrealized: round2(marketValue - basis) }
  })
  return c.json({ sessions: rows, sealedInStock: sealedEnriched })
})

// ---------------------------------------------------------------------------
// Binders (Phase 2)
// ---------------------------------------------------------------------------

app.get('/api/binders/available', (c) => {
  return c.json(binders.availableCards(c.req.query('q') || ''))
})

app.get('/api/binders', (c) => c.json(binders.listBinders()))

app.post('/api/binders', async (c) => {
  const body = await c.req.json<{ name: string; accent?: string }>()
  return c.json(binders.createBinder(body.name ?? 'New Binder', body.accent ?? 'yellow'))
})

app.get('/api/binders/:id', (c) => {
  const detail = binders.getBinderDetail(Number(c.req.param('id')))
  if (!detail) return c.json({ error: 'Binder not found' }, 404)
  return c.json(detail)
})

app.patch('/api/binders/:id', async (c) => {
  const body = await c.req.json<{ name?: string; accent?: string }>()
  binders.updateBinder(Number(c.req.param('id')), body)
  return c.json({ ok: true })
})

app.delete('/api/binders/:id', (c) => {
  binders.deleteBinder(Number(c.req.param('id')))
  return c.json({ ok: true })
})

app.post('/api/binders/:id/place', async (c) => {
  const body = await c.req.json<{ inventoryId: number; page?: number; slot?: number }>()
  try {
    const pos = binders.placeCard(Number(c.req.param('id')), body.inventoryId, body.page, body.slot)
    return c.json({ ok: true, ...pos })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Placement failed' }, 400)
  }
})

app.post('/api/binders/:id/move', async (c) => {
  const body = await c.req.json<{ from: { page: number; slot: number }; to: { page: number; slot: number } }>()
  try {
    const res = binders.moveCard(Number(c.req.param('id')), body.from, body.to)
    return c.json({ ok: true, ...res })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Move failed' }, 400)
  }
})

app.post('/api/binders/:id/remove', async (c) => {
  const body = await c.req.json<{ inventoryId: number }>()
  binders.removeCard(Number(c.req.param('id')), body.inventoryId)
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// NPC Trading (Phase 2)
// ---------------------------------------------------------------------------

app.get('/api/traders', (c) => c.json(trading.listTraders()))

app.get('/api/trades/pending', (c) => c.json(trading.pendingOffers()))

app.get('/api/trades/history', (c) => c.json(trading.tradeHistory()))

app.post('/api/trade/propose', async (c) => {
  const body = await c.req.json<{ traderId: number; inventoryId: number; cash: number }>()
  const res = trading.proposeTrade(body.traderId, body.inventoryId, Math.max(0, round2(body.cash || 0)))
  return c.json(res, res.ok ? 200 : 400)
})

app.post('/api/trade/accept-incoming/:id', (c) => {
  const res = trading.acceptIncoming(Number(c.req.param('id')))
  return c.json(res, res.ok ? 200 : 400)
})

app.post('/api/trade/reject-incoming/:id', (c) => {
  const res = trading.rejectIncoming(Number(c.req.param('id')))
  return c.json(res, res.ok ? 200 : 400)
})

app.post('/api/trade/accept-counter/:id', (c) => {
  const res = trading.acceptCounter(Number(c.req.param('id')))
  return c.json(res, res.ok ? 200 : 400)
})

app.post('/api/trade/decline-counter/:id', (c) => {
  const res = trading.declineCounter(Number(c.req.param('id')))
  return c.json(res, res.ok ? 200 : 400)
})

// ---------------------------------------------------------------------------
// Conventions (Phase 3) — pop-up card shows with vendor booths
// ---------------------------------------------------------------------------

app.get('/api/convention', (c) => c.json(conventions.showStatus()))

app.post('/api/convention/enter', (c) => {
  const r = conventions.buyEntry()
  return c.json(r, r.ok ? 200 : 400)
})

app.get('/api/convention/booth/:id', (c) => {
  const r = conventions.boothStock(Number(c.req.param('id')))
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/convention/buy/:itemId', (c) => {
  const r = conventions.buyConventionItem(Number(c.req.param('itemId')))
  return c.json(r, r.ok ? 200 : 400)
})

// ---------------------------------------------------------------------------
// Vendor tables (Phase 4) — rent a spot and sell your own cards
// ---------------------------------------------------------------------------

app.get('/api/convention/table', (c) => c.json(vendor.status()))

app.post('/api/convention/table/rent', async (c) => {
  const body = await c.req.json<{ location: string }>()
  const r = vendor.rent(body.location)
  return c.json(r, r.ok ? 200 : 400)
})

app.get('/api/convention/table/stockable', (c) => c.json(vendor.stockableInventory()))

app.post('/api/convention/table/stock', async (c) => {
  const body = await c.req.json<{ inventoryId: number; ask: number }>()
  const r = vendor.stock(body.inventoryId, body.ask)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/convention/table/unstock', async (c) => {
  const body = await c.req.json<{ inventoryId: number }>()
  const r = vendor.unstock(body.inventoryId)
  return c.json(r, r.ok ? 200 : 400)
})

// ---------------------------------------------------------------------------
// The Card Shop (Phase 4) — permanent storefront with cases and walk-ins
// ---------------------------------------------------------------------------

app.get('/api/shop', (c) => c.json(shop.status()))

app.post('/api/shop/lease', async (c) => {
  const body = await c.req.json<{ name: string; tier: string }>()
  const r = shop.lease(body.name, body.tier as import('./services/shop').ShopTier)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/shop/close', (c) => c.json(shop.closeShop()))

app.post('/api/shop/cases/buy', async (c) => {
  const body = await c.req.json<{ caseId: number }>()
  const r = shop.buyCase(body.caseId)
  return c.json(r, r.ok ? 200 : 400)
})

app.get('/api/shop/stockable', (c) => c.json(shop.stockableInventory()))

app.post('/api/shop/stock', async (c) => {
  const body = await c.req.json<{ caseId: number; inventoryId: number; ask: number }>()
  const r = shop.stock(body.caseId, body.inventoryId, body.ask)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/shop/unstock', async (c) => {
  const body = await c.req.json<{ inventoryId: number }>()
  const r = shop.unstock(body.inventoryId)
  return c.json(r, r.ok ? 200 : 400)
})

// ---------------------------------------------------------------------------
// Advanced finance (Phase 4) — credit line, loans, overdrafts
// ---------------------------------------------------------------------------

app.get('/api/finance', (c) => c.json(finance.status()))

app.post('/api/finance/borrow', async (c) => {
  const body = await c.req.json<{ amount: number }>()
  const r = finance.borrow(body.amount)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/finance/repay', async (c) => {
  const body = await c.req.json<{ loanId: number; amount?: number }>()
  const r = finance.repay(body.loanId, body.amount)
  return c.json(r, r.ok ? 200 : 400)
})

// ---------------------------------------------------------------------------
// Shop staff (Phase 4) — hire specialists, pay them, let them work
// ---------------------------------------------------------------------------

app.get('/api/shop/staff', (c) => c.json(staff.status()))

app.post('/api/shop/staff/hire', async (c) => {
  const body = await c.req.json<{ name: string; role: string; quality: number; wage: number }>()
  const r = staff.hire(body.name, body.role as import('./services/staff').StaffRole, body.quality, body.wage)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/shop/staff/fire', async (c) => {
  const body = await c.req.json<{ id: number }>()
  const r = staff.fire(body.id)
  return c.json(r, r.ok ? 200 : 400)
})

// ---------------------------------------------------------------------------
// Bulk boxes (Phase 4) — the dollar bin
// ---------------------------------------------------------------------------

app.get('/api/shop/bulk/stockable', (c) => {
  const price = Number(c.req.query('price') ?? '1')
  c.header('X-Box-Price', String(price))
  return c.json(bulk.boxStockable(price))
})

app.post('/api/shop/bulk/buy', async (c) => {
  const body = await c.req.json<{ label: string; pricePerCard: number; capacity: number }>()
  const r = bulk.buyBox(body.label, body.pricePerCard, body.capacity)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/shop/bulk/fill', async (c) => {
  const body = await c.req.json<{ boxId: number; inventoryIds: number[] }>()
  const r = bulk.fill(body.boxId, body.inventoryIds)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/shop/bulk/remove', async (c) => {
  const body = await c.req.json<{ inventoryId: number }>()
  const r = bulk.removeFromBox(body.inventoryId)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/shop/bulk/empty', async (c) => {
  const body = await c.req.json<{ boxId: number }>()
  const r = bulk.emptyBox(body.boxId)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/shop/bulk/sell', async (c) => {
  const body = await c.req.json<{ boxId: number }>()
  const r = bulk.sellBox(body.boxId)
  return c.json(r, r.ok ? 200 : 400)
})

// ---------------------------------------------------------------------------
// Mystery grab bags (Phase 4) — sealed 10-card packs with a guaranteed hit
// ---------------------------------------------------------------------------

app.get('/api/shop/bags', (c) => c.json(grabbags.status()))

app.get('/api/shop/bags/stockable', (c) => {
  const price = Number(c.req.query('price') ?? '5')
  return c.json(grabbags.stockable(price))
})

app.post('/api/shop/bags/assemble', async (c) => {
  const body = await c.req.json<{ price: number; junkIds: number[]; hitId: number }>()
  const r = grabbags.assemble(body.price, body.junkIds, body.hitId)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/shop/bags/buy', async (c) => {
  const body = await c.req.json<{ bagId: number }>()
  const r = grabbags.buyBag(body.bagId)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/shop/bags/open', async (c) => {
  const body = await c.req.json<{ bagId: number }>()
  const r = grabbags.openBag(body.bagId)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/shop/bags/stock-back', async (c) => {
  const body = await c.req.json<{ bagId: number }>()
  const r = grabbags.stockBack(body.bagId)
  return c.json(r, r.ok ? 200 : 400)
})

// ---------------------------------------------------------------------------
// Shop P&L (Phase 4) — weekly statement across product lines and overhead
// ---------------------------------------------------------------------------

app.get('/api/shop/pnl', (c) => {
  const week = c.req.query('week')
  return c.json({
    current: pnl.weekStatement(week || undefined),
    history: pnl.history(6),
  })
})

app.get('/api/shop/stats', (c) => c.json(shopstats.stats()))

// ---------------------------------------------------------------------------
// Polish — wishlist price alerts + weekly market-mover digest
// ---------------------------------------------------------------------------

app.post('/api/wishlist/alert', async (c) => {
  const body = await c.req.json<{ cardId: string; target: number | null }>()
  const r = polish.setAlert(body.cardId, body.target)
  return c.json(r, r.ok ? 200 : 400)
})

app.get('/api/market/digest', (c) => c.json(polish.currentDigest()))

// Tax season — business license, quarterly estimates, and true-up returns
app.get('/api/tax', (c) => {
  const q = c.req.query('quarter')
  return c.json({
    current: tax.preview(q ? undefined : undefined),
    lastQuarter: q ? tax.preview(q) : undefined,
    estimate: tax.estimate(),
    license: tax.license(),
    licenseFee: tax.LICENSE_FEE,
    nonprofit: tax.isNonprofit(),
    nonprofitCharterFee: tax.NONPROFIT_CHARTER_FEE,
    filings: tax.filings(12),
    strategy: tax.currentStrategy(),
    pendingAudits: tax.pendingAuditCount(),
    auditFindings: tax.auditFindings(),
  })
})
app.post('/api/tax/strategy', async (c) => {
  const body = await c.req.json<{ strategy: 'honest' | 'aggressive' }>()
  const r = tax.setStrategy(body.strategy)
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/tax/file', async (c) => {
  const body = await c.req.json<{ quarter?: string }>().catch(() => ({ quarter: undefined }))
  const r = tax.fileQuarter(body.quarter || undefined)
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/tax/estimate', async (c) => {
  const body = await c.req.json<{ amount: number }>().catch(() => ({ amount: 0 }))
  const r = tax.payEstimate(Number(body.amount) || 0)
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/tax/license', (c) => {
  const r = tax.renewLicense()
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/tax/license/renewal', (c) => {
  const r = tax.payQuarterlyRenewal()
  return c.json(r, r.ok ? 200 : 400)
})

// Nonprofit charter — exempt from income and sales tax, thinner margins
app.post('/api/tax/nonprofit', async (c) => {
  const body = await c.req.json<{ revoke?: boolean }>().catch(() => ({ revoke: false }))
  const r = body.revoke ? tax.revokeNonprofit() : tax.adoptNonprofit()
  return c.json(r, r.ok ? 200 : 400)
})

// Audit findings — pay the penalty or bribe the auditor
app.post('/api/tax/audit/pay', async (c) => {
  const body = await c.req.json<{ id: number }>()
  const r = tax.payAuditPenalty(Number(body.id))
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/tax/audit/bribe', async (c) => {
  const body = await c.req.json<{ id: number }>()
  const r = tax.bribeAuditor(Number(body.id))
  return c.json(r, r.ok ? 200 : 400)
})

// Sales tax — register collections and city remittance
app.get('/api/shop/salestax', (c) => c.json(salesTax.status()))
app.post('/api/shop/salestax/remit', (c) => {
  const remitted = salesTax.remit()
  return c.json({ ok: true as const, remitted })
})

// ---------------------------------------------------------------------------
// Estate lots (Phase 3) — mystery bundles at conventions
// ---------------------------------------------------------------------------

app.get('/api/convention/estate', (c) => c.json(estate.estateSection()))

app.get('/api/convention/summary', (c) => c.json(conventionSummary()))

// ---------------------------------------------------------------------------
// Net worth history (Phase 3) — weekly chart on the dashboard
// ---------------------------------------------------------------------------

app.get('/api/networth/history', (c) => c.json(netWorthSeries()))

app.get('/api/collector/stats', (c) => c.json(collectorStats()))

// ---------------------------------------------------------------------------
// Pack Battles (Phase 3) — head-to-head pack openings vs NPC rivals
// ---------------------------------------------------------------------------

app.get('/api/battles/rivals', (c) => c.json(packbattles.listRivals()))

app.get('/api/battles/products', (c) => c.json(packbattles.listBattlableProducts()))

app.get('/api/battles/record', (c) => c.json(packbattles.battleRecord()))

app.post('/api/battles/duck/:opponentId', (c) => {
  const r = packbattles.duckRematch(c.req.param('opponentId'))
  return c.json(r, r.ok ? 200 : 400)
})

// ---------------------------------------------------------------------------
// Tournaments (Phase 3) — brackets with escalating rounds
// ---------------------------------------------------------------------------

app.get('/api/tournaments', (c) => c.json(tournaments.tournamentStatus()))

// ------------------------- Event calendar -------------------------

app.get('/api/calendar', (c) => {
  const events = schedule.upcoming(3)
  return c.json({
    events,
    live: events.find((e) => e.now) ?? null,
    next: events.find((e) => new Date(e.start).getTime() > schedule.nowMs()) ?? null,
    serverNow: new Date(schedule.nowMs()).toISOString(),
    clockShifted: schedule.clockOffset() !== 0,
  })
})

// Dev: shift the world to a calendar instant for verification.
app.post('/api/calendar/dev-set', async (c) => {
  const body = await c.req.json<{ iso?: string; reset?: boolean }>()
  if (body.reset) schedule.debugResetClock()
  else if (body.iso) schedule.debugSetClock(body.iso)
  return c.json({ ok: true, serverNow: new Date(schedule.nowMs()).toISOString() })
})

app.post('/api/tournaments/join', async (c) => {
  const body = await c.req.json<{ size: number }>()
  const r = tournaments.joinTournament(body.size)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/tournaments/play', (c) => {
  const r = tournaments.playRound()
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/tournaments/abandon', (c) => c.json(tournaments.abandonTournament()))

// ------------------------- Streaming room -------------------------

app.get('/api/stream/channel', (c) => c.json(streaming.channel()))
app.get('/api/stream/products', (c) => c.json(streaming.listStreamProducts()))

app.post('/api/stream/live', async (c) => {
  const body = await c.req.json<{ productId: string; packs: number }>()
  const r = streaming.goLive(body.productId, body.packs)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/stream/rip', (c) => {
  const r = streaming.ripOnStream()
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/stream/end', (c) => {
  const r = streaming.endStream()
  return c.json(r, r.ok ? 200 : 400)
})

app.get('/api/stream/history', (c) => c.json(streaming.streamHistory()))
app.get('/api/stream/analytics', (c) => c.json(streaming.streamAnalytics()))

app.get('/api/sealed/status', (c) => {
  const real = (db.prepare(`SELECT COUNT(*) AS n FROM sealed_prices`).get() as { n: number }).n
  const products = (db.prepare(`SELECT COUNT(*) AS n FROM pack_products`).get() as { n: number }).n
  return c.json({ ...sealed.backfillStatus(), real, products })
})

app.post('/api/sealed/backfill', (c) => {
  sealed.startSealedBackfill()
  return c.json({ ok: true, status: sealed.backfillStatus() })
})

app.post('/api/sealed/sell/:productId', async (c) => {
  const body = await c.req.json<{ qty?: number }>().catch(() => ({ qty: 1 }))
  const r = sealed.sellSealed(c.req.param('productId'), body.qty ?? 1)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/sealed/refresh/:productId', async (c) => {
  const r = await sealed.refreshSealedPrice(c.req.param('productId'))
  return c.json({ ok: r === 'pricecharting', result: r })
})

// ------------------------- Sponsors -------------------------

app.get('/api/sponsors/offers', (c) => c.json(sponsors.listOffers()))

app.post('/api/sponsors/accept/:id', (c) => {
  const r = sponsors.acceptOffer(Number(c.req.param('id')))
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/sponsors/decline/:id', (c) => c.json(sponsors.declineOffer(Number(c.req.param('id')))))

app.get('/api/sponsors/contract', (c) => c.json(sponsors.currentContract()))

// ------------------------- Reselling (Phase 4) -------------------------

app.get('/api/resale/inbox', (c) => c.json(resale.inbox()))

app.post('/api/resale/deals/:id/haggle', (c) => {
  const r = resale.haggleDeal(Number(c.req.param('id')))
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/resale/deals/:id/buy', (c) => {
  const r = resale.buyDeal(Number(c.req.param('id')))
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/resale/deals/:id/walk', (c) => c.json(resale.walkDeal(Number(c.req.param('id')))))

app.get('/api/resale/stock', (c) => c.json(resale.flipStock()))

app.post('/api/resale/instant/:inventoryId', (c) => {
  const r = resale.instantSell(Number(c.req.param('inventoryId')))
  return c.json(r, r.ok ? 200 : 400)
})

app.get('/api/resale/ledger', (c) => c.json(resale.ledger()))

app.post('/api/battles/start', async (c) => {
  const body = await c.req.json<{ productId: string; opponentId: string }>()
  const r = packbattles.startBattle(body.productId, body.opponentId)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/convention/estate/buy/:lotId', (c) => {
  const r = estate.buyEstateLot(Number(c.req.param('lotId')))
  return c.json(r, r.ok ? 200 : 400)
})

// ---------------------------------------------------------------------------
// Auction house (Phase 3) — timed lots, NPC wars, consignment
// ---------------------------------------------------------------------------

app.get('/api/auctions', (c) => c.json(auctions.listLots()))

app.post('/api/auctions/bid/:id', async (c) => {
  const body = await c.req.json<{ maxBid: number }>()
  const r = auctions.placeBid(Number(c.req.param('id')), round2(body.maxBid || 0))
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/auctions/consign', async (c) => {
  const body = await c.req.json<{ inventoryId: number }>()
  const r = auctions.consignCard(body.inventoryId)
  return c.json(r, r.ok ? 200 : 400)
})

// ---------------------------------------------------------------------------
// Grading (Phase 3) — real PriceCharting grade prices
// ---------------------------------------------------------------------------

app.get('/api/grading/services', (c) => c.json(grading.listServices()))

app.get('/api/grading/stats', (c) => c.json(grading.gradingStats(grading.gradingCandidates())))

app.get('/api/grading/pending', (c) => {
  const revealed = grading
    .resolveGrading()
    .map((id) => grading.revealResult(id))
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
  return c.json({ pending: grading.pendingGrading(), revealed })
})

app.post('/api/grading/submit', async (c) => {
  const body = await c.req.json<{ inventoryId: number; serviceId: string }>()
  try {
    const res = grading.submitForGrading(body.inventoryId, body.serviceId)
    return c.json({ ok: true, ...res })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Submit failed' }, 400)
  }
})

app.get('/api/grading/reveal/:inventoryId', (c) => {
  const res = grading.revealResult(Number(c.req.param('inventoryId')))
  if (!res) return c.json({ error: 'Nothing to reveal' }, 404)
  return c.json(res)
})

// ---------------------------------------------------------------------------
// Wishlist & settings
// ---------------------------------------------------------------------------

app.post('/api/wishlist/toggle', async (c) => {
  const body = await c.req.json<{ cardId: string }>()
  const exists = db.prepare('SELECT 1 FROM wishlist WHERE card_id = ?').get(body.cardId)
  if (exists) db.prepare('DELETE FROM wishlist WHERE card_id = ?').run(body.cardId)
  else db.prepare('INSERT INTO wishlist (card_id, added_at) VALUES (?, ?)').run(body.cardId, nowIso())
  return c.json({ ok: true, wishlisted: !exists })
})

app.get('/api/wishlist', (c) => {
  const rows = db.prepare(`
    SELECT w.card_id, w.target_price, w.added_at, c.name, c.image_small, c.rarity, s.name AS set_name
    FROM wishlist w JOIN cards c ON c.id = w.card_id JOIN sets s ON s.id = c.set_id
    ORDER BY w.added_at DESC
  `).all() as Record<string, unknown>[]
  const out = rows.map((r) => ({ ...r, price: resolvePrice(r.card_id as string) }))
  return c.json(out)
})

app.post('/api/settings/api-key', async (c) => {
  const body = await c.req.json<{ key: string }>()
  setSetting('pokemontcgApiKey', body.key.trim() || '')
  return c.json({ ok: true })
})

app.post('/api/settings/price-sources', async (c) => {
  const body = await c.req.json<{ pricechartingToken?: string; ebayClientId?: string; ebayClientSecret?: string }>()
  if (body.pricechartingToken !== undefined) setSetting('pricechartingToken', body.pricechartingToken.trim())
  if (body.ebayClientId !== undefined) setSetting('ebayClientId', body.ebayClientId.trim())
  if (body.ebayClientSecret !== undefined) setSetting('ebayClientSecret', body.ebayClientSecret.trim())
  const cfg = pricesources.sourcesConfigured()
  if (cfg.pricecharting || cfg.ebay) pricesources.startPriceBackfill(true)
  // A PriceCharting token also unlocks REAL sealed prices — kick that backfill too.
  if (cfg.pricecharting) sealed.startSealedBackfill()
  return c.json({ ok: true, sources: cfg })
})

app.post('/api/prices/backfill', (c) => {
  const res = pricesources.startPriceBackfill(true)
  return c.json(res, res.started ? 200 : 400)
})

app.get('/api/prices/backfill', (c) => c.json(pricesources.getBackfillProgress()))

app.get('/api/settings', (c) => {
  return c.json({
    apiKeySet: Boolean(getSetting('pokemontcgApiKey')),
    pricechartingTokenSet: Boolean(pricesources.pricechartingToken()),
    ebayClientIdSet: Boolean(pricesources.ebayConfig()),
    backfill: pricesources.getBackfillProgress(),
    setsSyncedAt: getMeta('setsLastSyncedAt'),
    cardsSyncedAt: getMeta('cardsLastSyncedAt'),
    lastSnapshotAt: getMeta('lastSnapshotAt'),
    cardCount: (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n,
    priceRecordCount: (db.prepare('SELECT COUNT(*) AS n FROM price_records').get() as { n: number }).n,
    dataSources: [
      { name: 'pokemontcg.io API v2', role: 'Card identity, sets, images, TCGplayer & Cardmarket prices', url: 'https://pokemontcg.io' },
      { name: 'TCGplayer', role: 'USD market prices (via pokemontcg.io)', url: 'https://tcgplayer.com' },
      { name: 'PriceCharting', role: pricesources.pricechartingToken()
        ? 'Raw card prices + graded comps + REAL sealed product prices (API token set — sealed backfill pricing the catalog at ~1/sec)'
        : 'Raw card prices + graded comps + REAL sealed product prices (optional API token — NOT set, sealed prices are model estimates until you add one in Settings)', url: 'https://pricecharting.com' },
      { name: 'eBay', role: 'Median active fixed-price listings as a second fallback (optional API credentials)', url: 'https://ebay.com' },
      { name: 'Cardmarket', role: 'EUR prices & sale averages (via pokemontcg.io)', url: 'https://cardmarket.com' },
    ],
  })
})

app.post('/api/debug/reset-save', (c) => {
  db.prepare('DELETE FROM inventory').run()
  db.prepare('DELETE FROM sealed_inventory').run()
  db.prepare('DELETE FROM sale_history').run()
  db.prepare('DELETE FROM pull_history').run()
  db.prepare('DELETE FROM activity_log').run()
  db.prepare('DELETE FROM wishlist').run()
  db.prepare('DELETE FROM listings').run()
  db.prepare('DELETE FROM trade_offers').run()
  db.prepare('DELETE FROM trader_cards').run()
  db.prepare('DELETE FROM traders').run()
  db.prepare('DELETE FROM convention_items').run()
  db.prepare('DELETE FROM convention_booths').run()
  db.prepare('DELETE FROM conventions').run()
  db.prepare('DELETE FROM estate_lot_cards').run()
  db.prepare('DELETE FROM estate_lots').run()
  db.prepare("DELETE FROM meta WHERE key LIKE 'conventionEntry:%'").run()
  db.prepare('UPDATE inventory SET status = \'collection\', listing_price = NULL, listed_at = NULL WHERE status = \'listed\'').run()
  db.prepare('DELETE FROM auctions').run()
  db.prepare('DELETE FROM pack_battles').run()
  db.prepare('DELETE FROM rival_memory').run()
  db.prepare('DELETE FROM tournaments').run()
  db.prepare('DELETE FROM streams').run()
  db.prepare('DELETE FROM stream_stats').run()
  db.prepare('DELETE FROM sponsor_offers').run()
  db.prepare('DELETE FROM sponsor_contracts').run()
  db.prepare('DELETE FROM resale_deal_cards').run()
  db.prepare('DELETE FROM resale_deals').run()
  db.prepare('UPDATE game_state SET cash = 1000 WHERE id = 1').run()
  logActivity('system', 'Save reset. Fresh start with $1,000.')
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function ensureDefaultBinder() {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM binders').get() as { n: number }).n
  if (n === 0) {
    db.prepare('INSERT INTO binders (name, accent, created_at) VALUES (?, ?, ?)').run('Main Collection', 'yellow', nowIso())
    logActivity('system', 'You organized your first binder: Main Collection.')
  }
}

ensureGameState()
ensureDefaultBinder()
ensurePackCatalog()
backfillAcquiredRefs()
backfillNetWorthHistory()
streaming.recoverOrphanStreams()
streaming.backfillFollowersGain()
sealed.ensureSealedTable()
sealed.startSealedBackfill()

// Refresh this week's net-worth point whenever the dashboard's live totals change.
function maybeRecordNetWorthSnapshot() {
  const last = getMeta('lastNetworthSnapAt')
  if (last && Date.now() - new Date(last).getTime() < 5 * 60_000) return
  recordSnapshot()
  setMeta('lastNetworthSnapAt', nowIso())
}

// Daily price snapshot: when the server starts, copy the latest real prices into
// the history log if we haven't snapshotted in the last 24h.
function maybeDailySnapshot() {
  const last = getMeta('lastSnapshotAt')
  if (last && Date.now() - new Date(last).getTime() < 24 * 3600_000) return
  const n = market.takeSnapshot()
  if (n > 0) console.log(`[snapshot] stored ${n} price points into history`)
}
setTimeout(maybeDailySnapshot, 5000)
setInterval(maybeDailySnapshot, 6 * 3600_000)

// External price backfill: re-price unpriced cards from PriceCharting/eBay
// shortly after boot (runs only when a source is configured in Settings).
setTimeout(() => pricesources.startPriceBackfill(), 12_000)

sync.startSyncLoop()

serve({ fetch: app.fetch, port: PORT }, (info: { port: number }) => {
  console.log(`[server] TCG Life API listening on http://localhost:${info.port}`)
})
