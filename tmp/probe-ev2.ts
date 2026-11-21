import { expectedPackValue, upgradeOdds, upgradeChance, planFor } from '../server/services/packodds'
import { db } from '../server/lib/db'
import { valueOf } from '../server/services/market'
for (const setId of ['zsv10pt5', 'rsv10pt5', 'sv8pt5', 'swsh12pt5']) {
  const rows = db.prepare(`SELECT p.card_id, p.weight, p.slot, c.rarity, c.name FROM pack_product_cards p JOIN cards c ON c.id=p.card_id WHERE p.pack_product_id=?`).all(`${setId}-booster`) as any[]
  console.log('\n###', setId, 'EV $' + expectedPackValue(setId).toFixed(2), '| upgradeChance', upgradeChance(setId).toFixed(4))
  console.log('  upgradeOdds', JSON.stringify(upgradeOdds(setId)))
  const bySlot: Record<string, { w: number; contrib: number; top: string[] }> = {}
  for (const r of rows) {
    const variant = r.slot === 'holo' || r.slot === 'hit' ? 'holofoil' : 'normal'
    const v = valueOf(r.card_id, variant as any)
    const s = (bySlot[r.slot] ??= { w: 0, contrib: 0, top: [] })
    s.w += r.weight
    s.contrib += r.weight * v
    s.top.push(`${r.name}(${r.rarity}) $${v.toFixed(0)} w=${r.weight.toFixed(4)}`)
  }
  for (const [slot, s] of Object.entries(bySlot)) {
    console.log('  ', slot, 'weight', s.w.toFixed(3), 'sum(w*v) $' + s.contrib.toFixed(2))
    for (const t of s.top.slice(0, 3)) console.log('       ', t)
  }
}
