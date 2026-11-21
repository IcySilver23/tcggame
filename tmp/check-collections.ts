import { db } from '../server/lib/db'
import { COLLECTION_PRODUCTS, SEALED_EVIDENCE, SPECIAL_PRODUCTS } from '../server/catalog/sealed-evidence'
import { sellsProduct } from '../server/services/sealed'

let checks = 0
const ok = (cond: unknown, msg: string) => {
  checks++
  if (!cond) throw new Error(msg)
}

const expected: Record<string, number> = { sv3pt5: 6, sv4pt5: 7, sv6pt5: 3, sv8pt5: 9, cel25: 6 }
ok(COLLECTION_PRODUCTS.length === 31, `expected 31 rows, got ${COLLECTION_PRODUCTS.length}`)

const ids = new Set<string>()
const productIds = new Set<number>()
for (const row of COLLECTION_PRODUCTS) {
  ok(!ids.has(row.id), `${row.id}: duplicate row id`)
  ids.add(row.id)
  const shelf = row.shelf
  ok(shelf && shelf.market > 0 && shelf.kind === 'tcgplayer', `${row.id}: missing market quote`)
  const productId = Number(row.image?.match(/product\/(\d+)_/)?.[1])
  ok(productId > 0 && !productIds.has(productId), `${row.id}: duplicate or missing product id`)
  productIds.add(productId)
  ok(row.packs > 0 && row.packs <= 36, `${row.id}: packs ${row.packs}`)
  ok(row.msrp > 0, `${row.id}: msrp ${row.msrp}`)
  ok(row.promos.length === (row.promoIds?.length ?? 0), `${row.id}: promo/id length mismatch`)
  for (let i = 0; i < row.promos.length; i++) {
    const card = db.prepare('SELECT name FROM cards WHERE id = ?').get(row.promoIds![i]) as { name: string } | undefined
    ok(card, `${row.id}: promo ${row.promoIds![i]} not catalogued`)
    ok(card!.name === row.promos[i], `${row.id}: ${row.promoIds![i]} is ${card!.name}, row says ${row.promos[i]}`)
    ok(row.promoSet && row.promoIds![i].startsWith(`${row.promoSet}-`), `${row.id}: promoSet ${row.promoSet}`)
  }
  const ev = SEALED_EVIDENCE[row.id]
  ok(ev && ev.packs === row.packs, `${row.id}: evidence missing or packs differ`)
  ok(ev!.promos.length === row.promos.length, `${row.id}: evidence promos differ`)
  ok(ev!.note === row.note, `${row.id}: evidence note differs`)
  ok(sellsProduct(row.id, row.setId), `${row.id}: not sold`)
  const set = db.prepare('SELECT 1 FROM sets WHERE id = ?').get(row.setId)
  ok(set, `${row.id}: set ${row.setId} missing`)
}

for (const [setId, n] of Object.entries(expected)) {
  const got = COLLECTION_PRODUCTS.filter((r) => r.setId === setId).length
  ok(got === n, `${setId}: expected ${n} rows, got ${got}`)
}
ok(COLLECTION_PRODUCTS.every((r) => r.setId in expected), 'a row belongs to an unexpected set')

// No id collides with a product outside this table.
const all = new Set(SPECIAL_PRODUCTS.map((p) => p.id))
ok(all.size === SPECIAL_PRODUCTS.length, 'SPECIAL_PRODUCTS has duplicate ids')

// Rows without catalogued promos must say so rather than silently omitting them.
for (const row of COLLECTION_PRODUCTS) {
  if (row.promos.length === 0) ok((row.note ?? '').length > 0, `${row.id}: no promos and no note`)
}

console.log(`collections: ${checks} checks passed`)
