// Generate Simplified Chinese Black Bolt (CSV10.5C) and White Flare (CSV10.6C)
// in server/catalog/regional-releases.json.
//
//   node tmp/crawl-bb.mjs && node tmp/emit-blackbolt.mjs
//
// Card data: Bulbapedia's combined card list ("Black Bolt & White Flare (TCG)"),
// which carries both sets in one table. It lists the 172/173-card English card
// count, not the Chinese release's 174 (86 main + 88 secret rares, per the
// publisher's product sheet); the two cards the English print turned into promos
// are not in any list this build can read, so the set here is the list that
// exists and the note records the gap. Both China-exclusive Special Illustration
// Rares — N's Plan by Iwamoto05 and Hilda by Ligton — are in that list, at the
// numbering the cards print at (both at 173/086, with the Black White Rares at
// 174/086) rather than Bulbapedia's offset tail; Victini's Black White Rare entry,
// which no scan or rarity count supports, is dropped.
//
// Everything else about a card (supertype, types, HP, regulation mark, artist) is
// read off the same card in the English print of the set, which is the same card
// with the same art. Prices are the English printings' market values, because no
// Chinese copy of this set has a recorded sale; they are an upper bound on what a
// Chinese copy trades at.
import fs from 'node:fs'
import { anchorFor, marketOf, openCatalog, pick, scaleToWrapper, tidy } from './regional-shared.mjs'

const db = openCatalog()
const crawl = JSON.parse(fs.readFileSync('tmp/gems/bb.json', 'utf8'))
const file = 'server/catalog/regional-releases.json'
const out = JSON.parse(fs.readFileSync(file, 'utf8'))

const SETS = [
  { name: 'Black Bolt', id: 'csv10pt5', code: 'CSV10.5C', english: 'zsv10pt5', exclusive: "N's Plan" },
  { name: 'White Flare', id: 'csv10pt6', code: 'CSV10.6C', english: 'rsv10pt5', exclusive: 'Hilda' },
]
// The artist of the two China-only alternate arts, from the card scans.
const EXCLUSIVE_ARTIST = { "N's Plan": 'Iwamoto05', Hilda: 'Ligton' }

// Printed numbering, which Bulbapedia's list does not follow at the tail. Both
// China-only Special Illustration Rares sit in the slot the Japanese N's Plan and
// Hilda alternate arts occupy, 173/086, and the Black White Rares close the set at
// 174/086 — the numbering the card scans carry (Bill's Archive reads both
// exclusives off the scans at 173/086; Collectors Kingdom prints Reshiram ex BWR at
// 174/086). Bulbapedia's tail is offset by the two cards the English print turned
// into promos, so it places the pair two numbers early and carries a Victini Black
// White Rare that the scans do not show — every source that lists the rarity counts
// gives one BWR per set (Zekrom ex, Reshiram ex), so Victini is dropped rather than
// shipped as a second BWR.
const RENUMBER = [
  { name: "N's Plan", rarity: /Special Illustration Rare/, to: '173/086' },
  { name: 'Hilda', rarity: /Special Illustration Rare/, to: '173/086' },
  { name: 'Zekrom ex', rarity: /Black White Rare/, to: '174/086' },
  { name: 'Reshiram ex', rarity: /Black White Rare/, to: '174/086' },
]
const DROPPED = (c) => c.name === 'Victini' && /Black White Rare/.test(c.rarity ?? '')

// ¥10 for a five-card wrapper; the box is fifteen of them (PokiPair, PokéZentrum,
// Collectors Kingdom, Northwest Card Co, Poke Texas all list 15/box).
const PACK_RMB = 10
const PACK_USD = 1.41
const BOX_PACKS = 15

const at = (sql, ...params) => pick(db, sql, ...params)

// The published ratio table, as shipped: each group's share of all cards dealt,
// and the slot it is dealt into. Both sets share the same spec sheet.
const LADDER = [
  { slot: 'common', share: 0.8, rarities: ['Common', 'Uncommon'] },
  { slot: 'holo', share: 0.1323, rarities: ['Rare'] },
  { slot: 'holo', share: 0.0604, rarities: ['Double Rare', 'Illustration Rare'] },
  { slot: 'holo', share: 0.0073, rarities: ['Ultra Rare', 'Special Illustration Rare', 'Black White Rare'] },
]

