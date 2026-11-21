import { priceDetail } from '../../server/services/sealed'
import { expectedPackValue } from '../../server/services/packodds'
for (const id of ['base1-booster', 'base1-display', 'swsh12pt5-booster', 'swsh12pt5-etb', 'sv1-booster', 'sv1-etb', 'sv1-display', 'sv4pt5-etb', 'sv8-etb', 'me1-etb']) {
  const setId = id.replace(/-(booster|display|etb|bundle)$/, '')
  console.log(id.padEnd(20), 'EV', expectedPackValue(setId).toFixed(2), JSON.stringify(priceDetail(id)))
}
