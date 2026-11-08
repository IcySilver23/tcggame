// Mirror report: which cards wear the paper, what is painted, and what is not.
//
// Run: ./node_modules/.bin/tsx scripts/mirror-report.ts
//
// Three claims are kept apart on purpose, exactly as the Tinsel and Starlight
// reports do:
//
//   identified  Pokumon classifies nine BW Black Star Promos as Mirror, and
//               Bulbapedia tags the same variant printings ("N [Mirror Holofoil]",
//               and its Mega Evolution page naming Mirror as the BW-era paper).
//               Verified per printing by promo-buckets-db.ts + printing-db.ts.
//   painted     this build ships a sheen sheet: a uniform mirror modulated along a
//               diagonal. It is a procedural RECONSTRUCTION, not a scan, and every
//               row here says so.
//   not painted Crosshatch and textured BW promos keep rendering plain foil: no
//               sheet for either paper exists here and this one is not theirs. The
//               row no source lists (BW32 Victini) makes no claim at all.

import fs from 'node:fs'
import { printingFor, nonHoloFor } from '../src/foil/printing-db'
import { foilMaskFor } from '../src/foil/mask'
import { PATTERNS } from '../src/foil/patterns'
import { PROMO_BUCKET_CLAIMS, PROMO_BUCKET_UNLISTED } from '../src/foil/promo-buckets-db'
import {
  MIRROR_CARDS,
  MIRROR_CLAIM,
  MIRROR_LANGUAGE_NOTE,
  MIRROR_NAME_NOTE,
  MIRROR_SHEET,
  MIRROR_NEIGHBOURS,
} from '../src/foil/mirror-index'

const VALIDATED = new Set(MIRROR_CARDS.map((c) => c.cardId))

const problems: string[] = []

const cards: {
  cardId: string
  number: string
  name: string
  reverseOnly: boolean
  alsoOn: string[]
  pattern: string | null
  mask: string | null
  maskVerified: boolean
  status: string
  matchedRule: string
  source: string
  validated: boolean
  evidence: string
}[] = []

for (const claim of MIRROR_CARDS) {
  const printing = printingFor({ cardId: claim.cardId, rarity: 'Promo' })
  if (!printing) {
    problems.push(`${claim.cardId}: no printing resolved`)
    continue
  }
  if (printing.pattern !== 'mirror') {
    problems.push(`${claim.cardId}: resolved to ${printing.pattern}, expected mirror`)
    continue
  }
  const spec = foilMaskFor({ cardId: claim.cardId, rarity: 'Promo' })
  if (!spec) {
    problems.push(`${claim.cardId}: no foil mask`)
    continue
  }
  // The reverse-only printings exist in one finish: they must answer with the token
  // AND without it, and a mirror card that was also printed plain must still answer
  // through nonHoloFor for that copy.
  if (claim.reverse) {
    const withToken = printingFor({ cardId: claim.cardId, rarity: 'Promo', variant: 'reverseHolofoil' })
    if (withToken?.pattern !== 'mirror') problems.push(`${claim.cardId}: reverse-only printing does not answer with a reverse token`)
  } else if (printingFor({ cardId: claim.cardId, rarity: 'Promo', variant: 'reverseHolofoil' })) {
    problems.push(`${claim.cardId}: invented a reverse printing`)
  }
  if (claim.alsoOn.includes('non-holo') && !nonHoloFor({ cardId: claim.cardId, rarity: 'Promo' })) {
    problems.push(`${claim.cardId}: the plain copy of a dual printing does not resolve through nonHoloFor`)
  }
  cards.push({
    cardId: claim.cardId,
    number: claim.number,
    name: claim.name,
    reverseOnly: claim.reverse,
    alsoOn: claim.alsoOn,
    pattern: printing.pattern,
    mask: printing.mask,
    maskVerified: printing.maskVerified,
    status: printing.status,
    matchedRule: printing.matchedRule,
    source: printing.source,
    validated: VALIDATED.has(claim.cardId),
    evidence: printing.note,
  })
}

if (cards.length !== MIRROR_CARDS.length) problems.push(`${MIRROR_CARDS.length - cards.length} of ${MIRROR_CARDS.length} Mirror cards did not resolve cleanly`)

// Contrast cases: the neighbouring BW treatments must not borrow this sheet.
const neighbours = MIRROR_NEIGHBOURS.textured.map((cardId) => {
  const printing = printingFor({ cardId, rarity: 'Promo' })
  if (printing?.pattern === 'mirror') problems.push(`${cardId}: a ${printing.pattern} claim was painted as Mirror`)
  return {
    cardId,
    pattern: printing?.pattern ?? null,
    implemented: !!printing?.pattern && PATTERNS[printing.pattern as keyof typeof PATTERNS]?.implemented,
  }
})
const unlisted = PROMO_BUCKET_UNLISTED.map((claim) => ({
  cardId: claim.cardId,
  pattern: printingFor({ cardId: claim.cardId, rarity: 'Promo' })?.pattern ?? null,
}))
if (unlisted.some((r) => r.pattern)) problems.push('the unlisted BW row resolved a foil; it must make no claim')

if (PATTERNS.mirror.implemented !== true) problems.push('the registry does not report Mirror as painted')
if (PATTERNS.mirror.texture !== MIRROR_SHEET.pattern) problems.push('the registry points at a different sheet than the generated index')
if (!fs.existsSync('public' + MIRROR_SHEET.pattern)) problems.push('the sheet the registry points at is not shipped')

