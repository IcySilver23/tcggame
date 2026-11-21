// Phase 23: the Crosshatch sheet, its sampler, the Victory Cup rule, and the render.
//
// The checks are split the way the claims are:
//   - the GENERATOR is a drawing: two line families that cross into a grid, a dark
//     field between them, deterministic, and a repeat that is measured;
//   - the PRINTING is documented: three BW Victory Cup promos resolve to crosshatch
//     with the body mask, the neighbouring papers keep theirs, and the row no source
//     lists makes no claim;
//   - the RENDER still obeys the layer contract: at rest it is the scan byte for
//     byte, at tilt it adds light only inside the mask, and a line over printed white
//     adds nothing.
//
// Run: ./node_modules/.bin/tsx tmp/check-crosshatch.ts

import fs from 'node:fs'
import {
  CROSSHATCH_PER_FAMILY,
  CROSSHATCH_PITCH,
  CROSSHATCH_SEED,
  CROSSHATCH_SHEET_SIZE,
  crosshatchBand,
  crosshatchInkAt,
  crosshatchProfile,
  crosshatchSeamMismatch,
  renderCrosshatchSheet,
} from '../src/foil/crosshatch-sheet'
import {
  buildCrosshatchGrid,
  crosshatchCopyFor,
  crosshatchFieldFor,
  sampleCrosshatch,
  CROSSHATCH_TEXTURE_VERIFIED,
} from '../src/foil/crosshatch'
import { CROSSHATCH_CARDS, CROSSHATCH_NEIGHBOURS, CROSSHATCH_SHEET } from '../src/foil/crosshatch-index'
import { surfaceFor } from '../src/foil/surface-textures'
import { coverageFraction, foilMaskFor, maskValue } from '../src/foil/mask'
import { holoFor } from '../src/holo'
import { nonHoloFor, printingFor } from '../src/foil/printing-db'
import { PATTERNS } from '../src/foil/patterns'
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

console.log('Crosshatch — sheet, sampler, printings, render')

// ---------------------------------------------------------------------------
// 1. The line profile and the lattice geometry.
// ---------------------------------------------------------------------------

ok(crosshatchProfile(0) === 1, 'a line is brightest at its centre')
ok(crosshatchProfile(0.55) === 0, 'ink stops well before the next line', String(crosshatchProfile(0.55)))
const shoulder = crosshatchProfile(0.2)
ok(shoulder > 0 && shoulder < 1, 'the shoulder is soft, not a hard edge', shoulder.toFixed(3))
const profile: number[] = []
for (let b = 0; b <= 1.0001; b += 0.05) profile.push(crosshatchProfile(b))
ok(profile.every((v, i) => i === 0 || v <= profile[i - 1] + 1e-9), 'ink falls monotonically away from the line')

ok(crosshatchBand(0) === 0, 'band 0 is a line centre')
ok(Math.abs(crosshatchBand(CROSSHATCH_PITCH / 2) - 1) < 1e-9, 'band 1 is the midpoint between lines')
ok(crosshatchBand(CROSSHATCH_PITCH) === 0, 'the lattice repeats every pitch')
ok(Math.abs(crosshatchBand(-CROSSHATCH_PITCH / 2) - 1) < 1e-9, 'and wraps through negative coordinates')

// ---------------------------------------------------------------------------
// 2. The generator draws two crossing families with a dark field between them.
// ---------------------------------------------------------------------------

const sheet = renderCrosshatchSheet(CROSSHATCH_SHEET_SIZE, CROSSHATCH_SEED)
ok(sheet.size === 1024, 'sheet is 1024px square')
ok(sheet.pitch === CROSSHATCH_PITCH && sheet.perFamily === CROSSHATCH_PER_FAMILY, 'the pitch divides the sheet exactly', `${sheet.perFamily} lines per family`)
ok(sheet.size % sheet.pitch === 0, 'no partial cell at the edge')
ok(sheet.coverage > 0.2 && sheet.coverage < 0.7, 'ink covers enough to read as a lattice without hiding the art', `${(sheet.coverage * 100).toFixed(2)}%`)
ok(sheet.peak > 0.9, 'a line core is bright', sheet.peak.toFixed(3))

