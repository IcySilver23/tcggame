// Verification report for the Radiant Collection (Phase 3).
//
// Run: ./node_modules/.bin/tsx scripts/radiant-report.ts
//
// Phase 3's deliverable is "validated rendering configurations for all 57 cards",
// and the word validated has to mean something. A card is CONFIGURED when it has
// a texture and a coverage answer; it is VERIFIED only when a source describes
// that printing's foil area. This report keeps the two apart per card, because
// the pack's own READMEs say the motifs are reconstructed concept art and the
// masks are not in the pack at all.
//
// Three groups, and only three:
//   - verified full-face (Legendary Treasures, plus Generations RC6 by photograph);
//   - verified art window (Generations RC16 by scan);
//   - verified non-foil (the thirteen Generations RC commons);
//   - modelled (the remaining Generations foil cards, whose boundary no source
//     describes). Modelled is disclosed, never presented as verified.

import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { RADIANT_ASSETS, RADIANT_CARD_IDS } from '../src/foil/radiant-index'
import { foilMaskFor } from '../src/foil/mask'
import { radiantCoverage } from '../src/foil/radiant-masks'

type Row = { id: string; name: string; rarity: string }

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db.prepare("select id, name, rarity from cards where number like 'RC%' order by set_id, cast(substr(number, 3) as integer)").all() as Row[]
db.close()

type CardReport = {
  cardId: string
  setId: string
  number: string
  name: string
  rarity: string
  motif: string
  texture: string
  textureShipped: boolean
  /** 'plain' when this printing has no foil at all. */
  coverage: string
  verified: boolean
  evidence: string
}

const problems: string[] = []
const cards: CardReport[] = []

