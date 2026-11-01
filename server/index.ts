import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import fs from 'node:fs'
import path from 'node:path'
import { db, getMeta, setMeta, getSetting, setSetting, logActivity, nowIso } from './lib/db'
import { gameDayMs, gameDayStart, gameDayEnd, gameDayNumber, gameDayHours, resetGameDayCache } from './lib/gameday'
import * as sync from './services/sync'
import * as market from './services/market'
import * as deliveries from './services/deliveries'
import { portfolio } from './services/portfolio'
import { refreshBenchmarkCache, benchmarkStatus } from './services/benchmark'
import * as packs from './services/packs'
import * as binders from './services/binders'
import * as pricesources from './services/pricesources'
import * as grading from './services/grading'
import * as auth from './services/auth'
import * as substats from './services/substats'
import * as trading from './services/trading'
import * as conventions from './services/conventions'
import * as vendor from './services/vendor'
import * as shows from './services/shows'
import * as franchise from './services/franchise'
import * as loyalty from './services/loyalty'
import * as rival from './services/rival'
import * as achievements from './services/achievements'
import * as pricingintel from './services/pricingintel'
import * as shop from './services/shop'
import * as finance from './services/finance'
import * as staff from './services/staff'
import * as bulk from './services/bulk'
import * as grabbags from './services/grabbags'
import * as pnl from './services/pnl'
import * as shopstats from './services/shopstats'
import * as polish from './services/polish'
import * as tax from './services/tax'
import * as accountant from './services/accountant'
import * as salesTax from './services/salestax'
import * as auctions from './services/auctions'
import * as estate from './services/estate'
import * as storage from './services/storage'
import * as vault from './services/vault'
import * as buylist from './services/buylist'
import * as pawn from './services/pawn'
import * as yardsale from './services/yardsale'
import * as estatebuyout from './services/estatebuyout'
import * as forum from './services/forum'
import * as wishlistAgents from './services/wishlistagents'
import * as psarush from './services/psarush'
import * as liveshopping from './services/liveshopping'
import { conventionSummary, backfillAcquiredRefs } from './services/convention-summary'
import { netWorthSeries, backfillNetWorthHistory, recordSnapshot } from './services/networth'
import { collectorStats } from './services/collector-stats'
import * as packbattles from './services/packbattles'
import * as tournaments from './services/tournaments'
import * as streaming from './services/streaming'
import * as tcgcsv from './services/tcgcsv'
import * as sponsors from './services/sponsors'
import * as resale from './services/resale'
import * as ebay from './services/ebay'
import * as shipping from './services/shipping'
import * as schedule from './services/schedule'
import * as sealed from './services/sealed'
import * as sealedfutures from './services/sealedfutures'
import * as supplies from './services/supplies'
import * as insurance from './services/insurance'
import * as floor from './services/floor'
import * as local from './services/local'
import * as regimes from './services/regimes'
import * as seasonal from './services/seasonal'
import * as demographics from './services/demographics'
import * as breaks from './services/breaks'
import * as savebackup from './services/savebackup'
import * as savereset from './services/savereset'
import * as fleamarket from './services/fleamarket'
import * as today from './services/today'
import { resolvePrice, gradedPrices, round2, CONDITION_MULT } from './services/market'
import type { Condition } from './services/market'

const app = new Hono()
const PORT = Number(process.env.TCGLIFE_PORT || 8787) // ignore ambient PORT (dev proxies expect 8787)

// App version — injected at SEA build time by esbuild --define (see
// scripts/build-exe.sh). Dev runs via tsx have no define, so fall back to the
// package.json version, which tracks the same source the build scripts use.
declare const __TCGLIFE_VERSION__: string | undefined
import pkg from '../package.json'
import * as notify from './services/notify'
const APP_VERSION: string = typeof __TCGLIFE_VERSION__ !== 'undefined' ? __TCGLIFE_VERSION__ : (pkg as { version: string }).version

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

app.post('/api/settings/day-length', async (c) => {
  const body = await c.req.json<{ hours?: number }>().catch(() => ({}) as { hours?: number })
  const hours = Number(body?.hours)
  if (hours !== 12 && hours !== 24) return c.json({ error: 'Day length must be 12 or 24 hours' }, 400)
  setSetting('dayLengthHours', String(hours))
  resetGameDayCache()
  // 24h→12h: gates stamped with the old date-only keys would read as "not yet
  // run today" for the pm half — that's fine, they re-roll at the next
  // boundary and the keys are comparable. Nothing else is stored per-length.
  logActivity('system', hours === 12
    ? '📅 Game days now run 12 real hours — the daily heartbeat (rent, wear, snapshots, grading) fires twice per real day.'
    : '📅 Game days now run 24 real hours — the daily heartbeat is back to one pass per real day.')
  return c.json({ ok: true, hours })
})

function ensureGameState() {
  const row = db.prepare('SELECT id FROM game_state WHERE id = 1').get()
  if (!row) {
    db.prepare('INSERT INTO game_state (id, cash, created_at, last_tick_at) VALUES (1, 1000, ?, ?)').run(nowIso(), nowIso())
    logActivity('system', 'Welcome to TCG Life. $1,000 starting cash. The market is waiting.')
  }
}

