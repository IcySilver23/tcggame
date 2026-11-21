// Seeds and prints the Pokémon Center Elite Trainer Boxes.
//
// Run on a copy of the save:
//   TCGLIFE_HOME=$PWD/tmp/pc-home node ./node_modules/tsx/dist/cli.mjs tmp/apply-pc-etbs.ts

import { ensureFullCatalog, priceDetail } from '../server/services/sealed'
import { PC_ETB_SETS } from '../server/catalog/sealed-evidence'

console.log('products added:', ensureFullCatalog())
const rows = [...PC_ETB_SETS].sort().map((setId) => {
  const id = `${setId}-etb-pc`
  const pc = priceDetail(id)
  const plain = priceDetail(`${setId}-etb`)
  return `${id.padEnd(20)} $${pc.market.toFixed(2).padStart(7)} ${pc.source.padEnd(10)} | regular ETB $${plain.market.toFixed(2)}`
})
console.log(rows.join('\n'))
