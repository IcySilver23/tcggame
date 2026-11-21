// One-off: the stable median rip of each General Mills pack, and the shelf
// price that puts it in the shop's 70–85% typical-return band.
import path from 'node:path'

process.env.TCGLIFE_HOME = path.resolve('tmp/shop-home')

const { db } = await import('../server/lib/db')
const { valueOf } = await import('../server/services/market')
const { MINI_PACKS } = await import('../server/catalog/general-mills')

type Pooled = { cardId: string; weight: number; v: number }
type Slot = { count: number; entries: { cardId: string; variant: string; weight: number }[]; hostFill?: boolean }

function poolFor(setId: string, slot: Slot): Pooled[] {
  const base = slot.entries.map((e) => ({ cardId: e.cardId, weight: e.weight, v: valueOf(e.cardId, e.variant) }))
  if (!slot.hostFill) return base
  const rows = db
    .prepare(`SELECT card_id, weight FROM pack_product_cards WHERE pack_product_id = ? AND slot IN ('common','uncommon')`)
    .all(`${setId}-booster`) as { card_id: string; weight: number }[]
  return [
    ...base,
    ...rows.map((r) => ({ cardId: r.card_id, weight: Math.max(1e-9, r.weight), v: valueOf(r.card_id) })),
  ]
}

const N = 20_000
const CANDIDATES = [1.99, 2.49, 2.99, 3.49, 3.99, 4.49, 4.99, 5.49, 5.99, 6.99, 7.49, 7.99, 8.99, 9.99, 12.99, 14.99, 16.99, 17.99, 18.99, 19.99, 21.99, 24.99]

for (const def of MINI_PACKS) {
  const slots = def.slots.map((s) => ({ count: s.count, pool: poolFor(def.setId, s) })).filter((s) => s.pool.length > 0)
  const totals: number[] = []
  for (let i = 0; i < N; i++) {
    let v = 0
    for (const s of slots) {
      for (let k = 0; k < s.count; k++) {
        let total = 0
        for (const e of s.pool) total += e.weight
        let roll = Math.random() * total
        let pick = s.pool[s.pool.length - 1]
        for (const e of s.pool) {
          roll -= e.weight
          if (roll <= 0) {
            pick = e
            break
          }
        }
        v += pick.v
      }
    }
    totals.push(v)
  }
  totals.sort((a, b) => a - b)
  const q = (p: number) => totals[Math.floor(p * (N - 1))]
  const p50 = q(0.5)
  const avg = totals.reduce((a, b) => a + b, 0) / N
  // A 300-draw p50 wobbles: check the ratio at the edges of that wobble.
  const at = (v: number, price: number) => Math.round((v / price) * 100)
  const target = p50 / 0.77
  const best = CANDIDATES.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a))
  console.log(
    `${def.id.padEnd(18)} p50 $${p50.toFixed(2)}  avg $${avg.toFixed(2)}  ` +
      `band(p47..p53) $${q(0.47).toFixed(2)}..$${q(0.53).toFixed(2)}  ` +
      `| target $${target.toFixed(2)} -> $${best.toFixed(2)} ` +
      `(${at(q(0.47), best)}-${at(q(0.53), best)}%)  current msrp $${def.msrp.toFixed(2)} = ${at(p50, def.msrp)}%`,
  )
}

db.close()
