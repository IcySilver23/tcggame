import { buildPullTable } from '../../server/services/packs'
import { expectedPackValue } from '../../server/services/packodds'
import { priceDetail } from '../../server/services/sealed'

const ids = ['me1', 'me2', 'me2pt5', 'me3', 'me4', 'me5', 'me6', 'sv4pt5', 'swsh12pt5', 'swsh12pt5gg']
for (const id of ids) {
  buildPullTable(id)
  console.log(`${id.padEnd(11)} EV/pack $${expectedPackValue(id).toFixed(2)}  booster ${JSON.stringify(priceDetail(`${id}-booster`).market)}`)
}
