import { db, nowIso, logActivity } from '../lib/db'
import { resolvePrice, round2 } from './market'
import { weekKey } from './pnl'

// ---------------------------------------------------------------------------
// Polish — the two dashboard luxuries: wishlist price alerts and the weekly
// market-mover digest.
// ---------------------------------------------------------------------------

// Migrations: alert target on existing wishlists.
try { db.exec(`ALTER TABLE wishlist ADD COLUMN target_price REAL`) } catch { /* exists */ }

// ---------------------------------------------------------------------------
// Wishlist price alerts
// ---------------------------------------------------------------------------

export function setAlert(cardId: string, target: number | null) {
  const row = db.prepare(`SELECT 1 FROM wishlist WHERE card_id = ?`).get(cardId)
  if (!row) return { ok: false as const, error: 'Card is not on your wishlist' }
  if (target != null && !(target > 0)) return { ok: false as const, error: 'Target must be a positive price' }
  db.prepare(`UPDATE wishlist SET target_price = ? WHERE card_id = ?`).run(target, cardId)
  if (target) {
    const p = resolvePrice(cardId)
    logActivity('alert', `Alert set: ${cardName(cardId)} at $${target.toFixed(2)} (now ${p.usd ? '$' + p.usd.toFixed(2) : 'unpriced'})`)
  } else {
    logActivity('alert', `Alert cleared for ${cardName(cardId)}`)
  }
  return { ok: true as const, target }
}

function cardName(cardId: string): string {
  return (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(cardId) as { name: string } | undefined)?.name ?? cardId
}

/** Fire any wishlist alerts whose target has been reached. Runs on the market tick. */
export function checkAlerts() {
  const rows = db
    .prepare(
      `SELECT w.card_id, w.target_price, c.name
       FROM wishlist w JOIN cards c ON c.id = w.card_id
       WHERE w.target_price IS NOT NULL`,
    )
    .all() as { card_id: string; target_price: number; name: string }[]
  if (rows.length === 0) return
  const today = new Date().toISOString().slice(0, 10)
  for (const r of rows) {
    const p = resolvePrice(r.card_id)
    if (p.usd == null) continue
    if (p.usd > r.target_price) continue
    // Once per day per card, and only while it stays under target.
    const key = `alertFired:${r.card_id}:${today}`
    if (db.prepare(`SELECT 1 FROM meta WHERE key = ?`).get(key)) continue
    db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, nowIso())
    logActivity('alert', `🔔 PRICE ALERT: ${r.name} hit your target — $${p.usd.toFixed(2)} (target $${r.target_price.toFixed(2)}).`, 0)
  }
}

// ---------------------------------------------------------------------------
// Weekly market-mover digest
// ---------------------------------------------------------------------------

type Mover = { cardId: string; name: string; setName: string; image: string | null; from: number; to: number; changePct: number }

/** Biggest movers over the trailing 7 days, from stored price history. */
function computeMovers(limit = 5): { gainers: Mover[]; losers: Mover[]; sampled: number } {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  // Cards with a price both a week ago and now.
  const rows = db
    .prepare(
      `SELECT pr.card_id, c.name, s.name AS set_name, c.image_small,
              (SELECT market FROM price_records p2 WHERE p2.card_id = pr.card_id AND p2.market IS NOT NULL AND p2.kind != 'simulated' AND p2.retrieved_at <= ? ORDER BY p2.retrieved_at DESC LIMIT 1) AS old_price,
              (SELECT market FROM price_records p2 WHERE p2.card_id = pr.card_id AND p2.market IS NOT NULL AND p2.kind != 'simulated' ORDER BY p2.retrieved_at DESC LIMIT 1) AS new_price
       FROM price_records pr JOIN cards c ON c.id = pr.card_id JOIN sets s ON s.id = c.set_id
       WHERE pr.market IS NOT NULL
       GROUP BY pr.card_id
       HAVING old_price IS NOT NULL AND new_price IS NOT NULL AND old_price > 0.5
       LIMIT 4000`,
    )
    .all(weekAgo) as { card_id: string; name: string; set_name: string; image_small: string | null; old_price: number; new_price: number }[]
  const movers = rows
    .map((r) => ({
      cardId: r.card_id,
      name: r.name,
      setName: r.set_name,
      image: r.image_small,
      from: round2(r.old_price),
      to: round2(r.new_price),
      changePct: round2(r.new_price / r.old_price - 1),
    }))
    .filter((m) => Math.abs(m.changePct) > 0.03 && m.to > 0.5)
  const byChange = movers.sort((a, b) => b.changePct - a.changePct)
  return {
    gainers: byChange.slice(0, limit),
    losers: byChange.slice(-limit).reverse(),
    sampled: rows.length,
  }
}

