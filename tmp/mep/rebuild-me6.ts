import { buildPullTable } from '../../server/services/packs'
import { expectedPackValue, secondSlotUpgradeOdds, upgradeOdds } from '../../server/services/packodds'
import { priceDetail } from '../../server/services/sealed'
import { db } from '../../server/lib/db'

buildPullTable('me6')
console.log('upgrade odds', JSON.stringify(upgradeOdds('me6')))
console.log('second slot', JSON.stringify(secondSlotUpgradeOdds('me6')))
const slots = db.prepare(`SELECT slot, COUNT(*) AS n, ROUND(SUM(weight),4) AS w FROM pack_product_cards WHERE pack_product_id='me6-booster' GROUP BY slot ORDER BY w DESC`).all()
console.log('slots', JSON.stringify(slots))
console.log('EV per pack', expectedPackValue('me6').toFixed(2))
console.log('xxxxxx')
for (const id of ['me6-booster', 'me6-single-blister', 'me6-triple-blister']) console.log(id, JSON.stringify(priceDetail(id)))
