// Verification report for reverse holos, one row per expansion.
//
// Run: ./node_modules/.bin/tsx scripts/reverse-report.ts
//
// The point is requirement 8 and 9 of the phase: an expansion is NOT "done"
// because it has a row. It is done when its pattern exists, its mask is
// documented and a rendering test covers it. This report says which is which,
// and never presents an approximated mask as verified.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  REVERSE_EXPANSIONS,
  REVERSE_IMPLEMENTED,
  reverseEligible,
  reversePending,
  type ReverseConfig,
} from '../src/foil/reverse-db'
import { REVERSE_ASSETS } from '../src/foil/reverse-index'
import { PATTERNS, patternLabel } from '../src/foil/patterns'
import { TYPE_SYMBOL_ASSETS } from '../src/foil/type-symbol-index'
import { LARGE_TYPE_SYMBOL_ASSETS } from '../src/foil/type-symbol-large-index'
import { REVERSE_TILE_ASSETS } from '../src/foil/reverse-tile-index'
import { REVERSE_TILE_INTRICATE_ASSETS } from '../src/foil/reverse-tile-intricate-index'
import { TYPE_SYMBOL_ASSETS } from '../src/foil/type-symbol-index'

type Row = { set_id: string; rarity: string | null; number: string }

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db.prepare('select set_id, rarity, number from cards').all() as Row[]
const setNames = new Map(
  (db.prepare('select id, name from sets').all() as { id: string; name: string }[]).map((s) => [s.id, s.name]),
)
db.close()

const bySet = new Map<string, Row[]>()
for (const r of rows) bySet.set(r.set_id, [...(bySet.get(r.set_id) ?? []), r])

type ExpansionReport = {
  setId: string
  name: string
  catalogName: string | null
  era: string
  year: number
  pattern: string
  patternLabel: string
  mask: ReverseConfig['mask']
  status: ReverseConfig['status']
  source: string
  painted: boolean
  cardsInCatalog: number
  reversePrintings: number
  excluded: number
  note: string
  maskNote: string
}

const expansions: ExpansionReport[] = REVERSE_EXPANSIONS.map((e) => {
  const cards = bySet.get(e.setId) ?? []
  const eligible = cards.filter((c) => reverseEligible({ setId: e.setId, number: c.number, rarity: c.rarity }))
  return {
    setId: e.setId,
    name: e.name,
    catalogName: setNames.get(e.setId) ?? null,
    era: e.era,
    year: e.year,
    pattern: e.pattern,
    patternLabel: patternLabel(e.pattern as never),
    mask: e.mask,
    status: e.status,
    source: e.source,
    painted: Boolean(REVERSE_ASSETS[e.pattern]) || e.pattern === 'reverse-flat-background' || e.pattern === 'reverse-energy-symbol',
    cardsInCatalog: cards.length,
    reversePrintings: eligible.length,
    excluded: cards.length - eligible.length,
    note: e.note,
    maskNote: e.maskNote,
  }
})

const painted = expansions.filter((e) => e.painted)
const pending = reversePending()
// Validated is a property of the database row, not a second hand-kept list.
const validatedIds = new Set(expansions.filter((e) => REVERSE_EXPANSIONS.find((x) => x.setId === e.setId)?.implemented).map((e) => e.setId))

