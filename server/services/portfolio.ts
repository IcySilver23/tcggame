// ---------------------------------------------------------------------------
// The collection portfolio — realized-vs-market accounting over the real
// tables. Held positions value through the same ladder net worth uses
// (graded → graded comps, listed → listing price, raw → condition market),
// realized numbers come from sale_history, and the money-weighted return is
// a Modified Dietz approximation over the snapshot history: your buys and
// sells are dated cashflows, not noise. The S&P line is the classic humbling
// what-if at the index's long-run ~10%/yr, over your save's exact span.
// ---------------------------------------------------------------------------
import { db } from '../lib/db'
import { valueOf, gradedPriceOf, round2, type Condition } from './market'
import { computeBenchmark } from './benchmark'

export type PortfolioSetRow = {
  setId: string
  setName: string
  series: string
  releaseDate: string | null
  cardsHeld: number
  invested: number
  value: number
  gain: number
  gainPct: number | null
}

export type PortfolioEraRow = {
  series: string
  sets: number
  invested: number
  value: number
  gain: number
  gainPct: number | null
}

export type PortfolioPosition = {
  cardId: string
  name: string
  image: string | null
  setName: string
  condition: string
  gradedGrade: string | null
  quantity: number
  invested: number
  value: number
  gain: number
  gainPct: number | null
}

export type Portfolio = {
  invested: number
  value: number
  unrealized: number
  unrealizedPct: number | null
  realized: number
  realizedCost: number
  realizedPct: number | null
  salesCount: number
  deployedTotal: number
  moneyWeightedReturnPct: number | null
  mwrNote: string
  totalReturnPct: number | null
  spReturnPct: number | null
  spSameMoney: number
  benchmarkNote: string
  spSource: 'real' | 'model'
  income: { line: string; total: number }[]
  incomeTotal: number
  chart: { week: string; collection: number; sp: number }[]
  sets: PortfolioSetRow[]
  eras: PortfolioEraRow[]
  best: PortfolioPosition | null
  worst: PortfolioPosition | null
}


/** Net worth's valuation rule, per row. */
function rowValue(r: { card_id: string; variant: string; condition: string; quantity: number; graded_grade: string | null; status: string; listing_price: number | null }): number {
  if (r.status === 'listed' && r.listing_price != null) return r.listing_price
  const v = r.graded_grade
    ? gradedPriceOf(r.card_id, r.graded_grade).usd ?? 0
    : valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
  return v
}

