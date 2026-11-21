import { buildPullTable } from '../../server/services/packs'
import { expectedPackValue } from '../../server/services/packodds'
import { priceDetail } from '../../server/services/sealed'
import { db } from '../../server/lib/db'
buildPullTable('swsh12pt5')
const rows = db.prepare("SELECT card_id, weight FROM pack_product_cards WHERE pack_product_id='swsh12pt5-booster' AND slot='subset'").all() as { card_id: string; weight: number }[]
const total = rows.reduce((a, r) => a + r.weight, 0)
console.log('subset rows', rows.length, 'weight sum', total.toFixed(6), '(unused: slot EV uses the 0.352 rate)')
console.log('EV', expectedPackValue('swsh12pt5'))
for (const id of ['swsh12pt5-booster', 'swsh12pt5-etb']) console.log(id, JSON.stringify(priceDetail(id)))