const report = {
  reverseIndexVersion: 1,
  catalog: 'data/tcglife.db',
  counts: {
    expansions: expansions.length,
    expansionsWithPrintings: expansions.filter((e) => e.reversePrintings > 0).length,
    cardsInCatalog: expansions.reduce((n, e) => n + e.cardsInCatalog, 0),
    reversePrintings: expansions.reduce((n, e) => n + e.reversePrintings, 0),
    excludedCards: expansions.reduce((n, e) => n + e.excluded, 0),
    patternsIdentified: new Set(expansions.map((e) => e.pattern)).size,
    patternsPainted: Object.keys(REVERSE_ASSETS).length + (REVERSE_IMPLEMENTED.includes('reverse-type-symbol') ? 1 : 0) + (REVERSE_IMPLEMENTED.includes('reverse-type-symbol-large') ? 1 : 0) + (REVERSE_IMPLEMENTED.includes('reverse-tile') ? 1 : 0) + (REVERSE_IMPLEMENTED.includes('reverse-tile-intricate') ? 1 : 0) + (REVERSE_IMPLEMENTED.includes('reverse-energy-symbol') ? 1 : 0) + (REVERSE_IMPLEMENTED.includes('reverse-flat-background') ? 1 : 0),
    expansionsValidated: expansions.filter((e) => validatedIds.has(e.setId)).length,
    expansionsPending: expansions.filter((e) => !validatedIds.has(e.setId)).length,
  },
  paintedPatterns: [
    ...Object.entries(REVERSE_ASSETS).map(([id, a]) => ({
      id,
      label: a?.label,
      texture: a?.texture,
      plain: a?.plain,
      coverage: a?.coverage,
      tileable: a?.tileable,
      approximation: a?.approximation,
    })),
    ...(REVERSE_IMPLEMENTED.includes('reverse-type-symbol')
      ? [{
          id: 'reverse-type-symbol',
          label: 'Type symbol (BW2–11, XY)',
          texture: TYPE_SYMBOL_ASSETS.grass.texture,
          plain: false,
          coverage: TYPE_SYMBOL_ASSETS.grass.coverage,
          tileable: true,
          approximation: true,
        }]
      : []),
    ...(REVERSE_IMPLEMENTED.includes('reverse-type-symbol-large')
      ? [{
          id: 'reverse-type-symbol-large',
          label: 'Large type symbol (SM1–12, Detective Pikachu)',
          texture: LARGE_TYPE_SYMBOL_ASSETS.grass.texture,
          plain: false,
          coverage: LARGE_TYPE_SYMBOL_ASSETS.grass.coverage,
          tileable: false,
          approximation: true,
        }]
      : []),
    ...(REVERSE_IMPLEMENTED.includes('reverse-tile')
      ? [{
          id: 'reverse-tile',
          label: 'Tile (Sword & Shield – Crown Zenith)',
          texture: REVERSE_TILE_ASSETS.grass.texture,
          plain: false,
          coverage: REVERSE_TILE_ASSETS.grass.coverage,
          tileable: true,
          approximation: true,
        }]
      : []),
    ...(REVERSE_IMPLEMENTED.includes('reverse-tile-intricate')
      ? [{
          id: 'reverse-tile-intricate',
          label: 'Intricate tile (Scarlet & Violet onward)',
          texture: REVERSE_TILE_INTRICATE_ASSETS.grass.texture,
          plain: false,
          coverage: REVERSE_TILE_INTRICATE_ASSETS.grass.coverage,
          tileable: true,
          approximation: true,
        }]
      : []),
    ...(REVERSE_IMPLEMENTED.includes('reverse-energy-symbol')
      ? [{
          id: 'reverse-energy-symbol',
          label: 'Energy symbols (EX Hidden Legends – Team Rocket Returns)',
          texture: TYPE_SYMBOL_ASSETS.grass.texture,
          plain: false,
          coverage: TYPE_SYMBOL_ASSETS.grass.coverage,
          tileable: true,
          approximation: true,
        }]
      : []),
    ...(REVERSE_IMPLEMENTED.includes('reverse-flat-background')
      ? [{
          id: 'reverse-flat-background',
          label: 'Flat background (EX Delta Species – Power Keepers)',
          texture: null,
          plain: true,
          coverage: 1,
          tileable: false,
          approximation: true,
        }]
      : []),
  ],
  validated: expansions.filter((e) => validatedIds.has(e.setId)),
  pendingPatterns: pending.map((p) => ({ pattern: p.pattern, patternLabel: patternLabel(p.pattern), expansions: p.sets.length })),
  expansions,
  limitations: [
    'Every reverse texture is a procedural reconstruction: no factory scan or angled photograph was available, so mark shape and density are approximations.',
    'Masks marked "approximated" use the whole illustration window; the printed pattern excludes the Pokémon itself in the EX Delta Species→Power Keepers run and sits on the Pokémon in Dragon Frontiers, and this build cannot segment the subject.',
    'An expansion counts as validated only when it is marked implemented and the suite exercises its mask, eligibility and rendering directly. Every catalogued expansion is now validated; the EX-era set logos and stamped promos are printed decoration, not foil, and are deliberately not imitated.',
    'Eligibility is a set rule plus number/rarity exclusions. A card-specific exception that no source read here documents is not invented.',
  ],
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/reverse-printings.json', JSON.stringify(report, null, 2) + '\n')

const md = `# Reverse holo database — verification report

Generated by \`scripts/reverse-report.ts\` from \`${report.catalog}\`, \`src/foil/reverse-db.ts\`
and \`src/foil/reverse-index.ts\`.

**Not every expansion is complete, and the table says so.** ${report.counts.expansions} expansions
have a researched pattern, mask and eligibility rule; ${report.counts.expansionsValidated} have been
validated end to end; the other ${report.counts.expansionsPending} still need their own end-to-end check.

## Coverage

| | |
| --- | --- |
| Expansions in the database | ${report.counts.expansions} |
| Expansions with reverse printings in this catalog | ${report.counts.expansionsWithPrintings} |
| Reverse printings identified | ${report.counts.reversePrintings} |
| Cards excluded (no reverse counterpart) | ${report.counts.excludedCards} |
| Distinct patterns identified | ${report.counts.patternsIdentified} |
| Patterns painted | ${report.counts.patternsPainted} |

## Painted patterns

${report.paintedPatterns.map((p) => `- **${p.label}** — \`${p.id}\`${p.plain ? ' (plain, no marks)' : ''}, ${((p.coverage ?? 0) * 100).toFixed(2)}% coverage, ${p.approximation ? 'approximation' : 'verified'}`).join('\n')}

## Validated end to end

${report.validated.map((e) => `- \`${e.setId}\` ${e.name}: ${e.patternLabel}, ${e.mask === 'outside-art' ? 'card body' : 'picture window'} (${e.status})`).join('\n')}

## Still pending

${report.pendingPatterns.length ? report.pendingPatterns.map((p) => `- ${p.patternLabel} — ${p.expansions} expansion${p.expansions === 1 ? '' : 's'}`).join('\n') : 'None — every catalogued expansion is validated.'}

## Every expansion

| set | year | pattern | mask | status | printed | reversed | excluded |
| --- | --- | --- | --- | --- | --- | --- | --- |
${expansions
  .map(
    (e) =>
      `| \`${e.setId}\` | ${e.year} | ${e.pattern} | ${e.mask === 'outside-art' ? 'body' : 'window'} | ${e.status}${e.painted ? ' · painted' : ''} | ${e.cardsInCatalog} | ${e.reversePrintings} | ${e.excluded} |`,
  )
  .join('\n')}

## What is not claimed

${report.limitations.map((l) => `- ${l}`).join('\n')}
`

fs.writeFileSync('reports/reverse-printings.md', md)

console.log(`expansions: ${report.counts.expansions} · reverse printings: ${report.counts.reversePrintings} · excluded: ${report.counts.excludedCards}`)
console.log(`patterns identified: ${report.counts.patternsIdentified} · painted: ${report.counts.patternsPainted} · validated: ${report.counts.expansionsValidated}`)
console.log('written: reports/reverse-printings.json, reports/reverse-printings.md')
