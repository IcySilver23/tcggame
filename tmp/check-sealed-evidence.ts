// Pins the modern sealed-product evidence to the catalogue.
//
// Run on a copy of the save:
//   TCGLIFE_HOME=$PWD/tmp/audit-home node ./node_modules/tsx/dist/cli.mjs tmp/check-sealed-evidence.ts

import { db } from '../server/lib/db'
import { ensureFullCatalog, priceDetail, sellsProduct, PULL_TABLE_HOSTS } from '../server/services/sealed'
import { openSealed } from '../server/services/packs'
import { packsInBox } from '../server/services/packbattles'
import { expectedPackValue } from '../server/services/packodds'
import { allProductManifests } from '../server/services/product-manifest'
import { BW_BOOSTER_SHELF, DUAL_ART_ETBS, PACK_MIX, PC_ETB_SETS, PC_ETB_SHELF, SEALED_EVIDENCE, SPECIAL_BUNDLE_SETS, SPECIAL_PRODUCTS, UNSELLABLE_PRODUCTS, XY_BOOSTER_SHELF, XY_ETB_SHELF, mixedPackSetId, shelfPriceFor } from '../server/catalog/sealed-evidence'

let checks = 0
function check(ok: boolean, message: string): void {
  checks++
  if (!ok) throw new Error(message)
}

ensureFullCatalog()
const manifests = new Map(allProductManifests().map((m) => [m.productId, m]))

for (const [id, evidence] of Object.entries(SEALED_EVIDENCE)) {
  const m = manifests.get(id)
  check(Boolean(m), `evidence product missing from catalogue: ${id}`)
  if (!m) continue
  check(m.sold, `evidence product is hidden: ${id}`)
  check(m.counts.value?.packs === evidence.packs, `${id}: packs ${m.counts.value?.packs} != ${evidence.packs}`)
  const actual = (m.promos.value ?? []).map((p) => p.name).sort().join('|')
  const expected = [...evidence.promos].sort().join('|')
  check(actual === expected, `${id}: promos "${actual}" != "${expected}"`)
  if (evidence.promos.length === 0) check(m.promos.status === 'verified', `${id}: empty promo set should be verified`)
  if (evidence.promos.length > 0) check(m.promos.status === 'verified', `${id}: named promo should be verified`)
}

for (const id of SPECIAL_BUNDLE_SETS) {
  const m = manifests.get(`${id}-bundle`)
  check(Boolean(m), `${id}: special-set bundle missing`)
  if (m) check(m.counts.value?.packs === 6, `${id}: bundle packs ${m.counts.value?.packs} != 6`)
}

for (const id of Object.keys(UNSELLABLE_PRODUCTS)) {
  if (PULL_TABLE_HOSTS.has(id)) {
    check(manifests.has(id) && !sellsProduct(id, id.split('-')[0]), `${id}: pull-table host is missing or sold`)
    continue
  }
  check(!manifests.has(id), `never-shipped product is still catalogued: ${id}`)
  check(!sellsProduct(id, id.split('-')[0]), `${id}: never-shipped product is offered`)
}

// Special products beyond the era line — poster and binder collections, tech
// sticker collections, mini tins and premium boxes. Each row's pack count and
// promo list is published product copy, not the generated bundle/ETB shape.
const SPECIAL_EXPECTATIONS: Record<string, { packs: number; promos: string[] }> = {
  'me55-poster': { packs: 3, promos: ['Articuno', 'Zapdos', 'Moltres'] },
  'me55-tech-sticker': { packs: 3, promos: ['Alolan Exeggutor', 'Lucario'] },
  'me55-binder': { packs: 5, promos: [] },
  'me55-mini-tin': { packs: 2, promos: [] },
  'me55-knockout': { packs: 2, promos: ['Eevee'] },
  'me55-sylveon-ex-box': { packs: 4, promos: ['Sylveon ex'] },
  'me55-greninja-ex-box': { packs: 4, promos: ['Greninja ex'] },
  'me2pt5-tech-sticker': { packs: 3, promos: ['Charmander', 'Gastly'] },
  'me2pt5-mini-tin': { packs: 2, promos: [] },
  'me2pt5-premium-poster': { packs: 10, promos: ['Mega Lucario ex', 'Mega Gardevoir ex'] },
  'me2pt5-first-partners-pin': { packs: 5, promos: ['Chikorita', 'Tepig', 'Totodile'] },
  'me2pt5-mega-meganium-box': { packs: 4, promos: ['Mega Meganium ex'] },
  'me2pt5-mega-emboar-box': { packs: 4, promos: ['Mega Emboar ex'] },
  'me2pt5-mega-feraligatr-box': { packs: 4, promos: ['Mega Feraligatr ex'] },
}
for (const [id, want] of Object.entries(SPECIAL_EXPECTATIONS)) {
  const m = manifests.get(id)
  check(Boolean(m), `special product missing from catalogue: ${id}`)
  if (!m) continue
  check(m.kind === 'special', `${id}: kind is ${m.kind}`)
  check(m.sold, `${id}: special product is hidden`)
  check(m.counts.value?.packs === want.packs, `${id}: packs ${m.counts.value?.packs} != ${want.packs}`)
  check(m.promos.status === 'verified', `${id}: promos are ${m.promos.status}`)
  const promos = (m.promos.value ?? []).map((p) => p.name)
  check(promos.join('|') === want.promos.join('|'), `${id}: promos "${promos.join(', ')}" != "${want.promos.join(', ')}"`)
  // A pair means the box held one of them, so neither is guaranteed; a box the
  // evidence marks 'all' holds every named promo, and a lone promo is certain.
  if (want.promos.length > 0) {
    const all = SEALED_EVIDENCE[id]?.promoPolicy === 'all'
    check(
      (m.promos.value ?? []).every((p) => p.guaranteed === (all || want.promos.length === 1)),
      `${id}: promo guarantee drifted from the source`,
    )
  }
  if (m.setId === 'me55') check(m.counts.value?.physicalCardsPerPack === 6, `${id}: physical 30C wrapper is not 6`)
  if (m.setId === 'me2pt5') check(m.counts.value?.physicalCardsPerPack === 10, `${id}: Ascended Heroes wrapper is not 10`)
}

// A mapped promo id has to be a real, priced catalogue card: the opener only
// hands over a promo it can value, so an id with no price would be a silent
// "no promo" in every box.
const pricedCard = db.prepare('SELECT market FROM price_records WHERE card_id = ? AND market IS NOT NULL LIMIT 1')
for (const [id, e] of Object.entries(SEALED_EVIDENCE)) {
  if (!e.promoIds) continue
  check(e.promoIds.length === e.promos.length, `${id}: promo ids and names disagree in length`)
  for (const [i, cardId] of e.promoIds.entries()) {
    const card = db.prepare('SELECT name FROM cards WHERE id = ?').get(cardId) as { name: string } | undefined
    check(Boolean(card), `${id}: promo ${e.promos[i]} maps to ${cardId}, which is not a catalogue card`)
    check(
      !card || card.name.toLowerCase() === e.promos[i].toLowerCase(),
      `${id}: promo name ${e.promos[i]} does not match ${cardId} (${card?.name})`,
    )
    check(Boolean(pricedCard.get(cardId)), `${id}: promo ${e.promos[i]} (${cardId}) has no price, so no box could grant it`)
  }
}