const alphaAt = (x: number, y: number) => sheet.rgba[(y * sheet.size + x) * 4 + 3] / 255

// Two families: a point on a "+" line and a point on a "−" line are both bright,
// while a point off both is dark.
const onPlus = alphaAt(640, 384) // (x + y) = 1024 → multiple of 32
const onMinus = alphaAt(700, 380) // (x − y) = 320 → multiple of 32
ok(onPlus > 0.6, 'one family of lines is present', onPlus.toFixed(3))
ok(onMinus > 0.6, 'the other family is present', onMinus.toFixed(3))

let fieldSum = 0
let fieldN = 0
for (let y = 0; y < sheet.size; y += 7) {
  for (let x = 0; x < sheet.size; x += 7) {
    const sum = ((x + y) % sheet.pitch + sheet.pitch) % sheet.pitch
    const diff = ((x - y) % sheet.pitch + sheet.pitch) % sheet.pitch
    const nearA = Math.min(sum, sheet.pitch - sum)
    const nearB = Math.min(diff, sheet.pitch - diff)
    if (nearA < sheet.pitch / 4 || nearB < sheet.pitch / 4) continue
    fieldSum += alphaAt(x, y)
    fieldN++
  }
}
const fieldBetween = fieldN ? fieldSum / fieldN : 1
ok(fieldBetween < 0.12, 'the field between the lines is dark, so a line reads as a line', fieldBetween.toFixed(3))

const inksA = new Set(sheet.familyA.map((l) => l.ink.toFixed(3)))
const inksB = new Set(sheet.familyB.map((l) => l.ink.toFixed(3)))
ok(inksA.size >= 10 && inksB.size >= 10, 'lines differ from each other — a reflective weave, not a wire mesh', `${inksA.size}/${inksB.size}`)
ok(sheet.familyA[0].ink !== sheet.familyB[0].ink || sheet.familyA[3].ink !== sheet.familyB[3].ink, 'the two families are drawn independently')
const gaps = [...sheet.familyA, ...sheet.familyB].reduce((n, l) => n + l.gaps.length, 0)
ok(gaps > 0, 'some lines are broken, so the grid is not machined', `${gaps} breaks`)
const broken = [...sheet.familyA, ...sheet.familyB].find((l) => l.gaps.length > 0)!
ok(crosshatchInkAt(broken, broken.gaps[0].start, sheet.size) < broken.ink * 0.35, 'the middle of a break is dark')

const seam = crosshatchSeamMismatch(sheet.rgba, sheet.size)
// The lattice repeats every pitch and the sheet holds a whole number of cells, so
// the wrap joins phase-consistent columns; what is left is one pixel of gradient.
ok(seam < 0.06, 'the sheet tiles: the last column continues the first', `${(seam * 100).toFixed(2)}%`)

const again = renderCrosshatchSheet(CROSSHATCH_SHEET_SIZE, CROSSHATCH_SEED)
let identical = again.rgba.length === sheet.rgba.length
for (let i = 0; identical && i < sheet.rgba.length; i++) if (again.rgba[i] !== sheet.rgba[i]) identical = false
ok(identical, 'the same seed renders byte-identical pixels (the pattern cannot move between frames)')

// ---------------------------------------------------------------------------
// 3. The shipped asset and the generated index agree with a fresh render.
// ---------------------------------------------------------------------------

