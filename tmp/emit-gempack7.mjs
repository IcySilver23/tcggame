// Generate catalog/regional-releases.json for Gem Pack Vol. 7 (CBB7C).
//
//   node tmp/emit-gempack7.mjs
//
// Source: Bill's Archive, "Gem Pack Vol. 7" (6 November 2026) — 28 Pokémon, each
// with seven numbered cards: 01 to 05 are the regular art in holo, 06 adds the Gem
// Pack stamp, and 07 is that Pokémon's Illustration Rare. The collector number is
// the Pokémon's two-digit slot followed by the version, over /07, so Misty's
// Psyduck's art rare is 0307/07, exactly as folio.fyi files it: 196 cards, 4 per
// pack, all foil, ¥10 a pack.
//
// Prices: no Gem Pack card has a recorded sale in any language (folio.fyi checked
// the Chinese market on 7 November 2026 and found none), so every card is anchored
// to the NEWEST printing of its own name that this catalogue carries — the art it
// reprints, or the modern card of the same Pokémon. Not the dearest: Rapidash's
// most expensive printing is a $250 e-Card secret, and borrowing that would price
// a ¥10 pack like a case.
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { assignArt } from './regional-shared.mjs'

const db = new Database('data/tcglife.db', { readonly: true })

// Reference a shipped file only: a missing wrapper falls back to the mark.
const shipped = (name) => (fs.existsSync(`public/catalog-art/cbb/${name}`) ? `/catalog-art/cbb/${name}` : null)

const POKEMON = [
  "Team Rocket's Raticate", "Team Rocket's Meowth", "Misty's Psyduck", 'Rapidash',
  "Team Rocket's Weezing", "Misty's Lapras", "Ethan's Typhlosion", 'Furret',
  "Team Rocket's Murkrow", "Team Rocket's Wobbuffet", 'Swinub', "Team Rocket's Houndoom",
  'Blaziken', 'Clamperl', "Steven's Beldum", "Cynthia's Roserade",
  'Shaymin', 'Crustle', "N's Zorua", "Lillie's Ribombee",
  'Lycanroc', "Arven's Greedent", "Team Rocket's Orbeetle", "Hop's Wooloo",
  "Marnie's Morpeko", "Team Rocket's Spidops", "Iono's Kilowattrel", 'Hydrapple',
]

const pick = (sql, ...params) => db.prepare(sql).get(...params)

// A holo reprint of a bulk Pokémon is a bulk card, so versions 01-06 take the
// CHEAPEST ordinary printing of the name — ordinary meaning not an art rare. A
// name whose only printing is an art rare (Misty's Lapras, Ethan's Typhlosion,
// Team Rocket's Meowth and five others) has no bulk card to point at, and
// borrowing its $22 chase price would put eight $22 cards into a ¥10 wrapper.
// Those names take the set's own bulk floor instead: the cheapest anchor found
// among the names that do have an ordinary printing, which is what the line's
// reprints actually trade at.
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

// Misty's Psyduck: the regular art is the Destined Rivals card this pack reprints
// (sv10-193 is that set's Psyduck art rare). The China-only drawing has no sale
// anywhere, so the art rare is anchored to the same card.
const psyduck = pick(
  `SELECT c.id, (SELECT MAX(p.market) FROM price_records p WHERE p.card_id = c.id AND p.market > 0) AS market
   FROM cards c WHERE c.id = 'sv10-193'`,
)

const set = {
  id: 'cbb7',
  name: 'Gem Pack Vol. 7',
  series: 'Gem Pack (Simplified Chinese)',
  printed_total: 196,
  total: 196,
  ptcgo_code: 'CBB7C',
  release_date: '2026/11/06',
  // Shipped with the build from Bulbagarden's own file set for the volume; the
  // publisher's product page shows the same wrapper.
  symbol_url: shipped('cbb7-symbol.webp'),
  logo_url: shipped('cbb7-logo.webp') ?? shipped('cbb7-symbol.webp') ?? shipped('cbb7-pack.webp'),
}

const pad = (n) => String(n).padStart(2, '0')
const cards = []
const missing = []

const found = POKEMON.map((name) => (name === "Misty's Psyduck" ? psyduck : cheapestBulk(name)))
const bulkFloor = Math.min(...found.filter((a) => a?.market > 0).map((a) => a.market))

POKEMON.forEach((name, i) => {
  const slot = i + 1
  // Misty's Psyduck's regular art is the Destined Rivals *art rare* this pack
  // reprints, so its six holo versions have no ordinary printing either and take
  // the floor; only its art rare is anchored to that card, because the China-only
  // drawing reprints it.
  const base = name === "Misty's Psyduck" ? { id: null, artist: null, market: bulkFloor } : found[i] ?? { id: null, artist: null, market: bulkFloor }
  const art = name === "Misty's Psyduck" ? psyduck : newestArt(name) ?? base
  if (!found[i]?.market && name !== "Misty's Psyduck") missing.push(name)
  for (let v = 1; v <= 7; v++) {
    const price = (v === 7 ? art?.market : base?.market) ?? null
    cards.push({
      id: `cbb7-${pad(slot)}${pad(v)}`,
      set_id: 'cbb7',
      name,
      supertype: 'Pokémon',
      subtypes: null,
      // The line prints group and treatment with a space: "03 07/07".
      number: `${pad(slot)} ${pad(v)}/07`,
      position: (slot - 1) * 7 + v,
      // Every card in this product is foil: versions 01-06 print the regular art
      // (06 carries the Gem Pack stamp) and 07 is that Pokémon's art rare.
      rarity: v === 7 ? 'Illustration Rare' : 'Rare Holo',
      // The printed ladder: two ●, two ◆, one ★, one ★★, one ★★★ — which is what
      // the official ratio table's counts say (56/56/28/28/28 in 196 cards).
      tier: v <= 2 ? 'Gem C' : v <= 4 ? 'Gem U' : v === 5 ? 'Gem R' : v === 6 ? 'Gem RR' : 'Gem RRR',
      types: null,
      hp: null,
      artist: v === 7 && name === "Misty's Psyduck" ? 'Cona Nitanda' : base?.artist ?? null,
      dex_numbers: null,
      image_small: null,
      image_large: null,
      regulation_mark: null,
      price: price ? { market: Math.round(price * 100) / 100, variant: 'holofoil' } : null,
    })
  }
})

