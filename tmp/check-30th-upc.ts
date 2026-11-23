// Verifies the 30th Celebration Ultra-Premium Collection really holds what the
// box holds: 29 Celebration packs, then one three-card Classic Collection pack
// whose three cards are all from the subset.
//
// Runs against a COPY of the save (tmp/upc-home), so the real one is untouched:
//   node ./node_modules/tsx/dist/cli.mjs tmp/check-30th-upc.ts

import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const home = path.join(process.cwd(), 'tmp', 'upc-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
{
  const src = new Database(path.join(process.cwd(), 'data', 'tcglife.db'), { readonly: true })
  await src.backup(path.join(home, 'data', 'tcglife.db'))
  src.close()
}
process.env.TCGLIFE_HOME = home

const { db } = await import('../server/lib/db')
const sealed = await import('../server/services/sealed')
const packs = await import('../server/services/packs')
const { PACK_MIX, mixedPackSpec } = await import('../server/catalog/sealed-evidence')

// The Classic Collection pack is a real printed wrapper with its own photo.
const CLASSIC_ART = 'https://tcgplayer-cdn.tcgplayer.com/product/704192_in_400x400.jpg'

let checks = 0
function check(ok: boolean, message: string): void {
  checks++
  if (!ok) throw new Error(message)
}

sealed.ensureFullCatalog()
const built = packs.buildInBoxSubsetTables()

// ---- the product row and the mix ------------------------------------------
const ids = ['me55-upc-day', 'me55-upc-night']
for (const id of ids) {
  const row = db.prepare('SELECT packs, cards_per_pack, set_id FROM pack_products WHERE id = ?').get(id) as
    | { packs: number; cards_per_pack: number; set_id: string }
    | undefined
  check(Boolean(row), `${id}: product missing from the catalogue`)
  check(row!.packs === 30, `${id}: box holds ${row!.packs} packs, not 30`)
  check(row!.set_id === 'me55', `${id}: anchored on ${row!.set_id}`)

  const mix = PACK_MIX[id]
  check(Boolean(mix), `${id}: no pack mix recorded`)
  const total = mix!.reduce((n, s) => n + s.packs, 0)
  check(total === 30, `${id}: mix totals ${total} wrappers, not 30`)

  check(mixedPackSpec(id, 0)?.setId === 'me55', `${id}: wrapper 1 is not a Celebration pack`)
  check(mixedPackSpec(id, 28)?.setId === 'me55', `${id}: wrapper 29 is not a Celebration pack`)
  const last = mixedPackSpec(id, 29)
  check(last?.setId === 'me55c', `${id}: wrapper 30 is ${last?.setId ?? 'missing'}, not the Classic Collection`)
  check(last?.cardsPerPack === 3, `${id}: the Classic Collection wrapper is ${last?.cardsPerPack ?? '?'} cards, not 3`)
}

// ---- the subset table a box-only wrapper needs -----------------------------
const subsetCards = (db.prepare('SELECT COUNT(*) AS n FROM cards WHERE set_id = ?').get('me55c') as { n: number }).n
const tableRows = (db.prepare('SELECT COUNT(*) AS n FROM pack_product_cards WHERE pack_product_id = ?').get('me55c-booster') as { n: number }).n
check(subsetCards > 0, 'the Classic Collection subset has no cards')
check(tableRows === subsetCards, `me55c-booster holds ${tableRows} of ${subsetCards} subset cards`)
check(built >= 1, `buildInBoxSubsetTables built ${built} table(s)`)

// ---- the hidden host never surfaces to a player --------------------------
check(!sealed.sellsProduct('me55c-booster', 'me55c'), 'the Classic Collection host row reports itself as sellable')
check(sealed.PULL_TABLE_HOSTS.has('me55c-booster'), 'the Classic Collection host row is not registered as a pull-table host')

const shop = await import('../server/services/shop-catalog')
const battles = await import('../server/services/packbattles')
const deals = await import('../server/services/dailydeals')

check(!shop.listProducts().some((p) => p.id === 'me55c-booster'), 'the shop shelf lists the Classic Collection host row')
const hostArt = db.prepare('SELECT image_url FROM pack_products WHERE id = ?').get('me55c-booster') as { image_url: string | null } | undefined
check(hostArt?.image_url === CLASSIC_ART, `the host row's wrapper art is "${hostArt?.image_url ?? 'missing'}"`)
check(!battles.listBattlableProducts().some((p) => p.id === 'me55c-booster'), 'pack battles list the Classic Collection host row')
check(!deals.dealsForToday().has('me55c-booster'), 'a daily deal can land on the Classic Collection host row')
// The set page answers cards and completion only — no product list at all.
const setPage = await (await fetch('http://127.0.0.1:8787/api/sets/me55c')).text()
check(!setPage.includes('me55c-booster'), 'the Classic Collection set page exposes its host row')

// Live endpoints, against the running dev API (read-only).
const shelf = await (await fetch('http://127.0.0.1:8787/api/shop/products')).json() as { id: string }[]
check(!shelf.some((p) => p.id === 'me55c-booster'), 'the shop products payload lists the Classic Collection host row')
for (const path of ['detail', 'manifest']) {
  const res = await fetch(`http://127.0.0.1:8787/api/shop/products/me55c-booster/${path}`)
  check(res.status === 404, `/api/shop/products/me55c-booster/${path} answered ${res.status}, not 404`)
}
{
  const res = await fetch('http://127.0.0.1:8787/api/shop/products/details', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: ['me55c-booster', 'me55-booster'] }),
  })
  const rows = await res.json() as { id: string }[]
  check(rows.every((r) => r.id !== 'me55c-booster'), 'the batch detail endpoint priced the Classic Collection host row')
}