const png = fs.readFileSync('public/foil/crosshatch/sheet.png')
ok(png.length > 20_000, 'the sheet is shipped and not a stub', `${png.length} bytes`)
ok(png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, 'the sheet is a PNG')
ok(png.readUInt32BE(16) === 1024 && png.readUInt32BE(20) === 1024, 'the PNG is 1024x1024')
ok(Math.abs(CROSSHATCH_SHEET.coverage - sheet.coverage) < 1e-4, 'index coverage matches the render')
ok(Math.abs(CROSSHATCH_SHEET.peak - sheet.peak) < 1e-4, 'index peak matches the render')
ok(Math.abs(CROSSHATCH_SHEET.fieldBetween - fieldBetween) < 0.02, 'index records the measured field between the lines')
ok(Math.abs(CROSSHATCH_SHEET.wrapMismatch - seam) < 1e-3, 'index records the measured wrap step')
ok(CROSSHATCH_SHEET.tiles === true, 'the index says the sheet tiles')
ok(String(CROSSHATCH_SHEET.sampling).includes('wrapped'), 'and that a card samples it wrapped')
ok(CROSSHATCH_SHEET.concept === true && CROSSHATCH_SHEET.textureVerified === false, 'the index declares the sheet a reconstruction')
ok(CROSSHATCH_TEXTURE_VERIFIED === false, 'the sampler exposes no verified-texture claim')

const grid = buildCrosshatchGrid(sheet.size, sheet.size, sheet.rgba)
ok(grid.coverage > 0.2 && grid.coverage < 0.75, 'the sampling grid keeps the lattice', grid.coverage.toFixed(3))
ok(grid.peak > 0.85, 'the grid has a bright line core', grid.peak.toFixed(3))
let gridMin = 1
for (let i = 0; i < grid.mark.length; i++) gridMin = Math.min(gridMin, grid.mark[i])
ok(gridMin < 0.15, 'and a dark field between lines', gridMin.toFixed(3))

// ---------------------------------------------------------------------------
// 4. Per-card crops: bounded, stable, different between cards, never off-sheet.
// ---------------------------------------------------------------------------

const c1 = crosshatchCopyFor('bwp-BW29')
const c1b = crosshatchCopyFor('bwp-BW29')
const c2 = crosshatchCopyFor('bwp-BW30')
ok(c1.seed === c1b.seed && c1.offsetU === c1b.offsetU && c1.offsetV === c1b.offsetV, 'a card keeps its crop between frames')
ok(c1.offsetU !== c2.offsetU || c1.offsetV !== c2.offsetV || c1.zoom !== c2.zoom, 'two cards sit at different crops')
ok(c1.zoom >= 0.98 && c1.zoom <= 1.06, 'the crop zooms only slightly')
ok(c1.offsetU >= 0 && c1.offsetU < 1 && c1.offsetV >= 0 && c1.offsetV < 1, 'the phase sits inside one tile')

const s1 = sampleCrosshatch(c1, grid, 0.31, 0.42)
ok(s1.mark === sampleCrosshatch(c1, grid, 0.31, 0.42).mark, 'sampling is stable for a fixed point')
ok(s1.mark >= 0 && s1.mark <= 1, 'a mark is a 0..1 fraction', String(s1.mark))

// One full sheet of offset is the same phase, which is what "the read wraps" means.
const wrappedU = sampleCrosshatch({ ...c1, offsetU: c1.offsetU + 1 }, grid, 0.31, 0.42).mark
const wrappedV = sampleCrosshatch({ ...c1, offsetV: c1.offsetV + 1 }, grid, 0.31, 0.42).mark
ok(
  Math.abs(wrappedU - s1.mark) < 1e-9 && Math.abs(wrappedV - s1.mark) < 1e-9,
  'the sampler wraps instead of clamping at the sheet edge',
  `${wrappedU.toFixed(6)} / ${wrappedV.toFixed(6)} vs ${s1.mark.toFixed(6)}`,
)

