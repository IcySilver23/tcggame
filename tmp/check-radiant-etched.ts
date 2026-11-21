// Phase 12: the Radiant Pokémon etched sheet, its sampler, the printings and the render.
//
// Run: ./node_modules/.bin/tsx tmp/check-radiant-etched.ts
//
// The checks are split the way the claims are:
//   - the GENERATOR is a drawing: a lattice that repeats exactly, silver that never goes
//     dark, tileable, deterministic, and neutral;
//   - the PRINTING is documented: all fifteen Radiant Pokémon resolve to this paper with
//     the whole card as its area, the Radiant Collection keeps its own pattern, and a
//     reverse token invents nothing;
//   - the RENDER still obeys the layer contract: at rest it is the scan byte for byte, at
//     tilt it adds light only inside the mask.
//
// Read the report first if a number here looks arbitrary: reports/radiant-etched-printings.md.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  etchedRidge,
  RADIANT_ETCHED_COARSE_PERIOD,
  RADIANT_ETCHED_FINE_PERIOD,
  RADIANT_ETCHED_FLOOR,
  RADIANT_ETCHED_MARK_LINE,
  RADIANT_ETCHED_PEAK,
  RADIANT_ETCHED_SHEET_SIZE,
  radiantEtchedInkAt,
  radiantEtchedSeamMismatch,
  renderRadiantEtchedSheet,
} from '../src/foil/radiant-etched-sheet'
import {
  buildRadiantEtchedGrid,
  radiantEtchedCopyFor,
  radiantEtchedFieldFor,
  sampleRadiantEtched,
  RADIANT_ETCHED_TEXTURE_VERIFIED,
} from '../src/foil/radiant-etched'
import {
  RADIANT_ETCHED_CARDS,
  RADIANT_ETCHED_CLAIM,
  RADIANT_ETCHED_SEPARATION,
  RADIANT_ETCHED_SHEET,
} from '../src/foil/radiant-etched-index'
import { PATTERNS } from '../src/foil/patterns'
import { printingFor } from '../src/foil/printing-db'
import { coverageFraction, foilMaskFor, maskValue } from '../src/foil/mask'
import { holoFor } from '../src/holo'
import { DEFAULT_FOIL_SETTINGS, meanLift, paintFoil, patternModulatorFor } from '../src/foil/stages'
import { FACE_ON } from '../src/foil/reflection'

