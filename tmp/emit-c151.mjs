// Generate Simplified Chinese Collection 151 (151C) in
// server/catalog/regional-releases.json.
//
//   node tmp/emit-c151.mjs
//
// Card data: Bulbapedia's "Collection 151 (ATCG)" card list, one cumulative table
// of 192 rows numbered 001-192/151. The set shipped in four phased boosters
// (Journey 17 Jan 2025, Hope 18 Apr 2025, Scare 18 Jul 2025, Gather 17 Oct 2025)
// and the phase-level lists do not agree: an April (Hope) card list counts 186
// cards — 151 plus 35 secrets with one arts rare and no SARs — because Scare and
// Gather later added three more Pikachu Arts Rares (171-173) and the three SARs
// (Alakazam ex 189, Zapdos ex 190, Mew ex 191) that Bulbapedia's booster section
// names. 192 is the expansion; 186 is a mid-year snapshot. A third figure of 465
// (Pokecottage) counts every reverse/Poke Ball/Master Ball variant of the same
// cards and is not a card count.
//
// Everything is priced the way Black Bolt is: the same card in the English 151
// (sv3pt5) or, failing that, the same name at the same rarity anywhere, then the
// whole set scaled so a five-card pack is worth 85% of its ¥10 sticker.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { anchorFor, marketOf, openCatalog, pick, scaleToWrapper, tidy } from './regional-shared.mjs'

const PAGE = 'tmp/c151.html'
if (!fs.existsSync(PAGE) || fs.statSync(PAGE).size < 200000) {
  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
  execFileSync('curl', ['-sSL', '-m', '90', '-A', UA, '-o', PAGE, 'https://bulbapedia.bulbagarden.net/wiki/Collection_151_(ATCG)'], {
    stdio: 'inherit',
  })
}

const db = openCatalog()
const file = 'server/catalog/regional-releases.json'
const out = JSON.parse(fs.readFileSync(file, 'utf8'))

const SET_ID = 'csv151c'
const ENGLISH = 'sv3pt5'

// Bulbapedia prints the line's own short grades; these are the catalogue names.
const RARITY = {
  C: 'Common',
  U: 'Uncommon',
  R: 'Rare',
  RR: 'Double Rare',
  S: 'Shiny Rare',
  AR: 'Illustration Rare',
  SR: 'Ultra Rare',
  SSR: 'Shiny Ultra Rare',
  SAR: 'Special Illustration Rare',
  UR: 'Hyper Rare',
}

// The wrapper: five cards for ¥10, fifteen to the slim box (PokiPair,
// PokeUnlimited, Keef's, Collectors Kingdom). The 20-card ¥50 jumbo pack and its
// six-pack box exist and are not stocked, exactly as for Black Bolt.
const PACK_USD = 1.41
const BOX_PACKS = 15

const html = fs.readFileSync(PAGE, 'utf8')
const start = html.indexOf('id="Card_list"')
const end = html.indexOf('id="Gallery"')
if (start < 0 || end < 0) throw new Error('card list section not found')
const seg = html.slice(start, end)

const decode = (s) =>
  s.replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').trim()

const rows = []
for (const r of seg.split('<tr>').slice(1)) {
  const num = (r.match(/<td[^>]*>\s*(\d{3})\/151\s*<\/td>/) ?? [])[1]
  if (!num) continue
  // The name cell links the card article; the " ex" suffix sits outside the link
  // on some rows, so the cell's own text is read and tidied.
  const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1])
  const name = decode((cells[2] ?? '').replace(/<[^>]*>/g, ' '))
  const grade = (r.match(/alt="([A-Za-z]{1,3})" src="[^"]*Rarity/) ?? [])[1]
  const rarity = RARITY[grade]
  if (!rarity) throw new Error(`unknown grade "${grade}" on ${num}`)
  rows.push({ num, name: name.replace(/\s+/g, ' '), rarity })
}
const nums = rows.map((r) => Number(r.num))
const contiguous = nums.every((n, i) => n === i + 1)
console.log(`rows ${rows.length} · contiguous ${contiguous} · ${JSON.stringify(rows.reduce((m, r) => ((m[r.rarity] = (m[r.rarity] ?? 0) + 1), m), {}))}`)
if (!contiguous) throw new Error('numbering is not 001-192')

