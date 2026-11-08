// Sequin report: what the paper is, what ships, and which cards wear it.
//
// Run: ./node_modules/.bin/tsx scripts/sequin-report.ts
//
// The claims stay apart, as every other paper report does:
//
//   identified  Bulbapedia names Sequin for the General Mills promotional cards
//               exclusively, from August 2017, and describes "many small reflective
//               geometric shapes scattered across the image". Its Sequin section also
//               carries a table per series naming every card the paper printed.
//   resolved    printing-db.ts holds those 19 cards as SEQUIN_PRINTINGS, and they answer
//               only for the explicit `sequinHolofoil` variant: the plain promo of the same
//               number is a different printing and makes no foil claim.
//   painted     this build ships a drawn polygon sheet. It is a procedural
//               RECONSTRUCTION, not a scan, and every field built from it says so.
//   not claimed the side count, radii, density, brightness and any repeat; and the foil
//               AREA, which no source describes.
//   one row      every card on the list was also distributed another way, and a save
//               cannot distinguish physical copies, so the row paints the sequin copy.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { PATTERNS } from '../src/foil/patterns'
import { holoFor } from '../src/holo'
import { printingFor, SEQUIN_PRINTINGS, SEQUIN_VARIANT } from '../src/foil/printing-db'
import { SEQUIN_CARDS, SEQUIN_CARDS_CAVEAT, SEQUIN_CLAIM, SEQUIN_SHEET } from '../src/foil/sequin-index'

const problems: string[] = []

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db
  .prepare('select id, set_id, number, name, rarity from cards order by id')
  .all() as { id: string; set_id: string; number: string; name: string; rarity: string | null }[]
db.close()

// The sweep is the authority on which cards wear the paper; the generated index is a
// snapshot of it, so a mismatch means the index is stale.
const resolved = rows.filter((row) => {
  const art = holoFor({ cardId: row.id, rarity: row.rarity ?? undefined, variant: SEQUIN_VARIANT })
  return art?.pattern === 'sequin'
})
const indexIds = new Set(SEQUIN_CARDS.map((c) => c.cardId))
if (resolved.length !== indexIds.size) {
  problems.push(`the catalogue resolves ${resolved.length} sequin cards but the index lists ${indexIds.size}: rerun the sheet script`)
}
for (const card of resolved) if (!indexIds.has(card.id)) problems.push(`${card.id}: resolves to sequin but the index does not list it`)

// Every name in the printing table must resolve, and nothing else may claim the paper
// through the database: a row the sweep finds without a printing record would mean the
// paper had been borrowed by a set rule.
const printingClaims = rows.filter((row) => {
  const p = printingFor({ cardId: row.id, rarity: row.rarity ?? undefined, name: row.name, variant: SEQUIN_VARIANT })
  return p?.pattern === 'sequin'
})
if (printingClaims.length !== SEQUIN_PRINTINGS.length) {
  problems.push(`${printingClaims.length} printing records resolve to sequin but the table names ${SEQUIN_PRINTINGS.length}`)
}

// The plain printing of the same number must make NO claim: that is the point of the separate
// variant, and a row that starts resolving Sequin without the token would silently repaint every
// ordinary promo again.
const plainClaims = rows.filter((row) => {
  const p = printingFor({ cardId: row.id, rarity: row.rarity ?? undefined, name: row.name })
  return p?.pattern === 'sequin'
})
if (plainClaims.length) {
  problems.push(`${plainClaims.length} card(s) claim Sequin without the ${SEQUIN_VARIANT} token: ${plainClaims.slice(0, 3).map((r) => r.id).join(', ')}`)
}
for (const entry of SEQUIN_PRINTINGS) {
  if (!rows.some((r) => r.id === entry.cardId)) problems.push(`${entry.cardId}: the table names a card the catalogue does not hold`)
  const printing = printingFor({ cardId: entry.cardId, name: entry.name, variant: SEQUIN_VARIANT })
  if (printing?.pattern !== 'sequin') problems.push(`${entry.cardId}: does not resolve to the sequin paper`)
  if (printing && printing.source !== entry.source) problems.push(`${entry.cardId}: resolves from a different source than the table records`)
}
const claimedIds = new Set(printingClaims.map((r) => r.id))
for (const card of resolved) {
  if (!claimedIds.has(card.id)) problems.push(`${card.id}: the sweep finds sequin but no printing record names it`)
}

