import { db } from '../server/lib/db'
import { ensureFullCatalog } from '../server/services/sealed'
import { planFor, expectedPackValue } from '../server/services/packodds'
ensureFullCatalog()
for (const id of ['bw1','bw6','bw7','bw8','bw10','bw11','dv1']) {
  console.log(id, 'plan5', planFor(id, 5).reduce((a, s) => a + s.count, 0), 'ev', expectedPackValue(id))
}
const rows = db.prepare("SELECT p.id, p.packs, p.cards_per_pack FROM pack_products p JOIN sets s ON s.id=p.set_id WHERE s.series='Black & White' ORDER BY p.id").all()
console.log('rows', rows.length)