// Every special product that names a card promo must map it to a printing,
// apart from the products whose copy names none and the one documented gap.
const UNMAPPED_SPECIALS: Record<string, string> = {
  'me55-binder': 'names no card promo',
  'me55-mini-tin': 'names no card promo',
  'me2pt5-mini-tin': 'names no card promo',
  'swsh12pt5-bundle': 'a six-pack Booster Bundle carries no promo',
  'swsh7-half-display': 'an 18-pack half display carries no promo',
  'swsh10-half-display': 'an 18-pack half display carries no promo',
  'swsh6-etb-pc': 'a Sword & Shield Pokémon Center ETB carries no promo',
  'swsh6-etb-pc-shadow': 'a Sword & Shield Pokémon Center ETB carries no promo',
  'swsh7-etb-pc': 'a Sword & Shield Pokémon Center ETB carries no promo',
  'swsh7-etb-pc-glaceon': 'a Sword & Shield Pokémon Center ETB carries no promo',
  'swsh8-etb-pc': 'a Sword & Shield Pokémon Center ETB carries no promo',
  'swsh9-etb-pc': 'a Sword & Shield Pokémon Center ETB carries no promo',
  'swsh10-etb-pc': 'a Sword & Shield Pokémon Center ETB carries no promo',
  'swsh11-etb-pc': 'a Sword & Shield Pokémon Center ETB carries no promo',
  'swsh12-etb-pc': 'a Sword & Shield Pokémon Center ETB carries no promo',
  'swsh12pt5-etb-pc': 'the Crown Zenith Plus box names no promo in the copy read here',
  'sv6-half-display': 'an 18-pack half display carries no promo',
  'sv7-half-display': 'an 18-pack half display carries no promo',
  'sv8-half-display': 'an 18-pack half display carries no promo',
  'sv9-half-display': 'an 18-pack half display carries no promo',
  'sv10-half-display': 'an 18-pack half display carries no promo',
  // Regular ETBs: the Sun & Moon and Sword & Shield boxes carried no promo, and
  // the split arts do not change that. Paradox Rift and Temporal Forces do name
  // their art's promo and stay out of this list.
  'sm1-etb': 'a Sun & Moon regular ETB carries no promo',
  'sm1-etb-lunala': 'a Sun & Moon regular ETB carries no promo',
  'sm5-etb': 'a Sun & Moon regular ETB carries no promo',
  'sm5-etb-dusk-mane': 'a Sun & Moon regular ETB carries no promo',
  'swsh1-etb': 'a main-line Sword & Shield ETB carries no promo',
  'swsh1-etb-zamazenta': 'a main-line Sword & Shield ETB carries no promo',
  'swsh5-etb': 'a main-line Sword & Shield ETB carries no promo',
  'swsh5-etb-rapid-strike': 'a main-line Sword & Shield ETB carries no promo',
  'swsh6-etb': 'a main-line Sword & Shield ETB carries no promo',
  'swsh6-etb-shadow-rider': 'a main-line Sword & Shield ETB carries no promo',
  'swsh7-etb': 'a main-line Sword & Shield ETB carries no promo',
  'swsh7-etb-glaceon': 'a main-line Sword & Shield ETB carries no promo',
  // XY regular ETBs carried no promo card; Generations is the exception and
  // names Shaymin-EX, so it is not in this list.
  'xy1-etb': 'a main XY ETB carries no promo',
  'xy1-etb-yveltal': 'a main XY ETB carries no promo',
  'xy5-etb': 'a main XY ETB carries no promo',
  'xy5-etb-kyogre': 'a main XY ETB carries no promo',
  'xy8-etb': 'a main XY ETB carries no promo',
  'xy8-etb-mewtwo-y': 'a main XY ETB carries no promo',
  'xy12-etb': 'a main XY ETB carries no promo',
  'xy12-etb-blastoise': 'a main XY ETB carries no promo',
  'dc1-blister': 'the Double Crisis blister carried packs, not a promo card',
  'dv1-blister': 'the Dragon Vault blister carried packs and a random variant card, not a fixed promo',
  // Collection products whose contents name no promo card, or whose promos this
  // catalogue does not carry. The rows describe those cards; they are never
  // substituted with an unrelated printing.
  'sv3pt5-binder-collection': 'the 151 binder collection carries packs and a binder, no promo',
  'sv8pt5-binder-collection': 'the Prismatic Evolutions binder collection carries packs and a binder, no promo',
  'sv8pt5-surprise-box': 'the Surprise Box promo is one of a nine-card pool, none of it catalogued here',
  'sv8pt5-accessory-pouch': 'the accessory pouch collection carries packs and a pouch, no promo',
  'sv8pt5-figure-collection': 'the Espeon ex and Umbreon ex figure promos are not catalogued here',
  'cel25-dragapult-prime': 'the Dragapult Prime promo is not catalogued here',
  'cel25-premium-figure': 'the Pikachu V and VMAX promos are not catalogued here',
  'cel25-upc': 'the Celebrations Ultra-Premium metal and gold cards are not catalogued as promos here',
}
for (const p of SPECIAL_PRODUCTS) {
  if (UNMAPPED_SPECIALS[p.id]) {
    check(!p.promoIds, `${p.id}: gained a promo id the source does not give (${UNMAPPED_SPECIALS[p.id]})`)
    continue
  }
  check(p.promos.length > 0, `${p.id}: names no promo`)
  check(p.promoIds?.length === p.promos.length, `${p.id}: every named promo should map to its printing`)
}

// A published quote for the product itself is the shelf price, and no model
// (pack EV included) is allowed to override it; a product without one still
// prices from its MSRP plus the promo.
{
  const single = priceDetail('me6-single-blister')
  const triple = priceDetail('me6-triple-blister')
  check(single.market === 13.08, `me6-single-blister: shelf price is $${single.market}, not the published $13.08`)
  check(single.source === 'tcgplayer', `me6-single-blister: shelf price source is ${single.source}`)
  check(triple.market === 19.05, `me6-triple-blister: shelf price is $${triple.market}, not the published $19.05`)
  check(triple.source === 'tcgplayer', `me6-triple-blister: shelf price source is ${triple.source}`)
  check(priceDetail('me1-single-blister').source === 'estimated', 'a blister without a published quote should stay on the modelled price')
}

// The Knock Out Eevee is a numbered set card (116/128), not a Black Star Promo:
// it must resolve to that card and not to an MEP or SVP printing.
{
  const ko = SEALED_EVIDENCE['me55-knockout']
  check(ko?.promoIds?.join() === 'me55-116', 'me55-knockout: the Eevee promo is not mapped to set card 116')
  const e = db.prepare("SELECT name, number, set_id FROM cards WHERE id = 'me55-116'").get() as { name: string; number: string; set_id: string } | undefined
  check(e?.name === 'Eevee' && e.number === '116' && e.set_id === 'me55', 'me55-knockout: me55-116 is not 30th Celebration Eevee 116')
}

