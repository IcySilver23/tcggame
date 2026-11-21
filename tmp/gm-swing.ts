// One-off: how wide is a single rip of each General Mills mini pack?
//
// The shelf sticker reports a median ("TYP 74%"), which says nothing about how
// far one rip can land from it. This prints the distribution so the two packs
// can be compared on a scale-free basis: p90-p10 over p50, and sd over mean.
import path from 'node:path'

process.env.TCGLIFE_HOME = path.resolve('tmp/shop-home')

const { db } = await import('../server/lib/db')
const { valueOf } = await import('../server/services/market')
const { MINI_PACKS } = await import('../server/catalog/general-mills')

type Pooled = { cardId: string; variant: string; weight: number; v: number }
type SlotDef = { slot: string; count: number; entries: { cardId: string; variant: string; weight: number }[]; hostFill?: boolean }

function poolFor(setId: string, slot: SlotDef): Pooled[] {
  const base = slot.entries.map((e) => ({
    cardId: e.cardId,
    variant: e.variant,
    weight: e.weight,
    v: valueOf(e.cardId, e.variant),
  }))
  if (!slot.hostFill) return base
  const rows = db
    .prepare(`SELECT card_id, weight FROM pack_product_cards WHERE pack_product_id = ? AND slot IN ('common','uncommon')`)
    .all(`${setId}-booster`) as { card_id: string; weight: number }[]
  return [...base, ...rows.map((r) => ({ cardId: r.card_id, variant: 'normal', weight: Math.max(1e-9, r.weight), v: valueOf(r.card_id) }))]
}

const N = 50_000

function draw(pool: Pooled[]): Pooled {
  let total = 0
  for (const e of pool) total += e.weight
  let roll = Math.random() * total
  for (const e of pool) {
    roll -= e.weight
    if (roll <= 0) return e
  }
  return pool[pool.length - 1]
}

console.log('pool values driving each pack (descending):')
for (const def of MINI_PACKS) {
  for (const slot of def.slots) {
    const pool = poolFor(def.setId, slot)
    const vals = pool.map((e) => e.v).sort((a, b) => b - a)
    const top = pool.slice().sort((a, b) => b.v - a.v).slice(0, 5)
    console.log(
      `  ${def.id} ${slot.slot} x${slot.count} pool=${pool.length} ` +
        `max $${(vals[0] ?? 0).toFixed(2)} p90 $${(vals[Math.floor(0.1 * (vals.length - 1))] ?? 0).toFixed(2)} ` +
        `top: ${top.map((e) => `${e.cardId} $${e.v.toFixed(2)}`).join(', ')}`,
    )
  }
}

const rows: { id: string; msrp: number; mean: number; sd: number; p10: number; p50: number; p90: number; inBand: number; over100: number; min: number; max: number; distinct: number }[] = []

for (const def of MINI_PACKS) {
  const slots = def.slots.map((s) => ({ count: s.count, pool: poolFor(def.setId, s) })).filter((s) => s.pool.length > 0)
  const totals: number[] = []
  for (let i = 0; i < N; i++) {
    let v = 0
    for (const s of slots) for (let k = 0; k < s.count; k++) v += draw(s.pool).v
    totals.push(Math.round(v * 100) / 100)
  }
  totals.sort((a, b) => a - b)
  const q = (p: number) => totals[Math.floor(p * (N - 1))]
  const mean = totals.reduce((a, b) => a + b, 0) / N
  const sd = Math.sqrt(totals.reduce((a, b) => a + (b - mean) ** 2, 0) / N)
  const lo = def.msrp * 0.7
  const hi = def.msrp * 0.85
  rows.push({
    id: def.id,
    msrp: def.msrp,
    mean,
    sd,
    p10: q(0.1),
    p50: q(0.5),
    p90: q(0.9),
    inBand: totals.filter((t) => t >= lo && t <= hi).length / N,
    over100: totals.filter((t) => t > def.msrp).length / N,
    min: totals[0],
    max: totals[N - 1],
    distinct: new Set(totals).size,
  })
}

console.log('\nsingle-rip distribution over %d draws:', N)
const fmt = (n: number, d = 2) => n.toFixed(d)
console.log(
  ['pack'.padEnd(18), 'msrp'.padStart(7), 'mean'.padStart(7), 'p10'.padStart(7), 'p50'.padStart(7), 'p90'.padStart(7), 'sd'.padStart(7), 'cv'.padStart(6), 'p90-p10 /p50'.padStart(14), 'in 70-85%'.padStart(10), '>100%'.padStart(7), 'min'.padStart(7), 'max'.padStart(8)].join(' '),
)
for (const r of rows) {
  console.log(
    [
      r.id.padEnd(18),
      fmt(r.msrp).padStart(7),
      fmt(r.mean).padStart(7),
      fmt(r.p10).padStart(7),
      fmt(r.p50).padStart(7),
      fmt(r.p90).padStart(7),
      fmt(r.sd).padStart(7),
      fmt(r.sd / r.mean, 2).padStart(6),
      `${fmt((r.p90 - r.p10) / r.p50, 2)} (${fmt(((r.p90 - r.p10) / r.p50) * 100, 0)}%)`.padStart(14),
      `${fmt(r.inBand * 100, 0)}%`.padStart(10),
      `${fmt(r.over100 * 100, 0)}%`.padStart(7),
      fmt(r.min).padStart(7),
      fmt(r.max).padStart(8),
    ].join(' '),
  )
}
console.log('\nsd as % of sticker:', rows.map((r) => `${r.id} ${fmt((r.sd / r.msrp) * 100, 0)}%`).join(' · '))

db.close()
