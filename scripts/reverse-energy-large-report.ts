// Ascended Heroes' Energy-pattern reverse — evidence report.
//
// Run: ./node_modules/.bin/tsx scripts/reverse-energy-large-report.ts
//
// The report separates what the source identifies (the paper, its slot, its area
// and its single large type stamp) from what this build draws (the glyph strokes,
// the small vertical squash and the per-card jitter). It also checks that the only
// eligible cards are regular Pokémon.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { PATTERNS } from '../src/foil/patterns'
import {
  ENERGY_REVERSE_PRINTINGS,
  ENERGY_REVERSE_VARIANT,
} from '../src/foil/reverse-energy-large-db'
import {
  ENERGY_REVERSE_ASSETS,
  ENERGY_REVERSE_GEOMETRY,
  ENERGY_REVERSE_REFERENCE,
  ENERGY_REVERSE_TEXTURE_VERIFIED,
} from '../src/foil/reverse-energy-large-index'
import { ENERGY_REVERSE_GLYPHS } from '../src/foil/reverse-energy-large-sheet'

type CardRow = {
  number: string
  supertype: string | null
  subtypes: string | null
  types: string | null
}
type SetRow = { id: string; name: string; printed_total: number | null; release_date: string | null }

const db = new Database('data/tcglife.db', { readonly: true })
const sets = new Map<string, SetRow>()
for (const p of ENERGY_REVERSE_PRINTINGS) {
  const row = db.prepare('select id, name, printed_total, release_date from sets where id = ?').get(p.setId) as SetRow | undefined
  if (row) sets.set(p.setId, row)
}

function has(subtypes: string | null, name: string): boolean {
  try {
    const list = JSON.parse(subtypes ?? '[]') as string[]
    return list.includes(name)
  } catch {
    return false
  }
}

const problems: string[] = []
const rows = ENERGY_REVERSE_PRINTINGS.map((p) => {
  const set = sets.get(p.setId)
  const printed = set?.printed_total ?? Number.POSITIVE_INFINITY
  const cards = db.prepare('select number, supertype, subtypes, types from cards where set_id = ?').all(p.setId) as CardRow[]
  const main = cards.filter((c) => {
    const n = Number(c.number)
    return !Number.isFinite(n) || n <= printed
  })
  const regularPokemon = main.filter(
    (c) => c.supertype === 'Pokémon' && !has(c.subtypes, 'ex') && !has(c.subtypes, 'ACE SPEC'),
  )
  const stamped = regularPokemon.filter((c) => !!c.types && c.types !== '[]')
  const missingTypes = regularPokemon.length - stamped.length
  const trainerCount = main.filter((c) => c.supertype === 'Trainer').length
  const energyCount = main.filter((c) => c.supertype === 'Energy').length
  if (!PATTERNS[p.pattern]?.implemented) problems.push(`${p.setId}: pattern ${p.pattern} is not implemented`)
  if (regularPokemon.length === 0) problems.push(`${p.setId}: no regular Pokémon can carry the stamp`)
  if (missingTypes > 0) problems.push(`${p.setId}: ${missingTypes} eligible Pokémon have no type, so they render plain`)
  return {
    setId: p.setId,
    setName: set?.name ?? p.setName,
    releaseDate: set?.release_date ?? null,
    year: p.year,
    variant: ENERGY_REVERSE_VARIANT,
    pattern: p.pattern,
    mask: p.mask,
    artRect: p.artRect,
    status: p.status,
    source: p.source,
    mainSetCards: main.length,
    regularPokemon: regularPokemon.length,
    stamped: stamped.length,
    missingTypes,
    trainers: trainerCount,
    energies: energyCount,
    note: p.note,
  }
})

db.close()

const glyphRows = ENERGY_REVERSE_GLYPHS.map((id) => {
  const a = ENERGY_REVERSE_ASSETS[id]
  return {
    glyph: id,
    label: a.label,
    texture: a.texture,
    coverage: a.coverage,
    peak: a.peak,
    centerU: a.centerU,
    centerV: a.centerV,
  }
})