for (const id of RADIANT_CARD_IDS) {
  const asset = RADIANT_ASSETS[id]
  const row = rows.find((r) => r.id === id)
  if (!row) {
    problems.push(`${id}: in the pack index but not in the card database`)
    continue
  }
  const textureShipped = fs.existsSync(path.join('public', asset.pattern.replace(/^\//, '')))
  if (!textureShipped) problems.push(`${id}: texture ${asset.pattern} is not shipped`)

  const spec = foilMaskFor({ cardId: id, rarity: row.rarity })
  const cov = radiantCoverage({ cardId: id, rarity: row.rarity })
  const coverage = spec ? spec.kind : 'plain'
  const verified = spec ? spec.verified : cov === null
  const evidence = spec
    ? spec.evidence
    : 'No foil: a Generations RC common, printed without a holographic layer (elitefourum and pull-rate sources).'

  cards.push({
    cardId: id,
    setId: asset.setId,
    number: asset.number,
    name: row.name,
    rarity: row.rarity,
    motif: asset.motif,
    texture: asset.pattern,
    textureShipped,
    coverage,
    verified,
    evidence,
  })
}

for (const row of rows) {
  if (!RADIANT_ASSETS[row.id]) problems.push(`${row.id}: RC card in the database with no pack asset`)
}

const counts = {
  cards: cards.length,
  databaseRows: rows.length,
  plain: cards.filter((c) => c.coverage === 'plain').length,
  verified: cards.filter((c) => c.verified && c.coverage !== 'plain').length,
  modelled: cards.filter((c) => !c.verified).length,
  full: cards.filter((c) => c.coverage === 'full').length,
  art: cards.filter((c) => c.coverage === 'art').length,
  fullArt: cards.filter((c) => c.coverage === 'fullArt').length,
  texturesShipped: cards.filter((c) => c.textureShipped).length,
  motifs: new Set(cards.map((c) => c.motif)).size,
}

const bySet = {
  bw11: cards.filter((c) => c.setId === 'bw11').length,
  g1: cards.filter((c) => c.setId === 'g1').length,
}

const report = {
  generated: 'scripts/radiant-report.ts',
  phase: 'Phase 3 — Radiant Collection',
  counts,
  bySet,
  notVerified: cards.filter((c) => !c.verified).map((c) => c.cardId),
  honesty: [
    'The 57 motifs are RECONSTRUCTED CONCEPT ART from Radiant_Collection_57_Card_Foil_Concept_Pack, not scanned factory stamps. Every pack README says so.',
    'Coverage is researched separately and is the only place a foil AREA is claimed.',
    'Legendary Treasures RC is foiled across the whole face per Bulbapedia ("special coating and foil patterns") plus an owner account of RC7 in hand.',
    'Generations RC6 (edge to edge) is verified by reference photographs; RC16 (art window) by a scan. No other Generations boundary is documented here, so the remaining foil cards are modelled and marked unverified.',
    'The thirteen Generations RC commons are printed with no foil; they render plain and the mask refuses them.',
    'The reverse-holo flag is ignored for RC cards: the subset was never printed reverse-holo.',
    'Configured is not the same claim as verified: 57 cards have a configuration, 40 of them rest on a source that describes the foil (or its absence).',
  ],
  problems,
  cards,
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/radiant-printings.json', JSON.stringify(report, null, 2) + '\n')

const lines: string[] = []
lines.push('# Radiant Collection — validation report')
lines.push('')
lines.push(`Generated by \`${report.generated}\`. Phase 3 of \`HOLOFOIL_ROADMAP.md\`.`)
lines.push('')
lines.push('## Numbers')
lines.push('')
lines.push(`- Cards configured: **${counts.cards}** (${bySet.bw11} Legendary Treasures, ${bySet.g1} Generations); database rows: ${counts.databaseRows}.`)
lines.push(`- Textures shipped: **${counts.texturesShipped}/${counts.cards}**; distinct motifs: ${counts.motifs}.`)
lines.push(`- Verified coverage: **${counts.verified}** — ${counts.full} full-face, ${counts.art} art window.`)
lines.push(`- Verified non-foil: **${counts.plain}** Generations RC commons.`)
lines.push(`- Modelled (disclosed, not verified): **${counts.modelled}** — ${counts.art - cards.filter((c) => c.verified && c.coverage === 'art').length} art-window guesses, ${counts.fullArt} full-art guesses.`)
lines.push(`- Missing assets or database rows: **${problems.length}**.`)
lines.push('')
lines.push('## What the sources actually support')
lines.push('')
for (const h of report.honesty) lines.push(`- ${h}`)
lines.push('')
lines.push('## Per-card configuration')
lines.push('')
lines.push('| Card | Name | Rarity | Motif | Coverage | Status |')
lines.push('| --- | --- | --- | --- | --- | --- |')
for (const c of cards) {
  const status = c.coverage === 'plain' ? 'verified non-foil' : c.verified ? '**verified**' : 'MODELLED'
  lines.push(`| ${c.cardId} | ${c.name} | ${c.rarity} | ${c.motif} | ${c.coverage} | ${status} |`)
}
lines.push('')
lines.push('## Evidence, per configuration')
lines.push('')
const groups = new Map<string, CardReport[]>()
for (const c of cards) {
  const key = `${c.coverage} · ${c.verified ? 'verified' : 'modelled'}`
  groups.set(key, [...(groups.get(key) ?? []), c])
}
for (const [key, group] of groups) {
  lines.push(`### ${key} (${group.length})`)
  lines.push('')
  lines.push(group[0].evidence)
  lines.push('')
  lines.push(`Cards: ${group.map((c) => c.cardId).join(', ')}`)
  lines.push('')
}
if (problems.length) {
  lines.push('## Problems')
  lines.push('')
  for (const p of problems) lines.push(`- ${p}`)
  lines.push('')
}

fs.writeFileSync('reports/radiant-printings.md', lines.join('\n'))

console.log(`cards: ${counts.cards} (${bySet.bw11} bw11 + ${bySet.g1} g1)`)
console.log(`textures shipped: ${counts.texturesShipped}/${counts.cards}`)
console.log(`verified: ${counts.verified} foil + ${counts.plain} non-foil · modelled: ${counts.modelled}`)
console.log(`written: reports/radiant-printings.json, reports/radiant-printings.md`)
if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):`)
  for (const p of problems) console.log(' -', p)
  process.exitCode = 1
} else {
  console.log('every pack card maps to a database row and a shipped texture')
}
