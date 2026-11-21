import { db } from '../server/lib/db'
import { ensureFullCatalog, priceDetail, sellsProduct } from '../server/services/sealed'
ensureFullCatalog()
const ids = ['xy1-etb-yveltal', 'xy5-etb-kyogre', 'xy8-etb-mewtwo-y', 'xy12-etb-blastoise', 'xy0-booster', 'g1-booster', 'xy0-etb', 'xy0-display']
for (const id of ids) {
  const row = db.prepare('SELECT name, packs FROM pack_products WHERE id = ?').get(id) as { name: string; packs: number } | undefined
  const d = priceDetail(id)
  console.log([id, sellsProduct(id, id.slice(0, 3)) ? 'sold' : 'hidden', row?.packs, '$' + d.market, d.source, row?.name ?? 'MISSING'].join(' | '))
}