const report = {
  generated: 'scripts/reverse-energy-large-report.ts',
  phase: 'Phase 10 — Ascended Heroes Energy-pattern reverse',
  counts: {
    printings: rows.length,
    sets: new Set(rows.map((r) => r.setId)).size,
    glyphs: glyphRows.length,
    textureVerified: ENERGY_REVERSE_TEXTURE_VERIFIED,
    geometry: ENERGY_REVERSE_GEOMETRY,
  },
  rows,
  glyphs: glyphRows,
  problems,
  honesty: [
    'PokeBeach’s Ascended Heroes set guide identifies the paper: every regular non-ex Pokémon has an Energy-pattern reverse and an assigned Poké Ball reverse, while Trainers and Energy cards received only plain reverses. The first reverse slot is therefore restricted to regular Pokémon in the game roller.',
    'A real Snorunt Energy reverse shows one large Water Energy symbol behind the attack text, with the illustration window matte. That establishes the single-stamp layout, the card-body area and an approximate width of 0.45 card widths; the sampler records the measured 0.5/0.675 placement. The Ascended Heroes scan measures the modern art window at x 0.083, y 0.094, w 0.838, h 0.375, so this printing uses that rectangle instead of the shared base-set window and does not cut the top of the stamp.',
    'The glyphs are the same stylised type drawings used by the BW/XY and Sun & Moon papers: geometric approximations, not official Energy icons. No scan or clean photograph of the sheet is available, so ENERGY_REVERSE_TEXTURE_VERIFIED is false and every field says verified: false.',
    'Every type is normalised into the same 0.45 x 0.43 card stamp box measured from the reference, so a diagonal leaf cannot become wider than Water’s droplet. The normalisation is this build’s disclosed choice, not a measured property of the print.',
    'The symbol comes from the card’s own type. Trainers, Energy cards, Pokémon ex, ACE SPEC cards and cards whose type cannot be resolved render plain foil; a wrong symbol is never substituted.',
    'The game rolls the explicit reverseHolofoilEnergy token in Ascended Heroes’ first reverse slot. Its price is anchored to the same card’s ordinary reverse and carries no researched premium, because no ball-style market multiplier was measured for this paper.',
  ],
  sources: [
    { label: 'PokeBeach Ascended Heroes set guide', url: ENERGY_REVERSE_REFERENCE },
  ],
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/reverse-energy-large-printings.json', JSON.stringify(report, null, 2) + '\n')

const lines = [
  '# Ascended Heroes — Energy-pattern reverse',
  '',
  `Generated by \`${report.generated}\`.`,
  '',
  '## Numbers',
  '',
  `- Printings: **${report.counts.printings}**; sets: **${report.counts.sets}**; type sheets: **${report.counts.glyphs}**.`,
  `- Texture verified: ${report.counts.textureVerified ? 'yes' : 'no — procedural glyph drawing; no sheet traced'}.`,
  `- Placement: one stamp at **${ENERGY_REVERSE_GEOMETRY.targetU} × ${ENERGY_REVERSE_GEOMETRY.targetV}**, 0.95 window, outside-art mask.`,
  '',
  '## Printing',
  '',
  '| set | year | variant | pattern | mask | status | main-set cards | regular Pokémon | stamped | missing types | trainers | energy |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) =>
    `| ${r.setName} (\`${r.setId}\`) | ${r.year} | \`${r.variant}\` | \`${r.pattern}\` | ${r.mask} | ${r.status} | ${r.mainSetCards} | ${r.regularPokemon} | ${r.stamped} | ${r.missingTypes} | ${r.trainers} | ${r.energies} |`,
  ),
  '',
  '## Type sheets',
  '',
  '| glyph | coverage | peak | centre |',
  '| --- | --- | --- | --- |',
  ...glyphRows.map((g) =>
    `| ${g.label} | ${(g.coverage * 100).toFixed(2)}% | ${g.peak.toFixed(2)} | ${g.centerU.toFixed(3)}, ${g.centerV.toFixed(3)} |`,
  ),
  '',
  '## What is sourced and what is drawn',
  '',
  ...report.honesty.map((h) => `- ${h}`),
  '',
  '## Sources',
  '',
  ...report.sources.map((s) => `- [${s.label}](${s.url})`),
  '',
]
if (problems.length) lines.push('## Problems', '', ...problems.map((p) => `- ${p}`), '')
fs.writeFileSync('reports/reverse-energy-large-printings.md', lines.join('\n'))

console.log(`energy printings: ${report.counts.printings} · glyphs: ${report.counts.glyphs}`)
console.log(rows.map((r) => `${r.setId}: ${r.regularPokemon} regular Pokémon, ${r.stamped} stamped, ${r.missingTypes} missing types`).join('\n'))
console.log('written: reports/reverse-energy-large-printings.{json,md}')
if (problems.length) {
  for (const p of problems) console.log(' -', p)
  process.exitCode = 1
} else console.log('the Energy-pattern reverse resolves to a shipped, documented paper')
