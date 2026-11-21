// One-off: what the shop now charges for the special products.
import { priceDetail } from '../../server/services/sealed'
for (const id of ['me55-mini-tin', 'me55-poster', 'me55-tech-sticker', 'me55-etb', 'me55-sylveon-ex-box', 'me55-upc-day', 'me55-2pack-blister', 'me55-knockout', 'me2pt5-mini-tin', 'me2pt5-premium-poster', 'me2pt5-first-partners-pin', 'me2pt5-etb']) {
  const d = priceDetail(id)
  console.log(`${id}: $${d.market} (${d.source}, ${d.status})`)
}
