import { db, nowIso } from '../lib/db'
import { round2 } from './market'

// ---------------------------------------------------------------------------
// Shop P&L — every shop money event appends one signed ledger row under a
// week key (Monday-anchored, same convention as net-worth history). The
// weekly statement is then a plain GROUP BY.
// ---------------------------------------------------------------------------

export type LedgerLine = 'cases' | 'bulk' | 'bags' | 'sales_tax' | 'rent' | 'payroll' | 'interest' | 'overhead'

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

/** Append a signed ledger entry (revenue positive, costs negative). */
export function append(line: LedgerLine, amount: number, note = '') {
  const amt = round2(amount)
  if (amt === 0 && line !== 'rent') return // zero-rent days don't need rows
  db.prepare(`INSERT INTO shop_ledger (week, line, amount, note, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(weekKey(), line, amt, note.slice(0, 120), nowIso())
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
  const salesTax = get('sales_tax')
  const rent = get('rent')
  const payroll = get('payroll')
  const interest = get('interest')
  const overhead = get('overhead')

  // Sales tax is trust money passing through, never income: shown alongside
  // revenue but excluded from product revenue, net, and margin.
  const productRevenue = round2(caseRevenue + bulkRevenue + bagRevenue)
  const totalCosts = round2(Math.abs(rent) + Math.abs(payroll) + Math.abs(interest) + Math.abs(overhead))
  const net = round2(productRevenue + rent + payroll + interest + overhead) // rent etc. are already negative

  return {
    week,
    lines: {
      cases: { revenue: caseRevenue, entries: count('cases') },
      bulk: { revenue: bulkRevenue, entries: count('bulk') },
      bags: { revenue: bagRevenue, entries: count('bags') },
    },
    salesTaxCollected: { amount: salesTax, entries: count('sales_tax') },
    overhead: {
      rent: { amount: rent, entries: count('rent') },
      payroll: { amount: payroll, entries: count('payroll') },
      interest: { amount: interest, entries: count('interest') },
      other: { amount: overhead, entries: count('overhead') },
    },
    productRevenue,
    totalCosts,
    net,
    margin: productRevenue > 0 ? round2(net / productRevenue) : null,
  }
}

/** Last N weeks (including current) for the trend row. */
export function history(weeks = 6) {
  const rows = db
    .prepare(
      `SELECT week,
              SUM(CASE WHEN line IN ('cases','bulk','bags') THEN amount ELSE 0 END) AS revenue,
              SUM(CASE WHEN line IN ('rent','payroll','interest','overhead') THEN amount ELSE 0 END) AS costs
       FROM shop_ledger GROUP BY week ORDER BY week DESC LIMIT ?`,
    )
    .all(weeks) as { week: string; revenue: number; costs: number }[]
  return rows.map((r) => ({
    week: r.week,
    revenue: round2(r.revenue),
    costs: round2(r.costs),
    net: round2(r.revenue + r.costs),
  }))
}