if (PATTERNS.sequin.implemented !== true) problems.push('the registry does not report sequin as painted')
if (PATTERNS.sequin.texture !== SEQUIN_SHEET.pattern) problems.push('the registry points at a different sheet than the generated index')
if (!fs.existsSync('public' + SEQUIN_SHEET.pattern)) problems.push('the sheet the registry points at is not shipped')
if (SEQUIN_SHEET.textureVerified !== false) problems.push('the index claims a verified texture')
if (SEQUIN_SHEET.concept !== true) problems.push('the index does not declare the sheet a reconstruction')

const counts = {
  catalogue: rows.length,
  claimed: resolved.length,
  indexCards: indexIds.size,
  printingClaims: printingClaims.length,
  plainClaims: plainClaims.length,
  textureVerified: SEQUIN_SHEET.textureVerified,
  marks: SEQUIN_SHEET.marks,
  coverage: SEQUIN_SHEET.coverage,
  floor: SEQUIN_SHEET.floor,
  peak: SEQUIN_SHEET.peak,
  contrast: SEQUIN_SHEET.peak / SEQUIN_SHEET.floor,
  seamMismatch: SEQUIN_SHEET.seamMismatch,
  internalStep: SEQUIN_SHEET.internalStep,
  reliefClaimed: false,
}

const cardTable = resolved.length
  ? resolved
      .map((c) => {
        const entry = SEQUIN_PRINTINGS.find((p) => p.cardId === c.id)
        return `| ${c.set_id} | ${c.number} | ${c.name} | ${c.rarity ?? '—'} | ${entry?.product ?? '—'} | ${entry?.also ?? 'no other printing recorded'} |`
      })
      .join('\n')
  : '| — | — | no catalogued card resolves to this paper | — | — | — |'