function buildDigest(): { week: string; gainers: Mover[]; losers: Mover[]; sampled: number } {
  const week = weekKey()
  const { gainers, losers, sampled } = computeMovers()
  return { week, gainers, losers, sampled }
}

/** Post this week's digest once. Called on the market tick; cheap no-op after the first call of the week. */
export function digestTick() {
  const week = weekKey()
  if (db.prepare(`SELECT 1 FROM market_digests WHERE week = ?`).get(week)) return
  const digest = buildDigest()
  db.prepare(`INSERT OR IGNORE INTO market_digests (week, body, posted_at) VALUES (?, ?, ?)`)
    .run(week, JSON.stringify(digest), nowIso())
  const top = digest.gainers[0]
  const worst = digest.losers[0]
  const summary = top && worst
    ? `Top mover: ${top.name} ${top.changePct > 0 ? '+' : ''}${Math.round(top.changePct * 100)}%. Biggest drop: ${worst.name} ${Math.round(worst.changePct * 100)}%.`
    : 'Not enough price history for a real digest yet.'
  logActivity('market', `📰 Weekly market digest — ${digest.sampled} cards sampled. ${summary}`)
}

export function currentDigest() {
  const week = weekKey()
  const row = db.prepare(`SELECT * FROM market_digests WHERE week = ?`).get(week) as { week: string; body: string; posted_at: string } | undefined
  if (row) {
    const body = JSON.parse(row.body)
    return { ...body, week: row.week, postedAt: row.posted_at }
  }
  // No digest yet this week: compute one on the fly (without persisting).
  const digest = buildDigest()
  return { ...digest, postedAt: null }
}

/** Backfill earlier weeks' digests from history so the Home card has context. */
export function digestHistory(limit = 4) {
  const rows = db.prepare(`SELECT * FROM market_digests ORDER BY week DESC LIMIT ?`).all(limit) as { week: string; body: string; posted_at: string }[]
  return rows.map((r) => ({ week: r.week, postedAt: r.posted_at, ...JSON.parse(r.body) }))
}

// ---------------------------------------------------------------------------
// Sunday business digest — one feed entry each week that rolls the whole
// business into a single read: the flagship's books, how every chain store
// did, and the week's card shows. The Monday-morning email, sent by you,
// to you. Reviews the week that just closed; posts once, then keys off.
// ---------------------------------------------------------------------------

