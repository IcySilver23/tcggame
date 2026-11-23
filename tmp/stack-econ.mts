// Does a stack's ceiling ever go above market?
//
// Samples 24-card stacks from the real save's cheap-card pool and prices them
// under the two candidate rules, then compares the net to what the buylist pays
// (55/65/75% of market, instant, no audience needed). Deterministic seed.
import { db } from '../server/lib/db'
import { valueOf } from '../server/services/market'

type Card = { id: number; card_id: string; variant: string | null; condition: string | null; set_id: string; market: number }

const rows = db
  .prepare(
    `SELECT i.id, i.card_id, i.variant, i.condition, c.set_id
     FROM inventory i JOIN cards c ON c.id = i.card_id
     WHERE i.status = 'collection' AND i.graded_grade IS NULL AND i.quantity = 1`,
  )
  .all() as Omit<Card, 'market'>[]
const pool: Card[] = rows
  .map((r) => ({ ...r, market: valueOf(r.card_id, r.variant || 'normal', (r.condition as never) || 'NM') }))
  .filter((c) => c.market > 0 && c.market <= 2) // stackable: the $2 per-card cap
const cheapPool = pool.filter((c) => c.market < 1)

let seed = 20261123
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]

const SIZE = 24
const FEE = 0.08
const STACK_CAP = 2

// Existing single-lot heat: 0.35..0.95 plus up to 0.35 for a big room.
const heatFor = (viewers: number) => 0.35 + rnd() * 0.6 + Math.min(0.35, viewers / 900)

// Rule B's froth: variety is what a dig is worth, and only a room that showed
// up pays it — a thin room gets singles' economics, not free money.
const FROTH_PER_SET = 0.06
const FROTH_CAP = 0.3
const FROTH_FLOOR_VIEWERS = 150
const frothFor = (distinctSets: number, viewers: number) =>
  Math.min(FROTH_CAP, FROTH_PER_SET * distinctSets) * Math.min(1, viewers / FROTH_FLOOR_VIEWERS)

type Sample = { market: number; distinct: number }

function stacks(n: number, from: Card[], cheapest: boolean): Sample[] {
  const out: Sample[] = []
  for (let i = 0; i < n; i++) {
    const chosen: Card[] = []
    const used = new Set<number>()
    if (cheapest) {
      const sorted = from.slice().sort((a, b) => a.market - b.market)
      for (let k = 0; k < SIZE && k < sorted.length; k++) chosen.push(sorted[k])
    } else {
      while (chosen.length < SIZE) {
        const c = pick(from)
        if (used.has(c.id)) continue
        used.add(c.id)
        chosen.push(c)
      }
    }
    out.push({ market: chosen.reduce((s, c) => s + c.market, 0), distinct: new Set(chosen.map((c) => c.set_id)).size })
  }
  return out
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
const pct = (a: number[], p: number) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * p)] ?? 0

// One stack, one ask, one room: the room bids up toward its ceiling if the ask
// clears it, and the bids land somewhere in the gap (a war, not a tap).
function realise(s: Sample, viewers: number, askMultiple: number, froth: boolean) {
  const ask = s.market * askMultiple
  const ceiling = s.market * (heatFor(viewers) + (froth ? frothFor(s.distinct, viewers) : 0))
  if (ask > ceiling) return { sold: false, net: 0, ask, ceiling }
  const bid = ask + (ceiling - ask) * (0.4 + rnd() * 0.5)
  return { sold: true, net: bid * (1 - FEE), ask, ceiling }
}

const uniform = stacks(4000, cheapPool, false)
const cheapest = stacks(2000, pool.filter((c) => c.market < 0.5), true)
const VIEWERS = [30, 120, 400, 900, 2000]
const ASKS = [1.0, 0.85, 0.7]

const table: Record<string, unknown>[] = []
for (const viewers of VIEWERS) {
  for (const askMultiple of ASKS) {
    const row: Record<string, unknown> = { viewers, ask: `${Math.round(askMultiple * 100)}% of market` }
    for (const froth of [false, true]) {
      seed = 20261123 // same draws for both rules, so only the rule differs
      const r = uniform.map((s) => realise(s, viewers, askMultiple, froth))
      const net = r.map((x) => x.net)
      row[froth ? 'frothNet' : 'cappedNet'] = +mean(net).toFixed(2)
      row[froth ? 'frothSold' : 'cappedSold'] = `${Math.round((r.filter((x) => x.sold).length / r.length) * 100)}%`
    }
    table.push(row)
  }
}

const market = mean(uniform.map((s) => s.market))
const distinct = mean(uniform.map((s) => s.distinct))
seed = 20261123
const cheapSample = cheapest.map((s) => s.market)

console.log(
  JSON.stringify(
    {
      pool: { cheap: cheapPool.length, under2: pool.length, cap: STACK_CAP },
      stack: { size: SIZE, meanMarket: +market.toFixed(2), meanDistinctSets: +distinct.toFixed(1), cheapestFillMarket: +mean(cheapSample).toFixed(2) },
      buylist: { at55: +(market * 0.55).toFixed(2), at65: +(market * 0.65).toFixed(2), at75: +(market * 0.75).toFixed(2) },
      ceilingsAt120: {
        capped: +(market * (0.35 + 0.5 + 120 / 900)).toFixed(2),
        froth: +(market * (0.35 + 0.5 + 120 / 900 + 0.15 * distinct * (120 / 150))).toFixed(2),
      },
      p90Market: +pct(uniform.map((s) => s.market), 0.9).toFixed(2),
      table,
    },
    null,
    1,
  ),
)
