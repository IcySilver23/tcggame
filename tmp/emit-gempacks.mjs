// Generate the Gem Pack volumes in server/catalog/regional-releases.json.
//
//   node tmp/emit-gempacks.mjs
//
// Card data: Bulbapedia's six card lists (printed group/treatment number, name and
// Gem rarity), cross-checked against artofpkm's print lists — the two agree on the
// card count for five of the six volumes and differ on one denominator in Vol. 1
// (Crocalor 04 prints as 01/08 on Bulbapedia, 01/09 on artofpkm); Bulbapedia's
// number is used and the disagreement is recorded in the note.
//
// Prices: no Gem Pack card has a recorded sale in any language, so every card is
// anchored to the reprint it copies — the cheapest ordinary printing for the body,
// the art it reprints for the Gem RRR tier, and the set's bulk floor for names that
// have only ever been printed as chase cards. Vol. 7's block is carried over from
// the file as it stands; this script owns Vols. 1-6.
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { RELEASE, applyGemArt, assignArt } from './regional-shared.mjs'

const db = new Database('data/tcglife.db', { readonly: true })
const bulba = JSON.parse(fs.readFileSync('tmp/gems/bulba.json', 'utf8'))
const existing = JSON.parse(fs.readFileSync('server/catalog/regional-releases.json', 'utf8'))

// Box size is not constant down the line. Vols. 1-3 ship 15 packs (Vol. 1's own
// product listing reads 整盒（15包）, Vol. 2 and Vol. 3 are listed at 15 by
// retailers) and Vols. 4-7 ship 18 (PokiPair, Cardnado, Maya TCG and Keef's all
// print 18 packs / 72 cards for 4-7). tcgguy says "18, the same as Vol 3 to 6",
// which contradicts the Vol. 3 listing; the direct product listing is followed.
// Each volume's printed ratio table, as the back of its box carries it: the share
// of the whole print run that each printed tier makes up. ● 50.00% and ◆ 25.00%
// are the same in all seven; the three hit tiers move. 52poke transcribes the
// table for every volume (Vol. 7 also appears on the publisher's own page, and
// Vols. 5 and 6 agree with it), and the counts in this catalogue double as a
// check: Vol. 1 prints 32/23/23/19/18, which is the ratio table's shape.
const SHARES = {
  1: { R: 17.9, RR: 4.93, RRR: 2.17 },
  2: { R: 18.13, RR: 4.7, RRR: 2.17 },
  3: { R: 18.42, RR: 4.77, RRR: 1.81 },
  4: { R: 17.39, RR: 5.8, RRR: 1.81 },
  5: { R: 17.39, RR: 5.8, RRR: 1.81 },
  6: { R: 17.39, RR: 5.8, RRR: 1.81 },
  7: { R: 17.39, RR: 5.8, RRR: 1.81 },
}

// A pack is two ●, one ◆ and one hit; the hit slot's three tiers divide by their
// printed shares, which is why ★, ★★ and ★★★ share the 'hit' slot here. The three
// are scaled to sum to 1, because a slot's weights are read as per-pack chances
// too: a hit slot summing to 25 would deal an 85% hit and pad the other 15% of
// packs from the reverse pool. Printed shares stay in the note; these are the
// same numbers over their own total.
const gemHit = (v) => {
  const s = SHARES[v]
  const total = s.R + s.RR + s.RRR
  return { R: s.R / total, RR: s.RR / total, RRR: s.RRR / total }
}

const gemLadder = (v) => {
  const hit = gemHit(v)
  return [
    { slot: 'common', share: 1, tiers: ['Gem C'] },
    { slot: 'uncommon', share: 1, tiers: ['Gem U'] },
    { slot: 'hit', share: hit.R, tiers: ['Gem R'] },
    { slot: 'hit', share: hit.RR, tiers: ['Gem RR'] },
    { slot: 'hit', share: hit.RRR, tiers: ['Gem RRR'] },
  ]
}

