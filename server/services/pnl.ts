import { db, nowIso } from '../lib/db'
import { round2 } from './market'

// ---------------------------------------------------------------------------
// Shop P&L — every shop money event appends one signed ledger row under a
// week key (Monday-anchored, same convention as net-worth history). The
// weekly statement is then a plain GROUP BY.
// ---------------------------------------------------------------------------

export type LedgerLine = 'cases' | 'bulk' | 'bags' | 'consignment' | 'sales_tax' | 'rent' | 'mortgage' | 'payroll' | 'interest' | 'overhead' | 'shows'

// Migration: exact timestamps for the tax window (existing DBs predate the column).
{
  const cols = (db.prepare(`PRAGMA table_info(shop_ledger)`).all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('created_at')) db.exec(`ALTER TABLE shop_ledger ADD COLUMN created_at TEXT`)
}

export function weekKey(at: number | string = Date.now()): string {
  const d = new Date(at)
  const day = (d.getUTCDay() + 6) % 7 // Monday = 0
  const w = new Date(d)
  w.setUTCDate(d.getUTCDate() - day)
  return w.toISOString().slice(0, 10)
}

/** Append a signed ledger entry (revenue positive, costs negative), tagged to a location ('main' | 'satellite:N'). */
export function append(line: LedgerLine, amount: number, note = '', location: 'main' | 'satellite' | `satellite:${number}` = 'main') {
  const amt = round2(amount)
  if (amt === 0 && line !== 'rent') return // zero-rent days don't need rows
  db.prepare(`INSERT INTO shop_ledger (week, line, amount, note, created_at, location) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(weekKey(), line, amt, note.slice(0, 120), nowIso(), location)
}

/** Same as append, for one of the satellites ('satellite:N' ledger keys). */
export function appendSatellite(line: LedgerLine, amount: number, note = '', store = 1) {
  append(line, amount, note, `satellite:${store}`)
}

/** Wire this into existing money paths by importing and calling alongside them. */
export function weekStatement(week = weekKey()) {
  const rows = db
    .prepare(`SELECT line, SUM(amount) AS total, COUNT(*) AS n FROM shop_ledger WHERE week = ? GROUP BY line`)
    .all(week) as { line: LedgerLine; total: number; n: number }[]

  const get = (line: LedgerLine) => round2(rows.find((r) => r.line === line)?.total ?? 0)
  const count = (line: LedgerLine) => rows.find((r) => r.line === line)?.n ?? 0

  const caseRevenue = get('cases')
  const bulkRevenue = get('bulk')
  const bagRevenue = get('bags')
  const consignmentRevenue = get('consignment') // the counter's 20% cut — commission, not gross
  const salesTax = get('sales_tax')
  const rent = get('rent')
  const mortgage = get('mortgage') // the deed's daily draft — owner's replacement for rent
  const payroll = get('payroll')
  const interest = get('interest')
  const overhead = get('overhead')
  // Hosted card shows: gate + table rent vs venue costs, netted in the line.
  const shows = get('shows')

  // Sales tax is trust money passing through, never income: shown alongside
  // revenue but excluded from product revenue, net, and margin. Consignment
  // commission is your own income but is not product revenue (no goods sold).
  const productRevenue = round2(caseRevenue + bulkRevenue + bagRevenue)
  const totalCosts = round2(Math.abs(rent) + Math.abs(mortgage) + Math.abs(payroll) + Math.abs(interest) + Math.abs(overhead))
  const net = round2(productRevenue + consignmentRevenue + shows + rent + mortgage + payroll + interest + overhead) // rent etc. are already negative

  return {
    week,
    lines: {
      cases: { revenue: caseRevenue, entries: count('cases') },
      bulk: { revenue: bulkRevenue, entries: count('bulk') },
      bags: { revenue: bagRevenue, entries: count('bags') },
      consignment: { revenue: consignmentRevenue, entries: count('consignment') },
    },
    salesTaxCollected: { amount: salesTax, entries: count('sales_tax') },
    overhead: {
      rent: { amount: rent, entries: count('rent') },
      mortgage: { amount: mortgage, entries: count('mortgage') },
      payroll: { amount: payroll, entries: count('payroll') },
      interest: { amount: interest, entries: count('interest') },
      other: { amount: overhead, entries: count('overhead') },
    },
    shows: { amount: shows, entries: count('shows') },
    productRevenue,
    totalCosts,
    net,
    margin: productRevenue > 0 ? round2(net / productRevenue) : null,
  }
}

/** Per-satellite P&L for one week — that store's own books. */
export function locationStatement(week = weekKey(), store = 1) {
  const rows = db
    .prepare(`SELECT line, SUM(amount) AS total, COUNT(*) AS n FROM shop_ledger WHERE week = ? AND location = ? GROUP BY line`)
    .all(week, `satellite:${store}`) as { line: LedgerLine; total: number; n: number }[]
  const get = (line: LedgerLine) => round2(rows.find((r) => r.line === line)?.total ?? 0)
  const revenue = round2(get('cases')) // satellite sales book as 'cases' with location='satellite'
  const costs = round2(Math.abs(get('rent')) + Math.abs(get('payroll')) + Math.abs(get('overhead')))
  return {
    week,
    revenue,
    costs,
    rent: get('rent'),
    payroll: get('payroll'),
    other: get('overhead'),
    net: round2(revenue - costs),
    entries: rows.reduce((a, r) => a + r.n, 0),
  }
}

/** Whole-chain P&L for one week — every satellite rolled up. */
export function chainStatement(week = weekKey()) {
  const rows = db
    .prepare(`SELECT line, SUM(amount) AS total, COUNT(*) AS n FROM shop_ledger WHERE week = ? AND location LIKE 'satellite:%' GROUP BY line`)
    .all(week) as { line: LedgerLine; total: number; n: number }[]
  const get = (line: LedgerLine) => round2(rows.find((r) => r.line === line)?.total ?? 0)
  const revenue = round2(get('cases'))
  const costs = round2(Math.abs(get('rent')) + Math.abs(get('payroll')) + Math.abs(get('overhead')))
  return {
    week,
    revenue,
    costs,
    rent: get('rent'),
    payroll: get('payroll'),
    other: get('overhead'),
    net: round2(revenue - costs),
    entries: rows.reduce((a, r) => a + r.n, 0),
  }
}

/** Last N weeks (including current) for the trend row. */
export function history(weeks = 6) {
  const rows = db
    .prepare(
      `SELECT week,
              SUM(CASE WHEN line IN ('cases','bulk','bags','consignment') THEN amount ELSE 0 END) AS revenue,
              SUM(CASE WHEN line IN ('rent','mortgage','payroll','interest','overhead') THEN amount ELSE 0 END) AS costs,
              SUM(CASE WHEN line = 'shows' THEN amount ELSE 0 END) AS shows
       FROM shop_ledger GROUP BY week ORDER BY week DESC LIMIT ?`,
    )
    .all(weeks) as { week: string; revenue: number; costs: number; shows: number }[]
  return rows.map((r) => ({
    week: r.week,
    revenue: round2(r.revenue),
    costs: round2(r.costs),
    shows: round2(r.shows),
    net: round2(r.revenue + r.costs + r.shows),
  }))
}
