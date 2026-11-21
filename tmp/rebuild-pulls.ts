// Rebuild every booster pull table with the current classifier. Run on a copy:
//   TCGLIFE_HOME=$PWD/tmp/audit-home node ./node_modules/tsx/dist/cli.mjs tmp/rebuild-pulls.ts
import { db } from '../server/lib/db'
import { buildPullTable } from '../server/services/packs'

const sets = db.prepare(`SELECT DISTINCT set_id FROM cards`).all() as { set_id: string }[]
let built = 0
for (const { set_id } of sets) {
  if (!db.prepare('SELECT 1 FROM pack_products WHERE id = ?').get(`${set_id}-booster`)) continue
  buildPullTable(set_id)
  built++
}
console.log(`rebuilt ${built} pull tables`)
