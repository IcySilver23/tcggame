import { buildPullTable } from '../../server/services/packs'
import { expectedPackValue, subsetChanceFor, HOST_SUBSETS } from '../../server/services/packodds'
import { priceDetail } from '../../server/services/sealed'
const hosts = ['sm115', 'swsh45', 'swsh9', 'swsh10', 'swsh11', 'swsh12']
for (const h of hosts) buildPullTable(h)
for (const h of hosts) {
  console.log(`${h.padEnd(8)} subset ${((subsetChanceFor(h)) * 100).toFixed(2)}%  EV $${expectedPackValue(h).toFixed(2)}  booster ${JSON.stringify(priceDetail(`${h}-booster`).market)}  etb ${priceDetail(`${h}-etb`).market}`)
}
console.log('hosts', Object.keys(HOST_SUBSETS).join(','))
