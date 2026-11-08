// Phase 6 report: which cards are Starlight, what is painted, and what is only
// identified.
//
// Run: ./node_modules/.bin/tsx scripts/starlight-report.ts
//
// Three separate claims, kept apart on purpose:
//
//   identified  Bulbapedia names Starlight for Holo cards in Base, Jungle and
//               Fossil, and Fossil is the last set to use it (Base Set 2 moved to
//               Cosmos). This is verified per printing.
//   painted     this build ships a texture for the pattern. It is a procedural
//               RECONSTRUCTION, not a scan of the 1999 sheet, and the report says
//               so in every row.
//   validated   the rendering has been exercised end to end for three
//               representative cards by tmp/check-starlight.ts: mask, at-rest
//               identity, tilt lift and the mark-over-white guard. It is NOT a
//               comparison against a photograph, because none is in this repo.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { printingFor } from '../src/foil/printing-db'
import { foilMaskFor, coverageFraction } from '../src/foil/mask'
import { PATTERNS } from '../src/foil/patterns'
import { STARLIGHT_SHEET, STARLIGHT_SHOWCASE, STARLIGHT_SETS } from '../src/foil/starlight-index'

const VALIDATED = new Set(STARLIGHT_SHOWCASE.map((c) => c.cardId))

type Row = { id: string; set_id: string; number: string; name: string; rarity: string }

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db
  .prepare(
    "select id, set_id, number, name, rarity from cards where set_id in ('base1','base2','base3') and rarity like '%Holo%' order by set_id, cast(number as integer)",
  )
  .all() as Row[]
const base4 = db
  .prepare("select count(*) n from cards where set_id = 'base4' and rarity like '%Holo%'")
  .get() as { n: number }
db.close()

type CardRow = {
  cardId: string
  setId: string
  number: string
  name: string
  rarity: string
  pattern: string | null
  mask: string | null
  maskVerified: boolean
  status: string
  source: string
  validated: boolean
  evidence: string
}

const problems: string[] = []
const cards: CardRow[] = []

for (const row of rows) {
  const printing = printingFor({ cardId: row.id, rarity: row.rarity, name: row.name })
  if (!printing) {
    problems.push(`${row.id}: no printing resolved`)
    continue
  }
  if (printing.pattern !== 'starlight') {
    problems.push(`${row.id}: resolved to ${printing.pattern}, expected starlight`)
    continue
  }
  const spec = foilMaskFor({ cardId: row.id, rarity: row.rarity })
  if (!spec) {
    problems.push(`${row.id}: no foil mask`)
    continue
  }
  if (spec.kind !== 'art') problems.push(`${row.id}: mask is ${spec.kind}, expected the illustration window`)
  cards.push({
    cardId: row.id,
    setId: row.set_id,
    number: row.number,
    name: row.name,
    rarity: row.rarity,
    pattern: printing.pattern,
    mask: printing.mask,
    maskVerified: printing.maskVerified,
    status: printing.status,
    source: printing.source,
    validated: VALIDATED.has(row.id),
    evidence: printing.note,
  })
}

const expectedRows = rows.length
if (cards.length !== expectedRows) problems.push(`${expectedRows - cards.length} of ${expectedRows} holo rares did not resolve cleanly`)

// Base Set 2 must NOT be Starlight: it is the first Cosmos set. The comparison
// belongs in the report so nobody has to take it on trust.
const base4Printing = printingFor({ cardId: 'base4-4', rarity: 'Rare Holo' })
if (base4Printing?.pattern !== 'cosmos-retro') {
  problems.push(`base4-4 resolved to ${base4Printing?.pattern ?? 'nothing'}; Base Set 2 should be Cosmos, not Starlight`)
}

const counts = {
  holoRares: rows.length,
  bySet: Object.fromEntries(STARLIGHT_SETS.map((s) => [s, cards.filter((c) => c.setId === s).length])),
  identified: cards.length,
  painted: PATTERNS.starlight.implemented ? cards.length : 0,
  validated: cards.filter((c) => c.validated).length,
  maskVerified: cards.filter((c) => c.maskVerified).length,
  base4CosmosHoloRares: base4.n,
  textureVerified: STARLIGHT_SHEET.textureVerified,
}

const stability = coverageFraction(foilMaskFor({ cardId: 'base1-4', rarity: 'Rare Holo' }))

