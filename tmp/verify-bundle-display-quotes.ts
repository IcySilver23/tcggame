import { BUNDLE_DISPLAY_SHELF, shelfPriceFor } from '../server/catalog/sealed-evidence'

let ok = 0
for (const [id, expected] of Object.entries(BUNDLE_DISPLAY_SHELF)) {
  const quote = shelfPriceFor(id)
  if (!quote) throw new Error(`${id} did not resolve a shelf quote`)
  if (quote.market !== expected.market) throw new Error(`${id} market ${quote.market} != ${expected.market}`)
  if (quote.kind !== 'tcgplayer') throw new Error(`${id} kind ${quote.kind} != tcgplayer`)
  if (quote.asOf !== '2026-11-13') throw new Error(`${id} asOf ${quote.asOf}`)
  if (!quote.source.url?.endsWith(String(expected.productId))) throw new Error(`${id} source ${quote.source.url}`)
  if (!quote.source.label.includes(expected.product)) throw new Error(`${id} label ${quote.source.label}`)
  ok++
}
console.log(`${ok} bundle/display quotes resolve as TCGplayer listings on 2026-11-13`)
