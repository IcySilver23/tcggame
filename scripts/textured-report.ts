// Textured printings: the promos whose paper is EMBOSSED rather than marked.
//
// Run: ./node_modules/.bin/tsx scripts/textured-report.ts
//
// This is the one paper in the catalogue whose texture is not a mark sheet. A
// Crosshatch card prints lines, a Cosmos card prints orbs, a reverse prints its
// type symbol — a textured card prints none of those. What it has is relief: the
// foil surface is embossed, and the ridges catch light on one side and fall into
// shadow on the other as the card tilts. That is the SURFACE layer's job
// (`src/foil/surface.ts`), and it is the only layer allowed to shade down.
//
// Three claims are kept apart:
//
//   identified  Pokumon's treatment catalogue files three BW Black Star Promos as
//               Textured (BW43 Landorus, BW73 Darkrai, BW74 Giratina), and
//               promo-buckets-db.ts carries the rows. Verified per printing.
//   painted     `textured-full-art` resolves to the BW-era relief
//               (`/foil/surface/etched-deep.png`). The registry row is
//               `implemented`, and its `texture` is that normal map because that
//               is the only asset this paper has.
//   modelled    the relief itself is a drawing. No scan or angled photograph of a
//               textured card exists in this repository, so the ridge spacing,
//               depth and strength are this build's, and `verified` is false.

import fs from 'node:fs'
import { printingFor } from '../src/foil/printing-db'
import { foilMaskFor } from '../src/foil/mask'
import { PATTERNS } from '../src/foil/patterns'
import { PROMO_BUCKET_CLAIMS } from '../src/foil/promo-buckets-db'
import {
  SURFACE_TEXTURES,
  TEXTURED_SURFACE_VERIFIED,
  surfaceFor,
} from '../src/foil/surface-textures'

const TEXTURED = PROMO_BUCKET_CLAIMS.filter((c) => c.treatment === 'textured')

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
  surface: string | null
  source: string
  evidence: string
}[] = []

for (const claim of TEXTURED) {
  const printing = printingFor({ cardId: claim.cardId, rarity: 'Promo' })
  if (!printing) {
    problems.push(`${claim.cardId}: no printing resolved`)
    continue
  }
  if (printing.pattern !== 'textured-full-art') {
    problems.push(`${claim.cardId}: resolved to ${printing.pattern}, expected textured-full-art`)
    continue
  }
  const spec = foilMaskFor({ cardId: claim.cardId, rarity: 'Promo' })
  if (!spec) {
    problems.push(`${claim.cardId}: no foil mask`)
    continue
  }
  // A textured paper is not a reverse and not a non-holo: a marketplace flag must
  // not invent a second printing, exactly as for the other bucket papers.
  if (printingFor({ cardId: claim.cardId, rarity: 'Promo', variant: 'reverseHolofoil' })) {
    problems.push(`${claim.cardId}: invented a reverse printing`)
  }
  const surface = surfaceFor({ cardId: claim.cardId, rarity: 'Promo' })
  if (!surface) problems.push(`${claim.cardId}: resolved no relief, so it would render flat`)
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
    surface,
    source: printing.source,
    evidence: printing.note,
  })
}

if (cards.length !== TEXTURED.length) {
  problems.push(`${TEXTURED.length - cards.length} of ${TEXTURED.length} textured cards did not resolve cleanly`)
}

if (PATTERNS['textured-full-art'].implemented !== true) {
  problems.push('the registry does not report the textured paper as painted')
}
if (PATTERNS['textured-full-art'].texture !== SURFACE_TEXTURES['etched-deep'].texture) {
  problems.push('the registry points at a different relief than the surface table')
}
if (!fs.existsSync('public' + (PATTERNS['textured-full-art'].texture ?? ''))) {
  problems.push('the relief the registry points at is not shipped')
}
if (SURFACE_TEXTURES['etched-deep'].verified || TEXTURED_SURFACE_VERIFIED) {
  problems.push('the relief claims to be verified; no scan exists here')
}