const sets = []
const cards = []
const products = []
const missingMeta = []
const unavailable = []

for (const s of SETS) {
  const src = crawl.find((c) => c.set === s.name)
  if (!src) throw new Error(`no crawl for ${s.name}`)
  const dropped = src.cards.filter(DROPPED)
  if (dropped.length) console.log(`${s.id}: dropped ${dropped.map((c) => `${c.number} ${c.name} [${c.rarity}]`).join(', ')}`)
  // Names first: Bulbapedia prints the ex cards without the suffix, and the
  // renumbering rules match on the full name, so "Zekrom" has to become
  // "Zekrom ex" before the Black White Rare rule can find it.
  const tidyName = tidy
  for (const c of src.cards) {
    const english = at(
      `SELECT * FROM cards WHERE set_id = ? AND number = ?`,
      s.english,
      String(Number(c.number.split('/')[0])),
    )
    if (english && (tidyName(english.name) === tidyName(c.name) || tidyName(english.name).startsWith(tidyName(c.name) + ' '))) {
      c.name = tidyName(english.name)
    }
  }
  for (const c of src.cards) {
    const rule = RENUMBER.find((r) => r.name === c.name && r.rarity.test(c.rarity ?? ''))
    if (rule) c.number = rule.to
  }
  const sorted = src.cards
    .filter((c) => !DROPPED(c))
    .sort((a, b) => Number(a.number.split('/')[0]) - Number(b.number.split('/')[0]))
  sets.push({
    id: s.id,
    name: s.name,
    series: 'Black Bolt & White Flare (Simplified Chinese)',
    printed_total: sorted.length,
    total: sorted.length,
    ptcgo_code: s.code,
    release_date: '2026/11/06',
    symbol_url: null,
    logo_url: null,
  })

  const drafted = []
  sorted.forEach((c, i) => {
    const num = c.number.split('/')[0]
    // Bulbapedia's Chinese list prints the card's name without the " ex" suffix
    // ("Serperior", "Kyurem"), and its apostrophes are typographic. The same card
    // at the same number in the English print carries the full name, so the match
    // is by number with the base name checked, and the English name is adopted.
    const byNumber = at(`SELECT * FROM cards WHERE set_id = ? AND number = ?`, s.english, String(Number(num)))
    const english =
      byNumber && (tidy(byNumber.name) === tidy(c.name) || tidy(byNumber.name).startsWith(tidy(c.name) + ' '))
        ? byNumber
        : null
    c.name = tidy(english?.name ?? c.name)
    if (!english) missingMeta.push(`${s.id} ${c.number} ${c.name}`)
    // The same card in English, then the same name at the same rarity, then any
    // printing of the name — the shared anchor both Chinese lines use.
    const anchor = anchorFor(db, { english, name: c.name, rarity: c.rarity })
    const raw = marketOf(db, anchor?.id)
    if (!(raw > 0)) unavailable.push(`${s.name} ${c.number} ${c.name}`)
    const isExclusive = c.name === s.exclusive && /Special Illustration/.test(c.rarity ?? '')
    drafted.push({ raw, card: {
      id: `${s.id}-${num}`,
      set_id: s.id,
      name: c.name,
      supertype: anchor?.supertype ?? (/\bex$/.test(c.name) ? 'Pokémon' : 'Trainer'),
      subtypes: anchor?.subtypes ? JSON.parse(anchor.subtypes) : null,
      number: c.number,
      position: i + 1,
      rarity: c.rarity,
      types: anchor?.types ? JSON.parse(anchor.types) : null,
      hp: anchor?.hp ?? null,
      artist: isExclusive ? EXCLUSIVE_ARTIST[c.name] ?? null : anchor?.artist ?? null,
      dex_numbers: anchor?.dex_numbers ? JSON.parse(anchor.dex_numbers) : null,
      image_small: null,
      image_large: null,
      regulation_mark: anchor?.regulation_mark ?? null,
    } })
  })

  // The set is priced to the wrapper it ships in. Its cards keep the English
  // printings' worth relative to each other — a Black White Rare is still the
  // set's top card by a mile — but no Chinese copy of this set has a recorded
  // sale, and English singles cannot be taken at face value here: this product
  // deals an AR or RR in three packs out of ten, so at English prices a ¥10
  // wrapper would hold $8 of cards. The one price anyone can check is the ¥10,
  // so the whole set is scaled until a pack is worth 85% of its sticker, and the
  // ladder is left intact.
  // Four body cards and one foil, so the plan is the physical shape — the shared
  // scaler sums each slot's own odds, which is where this emitter used to sum a
  // single draw and understate what the wrapper deals.
  const toScale = drafted.map((d) => ({ ...d.card, _raw: d.raw }))
  const scaled = scaleToWrapper({
    cards: toScale,
    ladder: LADDER,
    plan: [
      { slot: 'common', count: 4 },
      { slot: 'holo', count: 1 },
    ],
    packUsd: PACK_USD,
  })
  for (const c of toScale) cards.push(c)
  console.log(`${s.id}: English-comparable pack EV $${scaled.ev.toFixed(2)} → scaled ×${scaled.k.toFixed(3)}, pack EV $${scaled.packEv.toFixed(2)}`)

  products.push(
    {
      id: `${s.id}-booster`,
      set_id: s.id,
      name: `${s.name} Booster Pack`,
      kind: 'pack',
      msrp: PACK_USD,
      packs: 1,
      cards_per_pack: 5,
      release_date: '2026/11/06',
      description: `${s.name} booster pack — 5 cards, one of them a foil. ¥${PACK_RMB}.`,
    },
    {
      id: `${s.id}-box`,
      set_id: s.id,
      name: `${s.name} Booster Box`,
      kind: 'display',
      msrp: Math.round(BOX_PACKS * PACK_USD * 100) / 100,
      packs: BOX_PACKS,
      cards_per_pack: 5,
      release_date: '2026/11/06',
      description: `${s.name} slim booster box — ${BOX_PACKS} packs of 5 cards (${BOX_PACKS * 5} cards).`,
    },
  )
}

