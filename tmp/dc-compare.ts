import { SPECIAL_PRODUCTS } from '../server/catalog/sealed-evidence'
import { planFor } from '../server/services/packodds'
for (const p of SPECIAL_PRODUCTS) {
  const plan = planFor(p.setId, 10).reduce((a, s) => a + s.count, 0)
  if (plan !== p.cardsPerPack) console.log(p.id, 'declared', p.cardsPerPack, 'plan10', plan)
}
console.log('rows', SPECIAL_PRODUCTS.length)
