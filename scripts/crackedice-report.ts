// Phase 7 report: Cracked Ice.
//
// Run: ./node_modules/.bin/tsx scripts/crackedice-report.ts
//
// This phase is deliberately narrow. Bulbapedia describes Cracked Ice as the foil
// used for the featured card in Platinum-series theme decks, and names exactly one
// card whose area it also describes: the English Frost Rotom from Rising Rivals,
// foiled "over everything but the image of the Pokémon". The catalogue has no
// Platinum/HGSS/BW theme-deck sets, so those printings cannot be wired here and
// this report says so instead of inventing rows.
//
// It also records a correction: the EX Trainer Kits (tk1a/tk1b/tk2a/tk2b) were
// being painted Cracked Ice by a `tk1`/`tk2` prefix rule. They are 2004–05
// products, years before the pattern appears, so that rule is removed.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { printingFor } from '../src/foil/printing-db'
import { coverageFraction, foilMaskFor, maskValue } from '../src/foil/mask'
import { holoFor } from '../src/holo'
import { PATTERNS } from '../src/foil/patterns'
import { CRACKEDICE_SHEET, CRACKEDICE_SHOWCASE } from '../src/foil/crackedice-index'

const db = new Database('data/tcglife.db', { readonly: true })
const rotom = db
  .prepare("select id, name, set_id, number, rarity from cards where id = 'pl2-RT2'")
  .get() as { id: string; name: string; set_id: string; number: string; rarity: string } | undefined
const tk = db
  .prepare("select id from cards where set_id like 'tk%'")
  .all() as { id: string }[]
const otherRotom = db
  .prepare("select id, name from cards where id in ('pl2-RT1','pl2-RT3','pl2-RT4','pl2-RT5') order by id")
  .all() as { id: string; name: string }[]
db.close()

const problems: string[] = []
if (!rotom) problems.push('pl2-RT2 (Frost Rotom) is not in the catalogue')

const printing = rotom ? printingFor({ cardId: rotom.id, rarity: rotom.rarity, name: rotom.name }) : null
if (!printing) problems.push('Frost Rotom does not resolve to a printing')
else {
  if (printing.pattern !== 'crackedice') problems.push(`Frost Rotom resolved to ${printing.pattern}`)
  if (printing.mask !== 'outside-art') problems.push(`Frost Rotom mask is ${printing.mask}, expected outside-art`)
  if (!printing.maskVerified) problems.push('Frost Rotom mask is not marked verified')
  if (printing.status !== 'verified') problems.push(`Frost Rotom status is ${printing.status}`)
}

const spec = rotom ? foilMaskFor({ cardId: rotom.id, rarity: rotom.rarity }) : null
if (!spec) problems.push('Frost Rotom has no foil mask')
else {
  if (spec.kind !== 'outsideArt') problems.push(`mask kind is ${spec.kind}`)
  if (maskValue(spec, 0.5, 0.3) !== 0) problems.push('the artwork is foiled on Frost Rotom; the source says it is not')
  if (maskValue(spec, 0.5, 0.95) !== 255) problems.push('the text panel is not foiled')
}

// The correction: no Trainer Kit card may claim Cracked Ice any more, and the
// four sibling Rotom printings are not named by the source read here.
const tkClaiming = tk.filter((r) => {
  const art = holoFor({ cardId: r.id })
  return art?.pattern === 'crackedice'
})
if (tkClaiming.length) problems.push(`${tkClaiming.length} EX Trainer Kit cards still claim Cracked Ice`)
const rotomClaiming = otherRotom.filter((r) => holoFor({ cardId: r.id, rarity: 'Rare' })?.pattern === 'crackedice')
if (rotomClaiming.length) problems.push(`${rotomClaiming.length} unnamed Rotom printings claim Cracked Ice`)

const counts = {
  namedPrintings: printing ? 1 : 0,
  painted: PATTERNS.crackedice.implemented ? 1 : 0,
  validated: CRACKEDICE_SHOWCASE.length,
  maskVerified: spec?.verified ? 1 : 0,
  textureVerified: CRACKEDICE_SHEET.textureVerified,
  themeDeckPrintingsInCatalogue: 0,
  tkCardsCorrected: tk.length,
  unnamedRotom: otherRotom.length,
}