out.sets = [...out.sets.filter((s) => !SETS.some((x) => x.id === s.id)), ...sets]
out.cards = [...out.cards.filter((c) => !SETS.some((x) => x.id === c.set_id)), ...cards]
out.products = [...out.products.filter((p) => !SETS.some((x) => x.id === p.set_id)), ...products]
out.release = 'Gem Pack Vol. 1-7 and Black Bolt / White Flare (Simplified Chinese)'
out.ladderPacks = { ...(out.ladderPacks ?? {}), csv10pt5: LADDER, csv10pt6: LADDER }
out.note =
  "Three things are modelled rather than measured. The Gem Pack ladder uses the publisher's ratio table (★ 17.39%, ★★ 5.80%, ★★★ 1.81%; ● and ◆ take the remainder), printed for Vols. 6 and 7 and applied to 1-5 as the line's figure; Black Bolt and White Flare use their own spec sheet (13.23%, 6.04%, 0.73% of cards dealt). No Chinese card in either line has a recorded sale, so every value is anchored to the same card's English printing — the cheapest plain listing, which is an upper bound on what the Chinese copy trades at — and Black Bolt and White Flare are then scaled so a five-card pack is worth 85% of its ¥10 sticker, because at English values that wrapper would hold eight dollars of cards. Black Bolt and White Flare carry the card lists Bulbapedia publishes (171 and 172 cards after Victini's unsupported Black White Rare entry is dropped, against the Chinese release's 174), with the tail numbered as the cards print: both China-only Special Illustration Rares at 173/086 and Zekrom ex and Reshiram ex at 174/086. The numbers Bulbapedia used for those slots are left unused rather than filled with a guess, so Black Bolt skips 170-172 and White Flare skips 171-172."

fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n')
console.log(`sets ${out.sets.length} · cards ${out.cards.length} · products ${out.products.length}`)
for (const s of sets) {
  const mine = cards.filter((c) => c.set_id === s.id)
  const priced = mine.filter((c) => c.price).length
  const byRarity = mine.reduce((m, c) => ((m[c.rarity] = (m[c.rarity] ?? 0) + 1), m), {})
  console.log(`${s.id} ${s.name}: ${mine.length} cards · ${priced} priced · ${JSON.stringify(byRarity)}`)
}
if (missingMeta.length) console.log('no English row:', missingMeta.length, missingMeta.slice(0, 5))
if (unavailable.length) console.log('unpriced:', unavailable.length, unavailable.slice(0, 8))