const at = (sql, ...params) => pick(db, sql, ...params)

const cards = []
const unpriced = []
const noMeta = []
let floor = Infinity

for (const r of rows) {
  const n = Number(r.num)
  // 001-151 is National Pokédex order in both prints, so the card at the same
  // number in the English 151 is the same Pokémon; the secrets are matched by
  // name (with the " ex" the Chinese list sometimes drops) and rarity.
  const english =
    (n <= 151 ? at(`SELECT * FROM cards WHERE set_id = ? AND number = ?`, ENGLISH, String(n)) : null) ??
    at(`SELECT c.* FROM cards c WHERE c.name = ? AND c.rarity = ? ORDER BY c.set_id LIMIT 1`, tidy(r.name), r.rarity) ??
    at(`SELECT c.* FROM cards c WHERE c.name = ? AND c.rarity = ? ORDER BY c.set_id LIMIT 1`, tidy(r.name) + ' ex', r.rarity) ??
    at(`SELECT c.* FROM cards c WHERE c.name = ? ORDER BY c.set_id LIMIT 1`, tidy(r.name)) ??
    at(`SELECT c.* FROM cards c WHERE c.name = ? ORDER BY c.set_id LIMIT 1`, tidy(r.name) + ' ex')
  if (!english) noMeta.push(`${r.num} ${r.name}`)
  const name = tidy(english?.name ?? r.name)
  // The same card in the English 151 first, then the same name and rarity, then
  // any printing of the name — the shared anchor both Chinese lines use.
  const anchor = anchorFor(db, { english, name, rarity: r.rarity })
  const raw = marketOf(db, anchor?.id)
  if (!(raw > 0)) unpriced.push(`${r.num} ${name} [${r.rarity}]`)
  else floor = Math.min(floor, raw)
  cards.push({
    id: `${SET_ID}-${r.num}`,
    set_id: SET_ID,
    name,
    supertype: english?.supertype ?? 'Pokémon',
    subtypes: english?.subtypes ? JSON.parse(english.subtypes) : null,
    number: `${r.num}/151`,
    position: n,
    rarity: r.rarity,
    types: english?.types ? JSON.parse(english.types) : null,
    hp: english?.hp ?? null,
    // The four Pikachu art rares are China-only and illustrated by Oswaldo KATO
    // (Bulbapedia's set notes say so); every other card's artist is the same art
    // in the English print, so it is read off that card.
    artist: n >= 170 && n <= 173 && r.rarity === 'Illustration Rare' ? 'Oswaldo KATO' : english?.artist ?? null,
    dex_numbers: english?.dex_numbers ? JSON.parse(english.dex_numbers) : null,
    image_small: null,
    image_large: null,
    regulation_mark: english?.regulation_mark ?? null,
    _raw: raw,
  })
}

// The pull ladder. Bulbapedia's own wording is structural — "one card will either
// be Reverse Holofoil or have a rarity of Rare or higher" — but it prints no rates,
// and no spec sheet for this line has been published. The only numbers are a
// third-party count (Pokecottage): about 90% of cards pulled are Commons or
// Uncommons, about 8% Rares or Double Rares, and 1.5% or less higher tiers. They
// are carried as the ladder's shares and labelled an estimate; the 0.5% the
// rounding leaves is given to the C/U body so the shares sum to the whole wrapper.
const LADDER = [
  { slot: 'holo', share: 0.905, rarities: ['Common', 'Uncommon'] },
  { slot: 'holo', share: 0.08, rarities: ['Rare', 'Double Rare'] },
  { slot: 'holo', share: 0.015, rarities: ['Shiny Rare', 'Illustration Rare', 'Ultra Rare', 'Shiny Ultra Rare', 'Special Illustration Rare', 'Hyper Rare'] },
]

