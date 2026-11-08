// Mirage report: what the paper is, which cards wear it, and what is NOT claimed.
//
// Run: ./node_modules/.bin/tsx scripts/mirage-report.ts
//
// The claims stay apart, as every other paper report does:
//
//   identified  Bulbapedia's Holofoil page: "Mirage Holofoil was introduced with the
//               Scarlet & Violet Series. It is visually similar to the Sheen Holofoil
//               used during the XY Series, but refracts light horizontally rather than
//               diagonally. Standard Holo cards also have Holofoil silver borders."
//               That is a SET-level statement: no printing record in this build claims
//               a Mirage card, so every row here comes from the renderer's era rule.
//   painted     a procedural reconstruction, not a scan: a smooth sweep across three
//               broad vertical bands over foil that never goes dark.
//   not claimed the band count, the contrast, the reading of which AXIS the bands run
//               on, the DIRECTION the band travels, and the silver foil border Bulbapedia
//               documents — this build's mask is the illustration window, so the border
//               renders flat.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { holoFor } from '../src/holo'
import { printingFor } from '../src/foil/printing-db'
import { foilMaskFor } from '../src/foil/mask'
import { PATTERNS } from '../src/foil/patterns'
import { MIRAGE_CLAIM, MIRAGE_LIMITATION, MIRAGE_SHEET } from '../src/foil/mirage-index'
import { MIRAGE_MEASURED } from '../src/foil/mirage-sheet'

const problems: string[] = []

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db
  .prepare('select id, set_id, number, rarity, name from cards order by set_id, cast(number as integer)')
  .all() as { id: string; set_id: string; number: string; rarity: string | null; name: string }[]
db.close()

type Row = {
  cardId: string
  setId: string
  number: string
  name: string
  rarity: string | null
  style: string
  pattern: string | null
  mask: string | null
  maskVerified: boolean | null
}

const cards: Row[] = []
for (const row of rows) {
  const art = holoFor({ cardId: row.id, rarity: row.rarity ?? undefined })
  // A reverse printing of a Scarlet & Violet card carries the set's reverse paper, not
  // Mirage; the standard holo behind it is what this report counts, and a row that
  // resolves a pattern (reverse or a named printing) is therefore not a Mirage row.
  if (art?.style !== 'mirage' || art.pattern) continue
  const printing = printingFor({ cardId: row.id, rarity: row.rarity ?? undefined, name: row.name })
  const spec = foilMaskFor({ cardId: row.id, rarity: row.rarity ?? undefined })
  cards.push({
    cardId: row.id,
    setId: row.set_id,
    number: row.number,
    name: row.name,
    rarity: row.rarity,
    style: art.style,
    pattern: printing?.pattern ?? null,
    mask: spec?.kind ?? null,
    maskVerified: spec?.verified ?? null,
  })
}

if (!cards.length) problems.push('no card resolves to Mirage')
if (cards.some((c) => c.pattern !== null)) problems.push('a Mirage row carries a printing pattern; the report expects era-level rows only')

const setIds = [...new Set(cards.map((c) => c.setId))].sort()
const perSet = setIds.map((setId) => ({ setId, cards: cards.filter((c) => c.setId === setId) }))
const isScarlet = (s: string) => s.startsWith('sv')
const isMega = (s: string) => /^me\d/.test(s)

if (!setIds.some(isScarlet)) problems.push('no Scarlet & Violet set resolves to Mirage')
if (setIds.some((s) => /^(swsh|sm|pgo)/.test(s))) problems.push('an earlier era is being painted with Mirage')

if (PATTERNS.mirage.implemented !== true) problems.push('the registry does not report Mirage as painted')
if (PATTERNS.mirage.texture !== MIRAGE_SHEET.pattern) problems.push('the registry points at a different sheet than the generated index')
if (!fs.existsSync('public' + MIRAGE_SHEET.pattern)) problems.push('the sheet the registry points at is not shipped')