const products = [
  {
    id: 'cbb7-booster',
    set_id: 'cbb7',
    name: 'Gem Pack Vol. 7 Pack (4 cards)',
    kind: 'booster',
    // ¥10 at 7.1 CNY to the dollar.
    msrp: 1.41,
    packs: 1,
    cards_per_pack: 4,
    release_date: '2026/11/06',
    image_url: shipped('cbb7-pack.webp'),
    description: 'Four foil cards from the 196-card Gem Pack Vol. 7 pool, ¥10 in mainland China.',
  },
  {
    id: 'cbb7-box',
    set_id: 'cbb7',
    name: 'Gem Pack Vol. 7 Box (18 packs)',
    kind: 'display',
    // Vol. 7 ships eighteen packs (Cardnado, Keef's, PokeUnlimited, Maya TCG all
    // print 18 packs / 72 cards); the box is its packs at ¥10, since no box
    // sticker was read.
    msrp: 25.38,
    packs: 18,
    cards_per_pack: 4,
    release_date: '2026/11/06',
    description: 'Eighteen four-card Gem Pack Vol. 7 packs, ¥10 a pack in mainland China.',
  },
]

const out = {
  release: 'Gem Pack Vol. 7 (Simplified Chinese)',
  note:
    'Products the English catalogue cannot carry: a booster line sold only in mainland China. ' +
    'Gem Pack Vol. 7 (宝石包 VOL.7, CBB7C) went on sale on 6 November 2026 with 196 cards — 28 Pokémon, each with five holo versions of its regular art, ' +
    'a sixth carrying the Gem Pack stamp and a seventh Illustration Rare. Names, numbering and that structure are Bill\'s Archive\'s published list. ' +
    'No Gem Pack card has a recorded sale in any language, so every card is valued against the reprint it copies, not against an English chase price: the six regular versions ' +
    'take the cheapest ordinary printing of that Pokémon, the seven art rares take the art they reprint, and the eight Pokémon whose only printing anywhere is a chase card take the ' +
    'set\'s bulk floor instead — the cheapest anchor found in the line — because a ¥10 wrapper cannot hold eight $22 cards. Misty\'s Psyduck is the one China-only artwork (Cona Nitanda) ' +
    'and its art rare is valued at the Destined Rivals card it reprints. ' +
    'No scan of this set is in the catalogue\'s image service, so each card wears the artwork of the newest English printing of its name, and the volume\'s own wrapper, set symbol and logo ship with the build. ' +
    'The set ships its own two products — a four-card pack at ¥10 and an eighteen-pack box, priced as its packs — and none of the era products ' +
    'an English 2026 set would receive: no bundle, no Elite Trainer Box, no 36-pack display. A pack opens four cards drawn from the whole set and weighted by the publisher\'s ' +
    'ratio table — ★ 17.39% of the print run, ★★ 5.80%, ★★★ 1.81% — so a three-star card turns up in about 7% of packs, roughly one per box. At these anchors the pack sits at ' +
    'its ¥10 sticker and the box at its packs, and neither is a number borrowed from another market.',
  sets: [set],
  cards,
  products,
  // Every card in this product is foil, so the pack draws from the whole pool —
  // but not evenly: each printed tier keeps its published share of the print run.
  uniformPoolSets: ['cbb7'],
  tierShares: { 'Gem R': 0.1739, 'Gem RR': 0.058, 'Gem RRR': 0.0181 },
}

// Art: Vol. 7 reprints 2026 sets, so each card wears the artwork of the newest
// English printing of its name — the art it copies where that set is in English,
// the modern card of the same Pokémon where it is not. A printing is used once
// per card group, so the seven treatments of one Pokémon get seven different arts.
const art = assignArt(db, cards)
console.log(`art: ${art.exact} same print · ${art.other} English printing of the name · ${art.none} without`)

fs.writeFileSync('server/catalog/regional-releases.json', JSON.stringify(out, null, 1) + '\n')
console.log(`cards ${cards.length} · sets ${out.sets.length} · products ${products.length}`)
console.log('priced:', cards.filter((c) => c.price).length, 'unpriced:', cards.filter((c) => !c.price).length)
console.log('no price for:', missing.join(', ') || 'none')
const arts = cards.filter((c) => c.rarity === 'Illustration Rare')
console.log('art rares:', arts.map((c) => `${c.number} ${c.name} $${c.price?.market}`).join(' | '))
