// Confetti report: what the paper is, which cards wear it, and what stays unclaimed.
//
// Run: ./node_modules/.bin/tsx scripts/confetti-report.ts
//
// The claims stay apart, as every other paper report does:
//
//   identified  Bulbapedia names Pixel / Confetti Holofoil for the McDonald's
//               Collections and the Celebrations Classic Collection, and describes it
//               as "small, blocky reflective shapes scattered across the image".
//               The 2026 30th Celebration Classic Collection is resolved from
//               Bulbapedia's Classic Collection sentence (printing-db.ts).
//   painted     this build ships a drawn flake sheet. It is a procedural
//               RECONSTRUCTION, not a scan, and every row here says so.
//   not claimed the "textured" half of the name. No source measures the emboss or the
//               repeat, so no relief is modelled and the sheet's density is this
//               build's choice.
//   limitation  McDonald's cards exist as both Non Holofoil and Confetti Holofoil
//               printings and the catalogue holds one row per card, so every
//               McDonald's row paints the foil.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { printingFor } from '../src/foil/printing-db'
import { holoFor } from '../src/holo'
import { PATTERNS } from '../src/foil/patterns'
import { CONFETTI_CLAIM, CONFETTI_EXCEPTIONS, CONFETTI_MCD_CAVEAT, CONFETTI_SHEET } from '../src/foil/confetti-index'

const problems: string[] = []
const exceptionIds = new Set(CONFETTI_EXCEPTIONS.map((e) => e.cardId))

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db
  .prepare(
    `select id, set_id, number, name, rarity from cards
     where set_id in ('me55c', 'cel25c') or set_id like 'mcd%'
     order by set_id, cast(number as integer)`,
  )
  .all() as { id: string; set_id: string; number: string; name: string; rarity: string | null }[]
db.close()

const cards = rows.map((row) => {
  const art = holoFor({ cardId: row.id, rarity: row.rarity })
  const printing = printingFor({ cardId: row.id, rarity: row.rarity, name: row.name })
  const resolves = art?.pattern === 'confetti' || art?.style === 'confetti'
  const excepted = exceptionIds.has(row.id)
  // An exception keeps its own sourced claim; every other row must resolve here.
  if (excepted && resolves) problems.push(`${row.id}: is listed as an exception but resolves to confetti anyway`)
  if (!excepted && !resolves) problems.push(`${row.id}: does not resolve to confetti (${art?.style ?? 'no foil'})`)
  // The two Classic Collections are sourced claims; a McDonald's row is the style rule.
  const source = printing?.pattern === 'confetti' ? 'printing database' : row.set_id.startsWith('mcd') ? 'McDonald\'s style rule' : 'style rule'
  return {
    cardId: row.id,
    setId: row.set_id,
    number: row.number,
    name: row.name,
    rarity: row.rarity,
    style: art?.style ?? null,
    pattern: art?.pattern ?? printing?.pattern ?? null,
    status: printing?.status ?? null,
    matchedRule: printing?.matchedRule ?? null,
    mask: printing?.mask ?? null,
    maskVerified: printing?.maskVerified ?? null,
    source,
    exception: excepted,
  }
})

const setIds = [...new Set(cards.map((c) => c.setId))].sort()
for (const required of ['me55c', 'cel25c']) {
  if (!setIds.includes(required)) problems.push(`no rows resolved for ${required}`)
}
for (const card of cards.filter((c) => c.setId === 'me55c')) {
  if (card.pattern !== 'confetti') problems.push(`${card.cardId}: the 30th Classic Collection is not on the confetti printing`)
}
if (PATTERNS.confetti.implemented !== true) problems.push('the registry does not report confetti as painted')
if (PATTERNS.confetti.texture !== CONFETTI_SHEET.pattern) problems.push('the registry points at a different sheet than the generated index')
if (!fs.existsSync('public' + CONFETTI_SHEET.pattern)) problems.push('the sheet the registry points at is not shipped')

const counts = {
  claimed: cards.length,
  painted: PATTERNS.confetti.implemented ? cards.length - exceptionIds.size : 0,
  exceptions: exceptionIds.size,
  classicCollection2026: cards.filter((c) => c.setId === 'me55c').length,
  classicCollection2021: cards.filter((c) => c.setId === 'cel25c').length,
  mcdonalds: cards.filter((c) => c.setId.startsWith('mcd')).length,
  sourcedPrintings: cards.filter((c) => c.source === 'printing database').length,
  styleRuleRows: cards.filter((c) => c.source !== 'printing database').length,
  textureVerified: CONFETTI_SHEET.textureVerified,
  coverage: CONFETTI_SHEET.coverage,
  floor: CONFETTI_SHEET.floor,
  contrast: CONFETTI_SHEET.peak / CONFETTI_SHEET.floor,
  seamMismatch: CONFETTI_SHEET.seamMismatch,
  reliefClaimed: false,
}

const perSet = setIds
  .map((setId) => {
    const own = cards.filter((c) => c.setId === setId)
    return `| ${setId} | ${own.length} | ${own[0]?.source ?? ''} | ${own.map((c) => c.name).slice(0, 6).join(', ')}${own.length > 6 ? ', …' : ''} |`
  })
  .join('\n')