const counts = {
  claimed: cards.length,
  painted: PATTERNS.mirage.implemented ? cards.length : 0,
  sets: setIds.length,
  scarletSets: perSet.filter((s) => isScarlet(s.setId)).length,
  megaSets: perSet.filter((s) => isMega(s.setId)).length,
  scarletCards: cards.filter((c) => isScarlet(c.setId)).length,
  megaCards: cards.filter((c) => isMega(c.setId)).length,
  maskVerified: cards.filter((c) => c.maskVerified).length,
  textureVerified: MIRAGE_SHEET.textureVerified,
  borderModelled: MIRAGE_SHEET.borderModelled,
  coverage: MIRAGE_SHEET.coverage,
  floor: MIRAGE_SHEET.floor,
  peak: MIRAGE_SHEET.peak,
  contrast: MIRAGE_SHEET.peak / MIRAGE_SHEET.floor,
  seamMismatch: MIRAGE_SHEET.seamMismatch,
  waves: MIRAGE_SHEET.waves,
  drawnPeriod: 1 / (MIRAGE_SHEET.waves * (734 / 1024) * 1.015),
  measuredPeriod: MIRAGE_MEASURED.period,
  measuredContrast: MIRAGE_MEASURED.contrast,
  measuredVertical: MIRAGE_MEASURED.vertical,
  directionClaim: MIRAGE_MEASURED.direction.claim,
  directionNote: MIRAGE_MEASURED.direction.note,
}