let total = 0
let fails = 0
function ok(cond: boolean, label: string, detail?: string): void {
  total++
  if (!cond) {
    fails++
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('Radiant Pokémon — etched sheet, sampler, printings, render')

// ---------------------------------------------------------------------------
// 1. The generator draws a lattice, not noise and not a dark marked paper.
// ---------------------------------------------------------------------------
ok(etchedRidge(0, 1.7) === 1, 'a ridge is brightest on its line')
ok(etchedRidge(1.7, 1.7) < 0.4, 'and falls away within one width', etchedRidge(1.7, 1.7).toFixed(3))
ok(etchedRidge(5, 1.7) < 0.01, 'the field between ridges is quiet', etchedRidge(5, 1.7).toFixed(4))
const profile = [0, 0.5, 1, 1.5, 2, 3].map((d) => etchedRidge(d, 1.7))
ok(profile.every((v, i) => i === 0 || v <= profile[i - 1] + 1e-9), 'ink falls monotonically away from a ridge')

const sheet = renderRadiantEtchedSheet(RADIANT_ETCHED_SHEET_SIZE)
ok(sheet.size === 1024, 'sheet is 1024px square')
ok(RADIANT_ETCHED_SHEET_SIZE % RADIANT_ETCHED_FINE_PERIOD === 0, 'the etch pitch divides the sheet exactly')
ok(RADIANT_ETCHED_SHEET_SIZE % RADIANT_ETCHED_COARSE_PERIOD === 0, 'the grid pitch divides the sheet exactly')
ok(sheet.coverage > 0.2 && sheet.coverage < 0.7, 'the etch covers enough to read and not enough to hide the art', `${(sheet.coverage * 100).toFixed(2)}%`)
ok(sheet.floor >= 0.3, 'the dimmest point still reflects: this is silver foil, not a marked paper', sheet.floor.toFixed(3))
ok(sheet.peak <= 0.92, 'the brightest ridge leaves the reflection some headroom', sheet.peak.toFixed(3))
ok(sheet.peak / sheet.floor >= 1.7, 'a mark body holds at least 1.7x the light of the field beside it', (sheet.peak / sheet.floor).toFixed(2))

// Exact repetition: the coarse period is the multiple both families share. Translating
// by the fine period alone must NOT be identical, or the diamond grid is not there.
{
  let repeats = true
  let coarseVisible = 0
  for (let y = 3; y < 260; y += 23) {
    for (let x = 5; x < 260; x += 29) {
      if (radiantEtchedInkAt(x, y) !== radiantEtchedInkAt(x + RADIANT_ETCHED_COARSE_PERIOD, y + RADIANT_ETCHED_COARSE_PERIOD)) repeats = false
      if (radiantEtchedInkAt(x, y) !== radiantEtchedInkAt(x + RADIANT_ETCHED_FINE_PERIOD, y + RADIANT_ETCHED_FINE_PERIOD)) coarseVisible++
    }
  }
  ok(repeats, 'the lattice repeats exactly at its coarse period, so the wrap is a continuation')
  ok(coarseVisible > 50, 'and the coarse diamond grid is visible over the fine etch', String(coarseVisible))
}

const seam = radiantEtchedSeamMismatch(sheet.rgba, sheet.size)
ok(seam < 0.02, 'the sheet wraps cleanly, so cards may sample any window', `${(seam * 100).toFixed(2)}%`)

const again = renderRadiantEtchedSheet(RADIANT_ETCHED_SHEET_SIZE)
let identical = again.rgba.length === sheet.rgba.length
for (let i = 0; identical && i < sheet.rgba.length; i++) if (again.rgba[i] !== sheet.rgba[i]) identical = false
ok(identical, 'the same inputs render byte-identical pixels (the lattice cannot move between frames)')

// Neutrality: every RGB texel is white, so the sheet can only modulate, never tint.
let neutral = true
for (let i = 0; i < sheet.rgba.length; i += 4) {
  if (sheet.rgba[i] !== 255 || sheet.rgba[i + 1] !== 255 || sheet.rgba[i + 2] !== 255) {
    neutral = false
    break
  }
}
ok(neutral, 'the sheet carries luminance only, never colour')

const small = renderRadiantEtchedSheet(256)
ok(small.coverage > 0.2 && small.floor >= 0.3, 'a smaller sheet keeps the same shape', small.floor.toFixed(3))

// ---------------------------------------------------------------------------
// 2. The shipped asset and the generated index agree with a fresh render.
// ---------------------------------------------------------------------------
const png = fs.readFileSync('public/foil/radiant-etched/sheet.png')
ok(png.length > 10_000, 'the sheet is shipped and not a stub', `${png.length} bytes`)
ok(png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, 'the sheet is a PNG')
ok(png.readUInt32BE(16) === 1024 && png.readUInt32BE(20) === 1024, 'the PNG is 1024x1024')
ok(Math.abs(RADIANT_ETCHED_SHEET.floor - sheet.floor) < 1e-4, 'index floor matches the render', `${RADIANT_ETCHED_SHEET.floor} vs ${sheet.floor}`)
ok(Math.abs(RADIANT_ETCHED_SHEET.peak - sheet.peak) < 1e-4, 'index peak matches the render')
ok(Math.abs(RADIANT_ETCHED_SHEET.coverage - sheet.coverage) < 1e-4, 'index coverage matches the render')
ok(Math.abs(RADIANT_ETCHED_SHEET.seamMismatch - seam) < 1e-3, 'index records the measured wrap step')
ok(RADIANT_ETCHED_SHEET.concept === true && RADIANT_ETCHED_SHEET.textureVerified === false, 'the index declares the sheet a reconstruction')
ok(RADIANT_ETCHED_SHEET.finePeriod === 16 && RADIANT_ETCHED_SHEET.coarsePeriod === 128, 'the index records both pitches')
ok(RADIANT_ETCHED_TEXTURE_VERIFIED === false, 'the sampler exposes no verified-texture claim')
ok(RADIANT_ETCHED_CLAIM.includes('special holofoil layer'), 'the claim quotes the source, not a paraphrase')
ok(/not Radiant Collection/.test(RADIANT_ETCHED_SEPARATION), 'the index states the separation from Radiant Collection')

const grid = buildRadiantEtchedGrid(sheet.size, sheet.size, sheet.rgba)
// `grid.coverage` is the shared builder's "cells carrying any ink" figure, which for silver
// foil is every cell (the floor is 0.36). The etched coverage is what clears the mark line.
ok(grid.coverage > 0.9, 'every cell of the grid carries ink: the silver never goes dark', grid.coverage.toFixed(3))
{
  let marked = 0
  for (let i = 0; i < grid.mark.length; i++) if (grid.mark[i] >= RADIANT_ETCHED_MARK_LINE) marked++
  const fc = marked / grid.mark.length
  ok(Math.abs(fc - sheet.coverage) < 0.05, 'the grid keeps the sheet’s etched coverage through the downsample', `${(fc * 100).toFixed(2)}% vs ${(sheet.coverage * 100).toFixed(2)}%`)
}
ok(grid.peak > 0.7 && grid.peak <= 0.92, 'the grid has bright ridges', grid.peak.toFixed(3))
let gridFloor = 1
let gridHi = 0
for (let i = 0; i < grid.mark.length; i++) {
  gridFloor = Math.min(gridFloor, grid.mark[i])
  gridHi = Math.max(gridHi, grid.mark[i])
}
ok(gridFloor >= 0.3, 'no cell of the grid is dark', gridFloor.toFixed(3))
ok(gridHi - gridFloor > 0.25, 'the grid varies across the card', `${gridFloor.toFixed(2)}–${gridHi.toFixed(2)}`)

// ---------------------------------------------------------------------------
// 3. Per-card cuts: stable between frames, different between cards, wrapping.
// ---------------------------------------------------------------------------
const c1 = radiantEtchedCopyFor('swsh10-27')
const c1b = radiantEtchedCopyFor('swsh10-27')
const c2 = radiantEtchedCopyFor('swsh10-46')
ok(c1.seed === c1b.seed && c1.offsetU === c1b.offsetU && c1.offsetV === c1b.offsetV, 'a card keeps its cut between frames')
ok(c1.offsetU !== c2.offsetU || c1.offsetV !== c2.offsetV, 'two cards sit at different cuts')

const s1 = sampleRadiantEtched(c1, grid, 0.31, 0.42)
ok(s1.mark === sampleRadiantEtched(c1, grid, 0.31, 0.42).mark, 'sampling is stable for a fixed point')
ok(s1.mark >= 0.3 && s1.mark <= 0.92, 'a mark is a 0..1 fraction in the sheet range', s1.mark.toFixed(3))
const wrappedU = sampleRadiantEtched({ ...c1, offsetU: c1.offsetU + 1 }, grid, 0.31, 0.42).mark
const wrappedV = sampleRadiantEtched({ ...c1, offsetV: c1.offsetV + 1 }, grid, 0.31, 0.42).mark
ok(Math.abs(wrappedU - s1.mark) < 1e-9 && Math.abs(wrappedV - s1.mark) < 1e-9, 'the sampler wraps instead of clamping at the sheet edge')

let cardDiff = 0
for (let i = 0; i < 60; i++) {
  const u = (i * 0.7919) % 1
  const v = (i * 0.3779) % 1
  cardDiff = Math.max(cardDiff, Math.abs(sampleRadiantEtched(c1, grid, u, v).mark - sampleRadiantEtched(c2, grid, u, v).mark))
}
ok(cardDiff > 0.05, 'different cards sample different ink at the same card point', cardDiff.toFixed(3))

const field = radiantEtchedFieldFor('swsh10-27', grid)
ok(field.verified === false, 'the field carries no verified-texture claim')
ok(field.plain !== true, 'an etched paper is not a plain field')
ok(String(field.meta.reproduction) === 'procedural reconstruction', 'the field names its reproduction as procedural')
ok(String(field.meta.tiling) === 'disclosed choice', 'the field discloses that tiling is this build’s choice')
ok(Number(field.meta.finePeriod) === 16 && Number(field.meta.coarsePeriod) === 128, 'the field records both pitches')

let fieldLo = 1
let fieldHi = 0
for (let v = 0.01; v < 1; v += 0.01) {
  for (let u = 0.01; u < 1; u += 0.01) {
    const m = field.mark(u, v)
    fieldLo = Math.min(fieldLo, m)
    fieldHi = Math.max(fieldHi, m)
  }
}
ok(fieldLo >= 0.3, 'the card’s field never goes dark', fieldLo.toFixed(3))
ok(fieldHi - fieldLo > 0.25, 'and the lattice varies across the card', `${fieldLo.toFixed(2)}–${fieldHi.toFixed(2)}`)

// ---------------------------------------------------------------------------
// 4. All fifteen Radiant Pokémon, and the cases that must not match.
// ---------------------------------------------------------------------------
ok(RADIANT_ETCHED_CARDS.length === 15, 'the generated table names fifteen cards', String(RADIANT_ETCHED_CARDS.length))
ok(new Set(RADIANT_ETCHED_CARDS.map((c) => c.cardId)).size === 15, 'no card is listed twice')
ok(new Set(RADIANT_ETCHED_CARDS.map((c) => c.setId)).size === 5, 'across five sets', String(new Set(RADIANT_ETCHED_CARDS.map((c) => c.setId)).size))

for (const card of RADIANT_ETCHED_CARDS) {
  const p = printingFor({ cardId: card.cardId, rarity: 'Radiant Rare' })
  ok(p?.pattern === 'radiant-etched', `${card.cardId}: resolves to radiant-etched`, p?.pattern ?? 'nothing')
  ok(p?.status === 'verified', `${card.cardId}: the identification is verified`, p?.status)
  ok(p?.matchedRule === 'explicit', `${card.cardId}: answered by its own claim`, p?.matchedRule)
  ok(p?.mask === 'full' && p?.maskVerified === true, `${card.cardId}: the whole card is the verified area`, `${p?.mask}/${p?.maskVerified}`)
  ok(p?.variant === 'special', `${card.cardId}: is a special printing`, String(p?.variant))
  const spec = foilMaskFor({ cardId: card.cardId, rarity: 'Radiant Rare' })
  ok(spec?.kind === 'full' && spec.verified === true, `${card.cardId}: the mask is the whole card, verified`)
  ok(holoFor({ cardId: card.cardId, rarity: 'Radiant Rare' })?.pattern === 'radiant-etched', `${card.cardId}: holoFor carries the pattern`)
  ok(!printingFor({ cardId: card.cardId, rarity: 'Radiant Rare', variant: 'reverseHolofoil' }), `${card.cardId}: a reverse token invents no printing`)
  ok(p?.pattern !== 'radiant', `${card.cardId}: is never painted with a Radiant Collection motif`)
}

// Radiant Collection keeps its own paper and its own lookup.
{
  const db = new Database('data/tcglife.db', { readonly: true })
  const rc = db.prepare("select id, name from cards where number like 'RC%' limit 5").all() as { id: string; name: string }[]
  db.close()
  ok(rc.length > 0, 'the catalogue holds Radiant Collection cards')
  for (const card of rc) {
    ok(printingFor({ cardId: card.id })?.pattern !== 'radiant-etched', `${card.id}: is not painted with the Radiant Pokémon sheet`)
    ok(holoFor({ cardId: card.id })?.pattern !== 'radiant-etched', `${card.id}: holoFor does not carry it either`)
  }
  ok(PATTERNS.radiant.label === 'Radiant Collection', 'the RC pattern is still Radiant Collection')
  ok(PATTERNS.radiant.implemented === true, 'and still ships its per-card motifs')
}

ok(PATTERNS['radiant-etched'].implemented === true, 'the registry says Radiant Pokémon is painted')
ok(PATTERNS['radiant-etched'].texture === RADIANT_ETCHED_SHEET.pattern, 'the registry points at this sheet')
ok(fs.existsSync('public' + PATTERNS['radiant-etched'].texture!), 'the file it points at ships')

// ---------------------------------------------------------------------------
// 5. The render obeys the layer contract.
// ---------------------------------------------------------------------------
const W = 200
const H = 279
const base = new Uint8ClampedArray(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    base[i] = 38 + Math.round((x / W) * 120)
    base[i + 1] = 54 + Math.round((y / H) * 96)
    base[i + 2] = 88
    base[i + 3] = 255
  }
}

const target = RADIANT_ETCHED_CARDS[0]!.cardId
const spec = foilMaskFor({ cardId: target, rarity: 'Radiant Rare' })!
ok(!!spec, 'the render target has a mask')
const area = coverageFraction(spec)
ok(area > 0.9, 'the whole card is foiled', area.toFixed(4))

const out = new Uint8ClampedArray(W * H * 4)
paintFoil(out, base, W, H, spec, FACE_ON, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
let restDiff = 0
for (let i = 0; i < base.length; i++) if (out[i] !== base[i]) restDiff++
ok(restDiff === 0, 'at rest the composite is the scan byte for byte', `${restDiff} bytes differ`)

paintFoil(out, base, W, H, spec, { deg: 55, axis: 45 }, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
let outsideChanged = 0
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, W / H) !== 0) continue
    const i = (y * W + x) * 4
    if (out[i] !== base[i] || out[i + 1] !== base[i + 1] || out[i + 2] !== base[i + 2]) outsideChanged++
  }
}
ok(outsideChanged === 0, 'tilted light never lands outside the mask', `${outsideChanged} pixels`)
const lift = meanLift(base, out, W, H, spec)
ok(lift > 0.5, 'the etched paper lifts its face at 55°', lift.toFixed(2))

