// Radiant Pokémon report: what the paper is, what is painted, and what stays unclaimed.
//
// Run: ./node_modules/.bin/tsx scripts/radiant-etched-report.ts
//
// The claims stay apart, as every other paper report does:
//
//   identified  Bulbapedia names a "special holofoil layer" for Radiant Pokémon and the
//               rarity Radiant rare, introduced in Astral Radiance. A collector guide
//               gives the finish and the area: "etched, embossed silver foil covering
//               the entire card". Verified per printing in printing-db.ts (branch 1g).
//   painted     this build ships an etched lattice. It is a procedural RECONSTRUCTION,
//               not a scan, and every row here says so.
//   not claimed the emboss itself. Relief is a separate layer with its own evidence; no
//               source measures this paper's depth or spacing, so none is modelled.
//   separation  Radiant Pokémon is not Radiant Collection. The RC subset keeps `radiant`
//               and one motif per card; this paper has its own sheet.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { printingFor } from '../src/foil/printing-db'
import { foilMaskFor } from '../src/foil/mask'
import { holoFor } from '../src/holo'
import { PATTERNS } from '../src/foil/patterns'
import {
  RADIANT_ETCHED_CARDS,
  RADIANT_ETCHED_CLAIM,
  RADIANT_ETCHED_SEPARATION,
  RADIANT_ETCHED_SHEET,
} from '../src/foil/radiant-etched-index'

const SETS = ['swsh10', 'swsh11', 'swsh12', 'swsh12pt5', 'pgo']
const VALIDATED = new Set(RADIANT_ETCHED_CARDS.map((c) => c.cardId))
const problems: string[] = []

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db
  .prepare(
    `select id, set_id, number, name from cards
     where set_id in (${SETS.map(() => '?').join(',')}) and rarity = 'Radiant Rare'
     order by set_id, cast(number as integer)`,
  )
  .all(...SETS) as { id: string; set_id: string; number: string; name: string }[]
const rc = db.prepare("select count(*) n from cards where number like 'RC%'").get() as { n: number }
db.close()

const cards = rows.map((row) => {
  const printing = printingFor({ cardId: row.id, rarity: 'Radiant Rare', name: row.name })
  if (!printing) {
    problems.push(`${row.id}: no printing resolved`)
    return { ...row, pattern: null, mask: null, maskVerified: false, status: 'none', matchedRule: 'none', source: '', validated: false, evidence: '' }
  }
  if (printing.pattern !== 'radiant-etched') problems.push(`${row.id}: resolved to ${printing.pattern}, expected radiant-etched`)
  if (printing.mask !== 'full' || !printing.maskVerified) problems.push(`${row.id}: foil area is ${printing.mask}, expected the verified whole card`)
  if (printing.status !== 'verified' || printing.matchedRule !== 'explicit') {
    problems.push(`${row.id}: ${printing.status}/${printing.matchedRule}, expected verified/explicit`)
  }
  const spec = foilMaskFor({ cardId: row.id, rarity: 'Radiant Rare' })
  if (!spec || spec.kind !== 'full') problems.push(`${row.id}: the mask is not the whole card`)
  if (holoFor({ cardId: row.id, rarity: 'Radiant Rare' })?.pattern !== 'radiant-etched') {
    problems.push(`${row.id}: holoFor does not carry the pattern`)
  }
  return {
    ...row,
    pattern: printing.pattern,
    mask: printing.mask,
    maskVerified: printing.maskVerified,
    status: printing.status,
    matchedRule: printing.matchedRule,
    source: printing.source,
    validated: VALIDATED.has(row.id),
    evidence: printing.note,
  }
})

if (rows.length !== 15) problems.push(`the catalogue holds ${rows.length} Radiant Pokémon rows, expected 15`)
if (RADIANT_ETCHED_CARDS.length !== rows.length) problems.push('the generated card table and the catalogue disagree')
if (RADIANT_ETCHED_CARDS.some((c) => !VALIDATED.has(c.cardId))) problems.push('a generated card id is missing from the validation set')

if (PATTERNS['radiant-etched'].implemented !== true) problems.push('the registry does not report Radiant Pokémon as painted')
if (PATTERNS['radiant-etched'].texture !== RADIANT_ETCHED_SHEET.pattern) {
  problems.push('the registry points at a different sheet than the generated index')
}
if (!fs.existsSync('public' + RADIANT_ETCHED_SHEET.pattern)) problems.push('the sheet the registry points at is not shipped')
if (PATTERNS.radiant.implemented !== true || PATTERNS.radiant.label !== 'Radiant Collection') {
  problems.push('the Radiant Collection pattern moved; it is a different paper')
}

const counts = {
  claimed: rows.length,
  painted: PATTERNS['radiant-etched'].implemented ? cards.length : 0,
  maskVerified: cards.filter((c) => c.maskVerified).length,
  validated: cards.filter((c) => c.validated).length,
  textureVerified: RADIANT_ETCHED_SHEET.textureVerified,
  coverage: RADIANT_ETCHED_SHEET.coverage,
  contrast: RADIANT_ETCHED_SHEET.peak / RADIANT_ETCHED_SHEET.floor,
  seamMismatch: RADIANT_ETCHED_SHEET.seamMismatch,
  radiantCollectionCards: rc.n,
  reliefClaimed: false,
}

