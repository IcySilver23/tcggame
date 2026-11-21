// Sets that only came inside another product have no sealed rows at all now:
// the prune removes the legacy wrappers and ensureFullCatalog never recreates
// them.
//   TCGLIFE_HOME=$PWD/tmp/audit-home node ./node_modules/tsx/dist/cli.mjs tmp/check-subset-shelf.ts
import { db } from '../server/lib/db'
import { ensureFullCatalog, sellsOwnPacks } from '../server/services/sealed'

const hidden = ['sma', 'swsh45sv', 'swsh9tg', 'swsh10tg', 'swsh11tg', 'swsh12tg', 'swsh12pt5gg', 'sve', 'cel25c', 'me55c']
ensureFullCatalog()
const rows = db
  .prepare(
    `SELECT p.id, p.set_id, s.name, s.series, s.release_date
     FROM pack_products p JOIN sets s ON s.id = p.set_id
     ORDER BY p.id`,
  )
  .all() as { id: string; set_id: string; name: string; series: string; release_date: string }[]
const shelf = rows.filter((r) => sellsOwnPacks(r.set_id))
const legacy = rows.filter((r) => hidden.includes(r.set_id))

console.log(`products in db ${rows.length} | offered by the shop filter ${shelf.length} | rows for subset-only sets ${legacy.length}`)
console.log(`cel25 products still offered: ${shelf.filter((r) => r.set_id === 'cel25').length}`)

// A seed after the prune must not bring one back.
const added = ensureFullCatalog()
const after = (db.prepare(`SELECT COUNT(*) AS n FROM pack_products WHERE set_id IN (${hidden.map(() => '?').join(',')})`).get(...hidden) as { n: number }).n
console.log(`subset rows after re-seed: ${after} (added ${added} products overall)`)

const ok = legacy.length === 0 && after === 0 && shelf.some((r) => r.set_id === 'cel25')
console.log(ok ? 'ok: subset rows are deleted and stay deleted' : 'FAIL: a subset row survived or came back')
process.exit(ok ? 0 : 1)