// The special sets that shipped a bundle but never a 36-pack display.
for (const id of ['sv3pt5', 'sv4pt5', 'sv6pt5', 'sv8pt5', 'rsv10pt5', 'zsv10pt5', 'me2pt5', 'me55']) {
  check(!manifests.has(`${id}-display`), `${id}: an unprinted display is still catalogued`)
}

// The display variants: Journey Together's Enhanced Booster Display is a real
// 36-pack display sold as its own SKU, and the five half displays are the
// 18-pack European configuration. Both keep the display kind so battle counts
// and the catalogue's own maths read the row, not a format guess.
const VARIANT_DISPLAYS: Record<string, { setId: string; packs: number; kind: string; shelf: number | null; promos: string[]; art: number }> = {
  'sv9-display-enhanced': { setId: 'sv9', packs: 36, kind: 'display', shelf: 225.73, promos: ["N's Reshiram"], art: 623628 },
  'sv6-half-display': { setId: 'sv6', packs: 18, kind: 'display', shelf: null, promos: [], art: 649421 },
  'sv7-half-display': { setId: 'sv7', packs: 18, kind: 'display', shelf: 253.23, promos: [], art: 649420 },
  // No photo is published for the Surging Sparks half box (TCGplayer 403s at
  // every size), so this row is the one documented art gap.
  'sv8-half-display': { setId: 'sv8', packs: 18, kind: 'display', shelf: 193.27, promos: [], art: 0 },
  'sv9-half-display': { setId: 'sv9', packs: 18, kind: 'display', shelf: null, promos: [], art: 649492 },
  'sv10-half-display': { setId: 'sv10', packs: 18, kind: 'display', shelf: 317.5, promos: [], art: 624681 },
}
for (const [id, want] of Object.entries(VARIANT_DISPLAYS)) {
  const m = manifests.get(id)
  check(Boolean(m), `display variant missing from catalogue: ${id}`)
  if (!m) continue
  check(m.kind === want.kind, `${id}: kind is ${m.kind}`)
  check(m.sold, `${id}: display variant is hidden`)
  check(m.counts.value?.packs === want.packs, `${id}: packs ${m.counts.value?.packs} != ${want.packs}`)
  check((m.promos.value ?? []).map((p) => p.name).join('|') === want.promos.join('|'), `${id}: promo list drifted`)
  const price = priceDetail(id)
  if (want.shelf != null) {
    check(price.market === want.shelf && price.source === 'tcgplayer', `${id}: shelf price is $${price.market} (${price.source}), not the quoted $${want.shelf}`)
  }
  // It must be buyable in the shop and it must battle the packs it actually holds.
  check(sellsProduct(id, want.setId), `${id}: display variant is refused for sale`)
  // Its own box art, not the set symbol and not another SKU's photo: the URL is
  // the TCGplayer product id the price quote came from.
  const art = db.prepare('SELECT image_url FROM pack_products WHERE id = ?').get(id) as { image_url: string | null } | undefined
  const expectedArt = want.art > 0 ? `https://tcgplayer-cdn.tcgplayer.com/product/${want.art}_in_400x400.jpg` : null
  check(art?.image_url === expectedArt, `${id}: box art is ${art?.image_url ?? 'missing'}, expected ${expectedArt ?? 'no published photo'}`)
  check(packsInBox(want.kind, m.counts.value?.packs) === want.packs, `${id}: battle opens the wrong pack count`)
}
check(manifests.get('sv9-display-enhanced')?.promos.value?.[0]?.cardId === 'sv9-116', 'Enhanced display promo did not resolve to N\'s Reshiram 116')
check(manifests.get('sv9-display-enhanced')?.promos.value?.[0]?.guaranteed === true, 'Enhanced display promo should be guaranteed')
check(manifests.get('sv7-half-display')?.counts.value?.totalCards === 180, 'a half display should deal 18 x 10 cards')

// The Pokémon Center ETBs: eleven packs and the set's ETB promo twice (one
// stamped) for $59.99. Every set that shipped one has a row, each row is above
// the shelf price once its promo and pack EV are counted, and the promo list
// matches the set's ordinary box.
check(PC_ETB_SETS.size >= 20, 'the Pokémon Center ETB set list shrank')
// Four sets split their box by art, so the premium row names one of the set's
// two promos rather than both; those rows are checked by variant below.
const PC_SPLIT_SETS = new Set(['sv1', 'sv4', 'sv5', 'me1'])
for (const setId of PC_ETB_SETS) {
  const id = `${setId}-etb-pc`
  const m = manifests.get(id)
  check(Boolean(m), `Pokémon Center ETB missing: ${id}`)
  if (!m) continue
  check(m.kind === 'etb', `${id}: kind is ${m.kind}`)
  check(m.sold, `${id}: Pokémon Center ETB is hidden`)
  check(m.counts.value?.packs === 11, `${id}: packs ${m.counts.value?.packs} != 11`)
  check(m.promos.status === 'verified', `${id}: promos are ${m.promos.status}`)
  const base = manifests.get(`${setId}-etb`)
  if (!PC_SPLIT_SETS.has(setId)) {
    const promos = (m.promos.value ?? []).map((p) => p.name).sort().join('|')
    const basePromos = (base?.promos.value ?? []).map((p) => p.name).sort().join('|')
    check(promos === basePromos, `${id}: promos "${promos}" != the set ETB's "${basePromos}"`)
  }
  check(priceDetail(id).market >= 59.99, `${id}: priced below the $59.99 box`)
  check(packsInBox('etb', m.counts.value?.packs) === 11, `${id}: battle opens the wrong pack count`)
  check(sellsProduct(id, setId), `${id}: Pokémon Center ETB is refused for sale`)
}
check(manifests.get('sv1-etb-pc')?.promos.value?.[0]?.cardId === 'svp-14', 'sv1 Koraidon box should seal Koraidon SVP 014')
check(manifests.get('sv1-etb-pc-miraidon')?.promos.value?.[0]?.cardId === 'svp-13', 'sv1 Miraidon box should seal Miraidon SVP 013')
check(manifests.get('sv10-etb-pc')?.promos.value?.[0]?.guaranteed === true, 'sv10 PC ETB promo should be guaranteed')
check(manifests.get('me55-etb-pc')?.counts.value?.packs === 11, '30th Celebration PC ETB is not eleven packs')
check(manifests.get('me55-etb-pc')?.promos.value?.[0]?.name === 'Nidorina', '30th Celebration PC ETB promo drift')
check(manifests.get('me1-etb-pc')?.promos.value?.[0]?.cardId === 'mep-009', 'Mega Gardevoir PC ETB should seal Alakazam MEP 009')

