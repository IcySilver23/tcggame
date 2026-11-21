import { db } from '../server/lib/db'
import { ensureFullCatalog } from '../server/services/sealed'
import { allProductManifests } from '../server/services/product-manifest'

ensureFullCatalog()
for (const id of ['swsh1-etb-plus', 'swsh1-etb-plus-zamazenta']) {
  const m = allProductManifests().find((x) => x.productId === id)
  console.log(id, '| sold', m?.sold, '| packs', m?.counts.value?.packs, '| promo', m?.promos.value?.map((p) => `${p.name}/${p.cardId}`).join(', '))
  console.log('  limitation:', m?.limitations.find((l) => l.includes('spans four expansions')))
  const row = db.prepare('SELECT msrp, release_date, image_url FROM pack_products WHERE id = ?').get(id) as any
  console.log('  row:', row)
}
