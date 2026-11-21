import { db } from '../server/lib/db'
import { sellsProduct, SUBSET_ONLY_SETS, NO_BOOSTER_SETS } from '../server/services/sealed'
import { unsellableReason } from '../server/catalog/sealed-evidence'

const rows = db
  .prepare(
    `SELECT p.id, p.set_id, p.kind, p.name, s.name AS set_name
     FROM pack_products p JOIN sets s ON s.id = p.set_id
     ORDER BY p.set_id, p.kind`,
  )
  .all() as { id: string; set_id: string; kind: string; name: string; set_name: string }[]

const always = rows.filter((r) => SUBSET_ONLY_SETS.has(r.set_id) || NO_BOOSTER_SETS.has(r.set_id))
const refused = rows.filter((r) => unsellableReason(r.id) !== null)
const hidden = rows.filter((r) => !sellsProduct(r.id, r.set_id))
const overlap = always.filter((r) => refused.some((x) => x.id === r.id))

console.log(`rows=${rows.length} hidden=${hidden.length} no-wrapper=${always.length} refused=${refused.length} overlap=${overlap.length}`)
for (const [label, list] of [
  ['subset/no-booster', always],
  ['never-shipped product', refused],
] as const) {
  console.log(`\n${label}: ${list.length}`)
  const bySet = new Map<string, string[]>()
  for (const r of list) bySet.set(r.set_id, [...(bySet.get(r.set_id) ?? []), r.id])
  for (const [set, ids] of [...bySet].sort()) console.log(`  ${set}: ${ids.join(', ')}`)
}

// Any hidden row with sealed stock is kept on purpose; show it so the prune
// does not silently strand an owned box.
const held = hidden.filter((r) => (db.prepare('SELECT 1 FROM sealed_inventory WHERE product_id = ? AND quantity > 0').get(r.id)))
console.log(`\nhidden rows with owned stock: ${held.length}`)
for (const r of held) console.log(`  ${r.id}`)