// ---- open a box, wrapper by wrapper ---------------------------------------
function seed(id: string): void {
  db.prepare('INSERT INTO sealed_inventory (product_id, quantity, cost, condition, acquired_at) VALUES (?, 1, ?, ?, ?)').run(
    id,
    179.99,
    'fresh',
    new Date().toISOString(),
  )
}

function setOf(cardId: string): string {
  const row = db.prepare('SELECT set_id FROM cards WHERE id = ?').get(cardId) as { set_id: string } | undefined
  return row?.set_id ?? '?'
}

const ID = 'me55-upc-day'
seed(ID)
const first = packs.beginBox(ID)
const opened = [first]
let boxId = first.boxId
let left = first.packsLeft
while (left > 0) {
  const next = packs.openBoxNext(boxId)
  opened.push(next)
  left = next.packsLeft
}

check(opened.length === 30, `the box opened ${opened.length} wrappers, not 30`)
for (const pack of opened.slice(0, 29)) {
  check(pack.packSetId === 'me55', `wrapper ${pack.packIndex} is labelled ${pack.packSetId ?? 'nothing'}, not me55`)
  // Four commons + the rare-or-hit + the guaranteed Pikachu; the RGB phantom
  // rides on top of a pack when it lands.
  check(
    pack.cards.length === 6 || pack.cards.length === 7,
    `wrapper ${pack.packIndex} dealt ${pack.cards.length} cards, not 6 (7 with a phantom)`,
  )
  const offSet = pack.cards.filter((c) => setOf(c.cardId) !== 'me55')
  check(offSet.length === 0, `wrapper ${pack.packIndex} dealt ${offSet.length} card(s) from outside 30th Celebration`)
}

const classic = opened[29]
check(classic.packIndex === 30, `the Classic Collection wrapper is pack ${classic.packIndex}, not 30`)
check(classic.packSetId === 'me55c', `wrapper 30 is labelled ${classic.packSetId ?? 'nothing'}, not the Classic Collection`)
check(
  /Classic Collection/.test(classic.packName ?? ''),
  `wrapper 30 wears the name "${classic.packName ?? ''}", not the Classic Collection pack`,
)
check(Boolean(classic.packSymbol), 'wrapper 30 has no set symbol to fall back on')
// It has its own photo, so the ceremony must not fall back to foil-and-symbol.
check(classic.packArt === CLASSIC_ART, `wrapper 30 shows art "${classic.packArt ?? ''}", not the Classic Collection wrapper`)
check(opened[0].packArt === null, 'a 30th Celebration wrapper carries a foreign wrapper photo')
check(classic.packName !== opened[0].packName, 'wrapper 30 wears the same name as a 30th booster')
check(classic.cards.length === 3, `the Classic Collection wrapper dealt ${classic.cards.length} cards, not 3`)
const outside = classic.cards.filter((c) => setOf(c.cardId) !== 'me55c')
check(outside.length === 0, `the Classic Collection wrapper dealt ${outside.length} card(s) from outside the subset`)
check(classic.packsLeft === 0 && classic.done, 'the box is not finished after wrapper 30')

// ---- skip-to-the-end deals the same box -----------------------------------
seed('me55-upc-night')
const night = packs.beginBox('me55-upc-night')
const rest = packs.openBoxRest(night.boxId)
const skipPacks = 1 + (rest.perPack?.length ?? 0)
check(skipPacks === 30, `skip-to-end opened ${skipPacks} wrappers, not 30`)
const skipTotal = night.cards.length + rest.cards.length
const classicTotal = (rest.perPack ?? []).reduce((n, p) => n + (p.cards?.length ?? 0), 0) + night.cards.length
check(skipTotal === classicTotal, 'skip-to-end card count disagrees with its per-pack breakdown')
const skippedClassicCards = rest.perPack?.[rest.perPack.length - 1]?.cards ?? []
check(skippedClassicCards.length === 3, `skip-to-end's last wrapper dealt ${skippedClassicCards.length} cards, not 3`)
check(
  skippedClassicCards.every((c) => setOf(c.cardId) === 'me55c'),
  "skip-to-end's last wrapper holds cards from outside the Classic Collection",
)

console.log(`PASS — ${checks} checks`)
console.log(`  wrapper 30: ${classic.cards.map((c) => c.cardId).join(', ')}`)
console.log(`  skip: ${skipPacks} wrappers, ${skipTotal} cards (last ${skippedClassicCards.length})`)