const VOLUMES = [
  { vol: 1, code: 'CBB1C', date: '2025/01/17', packs: 15 },
  { vol: 2, code: 'CBB2C', date: '2025/05/16', packs: 15 },
  { vol: 3, code: 'CBB3C', date: '2025/09/26', packs: 15 },
  { vol: 4, code: 'CBB4C', date: '2026/02/06', packs: 18 },
  { vol: 5, code: 'CBB5C', date: '2026/04/24', packs: 18 },
  { vol: 6, code: 'CBB6C', date: '2026/08/07', packs: 18 },
]

const pick = (sql, ...params) => db.prepare(sql).get(...params)
const ART = "(c.rarity LIKE '%Illustration Rare%' OR c.rarity LIKE '%Art Rare%' OR c.rarity LIKE '%Special Illustration%')"
const cheapestBulk = (name) =>
  pick(
    `SELECT c.id, c.artist, p.market AS market
     FROM cards c JOIN price_records p ON p.card_id = c.id
     WHERE c.name = ? AND p.market > 0 AND NOT ${ART}
     ORDER BY p.market ASC LIMIT 1`,
    name,
  )
const newestArt = (name) =>
  pick(
    `SELECT c.id, (SELECT MAX(p.market) FROM price_records p WHERE p.card_id = c.id AND p.market > 0) AS market
     FROM cards c JOIN sets s ON s.id = c.set_id
     WHERE c.name = ? AND c.rarity LIKE '%Illustration Rare%'
     ORDER BY s.release_date DESC, c.position DESC LIMIT 1`,
    name,
  )

const pad = (n) => String(n).padStart(2, '0')

// Only a file that is actually in the build is referenced: a missing wrapper must
// fall back to the mark, and a missing mark to nothing, never to a broken image.
const shipped = (name) => (fs.existsSync(`public/catalog-art/cbb/${name}`) ? `/catalog-art/cbb/${name}` : null)

const sets = []
const cards = []
const products = []
const unresolvable = new Set()
let floor = Infinity