// One-time rebalance for the 12h game-day clock (v0.5.61): wages and loan
// rates stored before the switch were per 24h-day; halve them so REAL-day
// cost pressure stays where it was tuned. Flag-guarded, so it runs once per
// save and is a no-op on saves born after the switch.
function migratePerDayCostsTo12hClock() {
  if (getMeta('econ:12hDay') === '1') return
  db.transaction(() => {
    db.prepare('UPDATE shop_employees SET wage = wage / 2').run()
    db.prepare('UPDATE franchise SET manager_wage = manager_wage / 2').run()
    if ((db.prepare("SELECT COUNT(*) AS n FROM meta WHERE key = 'chain:districtManager'").get() as { n: number }).n > 0) {
      const dm = JSON.parse((db.prepare("SELECT value FROM meta WHERE key = 'chain:districtManager'").get() as { value: string }).value) as { wage: number }
      dm.wage = round2(dm.wage / 2)
      db.prepare("UPDATE meta SET value = ? WHERE key = 'chain:districtManager'").run(JSON.stringify(dm))
    }
    db.prepare('UPDATE regional_managers SET wage = wage / 2').run()
    db.prepare('UPDATE loans SET rate_daily = rate_daily / 2').run()
    db.prepare('UPDATE pawn_loans SET rate_daily = rate_daily / 2').run()
    setMeta('econ:12hDay', '1')
  })()
  logActivity('system', '📅 The clock now runs on 12-hour game-days — per-day wages, rents, and interest rebalanced to match.')
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

// The catalog ships the three 30th Celebration RGB Mews mistagged as Common.
// They are the set's undocumented phantom secret rares — no set symbol,
// collector numbers R/G/B, ~$3.2k–$4.7k each at ~1 in 12,000 packs per colour.
// Treated as Commons they price like bulk and deal like bulk, so every boot
// repairs the rarity and rebuilds that set's pull table to match. Idempotent.
function repairPhantomRarities() {
  const updated = db
    .prepare(
      `UPDATE cards SET rarity = 'RGB Rare'
       WHERE id IN ('me55-R', 'me55-G', 'me55-B') AND (rarity IS NULL OR rarity <> 'RGB Rare')`,
    )
    .run().changes
  if (updated > 0) {
    packs.buildPullTable('me55', 10)
    console.log('[server] repaired', updated, 'phantom rarity row(s); rebuilt the me55 pull table')
  }
}

// The rarity ladder and pack blueprints changed shape, so tables built by
// older code are wrong: 30C Pikachus sat in the common pool, Trainer Gallery
// and LEGEND cards dealt like Commons, and no set produced Trainers or Energy
// at all. Rebuild every booster table once per save.
function migratePullTableRarities() {
  const VERSION = '4'
  if (getMeta('packs:tableVersion') === VERSION) return
  sealed.ensureFullCatalog()
  const ids = db
    .prepare(`SELECT s.id FROM sets s WHERE EXISTS (SELECT 1 FROM pack_products p WHERE p.id = s.id || '-booster')`)
    .all() as { id: string }[]
  let n = 0
  for (const { id } of ids) {
    try {
      packs.buildPullTable(id, 10)
      n++
    } catch (err) {
      console.warn('[packs] pull table rebuild failed for', id, err instanceof Error ? err.message : err)
    }
  }
  setMeta('packs:tableVersion', VERSION)
  console.log(`[packs] rebuilt ${n} pull table(s) on the real rarity ladder`)
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

// ---------------------------------------------------------------------------
// What's New — the in-game changelog. Versions ship in CHANGELOG.json (bundled
// at build time); the save remembers which version it last caught up to.
import changelogData from '../CHANGELOG.json'
type ChangelogEntry = { version: string; date: string; title: string; features: string[] }
const CHANGELOG = (changelogData as { entries: ChangelogEntry[] }).entries

app.get('/api/changelog', (c) => c.json({ current: APP_VERSION, entries: CHANGELOG }))

// Notifications — the header bell. A short list, newest first, with read state.
app.get('/api/notifications', (c) => {
  notify.prune()
  return c.json(notify.list(40))
})

app.post('/api/notifications/read', async (c) => {
  const body = await c.req.json<{ id?: number }>().catch(() => ({}) as { id?: number })
  if (body && typeof body.id === 'number') notify.markRead(body.id)
  return c.json({ ok: true, unread: notify.unreadCount() })
})

app.post('/api/notifications/read-all', (c) => {
  notify.markAllRead()
  return c.json({ ok: true, unread: 0 })
})

app.get('/api/changelog/seen', (c) => {
  // A save with play history that never opened the changelog is a RETURNING
  // player — the badge invites them in. A fresh save stays quiet.
  const veteran =
    (db.prepare('SELECT COUNT(*) n FROM sale_history').get() as { n: number }).n > 0 ||
    (db.prepare('SELECT COUNT(*) n FROM inventory').get() as { n: number }).n > 0
  return c.json({ seen: getMeta('changelog:seenVersion') || null, current: APP_VERSION, veteran })
})

app.post('/api/changelog/seen', async (c) => {
  const body = await c.req.json<{ version?: string }>().catch(() => ({}) as { version?: string })
  const version = body && typeof body === 'object' && body.version ? String(body.version) : APP_VERSION
  setMeta('changelog:seenVersion', version)
  return c.json({ ok: true, seen: version })
})

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

  const sealedRows = db.prepare('SELECT product_id, quantity, cost, condition FROM sealed_inventory').all() as { product_id: string; quantity: number; cost: number; condition: string }[]
  let sealedValue = 0
  for (const r of sealedRows) {
    const cond = r.condition === 'worn' ? sealedfutures.conditionMultiplier(sealed.priceDetail(r.product_id).oopMonths, 'worn') : sealedfutures.conditionMultiplier(sealed.priceDetail(r.product_id).oopMonths, 'fresh')
    sealedValue += r.quantity * (sealed.priceOf(r.product_id).market || r.cost) * cond // market value at condition — sealed appreciates
  }

  const listedRows = db.prepare(`SELECT card_id, variant, condition, quantity, listing_price FROM inventory WHERE status = 'listed'`).all() as { card_id: string; variant: string; condition: string; quantity: number; listing_price: number | null }[]
  const listedValue = listedRows.reduce((a, r) => a + r.quantity * (r.listing_price ?? market.valueOf(r.card_id, r.variant, (r.condition as market.Condition) || 'NM')), 0)

  // Debt is a negative asset — net worth nets out every outstanding loan,
  // bank line and sealed-desk ticket alike.
  const debt = (db.prepare(`SELECT COALESCE(SUM(balance),0) AS n FROM loans WHERE status = 'active'`).get() as { n: number }).n
    + (db.prepare(`SELECT COALESCE(SUM(balance),0) AS n FROM sealed_loans WHERE status = 'active'`).get() as { n: number }).n
  // …and a building you own is a positive one (v0.5.97). The mortgage is
  // already inside debt, so buying nets to ~zero and paying it off gains.
  const building = (db.prepare(`SELECT COALESCE(MAX(deed_price),0) AS n FROM shop`).get() as { n: number }).n

  const syncP = sync.getSyncProgress()
  const cardCount = (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n
  const setCount = (db.prepare('SELECT COUNT(*) AS n FROM sets').get() as { n: number }).n
  const binderStats = binders.getStats()
  // Play-history counters that drive the nav's progressive unlocks — a fresh
  // save sees a short sidebar; each system appears as the save earns it.
  const progress = {
    cardsOwned: (db.prepare(`SELECT COALESCE(SUM(quantity),0) AS n FROM inventory WHERE status IN ('collection','grading','listed')`).get() as { n: number }).n,
    salesCount: (db.prepare('SELECT COUNT(*) AS n FROM sale_history').get() as { n: number }).n,
    followers: (db.prepare('SELECT COALESCE((SELECT followers FROM stream_stats LIMIT 1), 0) AS n').get() as { n: number }).n,
    hasShop: !!db.prepare('SELECT id FROM shop WHERE id = 1').get(),
  }

  // The in-game day clock: a game-day is 12 real hours (boundaries roll at
  // 00:00 and 12:00 UTC — see lib/gameday), and rent, wear, disasters, save
  // snapshots and the rest of the daily heartbeat all gate on its key. Progress
  // = how far through the CURRENT game-day we are, so the HUD bar fills toward
  // the next rent day / snapshot / wear pass twice per real day.
  const now = new Date()
  const dayStart = gameDayStart(now)
  const dayProgress = (now.getTime() - dayStart.getTime()) / gameDayMs()
  const dayNumber = gameDayNumber(state.created_at || now.toISOString(), now)

  // Waiting-verdict counters: arrived auth tickets and finished grading jobs
  // the player hasn't seen yet. The sidebar's Inventory row and the view's tab
  // chips badge these so lab results are never missed now that reveals don't
  // auto-pop mid-session.
  const counters = {
    authVerdicts: (db.prepare(`SELECT COUNT(*) AS n FROM auth_tickets WHERE status = 'arrived'`).get() as { n: number }).n,
    gradingReady: (db.prepare(`SELECT COUNT(*) AS n FROM inventory WHERE status = 'grading' AND graded_grade IS NOT NULL`).get() as { n: number }).n,
  }

  return c.json({
    cash: round2(state.cash),
    collectionValue: round2(collectionTotal),
    inventoryValue: round2(listedValue + sealedValue),
    netWorth: round2(state.cash + collectionTotal + listedValue + sealedValue - debt + building),
    day: { number: dayNumber, progress: Math.min(1, Math.max(0, dayProgress)), resetsAt: gameDayEnd(now).toISOString(), lengthHours: gameDayHours() },
    sync: { ...syncP, cardCount, setCount, lastSnapshotAt: getMeta('lastSnapshotAt'), delta: sync.catalogDeltaStatus() },
    binders: binderStats,
    progress,
    counters,
    apiConfigured: Boolean(process.env.POKEMONTCG_API_KEY || getSetting('pokemontcgApiKey')),
    haggledOnce: getMeta('haggledOnce') === '1',
    // The starting tutorial only offers itself to saves with no play history
    // yet — veterans upgrading the app never get a welcome popup. A save that
    // reset itself back to fresh will see it again (a fresh start is a fresh
    // start), and Settings can always replay it on demand.
    tutorialEligible:
      (db.prepare('SELECT COUNT(*) n FROM sale_history').get() as { n: number }).n === 0 &&
      (db.prepare('SELECT COUNT(*) n FROM inventory').get() as { n: number }).n === 0,
    tutorials: {
      start: getMeta('tut:start') === '1',
      local: getMeta('tut:local') === '1',
      auction: getMeta('tut:auction') === '1',
      storage: getMeta('tut:storage') === '1',
      resale: getMeta('tut:resale') === '1',
      convention: getMeta('tut:convention') === '1',
      ebay: getMeta('tut:ebay') === '1',
      buylist: getMeta('tut:buylist') === '1',
      pawn: getMeta('tut:pawn') === '1',
      yard: getMeta('tut:yard') === '1',
      live: getMeta('tut:live') === '1',
      shipping: getMeta('tut:shipping') === '1',
      estate: getMeta('tut:estate') === '1',
      auth: getMeta('tut:auth') === '1',
      futures: getMeta('tut:futures') === '1',
    },
  })
})

app.get('/api/sync/progress', (c) => c.json(sync.getSyncProgress()))

// Starting-tutorial completion — flipped when the player finishes (or skips)
// the welcome walkthrough, so it never re-appears on this save.
app.post('/api/tutorials/start/done', (c) => {
  setMeta('tut:start', '1')
  return c.json({ ok: true })
})

// Replay the welcome walkthrough — clears the flag; the next page load
// re-opens it. (The per-surface first-use tips are server-side usage flags
// and deliberately not reset.)
app.post('/api/tutorials/start/replay', (c) => {
  setMeta('tut:start', '')
  return c.json({ ok: true })
})

app.post('/api/sync/restart', (c) => {
  setMeta('sync:set', '') // reset checkpoint
  sync.startSyncLoop()
  return c.json({ ok: true })
})

// Weekly catalog delta-sync — status + manual "check for new sets now" trigger.
app.get('/api/sync/delta', (c) => c.json(sync.catalogDeltaStatus()))
app.post('/api/sync/delta', async (c) => {
  const r = await sync.runCatalogDelta()
  return c.json(r, r.ran ? 200 : 400)
})

app.get('/api/activity', (c) => {
  const rows = db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT 50').all() as (Record<string, unknown> & { href?: string | null })[]
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// Sets & cards
// ---------------------------------------------------------------------------

app.get('/api/sets', (c) => {
  // One pass for owned counts rather than a correlated subquery per set: the
  // gallery needs a completion bar on every row, and it needs to be cheap
  // enough to refetch on every visit. Same statuses the set page counts
  // (collection + in-grading), distinct by card so a playset counts once.
  const rows = db.prepare(`
    WITH owned AS (
      SELECT c.set_id, COUNT(DISTINCT i.card_id) AS n
      FROM inventory i JOIN cards c ON c.id = i.card_id
      WHERE i.status IN ('collection','grading')
      GROUP BY c.set_id
    )
    SELECT s.*, COUNT(c.id) AS cards_synced, COALESCE(o.n, 0) AS owned
    FROM sets s
    LEFT JOIN cards c ON c.set_id = s.id
    LEFT JOIN owned o ON o.set_id = s.id
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

  const owned = db.prepare(`SELECT id, condition, variant, quantity, status, listing_price, graded_grade, cost_basis, acquired_at, favorite FROM inventory WHERE card_id = ? AND status != 'sold' ORDER BY acquired_at DESC`).all(id) as { id: number; condition: string; variant: string; quantity: number; graded_grade: string | null; status: string }[]
  const wishlisted = Boolean(db.prepare('SELECT 1 FROM wishlist WHERE card_id = ?').get(id))

  // Best-ROI rung: only meaningful for a raw copy you own (the "should I
  // grade it?" decision). Uses the copy's sub-stats when there's exactly
  // one — the same sharpening the Grading view shows.
  const rawRef = owned.find((o) => !o.graded_grade && o.status === 'collection')
  const bestRoi = rawRef ? grading.bestRoiRung(id, rawRef.condition, rawRef.id) : null

  // CONDITION WARS: decorate each owned raw single with its copy-grade comps
  // (band vs this-copy value + the published read) for the detail panel.
  const ownedDecorated = owned.map((o) => {
    if (o.graded_grade || (o.quantity ?? 1) !== 1) return { ...o, copy: null, seen: null }
    const known = substats.readFor(o.id) != null
    return {
      ...o,
      copy: market.resolvePriceCopy(id, o.variant || 'normal', (o.condition as market.Condition) || 'NM', o.id, known),
      seen: substats.readFor(o.id),
    }
  })

  return c.json({
    card: { ...card, price: primary },
    priceRows: latest,
    history: history.map((h) => ({ value: h.market, at: h.retrieved_at })),
    gradedPrices: graded,
    bestRoi,
    owned: ownedDecorated,
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
  // Attach market anchors — condition-aware, matching how listings are
  // PRICED at spawn (LP 0.8×, MP 0.65×, HP 0.5× of NM). Anchoring a fairly
  // priced LP listing against an NM price made every discounted condition
  // read "BELOW MARKET": the badges lied, and the lie compounded on BidBay
  // (deal-hunters were chasing condition discounts, not real deals).
  const out = (rows as Record<string, unknown>[]).map((r) => {
    const row = r as { card_id: string; variant: string; condition: string; graded_grade: string | null }
    const cond = ((row.condition as Condition) || 'NM')
    const price = row.graded_grade
      ? { usd: market.gradedPriceOf(row.card_id, row.graded_grade).usd, source: 'live' as const, retrievedAt: null, kind: 'pc-graded', variant: row.graded_grade, low: null, high: null }
      : resolvePrice(row.card_id, (r.variant as string) || 'normal', cond)
    const total = (r.price as number) + (r.shipping as number)
    const anchor = price.usd ?? 0
    return { ...r, market: price, total, delta: anchor > 0 ? total / anchor - 1 : 0, condMult: CONDITION_MULT[cond] ?? 1 }
  })
  return c.json(out)
})

app.post('/api/market/buy/:listingId', (c) => {
  const id = c.req.param('listingId')
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id) as { id: string; card_id: string; variant: string; condition: string; price: number; shipping: number; seller_name: string; eta_days: number } | undefined
  if (!listing) return c.json({ error: 'Listing gone — another buyer got it.' }, 404)
  const total = round2(listing.price + listing.shipping)
  const state = market.getGameState()
  if (state.cash < total) return c.json({ error: 'Not enough cash' }, 400)
  // Storage & the vault: full shelf refuses the delivery (or auto-scrap per policy).
  const admit = vault.admitRawFor(1, 'Market buy')
  if (!admit.ok) return c.json({ error: admit.error }, 400)
  db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(total)
  db.prepare('DELETE FROM listings WHERE id = ?').run(id)
  // The ETA on the listing is real: the card is on the road for eta_days
  // game-days and lands in the vault when the parcel is due.
  deliveries.schedule({ cardId: listing.card_id, variant: listing.variant, condition: listing.condition, costBasis: total, via: 'market', seller: listing.seller_name, etaDays: listing.eta_days })
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(listing.card_id) as { name: string }).name
  logActivity('buy', `Bought ${name} (${listing.condition}) for $${total.toFixed(2)} incl. shipping — ETA ${listing.eta_days} game-day${listing.eta_days === 1 ? '' : 's'}`, -total)
  return c.json({ ok: true, total, message: `${name} purchased for $${total.toFixed(2)} — arriving in ${listing.eta_days} game-day${listing.eta_days === 1 ? '' : 's'}` })
})

app.get('/api/market/incoming', (c) => {
  return c.json({ incoming: deliveries.pending() })
})
app.post('/api/market/deliver-due', (c) => {
  return c.json({ arrived: deliveries.deliverDue() })
})
app.post('/api/market/buy-direct', async (c) => {
  const body = await c.req.json<{ cardId: string; condition?: string }>()
  const price = resolvePrice(body.cardId, 'normal', 'NM')
  if (price.usd == null) return c.json({ error: 'No market price yet — sync this set first' }, 400)
  const total = round2(price.usd)
  const state = market.getGameState()
  if (state.cash < total) return c.json({ error: `Not enough cash (need $${total.toFixed(2)})` }, 400)
  // Storage & the vault: full shelf refuses the delivery (or auto-scrap per policy).
  const admit = vault.admitRawFor(1, 'Market buy')
  if (!admit.ok) return c.json({ error: admit.error }, 400)
  db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(total)
  // Direct buys ship from the distributor: one game-day on the truck.
  deliveries.schedule({ cardId: body.cardId, costBasis: total, via: 'market', etaDays: 1 })
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(body.cardId) as { name: string }).name
  logActivity('buy', `Bought ${name} (NM) at market for $${total.toFixed(2)} — arriving next game-day`, -total)
  return c.json({ ok: true, total, message: `${name} purchased at market for $${total.toFixed(2)} — arriving in 1 game-day` })
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
    const inv = r as { card_id: string; variant: string; condition: string; graded_grade: string | null; id: number; quantity: number }
    const rawSingle = !inv.graded_grade && (inv.quantity as number) === 1
    const gradingHint = rawSingle ? grading.gradingAdviceFor(inv.card_id, inv.condition, inv.id) : null
    // Sub-stat whisper: outliers flag even when the sub-stats KILLED the hint
    // (a rough copy isn't worth grading — that's exactly what the player must
    // learn to see), plus a shine on exceptional copies that do grade well.
    const substat = rawSingle ? substats.trueStats(inv.id) : null
    const substatNote = !substat
      ? null
      : substat.adjustment <= -1
        ? (gradingHint ? ' 😬 rough copy (inspect before grading)' : ' 😬 rough copy — not worth grading')
        : substat.adjustment >= 0.5
          ? (gradingHint ? ' ✨ gem candidate' : ' ✨ gem candidate — grading may pay')
          : null
    // CONDITION WARS: every raw single shows its copy-grade comps — the band
    // value, the copy's drift once its read is public, and what the market
    // pays for this exact card. The read itself only appears after a look.
    const copy = rawSingle
      ? market.resolvePriceCopy(inv.card_id, inv.variant || 'normal', (inv.condition as market.Condition) || 'NM', inv.id, substats.readFor(inv.id) != null)
      : null
    const seen = rawSingle ? substats.readFor(inv.id) : null
    // AUTH META: the sellable value carries the fake/uncertainty treatment;
    // read-only fields tell the client what to show without leaking state.
    const value = market.valueOfRow({ ...inv, fake_revealed: (inv as any).fake_revealed, auth_status: (inv as any).auth_status })
    const authBadge = (((inv as any).fake_revealed || (inv as any).is_fake)
      ? 'fake'
      : (inv as any).auth_status === 'authenticated'
        ? 'authenticated'
        : market.valueOf(inv.card_id, inv.variant || 'normal', (inv.condition as market.Condition) || 'NM') >= auth.AUTH_THRESHOLD
          ? 'unvetted'
          : null) as 'fake' | 'authenticated' | 'unvetted' | null
    const outRow: Record<string, unknown> = { ...r, value, gradingHint, substatNote, authBadge, deskReading: auth.deskReadingFor(inv.id), source: resolvePrice(inv.card_id, inv.variant || 'normal', (inv.condition as market.Condition) || 'NM'), copy, seen }
    // The hidden die never ships: fake_flag is the pre-reveal counterfeit
    // roll, and fake_revealed is server-side bookkeeping — the client gets
    // the public face (authBadge / is_fake / auth_status) and nothing else.
    delete outRow.fake_flag
    delete outRow.fake_revealed
    return outRow
  })
  return c.json(out)
})

// ---------------------------------------------------------------------------
// Supplies & condition wear (Phase 5) — protection stock, wear telemetry,
// and per-card protect/unprotect actions.
// ---------------------------------------------------------------------------

app.get('/api/supplies', (c) => c.json({ stock: supplies.stockLevels(), wear: supplies.wearRisk() }))

// ---------------------------------------------------------------------------
// Facebook Marketplace & Craigslist — the wild west.
// ---------------------------------------------------------------------------

app.get('/api/local', (c) => c.json(local.feed()))
app.get('/api/local/mine', (c) => c.json({ listings: local.myListings(), sold: local.mineSales() }))
app.post('/api/local/meet', async (c) => {
  const body = await c.req.json<{ id: number; offer?: number }>()
  return c.json(local.meet(Number(body.id), body.offer != null ? Number(body.offer) : undefined))
})
app.post('/api/local/list', async (c) => {
  const body = await c.req.json<{ inventoryId: number; ask: number }>()
  const r = local.listMine(Number(body.inventoryId), Number(body.ask))
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/local/list-sealed', async (c) => {
  const body = await c.req.json<{ productId: string; ask: number }>()
  const r = local.listSealed(String(body.productId), Number(body.ask))
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/local/list-bundle', async (c) => {
  const body = await c.req.json<{ inventoryIds: number[]; ask: number }>()
  const r = local.listBundle((body.inventoryIds ?? []).map(Number), Number(body.ask))
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/local/cancel', async (c) => {
  const body = await c.req.json<{ id: number }>()
  return c.json(local.cancelMine(Number(body.id)))
})
app.post('/api/local/accept', async (c) => {
  const body = await c.req.json<{ id: number; buyer: string; amount?: number }>()
  return c.json(local.acceptOffer(Number(body.id), String(body.buyer), body.amount != null ? Number(body.amount) : null))
})
app.post('/api/local/sell-fake', async (c) => {
  const body = await c.req.json<{ inventoryId: number }>()
  return c.json(local.sellFakeToBuylist(Number(body.inventoryId)))
})
app.post('/api/local/inspect', async (c) => {
  const body = await c.req.json<{ inventoryId: number }>()
  return c.json(local.inspectForFake(Number(body.inventoryId)))
})

// ---------------------------------------------------------------------------
// The authentication meta — USPA desk, verdicts, and the burn.
// ---------------------------------------------------------------------------

app.get('/api/auth', (c) => c.json({ ...auth.section(), ...auth.accusationSection() }))
app.get('/api/auth/services', (c) => c.json(auth.listServices()))
app.post('/api/auth/survey', async (c) => {
  const body = await c.req.json<{ inventoryId?: number }>().catch(() => ({}) as { inventoryId?: number })
  return c.json(auth.survey(body?.inventoryId))
})
app.post('/api/auth/tools', async (c) => {
  const body = await c.req.json<{ toolId: string }>()
  return c.json(auth.buyTool(String(body.toolId)))
})
app.post('/api/auth/desk-eligibility', async (c) => {
  const body = await c.req.json<{ inventoryId: number }>()
  return c.json(auth.deskReviewEligibility(Number(body.inventoryId)))
})
app.post('/api/auth/submit', async (c) => {
  const body = await c.req.json<{ inventoryId: number; serviceId: string }>()
  return c.json(auth.submitForAuth(Number(body.inventoryId), String(body.serviceId)), 200)
})
app.post('/api/auth/reveal', async (c) => {
  const body = await c.req.json<{ inventoryId: number }>()
  return c.json(auth.authReveal(Number(body.inventoryId)))
})
app.post('/api/auth/sell-fake', async (c) => {
  const body = await c.req.json<{ inventoryId: number }>()
  return c.json(auth.sellFakeToBuylist(Number(body.inventoryId)))
})

// ---------------------------------------------------------------------------
// The Floor — card shows as an attendee: browse, haggle, sell, grade-and-go.
// ---------------------------------------------------------------------------

app.get('/api/convention/floor', (c) => c.json(floor.floorStatus()))
// NOTE: static paths must be registered before the '/:id' route below, or Hono
// serves the param route first and 'stockable' parses as NaN (a real bug that
// silently broke booth stocking for months).
app.get('/api/convention/table/stockable', (c) => c.json(vendor.stockableInventory()))
app.get('/api/convention/table/:id', (c) => c.json(floor.tableStock(Number(c.req.param('id')))))
app.post('/api/convention/floor/haggle', async (c) => {
  const body = await c.req.json<{ itemId: number; offer: number }>()
  return c.json(floor.haggle(Number(body.itemId), Number(body.offer)))
})
app.post('/api/convention/floor/buy', async (c) => {
  const body = await c.req.json<{ itemId: number }>()
  return c.json(floor.buyAtAsk(Number(body.itemId)))
})
app.get('/api/convention/floor/:id/offers', (c) => c.json(floor.sellOffers(Number(c.req.param('id')))))
app.post('/api/convention/floor/sell', async (c) => {
  const body = await c.req.json<{ boothId: number; inventoryId: number; mode: 'cash' | 'credit' | 'haggle' }>()
  return c.json(floor.sellToDealer(Number(body.boothId), Number(body.inventoryId), body.mode))
})
app.post('/api/convention/floor/credit-buy', async (c) => {
  const body = await c.req.json<{ boothId: number; itemId: number }>()
  return c.json(floor.buyWithCredit(Number(body.boothId), Number(body.itemId)))
})
app.post('/api/convention/floor/grade-and-go', async (c) => {
  const body = await c.req.json<{ boothId: number; inventoryId: number }>()
  return c.json(floor.gradeAndGo(Number(body.boothId), Number(body.inventoryId)))
})

// ---------------------------------------------------------------------------
// Insurance — bind, cancel, inspect the policy, the appraisal, and claims.
// ---------------------------------------------------------------------------

app.get('/api/insurance', (c) => c.json(insurance.status()))

app.post('/api/insurance/bind', async (c) => {
  const body = await c.req.json<{ tier: string }>()
  const r = insurance.bind(body.tier as insurance.TierId)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/insurance/cancel', (c) => {
  const r = insurance.cancel()
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/supplies/buy', async (c) => {
  const body = await c.req.json<{ kind: string; packs?: number }>()
  const r = supplies.buy(body.kind, body.packs ? Number(body.packs) : 1)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/inventory/protect', async (c) => {
  const body = await c.req.json<{ id: number; kind: string }>()
  const r = supplies.protect(Number(body.id), String(body.kind || ''))
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/inventory/protect-bulk', async (c) => {
  const body = await c.req.json<{ ids: number[]; kind: string }>()
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite) : []
  const r = supplies.bulkProtect(ids, String(body.kind || ''))
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/inventory/unprotect', async (c) => {
  const body = await c.req.json<{ id: number }>()
  const r = supplies.unprotect(Number(body.id))
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/inventory/list', async (c) => {
  const body = await c.req.json<{ id: number; price: number }>()
  const row = db.prepare(`SELECT * FROM inventory WHERE id = ? AND status = 'collection'`).get(body.id) as { id: number; card_id: string; quantity: number } | undefined
  if (!row) return c.json({ error: 'Item not available to list' }, 400)
  const onBlock = db.prepare(`SELECT COUNT(*) AS n FROM ebay_auctions WHERE inventory_id = ? AND status = 'live'`).get(body.id) as { n: number }
  if (onBlock.n > 0) return c.json({ error: 'That card is on the BidBay auction block — pull the lot or wait for the hammer' }, 400)
  if (!body.price || body.price <= 0) return c.json({ error: 'Invalid price' }, 400)
  // CONDITION WARS: listing a single copy publishes its condition read — the
  // sub-grade becomes public knowledge and buyers pay for THIS copy.
  if ((row.quantity ?? 1) === 1) substats.revealWithRead(body.id)
  db.prepare(`UPDATE inventory SET status = 'listed', listing_price = ?, listed_at = ? WHERE id = ?`).run(round2(body.price), nowIso(), body.id)
  binders.cleanupSlotsForInventory([body.id]) // listing a slotted card frees its pocket
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(row.card_id) as { name: string }).name
  logActivity('listing', `Listed ${name} for $${body.price.toFixed(2)}`)
  return c.json({ ok: true })
})

// BULK REPRICING: nudge every picked listing's ask by a percentage. Only rows
// that are actually marketplace-listed ('listed', not local listings, cases,
// consignments, or live auctions) move — one UPDATE, one feed line.
app.post('/api/inventory/reprice-bulk', async (c) => {
  const body = await c.req.json<{ ids: number[]; pct: number }>()
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n) => Number.isFinite(n))
  const pct = Number(body.pct)
  if (ids.length === 0) return c.json({ error: 'Nothing picked' }, 400)
  if (!Number.isFinite(pct) || pct < -50 || pct > 50) return c.json({ error: 'Percentage must be between -50% and +50%' }, 400)
  const ph = ids.map(() => '?').join(',')
  const rows = db.prepare(`SELECT id, listing_price, cost_basis, quantity, status FROM inventory WHERE id IN (${ph}) AND status = 'listed'`).all(...ids) as { id: number; listing_price: number | null; cost_basis: number; quantity: number }[]
  const skipped = ids.length - rows.length
  if (rows.length === 0) return c.json({ error: 'None of the picked cards are marketplace-listed (local posts, shop cases, and auction lots reprice on their own surfaces)' }, 400)
  let moved = 0
  let before = 0
  let after = 0
  const tx = db.transaction(() => {
    for (const r of rows) {
      const old = r.listing_price
      if (!old || !(old > 0)) continue // listed at market without a stamped ask — nothing to nudge
      const next = Math.max(0.01, Math.round(old * (1 + pct / 100) * 100) / 100)
      if (next === old) continue
      db.prepare(`UPDATE inventory SET listing_price = ? WHERE id = ?`).run(next, r.id)
      moved++
      before += old * (r.quantity || 1)
      after += next * (r.quantity || 1)
    }
  })
  tx()
  if (moved === 0) return c.json({ error: 'Every picked listing already sits at its target price' }, 400)
  const word = pct > 0 ? `up ${pct}%` : pct < 0 ? `down ${Math.abs(pct)}%` : 'flat'
  logActivity('listing', `Repriced ${moved} listing${moved === 1 ? '' : 's'} ${word} — asking ${fmtUsd2(after)} total (was ${fmtUsd2(before)}).${skipped > 0 ? ` ${skipped} picked card${skipped === 1 ? '' : 's'} skipped (not marketplace-listed).` : ''}`)
  return c.json({ ok: true, moved, skipped, before: round2(before), after: round2(after) })
})

function fmtUsd2(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`
}

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

// Boxes open one wrapper at a time: start it (the promo lands in the binder
// first), then keep asking for the next pack until packsLeft hits zero.
app.get('/api/packs/boxes', (c) => c.json(packs.openBoxes()))

app.post('/api/packs/box', async (c) => {
  const body = await c.req.json<{ productId: string }>()
  try {
    return c.json(packs.beginBox(body.productId))
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Open failed' }, 400)
  }
})

app.post('/api/packs/box/next', async (c) => {
  const body = await c.req.json<{ boxId: number }>()
  try {
    return c.json(packs.openBoxNext(Number(body.boxId)))
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Open failed' }, 400)
  }
})

app.get('/api/pulls', (c) => {
  // Player-attributed rips only: the live wing's host rips, battle opponents,
  // and tournament NPC matches share this table as a world log (owner='other')
  // and must never appear in the player's history.
  return c.json(db.prepare(`
    SELECT ph.*, c.name, c.image_small, c.rarity, s.name AS set_name
    FROM pull_history ph JOIN cards c ON c.id = ph.card_id JOIN sets s ON s.id = c.set_id
    WHERE ph.owner = 'player'
    ORDER BY ph.id DESC LIMIT 400
  `).all())
})

app.get('/api/pulls/best', (c) => {
  const row = db.prepare(`
    SELECT ph.card_id, ph.value, ph.is_hit, ph.opened_at, c.name, c.image_small, s.name AS set_name, ph.rarity
    FROM pull_history ph JOIN cards c ON c.id = ph.card_id JOIN sets s ON s.id = c.set_id
    WHERE ph.owner = 'player'
    ORDER BY ph.value DESC LIMIT 1
  `).get() as { card_id: string; value: number; is_hit: number; opened_at: string; name: string; image_small: string | null; set_name: string; rarity: string | null } | undefined
  // Second chase: the best SINGLE-PACK total. Sessions are one pack on the
  // main ceremony and Live paths; battles roll one session id per pack, so a
  // straight GROUP BY never mixes two packs into one "pack".
  const pack = db.prepare(`
    SELECT session_id, SUM(value) AS total
    FROM pull_history
    WHERE owner = 'player'
    GROUP BY session_id
    ORDER BY total DESC
    LIMIT 1
  `).get() as { session_id: string; total: number } | undefined
  if (!row && !pack) return c.json({ cardId: null, value: 0, bestPackTotal: 0 })
  return c.json({
    cardId: row?.card_id ?? null,
    value: row?.value ?? 0,
    name: row?.name,
    image: row?.image_small,
    setName: row?.set_name,
    rarity: row?.rarity,
    isHit: row?.is_hit === 1,
    openedAt: row?.opened_at,
    bestPackTotal: pack?.total ?? 0,
  })
})

app.get('/api/pulls/summary', (c) => {
  const rows = db.prepare(`
    SELECT session_id, SUM(value) AS total_value, COUNT(*) AS card_count, MAX(opened_at) AS opened_at,
           SUM(is_hit) AS hits
    FROM pull_history WHERE owner = 'player' GROUP BY session_id ORDER BY opened_at DESC LIMIT 30
  `).all() as { session_id: string; total_value: number; card_count: number; opened_at: string; hits: number }[]
  const spent = db.prepare(`SELECT product_id, quantity, cost, condition, escrow_loan FROM sealed_inventory WHERE quantity > 0`).all() as { product_id: string; quantity: number; cost: number; condition: string; escrow_loan: number | null }[]
  // Aggregate per product (a product can hold fresh AND worn lots — and
  // escrowed collateral) with live market value + OOP info + futures-desk
  // condition pricing. Sealed stock is an appreciating position; the desk
  // prices fresh above market and worn below.
  const agg = new Map<string, { qty: number; value: number; basis: number; wornQty: number; escrowed: number }>()
  for (const s of spent) {
    const d = sealed.priceDetail(s.product_id)
    const condMult = sealedfutures.conditionMultiplier(d.oopMonths, s.condition === 'worn' ? 'worn' : 'fresh')
    let a = agg.get(s.product_id)
    if (!a) {
      a = { qty: 0, value: 0, basis: 0, wornQty: 0, escrowed: 0 }
      agg.set(s.product_id, a)
    }
    a.qty += s.quantity
    a.value += s.quantity * ((d.market || s.cost) * condMult)
    a.basis += s.quantity * s.cost
    if (s.condition === 'worn') a.wornQty += s.quantity
    if (s.escrow_loan != null) a.escrowed += s.quantity
  }
  const sealedEnriched = [...agg.entries()].map(([productId, a]) => {
    const d = sealed.priceDetail(productId)
    const product = db.prepare(`SELECT name, kind, packs FROM pack_products WHERE id = ?`).get(productId) as { name: string; kind: string; packs: number | null } | undefined
    const marketValue = round2(a.value)
    const basis = round2(a.basis)
    // Boxes carry their pack count so the OPEN button can promise what the
    // rip delivers ("6 packs inside"). Boosters are one pack by definition.
    const packsInBox = product && product.kind !== 'booster' && product.packs ? Math.max(1, product.packs) : 1
    return {
      product_id: productId,
      name: product?.name ?? productId,
      quantity: a.qty,
      cost: a.qty > 0 ? round2(a.basis / a.qty) : 0,
      market_price: a.qty > 0 ? round2(a.value / a.qty) : 0,
      source: d.source,
      oop: d.oop,
      oop_months: d.oopMonths,
      status: d.status,
      market_value: marketValue,
      basis,
      unrealized: round2(marketValue - basis),
      packs: packsInBox,
      freshQty: a.qty - a.wornQty,
      wornQty: a.wornQty,
      escrowed: a.escrowed,
    }
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

app.post('/api/trade/haggle-counter/:id', async (c) => {
  const body = await c.req.json<{ cashToYou?: number }>().catch(() => ({}) as { cashToYou?: number })
  if (typeof body.cashToYou !== 'number' || !Number.isFinite(body.cashToYou)) return c.json({ ok: false, error: 'cashToYou must be a number' }, 400)
  const res = trading.offerHaggle(Number(c.req.param('id')), body.cashToYou)
  return c.json(res, res.ok ? 200 : 400)
})

// ---------------------------------------------------------------------------
// Conventions (Phase 3) — pop-up card shows with vendor booths
// ---------------------------------------------------------------------------

app.get('/api/convention', (c) => c.json(conventions.showStatus()))

// ---------------------------------------------------------------------------
// Hosted card shows (Phase 5 — Empire): venues, booking, dealer rosters,
// show-day results. See server/services/shows.ts.
// ---------------------------------------------------------------------------

app.get('/api/shows', (c) => c.json(shows.status()))
app.post('/api/shows/book', async (c) => {
  const body = await c.req.json<{ venue: string; gate?: number; tablePrice?: number; guests?: string[] }>()
  const r = shows.bookShow(String(body.venue || ''), Number(body.gate ?? 5), Number(body.tablePrice ?? 25), Array.isArray(body.guests) ? body.guests : [])
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/shows/guests', async (c) => {
  const body = await c.req.json<{ guests?: string[] }>()
  const show = shows.upcomingShow()
  if (!show) return c.json({ ok: false, error: 'No upcoming show' }, 400)
  const r = shows.setGuests(show.id, Array.isArray(body.guests) ? body.guests : [])
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/shows/pricing', async (c) => {
  const body = await c.req.json<{ id?: number; gate?: number; tablePrice?: number }>()
  const show = shows.upcomingShow()
  if (!show) return c.json({ ok: false, error: 'No upcoming show' }, 400)
  const r = shows.setPricing(show.id, Number(body.gate ?? show.gate), Number(body.tablePrice ?? show.table_price))
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/shows/cancel', async (c) => {
  const show = shows.upcomingShow()
  if (!show) return c.json({ ok: false, error: 'No upcoming show' }, 400)
  const r = shows.cancelShow(show.id)
  return c.json(r, r.ok ? 200 : 400)
})

// The host's own booth at their own show — claim a slot, then stock/sell
// through the normal vendor-table flow.
app.post('/api/shows/booth/claim', (c) => {
  const r = vendor.claimHostBooth()
  return c.json(r, r.ok ? 200 : 400)
})

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

// (stockable is registered with the floor routes above — it must precede '/:id')

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

// ---------------------------------------------------------------------------
// The Franchise (Phase 5): a second storefront run by a hired manager.
// ---------------------------------------------------------------------------

app.get('/api/franchise', (c) => c.json(franchise.status()))

// The rival across the street.
app.get('/api/rival', (c) => c.json(rival.status()))
app.get('/api/achievements', (c) => c.json(achievements.status()))
app.post('/api/rival/buyout', async (c) => {
  const body = await c.req.json<{ amount?: number }>()
  return c.json(rival.offerBuyout(Number(body.amount ?? 0)))
})
app.post('/api/rival/match', (c) => c.json(rival.matchPrices()))
app.post('/api/franchise/open', async (c) => {
  const body = await c.req.json<{ name?: string; tier?: string; managerName?: string; managerQuality?: number; managerWage?: number; store?: number }>()
  const r = franchise.open(String(body.name || ''), String(body.tier || 'hole-in-the-wall') as 'hole-in-the-wall' | 'storefront' | 'flagship', Number(body.managerQuality ?? 3), Number(body.managerWage ?? 15), String(body.managerName || 'Manager'), Number(body.store ?? 1))
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/franchise/close', async (c) => {
  const body = await c.req.json<{ store?: number }>().catch(() => ({ store: undefined }))
  const r = franchise.close(Number(body.store ?? 1))
  return c.json(r, r.ok ? 200 : 400)
})
app.get('/api/franchise/internal', (c) => c.json({ ok: true as const, candidates: franchise.promotionCandidates() }))
app.post('/api/franchise/promote', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const r = franchise.promoteOpen(Number(body.employeeId), String(body.name || ''), String(body.tier || 'hole-in-the-wall') as 'hole-in-the-wall' | 'storefront' | 'flagship', Number(body.store ?? 1))
  if (!r.ok) return c.json(r, 400)
  return c.json(r)
})
app.post('/api/franchise/stock', async (c) => {
  const body = await c.req.json<{ inventoryId?: number; ask?: number; store?: number }>()
  const r = franchise.stock(Number(body.inventoryId), Number(body.ask), Number(body.store ?? 1))
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/franchise/unstock', async (c) => {
  const body = await c.req.json<{ inventoryId?: number }>()
  const r = franchise.unstock(Number(body.inventoryId))
  return c.json(r, r.ok ? 200 : 400)
})
app.get('/api/franchise/stockable', (c) => c.json(franchise.stockableInventory()))
app.post('/api/franchise/audit', async (c) => {
  const body = await c.req.json<{ store?: number }>().catch(() => ({ store: undefined }))
  const r = franchise.audit(Number(body.store ?? 1))
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/franchise/move', async (c) => {
  const body = await c.req.json<{ inventoryId?: number; ask?: number; store?: number }>()
  const r = franchise.stock(Number(body.inventoryId), Number(body.ask), Number(body.store ?? 1))
  return c.json(r, r.ok ? 200 : 400)
})
app.get('/api/franchise/dm', (c) => c.json({ ok: true as const, dm: franchise.districtRow(), candidates: franchise.dmCandidates(), internal: franchise.promotionCandidates().filter((c) => c.salesLift >= 20) }))
app.post('/api/franchise/dm/hire', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const r = 'employeeId' in body ? franchise.hireDm({ employeeId: Number(body.employeeId) }) : franchise.hireDm({ name: String(body.name || ''), quality: Number(body.quality ?? 0), wage: Number(body.wage ?? 0) })
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/franchise/dm/fire', (c) => c.json(franchise.fireDm()))

// The region — regional manager above the DM; unlocks store #3.
app.get('/api/franchise/regional', (c) => c.json({ ok: true as const, regional: franchise.regionalRow(), candidates: franchise.regionalRow() ? [] : franchise.regionalCandidates() }))
app.post('/api/franchise/regional/hire', async (c) => {
  const body = await c.req.json<{ name?: string; quality?: number; wage?: number }>()
  return c.json(franchise.hireRegional(String(body.name ?? ''), Number(body.quality ?? 0), Number(body.wage ?? 0)))
})
app.post('/api/franchise/regional/fire', (c) => c.json(franchise.fireRegional()))
app.post('/api/franchise/loyalty/resolve', async (c) => {
  const body = await c.req.json<{ store?: number; dm?: boolean; regional?: boolean; action?: string }>()
  const action = body.action === 'refuse' ? 'refuse' : 'grant'
  if (body.regional) return c.json(loyalty.resolveRegionalDemand(action))
  if (body.dm) return c.json(loyalty.resolveDmDemand(action))
  return c.json(loyalty.resolveDemand(Number(body.store ?? 0), action))
})

// Manager loyalty & ambition — raise demands, grant/refuse, interim rehire.
app.post('/api/franchise/loyalty/rehire', async (c) => {
  const body = await c.req.json<{ store?: number; name?: string; quality?: number; wage?: number }>()
  return c.json(loyalty.replaceManager(Number(body.store ?? 0), String(body.name ?? ''), Number(body.quality ?? 0), Number(body.wage ?? 0)))
})

// ---------------------------------------------------------------------------
// Chain pricing intel — the advisory that routes stock between storefronts.
// ---------------------------------------------------------------------------

app.get('/api/franchise/intel', (c) => {
  const main = shop.getShop()
  if (!main) return c.json({ ok: false as const, error: 'Lease your first shop before routing stock' }, 400)
  return c.json(pricingintel.status())
})
app.post('/api/franchise/intel/transfer', async (c) => {
  const body = await c.req.json<{ inventoryId?: number; toKind?: string; toStore?: number }>()
  const r = pricingintel.transfer(Number(body.inventoryId), body.toKind === 'flagship' ? 'flagship' : 'satellite', Number(body.toStore ?? 0))
  return c.json(r, r.ok ? 200 : 400)
})

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

// RENT VS BUY (v0.5.97) — buy the building out from under the landlord.
app.post('/api/shop/buy', (c) => {
  const r = shop.buyBuilding()
  return c.json(r, r.ok ? 200 : 400)
})

app.get('/api/shop/stockable', (c) => c.json(shop.stockableInventory()))

// Consignment counter
app.post('/api/shop/consignment/accept', async (c) => {
  const body = await c.req.json<{ id: number; ask: number }>()
  const r = shop.acceptConsignment(Number(body.id), Number(body.ask))
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/shop/consignment/decline', async (c) => {
  const body = await c.req.json<{ id: number }>()
  const r = shop.declineConsignment(Number(body.id))
  return c.json(r, r.ok ? 200 : 400)
})
app.post('/api/shop/consignment/return', async (c) => {
  const body = await c.req.json<{ id: number }>()
  const r = shop.returnConsignment(Number(body.id))
  return c.json(r, r.ok ? 200 : 400)
})
app.get('/api/shop/consignment', (c) => c.json(shop.consignmentStatus()))

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

// Employees with lives — the three conversations: a day off, a rival offer,
// and the one huff you get to defuse before someone walks.

app.post('/api/shop/staff/dayoff', async (c) => {
  const body = await c.req.json<{ id: number; action: 'grant' | 'refuse' }>()
  const r = staff.resolveDayOff(body.id, body.action)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/shop/staff/poach', async (c) => {
  const body = await c.req.json<{ id: number; action: 'match' | 'letgo' }>()
  const r = staff.resolvePoach(body.id, body.action)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/shop/staff/huff', async (c) => {
  const body = await c.req.json<{ id: number; action: 'grant' | 'refuse' }>()
  const r = staff.resolveHuff(body.id, body.action)
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
// 📦 BidBay (Phase 5) — the online storefront: list from the binder, NPC
// snipers hunt underpriced listings, 13% fees, shipping payouts, feedback,
// and channel conflict with the walk-in shop.
// ---------------------------------------------------------------------------

try { db.exec(`ALTER TABLE ebay_listings ADD COLUMN promoted_ticks INTEGER NOT NULL DEFAULT 0`) } catch { /* exists */ }

app.get('/api/ebay', (c) => c.json(ebay.status()))

// --- Shipping & condition disputes -----------------------------------------
app.get('/api/shipments', (c) => c.json({ toShip: shipping.toShip(), inFlight: shipping.inFlight(), history: shipping.history(), methods: shipping.SHIP_METHODS, packs: shipping.PACK_LEVELS }))
app.post('/api/shipments/ship', async (c) => {
  const body = await c.req.json<{ kind: string; id: number; method: string; pack: string; photos: boolean }>()
  return c.json(shipping.ship({ kind: body.kind as 'fixed' | 'auction', id: Number(body.id) }, body.method as shipping.ShipMethod, body.pack as shipping.PackLevel, !!body.photos))
})
app.post('/api/shipments/dispute', async (c) => {
  const body = await c.req.json<{ kind: string; id: number }>()
  const r = shipping.resolveDispute({ kind: body.kind as 'fixed' | 'auction', id: Number(body.id) })
  if (r.ok && r.outcome === 'lost') {
    // The sting lands in the feedback rating — a 1★ from the refunded buyer.
    const sh = shipping.history().find((s: import('./services/shipping').ShipmentRow) => s.outcome === 'refund' && s.kind === body.kind && s.ref_id === Number(body.id))
    if (sh) shipping.disputeFeedback(sh)
  }
  return c.json(r)
})

app.post('/api/ebay/list', async (c) => {
  const body = await c.req.json<{ id: number; ask: number }>()
  const r = ebay.list(Number(body.id), Number(body.ask))
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/ebay/cancel/:id', (c) => {
  const r = ebay.cancel(Number(c.req.param('id')))
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/ebay/promote/:id', (c) => {
  const r = ebay.promote(Number(c.req.param('id')))
  return c.json(r, r.ok ? 200 : 400)
})

app.get('/api/ebay/market', (c) => c.json(ebay.marketFeed()))

app.post('/api/ebay/watch', async (c) => {
  const body = await c.req.json<{ card_id: string; max_price?: number | null }>()
  const r = ebay.watch(String(body.card_id), body.max_price == null ? null : Number(body.max_price))
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/ebay/unwatch/:cardId', (c) => c.json(ebay.unwatch(c.req.param('cardId'))))

app.post('/api/ebay/market/buy/:id', (c) => {
  const r = ebay.buyMarket(Number(c.req.param('id')))
  return c.json(r, r.ok ? 200 : 400)
})

app.get('/api/ebay/auctions', (c) => c.json(ebay.listEbayAuctions()))

app.get('/api/ebay/npc-auctions', (c) => c.json(ebay.listNpcAuctions()))

app.post('/api/ebay/npc-auctions/bid/:id', async (c) => {
  const body = await c.req.json<{ max: number }>()
  const r = ebay.bidNpcAuction(Number(c.req.param('id')), Number(body.max))
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/ebay/auctions/start', async (c) => {
  const body = await c.req.json<{ id: number; startBid?: number }>()
  const r = ebay.startAuction(Number(body.id), body.startBid != null ? Number(body.startBid) : undefined)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/ebay/auctions/cancel/:id', (c) => {
  const r = ebay.cancelEbayAuction(Number(c.req.param('id')))
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
    protection: insurance.protectionCosts(),
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

// Market regimes — the phase banner and live reprint shocks
app.get('/api/market/regimes', (c) => c.json(regimes.status()))

// Seasonal events — the hobby calendar's holiday spikes and lulls
app.get('/api/market/seasonal', (c) => c.json(seasonal.status()))

// Population & meta drift — era tastes, live meta-booms, set demand profiles
app.get('/api/market/scene', (c) => c.json(demographics.status()))

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
    roundUpsEnabled: tax.roundUpsEnabled(),
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

// Suggested-donation round-ups at the nonprofit register (opt-out)
app.post('/api/tax/roundups', async (c) => {
  const body = await c.req.json<{ enabled: boolean }>().catch(() => ({ enabled: true }))
  return c.json(tax.setRoundUps(!!body.enabled))
})

// The accountant — retained bookkeeper, weekly report, waste flags
app.get('/api/accountant', (c) => c.json(accountant.status()))
app.post('/api/accountant/hire', async (c) => {
  const body = await c.req.json<{ name: string; quality: number }>().catch(() => ({ name: '', quality: 3 }))
  if (!body.name) return c.json({ ok: false, error: 'Pick an applicant' }, 400)
  return c.json(accountant.hire(String(body.name).slice(0, 40), Number(body.quality) || 3))
})
app.post('/api/accountant/fire', (c) => c.json(accountant.fire()))

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

// ---------------------------------------------------------------------------
// Storage unit auctions — the locker gamble
// ---------------------------------------------------------------------------

app.get('/api/storage/units', (c) => c.json(storage.unitsSection()))

// Storage & the vault — capacity, lockers, and the graded-slab rider
app.get('/api/storage/capacity', (c) => c.json(vault.capacity()))
app.post('/api/storage/lockers/rent', async (c) => {
  const body = await c.req.json<{ tier: string }>()
  return c.json(vault.rentLocker(String(body.tier ?? '')))
})
app.post('/api/storage/lockers/close', async (c) => {
  const body = await c.req.json<{ id: number }>()
  return c.json(vault.closeLocker(Number(body.id)))
})
app.post('/api/storage/vault/subscribe', (c) => c.json(vault.subscribeVault()))
app.post('/api/storage/vault/cancel', (c) => c.json(vault.cancelVault()))
app.post('/api/storage/overflow', async (c) => {
  const body = await c.req.json<{ policy: string }>()
  return c.json(vault.setOverflowPolicy(String(body.policy ?? '')))
})
// Pre-flight: what would an n-card buy have to scrap? (read-only)
app.get('/api/storage/overflow-preview', (c) => c.json(vault.overflowPreview(Math.max(1, Number(c.req.query('count') ?? 1)))))
app.post('/api/storage/scrap-floor', async (c) => {
  const body = await c.req.json<{ value: number }>()
  return c.json(vault.setScrapFloor(Number(body.value)))
})
app.post('/api/storage/bid/:unitId', async (c) => {
  const body = await c.req.json<{ amount: number }>()
  return c.json(storage.placeBid(Number(c.req.param('unitId')), Number(body.amount)), 200)
})
app.post('/api/storage/open/:unitId', (c) => c.json(storage.openUnit(Number(c.req.param('unitId')))))
app.post('/api/storage/sort/:unitId', async (c) => {
  const body = await c.req.json<{ keep: string[] }>()
  return c.json(storage.sortHaul(Number(c.req.param('unitId')), body.keep ?? []))
})

// ---------------------------------------------------------------------------
// Buylist — NPC shops buying outright at 55–75%, rotating wants, store credit
// ---------------------------------------------------------------------------
app.get('/api/buylist', (c) => c.json(buylist.section()))
app.get('/api/buylist/offers/:shopId', (c) => c.json(buylist.offersFor(Number(c.req.param('shopId')))))
app.get('/api/buylist/shelf/:shopId', (c) => c.json(buylist.shelfSection(Number(c.req.param('shopId')))))

// ---------------------------------------------------------------------------
// Pawn shop — fire-sale quotes, collateral loans, brutal terms
// ---------------------------------------------------------------------------
app.get('/api/pawn', (c) => c.json(pawn.section()))
app.post('/api/pawn/sell/:inventoryId', (c) => c.json(pawn.sellOutright(Number(c.req.param('inventoryId')))))
app.post('/api/pawn/hock/:inventoryId', async (c) => {
  const body = await c.req.json<{ amount?: number }>().catch(() => ({ amount: undefined }))
  return c.json(pawn.hock(Number(c.req.param('inventoryId')), body.amount == null ? undefined : Number(body.amount)))
})
app.post('/api/pawn/payoff/:loanId', (c) => c.json(pawn.payoff(Number(c.req.param('loanId')))))
app.post('/api/pawn/buyback/:shelfId', (c) => c.json(pawn.buyBack(Number(c.req.param('shelfId')))))

// ---------------------------------------------------------------------------
// Yard sales — weekend driveways, vibes pricing, haggling, mystery boxes
// ---------------------------------------------------------------------------
app.get('/api/yard', (c) => c.json(yardsale.section()))

// Estate & collection buyouts — sight-unseen whole collections with heir haggling
app.get('/api/estate-sales', (c) => c.json(estatebuyout.section()))

// ---------------------------------------------------------------------------
// The community scene — the local collector forum and its standing perks.
// ---------------------------------------------------------------------------
app.get('/api/forum', (c) => c.json(forum.section()))
app.post('/api/forum/pull', async (c) => {
  const body = await c.req.json<{ inventoryId: number }>()
  return c.json(forum.postPull(Number(body.inventoryId)), 200)
})
app.post('/api/forum/reply', (c) => c.json(forum.answerNewbie()))
app.post('/api/forum/guide', (c) => c.json(forum.writeGuide()))
app.post('/api/forum/groupbuy', async (c) => {
  const body = await c.req.json<{ cardId: string }>()
  return c.json(forum.startGroupBuy(String(body.cardId)), 200)
})
app.post('/api/estate-sales/offer/:id', async (c) => {
  const body = await c.req.json<{ offer: number }>().catch(() => ({ offer: 0 }))
  return c.json(estatebuyout.negotiate(Number(c.req.param('id')), Number(body.offer)))
})
app.post('/api/estate-sales/apologize/:id', (c) => c.json(estatebuyout.apologize(Number(c.req.param('id')))))
app.post('/api/estate-sales/buy/:id', (c) => c.json(estatebuyout.buy(Number(c.req.param('id')))))
app.post('/api/estate-sales/debug-spawn', (c) => c.json({ ok: estatebuyout.debugSpawnSale() }))
app.post('/api/yard/offer/:rowId', async (c) => {
  const body = await c.req.json<{ offer: number }>().catch(() => ({ offer: 0 }))
  return c.json(yardsale.negotiate(Number(c.req.param('rowId')), Number(body.offer) || 0))
})
app.post('/api/yard/buy/:rowId', (c) => c.json(yardsale.buyAtAsk(Number(c.req.param('rowId')))))
app.post('/api/yard/box/:saleId', (c) => c.json(yardsale.revealBox(Number(c.req.param('saleId')))))
app.post('/api/buylist/sell', async (c) => {
  const body = await c.req.json<{ shopId: number; inventoryIds: number[]; creditSplit: number; expectedCash?: number }>()
  return c.json(buylist.sell(Number(body.shopId), (body.inventoryIds ?? []).map(Number), Number(body.creditSplit ?? 0), body), 200)
})
app.post('/api/buylist/shelf/:shopId', async (c) => {
  const body = await c.req.json<{ rowId: number; payCredit: boolean }>()
  return c.json(buylist.buyFromShelf(Number(c.req.param('shopId')), Number(body.rowId), Boolean(body.payCredit)), 200)
})

app.get('/api/convention/summary', (c) => c.json(conventionSummary()))

// NPC live shopping — channels, live room, bids, drops, mystery reveals
app.get('/api/live', (c) => {
  const sid = Number(c.req.query('showId') || 0)
  return c.json(liveshopping.section(sid > 0 ? sid : undefined))
})
app.post('/api/live/snipe/:itemId', (c) => c.json(liveshopping.snipe(Number(c.req.param('itemId')))))
app.post('/api/live/bid/:itemId', async (c) => {
  const body = await c.req.json<{ amount: number }>().catch(() => ({ amount: 0 }))
  return c.json(liveshopping.bid(Number(c.req.param('itemId')), Number(body.amount) || 0))
})
app.post('/api/live/bin/:itemId', (c) => c.json(liveshopping.buyBin(Number(c.req.param('itemId')))))
app.post('/api/live/mystery/:itemId', (c) => c.json(liveshopping.buyMystery(Number(c.req.param('itemId')))))
app.post('/api/live/spot/:itemId/:spotId', (c) => c.json(liveshopping.claimTeamSpot(Number(c.req.param('itemId')), Number(c.req.param('spotId')))))
app.post('/api/live/ripship/:itemId/:choice', (c) => {
  const choice = c.req.param('choice') === 'ship' ? 'ship' : 'rip'
  return c.json(liveshopping.ripshipChoose(Number(c.req.param('itemId')), choice))
})

// ---------------------------------------------------------------------------
// Net worth history (Phase 3) — weekly chart on the dashboard
// ---------------------------------------------------------------------------

app.get('/api/networth/history', (c) => c.json(netWorthSeries()))

app.get('/api/collector/stats', (c) => c.json(collectorStats()))
app.get('/api/portfolio', (c) => c.json(portfolio()))

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
  // The month grid pages either side of today, so the window is a query param
  // (clamped — these expand weekly slots, they aren't stored rows).
  const weeks = Math.min(Math.max(Number(c.req.query('weeks') ?? 3) || 3, 1), 16)
  const events = schedule.upcoming(weeks)
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

// $1 sudden death runs on its own 2.5s heartbeat — 6–10 second lots need NPC
// snipes and hard hammers resolved in real time, not on the ~20s game tick.
setInterval(() => {
  try { liveshopping.sdMicroTick() } catch (e) { console.error('[live] sd micro-tick:', e instanceof Error ? e.message : e) }
}, 2_500).unref()

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

// Case breaks — sell rip spots on the channel; pulls go to spot-holders
app.get('/api/stream/break', (c) => c.json(breaks.breakForStream(streaming.liveStream()?.id ?? 0)))
app.post('/api/stream/breaks', async (c) => {
  const body = await c.req.json<{ productId: string; spots: number; spotPrice?: number | null }>()
  return c.json(breaks.createBreak(body.productId, body.spots, body.spotPrice ?? null))
})
app.post('/api/stream/breaks/:id/cancel', (c) => c.json(breaks.cancelBreak(Number(c.req.param('id')))))
app.post('/api/stream/breaks/:id/buy', async (c) => {
  const body = await c.req.json<{ team: string }>()
  return c.json(breaks.buySpot(Number(c.req.param('id')), body.team))
})
app.post('/api/stream/break/rip', (c) => c.json(breaks.ripBreak()))

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
  const body = await c.req.json<{ qty?: number; cond?: 'fresh' | 'worn' }>().catch(() => ({ qty: 1 }) as { qty?: number; cond?: 'fresh' | 'worn' })
  // Futures-desk sale: condition-priced (fresh premium / worn discount) and
  // escrow-aware — loan collateral is untouchable.
  const r = sealedfutures.sellSealed(c.req.param('productId'), body.qty ?? 1, body.cond)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/sealed/refresh/:productId', async (c) => {
  const r = await sealed.refreshSealedPrice(c.req.param('productId'))
  return c.json({ ok: r === 'pricecharting', result: r })
})

// ------------------------- Sealed futures desk -------------------------

app.get('/api/sealed/futures', (c) => c.json(sealedfutures.section()))

app.post('/api/sealed/sell-cond/:productId', async (c) => {
  const body = await c.req.json<{ qty?: number; cond?: 'fresh' | 'worn' }>().catch(() => ({ qty: 1 }) as { qty?: number; cond?: 'fresh' | 'worn' })
  const r = sealedfutures.sellSealed(c.req.param('productId'), body.qty ?? 1, body.cond)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/sealed/rewrap/:productId', async (c) => {
  const body = await c.req.json<{ qty?: number }>().catch(() => ({ qty: 1 }))
  const r = sealedfutures.rewrap(c.req.param('productId'), body.qty ?? 1)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/sealed/dump/:productId', async (c) => {
  const body = await c.req.json<{ qty?: number }>().catch(() => ({ qty: 1 }))
  const r = sealedfutures.dumpWorn(c.req.param('productId'), body.qty ?? 1)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/sealed/loans', async (c) => {
  const body = await c.req.json<{ productId: string; qty?: number; amount?: number }>()
  const r = sealedfutures.borrow(body.productId, body.qty ?? 1, body.amount)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/sealed/loans/:id/redeem', async (c) => {
  const body = await c.req.json<{ units?: number }>().catch(() => ({ units: 1 }))
  const r = sealedfutures.redeem(Number(c.req.param('id')), body.units ?? 1)
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/sealed/loans/:id/settle', (c) => {
  const r = sealedfutures.settle(Number(c.req.param('id')))
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/sealed/loans/:id/forfeit', (c) => {
  const r = sealedfutures.forfeit(Number(c.req.param('id')))
  return c.json(r, r.ok ? 200 : 400)
})

app.post('/api/sealed/loans/:id/collateral', async (c) => {
  const body = await c.req.json<{ productId: string; qty?: number }>()
  const r = sealedfutures.addCollateral(Number(c.req.param('id')), body.productId, body.qty ?? 1)
  return c.json(r, r.ok ? 200 : 400)
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
app.get('/api/grading/rush', (c) => c.json(psarush.section()))

// Sub-stats — your imperfect eye reads a raw copy's centering/whitening/corners
// ---------------------------------------------------------------------------
// Flea markets — weekend junk-bin hunts (flat-price bins, NPC pickers, FOMO)
// ---------------------------------------------------------------------------

app.get('/api/flea', (c) => c.json(fleamarket.section()))

// TODAY panel — everything that rolls at the next UTC midnight.
app.get('/api/today', (c) => c.json(today.todayRolls()))
app.post('/api/flea/dig/:binId', (c) => c.json(fleamarket.dig(Number(c.req.param('binId')))))
app.post('/api/flea/debug-spawn', (c) => { fleamarket.debugSpawnMarket(); return c.json({ ok: true }) })

app.post('/api/substats/inspect/:inventoryId', (c) => {
  const r = substats.inspect(Number(c.req.param('inventoryId')))
  // Note: EyeRead also carries an `error` (the ± read noise), so the failure
  // shape is detected by the ABSENCE of stats, not the presence of error.
  if (!('stats' in r)) return c.json({ error_msg: (r as { error: string }).error }, 400)
  return c.json(r)
})

// CONDITION WARS — eye skill + published-read comp comparable lines. Comps are
// the market's recent sales of this card's condition band, drifted ±8% by the
// hidden copy quality when the copy's read is public.
app.get('/api/substats/eye', (c) => {
  const skill = Math.round(substats.eyeSkillPublic() * 100)
  const looks = Number(getMeta('eye:looks') ?? '0')
  const graded = (db.prepare('SELECT COUNT(*) AS n FROM inventory WHERE graded_grade IS NOT NULL').get() as { n: number }).n
  // Points of eye progress: each look is 1, each grade 2, mastery at 90.
  const progress = Math.min(90, looks + 2 * graded)
  const remaining = 90 - progress
  return c.json({ skill, looks, graded, remaining, hint: `~${remaining} more point${remaining === 1 ? '' : 's'} of practice sharpens the eye — every grade result teaches double` })
})

app.get('/api/substats/comps/:inventoryId', (c) => {
  const id = Number(c.req.param('inventoryId'))
  const inv = db.prepare('SELECT id, card_id, variant, condition, graded_grade, quantity, fake_revealed, auth_status FROM inventory WHERE id = ?').get(id) as { id: number; card_id: string; variant: string; condition: string; graded_grade: string | null; quantity: number; fake_revealed: number; auth_status: string | null } | undefined
  if (!inv || inv.graded_grade || (inv.quantity ?? 1) !== 1) return c.json({ error: 'Comps are for raw single copies' }, 400)
  const known = substats.readFor(id) != null
  const band = market.valueOf(inv.card_id, inv.variant || 'normal', (inv.condition as market.Condition) || 'NM')
  const r = market.resolvePriceCopy(inv.card_id, inv.variant || 'normal', (inv.condition as market.Condition) || 'NM', id, known)
  const read = substats.readFor(id)
  // Comparable "sales": the card's own low/high window drifted by copy quality —
  // an honest stand-in for the scattered real comp data a price app would show.
  const low = r.low ?? (r.usd != null ? Math.round(r.usd * 0.85 * 100) / 100 : null)
  const high = r.high ?? (r.usd != null ? Math.round(r.usd * 1.2 * 100) / 100 : null)
  return c.json({
    band: round2(band),
    copyValue: r.usd,
    copyKnown: known,
    copyFactor: r.copyFactor,
    low,
    high,
    read,
  })
})

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

// ---------------------------------------------------------------------------
// Wishlist agents — standing auto-buys with a per-order cash cap.
// ---------------------------------------------------------------------------
app.get('/api/wishlist/agents', (c) => c.json(wishlistAgents.section()))
app.post('/api/wishlist/agents/cap', async (c) => {
  const body = await c.req.json<{ cap: number }>()
  return c.json(wishlistAgents.setOrderCap(Number(body.cap)))
})
app.post('/api/wishlist/agents/run', (c) => c.json(wishlistAgents.runAgents()))
app.post('/api/wishlist/agents/set', async (c) => {
  const body = await c.req.json<{ cardId: string; enabled: boolean; maxPrice?: number | null; condition?: string }>()
  return c.json(wishlistAgents.setAgent(String(body.cardId), !!body.enabled, body.maxPrice != null ? Number(body.maxPrice) : null, body.condition ?? 'NM'))
})

app.get('/api/wishlist', (c) => {
  const rows = db.prepare(`
    SELECT w.card_id, w.target_price, w.added_at, w.agent_enabled, w.agent_max_price, w.agent_condition, c.name, c.image_small, c.rarity, s.name AS set_name
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
  const body = await c.req.json<{ pricechartingToken?: string; ebayClientId?: string; ebayClientSecret?: string; eurUsdRate?: number }>()
  let fxAccepted = true
  if (body.eurUsdRate !== undefined) {
    const v = Number(body.eurUsdRate)
    if (!market.setEurUsdRate(v)) fxAccepted = false // invalid — keep the previous rate
  }
  if (body.pricechartingToken !== undefined) {
    setSetting('pricechartingToken', body.pricechartingToken.trim())
    pricesources.resetPcAuthFailure() // a fresh token clears any earlier "rejected token" abort
  }
  if (body.ebayClientId !== undefined) {
    setSetting('ebayClientId', body.ebayClientId.trim())
    pricesources.resetEbayAuthFailure() // fresh credentials clear any earlier rejection
  }
  if (body.ebayClientSecret !== undefined) {
    setSetting('ebayClientSecret', body.ebayClientSecret.trim())
    pricesources.resetEbayAuthFailure()
  }
  const cfg = pricesources.sourcesConfigured()
  if (body.pricechartingToken !== undefined || body.ebayClientId !== undefined || body.ebayClientSecret !== undefined) {
    // Credentials changed — re-check unpriced cards against the new source(s).
    if (cfg.pricecharting || cfg.ebay || cfg.tcgcsv) pricesources.startPriceBackfill(true)
  }
  // A PriceCharting token also unlocks REAL sealed prices — kick that backfill too.
  if (cfg.pricecharting) sealed.startSealedBackfill()
  return c.json({
    ok: fxAccepted,
    sources: cfg,
    eurUsdRate: market.eurUsdRate(),
    ...(fxAccepted ? {} : { error: 'EUR→USD rate must be a number between 0.5 and 3 — the previous rate was kept' }),
  })
})

app.post('/api/prices/backfill', (c) => {
  // Always 200 — a "not started" reply carries its reason in the body for the Settings UI.
  return c.json(pricesources.startPriceBackfill(true))
})

app.get('/api/prices/backfill', (c) => c.json(pricesources.getBackfillProgress()))

// Manual trigger for the free TCGplayer mirror (no key, no quota — tcgcsv.com).
app.post('/api/prices/tcgcsv-sync', async (c) => {
  const r = await tcgcsv.syncAllTcgcsv(true)
  return c.json(r)
})

// Daily quota budget + simulated-market status for the Settings UI.
app.get('/api/prices/quota', (c) => c.json(market.refreshSimulatedMarket()))

app.get('/api/settings', (c) => {
  return c.json({
    apiKeySet: Boolean(getSetting('pokemontcgApiKey')),
    pricechartingTokenSet: Boolean(pricesources.pricechartingToken()),
    ebayClientIdSet: Boolean(pricesources.ebayConfig()),
    eurUsdRate: market.eurUsdRate(),
    backfill: pricesources.getBackfillProgress(),
    setsSyncedAt: getMeta('setsLastSyncedAt'),
    cardsSyncedAt: getMeta('cardsLastSyncedAt'),
    lastSnapshotAt: getMeta('lastSnapshotAt'),
    cardCount: (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n,
    priceRecordCount: (db.prepare('SELECT COUNT(*) AS n FROM price_records').get() as { n: number }).n,
    unpricedCount: pricesources.countUnpriced(),
    delta: sync.catalogDeltaStatus(),
    quota: market.refreshSimulatedMarket().quota,
    tcgcsv: tcgcsv.tcgcsvStatus(),
    benchmark: benchmarkStatus(),
    dataSources: [
      { name: 'pokemontcg.io API v2', role: 'Card identity, sets, images, TCGplayer & Cardmarket prices', url: 'https://pokemontcg.io' },
      { name: 'TCGplayer', role: 'USD market prices (via pokemontcg.io)', url: 'https://tcgplayer.com' },
      { name: 'PriceCharting', role: pricesources.pricechartingToken()
        ? 'Raw card prices + graded comps + REAL sealed product prices (API token set — sealed backfill pricing the catalog at ~1/sec)'
        : 'Raw card prices + graded comps + REAL sealed product prices (optional API token — NOT set, sealed prices are model estimates until you add one in Settings)', url: 'https://pricecharting.com' },
      { name: 'eBay', role: 'Median active fixed-price listings as a second fallback (optional API credentials)', url: 'https://ebay.com' },
      { name: 'TCGcsv (tcgcsv.com)', role: 'Free daily mirror of TCGplayer prices — used to price sets the main API has no data for yet', url: 'https://tcgcsv.com' },
      { name: 'Cardmarket', role: 'EUR prices & sale averages (via pokemontcg.io)', url: 'https://cardmarket.com' },
    ],
  })
})

app.post('/api/debug/reset-save', (c) => {
  // The wipe (child-before-parent, one transaction) lives in savereset.ts so
  // it can be regression-tested against a trap save. A failure now surfaces
  // as the exact statement that broke instead of a silent rollback — the old
  // endpoint 500ed with a bare FK error and the client had nothing to show.
  try {
    savereset.resetSave()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[reset-save] ${msg}`)
    return c.json({ error: `${msg} — nothing was changed` }, 500)
  }
  logActivity('system', 'Save reset. Fresh start with $1,000.')
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Rolling save backups — one snapshot per game day (last 3 kept), listed and
// restorable from Settings. A restore copies a snapshot over the live save
// via sqlite's online backup API (no locks, no restart) after parking a
// pre-restore safety copy of the current world.
// ---------------------------------------------------------------------------

app.get('/api/saves/backups', (c) => {
  return c.json({
    backups: savebackup.listBackups(),
    daily: savebackup.saveBackupStatus(),
  })
})

app.post('/api/saves/backup', async (c) => {
  const row = await savebackup.snapshot('manual')
  if (!row) return c.json({ error: 'Snapshot failed — see the server log' }, 500)
  return c.json({ ok: true, backup: row })
})

app.post('/api/saves/restore', async (c) => {
  const body = await c.req.json<{ file?: string }>().catch(() => ({}) as { file?: string })
  if (!body?.file) return c.json({ error: 'No snapshot named' }, 400)
  const r = await savebackup.restoreBackup(String(body.file))
  if (!r.ok) return c.json({ error: r.error || 'Restore failed' }, 400)
  return c.json({ ok: true, safety: r.safety })
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

// Window-host watchdog: when packaged behind TCG-Life.exe (the WebView2 host),
// exit as soon as the parent window dies so no orphaned server lingers with
// the save locked. In dev (browser mode) TCGLIFE_PARENT_PID is unset — no-op.
if (process.env.TCGLIFE_PARENT_PID) {
  const parentPid = Number(process.env.TCGLIFE_PARENT_PID)
  setInterval(() => {
    try {
      process.kill(parentPid, 0)
    } catch {
      console.log('[server] parent window gone — exiting')
      process.exit(0)
    }
  }, 4000).unref()
}

ensureGameState()
migratePerDayCostsTo12hClock()
ensureDefaultBinder()
repairPhantomRarities()
ensurePackCatalog()
migratePullTableRarities()
backfillAcquiredRefs()
backfillNetWorthHistory()
streaming.recoverOrphanStreams()
streaming.backfillFollowersGain()
sealed.ensureSealedTable()
sealed.startSealedBackfill()
// Real pack wrapper art: match TCGplayer's sealed catalog to our generated
// pack_products (one fetch per unmatched set — after that, only new sets).
setTimeout(() => {
  tcgcsv.syncPackArt()
    .then((r) => { if (r.matched > 0) console.log(`[tcgcsv] pack art: ${r.matched} product image(s) matched`) })
    .catch((e) => console.warn('[tcgcsv] pack art sync failed:', e instanceof Error ? e.message : e))
}, 22_000)

// Refresh this week's net-worth point whenever the dashboard's live totals change.
function maybeRecordNetWorthSnapshot() {
  const last = getMeta('lastNetworthSnapAt')
  if (last && Date.now() - new Date(last).getTime() < 5 * 60_000) return
  recordSnapshot()
  setMeta('lastNetworthSnapAt', nowIso())
}

// Price history, real quotes and the simulated market all advance once per
// GAME DAY now, driven by market.tick → services/pricetick.ts. The old jobs
// here ran on 24-hour wall-clock gaps, so a 12-hour game day could turn twice
// with no quote moving at all. This boot kick just seeds the first day.
setTimeout(() => market.tick(), 4_000)

// Owned/wishlist re-pricing lives in services/pricetick.ts now: it runs on
// the first tick of each game day (and retries after 30 minutes if the
// upstream is down), so your portfolio is never a day stale.

// The S&P 500 close cache: tops up twice a day once it covers the save span,
// retries every five minutes after a failed fetch (boot-time outages catch up
// without hammering — see services/benchmark.ts). The portfolio's benchmark
// chart and what-if panel read this cache; real closes first, the labeled
// ~10%/yr model when the feed is dry.
setTimeout(() => refreshBenchmarkCache().then((r) => console.log(String.raw`[benchmark] boot refresh: ${r.fetched} closes, covered=${r.covered}`)).catch((e) => console.error(String.raw`[benchmark] boot refresh failed:`, e instanceof Error ? e.message : e)), 14_000)
setInterval(() => refreshBenchmarkCache().catch((e) => console.error('[benchmark] refresh failed:', e instanceof Error ? e.message : e)), 6 * 3600_000)

// Weekly catalog delta-sync: pull new sets + cards from pokemontcg.io so the
// catalog stays current as releases drop. The weekly check runs shortly after
// boot; the job itself skips if a run happened recently, so restarts never
// double-fire, and it catches up on the first boot after a week away.
async function maybeWeeklyCatalogDelta() {
  const last = getMeta('catalogDeltaLastRunAt')
  if (last && Date.now() - new Date(last).getTime() < 7 * 24 * 3600_000) return
  try {
    await sync.runCatalogDelta()
  } catch (err) {
    console.error('[sync] weekly catalog delta failed (will retry next interval):', err instanceof Error ? err.message : err)
  }
}
setTimeout(maybeWeeklyCatalogDelta, 30_000)
setInterval(maybeWeeklyCatalogDelta, 24 * 3600_000)

// External price backfill: re-price unpriced cards from the free TCGplayer
// mirror, then PriceCharting/eBay within their daily quotas — shortly after
// boot. When the quotas are out, unpriced cards get clearly-labeled simulated
// market prices until the quotas reset.
setTimeout(() => pricesources.autoStartPriceBackfill(), 12_000)

// The simulated market (the fallback tier for cards with no live quote) drifts
// once per game day from services/pricetick.ts — real rows always outrank
// simulated ones in resolvePrice, so a fresh day never blanks the market.

sync.startSyncLoop()

// ---------------------------------------------------------------------------
// Packaged/single-exe mode: when a built SPA (dist/) sits next to the app root,
// serve it from this process so the game is one double-click. In dev, Vite
// owns the frontend and this stays API-only (proxied at :5199).
// ---------------------------------------------------------------------------
// SEA-safe app root: the folder the packaged exe lives in — dist/, data/ and
// schema.sql all sit beside it (release/ and the installer's {app} both).
// In dev (tsx), __filename is server/index.ts whose folder has no dist/, so
// packaged mode stays off and Vite owns the frontend (proxied at :5199).
const APP_ROOT = process.env.TCGLIFE_HOME
  || (typeof __filename !== 'undefined'
    ? path.dirname(__filename)
    : (process.argv[1] && fs.existsSync(process.argv[1]) ? path.dirname(path.resolve(process.argv[1])) : process.cwd()))
const DIST_DIR = path.join(APP_ROOT, 'dist')
const INDEX_HTML = path.join(DIST_DIR, 'index.html')
const HAS_SPA = fs.existsSync(INDEX_HTML)

if (HAS_SPA) {
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  }
  app.get('*', (c) => {
    const url = new URL(c.req.url)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const file = path.join(DIST_DIR, rel)
    if (file.startsWith(DIST_DIR) && rel && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return c.body(fs.readFileSync(file), 200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' })
    }
    return c.body(fs.readFileSync(INDEX_HTML), 200, { 'Content-Type': 'text/html; charset=utf-8' })
  })
}

function openBrowser(url: string) {
  if (process.env.TCGLIFE_NO_OPEN) return
  import('node:child_process').then(({ exec }) => {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`
    exec(cmd, { shell: process.platform === 'win32' ? undefined : '/bin/bash' }, () => {})
  })
}

serve({ fetch: app.fetch, port: PORT }, (info: { port: number }) => {
  console.log(`[server] TCG Life API listening on http://localhost:${info.port} (v${APP_VERSION})`)
  if (HAS_SPA) {
    const url = `http://localhost:${info.port}/`
    console.log(`[server] Game UI: ${url}`)
    // Auto-open the browser in packaged mode.
    openBrowser(url)
  }
}).on('error', (err: NodeJS.ErrnoException) => {
  // Double-clicking the exe twice (or dev API + exe at once): the port is
  // already a running TCG Life — just open the browser to it.
  if (err.code === 'EADDRINUSE') {
    console.log(`[server] Port ${PORT} busy — another TCG Life is already running; opening it.`)
    if (HAS_SPA) openBrowser(`http://localhost:${PORT}/`)
    setTimeout(() => process.exit(0), 800)
  } else throw err
})
