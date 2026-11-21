import { promoValueOf, derivedPrice, priceDetail } from '../../server/services/sealed'
for (const id of ['swsh12pt5-etb', 'sv4pt5-etb', 'sv1-etb', 'swsh12pt5-booster']) {
  const setId = id.replace(/-(etb|booster)$/, '')
  const kind = id.endsWith('etb') ? 'etb' : 'booster'
  console.log(id, 'promo', promoValueOf(id), 'derived', derivedPrice(setId, kind), JSON.stringify(priceDetail(id)))
}
