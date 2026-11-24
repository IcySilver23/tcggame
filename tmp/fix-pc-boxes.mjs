// One-off: replace PC_BOX_SHELF with the entries whose value agrees with the
// page's own SOLD table, and drop the ones that only agreed with asks.
import fs from 'node:fs'

const path = 'server/catalog/sealed-evidence.ts'
let src = fs.readFileSync(path, 'utf8')

// set id -> [value, sold sales read, slug]; every one of these matched the median
// of the page's completed-sale table within 50% over three or more sales.
const KEEP = [
  ['base1', 40000, 28, 'pokemon-base-set'],
  ['base2', 13456, 25, 'pokemon-jungle'],
  ['base5', 11336.53, 30, 'pokemon-team-rocket'],
  ['base6', 110200, 6, 'pokemon-legendary-collection'],
  ['col1', 11996.11, 3, 'pokemon-call-of-legends'],
  ['dp2', 14211, 11, 'pokemon-mysterious-treasures'],
  ['dp6', 7337.38, 3, 'pokemon-legends-awakened'],
  ['dp7', 8542.75, 8, 'pokemon-stormfront'],
  ['ecard2', 155226.3, 3, 'pokemon-aquapolis'],
  ['ecard3', 212500, 5, 'pokemon-skyridge'],
  ['ex7', 67654, 3, 'pokemon-team-rocket-returns'],
  ['ex8', 29112.52, 3, 'pokemon-deoxys'],
  ['hgss3', 7710.5, 3, 'pokemon-undaunted'],
  ['hgss4', 5188.71, 6, 'pokemon-triumphant'],
  ['neo2', 13475.53, 4, 'pokemon-neo-discovery'],
  ['pl1', 4126.82, 7, 'pokemon-platinum'],
  ['pl3', 14183.91, 9, 'pokemon-supreme-victors'],
  ['pl4', 5743.39, 7, 'pokemon-arceus'],
]

const rows = KEEP.map(
  ([id, market, sales, slug]) => `  '${id}-display': { market: ${market}, sales: ${sales}, slug: '${slug}' },`,
).join('\n')

const table = `export const PC_BOX_SHELF: Readonly<Record<string, { market: number; sales: number; slug: string }>> = {\n${rows}\n}`

const start = src.indexOf('export const PC_BOX_SHELF')
const end = src.indexOf('\n}', start) + 2
if (start < 0) throw new Error('table not found')
src = src.slice(0, start) + table + src.slice(end)

const oldCommentStart = src.indexOf('// Collector-era boxes whose TCGplayer listing publishes no market at all')
const oldCommentEnd = src.indexOf('export const PC_BOX_SHELF')
const comment = `// Collector-era boxes whose TCGplayer listing publishes no market at all — the
// whole WotC-through-BW run — priced from PriceCharting's sold-price value instead.
//
// PriceCharting averages completed sales, so each page was read twice: the value it
// publishes, and the sale table under it. The number is only allowed to price a box
// when it agrees with the MEDIAN OF ITS OWN SOLD ROWS to within 50%, over at least
// three completed sales. Asks are excluded: the same table carries a
// "listed-price" column for what a seller was asking, and the first pass over these
// pages counted every dollar figure on them, asks included. That admitted ten
// entries whose real sale evidence was 1.5x to 4.7x below the value, and three
// times refused a set the sales actually support — both corrected here, and 'sales'
// is now the count of completed sales read, not of figures seen.
//
// Refused on disagreement with its own sales: base3 (2.1x), base4 (2.1x), gym1
// (2.9x), neo1 (2.3x), neo4 (0.4x), ecard1 (3.3x), ex5 (2.1x), ex13 (0.66x), ex16
// (1.5x), dp3 (1.9x), dp4 (0.5x), pl2 (1.6x), and every Black & White box that has a
// page (2.9x to 5.5x).
// Too few completed sales to price anything: neo3, ex9, ex10, ex12, ex14, dp5,
// ex15 (one or two each).
// No PriceCharting product page at all: ex1, ex2, ex3, ex4, ex6, dp1, hgss1, bw1.
// Mysterious Treasures is here even though TCGplayer shows an $18,000 market: its
// own ask is $35,000 and PriceCharting's $14,211 matches its sold median exactly, so
// the figure that agrees with its evidence is the one used.

`
if (oldCommentStart >= 0) src = src.slice(0, oldCommentStart) + comment + src.slice(oldCommentEnd)

fs.writeFileSync(path, src)
console.log(`wrote ${KEEP.length} entries`)
