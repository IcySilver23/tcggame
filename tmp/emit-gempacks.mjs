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

const db = new Database('data/tcglife.db', { readonly: true })
const bulba = JSON.parse(fs.readFileSync('tmp/gems/bulba.json', 'utf8'))
const existing = JSON.parse(fs.readFileSync('server/catalog/regional-releases.json', 'utf8'))

// Box size is not constant down the line. Vols. 1-3 ship 15 packs (Vol. 1's own
// product listing reads 整盒（15包）, Vol. 2 and Vol. 3 are listed at 15 by
// retailers) and Vols. 4-7 ship 18 (PokiPair, Cardnado, Maya TCG and Keef's all
// print 18 packs / 72 cards for 4-7). tcgguy says "18, the same as Vol 3 to 6",
// which contradicts the Vol. 3 listing; the direct product listing is followed.
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
    symbol_url: null,
    logo_url: null,
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
      description: `${v.packs} four-card Gem Pack packs, ¥10 a pack in mainland China.`,
    },
  )
}

// Sets carry `id`, cards and products carry `set_id`.
const keep = (rows) => rows.filter((r) => (r.set_id ?? r.id) === 'cbb7')
const out = {
  release: 'Gem Pack Vol. 1-7 (Simplified Chinese)',
  note:
    'Products the English catalogue cannot carry: the Gem Pack booster line, sold only in mainland China. ' +
    'Volumes 1-7 (CBB1C-CBB7C) run from 17 January 2025 to 6 November 2026 on a four-card all-foil pack at ¥10: Vols. 1-3 ship fifteen packs to a box and Vols. 4-7 ship eighteen, so a box costs its packs and no separate box sticker is claimed. ' +
    'Names, printed numbers and the Gem C/U/R/RR/RRR rarity of every card in Vols. 1-6 are Bulbapedia\'s card lists, cross-checked print for print against artofpkm: ' +
    'the two agree on the card count of five volumes and differ on one denominator in Vol. 1, where Crocalor prints as 04 01/08 on Bulbapedia and 04 01/09 on artofpkm — ' +
    'Bulbapedia\'s number is used here. Vol. 7 is the set built from Bill\'s Archive\'s published structure. ' +
    'No Gem Pack card has a recorded sale in any language, so every card is valued against the reprint it copies: the six regular versions take the cheapest ordinary printing of ' +
    'the Pokémon, the chase tier takes the art it reprints, and the Pokémon whose only printing anywhere is a chase card take the set\'s bulk floor, because a ¥10 wrapper cannot ' +
    'hold eight $22 cards. The catalogue distinguishes foil from chase, so the printed Gem C/U/R/RR tiers are carried as Rare Holo and Gem RRR as the Illustration Rare tier. ' +
    'No scan of these sets is in the catalogue\'s image service, so the cards carry no artwork. ' +
    'A pack opens four cards drawn from the whole set, and the draw is weighted by the publisher\'s own ratio table: ★ 17.39% of the print run, ★★ 5.80%, ★★★ 1.81%, with ● and ◆ taking the remainder. Those shares are printed for Vols. 6 and 7; Vols. 1-5 carry the same ladder as the line\'s figure, corroborated by the one-three-star-per-box the selling copy describes. Every weight in the pull table is therefore share ÷ card count, so the ladder can be recomputed from the note and the set. At these anchors the packs sit at their ¥10 sticker.',
  sets: [...sets, ...keep(existing.sets)],
  cards: [...cards, ...keep(existing.cards)],
  products: [...products, ...keep(existing.products)],
  uniformPoolSets: ['cbb1', 'cbb2', 'cbb3', 'cbb4', 'cbb5', 'cbb6', 'cbb7'],
  // Share of the PRINT RUN, straight from the publisher's ratio table. ● and ◆
  // are not named there; they take the remainder, and the loader splits it.
  tierShares: { 'Gem R': 0.1739, 'Gem RR': 0.058, 'Gem RRR': 0.0181 },
}

fs.writeFileSync('server/catalog/regional-releases.json', JSON.stringify(out, null, 1) + '\n')
console.log(`sets ${out.sets.length} · cards ${out.cards.length} · products ${out.products.length}`)
for (const v of VOLUMES) {
  const n = cards.filter((c) => c.set_id === `cbb${v.vol}`)
  console.log(`  vol ${v.vol}: ${n.length} cards · chase ${n.filter((c) => c.rarity === 'Illustration Rare').length} · unpriced ${n.filter((c) => !c.price).length}`)
}
console.log('anchored to the bulk floor:', [...unresolvable].join(', ') || 'none', `(floor $${floor})`)