// Crown Zenith's ten-pack ETB is the one modern exception to the nine-pack rule.
check(manifests.get('swsh12pt5-etb')?.counts.value?.packs === 10, 'Crown Zenith ETB is not ten packs')
check(SEALED_EVIDENCE['sv1-etb'].promos.join('|') === 'Koraidon', 'sv1 Koraidon ETB should name only Koraidon')
check(SEALED_EVIDENCE['sv1-etb-miraidon'].promos.join('|') === 'Miraidon', 'sv1 Miraidon ETB should name only Miraidon')
check(manifests.get('sv1-etb')?.promos.value?.[0]?.cardId === 'svp-14', 'sv1 Koraidon ETB should seal SVP 014')
check(manifests.get('sv1-etb-miraidon')?.promos.value?.[0]?.cardId === 'svp-13', 'sv1 Miraidon ETB should seal SVP 013')
check(manifests.get('me1-etb')?.promos.value?.[0]?.cardId === 'mep-010', 'me1 Mega Lucario ETB should seal Riolu MEP 010')
check(manifests.get('me1-etb-gardevoir')?.promos.value?.[0]?.cardId === 'mep-009', 'me1 Mega Gardevoir ETB should seal Alakazam MEP 009')
check(SEALED_EVIDENCE['sv10-etb'].promos[0] === "Team Rocket's Wobbuffet", 'sv10 ETB promo drift')
check(manifests.get('sv8pt5-etb')?.promos.value?.[0]?.cardId === 'svp-173', 'Prismatic Eevee resolved to the wrong promo printing')
check(manifests.get('swsh12pt5-etb')?.promos.value?.[0]?.cardId === 'swshp-SWSH291', 'Crown Zenith Lucario resolved to the wrong promo printing')
check(manifests.get('me55-etb')?.counts.value?.packs === 9, '30th Celebration ETB is not nine packs')
check(manifests.get('me55-etb')?.promos.value?.[0]?.name === 'Nidorina', '30th Celebration ETB promo drift')
check(manifests.get('me2pt5-etb')?.promos.value?.[0]?.name === "N's Zekrom", 'Ascended Heroes ETB promo drift')
check(!sellsProduct('me55-display', 'me55'), '30th Celebration display should be refused')
check(sellsProduct('sv3pt5-bundle', 'sv3pt5'), '151 bundle should be sold')
check(!sellsProduct('sv3pt5-display', 'sv3pt5'), '151 display should be refused')
check(Boolean(db.prepare("SELECT 1 FROM sets WHERE id = 'swsh12pt5'").get()), 'Crown Zenith set missing')

// Sword & Shield: eight packs in every main-line ETB, ten in the two special
// sets, with the promos those two boxes carried.
const SWSH_ETB_PACKS: Record<string, number> = {
  swsh1: 8, swsh2: 8, swsh3: 8, swsh4: 8, swsh5: 8, swsh6: 8, swsh7: 8,
  swsh8: 8, swsh9: 8, swsh10: 8, swsh11: 8, swsh12: 8, swsh35: 10, swsh45: 10,
}
for (const [setId, packs] of Object.entries(SWSH_ETB_PACKS)) {
  const m = manifests.get(`${setId}-etb`)
  check(Boolean(m), `${setId}: Sword & Shield ETB missing`)
  check(m?.counts.value?.packs === packs, `${setId}: ETB packs ${m?.counts.value?.packs} != ${packs}`)
}
check(manifests.get('swsh35-etb')?.promos.value?.[0]?.cardId === 'swshp-SWSH050', 'Champion\'s Path ETB promo is not Charizard V SWSH050')
check(manifests.get('swsh35-etb')?.promos.value?.[0]?.guaranteed === true, 'Champion\'s Path ETB promo should be guaranteed')
check(manifests.get('swsh45-etb')?.promos.value?.[0]?.cardId === 'swshp-SWSH087', 'Shining Fates ETB promo is not Eevee VMAX SWSH087')

// No bundle existed before Lost Origin, and the special sets never had a box.
for (const setId of ['swsh1', 'swsh2', 'swsh3', 'swsh4', 'swsh5', 'swsh6', 'swsh7', 'swsh8', 'swsh9', 'swsh10', 'swsh35', 'swsh45']) {
  check(!manifests.has(`${setId}-bundle`), `${setId}: an unprinted bundle is still catalogued`)
}
for (const setId of ['swsh11', 'swsh12']) {
  check(sellsProduct(`${setId}-bundle`, setId), `${setId}: real Booster Bundle is hidden`)
}
check(sellsProduct('swsh12pt5-bundle', 'swsh12pt5'), 'Crown Zenith bundle should be sold')
check(manifests.get('swsh12pt5-bundle')?.counts.value?.packs === 6, 'Crown Zenith bundle is not six packs')
check(priceDetail('swsh12pt5-bundle').market === 217.13, 'Crown Zenith bundle does not use its quote')
for (const setId of ['swsh35', 'swsh45']) {
  check(!sellsProduct(`${setId}-display`, setId), `${setId}: an unprinted display is offered`)
}
check(sellsProduct('swsh12-display', 'swsh12'), 'Silver Tempest display should be sold')

// The two Sword & Shield half displays, and the Pokémon Center boxes.
for (const [id, packs] of [['swsh7-half-display', 18], ['swsh10-half-display', 18]] as const) {
  const m = manifests.get(id)
  check(Boolean(m), `${id}: half display missing`)
  check(m?.kind === 'display', `${id}: kind is ${m?.kind}`)
  check(m?.counts.value?.packs === packs, `${id}: packs ${m?.counts.value?.packs} != ${packs}`)
  check(packsInBox('display', m?.counts.value?.packs) === packs, `${id}: battle opens the wrong pack count`)
}
const SWSH_PC: Record<string, { packs: number; market: number }> = {
  'swsh6-etb-pc': { packs: 8, market: 209.63 },
  'swsh7-etb-pc': { packs: 10, market: 1087.99 },
  'swsh8-etb-pc': { packs: 10, market: 461.76 },
  'swsh9-etb-pc': { packs: 10, market: 244.41 },
  'swsh10-etb-pc': { packs: 10, market: 182.26 },
  'swsh11-etb-pc': { packs: 10, market: 372.75 },
  'swsh12-etb-pc': { packs: 10, market: 377.92 },
  'swsh12pt5-etb-pc': { packs: 12, market: 536.98 },
}
for (const [id, want] of Object.entries(SWSH_PC)) {
  const m = manifests.get(id)
  check(Boolean(m), `${id}: Pokémon Center ETB missing`)
  check(m?.kind === 'etb', `${id}: kind is ${m?.kind}`)
  check(m?.sold === true, `${id}: Pokémon Center ETB is hidden`)
  check(m?.counts.value?.packs === want.packs, `${id}: packs ${m?.counts.value?.packs} != ${want.packs}`)
  check((m?.promos.value ?? []).length === 0, `${id}: a promo is claimed with no source`)
  const d = priceDetail(id)
  check(d.market === want.market && d.source === 'tcgplayer', `${id}: price is $${d.market} (${d.source}), not the $${want.market} quote`)
  check(id === 'swsh6-etb-pc' || id === 'swsh12pt5-etb-pc' || want.packs === 10, `${id}: unexpected pack count`)
}