// The photograph measurement is a separate report because it needs images that are
// not committed: `tmp/measure-textured.ts` writes it. Absent, this report says so
// rather than implying a card was checked.
type PhotoReport = {
  cardsPhotographed: string[]
  cardsWithoutAPhotograph: string[]
  verdict: {
    embossSettled: boolean
    statement: string
    settles: string
    doesNotSettle: string
    diagonalFront: number
    diagonalBack: number
  }
  photographs: { label: string; url: string }[]
}
let photos: PhotoReport | null = null
if (fs.existsSync('reports/textured-photos.json')) {
  try {
    photos = JSON.parse(fs.readFileSync('reports/textured-photos.json', 'utf8')) as PhotoReport
  } catch {
    problems.push('reports/textured-photos.json exists but could not be parsed')
  }
}

const counts = {
  claimed: TEXTURED.length,
  painted: cards.filter((c) => c.surface).length,
  relief: SURFACE_TEXTURES['etched-deep'].id,
  markSheets: 0,
  maskVerified: cards.filter((c) => c.maskVerified).length,
  reliefVerified: TEXTURED_SURFACE_VERIFIED,
  modelled: SURFACE_TEXTURES['etched-deep'].modelled,
  photographsFound: photos?.cardsPhotographed.length ?? 0,
  embossSettledByPhotograph: photos?.verdict.embossSettled ?? false,
}

const cardTable = cards
  .map(
    (c) =>
      `| ${c.number} | ${c.name} | ${c.pattern} | ${c.mask} (${c.maskKind}) | ${c.surface ?? '—'} | ${c.status} |`,
  )
  .join('\n')

const md = `# Textured printings

Generated by \`scripts/textured-report.ts\`.

**${TEXTURED.length} BW Black Star Promos are catalogued as Textured, and a textured paper is embossed, not marked.** The rows are BW43 Landorus, BW73 Darkrai and BW74 Giratina. Pokumon's treatment taxonomy files all three as Textured, and \`promo-buckets-db.ts\` carries them from that catalogue into the printing database.

## Counts

| | |
| --- | --- |
| BW promos claimed as textured | ${counts.claimed} |
| Painted (relief) | ${counts.painted} |
| Mark sheets used | ${counts.markSheets} |
| Relief | \`${counts.relief}\` (${SURFACE_TEXTURES['etched-deep'].texture}) |
| Foil area verified | ${counts.maskVerified ? 'yes' : 'no — the database uses the full-art field and says so'} |
| Relief verified against a card | ${counts.reliefVerified ? 'yes' : 'no — the relief is a drawing'} |
| Relief modelled | ${counts.modelled ? 'yes' : 'no'} |
| Cards with a real photograph | ${counts.photographsFound} of ${counts.claimed} (see \`reports/textured-photos.md\`) |
| Emboss measured from a photograph | ${counts.embossSettledByPhotograph ? 'yes' : 'no — the photographs do not resolve it'} |

## Per card

| No. | Card | Pattern | Mask | Relief | Status |
| --- | --- | --- | --- | --- | --- |
${cardTable}

Every row resolves at the \`explicit\` level with \`pattern: textured-full-art\`.

## What is painted, and what that claim is

A textured card prints no dots, stars, lines or symbols. Its structure is relief:
the surface is embossed, so a ridge catches the light on one side and drops into
shadow on the other as the card tilts. That means this printing has **no mark
field** — the pattern layer runs as plain foil light — and its texture is a
**normal map**, which is why \`patterns.ts\` points this row's \`texture\` at
\`/foil/surface/etched-deep.png\` rather than at a mark sheet.

\`${SURFACE_TEXTURES['etched-deep'].note}\`

The relief is MODELLED. ${SURFACE_TEXTURES['etched-deep'].source ? `Source for the era description: ${SURFACE_TEXTURES['etched-deep'].source}.` : ''} No scan or angled photograph is committed
to this repository — the oblique Japanese listings that do show the weave are
fetched by \`tmp/fetch-jp-photos.mjs\`, not stored — so the ridge spacing, depth and
strength are this build's drawings and \`verified\` is false throughout.

Two rules keep the relief honest. It fades in with tilt — the engine multiplies it
by \`min(1, |deg| / 25)\` — so a frame at rest is the scan byte for byte, which is
what makes the surface safe on a card whose artwork must never be touched. And it
shades with ONE delta applied equally to R, G and B, clamped against the pixel's
own headroom, so an emboss never shifts hue and never leaves its foil mask.

## How the relief is chosen

\`surfaceFor()\` takes two answers. A tier the sources call textured — illustration
rare and above — answers by rarity, as it always has. A paper the printing database
identifies as \`textured-full-art\` answers by PRINTING, which is the only route that
can reach a promo row: these three cards carry the rarity label \`Promo\`, so a
rarity rule leaves them flat. Both paths pick the era's relief from the set id:
\`bwp\` is Black & White, so these cards get the deep relief that the deep-etch
description belongs to.

A reverse is never routed this way: the ball and Energy papers carry their own
full-card etch, and a marketplace reverse flag must not invent one.

## Photographs: what they settle, and what they do not

${photos ? `**${photos.verdict.embossSettled ? 'The photographs resolve the emboss.' : 'The photographs do not resolve the emboss.'}** ${photos.verdict.statement}

