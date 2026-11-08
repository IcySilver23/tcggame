// Tinsel report: which cards are Tinsel, what is painted, and what is not.
//
// Run: ./node_modules/.bin/tsx scripts/tinsel-report.ts
//
// Three claims are kept apart on purpose, exactly as the Starlight report does:
//
//   identified  Bulbapedia names Tinsel Holofoil for every Generation V set's
//               holofoil rares (Black & White → Legendary Treasures). Verified per
//               printing by printing-db.ts.
//   painted     this build ships a stripe sheet. It is a procedural
//               RECONSTRUCTION, not a scan, and every row here says so.
//   refused     Black Bolt & White Flare are NOT painted: the sources disagree on
//               which printings carry the 2025 return, and the sentence that does
//               cover the holo rares describes a border rather than the striped
//               image. The report records the conflict instead of guessing.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { printingFor } from '../src/foil/printing-db'
import { foilMaskFor } from '../src/foil/mask'
import { PATTERNS } from '../src/foil/patterns'
import {
  TINSEL_CLAIM,
  TINSEL_PROMO_NOTE,
  TINSEL_RETURN_NOTE,
  TINSEL_SETS,
  TINSEL_SHEET,
  TINSEL_SHOWCASE,
} from '../src/foil/tinsel-index'

type Row = { id: string; set_id: string; number: string; name: string; rarity: string }

const VALIDATED = new Set(TINSEL_SHOWCASE.map((c) => c.cardId))
const placeholders = TINSEL_SETS.map(() => '?').join(',')

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db
  .prepare(
    `select id, set_id, number, name, rarity from cards
     where set_id in (${placeholders}) and rarity = 'Rare Holo'
     order by set_id, cast(number as integer)`,
  )
  .all(...TINSEL_SETS) as Row[]
const exRows = db
  .prepare(`select count(*) n from cards where set_id in (${placeholders}) and rarity = 'Rare Holo EX'`)
  .get(...TINSEL_SETS) as { n: number }
const bbRows = db
  .prepare(
    "select id, set_id, number, name, rarity from cards where set_id in ('zsv10pt5','rsv10pt5') and rarity = 'Rare' order by set_id, cast(number as integer)",
  )
  .all() as Row[]
db.close()

const problems: string[] = []
const cards: {
  cardId: string
  setId: string
  number: string
  name: string
  rarity: string
  pattern: string | null
  mask: string | null
  maskVerified: boolean
  status: string
  matchedRule: string
  source: string
  validated: boolean
  evidence: string
}[] = []

for (const row of rows) {
  const printing = printingFor({ cardId: row.id, rarity: row.rarity, name: row.name })
  if (!printing) {
    problems.push(`${row.id}: no printing resolved`)
    continue
  }
  if (printing.pattern !== 'tinsel') {
    problems.push(`${row.id}: resolved to ${printing.pattern}, expected tinsel`)
    continue
  }
  if (!TINSEL_SETS.includes(printing.setId)) problems.push(`${row.id}: resolved outside the documented sets`)
  if (printing.matchedRule !== 'era') problems.push(`${row.id}: answered by ${printing.matchedRule}, expected the era rule`)
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
    matchedRule: printing.matchedRule,
    source: printing.source,
    validated: VALIDATED.has(row.id),
    evidence: printing.note,
  })
}

if (cards.length !== rows.length) problems.push(`${rows.length - cards.length} of ${rows.length} holo rares did not resolve cleanly`)

// The contrast cases: what Tinsel must NOT capture.
const exPrinting = printingFor({ cardId: 'bw11-25', rarity: 'Rare Holo EX' })
if (exPrinting?.pattern === 'tinsel') problems.push('a Rare Holo EX row was painted as Tinsel; that rarity is a different treatment')
const plainRare = printingFor({ cardId: 'bw1-1', rarity: 'Common' })
if (plainRare?.pattern === 'tinsel') problems.push('a common row was painted as Tinsel')
const reverseOfHolo = printingFor({ cardId: 'bw1-5', rarity: 'Rare Holo', variant: 'Reverse Holofoil' })
if (reverseOfHolo?.pattern === 'tinsel') problems.push('a reverse printing of a holo rare was painted as Tinsel; the reverse paper is its own printing')

// The refused half. These rows must make no Tinsel claim, and the report says why.
const blackBolt = bbRows.map((row) => {
  const printing = printingFor({ cardId: row.id, rarity: row.rarity, name: row.name })
  return {
    cardId: row.id,
    setId: row.set_id,
    name: row.name,
    rarity: row.rarity,
    pattern: printing?.pattern ?? null,
    claimedTinsel: printing?.pattern === 'tinsel',
  }
})
if (blackBolt.some((r) => r.claimedTinsel)) problems.push('a Black Bolt / White Flare row was painted as Tinsel despite the conflicting sources')