const modulate = patternModulatorFor(null, W / H, DEFAULT_FOIL_SETTINGS, field)
let modLo = 1
let modHi = 0
for (let v = 0.01; v < 1; v += 0.02) {
  for (let u = 0.01; u < 1; u += 0.02) {
    const m = modulate(u, v, 0)
    modLo = Math.min(modLo, m)
    modHi = Math.max(modHi, m)
  }
}
ok(modHi - modLo > 0.05, 'the lattice shapes the reflection across the card', `${modLo.toFixed(2)}–${modHi.toFixed(2)}`)
ok(modLo > 0.1, 'and never extinguishes it', modLo.toFixed(3))

// ---------------------------------------------------------------------------
// 6. The report exists, matches the database, and does not overclaim.
// ---------------------------------------------------------------------------
{
  const report = JSON.parse(fs.readFileSync('reports/radiant-etched-printings.json', 'utf8')) as {
    counts: {
      claimed: number
      painted: number
      maskVerified: number
      validated: number
      textureVerified: boolean
      reliefClaimed: boolean
      radiantCollectionCards: number
    }
    cards: unknown[]
    sheet: typeof RADIANT_ETCHED_SHEET
    problems: string[]
  }
  ok(report.counts.claimed === 15, 'the report covers all fifteen', String(report.counts.claimed))
  ok(report.counts.painted === 15, 'and all fifteen are painted', String(report.counts.painted))
  ok(report.counts.maskVerified === 15, 'the whole card is verified for every row', String(report.counts.maskVerified))
  ok(report.counts.validated === 15, 'and every row is render-validated', String(report.counts.validated))
  ok(report.counts.textureVerified === false, 'the report refuses to call the texture verified')
  ok(report.counts.reliefClaimed === false, 'and claims no relief')
  ok(report.counts.radiantCollectionCards > 0, 'the report counts the RC cards it did not touch')
  ok(report.cards.length === 15 && report.problems.length === 0, 'the report has no unresolved card')
  ok(report.sheet.pattern === RADIANT_ETCHED_SHEET.pattern, 'the report ships the registry’s sheet')
}

// The pattern must never be generated at render time.
for (const f of [
  'src/foil/radiant-etched-sheet.ts',
  'src/foil/radiant-etched.ts',
  'scripts/radiant-etched-foil.ts',
  'src/foil/radiant-etched-index.ts',
]) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
