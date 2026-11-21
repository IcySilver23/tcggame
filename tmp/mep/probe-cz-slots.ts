import { db } from '../../server/lib/db'
import { valueOf } from '../../server/services/market'
import { planFor, expectedPackValue } from '../../server/services/packodds'
import { subsetChanceFor } from '../../server/services/packodds'

type Row = { card_id: string; slot: string; weight: number }
for (const pid of ['swsh12pt5-booster', 'swsh12pt5gg-booster']) {
  const rows = db.prepare('SELECT card_id, slot, weight FROM pack_product_cards WHERE pack_product_id = ?').all(pid) as Row[]
  const by: Record<string, { n: number; w: number; sum: number }> = {}
  for (const r of rows) {
    const v = valueOf(r.card_id, 'holofoil')
    const b = (by[r.slot] ??= { n: 0, w: 0, sum: 0 })
    b.n++; b.w += r.weight; b.sum += r.weight * v
  }
  console.log(`\n${pid}: ${rows.length} rows, slots: ${Object.keys(by).join(', ')}`)
  for (const [slot, b] of Object.entries(by)) {
    console.log(`  ${slot.padEnd(8)} n ${String(b.n).padStart(3)} weight ${b.w.toFixed(4)} weightedAvg $${(b.sum / b.w).toFixed(2)}`)
  }
}
console.log('\nplan swsh12pt5:', JSON.stringify(planFor('swsh12pt5', 10)))
console.log('subset chance', subsetChanceFor('swsh12pt5'))
console.log('pack EV', expectedPackValue('swsh12pt5'))