const md = `# Mirage printings

Generated by \`scripts/mirage-report.ts\`.

**${MIRAGE_CLAIM}**

## Counts

| | |
| --- | --- |
| Cards the catalogue resolves to Mirage | ${counts.claimed} |
| Painted (procedural sheen) | ${counts.painted} |
| Sets | ${counts.sets} |
| Scarlet & Violet sets | ${counts.scarletSets} (${counts.scarletCards} cards) |
| Mega Evolution sets | ${counts.megaSets} (${counts.megaCards} cards) |
| Rows answered by a printing record | 0 — the paper is identified per SET |
| Foil area verified | ${counts.maskVerified} of ${counts.claimed} |
| Texture verified against a card | ${counts.textureVerified ? 'yes' : 'no — the sheet is a drawing'} |
| Silver foil border modelled | ${counts.borderModelled ? 'yes' : 'no'} |
| Bands | ${counts.waves} across the sheet |
| Band spacing | ${counts.drawnPeriod.toFixed(3)} card widths drawn, ${counts.measuredPeriod.toFixed(3)} measured |
| A single frame confirms the spacing | no — one broad band fits 0.656 and the drawn 0.687 alike (see below) |
| Coverage above the mark line | ${(counts.coverage * 100).toFixed(2)}% |
| Floor / peak | ${counts.floor.toFixed(3)} / ${counts.peak.toFixed(3)} |
| Floor-to-peak contrast | ${counts.contrast.toFixed(2)}× |
| Wrap step when the sheet meets itself | ${(counts.seamMismatch * 100).toFixed(2)}% |
| Direction of travel | not established — the clips rock the card (see below) |

## Per set

| Set | Cards | First examples |
| --- | --- | --- |
${perSet
  .map((s) => `| ${s.setId} | ${s.cards.length} | ${s.cards.slice(0, 4).map((c) => c.name).join(', ')}${s.cards.length > 4 ? ', …' : ''} |`)
  .join('\n')}

## What is painted, and what that claim is

\`public/foil/mirage/sheet.png\` is a **procedural reconstruction**: ${counts.waves} broad bands across
the sheet, each a smooth cosine with a slow secondary bend in it, over foil whose dimmest point is
${counts.floor.toFixed(3)} — a sheen has no bare field, so it never goes dark the way a marked paper's
background does. The field depends only on x, so a band runs vertically down the card. Which way
that band travels as the card tilts is **not claimed**: the clips are rocks, not sweeps (below).

The spacing is not guessed. It was measured against the only real Mirage footage in reach — the
tilt-run clips of the Scarlet & Violet promos — and the drawing was retuned when the measurement
disagreed with it (see below). What stays this build's is the reading that "refracts light
horizontally" means the field varies with **x** (bands vertical) rather than with y, and the
secondary bend: Bulbapedia names the direction the light travels, not the geometry.

## Measured against the real cards

\`tmp/measure-mirage-ratio.py\` divides two frames of the same card, so the artwork cancels and the
sheen is left alone — the only way to separate a reflection from the print beneath it. It runs on
a synthetic tilt of this build's own sheet first, and only trusts itself when that control answers
correctly: it recovers the drawn period to 0% and the contrast to 7%, and reads the band as a
column (row correlation 1.00).

| Clip | Band period (card widths) | Contrast | Row correlation |
| --- | --- | --- | --- |
${MIRAGE_MEASURED.clips.map((c) => `| ${c.card} | ${c.period.toFixed(3)} | ${c.contrast.toFixed(2)}× | ${c.vertical.toFixed(2)} |`).join('\n')}
| **This build's sheet** | **${counts.drawnPeriod.toFixed(3)}** | **${(counts.peak / counts.floor).toFixed(2)}×** | **1.00 by construction** |

Two findings. The first drawing put three bands across the sheet — 0.46 card widths — and the
clips say 0.656, so it was **30% too tight**; the retune to two bands draws 0.69, within 5% of the
median. The contrast needed no change: the clips read 1.60–1.66×, and because the same pipeline
under-reads our own 1.73× sheet by 7%, that is the drawn contrast, not a lighter one. The row
correlation of 0.63–0.77 sits below the control's 1.00 because a hand-held card moves and the
GIFs are 280–310px wide: it supports bands that are columns rather than diagonals, and it is not
strong enough to claim more than that.

### Can a single frame confirm the spacing?

**No, and the report says so rather than implying otherwise.** A ratio between two tilts asks the
reflection; a single frame asks the whole picture, print and light together. \`tmp/measure-mirage-single.py\`
does the latter, and two instruments were thrown out before one answered honestly: row
autocorrelation wants several periods and at ~1.1 across the face locked onto the window edge
(0.844 card widths, for the foil control and the artwork-only control alike), and a cubic detrend
has the same single dip as one band, so it fitted the control's own band almost exactly and left a
two-hump residual that read as half a period.

The surviving fit is the ratio lab's, mean-removed and undetrended, applied to every row at once.
It recovers a known period — but only as a **plateau**, and that plateau is the result:

| Frame | Channel | Period (card widths) | Plateau (R² within 0.02 of best) | R² |
| --- | --- | --- | --- | --- |
| Control, the drawn sheet over quiet art | luma | 0.694 | 0.654–0.746 | 0.99 |
| Control, the drawn sheet over card-like art | luma | 0.694 | 0.645–0.758 | 0.71 |
| Control, artwork only | luma | none | — | 0.03 |
| Fuecoco promo still | R−G | 0.730 | 0.645–0.826 | 0.58 |
| Quaxly promo still | luma | 0.699 | 0.625–0.794 | 0.51 |
| Quaxly promo still | B−Y | 0.885 | 0.794–1.010 | 0.67 |
| Sprigatito promo still | R−G | 0.806 | 0.730–0.917 | 0.62 |
| folio.fyi photograph | R−G | 0.621 | 0.552–0.746 | 0.44 |

The controls bracket what the instrument can do: it finds a known band through print, and artwork
alone produces no band. On the stills the plateaus are 0.55–1.0 wide — roughly ±10–15%, where
0.656 and the drawn 0.687 differ by 4.7%. So the stills **confirm one broad band across the face**
and **exclude the rejected three-band drawing (0.46)**, but they cannot separate the ratio's number
from the drawing's: two stills put 0.656 outside their plateau while a two-band reading stays
inside it. Luma is the channel the foil itself modulates; the colour channels also carry the
artwork, which is why the control is run on both.

The conclusion is narrow and worth stating plainly: **0.656 is the spacing of the reflection as a
ratio of two tilts measures it, not an independently confirmed printed repeat.** It stays in
\`MIRAGE_MEASURED\` as what the drawing was retuned against, the drawing stays at two bands because
the footage as a whole puts one band at roughly 0.65–0.70 card widths, and no source or measurement
here supports a finer repeat than that.

## Which way does the band travel?

**Not established.** \`tmp/measure-mirage-direction.py\` asks the question properly: a column profile
in frame coordinates reads the HAND moving the card as the sheen moving, so every frame is first
registered on the card's printed detail (high-passed luma, normalized cross-correlation, ±25px) and
the band's phase is then tracked in card coordinates. Its controls read right for a band drawn
moving right, left for one drawn moving left, and +0.27 per 1000 frames for a STILL band under a
rocking card — that is the instrument's own leak, and the floor below which a reading is silence.

| Clip | Drift (card widths per 1000 frames) | Total | Halves |
| --- | --- | --- | --- |
${MIRAGE_MEASURED.direction.clips.map((c) => `| ${c.card} | ${c.drift.toFixed(2)} | ${c.total.toFixed(2)} | ${c.halves} |`).join('\n')}

Two clips drift left, one drifts right, and Sprigatito's own halves disagree by 8×: these are
rocks, not a one-way sweep. Total motion stays under one card width in every clip. So the source's
sentence is taken as the AXIS the field varies on — bands are columns, which the row correlation
does support — and the direction of travel is left unclaimed. The renderer's reflection band does
move with the pointer for every paper; that is a property of the engine, not evidence about this one.

It **wraps**: every value depends on x mod the sheet size, so a card may sample any window and the
sweep continues past the card edge instead of stopping at it. Whether the real paper repeated is
undocumented, so the wrap is this build's disclosed choice.

Copy variation is a **crop**, not a re-seed: each card id derives its own offset and a slight zoom,
while the sheet's band phase is fixed — the pattern must not move between frames. A save does not
distinguish physical copies, so two copies of one card id share a cut.

## What the identification covers, and what it does not

${MIRAGE_LIMITATION}

Two consequences follow. Every row here is an **era-level** identification: \`holo.ts\` maps the set
prefix to Mirage for standard holos, and no printing record claims one, so the count is how many
cards change — it is not a per-card verification. And the foil AREA is this era's ordinary
illustration window, verified as a mask (${counts.maskVerified} of ${counts.claimed} rows) but not as a per-card
statement about this paper: the source describes the pattern, a direction and a border, not which
cells of the face carry the foil, and the documented silver border is not modelled at all.

## Validation

\`tmp/check-mirage.ts\` proves: the sheet's field is constant down a column and swings its full
range across a row, stays above its floor, wraps, renders deterministically and carries no colour;
the shipped PNG and the index agree; the sampler cuts one stable window per card, different windows
per card, and a card point's ink does not change down the card; the direction of travel is recorded
as unestablished and no meta, index or report field claims a left-to-right sweep; Scarlet & Violet resolves to Mirage
while Sword & Shield resolves to Line and Sun & Moon to Water Web, and a reverse printing keeps its
own paper; the registry reports it painted and points at the shipped file; and a render at rest is
the scan byte for byte while a tilted one adds light only inside the mask.

It does **not** compare the sheet to a photograph, because none is in this repo — and Bulbapedia
itself warns the effect "can be difficult to see clearly in photographs".
`

const report = {
  generated: 'scripts/mirage-report.ts',
  phase: 'Mirage painted',
  claims: {
    identified: MIRAGE_CLAIM,
    limitation: MIRAGE_LIMITATION,
    painted: 'procedural reconstruction; not a scan',
    border: 'documented in the source, deliberately not modelled',
  },
  sheet: MIRAGE_SHEET,
  counts,
  sets: perSet.map((s) => ({ setId: s.setId, cards: s.cards.length })),
  cards,
  problems,
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/mirage-printings.json', JSON.stringify(report, null, 2) + '\n')
fs.writeFileSync('reports/mirage-printings.md', md)

console.log(`Mirage: ${counts.claimed} cards across ${counts.sets} sets (${counts.scarletCards} SV + ${counts.megaCards} ME), painted ${counts.painted}`)
console.log(`  ${counts.waves} bands, coverage ${(counts.coverage * 100).toFixed(2)}%, floor/peak ${counts.floor.toFixed(3)}/${counts.peak.toFixed(3)}, seam ${(counts.seamMismatch * 100).toFixed(2)}%`)
console.log(`  problems: ${problems.length}`)
for (const p of problems) console.log(`  - ${p}`)
if (problems.length) process.exit(1)
