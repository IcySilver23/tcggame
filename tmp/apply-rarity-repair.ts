// Applies the Black White Rare relabel to the live save, then measures the packs
// and boxes it prices. The app performs the same repair at boot.
import { repairBlackWhiteRarities } from '../server/catalog/rarity-repairs'
import { expectedPackValue } from '../server/services/packodds'
import { priceOf } from '../server/services/sealed'
import { db } from '../server/lib/db'

console.log('repair:', JSON.stringify(repairBlackWhiteRarities()))
for (const s of ['zsv10pt5', 'rsv10pt5']) {
  const cards = db.prepare(`SELECT id, name, rarity FROM cards WHERE id IN (?, ?)`).all(`${s}-171`, `${s}-172`)
  const slots = db.prepare(`SELECT p.card_id, p.slot, ROUND(p.weight, 4) w FROM pack_product_cards p WHERE p.pack_product_id = ? AND p.card_id IN (?, ?)`).all(`${s}-booster`, `${s}-171`, `${s}-172`)
  console.log(s, 'EV $' + expectedPackValue(s).toFixed(2), JSON.stringify({ cards, slots }))
}
for (const id of [
  'zsv10pt5-booster', 'zsv10pt5-bundle', 'zsv10pt5-etb',
  'rsv10pt5-booster', 'rsv10pt5-bundle', 'rsv10pt5-etb',
  'swsh12pt5-etb',
]) {
  const p = priceOf(id)
  console.log(id.padEnd(16), '$' + p.market, '|', p.source)
}
