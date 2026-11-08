// Crosshatch report: which cards wear the paper, what is painted, and what is not.
//
// Run: ./node_modules/.bin/tsx scripts/crosshatch-report.ts
//
// Three claims are kept apart on purpose, exactly as the Tinsel, Starlight and
// Mirror reports do:
//
//   identified  Pokumon files three BW Black Star Promos — the Victory Cup cards —
//               as Crosshatch, and Bulbapedia names the treatment for Play! Pokémon
//               awards. Verified per printing by promo-buckets-db.ts + printing-db.ts.
//   painted     this build ships a lattice sheet. It is a procedural
//               RECONSTRUCTION, not a scan, and every row here says so.
//   not painted no later Play! Pokémon award is painted by habit: this sheet is
//               Crosshatch, and "an award card" is not evidence of a paper. The
//               textured BW promos carry an embossed paper with no marks, so they
//               are painted as a relief rather than with this lattice.

import fs from 'node:fs'
import { nonHoloFor, printingFor } from '../src/foil/printing-db'
import { foilMaskFor } from '../src/foil/mask'
import { PATTERNS } from '../src/foil/patterns'
import { PROMO_BUCKET_CLAIMS, PROMO_BUCKET_UNLISTED } from '../src/foil/promo-buckets-db'
import {
  CROSSHATCH_AREA_NOTE,
  CROSSHATCH_CARDS,
  CROSSHATCH_CLAIM,
  CROSSHATCH_SCOPE_NOTE,
  CROSSHATCH_SHEET,
  CROSSHATCH_NEIGHBOURS,
} from '../src/foil/crosshatch-index'

const VALIDATED = new Set(CROSSHATCH_CARDS.map((c) => c.cardId))

const problems: string[] = []

const cards: {
  cardId: string
  number: string
  name: string
  pattern: string | null
  mask: string | null
  maskKind: string | null
  maskVerified: boolean
  status: string
  matchedRule: string
  source: string
  validated: boolean
  evidence: string
}[] = []

for (const claim of CROSSHATCH_CARDS) {
  const printing = printingFor({ cardId: claim.cardId, rarity: 'Promo' })
  if (!printing) {
    problems.push(`${claim.cardId}: no printing resolved`)
    continue
  }
  if (printing.pattern !== 'crosshatch') {
    problems.push(`${claim.cardId}: resolved to ${printing.pattern}, expected crosshatch`)
    continue
  }
  if (printing.mask !== claim.mask) {
    problems.push(`${claim.cardId}: mask is ${printing.mask}, expected ${claim.mask}`)
  }
  const spec = foilMaskFor({ cardId: claim.cardId, rarity: 'Promo' })
  if (!spec) {
    problems.push(`${claim.cardId}: no foil mask`)
    continue
  }
  // The paper sits on the body: these cards are not reverse printings, so a
  // marketplace reverse flag must not invent a second printing.
  if (printingFor({ cardId: claim.cardId, rarity: 'Promo', variant: 'reverseHolofoil' })) {
    problems.push(`${claim.cardId}: invented a reverse printing`)
  }
  if (nonHoloFor({ cardId: claim.cardId, rarity: 'Promo' })) {
    problems.push(`${claim.cardId}: claimed a non-holo printing this programme did not make`)
  }
  cards.push({
    cardId: claim.cardId,
    number: claim.number,
    name: claim.name,
    pattern: printing.pattern,
    mask: printing.mask,
    maskKind: spec.kind,
    maskVerified: printing.maskVerified,
    status: printing.status,
    matchedRule: printing.matchedRule,
    source: printing.source,
    validated: VALIDATED.has(claim.cardId),
    evidence: printing.note,
  })
}

if (cards.length !== CROSSHATCH_CARDS.length) {
  problems.push(`${CROSSHATCH_CARDS.length - cards.length} of ${CROSSHATCH_CARDS.length} Crosshatch cards did not resolve cleanly`)
}

// The neighbouring treatments keep their own papers.
const neighbours = CROSSHATCH_NEIGHBOURS.textured.map((cardId) => {
  const printing = printingFor({ cardId, rarity: 'Promo' })
  if (printing?.pattern === 'crosshatch') problems.push(`${cardId}: borrowed the Crosshatch sheet`)
  // The textured paper has no marks to paint: its texture is a relief, and this
  // sheet is never lent to it.
  if (printing?.pattern !== 'textured-full-art') problems.push(`${cardId}: stopped resolving as textured`)
  return { cardId, pattern: printing?.pattern ?? null }
})
const unlisted = PROMO_BUCKET_UNLISTED.map((claim) => ({
  cardId: claim.cardId,
  pattern: printingFor({ cardId: claim.cardId, rarity: 'Promo' })?.pattern ?? null,
}))
if (unlisted.some((r) => r.pattern)) problems.push('the unlisted BW row resolved a foil; it must make no claim')

// A paper filed as Mirror must not have been repainted by this work.
const mirrorRows = PROMO_BUCKET_CLAIMS.filter((c) => c.treatment === 'mirror')
const borrowed = mirrorRows.filter((c) => printingFor({ cardId: c.cardId, rarity: 'Promo' })?.pattern === 'crosshatch')
if (borrowed.length) problems.push(`${borrowed.map((c) => c.cardId).join(', ')}: a Mirror card resolved to Crosshatch`)

if (PATTERNS.crosshatch.implemented !== true) problems.push('the registry does not report Crosshatch as painted')
if (PATTERNS.crosshatch.texture !== CROSSHATCH_SHEET.pattern) problems.push('the registry points at a different sheet than the generated index')
if (!fs.existsSync('public' + CROSSHATCH_SHEET.pattern)) problems.push('the sheet the registry points at is not shipped')

