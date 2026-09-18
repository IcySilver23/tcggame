import { db, nowIso, getMeta, setMeta } from '../lib/db'
import { round2 } from './market'
import { getShop } from './shop'
import * as pnl from './pnl'

// ---------------------------------------------------------------------------
// Shop performance stats — the Home-dashboard feed. Daily rollups are
// captured once per day (on the rent-day rollover): revenue per product
// line, costs, customers, and the reputation/net trend. The read model
// serves the 7-day chart and the "best product line" verdict.
// ---------------------------------------------------------------------------

function dayKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10)
}

/** Cumulative shop net (product revenue - costs) straight from the ledger. */
function lifetimeNet(): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN line IN ('cases','bulk','bags') THEN amount ELSE 0 END),0) AS rev,
              COALESCE(SUM(CASE WHEN line IN ('rent','payroll','interest','overhead') THEN amount ELSE 0 END),0) AS costs
       FROM shop_ledger`,
    )
    .get() as { rev: number; costs: number }
  return round2(row.rev + row.costs)
}

/** Capture today's rollup from the ledger + current shop state. */
export function captureDaily() {
  const shop = getShop()
  const today = dayKey()
  if (getMeta(`shopDaily:${today}`)) return
  if (!shop) return
  const week = pnl.weekKey()
  // Pull this week's ledger split by line, scaled by the fraction of the week
  // that has elapsed up to and including today. Simpler and honest: sum the
  // ledger entries whose created row-day is <= today — but the ledger only
  // stores week keys, so we approximate with the week-to-date totals up to now.
  const rows = db
    .prepare(`SELECT line, SUM(amount) AS total FROM shop_ledger WHERE week = ? GROUP BY line`)
    .all(week) as { line: pnl.LedgerLine; total: number }[]
  const total = (lines: pnl.LedgerLine[]) => round2(lines.reduce((a, l) => a + (rows.find((r) => r.line === l)?.total ?? 0), 0))

  // Week-to-date ≠ day, but capturing the running week totals daily gives a
  // monotone curve whose day-over-day deltas are exactly the daily numbers.
  const cases = total(['cases'])
  const bulk = total(['bulk'])
  const bags = total(['bags'])
  const costs = round2(Math.abs(total(['rent', 'payroll', 'interest', 'overhead'])))
  const customers = (db.prepare(`SELECT customer_count FROM shop WHERE id = 1`).get() as { customer_count: number }).customer_count

  db.prepare(
    `INSERT INTO shop_daily (day, cases, bulk, bags, costs, customers, reputation, net_worth)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET cases = excluded.cases, bulk = excluded.bulk, bags = excluded.bags,
       costs = excluded.costs, customers = excluded.customers, reputation = excluded.reputation, net_worth = excluded.net_worth`,
  ).run(today, cases, bulk, bags, costs, customers, shop.reputation, lifetimeNet())
  setMeta(`shopDaily:${today}`, nowIso())
}

export function stats() {
  const shop = getShop()
  if (!shop) return { open: false as const }
  const days = db
    .prepare(`SELECT * FROM shop_daily ORDER BY day DESC LIMIT 7`)
    .all() as { day: string; cases: number; bulk: number; bags: number; costs: number; customers: number; reputation: number; net_worth: number }[]
  const series = days.reverse() // oldest → newest
  const best = (['cases', 'bulk', 'bags'] as const)
    .map((line) => ({ line, revenue: round2(series.reduce((a, d) => a + d[line], 0)) }))
    .sort((a, b) => b.revenue - a.revenue)[0]

  const LINE_LABEL: Record<string, string> = { cases: '🪞 Case sales', bulk: '🗑️ Dollar bins', bags: '🎁 Grab bags' }

  return {
    open: true as const,
    shopName: shop.name,
    reputation: shop.reputation,
    todayRevenue: round2(shop.today_revenue),
    todayCustomers: shop.today_customers,
    week: {
      series: series.map((d) => ({
        day: d.day,
        revenue: round2(d.cases + d.bulk + d.bags),
        costs: d.costs,
        net: round2(d.cases + d.bulk + d.bags - d.costs),
        customers: d.customers,
        reputation: d.reputation,
        lifetimeNet: d.net_worth,
      })),
      revenue: round2(series.reduce((a, d) => a + d.cases + d.bulk + d.bags, 0)),
      customers: series.length > 0 ? Math.max(...series.map((d) => d.customers)) - Math.min(...series.map((d) => d.customers)) : 0,
    },
    bestLine: best ? { line: best.line, label: LINE_LABEL[best.line], revenue: best.revenue } : null,
    lifetimeNet: lifetimeNet(),
  }
}
