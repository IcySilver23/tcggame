import { db, nowIso } from '../lib/db'
import { valueOf, gradedPriceOf, round2, CONDITION_MULT, type Condition } from './market'
import { priceOf as sealedPriceOf } from './sealed'

// ---------------------------------------------------------------------------
// Net worth history — a weekly chart of cash + holdings on the Home dashboard.
// Live snapshots are recorded as the game runs; past weeks are reconstructed
// once from the activity log's signed cash amounts plus stored price history.
// ---------------------------------------------------------------------------

const WEEK_MS = 7 * 24 * 3600_000

export function weekStart(iso: string): string {
  const d = new Date(iso)
  const day = (d.getUTCDay() + 6) % 7 // Monday = 0
  const w = new Date(d)
  w.setUTCDate(d.getUTCDate() - day)
  return w.toISOString().slice(0, 10)
}

type Totals = { cash: number; collection: number; listed: number; sealed: number; netWorth: number }

/** Live totals, mirroring /api/state's math. */
export function currentTotals(): Totals {
  const cash = (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash

  const inv = db
    .prepare(
      `SELECT card_id, variant, condition, quantity, graded_grade, status, listing_price
       FROM inventory WHERE status != 'sold'`,
    )
    .all() as { card_id: string; variant: string; condition: string; quantity: number; graded_grade: string | null; status: string; listing_price: number | null }[]

  let collection = 0
  let listed = 0
  for (const r of inv) {
    const v = r.graded_grade
      ? gradedPriceOf(r.card_id, r.graded_grade).usd ?? 0
      : valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
    const total = v * r.quantity
    if (r.status === 'listed') listed += r.listing_price ?? total
    else collection += total // includes rows at the grader (still raw value)
  }

  let sealed = 0
  const sealedRows = db.prepare(`SELECT product_id, quantity, cost FROM sealed_inventory`).all() as { product_id: string; quantity: number; cost: number }[]
  for (const r of sealedRows) sealed += r.quantity * (sealedPriceOf(r.product_id).market || r.cost) // market value — sealed appreciates

  const debt = (db.prepare(`SELECT COALESCE(SUM(balance),0) AS n FROM loans WHERE status = 'active'`).get() as { n: number }).n
  return { cash: round2(cash), collection: round2(collection), listed: round2(listed), sealed: round2(sealed), netWorth: round2(cash + collection + listed + sealed - debt) }
}

/** Upsert this week's snapshot with live values. */
export function recordSnapshot(): void {
  const t = currentTotals()
  const week = weekStart(nowIso())
  db.prepare(
    `INSERT INTO networth_history (week, cash, collection, listed, sealed, net_worth, snapshotted_at)
     VALUES (@week, @cash, @collection, @listed, @sealed, @netWorth, @at)
     ON CONFLICT(week) DO UPDATE SET
       cash = @cash, collection = @collection, listed = @listed, sealed = @sealed,
       net_worth = @netWorth, snapshotted_at = @at`,
  ).run({ week, cash: t.cash, collection: t.collection, listed: t.listed, sealed: t.sealed, netWorth: t.netWorth, at: nowIso() })
}

// ---------------------------------------------------------------------------
// Backfill — reconstruct past weeks once, from the honest records we keep.
// ---------------------------------------------------------------------------

function reconstructWeeks(): void {
  // Cash trail: starting stake + every signed activity amount.
  const rows = db
    .prepare(`SELECT amount, created_at FROM activity_log WHERE amount IS NOT NULL ORDER BY id ASC`)
    .all() as { amount: number; created_at: string }[]
  if (rows.length === 0) return
  const startedAt = rows[0].created_at
  const firstWeek = weekStart(startedAt)

  // Past completed-week boundaries. A boundary at Monday 00:00Z closes the
  // PREVIOUS week — its label is that earlier Monday, not the boundary date.
  const weeks: { week: string; cut: string }[] = []
  const first = new Date(firstWeek + 'T00:00:00Z').getTime()
  for (let t = first + WEEK_MS; t < Date.now(); t += WEEK_MS) {
    weeks.push({ week: new Date(t - WEEK_MS).toISOString().slice(0, 10), cut: new Date(t).toISOString() })
  }
  if (weeks.length === 0) return

  const holdings = db
    .prepare(
      `SELECT i.id, i.card_id, i.variant, i.condition, i.quantity, i.graded_grade, i.acquired_at, i.cost_basis,
              (SELECT sh.sold_at FROM sale_history sh WHERE sh.inventory_id = i.id AND sh.sold_at IS NOT NULL ORDER BY sh.id DESC LIMIT 1) AS sold_at
       FROM inventory i`,
    )
    .all() as { id: number; card_id: string; variant: string; condition: string; quantity: number; graded_grade: string | null; acquired_at: string; cost_basis: number; sold_at: string | null }[]
  const sealedRows = db
    .prepare(`SELECT quantity, cost, acquired_at FROM sealed_inventory`)
    .all() as { quantity: number; cost: number; acquired_at: string }[]

  // Historical raw price of a card at a cut time, from stored price history.
  const priceAt = (cardId: string, cut: string): number | null => {
    const row = db
      .prepare(
        `SELECT market FROM price_records
         WHERE card_id = ? AND kind = 'tcgplayer' AND market IS NOT NULL AND retrieved_at <= ?
         ORDER BY retrieved_at DESC LIMIT 1`,
      )
      .get(cardId, cut) as { market: number } | undefined
    if (row) return row.market
    // Not priced yet at that time — fall back to the earliest known price so
    // early-week points aren't artificially zeroed by the sync gap.
    const firstKnown = db
      .prepare(
        `SELECT market FROM price_records
         WHERE card_id = ? AND kind = 'tcgplayer' AND market IS NOT NULL
         ORDER BY retrieved_at ASC LIMIT 1`,
      )
      .get(cardId) as { market: number } | undefined
    return firstKnown?.market ?? null
  }

  const insert = db.prepare(
    `INSERT OR IGNORE INTO networth_history (week, cash, collection, listed, sealed, net_worth, snapshotted_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
  )

  for (const w of weeks) {
    let cash = 1000
    for (const r of rows) if (r.created_at <= w.cut) cash += r.amount

    let collection = 0
    for (const h of holdings) {
      if (h.acquired_at > w.cut) continue
      if (h.sold_at && h.sold_at <= w.cut) continue // already flipped by then
      if (h.graded_grade) {
        collection += (gradedPriceOf(h.card_id, h.graded_grade).usd ?? h.cost_basis) * h.quantity
        continue
      }
      const base = priceAt(h.card_id, w.cut)
      if (base == null) continue
      const mult = CONDITION_MULT[(h.condition as Condition) || 'NM'] ?? 1
      collection += base * mult * h.quantity
    }

    let sealed = 0
    for (const s of sealedRows) if (s.acquired_at <= w.cut) sealed += s.quantity * s.cost

    insert.run(w.week, round2(cash), round2(collection), round2(sealed), round2(cash + collection + sealed), nowIso())
  }
}

/** Idempotent: fill in any past weeks not yet recorded. Live snapshots win (OR IGNORE). */
export function backfillNetWorthHistory(): void {
  try {
    reconstructWeeks()
  } catch (e) {
    console.error('[networth] backfill failed:', e)
  }
}

// ---------------------------------------------------------------------------
// Read model for the chart
// ---------------------------------------------------------------------------

export type NetWorthPoint = {
  week: string
  cash: number
  collection: number
  listed: number
  sealed: number
  netWorth: number
  snapshotted_at: string
}

export function netWorthSeries(): { points: NetWorthPoint[]; start: number | null; latest: number | null; change: number | null } {
  recordSnapshot() // keep the current week fresh on every dashboard load
  const raw = db
    .prepare(`SELECT * FROM networth_history ORDER BY week ASC LIMIT 26`)
    .all() as Record<string, number | string>[]
  const rows: NetWorthPoint[] = raw.map((r) => ({
    week: String(r.week),
    cash: Number(r.cash),
    collection: Number(r.collection),
    listed: Number(r.listed),
    sealed: Number(r.sealed),
    netWorth: Number(r.net_worth),
    snapshotted_at: String(r.snapshotted_at),
  }))
  const start = rows.length > 0 ? rows[0].netWorth : null
  const latest = rows.length > 0 ? rows[rows.length - 1].netWorth : null
  return {
    points: rows,
    start,
    latest,
    change: start != null && latest != null ? round2(latest - start) : null,
  }
}