// A two-art Pokémon Center box is two SKUs: each variant is sold, priced,
// battled and drawn as its own box, and carries the promo printed on its art.
const PC_VARIANTS: Record<string, { setId: string; packs: number; market: number; promo: string | null; art: number }> = {
  'swsh6-etb-pc': { setId: 'swsh6', packs: 8, market: 209.63, promo: null, art: 247281 },
  'swsh6-etb-pc-shadow': { setId: 'swsh6', packs: 8, market: 191.93, promo: null, art: 247282 },
  'swsh7-etb-pc': { setId: 'swsh7', packs: 10, market: 1087.99, promo: null, art: 245376 },
  'swsh7-etb-pc-glaceon': { setId: 'swsh7', packs: 10, market: 1127.56, promo: null, art: 245352 },
  'sv1-etb-pc': { setId: 'sv1', packs: 11, market: 286.56, promo: 'svp-14', art: 478758 },
  'sv1-etb-pc-miraidon': { setId: 'sv1', packs: 11, market: 316.89, promo: 'svp-13', art: 478756 },
  'sv4-etb-pc': { setId: 'sv4', packs: 11, market: 188.73, promo: 'svp-58', art: 512801 },
  'sv4-etb-pc-roaring-moon': { setId: 'sv4', packs: 11, market: 205.75, promo: 'svp-65', art: 512809 },
  'sv5-etb-pc': { setId: 'sv5', packs: 11, market: 197.48, promo: 'svp-98', art: 532853 },
  'sv5-etb-pc-walking-wake': { setId: 'sv5', packs: 11, market: 212.81, promo: 'svp-97', art: 538775 },
  'me1-etb-pc': { setId: 'me1', packs: 11, market: 177.19, promo: 'mep-009', art: 648415 },
  'me1-etb-pc-lucario': { setId: 'me1', packs: 11, market: 194.26, promo: 'mep-010', art: 644282 },
}
for (const [id, want] of Object.entries(PC_VARIANTS)) {
  const m = manifests.get(id)
  check(Boolean(m), `${id}: split Pokémon Center box missing`)
  check(m?.kind === 'etb', `${id}: kind is ${m?.kind}`)
  check(m?.sold === true, `${id}: split Pokémon Center box is hidden`)
  check(m?.counts.value?.packs === want.packs, `${id}: packs ${m?.counts.value?.packs} != ${want.packs}`)
  check(packsInBox('etb', want.packs) === want.packs, `${id}: battle opens the wrong pack count`)
  check(sellsProduct(id, want.setId), `${id}: split Pokémon Center box is refused for sale`)
  const d = priceDetail(id)
  check(d.market === want.market && d.source === 'tcgplayer', `${id}: price is $${d.market} (${d.source}), not the $${want.market} quote`)
  if (want.promo) {
    check(m?.promos.value?.length === 1, `${id}: should name exactly its own art's promo`)
    check(m?.promos.value?.[0]?.cardId === want.promo, `${id}: promo is ${m?.promos.value?.[0]?.cardId}, not ${want.promo}`)
    check(m?.promos.value?.[0]?.guaranteed === true, `${id}: the art's promo should be guaranteed`)
  } else {
    check((m?.promos.value ?? []).length === 0, `${id}: a promo is claimed with no source`)
  }
  const art = db.prepare('SELECT image_url FROM pack_products WHERE id = ?').get(id) as { image_url: string | null } | undefined
  check(
    art?.image_url === `https://tcgplayer-cdn.tcgplayer.com/product/${want.art}_in_400x400.jpg`,
    `${id}: art is ${art?.image_url ?? 'missing'}, not its own box photo`,
  )
}

// Every Pokémon Center ETB sells at its own TCGplayer quote. Before this block
// the twenty per-set rows below fell back to the pack model, which priced
// Paldea Evolved at a fifth of what its box actually traded for.
const PC_QUOTES: Record<string, { market: number; productId: number }> = {
  'sv2-etb-pc': { market: 590.13, productId: 493973 },
  'sv3-etb-pc': { market: 616.07, productId: 501266 },
  'sv3pt5-etb-pc': { market: 1152.26, productId: 501999 },
  'sv4pt5-etb-pc': { market: 542.07, productId: 528039 },
  'sv6-etb-pc': { market: 186.2, productId: 543844 },
  'sv6pt5-etb-pc': { market: 160.07, productId: 552998 },
  'sv7-etb-pc': { market: 182.43, productId: 557340 },
  'sv8-etb-pc': { market: 243.74, productId: 565632 },
  'sv8pt5-etb-pc': { market: 381.8, productId: 593324 },
  'sv9-etb-pc': { market: 192.29, productId: 610929 },
  'sv10-etb-pc': { market: 402.8, productId: 624675 },
  'rsv10pt5-etb-pc': { market: 240.97, productId: 630688 },
  'zsv10pt5-etb-pc': { market: 261.05, productId: 630687 },
  'me2-etb-pc': { market: 271.3, productId: 654135 },
  'me2pt5-etb-pc': { market: 323.18, productId: 668497 },
  'me3-etb-pc': { market: 118.33, productId: 672404 },
  'me4-etb-pc': { market: 120.9, productId: 684452 },
  'me5-etb-pc': { market: 114.83, productId: 692949 },
  'me55-etb-pc': { market: 257.07, productId: 704144 },
  'me6-etb-pc': { market: 198.2, productId: 712104 },
}
for (const [id, want] of Object.entries(PC_QUOTES)) {
  const m = manifests.get(id)
  check(Boolean(m), `${id}: Pokémon Center ETB missing`)
  check(m?.sold === true, `${id}: Pokémon Center ETB is hidden`)
  check(m?.counts.value?.packs === 11, `${id}: packs ${m?.counts.value?.packs} != 11`)
  const shelf = shelfPriceFor(id)
  check(shelf?.market === want.market, `${id}: shelf quote is $${shelf?.market}, not $${want.market}`)
  check(shelf?.asOf === '2026-11-08', `${id}: quote is dated ${shelf?.asOf}`)
  const d = priceDetail(id)
  check(d.market === want.market && d.source === 'tcgplayer', `${id}: price is $${d.market} (${d.source}), not the $${want.market} quote`)
  const listed = db.prepare('SELECT 1 FROM pack_products WHERE id = ?').get(id)
  check(Boolean(listed), `${id}: quote names a box the catalogue does not hold`)
}
// The cohort is complete, not a sample: every box whose name says Pokémon
// Center must answer with a marketplace quote.
const pcBoxes = db.prepare("SELECT id FROM pack_products WHERE name LIKE '%Center%' ORDER BY id").all() as { id: string }[]
check(pcBoxes.length === 38, `expected 38 Pokémon Center boxes, found ${pcBoxes.length}`)
for (const box of pcBoxes) {
  const d = priceDetail(box.id)
  check(d.source === 'tcgplayer', `${box.id}: still model-priced (${d.source} $${d.market})`)
}
check(Object.keys(PC_ETB_SHELF).length === Object.keys(PC_QUOTES).length, 'PC quote table and its check disagree on size')