let cardDiff = 0
for (let i = 0; i < 60; i++) {
  const u = (i * 0.7919) % 1
  const v = (i * 0.3779) % 1
  cardDiff = Math.max(cardDiff, Math.abs(sampleCrosshatch(c1, grid, u, v).mark - sampleCrosshatch(c2, grid, u, v).mark))
}
ok(cardDiff > 0.1, 'different cards sample different ink at the same card point', cardDiff.toFixed(3))

const field = crosshatchFieldFor('bwp-BW29', grid)
ok(field.verified === false, 'the field carries no verified-texture claim')
ok(String(field.meta.reproduction) === 'procedural reconstruction', 'the field names its reproduction as procedural')
ok(String(field.meta.tiling).includes('tiling measured'), 'the field discloses that the repeat is measured')
let fMin = 1
let fMax = 0
for (let v = 0.01; v < 1; v += 0.01) {
  for (let u = 0.01; u < 1; u += 0.01) {
    const m = field.mark(u, v)
    fMin = Math.min(fMin, m)
    fMax = Math.max(fMax, m)
  }
}
ok(fMin < 0.15 && fMax > 0.7, 'the card’s field spans a dark field and bright lines', `${fMin.toFixed(2)}–${fMax.toFixed(2)}`)

// ---------------------------------------------------------------------------
// 5. The three Victory Cup promos, and the cases that must not match.
// ---------------------------------------------------------------------------

ok(CROSSHATCH_CARDS.length === 3, 'the table names three Crosshatch BW promos', String(CROSSHATCH_CARDS.length))
for (const card of CROSSHATCH_CARDS) {
  const p = printingFor({ cardId: card.cardId, rarity: 'Promo' })
  ok(p?.pattern === 'crosshatch', `${card.cardId}: resolves to crosshatch`, p?.pattern ?? 'nothing')
  ok(p?.status === 'verified', `${card.cardId}: the identification is verified`, p?.status)
  ok(p?.matchedRule === 'explicit', `${card.cardId}: answered by the card’s own row`, p?.matchedRule)
  ok(p?.mask === card.mask, `${card.cardId}: foiled on the body`, `${p?.mask}`)
  ok(p?.maskVerified === false, `${card.cardId}: the foil area is not claimed`, String(p?.maskVerified))
  ok(!printingFor({ cardId: card.cardId, rarity: 'Promo', variant: 'reverseHolofoil' }), `${card.cardId}: invents no reverse printing`)
  ok(!nonHoloFor({ cardId: card.cardId, rarity: 'Promo' }), `${card.cardId}: invents no non-holo printing`)
  ok(holoFor({ cardId: card.cardId, rarity: 'Promo' })?.pattern === 'crosshatch', `${card.cardId}: holoFor carries the pattern`)
}

const spec = foilMaskFor({ cardId: CROSSHATCH_CARDS[0].cardId, rarity: 'Promo' })!
ok(spec.kind === 'outsideArt', 'the mask kind is the body with a matte window', spec.kind)
ok(maskValue(spec, 0.5, 0.3, 200 / 279) === 0, 'the illustration window stays matte')
ok(maskValue(spec, 0.5, 0.92, 200 / 279) === 255, 'the text box carries the lattice')
ok(coverageFraction(spec) > 0.5, 'which is most of the card', coverageFraction(spec).toFixed(3))

// Neighbouring papers keep theirs.
for (const cardId of CROSSHATCH_NEIGHBOURS.textured) {
  const p = printingFor({ cardId, rarity: 'Promo' })
  ok(p?.pattern === 'textured-full-art', `${cardId}: stays textured`, p?.pattern ?? 'nothing')
  ok(
    surfaceFor({ cardId, rarity: 'Promo' }) === 'etched-deep',
    `${cardId}: is painted as relief rather than with a mark sheet`,
  )
  ok(PATTERNS['textured-full-art'].implemented === true, `${cardId}: and the registry says so`)
}
for (const cardId of CROSSHATCH_NEIGHBOURS.unlisted) {
  ok(printingFor({ cardId, rarity: 'Promo' }) === null, `${cardId}: a row no source lists makes no claim`)
}
ok(printingFor({ cardId: 'bwp-BW45', rarity: 'Promo' })?.pattern === 'mirror', 'a Mirror promo keeps its own paper')