Settled: ${photos.verdict.settles}

Not settled: ${photos.verdict.doesNotSettle}

Photographed: ${photos.cardsPhotographed.join(', ') || 'none'}. No photograph found: ${photos.cardsWithoutAPhotograph.join(', ') || 'none'}. The measurement, its control (the back of the same slab) and its numbers are in \`reports/textured-photos.md\`.\n\nSources: ${photos.photographs.map((p) => p.label).join('; ')}.` : 'No photograph measurement is recorded in this checkout: run `tmp/fetch-textured-photos.mjs` then `tmp/measure-textured.ts`. Until then this build has only the catalogue scans, which are lit diffusely and cannot show an emboss.'}

## The foil area is the full-art field

The scans and the BW73 photographs show all three are **full-art** printings: the
illustration runs under the text wash to the frame on BW43 "This textured, Full
Art card" (Bleeding Cool), BW73 and BW74 (the Team Plasma Box full art promos).
\`printing-db.ts\` therefore gives these rows \`mask: 'full-art'\` rather than the
standard illustration window, which would have confined the relief to a 37.5%-tall
band of a face that is entirely art. \`maskVerified\` stays false: no source states
which cells of that face carry the emboss.

One catalogue disagrees about WHICH cards. Collexy's Black & White era overview
counts **two** BW promo masters on Textured Holofoil, while Pokumon files three and
Bleeding Cool describes BW43 as textured by name. The three-row claim follows the
two sources that name the card; the disagreement is recorded rather than averaged
away.

## Validation

\`tmp/check-textured.ts\` proves: all three claims resolve to \`textured-full-art\` at
\`explicit\` and invent no reverse printing; \`surfaceFor\` gives each of them the deep
relief and still refuses a reverse; the registry's \`texture\` names the shipped
normal map; the relief is deterministic, non-flat, and deeper than the fine one; a
card at rest is the scan byte for byte; at tilt the relief changes only pixels
inside the foil mask, writes one equal delta to R, G and B, leaves alpha alone, and
redistributes light rather than brightening the card.

It does **not** claim the relief matches a real card. The photographs are measured
separately in \`reports/textured-photos.md\`, and they leave the ridge pitch, depth and
direction unresolved: the oblique Japanese listings show the weave plainly, but the
same estimator reads a comparable period on a smooth control card, so attributing
that number to the emboss would be a choice dressed as a measurement. That is why
\`verified\` stays false.
`

const report = {
  generated: 'scripts/textured-report.ts',
  phase: 'Phase 24 — Textured printings',
  claims: {
    identified:
      'Pokumon treatment catalogue: three BW Black Star Promos are Textured (BW43, BW73, BW74).',
    painted:
      'the paper is embossed, so it ships a normal map and no mark sheet; the registry points at /foil/surface/etched-deep.png',
    modelled: SURFACE_TEXTURES['etched-deep'].note,
    disclosure: 'no scan or angled photograph exists in this repo; verified is false',
  },
  relief: SURFACE_TEXTURES['etched-deep'],
  registry: PATTERNS['textured-full-art'],
  photographs: photos,
  counts,
  cards,
  problems,
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/textured-printings.json', JSON.stringify(report, null, 2) + '\n')
fs.writeFileSync('reports/textured-printings.md', md)

console.log(`Textured: ${counts.claimed} BW promos, painted ${counts.painted} as ${counts.relief} relief`)
console.log(`  mask verified ${counts.maskVerified}; relief verified ${counts.reliefVerified ? 'yes' : 'no'}`)
console.log(`  problems: ${problems.length}`)
for (const p of problems) console.log(`  - ${p}`)
if (problems.length) process.exit(1)
