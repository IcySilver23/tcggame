import { packSlots } from '../../server/services/packodds'
import { priceDetail } from '../../server/services/sealed'
import { expectedPackValue } from '../../server/services/packodds'
const subset = packSlots('swsh12pt5').find((s) => s.slot === 'subset')
console.log('subset slot:', JSON.stringify(subset))
console.log('EV', expectedPackValue('swsh12pt5').toFixed(2))
for (const id of ['swsh12pt5-booster', 'swsh12pt5-bundle', 'swsh12pt5-etb', 'swsh12pt5-display']) console.log(id.padEnd(20), JSON.stringify(priceDetail(id)))