const report = {
  generated: 'scripts/crackedice-report.ts',
  phase: 'Phase 7 — Cracked Ice',
  counts,
  maskArea: Number(coverageFraction(spec).toFixed(4)),
  printing: printing
    ? {
        cardId: printing.cardId,
        name: printing.name ?? rotom?.name ?? '',
        pattern: printing.pattern,
        mask: printing.mask,
        product: printing.product,
        status: printing.status,
        matchedRule: printing.matchedRule,
        source: printing.source,
        evidence: printing.note,
      }
    : null,
  problems,
  honesty: [
    'Only ONE Cracked Ice printing is named by a source read here: the English Frost Rotom from Rising Rivals (pl2-RT2). The pattern is famous across theme decks, but this catalogue does not contain the Platinum/HGSS/BW theme-deck sets, so those printings are absent rather than modelled.',
    'The foil area is verified by that same sentence: Cracked Ice is displayed "over everything but the image of the Pokémon" on this card. The artwork stays matte; the body, name bar and text panel are foil.',
    'The texture is a PROCEDURAL RECONSTRUCTION of "irregular reflective shapes resembling pieces of cracked or shattered glass" (Bulbapedia). No scan, photograph or tilt video of a Cracked Ice card exists in this repository, so textureVerified is false.',
    'The sheet is a Voronoi fracture with flat facets and thin bright boundaries, cut with toroidal distances so it tiles. Whether the real printed foil repeated is not documented here; tiling is this build’s choice and is disclosed.',
    'Correction: the EX Trainer Kits (tk1a/tk1b/tk2a/tk2b) were previously painted Cracked Ice by a tk1/tk2 prefix rule. They shipped in 2004–2005, before the pattern existed, and no source read here documents their foil, so they now make no foil claim. The four other Rotom printings (RT1, RT3–RT5) are likewise not named and stay unpainted.',
  ],
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/crackedice-printings.json', JSON.stringify(report, null, 2) + '\n')

const lines: string[] = []
lines.push('# Cracked Ice — printings and reproduction')
lines.push('')
lines.push(`Generated by \`${report.generated}\`. Phase 7 of \`HOLOFOIL_ROADMAP.md\`.`)
lines.push('')
lines.push('## Numbers')
lines.push('')
lines.push(`- Named Cracked Ice printings in this catalogue: **${counts.namedPrintings}** (${rotom?.name ?? 'none'}, ${rotom?.id ?? '—'}).`)
lines.push(`- Foil mask verified: **${counts.maskVerified}** — Cracked Ice over the body, artwork matte (${(report.maskArea * 100).toFixed(1)}% of the card box).`)
lines.push(`- Painted: **${counts.painted}** using \`${CRACKEDICE_SHEET.texture}\`.`)
lines.push(`- Render-validated: **${counts.validated}**.`)
lines.push(`- Texture verified against a real sheet: **${counts.textureVerified ? 'yes' : 'no — reconstruction'}**.`)
lines.push(`- Platinum/HGSS/BW theme-deck printings available to wire: **${counts.themeDeckPrintingsInCatalogue}** (the catalogue has no such sets).`)
lines.push(`- EX Trainer Kit cards no longer claiming Cracked Ice: **${counts.tkCardsCorrected}**.`)
lines.push('')
lines.push('## What is verified and what is drawn')
lines.push('')
for (const h of report.honesty) lines.push(`- ${h}`)
lines.push('')
lines.push('## The sheet')
lines.push('')
lines.push(`- Texture: \`${CRACKEDICE_SHEET.texture}\` (${CRACKEDICE_SHEET.size}), seed \`${CRACKEDICE_SHEET.seed}\`.`)
lines.push(`- ${CRACKEDICE_SHEET.facets} facets; measured coverage ${(CRACKEDICE_SHEET.coverage * 100).toFixed(2)}%, peak ${CRACKEDICE_SHEET.peak.toFixed(3)}.`)
lines.push(`- Seam ratio ${CRACKEDICE_SHEET.seamRatio.toFixed(3)} (1.0 = wrap looks like any interior seam), so cards may sample any window.`)
lines.push('')
if (report.problems.length) {
  lines.push('## Problems')
  lines.push('')
  for (const p of report.problems) lines.push(`- ${p}`)
  lines.push('')
}

fs.writeFileSync('reports/crackedice-printings.md', lines.join('\n'))

console.log(`named crackeds: ${counts.namedPrintings} · mask ${counts.maskVerified} · validated ${counts.validated}`)
console.log(`texture: ${CRACKEDICE_SHEET.texture} · reconstruction (verified: ${CRACKEDICE_SHEET.textureVerified})`)
console.log(`EX Trainer Kit cards corrected: ${counts.tkCardsCorrected}`)
console.log('written: reports/crackedice-printings.json, reports/crackedice-printings.md')
if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):`)
  for (const p of problems) console.log(' -', p)
  process.exitCode = 1
} else {
  console.log('Frost Rotom is the one named printing; no Trainer Kit or unnamed Rotom claims Cracked Ice')
}
