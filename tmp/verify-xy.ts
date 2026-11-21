import { db } from '../server/lib/db'
import { ensureFullCatalog, priceDetail, sellsProduct } from '../server/services/sealed'
ensureFullCatalog()
const rows = db
  .prepare(
    `SELECT p.id, p.kind, p.packs, p.name FROM pack_products p JOIN sets s ON s.id = p.set_id
     WHERE s.series = 'XY' AND (p.id LIKE '%-etb' OR p.id LIKE '%-display' OR p.id LIKE '%-bundle' OR p.id IN ('g1-etb','dc1-booster'))
     ORDER BY p.id`,
  )
  .all() as { id: string; kind: string; packs: number; name: string }[]
for (const r of rows) {
  const d = priceDetail(r.id)
  const sold = sellsProduct(r.id, r.id.split('-')[0]) ? 'sold' : 'hidden'
  console.log([r.id, sold, r.packs, '$' + d.market, d.source, r.name].join(' | '))
}