// Eight regular ETBs shipped in two arts. Each art is its own sold SKU with
// its own quote, name and photo, and the original id still carries the first
// art so an existing save's stock stays attached to it.
let dualArtRows = 0
for (const [setId, info] of Object.entries(DUAL_ART_ETBS)) {
  check(info.boxes.length === 2, `${setId}: expected exactly two arts`)
  check(info.boxes[0].id === `${setId}-etb`, `${setId}: first art should keep the original id`)
  check(new Set(info.boxes.map((box) => box.art)).size === 2, `${setId}: arts are not distinct`)
  check(new Set(info.boxes.map((box) => box.productId)).size === 2, `${setId}: both arts cite one listing`)
  for (const box of info.boxes) {
    dualArtRows++
    const m = manifests.get(box.id)
    check(Boolean(m), `${box.id}: split regular ETB missing`)
    check(m?.kind === 'etb' && m?.sold === true, `${box.id}: not a sold ETB`)
    check(m?.counts.value?.packs === info.packs, `${box.id}: packs ${m?.counts.value?.packs} != ${info.packs}`)
    const row = db.prepare('SELECT name, image_url FROM pack_products WHERE id = ?').get(box.id) as
      | { name: string; image_url: string | null }
      | undefined
    check(row?.name === `${info.name} Elite Trainer Box (${box.art})`, `${box.id}: name is ${row?.name ?? 'missing'}`)
    check(
      row?.image_url === `https://tcgplayer-cdn.tcgplayer.com/product/${box.productId}_in_400x400.jpg`,
      `${box.id}: art is ${row?.image_url ?? 'missing'}, not its own box photo`,
    )
    const d = priceDetail(box.id)
    if (box.market === null) {
      check(d.source === 'estimated', `${box.id}: has no TCGplayer quote but prices from ${d.source}`)
    } else {
      check(
        d.market === box.market && d.source === (box.priceKind ?? 'tcgplayer'),
        `${box.id}: $${d.market} (${d.source}), not the $${box.market} ${box.priceKind ?? 'tcgplayer'} quote`,
      )
    }
    const promos = (m?.promos.value ?? []).map((p) => p.cardId)
    if (box.promoId) {
      check(promos.length === 1 && promos[0] === box.promoId, `${box.id}: promo is ${promos.join(', ') || 'none'}, not ${box.promoId}`)
    } else {
      check(promos.length === 0, `${box.id}: a promo is claimed for a box whose art does not pin one`)
    }
  }
}
check(dualArtRows === 28, `expected 28 dual-art rows, found ${dualArtRows}`)

// The two XY pairs carry the full retail contents, not just "eight packs and
// the art". Both sources are official product pages and neither box held a promo.
const XY_DUAL_CONTENTS: Record<string, { set: string; art: string; source: string }> = {
  'xy5-etb': { set: 'Primal Clash', art: 'Primal Groudon-EX', source: 'xy-primal-clash-elite-trainer-box' },
  'xy5-etb-kyogre': { set: 'Primal Clash', art: 'Primal Kyogre-EX', source: 'xy-primal-clash-elite-trainer-box' },
  'xy8-etb': { set: 'BREAKthrough', art: 'Mega Mewtwo X', source: 'xy-breakthrough-elite-trainer-box' },
  'xy8-etb-mewtwo-y': { set: 'BREAKthrough', art: 'Mega Mewtwo Y', source: 'xy-breakthrough-elite-trainer-box' },
}
for (const [id, want] of Object.entries(XY_DUAL_CONTENTS)) {
  const e = SEALED_EVIDENCE[id]
  check(Boolean(e), `${id}: missing sealed evidence`)
  check(e?.packs === 8, `${id}: packs ${e?.packs} != 8`)
  check(e?.note.includes(`eight ${want.set} packs`), `${id}: note does not name the eight packs`)
  check(e?.note.includes(`65 sleeves featuring ${want.art}`), `${id}: note does not name the ${want.art} sleeves`)
  check(e?.note.includes('45 Energy cards'), `${id}: note does not name the 45 Energy cards`)
  check(e?.note.includes("player's guide"), `${id}: note does not name the player's guide`)
  check(e?.note.includes('six damage-counter dice'), `${id}: note does not name the six damage dice`)
  check(e?.note.includes('one coin-flip die'), `${id}: note does not name the coin-flip die`)
  check(e?.note.includes('two acrylic condition markers'), `${id}: note does not name the condition markers`)
  check(e?.note.includes('four dividers'), `${id}: note does not name the four dividers`)
  check(e?.note.includes('TCGO code card'), `${id}: note does not name the code card`)
  check(e?.note.includes('No promo card'), `${id}: note does not state that no promo was included`)
  check(e?.source.url?.includes(want.source) === true, `${id}: contents do not cite the official product page`)
}

// The Sword & Shield Elite Trainer Box Plus is the era's last ETB-shaped gap:
// twelve packs split three each across the first four sets, with the gold
// Zacian V or Zamazenta V. The opener must deal the mix rather than twelve
// packs of its host set.
const ETB_PLUS: Record<string, { market: number; promo: string; art: number }> = {
  'swsh1-etb-plus': { market: 235.67, promo: 'swshp-SWSH076', art: 222987 },
  'swsh1-etb-plus-zamazenta': { market: 240.64, promo: 'swshp-SWSH077', art: 222986 },
}
for (const [id, want] of Object.entries(ETB_PLUS)) {
  const m = manifests.get(id)
  check(Boolean(m), `${id}: Elite Trainer Box Plus missing`)
  check(m?.kind === 'etb', `${id}: kind is ${m?.kind}`)
  check(m?.sold === true, `${id}: Elite Trainer Box Plus is hidden`)
  check(m?.counts.value?.packs === 12, `${id}: packs ${m?.counts.value?.packs} != 12`)
  check(packsInBox('etb', 12) === 12, `${id}: battle opens the wrong pack count`)
  check(sellsProduct(id, 'swsh1'), `${id}: Elite Trainer Box Plus is refused for sale`)
  check(m?.promos.value?.length === 1 && m.promos.value[0].cardId === want.promo, `${id}: promo is not ${want.promo}`)
  check(m?.promos.value?.[0]?.guaranteed === true, `${id}: the gold promo should be guaranteed`)
  const d = priceDetail(id)
  check(d.market === want.market && d.source === 'tcgplayer', `${id}: price is $${d.market} (${d.source}), not the $${want.market} quote`)
  const art = db.prepare('SELECT image_url FROM pack_products WHERE id = ?').get(id) as { image_url: string | null } | undefined
  check(
    art?.image_url === `https://tcgplayer-cdn.tcgplayer.com/product/${want.art}_in_400x400.jpg`,
    `${id}: art is ${art?.image_url ?? 'missing'}, not its own box photo`,
  )
  const mix = PACK_MIX[id]
  check(mix?.length === 4, `${id}: composition should name four expansions`)
  check(mix?.every((segment) => segment.packs === 3), `${id}: composition should be three packs per expansion`)
  check(mix?.reduce((sum, segment) => sum + segment.packs, 0) === 12, `${id}: composition does not total twelve packs`)
  check(mixedPackSetId(id, 0) === 'swsh1' && mixedPackSetId(id, 11) === 'swsh4', `${id}: mixed pack order is wrong`)
}
{
  db.prepare('INSERT INTO sealed_inventory (product_id, quantity, cost, condition, acquired_at) VALUES (?, 1, ?, ?, ?)').run(
    'swsh1-etb-plus',
    235.67,
    'fresh',
    new Date().toISOString(),
  )
  const opened = openSealed('swsh1-etb-plus')
  check(opened.packsOpened === 12, `ETB Plus opened ${opened.packsOpened} packs, not 12`)
  const dealt = new Set<string>()
  const findSet = db.prepare('SELECT set_id FROM cards WHERE id = ?')
  for (const card of opened.cards) {
    const set = findSet.get(card.cardId) as { set_id: string } | undefined
    if (set) dealt.add(set.set_id)
  }
  const expansions = ['swsh1', 'swsh2', 'swsh3', 'swsh4']
  check(dealt.size === 4 && expansions.every((setId) => dealt.has(setId)), `ETB Plus dealt ${[...dealt].join(', ')}, not all four expansions`)
}

