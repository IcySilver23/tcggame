import { buildPullTable } from '../../server/services/packs'
import { expectedPackValue, subsetChanceFor } from '../../server/services/packodds'
import { priceDetail } from '../../server/services/sealed'

buildPullTable('swsh12pt5')
buildPullTable('swsh12pt5gg')
console.log('subset chance', subsetChanceFor('swsh12pt5'))
console.log('EV per pack  ', expectedPackValue('swsh12pt5').toFixed(2))
for (const id of ['swsh12pt5-booster', 'swsh12pt5-bundle', 'swsh12pt5-etb', 'swsh12pt5-display', 'swsh12pt5gg-booster']) {
  console.log(id.padEnd(22), JSON.stringify(priceDetail(id)))
}