const perSet = SETS.map((setId) => {
  const own = cards.filter((c) => c.set_id === setId)
  return `| ${setId} | ${own.length} | ${own.map((c) => c.name.replace('Radiant ', '')).join(', ')} |`
}).join('\n')

const cardTable = cards
  .map((c) => `| ${c.number} | ${c.name} | ${c.mask} | ${c.maskVerified ? 'verified' : 'unverified'} | ${c.status} |`)
  .join('\n')

const md = `# Radiant Pokémon printings

Generated by \`scripts/radiant-etched-report.ts\`.

**${RADIANT_ETCHED_CLAIM}**

## Counts

| | |
| --- | --- |
| Radiant Pokémon in the catalogue | ${counts.claimed} |
| Painted (procedural etched sheet) | ${counts.painted} |
| Foil area verified (whole card) | ${counts.maskVerified} |
| Render-validated end to end | ${counts.validated} |
| Etched texture verified against a card | ${counts.textureVerified ? 'yes' : 'no — the sheet is a drawing'} |
| Coverage above the mid-ink line | ${(counts.coverage * 100).toFixed(2)}% |
| Ridge-to-field contrast | ${counts.contrast.toFixed(2)}× |
| Wrap step when the sheet meets itself | ${(counts.seamMismatch * 100).toFixed(2)}% |
| Emboss modelled as relief | no |
| Radiant Collection cards (a different paper) | ${counts.radiantCollectionCards} |

## Per set

| Set | Cards | Names |
| --- | --- | --- |
${perSet}

## Per card

| No. | Card | Mask | Mask verified | Status |
| --- | --- | --- | --- | --- |
${cardTable}

Every row resolves through the printing database at the \`explicit\` level with
\`pattern: radiant-etched\` and \`mask: full\`, because a source describes the foil area as
the entire card.

## What is painted, and what that claim is

\`public/foil/radiant-etched/sheet.png\` is a **procedural reconstruction**: a
${RADIANT_ETCHED_SHEET.finePeriod}px etched lattice inside a
${RADIANT_ETCHED_SHEET.coarsePeriod}px diamond grid, over silver that never goes dark
(floor ${RADIANT_ETCHED_SHEET.floor.toFixed(3)}). The pitch, the ridge widths and the contrast are
this build's reading of the described finish — the sources name the finish and the area,
not a repeat — so \`textureVerified\` is false in the generated index and every field built
from it.

It **tiles** (measured seam ${(RADIANT_ETCHED_SHEET.seamMismatch * 100).toFixed(2)}%). The residual step
is one pixel of a 16px etch's own gradient rather than a phase jump, the same situation
Crosshatch documents; whether the real paper repeated at all is undetermined, so tiling is
this build's disclosed choice.

Copy variation is a **crop**, not a re-seed: each card id derives its own offset, and a
save does not distinguish physical copies, so two copies of one card id share a cut.

## The emboss is not claimed

The finish is described as "etched, embossed". This build paints the pattern and does not
model the relief: depth and spacing would be a second claim, and no source read here
measures them. A normal map for this paper would need a raking-light photograph.

## Radiant Pokémon is not Radiant Collection

${RADIANT_ETCHED_SEPARATION}

## Validation

\`tmp/check-radiant-etched.ts\` proves: the sheet is a lattice that repeats exactly at its
coarse period, never goes dark, tiles, and renders deterministically; the shipped PNG and
the generated index agree; each card gets a stable cut and different cards get different
ones; all fifteen rows resolve to this paper with the whole card verified, and no reverse
token invents a reverse printing; a Radiant Collection card resolves to \`radiant\` instead;
the registry reports the pattern painted and points at the shipped file; and a render at
rest is the scan byte for byte while a tilted one adds light only inside the mask.

It does **not** compare the sheet to a photograph, because none is in this repo.
`

const report = {
  generated: 'scripts/radiant-etched-report.ts',
  phase: 'Phase 12 — Radiant Pokémon etched silver',
  claims: {
    identified: RADIANT_ETCHED_CLAIM,
    separation: RADIANT_ETCHED_SEPARATION,
    painted: 'procedural reconstruction; not a scan',
    relief: 'not claimed: no source measures the emboss',
  },
  sheet: RADIANT_ETCHED_SHEET,
  counts,
  cards,
  problems,
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/radiant-etched-printings.json', JSON.stringify(report, null, 2) + '\n')
fs.writeFileSync('reports/radiant-etched-printings.md', md)

console.log(`Radiant Pokémon: ${counts.claimed} rows, painted ${counts.painted}, whole-card masks verified ${counts.maskVerified}`)
console.log(`  coverage ${(counts.coverage * 100).toFixed(2)}%, contrast ${counts.contrast.toFixed(2)}x, seam ${(counts.seamMismatch * 100).toFixed(2)}%`)
console.log(`  RC cards left on their own paper: ${counts.radiantCollectionCards}`)
console.log(`  problems: ${problems.length}`)
for (const p of problems) console.log(`  - ${p}`)
if (problems.length) process.exit(1)