ok(PATTERNS.crosshatch.implemented === true, 'the registry says Crosshatch is painted')
ok(fs.existsSync('public' + PATTERNS.crosshatch.texture!), 'the registry points at a shipped file', PATTERNS.crosshatch.texture)

// ---------------------------------------------------------------------------
// 6. The render obeys the layer contract.
// ---------------------------------------------------------------------------

const W = 200
const H = 279
const base = new Uint8ClampedArray(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    base[i] = 42 + Math.round((x / W) * 110)
    base[i + 1] = 58 + Math.round((y / H) * 90)
    base[i + 2] = 96
    base[i + 3] = 255
  }
}

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
ok(lift > 0.5, 'the lattice lifts the body at 55°', lift.toFixed(2))

// A line over printed white adds nothing, so a bright printed decoration cannot gain
// a second copy of itself.
const modulate = patternModulatorFor(null, W / H, DEFAULT_FOIL_SETTINGS, field)
let coreU = 0
let coreV = 0
let bestMark = 0
for (let v = 0.02; v < 0.98; v += 0.011) {
  for (let u = 0.02; u < 0.98; u += 0.011) {
    const m = field.mark(u, v)
    if (m > bestMark) {
      bestMark = m
      coreU = u
      coreV = v
    }
  }
}
ok(bestMark > 0.5, 'a line core exists inside the card', bestMark.toFixed(3))
ok(modulate(coreU, coreV, 1) < 1e-6, 'a line over pure white adds no light', modulate(coreU, coreV, 1).toFixed(6))
ok(modulate(coreU, coreV, 0) > 0.2, 'and over dark print it shapes the reflection', modulate(coreU, coreV, 0).toFixed(3))

// ---------------------------------------------------------------------------
// 7. The report exists, matches the database, and does not overclaim.
// ---------------------------------------------------------------------------

const report = JSON.parse(fs.readFileSync('reports/crosshatch-printings.json', 'utf8')) as {
  counts: {
    claimed: number
    painted: number
    maskOutsideArt: number
    maskVerified: number
    validated: number
    textureVerified: boolean
    tiles: boolean
    neighboursTextured: number
    unlisted: number
  }
  sheet: typeof CROSSHATCH_SHEET
  cards: unknown[]
  problems: string[]
}
ok(report.counts.claimed === 3, 'the report covers all three claims', String(report.counts.claimed))
ok(report.counts.painted === 3, 'and every one is painted', String(report.counts.painted))
ok(report.counts.maskOutsideArt === 3, 'all three foil the body', String(report.counts.maskOutsideArt))
ok(report.counts.maskVerified === 0, 'no foil area is claimed', String(report.counts.maskVerified))
ok(report.counts.textureVerified === false, 'the report refuses to call the texture verified')
ok(report.counts.tiles === true, 'the report states the sheet tiles')
ok(report.counts.validated === CROSSHATCH_CARDS.length, 'the report counts the render-validated cards')
ok(
  report.counts.neighboursTextured === CROSSHATCH_NEIGHBOURS.textured.length,
  'the neighbouring papers are counted, not hidden',
)
ok(report.counts.unlisted === CROSSHATCH_NEIGHBOURS.unlisted.length, 'and the unlisted row')
ok(report.cards.length === 3 && report.problems.length === 0, 'the report has no unresolved cards')
ok(report.sheet.pattern === CROSSHATCH_SHEET.pattern, 'the report ships the registry’s sheet')

// The pattern must never be generated at render time.
for (const f of [
  'src/foil/crosshatch-sheet.ts',
  'src/foil/crosshatch.ts',
  'scripts/crosshatch-foil.ts',
  'src/foil/crosshatch-index.ts',
]) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