function ledgerSum(week: string, where: string, ...args: (string | number)[]): number {
  const row = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM shop_ledger WHERE week = ? AND ${where}`).get(week, ...args) as { t: number }
  return round2(row.t)
}

function buildBusinessDigest(week: string) {
  const weekStart = new Date(week + 'T00:00:00Z').getTime()
  const weekEnd = weekStart + 7 * 86_400_000

  // Flagship (main location only — satellite rows book under 'satellite:N').
  const shopRow = db.prepare(`SELECT name FROM shop WHERE id = 1`).get() as { name: string } | undefined
  const mainRevenue = round2(ledgerSum(week, "location = 'main' AND line IN ('cases','bulk','bags')"))
  const mainCosts = round2(-ledgerSum(week, "location = 'main' AND line IN ('rent','mortgage','payroll','interest','overhead')"))
  const shop = shopRow ? { name: shopRow.name, revenue: mainRevenue, costs: mainCosts, net: round2(mainRevenue - mainCosts) } : null

  // The chain, per store.
  const stores = (db.prepare(`SELECT id, name FROM franchise ORDER BY id`).all() as { id: number; name: string }[]).map((f) => {
    const revenue = ledgerSum(week, "location = ? AND line = 'cases'", `satellite:${f.id}`)
    const costs = round2(-ledgerSum(week, "location = ? AND line IN ('rent','payroll','overhead')", `satellite:${f.id}`))
    return { name: f.name, revenue, net: round2(revenue - costs) }
  })
  const chain = stores.length > 0 ? { stores, revenue: round2(stores.reduce((a, s) => a + s.revenue, 0)), net: round2(stores.reduce((a, s) => a + s.net, 0)) } : null

  // Card shows that closed during the reviewed week.
  const showRows = db
    .prepare(`SELECT venue, walkins, gate_revenue, table_revenue, refund, rep_delta, notes FROM card_shows WHERE resolved = 1 AND closes_at >= ? AND closes_at < ?`)
    .all(new Date(weekStart).toISOString(), new Date(weekEnd).toISOString()) as { venue: string; walkins: number | null; gate_revenue: number | null; table_revenue: number | null; refund: number | null; rep_delta: number | null; notes: string | null }[]
  const shows = showRows.length > 0
    ? {
        count: showRows.length,
        walkins: showRows.reduce((a, s) => a + (s.walkins ?? 0), 0),
        net: round2(showRows.reduce((a, s) => a + (s.gate_revenue ?? 0) + (s.table_revenue ?? 0) - (s.refund ?? 0), 0)),
        rep: showRows.reduce((a, s) => a + (s.rep_delta ?? 0), 0),
      }
    : null

  // What safety cost that week: actual ledger drafts for insurance premiums
  // (overhead), storage rent + rider (cases line notes), booked by the tick.
  const protection = round2(
    -ledgerSum(week, "line = 'overhead' AND note LIKE '%insurance premium%'")
    - ledgerSum(week, "line = 'cases' AND (note LIKE '%Storage rent%' OR note LIKE '%Vault rider%')"),
  )

  return { week, shop, chain, shows, protection }
}

/** Post the Sunday business digest once per week. Cheap no-op after the first call. */
export function businessDigestTick() {
  const thisWeek = weekKey()
  const key = `businessDigest:${thisWeek}`
  if (db.prepare(`SELECT 1 FROM meta WHERE key = ?`).get(key)) return
  const lastWeek = weekKey(Date.now() - 7 * 86_400_000)
  const digest = buildBusinessDigest(lastWeek)

  // A pure collector with no business and no shows gets no entry — silence
  // beats a weekly "nothing happened" email.
  if (!digest.shop && !digest.chain && !digest.shows && !digest.protection) {
    db.prepare(`INSERT INTO meta (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key)
    return
  }

  const label = new Date(lastWeek + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const usd = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(2)}`
  const parts: string[] = []
  if (digest.shop) parts.push(`🏪 ${digest.shop.name} took ${usd(digest.shop.revenue)} revenue → ${usd(digest.shop.net)} net`)
  if (digest.chain) for (const s of digest.chain.stores) parts.push(`🛰 ${s.name}: ${usd(s.revenue)} revenue → ${usd(s.net)}`)
  if (digest.shows) parts.push(`🏟 ${digest.shows.count} show${digest.shows.count === 1 ? '' : 's'} cleared ${usd(digest.shows.net)} across ${digest.shows.walkins} walk-ins (rep ${digest.shows.rep >= 0 ? '+' : ''}${digest.shows.rep})`)
  if (digest.protection) parts.push(`🛡 protection cost ${usd(-digest.protection)} (premiums, storage, the vault)`)
  const total = round2((digest.shop?.net ?? 0) + (digest.chain?.net ?? 0) + (digest.shows?.net ?? 0) - (digest.protection ?? 0))
  logActivity('digest', `📋 Business digest — week of ${label}: ${parts.join(' · ')}. All told: ${usd(total)} for the week.`)
  db.prepare(`INSERT INTO meta (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key)
}