const md = `# Sequin printings

Generated by \`scripts/sequin-report.ts\`.

**${SEQUIN_CLAIM}**

## Counts

| | |
| --- | --- |
| Cards in the catalogue | ${counts.catalogue.toLocaleString('en-US')} |
| Cards that resolve to Sequin | ${counts.claimed} |
| Cards listed in the generated index | ${counts.indexCards} |
| Printing records that name the paper | ${counts.printingClaims} |
| Cards that claim the paper without the variant | ${counts.plainClaims} |
| Texture verified against a card | ${counts.textureVerified ? 'yes' : 'no — the sheet is a drawing'} |
| Shapes on the sheet | ${counts.marks.toLocaleString('en-US')} |
| Coverage above the mark line | ${(counts.coverage * 100).toFixed(2)}% |
| Shape-to-field contrast | ${counts.contrast.toFixed(2)}× |
| Bare-field floor | ${counts.floor.toFixed(3)} |
| Wrap step when the sheet meets itself | ${(counts.seamMismatch * 100).toFixed(2)}% |
| Step between neighbouring pixels inside the sheet | ${(counts.internalStep * 100).toFixed(2)}% |
| Emboss modelled as relief | no |

## Per card

| Set | No. | Card | Rarity | Printing | The other printing of this number |
| --- | --- | --- | --- | --- | --- |
${cardTable}

## Where the list comes from

Bulbapedia's Holofoil page does not leave Sequin as a slogan: its Sequin section carries one table
per series, each row naming the card, its type and the General Mills product it came in. The three
tables give **eight Sun & Moon promos** (SM01, SM02, SM03, SM04, SM06, SM40, SM42, SM86), **five
Let's Go, Kanto! reprints** (Eevee \`sm1-101\`, Charmander \`sm3-18a\`, Cubone \`sm6-57\`, Bulbasaur
\`sm35-1\`, Pikachu \`sm35-28\`) and **six 25th Anniversary promos** (SWSH010, 011, 012, 013, 039,
040) — nineteen in all. \`SEQUIN_PRINTINGS\` in \`src/foil/printing-db.ts\` holds exactly those ids,
each with the product and the page it was read from, and \`holoFor\` resolves them from the table.

Pokumon's Sequin catalogue lists fifteen of the nineteen: it has no Wooloo, Morpeko, Bulbasaur or
the Shining Legends Pikachu. The two sources do not disagree about any card they share — Pokumon is
simply missing four — so the table follows the source that names the complete set and the report
records the shortfall rather than papering over it.

## One printing, one variant

${SEQUIN_CARDS_CAVEAT}

The split is real rather than cosmetic: a Sun & Moon booster card, an Alola Collection promo and a
blister promo keep variant "normal" and stay plain, while the General Mills copy is its own inventory
row with variant ${SEQUIN_VARIANT}, its own label in the binder ("Sequin Holofoil") and its own
value — anchored to the same card's ordinary price, because no source read here measures a premium
for it. The per-card table above names the other printing of every number that has one.

## What is painted, and what that claim is

\`public/foil/sequin/sheet.png\` is a **procedural reconstruction**: regular polygons of
${SEQUIN_SHEET.sides[0]}–${SEQUIN_SHEET.sides[1]} sides, circumradius ${SEQUIN_SHEET.radius[0]}–${SEQUIN_SHEET.radius[1]}px, on a
${SEQUIN_SHEET.cell}px cell grid over a dark field (floor ${SEQUIN_SHEET.floor.toFixed(3)}), because Bulbapedia names the
look, the products and the month, not a count or a size. \`textureVerified\` is false in the
generated index and in every field built from it.

The field is dark **on purpose**. This is a marked paper, so a bright field would stop the
shapes reading as shapes — the opposite of Mirror, where the floor is what keeps the foil from
going dark.

The marks are **polygons, not discs**. Each shape's boundary is a regular polygon, so at 0.8 of
its circumradius a corner is still a mark while the middle of an edge is bare. That asymmetry is
what separates Sequin from a dot field — and from Pixel / Confetti, whose flakes are axis-aligned
rectangles.

It **wraps** (seam ${(SEQUIN_SHEET.seamMismatch * 100).toFixed(2)}% against ${(SEQUIN_SHEET.internalStep * 100).toFixed(2)}% between neighbouring
pixels inside the sheet): shapes that cross an edge continue on the other side, so a card may sample
any window. On a field this dense two unrelated columns differ about as much as any neighbours, so a
near-zero seam is impossible; continuity means the seam is no larger than the sheet's own step.
Whether the real paper repeated is undocumented, so the wrap is this build's disclosed choice.

Copy variation is a **crop**, not a re-seed: each card id derives its own offset and a slight
zoom, and a save does not distinguish physical copies, so two copies of one card id share a cut.

## The foil area is modelled, not sourced

Every record uses the **illustration window** with \`maskVerified: false\`. No source read here says
which part of a Sequin card carries the paper — the tables name the card, the type and the product,
not the geometry — so the shared window is the default, exactly as it is for the pre-2012 promos.
A photograph of a Sequin card would be what verifies the area.

## What is not claimed

- **The geometry.** Side count, radii, density, brightness and the wrap are this build's choices.
- **Any relief.** The source calls the paper "reflective", not textured; no emboss is modelled.
- **The foil area.** Modelled as the illustration window; no source states it.
- **Physical-copy identity.** The row paints the sequin printing and says so; the plain copy of
  the same number is not distinguished.

## Validation

\`tmp/check-sequin.ts\` proves: the marks are polygons of 3–6 sides (a corner is a mark where an
edge's midpoint is bare), the field between them is dark, the sheet wraps and renders
deterministically, the shipped PNG and the index agree, the sampler cuts one stable window per card
and different windows per card, the registry reports it painted and points at the shipped file,
all 19 table entries resolve to the paper with their source page and a modelled mask, a card
outside the campaign does not, and a render at rest is the scan byte for byte while a tilted one
adds light only inside the mask.

It does **not** compare the sheet to a photograph, because none is in this repo.
`

const report = {
  generated: 'scripts/sequin-report.ts',
  phase: 'Sequin painted (19 General Mills printings)',
  claims: {
    identified: SEQUIN_CLAIM,
    painted: 'procedural reconstruction; not a scan',
    relief: 'not claimed: the source says reflective, not textured',
    cards: SEQUIN_CARDS_CAVEAT,
    area: 'modelled as the illustration window; no source states the foil area',
  },
  sheet: SEQUIN_SHEET,
  counts,
  cards: resolved.map((c) => ({
    cardId: c.id,
    setId: c.set_id,
    number: c.number,
    name: c.name,
    rarity: c.rarity,
    product: SEQUIN_PRINTINGS.find((p) => p.cardId === c.id)?.product ?? null,
    also: SEQUIN_PRINTINGS.find((p) => p.cardId === c.id)?.also ?? null,
    source: SEQUIN_PRINTINGS.find((p) => p.cardId === c.id)?.source ?? null,
  })),
  problems,
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/sequin-printings.json', JSON.stringify(report, null, 2) + '\n')
fs.writeFileSync('reports/sequin-printings.md', md)

console.log(`Sequin: ${counts.marks} shapes, coverage ${(counts.coverage * 100).toFixed(2)}%, contrast ${counts.contrast.toFixed(1)}x, ${counts.claimed} cards`)
console.log(`  problems: ${problems.length}`)
for (const p of problems) console.log(`  - ${p}`)
if (problems.length) process.exit(1)
