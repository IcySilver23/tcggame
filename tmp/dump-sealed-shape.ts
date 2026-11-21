// Shape dump for the sealed-gap audit. Read-only against the live save copy.
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const root = path.resolve('.')
const home = path.join(root, 'tmp', 'sealed-gap-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
const source = new Database(path.join(root, 'data', 'tcglife.db'), { readonly: true })
await source.backup(path.join(home, 'data', 'tcglife.db'))
source.close()

const db = new Database(path.join(home, 'data', 'tcglife.db'), { readonly: true })
const { SPECIAL_PRODUCTS, SEALED_EVIDENCE } = await import('../server/catalog/sealed-evidence')

const bySet = new Map<string, { id: string; kind: string; name: string }[]>()
for (const p of SPECIAL_PRODUCTS) {
  const list = bySet.get(p.setId) ?? []
  list.push({ id: p.id, kind: p.kind ?? 'special', name: p.name })
  bySet.set(p.setId, list)
}
console.log(`special rows=${SPECIAL_PRODUCTS.length} across ${bySet.size} sets`)
for (const [setId, list] of [...bySet.entries()].sort()) {
  console.log(`\n[${setId}] ${list.length}`)
  for (const p of list) console.log(`  ${p.id} (${p.kind}) ${p.name}`)
}

const rows = db.prepare('SELECT id, set_id, kind, name FROM pack_products').all() as { id: string; set_id: string; kind: string; name: string }[]
const rowIds = new Set(rows.map((r) => r.id))
const orphans = Object.keys(SEALED_EVIDENCE).filter((id) => !rowIds.has(id))
console.log(`\nevidence rows=${Object.keys(SEALED_EVIDENCE).length} without a product row=${orphans.length}`)
console.log(orphans.join(' '))

const hasCards = new Set((db.prepare('SELECT DISTINCT set_id FROM cards').all() as { set_id: string }[]).map((r) => r.set_id))
const skipped = [...bySet.keys()].filter((s) => !hasCards.has(s))
console.log(`\nspecial sets with no cards (never seeded): ${skipped.join(' ') || 'none'}`)

const setIds = new Set((db.prepare('SELECT id FROM sets').all() as { id: string }[]).map((r) => r.id))
const withCardsNoProducts = [...hasCards].filter((s) => !rows.some((r) => r.set_id === s))
console.log(`sets with cards but no product rows: ${withCardsNoProducts.join(' ') || 'none'}`)

const kinds = new Map<string, number>()
for (const r of rows) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1)
console.log('\nkinds', JSON.stringify(Object.fromEntries([...kinds.entries()].sort())))

const promoish = rows.filter((r) => /promo/i.test(r.name))
console.log('product names mentioning promo:', promoish.length)
