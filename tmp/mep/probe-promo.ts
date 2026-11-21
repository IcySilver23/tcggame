import { promoValueOf, priceDetail, derivedPrice } from '../../server/services/sealed'
for (const id of ['sv3-etb', 'sv3pt5-etb', 'sv4pt5-etb', 'sv1-etb']) console.log(id, 'promo', promoValueOf(id), 'derived', derivedPrice(id.replace(/-etb$/, ''), 'etb'), JSON.stringify(priceDetail(id)))