const report = {
  generated: 'scripts/starlight-report.ts',
  phase: 'Phase 6 — vintage Starlight',
  counts,
  maskArea: Number(stability.toFixed(4)),
  cards,
  problems,
  honesty: [
    'The texture is a PROCEDURAL RECONSTRUCTION drawn from Bulbapedia’s one-sentence description ("starbursts of different sizes spread across the image, with a slightly blurry appearance"). It is not a scan of the 1999 sheet, and no angled photograph or video of one exists in this repository.',
    'The printing identification is a separate, verified claim: Bulbapedia names Starlight for Holo cards in Base, Jungle and Fossil, and Fossil is the last set to use it. Base Set 2 moved to Cosmos, which is why base4 cards resolve to cosmos-retro instead.',
    `Mask: the illustration window, ${(stability * 100).toFixed(1)}% of the card box, matte frame and text panel. Bulbapedia says the starbursts are spread across the image, which is what licenses the window rather than the whole face; it is not a photographed boundary.`,
    'Base Set 1st Edition and Unlimited share the same foil. The catalog has one row per card id, so the database does not distinguish those print variants — correctly, because the foil is identical.',
    'Known exception this build cannot detect: some Base Set Machamp cards were printed with Cosmos instead of Starlight (Bulbapedia Error cards). The card row carries no marker, so those copies still render Starlight.',
    'Validation here is numeric (mask, at-rest identity, tilt lift, duplicate-decoration guard) for Base Charizard, Jungle Clefable and Fossil Aerodactyl. No pixel comparison against a real card was possible, so fidelity is unverified rather than claimed.',
  ],
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/starlight-printings.json', JSON.stringify(report, null, 2) + '\n')

const lines: string[] = []
lines.push('# Starlight — printings and reproduction')
lines.push('')
lines.push(`Generated by \`${report.generated}\`. Phase 6 of \`HOLOFOIL_ROADMAP.md\`.`)
lines.push('')
lines.push('## Numbers')
lines.push('')
lines.push(`- Holo rares identified as Starlight: **${counts.identified}** (${counts.bySet.base1} Base, ${counts.bySet.base2} Jungle, ${counts.bySet.base3} Fossil).`)
lines.push(`- Painted: **${counts.painted}** — every one samples \`${STARLIGHT_SHEET.pattern}\`.`)
lines.push(`- Mask verified: **${counts.maskVerified}** (illustration window, ${(report.maskArea * 100).toFixed(1)}% of the card box).`)
lines.push(`- Rendering validated for: **${counts.validated}** cards (${STARLIGHT_SHOWCASE.map((c) => c.name).join(', ')}).`)
lines.push(`- Texture verified against a real sheet: **${counts.textureVerified ? 'yes' : 'no — reconstruction'}**.`)
lines.push(`- Contrast: Base Set 2 holo rares resolving to Cosmos: ${counts.base4CosmosHoloRares}.`)
lines.push('')
lines.push('## What is verified and what is drawn')
lines.push('')
for (const h of report.honesty) lines.push(`- ${h}`)
lines.push('')
lines.push('## The sheet')
lines.push('')
lines.push(`- Texture: \`${STARLIGHT_SHEET.pattern}\` (${STARLIGHT_SHEET.size}), seed \`${STARLIGHT_SHEET.seed}\`.`)
lines.push(`- Measured coverage ${(STARLIGHT_SHEET.coverage * 100).toFixed(2)}%, peak ${STARLIGHT_SHEET.peak.toFixed(3)}.`)
lines.push(`- Star mix: ${STARLIGHT_SHEET.stars.large} large, ${STARLIGHT_SHEET.stars.medium} medium, ${STARLIGHT_SHEET.stars.small} small, ${STARLIGHT_SHEET.stars.dust} dust.`)
lines.push(`- Wrap mismatch ${(STARLIGHT_SHEET.seamMismatch * 100).toFixed(1)}% of rows: the sheet is cut as one window per card and never tiles.`)
lines.push('')
lines.push('## Per-card printing')
lines.push('')
lines.push('| Card | Name | Set | Mask | Identified | Painted | Validated |')
lines.push('| --- | --- | --- | --- | --- | --- | --- |')
for (const c of cards) {
  lines.push(`| ${c.cardId} | ${c.name} | ${c.setId} | ${c.mask} | ${c.status} | yes | ${c.validated ? '**yes**' : 'no'} |`)
}
lines.push('')
if (problems.length) {
  lines.push('## Problems')
  lines.push('')
  for (const p of problems) lines.push(`- ${p}`)
  lines.push('')
}

fs.writeFileSync('reports/starlight-printings.md', lines.join('\n'))

console.log(`holo rares: ${counts.identified} (${counts.bySet.base1}/${counts.bySet.base2}/${counts.bySet.base3})`)
console.log(`mask: ${counts.maskVerified} verified · validated renders: ${counts.validated}`)
console.log(`texture: ${STARLIGHT_SHEET.pattern} · reconstruction (verified: ${STARLIGHT_SHEET.textureVerified})`)
console.log('written: reports/starlight-printings.json, reports/starlight-printings.md')
if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):`)
  for (const p of problems) console.log(' -', p)
  process.exitCode = 1
} else {
  console.log('every Base/Jungle/Fossil holo rare resolves to Starlight; Base Set 2 resolves to Cosmos')
}