// Scale the set to its wrapper, the shared rule for both Chinese lines: relative
// worth is the English printings', the absolute level is the one price anyone can
// check. One pool of five cards, so the plan is a single five-card slot.
const { ev, k, packEv } = scaleToWrapper({
  cards,
  ladder: LADDER,
  plan: [{ slot: 'holo', count: 5 }],
  packUsd: PACK_USD,
})
console.log(`English-comparable pack EV $${ev.toFixed(2)} → scaled ×${k.toFixed(3)} → $${packEv.toFixed(2)} per pack`)

const set = {
  id: SET_ID,
  name: 'Collection 151',
  series: 'Collection 151 (Simplified Chinese)',
  printed_total: cards.length,
  total: cards.length,
  ptcgo_code: '151C',
  release_date: '2025/01/17',
  symbol_url: null,
  logo_url: null,
}
const products = [
  {
    id: `${SET_ID}-booster`,
    set_id: SET_ID,
    name: 'Collection 151 Booster Pack',
    kind: 'pack',
    msrp: PACK_USD,
    packs: 1,
    cards_per_pack: 5,
    release_date: '2025/01/17',
    description: 'Collection 151 booster pack — 5 cards, one of them a foil or better. ¥10.',
  },
  {
    id: `${SET_ID}-box`,
    set_id: SET_ID,
    name: 'Collection 151 Booster Box',
    kind: 'display',
    msrp: Math.round(BOX_PACKS * PACK_USD * 100) / 100,
    packs: BOX_PACKS,
    cards_per_pack: 5,
    release_date: '2025/01/17',
    description: `Collection 151 slim booster box — ${BOX_PACKS} packs of 5 cards (${BOX_PACKS * 5} cards).`,
  },
]

out.sets = [...out.sets.filter((s) => s.id !== SET_ID), set]
out.cards = [...out.cards.filter((c) => c.set_id !== SET_ID), ...cards]
out.products = [...out.products.filter((p) => p.set_id !== SET_ID), ...products]
out.release = 'Gem Pack Vol. 1-7, Black Bolt / White Flare and Collection 151 (Simplified Chinese)'
out.ladderPacks = { ...(out.ladderPacks ?? {}), [SET_ID]: LADDER }
out.note =
  "Four things are modelled rather than measured. The Gem Pack ladder uses the publisher's ratio table (★ 17.39%, ★★ 5.80%, ★★★ 1.81%; ● and ◆ take the remainder), printed for Vols. 6 and 7 and applied to 1-5 as the line's figure. Black Bolt and White Flare use their own spec sheet (13.23%, 6.04%, 0.73% of cards dealt); Collection 151 publishes no spec sheet, so its ladder (90% commons and uncommons, 8% Rares and Double Rares, 1.5% higher) is a third-party count and is labelled one. No Chinese card in any of these lines has a recorded sale, so every value is anchored to the same card's English printing — the cheapest plain listing, which is an upper bound on what the Chinese copy trades at — and each line is scaled down where those values would put a five-card pack above 85% of its ¥10 sticker: Black Bolt ×0.226, White Flare ×0.272 and Collection 151 ×" +
    k.toFixed(3) +
    ". Black Bolt and White Flare carry the card lists Bulbapedia publishes (171 and 172 cards after Victini's unsupported Black White Rare entry is dropped, against the Chinese release's 174), with the tail numbered as the cards print: both China-only Special Illustration Rares at 173/086 and Zekrom ex and Reshiram ex at 174/086. Collection 151 uses the full 192-card list through the fourth booster, Gather; the April 2025 list of 186 is that set before Scare and Gather added three Pikachu art rares and three SARs, and Pokecottage's 465 counts reverse and Poké Ball/Master Ball variants of the same cards."

fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
console.log(`set ${set.id}: ${cards.length} cards · ${cards.filter((c) => c.price).length} priced · floor $${floor}`)
if (noMeta.length) console.log('no English row:', noMeta.length, noMeta.slice(0, 6))
if (unpriced.length) console.log('unpriced:', unpriced.length, unpriced.slice(0, 8))