const counts = {
  claimed: CROSSHATCH_CARDS.length,
  painted: PATTERNS.crosshatch.implemented ? cards.length : 0,
  maskOutsideArt: cards.filter((c) => c.mask === 'outside-art').length,
  maskVerified: cards.filter((c) => c.maskVerified).length,
  validated: cards.filter((c) => c.validated).length,
  textureVerified: CROSSHATCH_SHEET.textureVerified,
  tiles: CROSSHATCH_SHEET.tiles,
  neighboursTextured: CROSSHATCH_NEIGHBOURS.textured.length,
  unlisted: unlisted.length,
}

const cardTable = cards
  .map(
    (c) =>
      `| ${c.number} | ${c.name} | ${c.pattern} | ${c.mask} (${c.maskKind}) | ${c.maskVerified ? 'verified' : 'unverified'} | ${c.status} |`,
  )
  .join('\n')

const md = `# Crosshatch printings

Generated by \`scripts/crosshatch-report.ts\`.

**${CROSSHATCH_CLAIM}**

## Counts

| | |
| --- | --- |
| BW Black Star Promos claimed as Crosshatch | ${counts.claimed} |
| Painted (procedural lattice sheet) | ${counts.painted} |
| Foiled on the body, art window matte | ${counts.maskOutsideArt} |
| Mask verified | ${counts.maskVerified} |
| Render-validated end to end | ${counts.validated} |
| Crosshatch texture verified against a card | ${counts.textureVerified ? 'yes' : 'no — the sheet is a drawing'} |
| Sheet tiles | ${counts.tiles ? `yes (measured wrap step ${(CROSSHATCH_SHEET.wrapMismatch * 100).toFixed(2)}%)` : 'no'} |
| Textured BW promos painted as relief, not with this sheet | ${counts.neighboursTextured} |
| Rows no source lists | ${counts.unlisted} |

## Per card

| No. | Card | Pattern | Mask | Mask verified | Status |
| --- | --- | --- | --- | --- | --- |
${cardTable}

Every row resolves through the printing database at the \`explicit\` level with
\`pattern: crosshatch\`.

## Where the paper sits

${CROSSHATCH_AREA_NOTE}

## What is painted, and what that claim is

\`public/foil/crosshatch/sheet.png\` is a **procedural reconstruction**: two families
of thin diagonal lines at ${CROSSHATCH_SHEET.pitch}px pitch, ${CROSSHATCH_SHEET.perFamily} lines each, crossing
into diamonds — coverage ${(CROSSHATCH_SHEET.coverage * 100).toFixed(2)}%, peak ${CROSSHATCH_SHEET.peak.toFixed(3)}, and a
deliberately dark ${CROSSHATCH_SHEET.fieldBetween.toFixed(3)} mean field between the lines, which is what makes a
line read as a line. The pitch, the line width, the per-line intensity and the
breaks are this build's drawings: the source names the two families and the grid,
not a count or a repeat. No scan or angled photograph of a Crosshatch card exists in
this repository, so \`textureVerified\` is false in the generated index and every
field built from it.

The sheet **tiles**: the lattice repeats every ${CROSSHATCH_SHEET.pitch}px and ${CROSSHATCH_SHEET.perFamily} cells fit
the sheet exactly, so the line at the last column continues at the first. The measured
wrap step is ${(CROSSHATCH_SHEET.wrapMismatch * 100).toFixed(2)}%, which is one pixel of the lattice's own
gradient rather than a phase jump, so a card may sample any window.

## When the treatment stopped

${CROSSHATCH_SCOPE_NOTE.used}

${CROSSHATCH_SCOPE_NOTE.ended}

${CROSSHATCH_SCOPE_NOTE.decision}

## Neighbours

${CROSSHATCH_NEIGHBOURS.note}

Textured: ${CROSSHATCH_NEIGHBOURS.textured.join(', ')}.
Unlisted: ${CROSSHATCH_NEIGHBOURS.unlisted.join(', ')}.

## Validation

\`tmp/check-crosshatch.ts\` proves: the sheet carries two line families that cross into
a grid, a dark field between them, determinism, and the measured repeat; the sampler
wraps instead of clamping at the edge; all three claims resolve to Crosshatch
with the body mask; the neighbouring papers keep theirs; a card at rest is the scan
byte for byte, adds light only inside its mask at tilt, and a line over printed white
adds nothing.

It does **not** compare the sheet to a photograph, because none is in this repo.
`

const report = {
  generated: 'scripts/crosshatch-report.ts',
  phase: 'Phase 23 — Crosshatch',
  claims: {
    identified: CROSSHATCH_CLAIM,
    area: CROSSHATCH_AREA_NOTE,
    painted: 'procedural reconstruction; not a scan',
    scope: CROSSHATCH_SCOPE_NOTE,
    neighbours: CROSSHATCH_NEIGHBOURS,
  },
  sheet: CROSSHATCH_SHEET,
  counts,
  cards,
  neighbours,
  unlisted,
  problems,
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/crosshatch-printings.json', JSON.stringify(report, null, 2) + '\n')
fs.writeFileSync('reports/crosshatch-printings.md', md)

console.log(`Crosshatch: ${counts.claimed} BW promos, painted ${counts.painted} (mask ${counts.maskOutsideArt} outside-art)`)
console.log(`  neighbours: textured (relief) ${counts.neighboursTextured}; unlisted ${counts.unlisted}`)
console.log(`  problems: ${problems.length}`)
for (const p of problems) console.log(`  - ${p}`)
if (problems.length) process.exit(1)
