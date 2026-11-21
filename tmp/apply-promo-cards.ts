// Applies the two seeded SVP promo rows to the live save — the same additive
// write the app performs at boot. Prints what the save now knows.
import { applyPromoCards } from '../server/catalog/promo-cards'
import { db } from '../server/lib/db'
import { promoValueOf } from '../server/services/sealed'

console.log('apply:', JSON.stringify(applyPromoCards()))
for (const id of ['svp-209', 'svp-210']) {
  const card = db.prepare('SELECT id, name, number, rarity, hp, artist FROM cards WHERE id = ?').get(id)
  const price = db.prepare("SELECT market FROM price_records WHERE card_id = ? AND kind = 'tcgplayer'").get(id) as { market: number } | undefined
  console.log(id, JSON.stringify(card), 'price', price?.market)
}
for (const box of ['zsv10pt5-etb', 'rsv10pt5-etb']) {
  console.log(box, 'promo value', promoValueOf(box))
}
