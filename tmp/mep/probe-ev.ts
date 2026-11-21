import { expectedPackValue } from '../../server/services/packodds'
import { derivedPrice, priceOf } from '../../server/services/sealed'
import { db } from '../../server/lib/db'
for (const id of ['swsh12pt5', 'sv1']) {
  const p = db.prepare('SELECT packs, msrp FROM pack_products WHERE id = ?').get(`${id}-etb`) as any
  const b = db.prepare('SELECT packs FROM pack_products WHERE id = ?').get(`${id}-booster`) as any
  console.log(id, 'EV', expectedPackValue(id), 'etb packs', p?.packs, 'msrp', p?.msrp, 'booster packs', b?.packs,
    'derived etb', derivedPrice(id, 'etb'), 'derived booster', derivedPrice(id, 'booster'), JSON.stringify(priceOf(`${id}-etb`)))
}