// Every Sword & Shield set with cards has pull odds; none is opened against an
// empty profile.
const swshSets = db.prepare("SELECT id FROM sets WHERE id LIKE 'swsh%' AND id NOT LIKE '%p' AND id NOT LIKE '%tg' AND id NOT LIKE '%sv' AND id NOT LIKE '%gg' AND id != 'swsh12pt5'").all() as { id: string }[]
for (const s of swshSets) check(expectedPackValue(s.id) > 0, `${s.id}: no pack odds/pull table`)

// Sun & Moon: eight packs in every main-line ETB, ten in the three special
// sets, with the promo each of those boxes actually carried. Every row sells at
// the TCGplayer quote for the exact box rather than the 2017–2019 sticker.
const SM_ETB: Record<string, { packs: number; market: number; promo: string | null }> = {
  sm1: { packs: 8, market: 248.05, promo: null },
  sm2: { packs: 8, market: 470.96, promo: null },
  sm3: { packs: 8, market: 346.28, promo: null },
  sm4: { packs: 8, market: 216.68, promo: null },
  sm5: { packs: 8, market: 780.99, promo: null },
  sm6: { packs: 8, market: 689.62, promo: null },
  sm7: { packs: 8, market: 2091.3, promo: null },
  sm8: { packs: 8, market: 729.8, promo: null },
  sm9: { packs: 8, market: 4000, promo: null },
  sm10: { packs: 8, market: 1899.99, promo: null },
  sm11: { packs: 8, market: 1719.9, promo: null },
  sm12: { packs: 8, market: 1874.5, promo: null },
  sm35: { packs: 10, market: 1199.66, promo: 'smp-SM70' },
  sm75: { packs: 10, market: 1228.24, promo: 'smp-SM125' },
  sm115: { packs: 10, market: 548.78, promo: 'smp-SM210' },
}
for (const [setId, want] of Object.entries(SM_ETB)) {
  const id = `${setId}-etb`
  const m = manifests.get(id)
  check(Boolean(m), `${id}: Sun & Moon ETB missing`)
  check(m?.sold === true, `${id}: Sun & Moon ETB is hidden`)
  check(m?.kind === 'etb', `${id}: kind is ${m?.kind}`)
  check(m?.counts.value?.packs === want.packs, `${id}: packs ${m?.counts.value?.packs} != ${want.packs}`)
  check(packsInBox('etb', want.packs) === want.packs, `${id}: battle opens the wrong pack count`)
  check(m?.promos.status === 'verified', `${id}: promos are ${m?.promos.status}`)
  if (want.promo) {
    check(m?.promos.value?.[0]?.cardId === want.promo, `${id}: promo is not ${want.promo}`)
    check(m?.promos.value?.[0]?.guaranteed === true, `${id}: the box promo should be guaranteed`)
  } else {
    check((m?.promos.value ?? []).length === 0, `${id}: a promo is claimed with no source`)
  }
  const d = priceDetail(id)
  check(d.market === want.market && d.source === 'tcgplayer', `${id}: price is $${d.market} (${d.source}), not the $${want.market} quote`)
}
check(SEALED_EVIDENCE['sm75-etb'].packs === 10, 'Dragon Majesty ETB should open ten packs, not the nine TCGplayer metadata claims')

// No Sun & Moon set shipped a six-pack bundle; the three special expansions had
// no display; Detective Pikachu had no box at all; and the Shiny Vault subset
// was never sealed product of its own.
for (const setId of ['sm1', 'sm2', 'sm3', 'sm4', 'sm5', 'sm6', 'sm7', 'sm8', 'sm9', 'sm10', 'sm11', 'sm12', 'sm35', 'sm75', 'sm115', 'det1']) {
  check(!manifests.has(`${setId}-bundle`), `${setId}: an unprinted bundle is still catalogued`)
}
for (const setId of ['sm35', 'sm75', 'sm115']) {
  check(!manifests.has(`${setId}-display`), `${setId}: an unprinted display is still catalogued`)
}
check(sellsProduct('sm12-display', 'sm12'), 'Cosmic Eclipse display should be sold')
check(!manifests.has('det1-etb'), 'Detective Pikachu ETB is still catalogued')
check(!manifests.has('det1-display'), 'Detective Pikachu display is still catalogued')
check(manifests.get('det1-booster')?.counts.value?.totalCards === 4, 'Detective Pikachu packs should open four cards')
for (const id of ['sma-booster', 'sma-bundle', 'sma-display', 'sma-etb']) {
  check(!manifests.has(id), `${id}: Shiny Vault phantom is still catalogued`)
}

// XY: every main ETB held eight packs, not the nine the generic era line
// assumed; no XY expansion shipped a six-pack bundle; and the three special
// sets' invented booster/bundle/display/ETB rows are removed outright.
// Flashfire is not in this list: the early ETB line shipped one box every other
// expansion and Bulbapedia names Flashfire as one it skipped, so no row exists.
for (const setId of ['xy1', 'xy3', 'xy4', 'xy5', 'xy6', 'xy7', 'xy8', 'xy9', 'xy10', 'xy11', 'xy12']) {
  const id = `${setId}-etb`
  const m = manifests.get(id)
  check(Boolean(m), `${id}: XY ETB missing`)
  check(m?.sold === true, `${id}: XY ETB is hidden`)
  check(m?.kind === 'etb', `${id}: kind is ${m?.kind}`)
  check(m?.counts.value?.packs === 8, `${id}: packs ${m?.counts.value?.packs} != 8`)
  check(packsInBox('etb', 8) === 8, `${id}: battle opens the wrong pack count`)
  const quote = XY_ETB_SHELF[id]
  if (quote) {
    const d = priceDetail(id)
    check(d.market === quote.market && d.source === 'tcgplayer', `${id}: $${d.market} (${d.source}), not the $${quote.market} quote`)
  }
}
for (const setId of ['xy0', 'xy1', 'xy2', 'xy3', 'xy4', 'xy5', 'xy6', 'xy7', 'xy8', 'xy9', 'xy10', 'xy11', 'xy12', 'g1', 'dc1']) {
  check(!manifests.has(`${setId}-bundle`), `${setId}: an unprinted XY bundle is still catalogued`)
}
for (const id of ['xy0-booster', 'xy0-display', 'xy0-etb', 'g1-display', 'dc1-display', 'dc1-etb']) {
  check(!manifests.has(id), `${id}: phantom XY row is still catalogued`)
}
check(!manifests.has('xy2-etb'), 'Flashfire never shipped an ETB; its row is still catalogued')
check(sellsProduct('xy12-display', 'xy12'), 'Evolutions display should be sold')
check(sellsProduct('xy11-display', 'xy11'), 'Steam Siege display should be sold')