const cardTable = cards
  .map((c) => `| ${c.setId} | ${c.number} | ${c.name} | ${c.rarity ?? '—'} | ${c.pattern ?? c.style ?? '—'} | ${c.mask ?? '—'} |`)
  .join('\n')

const md = `# Pixel / Confetti printings

Generated by \`scripts/confetti-report.ts\`.

**${CONFETTI_CLAIM}**

## Counts

| | |
| --- | --- |
| Cards the catalogue holds on this paper | ${counts.claimed} |
| Painted (procedural flake sheet) | ${counts.painted} |
| 30th Celebration Classic Collection (2026) | ${counts.classicCollection2026} |
| Celebrations Classic Collection (2021) | ${counts.classicCollection2021} |
| McDonald's Collections | ${counts.mcdonalds} |
| Resolved through the printing database | ${counts.sourcedPrintings} |
| Resolved by the McDonald's style rule | ${counts.styleRuleRows} |
| Kept on their own sourced claim (not confetti) | ${counts.exceptions} |
| Texture verified against a card | ${counts.textureVerified ? 'yes' : 'no — the sheet is a drawing'} |
| Coverage above the mark line | ${(counts.coverage * 100).toFixed(2)}% |
| Flake-to-field contrast | ${counts.contrast.toFixed(2)}× |
| Bare-field floor | ${counts.floor.toFixed(3)} |
| Wrap step when the sheet meets itself | ${(counts.seamMismatch * 100).toFixed(2)}% |
| Emboss modelled as relief | no |

## Per set

| Set | Cards | Resolved by | Names |
| --- | --- | --- | --- |
${perSet}

## Per card

| Set | No. | Card | Rarity | Pattern | Mask |
| --- | --- | --- | --- | --- | --- |
${cardTable}

## What is painted, and what that claim is

\`public/foil/confetti/sheet.png\` is a **procedural reconstruction**: axis-aligned flakes
of 9–28px scattered on a ${CONFETTI_SHEET.cell}px cell grid over a dark field
(floor ${CONFETTI_SHEET.floor.toFixed(3)}), because Bulbapedia names the look and the products,
not a count or a repeat. \`textureVerified\` is false in the generated index and every field
built from it.

The field is dark **on purpose**. This is a marked paper, so a bright field would stop the
blocks reading as blocks — the opposite of Mirror, where the floor is what keeps the foil
from going dark.

It **wraps** (measured seam ${(CONFETTI_SHEET.seamMismatch * 100).toFixed(2)}%): blocks that cross an edge
continue on the other side, so a card may sample any window. Whether the real paper
repeated is undetermined; the wrap is this build's disclosed choice.

Copy variation is a **crop**, not a re-seed: each card id derives its own offset and a
slight zoom, and a save does not distinguish physical copies, so two copies of one card id
share a cut.

## The one exception

${CONFETTI_EXCEPTIONS.map((e) => `**${e.cardId}** — ${e.reason}`).join('\n\n')}

## The emboss is not claimed

Bulbapedia calls the Classic Collection paper "textured". This build paints the flakes and
does not model relief: depth would be a second claim, and no source read here measures it.

## The McDonald's limitation

${CONFETTI_MCD_CAVEAT}

## Validation

\`tmp/check-confetti.ts\` proves: the sheet is blocky, dark between flakes, wraps and renders
deterministically; the shipped PNG and the index agree; the sampler cuts one stable window
per card and different windows per card; the 30th Classic Collection, the Celebrations
Classic Collection and the McDonald's rows all resolve to this paper, and a Scarlet &
Violet card does not; the registry reports it painted and points at the shipped file; and a
render at rest is the scan byte for byte while a tilted one adds light only inside the mask.

It does **not** compare the sheet to a photograph, because none is in this repo.
`

const report = {
  generated: 'scripts/confetti-report.ts',
  phase: 'Confetti (Pixel) painted',
  claims: {
    identified: CONFETTI_CLAIM,
    mcdonaldsCaveat: CONFETTI_MCD_CAVEAT,
    painted: 'procedural reconstruction; not a scan',
    relief: 'not claimed: no source measures the emboss',
  },
  sheet: CONFETTI_SHEET,
  counts,
  cards,
  problems,
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/confetti-printings.json', JSON.stringify(report, null, 2) + '\n')
fs.writeFileSync('reports/confetti-printings.md', md)

console.log(`Confetti: ${counts.claimed} rows, painted ${counts.painted} (${counts.exceptions} exception) — ${counts.classicCollection2026} 30C, ${counts.classicCollection2021} Celebrations, ${counts.mcdonalds} McDonald's`)
console.log(`  coverage ${(counts.coverage * 100).toFixed(2)}%, contrast ${counts.contrast.toFixed(1)}x, seam ${(counts.seamMismatch * 100).toFixed(2)}%`)
console.log(`  problems: ${problems.length}`)
for (const p of problems) console.log(`  - ${p}`)
if (problems.length) process.exit(1)