export function portfolio(): Portfolio {
  const held = db
    .prepare(
      `SELECT i.card_id, i.variant, i.condition, i.quantity, i.graded_grade, i.status, i.listing_price, i.cost_basis, i.acquired_at,
              c.name, c.image_small, c.set_id, s.name AS set_name, s.series, s.release_date
       FROM inventory i JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
       WHERE i.status != 'sold' AND i.quantity > 0`,
    )
    .all() as {
      card_id: string; variant: string; condition: string; quantity: number; graded_grade: string | null
      status: string; listing_price: number | null; cost_basis: number; acquired_at: string
      name: string; image_small: string | null; set_id: string; set_name: string; series: string; release_date: string | null
    }[]

  let invested = 0
  let value = 0
  const setMap = new Map<string, PortfolioSetRow>()
  const posMap = new Map<string, PortfolioPosition>()

  for (const r of held) {
    const v = rowValue(r)
    const pos = v * r.quantity
    const cost = r.cost_basis * r.quantity
    invested += cost
    value += pos

    const s = setMap.get(r.set_id) ?? {
      setId: r.set_id, setName: r.set_name, series: r.series, releaseDate: r.release_date,
      cardsHeld: 0, invested: 0, value: 0, gain: 0, gainPct: null,
    }
    s.cardsHeld += r.quantity
    s.invested += cost
    s.value += pos
    setMap.set(r.set_id, s)

    const pk = `${r.card_id}|${r.variant}|${r.condition}|${r.graded_grade ?? ''}`
    const p = posMap.get(pk) ?? {
      cardId: r.card_id, name: r.name, image: r.image_small, setName: r.set_name,
      condition: r.condition, gradedGrade: r.graded_grade, quantity: 0, invested: 0, value: 0, gain: 0, gainPct: null,
    }
    p.quantity += r.quantity
    p.invested += cost
    p.value += pos
    posMap.set(pk, p)
  }

  for (const s of setMap.values()) {
    s.invested = round2(s.invested)
    s.value = round2(s.value)
    s.gain = round2(s.value - s.invested)
    s.gainPct = s.invested > 0 ? s.value / s.invested - 1 : null
  }
  for (const p of posMap.values()) {
    p.invested = round2(p.invested)
    p.value = round2(p.value)
    p.gain = round2(p.value - p.invested)
    p.gainPct = p.invested > 0 ? p.value / p.invested - 1 : null
  }

  // Realized: the sale ledger, all channels.
  const sold = db
    .prepare(`SELECT COALESCE(SUM(profit),0) AS profit, COALESCE(SUM(cost_basis),0) AS cost, COUNT(*) AS n FROM sale_history`)
    .get() as { profit: number; cost: number; n: number }

  // Capital ever deployed into cardboard (held + sold cost bases).
  const deployed = db
    .prepare(`SELECT COALESCE(SUM(cost_basis * quantity),0) AS n FROM inventory`)
    .get() as { n: number }
  const deployedTotal = round2(deployed.n)

  // Holdings income: what the collection earned while you held it — the
  // revenue lines of the shop ledger (cases, bins, bags, consignment, shows).
  const incomeRows = db
    .prepare(`SELECT line, SUM(amount) AS total FROM shop_ledger WHERE line IN ('cases','bulk','bags','consignment','shows') GROUP BY line`)
    .all() as { line: string; total: number }[]
  const income = incomeRows.map((r) => ({ line: r.line, total: round2(r.total) })).sort((a, b) => b.total - a.total)
  const incomeTotal = round2(income.reduce((a, r) => a + r.total, 0))

  // Money-weighted return — Modified Dietz over the snapshot window, with
  // every acquisition (+cost) and sale (−proceeds) as a dated external flow.
  const snaps = db
    .prepare(`SELECT week, collection, listed, snapshotted_at FROM networth_history ORDER BY snapshotted_at ASC`)
    .all() as { week: string; collection: number; listed: number; snapshotted_at: string }[]

  const now = Date.now()
  const chart: { week: string; collection: number; sp: number }[] = []
  let mwr: number | null = null
  let mwrNote = 'Needs two save snapshots — it builds as the game photographs its week.'
  let created = (db.prepare(`SELECT created_at FROM game_state WHERE id = 1`).get() as { created_at: string } | undefined)?.created_at ?? null
  // The index, real closes when the feed has them (see services/benchmark.ts),
  // the labeled ~10%/yr model when it doesn't — one benchmark for the chart
  // and the what-if panel.
  const bench = computeBenchmark(created, now)

  if (snaps.length >= 2 && created) {
    const t0 = new Date(snaps[0].snapshotted_at).getTime()
    const span = now - t0
    const v0 = snaps[0].collection + snaps[0].listed
    const flows = db
      .prepare(
        `SELECT acquired_at AS at, cost_basis * quantity AS amt FROM inventory WHERE acquired_at IS NOT NULL
         UNION ALL
         SELECT sold_at AS at, -sale_price AS amt FROM sale_history`,
      )
      .all() as { at: string; amt: number }[]
    let sumF = 0
    let sumWF = 0
    for (const f of flows) {
      const t = new Date(f.at).getTime()
      if (!Number.isFinite(t) || t <= t0 || t > now || f.amt === 0) continue
      const w = (now - t) / span // time remaining after the flow, 0..1
      sumF += f.amt
      sumWF += w * f.amt
    }
    const denom = v0 + sumWF
    if (span > 0 && Math.abs(denom) > 1) {
      const liveValue = value // held market value right now (collection + listed rules)
      mwr = round2((liveValue - v0 - sumF) / denom)
      mwrNote = 'Money-weighted (Modified Dietz): your buys and sells are dated flows, so a win on small money doesn\'t dress up a big base.'
    }
    // The index chart: collection value normalized to 100 at the first
    // snapshot, against the index over the same span.
    for (const s of snaps) {
      const col = s.collection + s.listed
      const idx = v0 > 0 ? (col / v0) * 100 : 100
      chart.push({ week: s.week, collection: round2(idx), sp: round2(100 * bench.multipleAt(s.snapshotted_at)) })
    }
  } else if (!created) {
    created = null
  }

  // Total return for the benchmark: prefer the flow-aware MWR, fall back to
  // the simple accounting return when snapshots are too young.
  const totalReturnPct = mwr ?? (deployedTotal > 0 ? round2((value + sold.profit) / deployedTotal - 1) : null)
  const spReturnPct = round2(bench.spanReturnPct)
  const spSameMoney = round2(deployedTotal * (1 + bench.spanReturnPct))
  const benchmarkNote = bench.note

  // Eras: group the set rows by series (the real TCG era field), ordered by
  // each series' earliest release.
  const eraMap = new Map<string, { sets: number; invested: number; value: number; first: string | null }>()
  for (const s of setMap.values()) {
    const e = eraMap.get(s.series) ?? { sets: 0, invested: 0, value: 0, first: s.releaseDate }
    e.sets++
    e.invested += s.invested
    e.value += s.value
    if (s.releaseDate && (!e.first || s.releaseDate < e.first)) e.first = s.releaseDate
    eraMap.set(s.series, e)
  }
  const eras: PortfolioEraRow[] = [...eraMap.entries()]
    .map(([series, e]) => ({
      series,
      sets: e.sets,
      invested: round2(e.invested),
      value: round2(e.value),
      gain: round2(e.value - e.invested),
      gainPct: e.invested > 0 ? e.value / e.invested - 1 : null,
    }))
    .sort((a, b) => {
      const fa = eraMap.get(a.series)?.first ?? '9999'
      const fb = eraMap.get(b.series)?.first ?? '9999'
      return fa.localeCompare(fb)
    })

  const sets = [...setMap.values()].sort((a, b) => (b.gainPct ?? -9) - (a.gainPct ?? -9))

  const positions = [...posMap.values()].filter((p) => p.invested > 0 && p.gainPct != null)
  const best = positions.length ? positions.reduce((a, b) => ((b.gainPct ?? 0) > (a.gainPct ?? 0) ? b : a)) : null
  const worst = positions.length ? positions.reduce((a, b) => ((b.gainPct ?? 0) < (a.gainPct ?? 0) ? b : a)) : null

  return {
    invested: round2(invested),
    value: round2(value),
    unrealized: round2(value - invested),
    unrealizedPct: invested > 0 ? value / invested - 1 : null,
    realized: round2(sold.profit),
    realizedCost: round2(sold.cost),
    realizedPct: sold.cost > 0 ? sold.profit / sold.cost : null,
    salesCount: sold.n,
    deployedTotal,
    moneyWeightedReturnPct: mwr,
    mwrNote,
    totalReturnPct,
    spReturnPct,
    spSameMoney,
    benchmarkNote,
    spSource: bench.mode,
    income,
    incomeTotal,
    chart,
    sets,
    eras,
    best: best && (best.gainPct ?? 0) > 0.02 ? best : null,
    worst: worst && (worst.gainPct ?? 0) < -0.02 ? worst : null,
  }
}
