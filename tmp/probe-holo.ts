import { db } from '../server/lib/db'
import { valueOf } from '../server/services/market'
for (const setId of ['zsv10pt5', 'rsv10pt5']) {
  const rows = db.prepare(`SELECT p.card_id, p.weight, p.slot, c.name, c.rarity FROM pack_product_cards p JOIN cards c ON c.id=p.card_id WHERE p.pack_product_id=? AND p.slot IN ('holo')`).all(`${setId}-booster`) as any[]
  console.log('\n###', setId)
  for (const r of rows) {
    const prices = db.prepare(`SELECT kind, variant, market FROM price_records WHERE card_id=? AND market IS NOT NULL ORDER BY market DESC`).all(r.card_id) as any[]
    console.log(r.card_id.padEnd(14), (r.name + ' [' + r.rarity + ']').padEnd(32), 'w=' + r.weight.toFixed(4), 'v(holo)=$' + valueOf(r.card_id, 'holofoil').toFixed(2), 'v()=$' + valueOf(r.card_id).toFixed(2), JSON.stringify(prices.slice(0, 3)))
  }
}
