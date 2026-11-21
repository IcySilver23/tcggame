// One-off: append the fetched MEP promo set to server/catalog/local-releases.json.
//
// The loader reads one file, and local-releases.json is the project's place for
// sets the main catalogue API has not published. The promo set is additive and
// idempotent here in the same way the loader is: removing any previous mep rows
// before appending means re-running this script cannot duplicate a card.
//
// Run after tmp/mep/fetch.mjs:
//   node tmp/mep/fetch.mjs && node tmp/mep/merge.mjs

import { readFileSync, writeFileSync } from 'node:fs'

const CATALOG = 'server/catalog/local-releases.json'
const fragment = JSON.parse(readFileSync('tmp/mep/cards.json', 'utf8'))
const data = JSON.parse(readFileSync(CATALOG, 'utf8'))

const SET_ID = fragment.set.id
const before = {
  sets: data.sets.length,
  cards: data.cards.length,
  products: data.products.length,
}

data.sets = data.sets.filter((s) => s.id !== SET_ID)
data.cards = data.cards.filter((c) => c.set_id !== SET_ID)
data.sets.push(fragment.set)
data.cards.push(...fragment.cards)

// A promo set has no wrapper of its own, so it contributes no sealed product:
// `productsForSet` refuses promo sets and nothing is added here.
data.release = `${data.release.split(' + MEP promos')[0]} + MEP promos`
data.note = `${data.note.split(' The MEP Black Star Promos are added')[0]} The MEP Black Star Promos are added from TCGdex: identity, numbering, rarity, artwork and TCGplayer USD market prices as published there, with the four Build & Battle Box promos TCGdex omits (MEP 111-114) taken from the TCGplayer mirror tcgcsv, which publishes no illustrator or Pokédex number for them. MEP 115-118 are not imported: Bulbapedia's promo pages for them redirect to the set printings they reprint (Spritzee Perfect Order 35, Seel Perfect Order 18, Kyogre Delta Reign 26, Mega Rayquaza ex Delta Reign 84), so the products that carry them hand over those set cards. The set is the promo programme, not a booster line, so it ships no sealed product of its own; its cards exist so the 30th Celebration, Ascended Heroes and Delta Reign boxes can hand out the promo they actually contain.`

writeFileSync(CATALOG, JSON.stringify(data, null, 1) + '\n')
console.log(
  `merged ${SET_ID}: sets ${before.sets} -> ${data.sets.length}, cards ${before.cards} -> ${data.cards.length}, products ${data.products.length} (promo sets sell none)`,
)
console.log(`  release: ${data.release}`)
