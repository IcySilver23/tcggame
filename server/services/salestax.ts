import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { round2 } from './market'
import { append, appendSatellite, weekKey, type LedgerLine } from './pnl'
import { liveEvent } from './schedule'

// ---------------------------------------------------------------------------
// SALES TAX — the city wants its cut of every register transaction. Collected
// at the point of sale on top of the sticker price (trust money that passes
// through the shop, never income), held in a trust ledger, and remitted to
// the city once a month on the first market tick. The P&L shows it collected
// and remitted but never counts it as revenue or cost — it was never yours.
// ---------------------------------------------------------------------------

export const SALES_TAX_RATE = 0.06

// ---------------------------------------------------------------------------
// SPECIAL DISTRICT SURTAXES — the city ledger's rate isn't flat. Convention
// weekends (the flea market, the Mega Collectors Show) sit in a hospitality
// district with a +2% beds-and-boards surcharge, tournaments carry a +1%
// arena-crowd penny, and sponsor-drop evenings don't move the needle. The
// register always charges whatever is live at the moment of sale.
// ---------------------------------------------------------------------------

const DISTRICT_SURCHARGES: { match: (id: string) => boolean; rate: number; label: string }[] = [
  { match: (id) => id.startsWith('mega@'), rate: 0.02, label: 'Mega Collectors Show hospitality district' },
  { match: (id) => id.startsWith('flea@'), rate: 0.02, label: 'Weekend Flea Market district' },
  { match: (id) => id.startsWith('mini@') || id.startsWith('grand@'), rate: 0.01, label: 'Arena district' },
]

export type DistrictRate = { rate: number; district: string | null }

/** The effective sales-tax rate right now (or at a given moment). */
export function effectiveRate(at: number | string = Date.now()): DistrictRate {
  try {
    const live = liveEvent()
    if (live && live.end && new Date(live.end).getTime() > (typeof at === 'number' ? at : new Date(at).getTime())) {
      const d = DISTRICT_SURCHARGES.find((s) => s.match(live.id))
      if (d) return { rate: round2(SALES_TAX_RATE + d.rate), district: d.label }
    }
  } catch { /* schedule not ready — base rate */ }
  return { rate: SALES_TAX_RATE, district: null }
}

/** City sales tax owed on a pre-tax sticker price, at the district rate in force. */
export function taxOn(price: number, at?: number | string): number {
  return round2(price * effectiveRate(at).rate)
}

/** Collect tax at the register: cash in includes the tax, the trust holds it. */
export function collect(line: LedgerLine, preTaxAmount: number, context = '') {
  collectAt(line, preTaxAmount, 'main', context)
}

/** Same, tagged to a location for the per-location books. */
export function collectAt(line: LedgerLine, preTaxAmount: number, location: 'main' | number, context = '') {
  if (preTaxAmount <= 0) return
  const at = Date.now()
  const { rate, district } = effectiveRate(at)
  const tax = taxOn(preTaxAmount, at)
  if (tax <= 0) return
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(tax) // carve the tax out of the till
  const note = context ? `${line} tax @${(rate * 100).toFixed(1)}%${district ? ` · ${district}` : ''} · ${context}` : `${line} tax @${(rate * 100).toFixed(1)}%`
  if (typeof location === 'number') appendSatellite('sales_tax', tax, note, location)
  else append('sales_tax', tax, note)
}

/** All-time trust figures. */
export function trust() {
  const collected = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM shop_ledger WHERE line = 'sales_tax'`).get() as { t: number }
  const remittedRow = db.prepare(`SELECT COALESCE(SUM(remitted),0) AS t FROM sales_tax_filings`).get() as { t: number }
  return {
    rate: SALES_TAX_RATE,
    held: round2(Math.max(0, collected.t - remittedRow.t)),
    collectedAllTime: round2(collected.t),
    remittedAllTime: round2(remittedRow.t),
  }
}

// --- schema (local to the service so the table exists before any remit) ---
try {
  db.exec(
    `CREATE TABLE IF NOT EXISTS sales_tax_filings (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       month TEXT NOT NULL UNIQUE,        -- 'YYYY-MM' the collection window covered
       collected REAL NOT NULL,
       remitted REAL NOT NULL,
       filed_at TEXT NOT NULL
     )`,
  )
} catch { /* exists */ }

/** Remit every settled month that still has unremitted collections. */
export function remit() {
  const filed = new Set(
    (db.prepare(`SELECT month FROM sales_tax_filings`).all() as { month: string }[]).map((r) => r.month),
  )
  const rows = db
    .prepare(
      `SELECT substr(created_at, 1, 7) AS month, SUM(amount) AS total, COUNT(*) AS n
       FROM shop_ledger WHERE line = 'sales_tax' AND created_at IS NOT NULL
       GROUP BY substr(created_at, 1, 7) ORDER BY month`,
    )
    .all() as { month: string; total: number; n: number }[]
  const results: { month: string; remitted: number }[] = []
  for (const r of rows) {
    if (filed.has(r.month) || r.total <= 0) continue
    const amount = round2(r.total)
    db.prepare(`INSERT OR IGNORE INTO sales_tax_filings (month, collected, remitted, filed_at) VALUES (?, ?, ?, ?)`)
      .run(r.month, amount, amount, nowIso())
    logActivity(
      'tax',
      `🏛️ Remitted ${monthLabel(r.month)} sales tax to the city — ${r.n} transaction${r.n === 1 ? '' : 's'} collected, $${amount.toFixed(2)} sent to city hall.`,
      -amount,
    )
    results.push({ month: r.month, remitted: amount })
  }
  return results
}

function monthLabel(key: string): string {
  const d = new Date(key + '-01T00:00:00Z')
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** The monthly tick — remits settled months once per day-key. */
export function taxRemitTick() {
  const key = `salesTaxRemit:${new Date().toISOString().slice(0, 10)}`
  if (getMeta(key)) return
  setMeta(key, nowIso())
  remit()
}

/** Filing history for the UI. */
export function filings(limit = 12) {
  return db.prepare(`SELECT * FROM sales_tax_filings ORDER BY month DESC LIMIT ?`).all(limit) as unknown[]
}

/** Trust status for the shop status payload. */
export function status() {
  const now = effectiveRate()
  return {
    ...trust(),
    baseRate: SALES_TAX_RATE,
    rate: now.rate,
    district: now.district,
    filings: filings(12),
    week: weekKey(),
  }
}
