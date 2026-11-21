import { buildPullTable } from '../server/services/packs'
import { expectedPackValue, upgradeChance, upgradeOdds } from '../server/services/packodds'
import { priceOf } from '../server/services/sealed'
buildPullTable('sv8pt5', 10)
console.log('upgradeOdds', JSON.stringify(upgradeOdds('sv8pt5')))
console.log('upgradeChance', upgradeChance('sv8pt5').toFixed(4), 'EV $' + expectedPackValue('sv8pt5').toFixed(2))
console.log('sv8pt5-booster', '$' + priceOf('sv8pt5-booster').market)
console.log('sv8pt5-bundle', '$' + priceOf('sv8pt5-bundle').market)
console.log('sv8pt5-etb', '$' + priceOf('sv8pt5-etb').market)