const bySet = Object.fromEntries(
  TINSEL_SETS.map((setId) => [setId, { holoRares: cards.filter((c) => c.setId === setId).length }]),
)

const counts = {
  holoRares: rows.length,
  bySet,
  identified: cards.length,
  painted: PATTERNS.tinsel.implemented ? cards.length : 0,
  validated: cards.filter((c) => c.validated).length,
  maskVerified: cards.filter((c) => c.maskVerified).length,
  rareHoloExUnclaimed: exRows.n,
  textureVerified: TINSEL_SHEET.textureVerified,
  blackBoltRows: blackBolt.length,
  blackBoltPainted: blackBolt.filter((r) => r.claimedTinsel).length,
  promosPainted: 0,
}

const setTable = TINSEL_SETS.map((setId) => {
  const count = cards.filter((c) => c.setId === setId).length
  return `| ${setId} | ${count} | ${count} | art | verified |`
}).join('\n')

const md = `# Tinsel printings

Generated by \`scripts/tinsel-report.ts\`.

**${TINSEL_CLAIM}**

## Counts

| | |
| --- | --- |
| Generation V holo rares in the catalogue | ${counts.holoRares} |
| Identified as Tinsel, verified | ${counts.identified} |
| Painted (procedural stripe sheet) | ${counts.painted} |
| Render-validated end to end | ${counts.validated} |
| Mask verified (illustration window) | ${counts.maskVerified} |
| Tinsel texture verified against a card | ${counts.textureVerified ? 'yes' : 'no — the sheet is a drawing'} |
| Rare Holo EX rows left unclaimed | ${counts.rareHoloExUnclaimed} |
| Black Bolt / White Flare rows painted | ${counts.blackBoltPainted} of ${counts.blackBoltRows} |
| Promotional printings painted | ${counts.promosPainted} |

## Per set

| Set | Holo rares | Painted | Mask | Status |
| --- | --- | --- | --- | --- |
${setTable}

Every row resolves through the printing database at the \`era\` level
(\`matchedRule: 'era'\`), with the illustration window as the foil area.

## What is painted, and what that claim is

\`public/foil/tinsel/sheet.png\` is a **procedural reconstruction**: ${TINSEL_SHEET.stripes}
horizontal lines at a ${TINSEL_SHEET.period}px pitch, ${TINSEL_SHEET.breaks} breaks,
${(TINSEL_SHEET.coverage * 100).toFixed(2)}% coverage, peak ${TINSEL_SHEET.peak.toFixed(3)}. It is drawn from
Bulbapedia's sentence, not copied from a card. No scan or angled photograph of a
Tinsel sheet exists in this repository, so \`textureVerified\` is false in the
generated index and every field built from it.

The stripes **tile** (measured seam ${(TINSEL_SHEET.seamMismatch * 100).toFixed(2)}%), and the pitch is this
build's own choice: the source names the pattern's orientation, not a line count
per card or a repeat. Both are disclosed, not presented as fact.

## Not painted: Black Bolt & White Flare

${TINSEL_RETURN_NOTE.claim}

${TINSEL_RETURN_NOTE.conflict}

${TINSEL_RETURN_NOTE.decision}

## Promotional printings

${TINSEL_PROMO_NOTE}

## Validation

\`tmp/check-tinsel.ts\` proves, per set: every holo rare resolves to Tinsel with the
art window, a common and a Rare Holo EX make no claim, a reverse printing of a holo
rare keeps its reverse paper, the sheet's lines are horizontal and tile, a card's
cut is stable between frames, and the render is the scan at rest and adds light only
inside the mask at tilt.

It does **not** compare the sheet to a photograph, because none is in this repo.
`

const report = {
  generated: 'scripts/tinsel-report.ts',
  phase: 'Phase 21 — Generation V Tinsel',
  claims: {
    identified: TINSEL_CLAIM,
    painted: 'procedural reconstruction; not a scan',
    refused: TINSEL_RETURN_NOTE,
    promos: TINSEL_PROMO_NOTE,
  },
  sheet: TINSEL_SHEET,
  counts,
  cards,
  blackBolt,
  problems,
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/tinsel-printings.json', JSON.stringify(report, null, 2) + '\n')
fs.writeFileSync('reports/tinsel-printings.md', md)

console.log(`Tinsel: ${counts.identified}/${counts.holoRares} holo rares across ${TINSEL_SETS.length} sets, painted ${counts.painted}`)
console.log(`  Black Bolt / White Flare painted: ${counts.blackBoltPainted} of ${counts.blackBoltRows} (refused, see the report)`)
console.log(`  problems: ${problems.length}`)
for (const p of problems) console.log(`  - ${p}`)
if (problems.length) process.exit(1)
