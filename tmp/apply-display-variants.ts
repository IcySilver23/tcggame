// Applies the display variants to the save: seedSpecialProducts runs inside
// ensureFullCatalog, which is idempotent and the same path boot uses.
import { ensureFullCatalog, priceDetail } from '../server/services/sealed'
import { allProductManifests } from '../server/services/product-manifest'

const added = ensureFullCatalog()
console.log('products added:', added)
const ids = [
  'sv9-display-enhanced',
  'sv6-half-display',
  'sv7-half-display',
  'sv8-half-display',
  'sv9-half-display',
  'sv10-half-display',
]
for (const id of ids) {
  const p = priceDetail(id)
  const m = allProductManifests().find((x) => x.productId === id)
  console.log(id.padEnd(22), '$' + p.market, p.source, '|', m?.kind, m?.counts.value?.packs + 'p', '| promos:', m?.promos.value?.map((x) => x.name).join('/') || 'none')
}
