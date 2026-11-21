import { db } from '../server/lib/db'
import { ensureFullCatalog } from '../server/services/sealed'
import { expectedPackValue, planFor } from '../server/services/packodds'
ensureFullCatalog()
console.log('plan10', planFor('dc1', 10).map((s) => s.count).join('+'), 'sum', planFor('dc1', 10).reduce((a, s) => a + s.count, 0))
console.log('plan7', planFor('dc1', 7).map((s) => s.count).join('+'), 'sum', planFor('dc1', 7).reduce((a, s) => a + s.count, 0))
console.log('ev', expectedPackValue('dc1'))
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%pull%'").all()
console.log('tables', tables)
const n = db.prepare('SELECT COUNT(*) AS n FROM pack_product_cards WHERE product_id = ?').get('dc1-booster') as { n: number }
console.log('dc1 pull rows', n.n)
const p = db.prepare('SELECT packs, cards_per_pack FROM pack_products WHERE id = ?').get('dc1-booster') as any
console.log('dc1 booster row', p)