for (const v of VOLUMES) {
  const src = bulba.find((b) => b.vol === v.vol)
  if (!src) throw new Error(`no crawl for vol ${v.vol}`)
  const setId = `cbb${v.vol}`
  const names = [...new Set(src.cards.map((c) => c.name))]
  const anchors = new Map()
  for (const name of names) {
    const a = cheapestBulk(name)
    if (a?.market > 0) {
      anchors.set(name, a)
      floor = Math.min(floor, a.market)
    }
  }
  sets.push({
    id: setId,
    name: `Gem Pack Vol. ${v.vol}`,
    series: 'Gem Pack (Simplified Chinese)',
    printed_total: src.cards.length,
    total: src.cards.length,
    ptcgo_code: v.code,
    release_date: v.date,
    // Shipped with the build: Bulbagarden's own file set for the volume, pulled
    // through a readable proxy (its media host refuses direct requests here).
    // Vol. 4 is the one volume with no logo file, so its mark stands in.
    symbol_url: shipped(`cbb${v.vol}-symbol.webp`),
    // The volume's face, best first: its logo, else its set symbol, else its own
    // wrapper — all pictures of this volume, so a product without a wrapper of its
    // own (the box) still shows the volume rather than an empty box.
    logo_url:
      shipped(`cbb${v.vol}-logo.webp`) ??
      shipped(`cbb${v.vol}-symbol.webp`) ??
      shipped(`cbb${v.vol}-pack.webp`),
  })
  src.cards
    .slice()
    .sort((a, b) => a.group - b.group || a.treatment - b.treatment)
    .forEach((c, i) => {
      const base = anchors.get(c.name) ?? { id: null, artist: null, market: floor }
      const art = newestArt(c.name) ?? base
      const chase = c.rarity === 'Gem RRR'
      if (!anchors.has(c.name)) unresolvable.add(c.name)
      const price = (chase ? art.market : base.market) ?? null
      cards.push({
        id: `${setId}-${pad(c.group)}${pad(c.treatment)}`,
        set_id: setId,
        name: c.name,
        supertype: /Energy$/.test(c.name) ? 'Energy' : /^(Poké Ball|Great Ball|Ultra Ball|Level Ball|Quick Ball|Nemona|Penny)$/.test(c.name) ? 'Trainer' : 'Pokémon',
        subtypes: null,
        number: c.number,
        position: i + 1,
        // The printed Gem tiers are the line's own rarity names. The catalogue only
        // distinguishes foil from chase, so the RRR tier is carried as the set's
        // Illustration Rare (what the pull table's chase pool keys on) and every
        // other print as Rare Holo — every card in the product is foil. `tier`
        // keeps the printed grade, which is what the pull ladder is weighted by.
        rarity: chase ? 'Illustration Rare' : 'Rare Holo',
        tier: c.rarity,
        types: null,
        hp: null,
        artist: base?.artist ?? null,
        dex_numbers: null,
        image_small: null,
        image_large: null,
        regulation_mark: null,
        price: price ? { market: Math.round(price * 100) / 100, variant: 'holofoil' } : null,
      })
    })
  products.push(
    {
      id: `${setId}-booster`,
      set_id: setId,
      name: `Gem Pack Vol. ${v.vol} Pack (4 cards)`,
      kind: 'booster',
      msrp: 1.41,
      packs: 1,
      cards_per_pack: 4,
      release_date: v.date,
      // The volume's own wrapper, as published — the shelf draws this instead of a
      // box, and the pack screen the same picture.
      image_url: shipped(`cbb${v.vol}-pack.webp`),
      description: `Four foil cards from the ${src.cards.length}-card Gem Pack Vol. ${v.vol} pool, ¥10 in mainland China.`,
    },
    {
      id: `${setId}-box`,
      set_id: setId,
      name: `Gem Pack Vol. ${v.vol} Box (${v.packs} packs)`,
      kind: 'display',
      // No box sticker was read for this line, so the box is its packs at ¥10 each.
      msrp: Math.round(v.packs * 1.41 * 100) / 100,
      packs: v.packs,
      cards_per_pack: 4,
      release_date: v.date,
      // No box was photographed in this build's reach, so the box keeps no wrapper
      // of its own and falls back to the volume's mark.
      description: `${v.packs} four-card Gem Pack packs, ¥10 a pack in mainland China.`,
    },
  )
}

// Art: these sets have no scans anywhere, so each card wears the artwork of an
// English printing of the same Pokémon — the same rarity where the catalogue has
// one, newest set first — and a printing is used once per set, so the nine
// Sprigatito treatments get nine different arts instead of one repeated nine
// times. A card whose name appears in no English print keeps the placeholder.
const art = assignArt(db, cards)
console.log(`art: ${art.exact} same print · ${art.sibling} sibling set · ${art.other} English printing of the name · ${art.none} without`)
// Captain Pikachu exists in no English printing, so those rows wear their own scan.
console.log(`art: ${applyGemArt(cards)} rows carry the Simplified Chinese scan`)

