import { db } from '../../server/lib/db'
import { valueOf } from '../../server/services/market'
import { expectedPackValue, subsetChanceFor, HOST_SUBSETS } from '../../server/services/packodds'

type Row = { card_id: string; weight: number; rarity: string | null }
for (const [host, sub] of Object.entries(HOST_SUBSETS)) {
  if (host === 'swsh12pt5') continue
  const rows = db.prepare(
    `SELECT p.card_id, p.weight, c.rarity FROM pack_product_cards p JOIN cards c ON c.id = p.card_id
     WHERE p.pack_product_id = ? AND p.slot = 'subset'`,
  ).all(`${host}-booster`) as Row[]
  const total = rows.reduce((a, r) => a + r.weight, 0)
  const distinct = new Set(rows.map((r) => r.weight.toFixed(9)))
  const avg = total > 0 ? rows.reduce((a, r) => a + r.weight * valueOf(r.card_id, 'holofoil'), 0) / total : 0
  const byRar: Record<string, { n: number; w: number; sum: number }> = {}
  for (const r of rows) {
    const v = valueOf(r.card_id, 'holofoil')
    const b = (byRar[r.rarity ?? '—'] ??= { n: 0, w: 0, sum: 0 })
    b.n++; b.w += r.weight; b.sum += r.weight * v
  }
  const ev = expectedPackValue(host)
  const slotEv = subsetChanceFor(host) * avg
  console.log(`\n${host} -> ${sub}: pool ${rows.length}, distinct weights ${distinct.size}, avg $${avg.toFixed(2)}, slot rate ${subsetChanceFor(host)}, slot EV $${slotEv.toFixed(2)} of pack $${ev.toFixed(2)} (${((slotEv / Math.max(ev, 0.01)) * 100).toFixed(0)}%)`)
  const buckets = Object.entries(byRar).sort((x, y) => y[1].sum / y[1].w - x[1].sum / x[1].w)
  for (const [rar, b] of buckets) console.log(`   ${rar.padEnd(28)} n ${String(b.n).padStart(3)}  avg $${(b.sum / b.w).toFixed(2)}`)
}