// A card must not lose the paper when it is asked for one: the same card asked
// without a variant and with its own must agree on the pattern.
const probe = cards[0]?.cardId
if (probe) {
  const bare = printingFor({ cardId: probe, rarity: 'Promo' })
  const token = printingFor({ cardId: probe, rarity: 'Promo', variant: 'reverseHolofoil' })
  if (bare?.pattern !== token?.pattern) problems.push(`${probe}: the variant token changed the paper`)
}

const counts = {
  claimed: MIRROR_CARDS.length,
  painted: PATTERNS.mirror.implemented ? cards.length : 0,
  reverseOnly: cards.filter((c) => c.reverseOnly).length,
  fullFace: cards.filter((c) => !c.reverseOnly).length,
  maskVerified: cards.filter((c) => c.maskVerified).length,
  validated: cards.filter((c) => c.validated).length,
  textureVerified: MIRROR_SHEET.textureVerified,
  neighboursTextured: MIRROR_NEIGHBOURS.textured.length,
  unlisted: unlisted.length,
}

const cardTable = cards
  .map((c) => `| ${c.number} | ${c.name} | ${c.reverseOnly ? 'reverse only' : 'full face'} | ${c.mask} | ${c.maskVerified ? 'verified' : 'unverified'} | ${c.status} |`)
  .join('\n')

const md = `# Mirror printings

Generated by \`scripts/mirror-report.ts\`.

**${MIRROR_CLAIM}**

## Counts

| | |
| --- | --- |
| BW Black Star Promos claimed as Mirror | ${counts.claimed} |
| Painted (procedural sheen sheet) | ${counts.painted} |
| Reverse-only printings | ${counts.reverseOnly} |
| Full-face printings | ${counts.fullFace} |
| Render-validated end to end | ${counts.validated} |
| Mask verified | ${counts.maskVerified} |
| Mirror texture verified against a card | ${counts.textureVerified ? 'yes' : 'no — the sheet is a drawing'} |
| Textured BW promos painted as relief, not with this sheet | ${counts.neighboursTextured} |
| Rows no source lists | ${counts.unlisted} |

## Per card

| No. | Card | Finish | Mask | Mask verified | Status |
| --- | --- | --- | --- | --- | --- |
${cardTable}

Every row resolves through the printing database at the \`explicit\` level with
\`pattern: mirror\`. The four reverse-only printings answer with or without a reverse
token, because they exist in one finish; N's plain copy still answers through
\`nonHoloFor\`. No row here claims a researched foil area, so the illustration window
is the default and \`maskVerified\` stays false.

## What is painted, and what that claim is

\`public/foil/mirror/sheet.png\` is a **procedural reconstruction**: a uniform mirror
modulated along one diagonal, ${MIRROR_SHEET.bands} bands, coverage ${(MIRROR_SHEET.coverage * 100).toFixed(2)}%,
floor ${MIRROR_SHEET.floor.toFixed(3)}, peak ${MIRROR_SHEET.peak.toFixed(3)}. The paper prints no marks, so
there is no dot, star or stripe to draw: the sheen is light, and the mask still
decides where foil exists.

It **tiles** (measured seam ${(MIRROR_SHEET.seamMismatch * 100).toFixed(2)}%). The \`contrast\`, the number
of bands and the treatment of an angle-dependent glare as a fixed anisotropic ramp
are this build's own choices, disclosed rather than presented as measured facts. No
scan or angled photograph of the sheet exists in this repository, so
\`textureVerified\` is false in the generated index and every field built from it.

## One paper, two names

${MIRROR_NAME_NOTE.mirror}

${MIRROR_NAME_NOTE.sheen}

${MIRROR_NAME_NOTE.decision}

## The language axis

${MIRROR_LANGUAGE_NOTE}

## Neighbours

${MIRROR_NEIGHBOURS.note}

Textured: ${MIRROR_NEIGHBOURS.textured.join(', ')}.
Unlisted: ${MIRROR_NEIGHBOURS.unlisted.join(', ')}.

## Validation

\`tmp/check-mirror.ts\` proves: the sheet is a smooth diagonal band that never goes
dark and tiles; the field is uniform foil varying along the direction the source
names; every one of the nine claims resolves to Mirror with the token it needs and no
invented reverse printing; the neighbouring treatments keep their own papers; a card
at rest is the scan byte for byte and adds light only inside its mask at tilt; and a
mirror never renders as an unpatterned plain field.

It does **not** compare the sheet to a photograph, because none is in this repo.
`

const report = {
  generated: 'scripts/mirror-report.ts',
  phase: 'Phase 22 — Mirror / Sheen',
  claims: {
    identified: MIRROR_CLAIM,
    painted: 'procedural reconstruction; not a scan',
    name: MIRROR_NAME_NOTE,
    language: MIRROR_LANGUAGE_NOTE,
    neighbours: MIRROR_NEIGHBOURS,
  },
  sheet: MIRROR_SHEET,
  counts,
  cards,
  neighbours,
  unlisted,
  problems,
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/mirror-printings.json', JSON.stringify(report, null, 2) + '\n')
fs.writeFileSync('reports/mirror-printings.md', md)

console.log(`Mirror: ${counts.claimed} BW promos, painted ${counts.painted} (${counts.reverseOnly} reverse only)`)
console.log(`  neighbours: textured (relief) ${counts.neighboursTextured}; unlisted ${counts.unlisted}`)
console.log(`  problems: ${problems.length}`)
for (const p of problems) console.log(`  - ${p}`)
if (problems.length) process.exit(1)
