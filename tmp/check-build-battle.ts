import { db } from '../server/lib/db'
import { BUILD_BATTLE_PRODUCTS, SEALED_EVIDENCE } from '../server/catalog/sealed-evidence'
import { sellsProduct } from '../server/services/sealed'

let checks = 0
const fail = (msg: string): never => {
  throw new Error(msg)
}
const ok = (cond: unknown, msg: string) => {
  checks++
  if (!cond) fail(msg)
}

ok(BUILD_BATTLE_PRODUCTS.length === 43, `expected 43 boxes, got ${BUILD_BATTLE_PRODUCTS.length}`)

const ids = new Set<string>()
for (const row of BUILD_BATTLE_PRODUCTS) {
  ok(/^[a-z0-9]+-build-battle$/.test(row.id), `${row.id}: id shape`)
  ok(!ids.has(row.id), `${row.id}: duplicate id`)
  ids.add(row.id)
  ok(row.packs === 4, `${row.id}: packs ${row.packs}`)
  ok(row.cardsPerPack === 10, `${row.id}: cardsPerPack ${row.cardsPerPack}`)
  ok(row.promos.length === 4, `${row.id}: ${row.promos.length} promos`)
  ok(row.promoIds?.length === 4, `${row.id}: ${row.promoIds?.length} promo ids`)
  const set = db.prepare('SELECT name FROM sets WHERE id = ?').get(row.setId) as { name: string } | undefined
  ok(set, `${row.id}: set ${row.setId} missing`)
  ok(row.name === `${set!.name.replace(/^.*?—\s*/, '')} Build & Battle Box` || row.name.includes('Build & Battle Box'), `${row.id}: name ${row.name}`)
  for (let i = 0; i < (row.promoIds?.length ?? 0); i++) {
    const promo = db.prepare('SELECT name FROM cards WHERE id = ?').get(row.promoIds![i]) as { name: string } | undefined
    ok(promo, `${row.id}: promo ${row.promoIds![i]} (${row.promos[i]}) not in catalogue`)
    ok(promo!.name === row.promos[i], `${row.id}: ${row.promoIds![i]} is ${promo!.name}, row says ${row.promos[i]}`)
    ok(row.promoSet && row.promoIds![i].startsWith(`${row.promoSet}-`), `${row.id}: promoSet ${row.promoSet} vs ${row.promoIds![i]}`)
  }
  const ev = SEALED_EVIDENCE[row.id]
  ok(ev, `${row.id}: no evidence row`)
  ok(ev!.packs === 4, `${row.id}: evidence packs ${ev!.packs}`)
  ok(ev!.promos.length === 4, `${row.id}: evidence promos ${ev!.promos.length}`)
  ok(ev!.promoPolicy === undefined || ev!.promoPolicy === 'one-of', `${row.id}: promo policy ${ev!.promoPolicy}`)
  ok(sellsProduct(row.id, row.setId), `${row.id}: not sold`)
  ok(row.msrp === 19.99, `${row.id}: msrp ${row.msrp}`)
}

// No special set gets a box: Bulbapedia's list covers main expansions only.
for (const setId of ['sv3pt5', 'sv4pt5', 'sv6pt5', 'sv8pt5', 'rsv10pt5', 'zsv10pt5', 'swsh12pt5', 'me2pt5']) {
  ok(!ids.has(`${setId}-build-battle`), `${setId}: special set must not get a Build & Battle Box`)
}

// Prices: a quote exists on exactly the rows with a product id, never a zero.
const quotes = BUILD_BATTLE_PRODUCTS.filter((r) => r.shelf !== undefined)
ok(quotes.length === 28, `expected 28 quoted boxes, got ${quotes.length}`)
for (const row of quotes) {
  ok(typeof row.shelf!.market === 'number' && row.shelf!.market > 0, `${row.id}: market ${row.shelf!.market}`)
  ok(row.shelf!.kind === 'tcgplayer', `${row.id}: shelf kind ${row.shelf!.kind}`)
  ok(row.image, `${row.id}: quoted box without art`)
}

const first = new Set(BUILD_BATTLE_PRODUCTS.map((r) => r.setId))
ok(first.size === 43, `expected 43 distinct sets, got ${first.size}`)
ok(first.has('xy10') && first.has('me6'), 'the line must run Fates Collide through Delta Reign')

console.log(`build & battle: ${checks} checks passed`)
