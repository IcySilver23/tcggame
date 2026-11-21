// Shows any evidence row whose product is now hidden, which no evidence table
// entry may be: an evidence row is a claim that the product is real.
import { SEALED_EVIDENCE, UNSELLABLE_PRODUCTS } from '../server/catalog/sealed-evidence'

const clash = Object.keys(SEALED_EVIDENCE).filter((id) => id in UNSELLABLE_PRODUCTS)
console.log(`evidence rows=${Object.keys(SEALED_EVIDENCE).length} hidden=${Object.keys(UNSELLABLE_PRODUCTS).length}`)
console.log(clash.length ? `CONFLICTS: ${clash.join(' ')}` : 'no evidence row is hidden')
process.exit(clash.length === 0 ? 0 : 1)