// Every pack and every display whose TCGplayer listing publishes a market sits
// on that exact quote. A display whose listing has no market stays modelled.
for (const [id, quote] of Object.entries(XY_BOOSTER_SHELF)) {
  const m = manifests.get(id)
  check(m?.sold === true, `${id}: quoted XY product is not sold`)
  check(m?.counts.value?.packs === (id.endsWith('-display') ? 36 : 1), `${id}: packs ${m?.counts.value?.packs} wrong`)
  const d = priceDetail(id)
  check(d.market === quote.market && d.source === 'tcgplayer', `${id}: $${d.market} (${d.source}), not the $${quote.market} quote`)
  check(shelfPriceFor(id)?.market === quote.market, `${id}: shelf price missing`)
}
for (const id of ['xy1-display', 'xy2-display', 'xy4-display', 'xy5-display', 'xy9-display']) {
  check(shelfPriceFor(id) === null, `${id}: a null-market display borrowed a quote`)
  check(priceDetail(id).source === 'estimated', `${id}: a null-market display is not modelled`)
}
const xyGenerations = manifests.get('g1-etb')
check(xyGenerations?.sold === true, 'Generations ETB should be sold')
check(xyGenerations?.counts.value?.packs === 10, `Generations ETB packs ${xyGenerations?.counts.value?.packs} != 10`)
check(xyGenerations?.promos.value?.[0]?.cardId === 'xyp-XY148', 'Generations ETB should name Shaymin-EX XY148')
check(priceDetail('g1-etb').market === 3833.33 && priceDetail('g1-etb').source === 'tcgplayer', 'Generations ETB is not on its TCGplayer quote')

// Double Crisis existed only as a four-pack blister of seven-card packs. The
// blister is its own openable row; the generic booster/display/ETB stay refused.
{
  const m = manifests.get('dc1-blister')
  check(m?.sold === true, 'Double Crisis blister is not sold')
  check(m?.kind === 'special', `Double Crisis blister kind is ${m?.kind}`)
  check(m?.counts.value?.packs === 4, `Double Crisis blister packs ${m?.counts.value?.packs} != 4`)
  check(m?.counts.value?.totalCards === 28, `Double Crisis blister cards ${m?.counts.value?.totalCards} != 28`)
  check((m?.promos.value ?? []).length === 0, 'Double Crisis blister claims a promo')
  const d = priceDetail('dc1-blister')
  check(d.market === 1715.52 && d.source === 'tcgplayer', `Double Crisis blister is $${d.market} (${d.source}), not the derived $1,715.52`)
  db.prepare('INSERT INTO sealed_inventory (product_id, quantity, cost, condition, acquired_at) VALUES (?, 1, ?, ?, ?)').run(
    'dc1-blister',
    1715.52,
    'fresh',
    new Date().toISOString(),
  )
  const opened = openSealed('dc1-blister')
  check(opened.packsOpened === 4, `Double Crisis blister opened ${opened.packsOpened} packs, not 4`)
  check(opened.perPack.every((pack) => pack.cards.length === 7), 'Double Crisis packs should hold seven cards')
  check(opened.cards.length === 28, `Double Crisis blister dealt ${opened.cards.length} cards, not 28`)
}

// Black & White: the ETB line began with Plasma Storm (7 packs); Plasma Blast
// added the eighth. Every other ETB and every six-pack bundle is a phantom.
check(manifests.get('bw8-etb')?.counts.value?.packs === 7, 'Plasma Storm ETB should hold 7 packs')
check(manifests.get('bw10-etb')?.counts.value?.packs === 8, 'Plasma Blast ETB should hold 8 packs')
for (const setId of ['bw1', 'bw2', 'bw3', 'bw4', 'bw5', 'bw6', 'bw7', 'bw9', 'bw11']) {
  check(!manifests.has(`${setId}-etb`), `${setId}: a Black & White ETB that never existed is still catalogued`)
}
for (const setId of ['bw1', 'bw2', 'bw3', 'bw4', 'bw5', 'bw6', 'bw7', 'bw8', 'bw9', 'bw10', 'bw11', 'dv1']) {
  check(!manifests.has(`${setId}-bundle`), `${setId}: a Black & White Booster Bundle is still catalogued`)
}
for (const [id, quote] of Object.entries(BW_BOOSTER_SHELF)) {
  const m = manifests.get(id)
  check(m?.sold === true, `${id}: quoted Black & White pack is not sold`)
  check(m?.counts.value?.packs === 1, `${id}: packs ${m?.counts.value?.packs} wrong`)
  const d = priceDetail(id)
  check(d.market === quote.market && d.source === 'tcgplayer', `${id}: $${d.market} (${d.source}), not the $${quote.market} quote`)
}
for (const setId of ['bw1', 'bw2', 'bw3', 'bw4', 'bw5', 'bw6', 'bw7', 'bw8', 'bw9', 'bw10', 'bw11']) {
  const id = `${setId}-display`
  check(shelfPriceFor(id) === null, `${id}: a null-market Black & White display borrowed a quote`)
  check(priceDetail(id).source !== 'tcgplayer', `${id}: a null-market Black & White display is not modelled`)
}
for (const id of ['dv1-display', 'dv1-etb']) {
  check(!manifests.has(id), `${id}: a Dragon Vault phantom is still catalogued`)
}
{
  const m = manifests.get('dv1-blister')
  check(m?.sold === true, 'Dragon Vault blister is not sold')
  check(m?.kind === 'special', `Dragon Vault blister kind is ${m?.kind}`)
  check(m?.counts.value?.packs === 3, `Dragon Vault blister packs ${m?.counts.value?.packs} != 3`)
  check(m?.counts.value?.totalCards === 15, `Dragon Vault blister cards ${m?.counts.value?.totalCards} != 15`)
  check((m?.promos.value ?? []).length === 0, 'Dragon Vault blister claims a fixed promo')
  const d = priceDetail('dv1-blister')
  check(d.market === 1995.9 && d.source === 'tcgplayer', `Dragon Vault blister is $${d.market} (${d.source})`)
  db.prepare('INSERT INTO sealed_inventory (product_id, quantity, cost, condition, acquired_at) VALUES (?, 1, ?, ?, ?)').run(
    'dv1-blister',
    1995.9,
    'fresh',
    new Date().toISOString(),
  )
  const opened = openSealed('dv1-blister')
  check(opened.packsOpened === 3, `Dragon Vault blister opened ${opened.packsOpened} packs, not 3`)
  check(opened.perPack.every((pack) => pack.cards.length === 5), 'Dragon Vault packs should hold five cards')
  check(opened.cards.length === 15, `Dragon Vault blister dealt ${opened.cards.length} cards, not 15`)
}

// Every Sun & Moon set with cards has pull odds; none is opened against an
// empty profile.
const smSets = db.prepare("SELECT id FROM sets WHERE id LIKE 'sm%' AND id NOT LIKE '%p' AND id NOT IN ('sma')").all() as { id: string }[]
for (const s of smSets) check(expectedPackValue(s.id) > 0, `${s.id}: no pack odds/pull table`)

console.log(`sealed evidence: ${checks} checks passed`)
