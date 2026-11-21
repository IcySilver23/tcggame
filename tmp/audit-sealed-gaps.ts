// Sealed-catalogue gap audit: real products with NO row at all.
//
// Scope note: this deliberately ignores rows the shop hides (unsellableReason /
// SUBSET_ONLY_SETS / NO_BOOSTER_SETS). It asks a different question — which real,
// documented sealed products never made it into `pack_products` in the first place.
//
// Every family below is sourced; package counts are only stated where the source
// states them, because an invented pack count is the same error as an invented SKU.
//
// Run on a copy of the save:
//   npx tsx tmp/audit-sealed-gaps.ts
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const root = path.resolve('.')
const home = path.join(root, 'tmp', 'sealed-gap-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
const source = new Database(path.join(root, 'data', 'tcglife.db'), { readonly: true })
await source.backup(path.join(home, 'data', 'tcglife.db'))
source.close()

const db = new Database(path.join(home, 'data', 'tcglife.db'), { readonly: true })
const setIds = new Set((db.prepare('SELECT id FROM sets').all() as { id: string }[]).map((r) => r.id))
const rowIds = new Set((db.prepare('SELECT id FROM pack_products').all() as { id: string }[]).map((r) => r.id))

type Family = {
  id: string
  label: string
  /** Expected row ids, one per real SKU. */
  skus: { id: string; set: string; name: string; packs?: number }[]
  source: string
}

const range = (from: number, to: number, prefix: string, suffix = '') =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}${suffix}`)

// Every main expansion since Fates Collide shipped a Build & Battle Box; Bulbapedia
// lists them expansion by expansion (XY10 through Chaos Rising), and Pokémon.com
// confirms Delta Reign's for 20 November 2026. Pitch Black's is not in the read
// excerpt, so it is deliberately left out rather than assumed.
const BB_SETS = ['xy10', 'xy11', 'xy12', ...range(1, 12, 'sm'), ...range(1, 12, 'swsh'), ...range(1, 10, 'sv'), 'me1', 'me2', 'me3', 'me4', 'me6']
const STADIUM_SETS = [...range(7, 12, 'swsh'), ...range(1, 4, 'sv')]

const families: Family[] = [
  {
    id: 'build-battle',
    label: 'Build & Battle Box (4 packs + 1 of 4 prerelease promos)',
    skus: BB_SETS.map((s) => ({ id: `${s}-build-battle`, set: s, name: `${s} Build & Battle Box`, packs: 4 })),
    source: 'Bulbapedia — Build & Battle Box (TCG): released with every main expansion since Fates Collide; Pokémon.com Nov 2026 release list (Delta Reign)',
  },
  {
    id: 'build-battle-stadium',
    label: 'Build & Battle Stadium (2 boxes + 4 extra packs)',
    skus: STADIUM_SETS.map((s) => ({ id: `${s}-build-battle-stadium`, set: s, name: `${s} Build & Battle Stadium`, packs: 12 })),
    source: 'Bulbapedia — Build & Battle Stadium (TCG): Evolving Skies through Paradox Rift',
  },
  {
    id: '151-collections',
    label: '151 special collections',
    skus: [
      { id: 'sv3pt5-upc', set: 'sv3pt5', name: '151 Ultra-Premium Collection', packs: 16 },
      { id: 'sv3pt5-poster', set: 'sv3pt5', name: '151 Poster Collection' },
      { id: 'sv3pt5-binder', set: 'sv3pt5', name: '151 Binder Collection' },
      { id: 'sv3pt5-zapdos-ex', set: 'sv3pt5', name: 'Zapdos ex Collection' },
      { id: 'sv3pt5-alakazam-ex', set: 'sv3pt5', name: 'Alakazam ex Collection' },
      { id: 'sv3pt5-mini-tin', set: 'sv3pt5', name: '151 Mini Tin' },
    ],
    source: 'Pokémon.com — 151 Ultra-Premium Collection (16 packs, Mew ex + Mewtwo promos, metal card); PriceCharting 151 sealed list (Poster, Binder, Zapdos ex, Alakazam ex, Mini Tin Display)',
  },
  {
    id: 'paldean-fates-collections',
    label: 'Paldean Fates collections',
    skus: [
      { id: 'sv4pt5-great-tusk-iron-treads', set: 'sv4pt5', name: 'Great Tusk ex & Iron Treads ex Premium Collection' },
      { id: 'sv4pt5-tech-sticker', set: 'sv4pt5', name: 'Paldean Fates Tech Sticker Collection' },
      { id: 'sv4pt5-charizard-tin', set: 'sv4pt5', name: 'Paldean Fates Charizard ex Tin' },
      { id: 'sv4pt5-bundle-display', set: 'sv4pt5', name: 'Paldean Fates Booster Bundle Display' },
    ],
    source: 'PriceCharting — Pokemon Paldean Fates sealed list',
  },
  {
    id: 'shrouded-fable-collections',
    label: 'Shrouded Fable collections',
    skus: [
      { id: 'sv6pt5-greninja-sic', set: 'sv6pt5', name: 'Greninja ex Special Illustration Collection' },
      { id: 'sv6pt5-kingdra-sic', set: 'sv6pt5', name: 'Kingdra ex Special Illustration Collection' },
      { id: 'sv6pt5-kingambit-ic', set: 'sv6pt5', name: 'Kingambit Illustration Collection' },
      { id: 'sv6pt5-mini-tin', set: 'sv6pt5', name: 'Shrouded Fable Mini Tin' },
      { id: 'sv6pt5-triple-blister', set: 'sv6pt5', name: 'Shrouded Fable 3-Pack Blister', packs: 3 },
      { id: 'sv6pt5-bundle-display', set: 'sv6pt5', name: 'Shrouded Fable Booster Bundle Display' },
    ],
    source: 'PriceCharting — Pokemon Shrouded Fable sealed list',
  },
  {
    id: 'prismatic-collections',
    label: 'Prismatic Evolutions collections',
    skus: [
      { id: 'sv8pt5-super-premium', set: 'sv8pt5', name: 'Prismatic Evolutions Super-Premium Collection' },
      { id: 'sv8pt5-poster', set: 'sv8pt5', name: 'Prismatic Evolutions Poster Collection' },
      { id: 'sv8pt5-surprise-box', set: 'sv8pt5', name: 'Prismatic Evolutions Surprise Box' },
      { id: 'sv8pt5-premium-figure', set: 'sv8pt5', name: 'Prismatic Evolutions Premium Figure Collection' },
      { id: 'sv8pt5-lucario-tyranitar', set: 'sv8pt5', name: 'Lucario ex & Tyranitar ex Premium Collection' },
      { id: 'sv8pt5-bundle-display', set: 'sv8pt5', name: 'Prismatic Evolutions Booster Bundle Display' },
    ],
    source: 'PriceCharting — Pokemon Prismatic Evolutions sealed list',
  },
  {
    id: 'celebrations-collections',
    label: 'Celebrations collections',
    skus: [
      { id: 'cel25-upc', set: 'cel25', name: 'Celebrations Ultra-Premium Collection', packs: 17 },
      { id: 'cel25-collectors-chest', set: 'cel25', name: "Celebrations Collector's Chest" },
      { id: 'cel25-lances-charizard', set: 'cel25', name: "Lance's Charizard V Box" },
      { id: 'cel25-dark-sylveon', set: 'cel25', name: 'Dark Sylveon V Box' },
      { id: 'cel25-pikachu-v-union', set: 'cel25', name: 'Pikachu V-UNION Special Collection' },
    ],
    source: "TCGplayer — Buyer's Guide to Pokémon Celebrations (UPC: 17 Celebrations packs + 8 others, 2 gold + 2 metal promos)",
  },
  {
    id: 'surging-sparks-collections',
    label: 'Surging Sparks collections',
    skus: [{ id: 'sv8-grand-adventure', set: 'sv8', name: 'Surging Sparks Grand Adventure Collection' }],
    source: 'PriceCharting — Pokemon Surging Sparks sealed list',
  },
]

let totalSkus = 0
let presentSkus = 0
const missingSets = new Set<string>()
const unknownSets = new Set<string>()
const lines: string[] = []

for (const fam of families) {
  const missing = fam.skus.filter((s) => !rowIds.has(s.id))
  presentSkus += fam.skus.length - missing.length
  totalSkus += fam.skus.length
  for (const s of fam.skus) {
    if (!setIds.has(s.set)) unknownSets.add(s.set)
    if (!rowIds.has(s.id)) missingSets.add(s.set)
  }
  lines.push(`${fam.label}: ${missing.length}/${fam.skus.length} missing`)
  if (missing.length && missing.length <= 12) for (const m of missing) lines.push(`   - ${m.id}  ${m.name}`)
  else if (missing.length) lines.push(`   - ${missing.length} rows, sets: ${[...new Set(missing.map((m) => m.set))].slice(0, 8).join(', ')}${missing.length > 12 ? ' …' : ''}`)
}

// Reverse check: families the catalogue DOES model, for contrast.
const specialRows = (db.prepare("SELECT COUNT(*) n FROM pack_products WHERE kind='special'").get() as { n: number }).n
const setsWithSpecial = (db.prepare("SELECT COUNT(DISTINCT set_id) n FROM pack_products WHERE kind='special'").get() as { n: number }).n
const setsWithCards = (db.prepare('SELECT COUNT(DISTINCT set_id) n FROM cards').get() as { n: number }).n

console.log(lines.join('\n'))
console.log(`\nverified missing SKUs: ${totalSkus - presentSkus}/${totalSkus} across ${missingSets.size} sets`)
if (unknownSets.size) console.log('set ids NOT in catalogue:', [...unknownSets].join(' '))
console.log(`catalogue special rows: ${specialRows} across ${setsWithSpecial} of ${setsWithCards} sets with cards`)
