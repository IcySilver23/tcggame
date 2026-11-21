import { expectedPackValue } from '../server/services/packodds'
import { priceDetail, SEALED_REALIZATION, promoValueOf } from '../server/services/sealed'
for (const id of ['zsv10pt5-etb', 'rsv10pt5-etb', 'zsv10pt5-booster', 'rsv10pt5-booster']) {
  const d = priceDetail(id)
  console.log(id.padEnd(18), 'price $' + d.market, '| source', d.source, '| promo $' + promoValueOf(id))
}
for (const s of ['zsv10pt5', 'rsv10pt5']) {
  const ev = expectedPackValue(s)
  console.log(s, 'pack EV $' + ev.toFixed(2), '| 9-pack floor $' + (ev * 9 * SEALED_REALIZATION).toFixed(2))
}
