// One-off follow-up to gm-swing.ts: where the Sequin anchor comes from, and how
// each pack's rips split across the shop's return bands.
import path from 'node:path'

process.env.TCGLIFE_HOME = path.resolve('tmp/shop-home')

const { db } = await import('../server/lib/db')
const { resolvePrice, valueOf } = await import('../server/services/market')
const { MINI_PACKS } = await import('../server/catalog/general-mills')

console.log('anchor for a Sequin copy (which price row wins):')
for (const id of ['smp-SM86', 'smp-SM04', 'smp-SM01', 'swshp-SWSH039', 'swshp-SWSH013']) {
  const r = resolvePrice(id, 'sequinHolofoil')
  console.log(`  ${id.padEnd(15)} $${String(r.usd).padStart(6)}  source=${r.source} kind=${(r as any).kind ?? '-'} variant=${(r as any).variant ?? '-'}`)
}

type Pooled = { cardId: string; variant: string; weight: number; v: number }
function poolFor(setId: string, slot: any): Pooled[] {
  const base = slot.entries.map((e: any) => ({ cardId: e.cardId, variant: e.variant, weight: e.weight, v: valueOf(e.cardId, e.variant) }))
  if (!slot.hostFill) return base
  const rows = db
    .prepare(`SELECT card_id, weight FROM pack_product_cards WHERE pack_product_id = ? AND slot IN ('common','uncommon')`)
    .all(`${setId}-booster`) as { card_id: string; weight: number }[]
  return [...base, ...rows.map((r) => ({ cardId: r.card_id, variant: 'normal', weight: Math.max(1e-9, r.weight), v: valueOf(r.card_id) }))]
}
const draw = (pool: Pooled[]) => {
  let total = 0
  for (const e of pool) total += e.weight
  let roll = Math.random() * total
  for (const e of pool) {
    roll -= e.weight
    if (roll <= 0) return e
  }
  return pool[pool.length - 1]
}

const N = 30_000
console.log('\nhow each pack splits across the shop\'s return bands:')
console.log(['pack'.padEnd(18), '<70%'.padStart(7), '70-85%'.padStart(8), '85-100%'.padStart(9), '>100%'.padStart(7), 'mean %'.padStart(8), 'median %'.padStart(9)].join(' '))
for (const def of MINI_PACKS) {
  const slots = def.slots.map((s: any) => ({ count: s.count, pool: poolFor(def.setId, s) })).filter((s: any) => s.pool.length > 0)
  const totals: number[] = []
  for (let i = 0; i < N; i++) {
    let v = 0
    for (const s of slots) for (let k = 0; k < s.count; k++) v += draw(s.pool).v
    totals.push(v)
  }
  totals.sort((a, b) => a - b)
  const share = (lo: number, hi: number) => (totals.filter((t) => t / def.msrp >= lo && t / def.msrp < hi).length / N) * 100
  const mean = totals.reduce((a, b) => a + b, 0) / N
  const pct = (n: number) => `${Math.round(n * 100)}%`
  console.log(
    [
      def.id.padEnd(18),
      `${share(0, 0.7).toFixed(0)}%`.padStart(7),
      `${share(0.7, 0.85).toFixed(0)}%`.padStart(8),
      `${share(0.85, 1).toFixed(0)}%`.padStart(9),
      `${share(1, 99).toFixed(0)}%`.padStart(7),
      pct(mean / def.msrp).padStart(8),
      pct(totals[Math.floor(0.5 * (N - 1))] / def.msrp).padStart(9),
    ].join(' '),
  )
}

// The Sun & Moon swing, decomposed: what the one expensive Sequin promo is worth
// to the pack, and what the rest of the pool would print without it.
const sm = MINI_PACKS.find((p) => p.id === 'gm-sunmoon-mini')!
const smSequin = poolFor(sm.setId, sm.slots[0])
const smTop = smSequin.slice().sort((a, b) => b.v - a.v)[0]
const smSequinMean = smSequin.reduce((a, e) => a + e.weight * e.v, 0) / smSequin.reduce((a, e) => a + e.weight, 0)
console.log(
  `\nSun & Moon: Sequin slot mean $${smSequinMean.toFixed(2)} of which ${smTop.cardId} ($${smTop.v.toFixed(2)}, ` +
    `1/${smSequin.length} of rips) contributes $${(smTop.v / smSequin.length).toFixed(2)}`,
)

// The 25th pack, decomposed by slot.
const t25 = MINI_PACKS.find((p) => p.id === 'gm-25th-mini')!
for (const slot of t25.slots) {
  const pool = poolFor(t25.setId, slot)
  const mean = pool.reduce((a, e) => a + e.weight * e.v, 0) / pool.reduce((a, e) => a + e.weight, 0)
  const sd = Math.sqrt(pool.reduce((a, e) => a + e.weight * (e.v - mean) ** 2, 0) / pool.reduce((a, e) => a + e.weight, 0))
  console.log(`  25th slot ${slot.slot} x${slot.count}: pool ${pool.length}, mean $${mean.toFixed(2)}${slot.count > 1 ? ` (x${slot.count} = $${(mean * slot.count).toFixed(2)})` : ''}`)
  if (slot.count > 1) console.log(`     one draw: sd $${sd.toFixed(2)} → two draws sd ≈ $${(sd * Math.sqrt(slot.count)).toFixed(2)}`)
}

db.close()