// Sets carry `id`, cards and products carry `set_id`.
const keep = (rows) => rows.filter((r) => (r.set_id ?? r.id) === 'cbb7')
const out = {
  release: RELEASE,
  note:
    'Products the English catalogue cannot carry: the Gem Pack booster line, sold only in mainland China. ' +
    'Volumes 1-7 (CBB1C-CBB7C) run from 17 January 2025 to 6 November 2026 on a four-card all-foil pack at ¥10: Vols. 1-3 ship fifteen packs to a box and Vols. 4-7 ship eighteen, so a box costs its packs and no separate box sticker is claimed. ' +
    'Names, printed numbers and the Gem C/U/R/RR/RRR rarity of every card in Vols. 1-6 are Bulbapedia\'s card lists, cross-checked print for print against artofpkm: ' +
    'the two agree on the card count of five volumes and differ on one denominator in Vol. 1, where Crocalor prints as 04 01/08 on Bulbapedia and 04 01/09 on artofpkm — ' +
    'Bulbapedia\'s number is used here. Vol. 7 is the set built from Bill\'s Archive\'s published structure. ' +
    'No Gem Pack card has a recorded sale in any language, so every card is valued against the reprint it copies: the six regular versions take the cheapest ordinary printing of ' +
    'the Pokémon, the chase tier takes the art it reprints, and the Pokémon whose only printing anywhere is a chase card take the set\'s bulk floor, because a ¥10 wrapper cannot ' +
    'hold eight $22 cards. The catalogue distinguishes foil from chase, so the printed Gem C/U/R/RR tiers are carried as Rare Holo and Gem RRR as the Illustration Rare tier. ' +
    'Every card carries the Simplified Chinese card itself, all 1,175 of them: the product scans on simplifiedcollector.com\'s per-volume card lists, downscaled to 260px wide rather than shipped at print size. Fourteen of those (Captain Pikachu, Vol. 1 0701-0709 and Vol. 5 0101-0107) had no English printing to borrow in the first place — Bulbapedia records it as not yet released in English — and its two chase treatments 0709 and 0107 come from Bulbapedia\'s own card images. Three spots on the source lists needed a hand, all checked against the printed number: Vol. 1 18 01/06 (Basic Grass Energy) is filed there under a group number its card does not print, and Vol. 4\'s Pinsir and Chatot are filed with a duplicate suffix and an alt text that omits their numbers. ' +
    'Each volume also ships its published packaging and marks, all Bulbagarden\'s own files for that volume: the booster wrapper as the pack\'s picture (Vols. 6 and 7 checked against the publisher\'s page, which shows the same wrapper), the set symbol, and the logo — Vol. 4 publishes no logo, so its symbol stands in. The box carries the volume\'s mark rather than a wrapper, because no box photograph was reachable. ' +
    'A pack is the wrapper the publisher prints: four cards, collated as two ●, one ◆ and one hit drawn from ★ or ★★ or ★★★, so no pack holds three commons or two art rares. The hit is divided by the volume\'s own printed ratio table — ● 50.00% and ◆ 25.00% in every volume, then ★ / ★★ / ★★★ at 17.90% / 4.93% / 2.17% (Vol. 1), 18.13% / 4.70% / 2.17% (Vol. 2), 18.42% / 4.77% / 1.81% (Vol. 3) and 17.39% / 5.80% / 1.81% (Vols. 4-7) — which makes a Vol. 4-7 hit 69.6% ★, 23.2% ★★ and 7.24% ★★★: one art rare in 13.8 packs, about one and a third in an eighteen-pack box. Every weight in the pull table is share ÷ cards at that tier, so the ladder can be recomputed from this note and the set. At these anchors the packs sit at their ¥10 sticker.',
  sets: [...sets, ...keep(existing.sets)],
  cards: [...cards, ...keep(existing.cards)],
  products: [...products, ...keep(existing.products)],
  // Vol. 7's table is emitted by its own pass, which runs before this one; this
  // keeps the key present so a rebuild of Vols. 1-6 leaves Vol. 7's ladder intact.
  ladderPacks: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((v) => [`cbb${v}`, gemLadder(v)])),
}

fs.writeFileSync('server/catalog/regional-releases.json', JSON.stringify(out, null, 1) + '\n')
console.log(`sets ${out.sets.length} · cards ${out.cards.length} · products ${out.products.length}`)
for (const v of VOLUMES) {
  const n = cards.filter((c) => c.set_id === `cbb${v.vol}`)
  console.log(`  vol ${v.vol}: ${n.length} cards · chase ${n.filter((c) => c.rarity === 'Illustration Rare').length} · unpriced ${n.filter((c) => !c.price).length}`)
}
console.log('anchored to the bulk floor:', [...unresolvable].join(', ') || 'none', `(floor $${floor})`)
