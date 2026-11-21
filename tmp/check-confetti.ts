// Confetti: the sheet, the sampler, the printings and the render.
//
// Run: ./node_modules/.bin/tsx tmp/check-confetti.ts
//
// The checks are split the way the claims are:
//   - the GENERATOR is a drawing: axis-aligned flakes, a dark field between them, a
//     sheet that wraps, deterministic pixels, neutral colour;
//   - the PRINTING is documented: the 2026 and 2021 Classic Collections and the
//     McDonald's rows resolve to this paper, and a Scarlet & Violet card does not;
//   - the RENDER still obeys the layer contract: at rest it is the scan byte for byte,
//     at tilt it adds light only inside the mask.
//
// Read reports/confetti-printings.md first if a number here looks arbitrary.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  buildConfettiField,
  confettiBlocksFor,
  CONFETTI_CELL,
  CONFETTI_FLOOR,
  CONFETTI_MARK_LINE,
  CONFETTI_SHEET_SIZE,
  confettiSeamMismatch,
  renderConfettiSheet,
} from '../src/foil/confetti-sheet'
import {
  buildConfettiGrid,
  confettiCopyFor,
  confettiFieldFor,
  sampleConfetti,
  CONFETTI_TEXTURE_VERIFIED,
} from '../src/foil/confetti'
import { CONFETTI_CARDS, CONFETTI_CLAIM, CONFETTI_EXCEPTIONS, CONFETTI_MCD_CAVEAT, CONFETTI_SHEET } from '../src/foil/confetti-index'
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

console.log('Confetti — sheet, sampler, printings, render')

// ---------------------------------------------------------------------------
// 1. The generator draws blocky flakes over a dark field.
// ---------------------------------------------------------------------------
const blocks = confettiBlocksFor(3, 4)
ok(blocks.length >= 2 && blocks.length <= 3, 'a cell carries two or three flakes', String(blocks.length))
ok(blocks.every((b) => b.w >= 9 && b.w <= 28), 'flakes are small, as the source says')
ok(blocks.every((b) => b.h >= 7 && b.h <= 22), 'and short')
ok(blocks.every((b) => b.ink > 0.5 && b.ink <= 0.96), 'each flake is brighter than the field')

const sheet = renderConfettiSheet(CONFETTI_SHEET_SIZE)
ok(sheet.size === 1024, 'the sheet is 1024px square')
ok(CONFETTI_SHEET_SIZE % CONFETTI_CELL === 0, 'the cell pitch divides the sheet exactly')
ok(sheet.floor <= 0.1, 'the bare field stays dark: this is a marked paper', sheet.floor.toFixed(3))
ok(Math.abs(sheet.floor - CONFETTI_FLOOR) < 1e-6, 'and the floor is the constant the sheet declares', sheet.floor.toFixed(3))
ok(sheet.peak >= 0.6, 'a flake body is bright', sheet.peak.toFixed(3))
ok(sheet.peak / sheet.floor >= 4, 'contrast makes a flake read as a mark', (sheet.peak / sheet.floor).toFixed(1))
ok(sheet.coverage > 0.04 && sheet.coverage < 0.45, 'the flakes cover enough to read and not enough to bury the art', `${(sheet.coverage * 100).toFixed(2)}%`)

// A flake is a filled RECTANGLE: its interior holds the block's own ink, and the pixel
// just outside it falls back to the field. That is what separates this paper from a
// dot, star or stripe texture.
{
  const b = blocks[0]!
  const field = buildConfettiField(CONFETTI_SHEET_SIZE)
  const cx = Math.round(b.x + b.w / 2)
  const cy = Math.round(b.y + b.h / 2)
  const inside = field[cy * CONFETTI_SHEET_SIZE + cx]
  const outside = field[(cy + Math.round(b.h / 2) + 3) * CONFETTI_SHEET_SIZE + cx]
  ok(inside > 0.5, 'a flake interior is a mark', inside.toFixed(3))
  ok(outside <= CONFETTI_FLOOR + 1e-6, 'and the field just beyond it is bare', outside.toFixed(3))
  let flat = 0
  let samples = 0
  for (let dy = 0; dy < Math.max(1, Math.round(b.h) - 4); dy++) {
    for (let dx = 0; dx < Math.max(1, Math.round(b.w) - 4); dx++) {
      samples++
      const v = field[(Math.round(b.y) + dy + 2) * CONFETTI_SHEET_SIZE + Math.round(b.x) + dx + 2]
      if (Math.abs(v - b.ink) < 0.02) flat++
    }
  }
  ok(samples > 0 && flat / samples > 0.8, 'the interior is flat, not a gradient: a block, not a blob', `${flat}/${samples}`)
}

const seam = confettiSeamMismatch(sheet.rgba, sheet.size)
ok(seam < 0.02, 'the sheet wraps, so a card may sample any window', `${(seam * 100).toFixed(2)}%`)

const again = renderConfettiSheet(CONFETTI_SHEET_SIZE)
let identical = again.rgba.length === sheet.rgba.length
for (let i = 0; identical && i < sheet.rgba.length; i++) if (again.rgba[i] !== sheet.rgba[i]) identical = false
ok(identical, 'the same inputs render byte-identical pixels (the pattern cannot move between frames)')

let neutral = true
for (let i = 0; i < sheet.rgba.length; i += 4) {
  if (sheet.rgba[i] !== 255 || sheet.rgba[i + 1] !== 255 || sheet.rgba[i + 2] !== 255) {
    neutral = false
    break
  }
}
ok(neutral, 'the sheet carries luminance only, never colour')

const small = renderConfettiSheet(256)
ok(small.floor <= 0.1 && small.coverage > 0.02, 'a smaller sheet keeps the same shape', small.floor.toFixed(3))

// ---------------------------------------------------------------------------
// 2. The shipped asset and the generated index agree with a fresh render.
// ---------------------------------------------------------------------------
const png = fs.readFileSync('public/foil/confetti/sheet.png')
ok(png.length > 10_000, 'the sheet is shipped and not a stub', `${png.length} bytes`)
ok(png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, 'the sheet is a PNG')
ok(png.readUInt32BE(16) === 1024 && png.readUInt32BE(20) === 1024, 'the PNG is 1024x1024')
ok(Math.abs(CONFETTI_SHEET.floor - sheet.floor) < 1e-4, 'the index floor matches the render')
ok(Math.abs(CONFETTI_SHEET.peak - sheet.peak) < 1e-4, 'the index peak matches the render')
ok(Math.abs(CONFETTI_SHEET.coverage - sheet.coverage) < 1e-4, 'the index coverage matches the render')
ok(Math.abs(CONFETTI_SHEET.seamMismatch - seam) < 1e-3, 'the index records the measured wrap step')
ok(CONFETTI_SHEET.concept === true && CONFETTI_SHEET.textureVerified === false, 'the index declares the sheet a reconstruction')
ok(CONFETTI_SHEET.cell === CONFETTI_CELL, 'the index records the cell pitch')
ok(CONFETTI_TEXTURE_VERIFIED === false, 'the sampler exposes no verified-texture claim')
ok(CONFETTI_CLAIM.includes('small, blocky reflective shapes'), 'the claim quotes the source, not a paraphrase')
ok(/McDonald/.test(CONFETTI_MCD_CAVEAT) && /Non Holofoil/.test(CONFETTI_MCD_CAVEAT), 'the index records the McDonald’s limitation')

const grid = buildConfettiGrid(sheet.size, sheet.size, sheet.rgba)
{
  let lo = 1
  let hi = 0
  let marked = 0
  for (let i = 0; i < grid.mark.length; i++) {
    lo = Math.min(lo, grid.mark[i])
    hi = Math.max(hi, grid.mark[i])
    if (grid.mark[i] >= CONFETTI_MARK_LINE) marked++
  }
  ok(lo <= 0.1, 'the grid keeps the dark field', lo.toFixed(3))
  ok(hi >= 0.6, 'and the bright flakes', hi.toFixed(3))
  ok(hi - lo > 0.5, 'the field varies across the sheet', `${lo.toFixed(2)}–${hi.toFixed(2)}`)
  const frac = marked / grid.mark.length
  ok(Math.abs(frac - sheet.coverage) < 0.05, 'the grid keeps the sheet’s coverage through the downsample', `${(frac * 100).toFixed(2)}%`)
}

// ---------------------------------------------------------------------------
// 3. Per-card cuts: stable between frames, different between cards, wrapping.
// ---------------------------------------------------------------------------
const c1 = confettiCopyFor('me55c-4')
const c1b = confettiCopyFor('me55c-4')
const c2 = confettiCopyFor('me55c-33')
ok(c1.seed === c1b.seed && c1.offsetU === c1b.offsetU && c1.offsetV === c1b.offsetV, 'a card keeps its cut between frames')
ok(c1.offsetU !== c2.offsetU || c1.offsetV !== c2.offsetV, 'two cards sit at different cuts')

const s1 = sampleConfetti(c1, grid, 0.31, 0.42)
ok(s1.mark === sampleConfetti(c1, grid, 0.31, 0.42).mark, 'sampling is stable for a fixed point')
const wrappedU = sampleConfetti({ ...c1, offsetU: c1.offsetU + 1 }, grid, 0.31, 0.42).mark
const wrappedV = sampleConfetti({ ...c1, offsetV: c1.offsetV + 1 }, grid, 0.31, 0.42).mark
ok(Math.abs(wrappedU - s1.mark) < 1e-9 && Math.abs(wrappedV - s1.mark) < 1e-9, 'the sampler wraps instead of clamping at the sheet edge')

const field = confettiFieldFor('me55c-4', grid)
ok(field.verified === false, 'the field carries no verified-texture claim')
ok(field.plain !== true, 'confetti is not a plain field')
ok(String(field.meta.reproduction) === 'procedural reconstruction', 'the field names its reproduction as procedural')
ok(/wrap/i.test(String(field.meta.tiling)), 'the field discloses how the sheet wraps', String(field.meta.tiling))

let fieldLo = 1
let fieldHi = 0
for (let v = 0.01; v < 1; v += 0.01) {
  for (let u = 0.01; u < 1; u += 0.01) {
    const m = field.mark(u, v)
    fieldLo = Math.min(fieldLo, m)
    fieldHi = Math.max(fieldHi, m)
  }
}
ok(fieldHi - fieldLo > 0.2, 'the flakes vary across the card', `${fieldLo.toFixed(2)}–${fieldHi.toFixed(2)}`)
ok(fieldLo <= 0.1, 'and the field between them stays dark', fieldLo.toFixed(3))

// ---------------------------------------------------------------------------
// 4. The cards that wear it, and the ones that must not.
// ---------------------------------------------------------------------------
ok(CONFETTI_CARDS.length > 150, 'the generated table names the cards', String(CONFETTI_CARDS.length))
ok(new Set(CONFETTI_CARDS.map((c) => c.cardId)).size === CONFETTI_CARDS.length, 'no card is listed twice')
ok(CONFETTI_CARDS.some((c) => c.setId === 'me55c'), 'it includes the 2026 Classic Collection')
ok(CONFETTI_CARDS.some((c) => c.setId === 'cel25c'), 'and the Celebrations Classic Collection')
ok(CONFETTI_CARDS.filter((c) => c.setId === 'me55c').length === 30, 'all thirty 30th Celebration reprints', String(CONFETTI_CARDS.filter((c) => c.setId === 'me55c').length))

const exceptionIds = new Set(CONFETTI_EXCEPTIONS.map((e) => e.cardId))
ok(exceptionIds.size === 1 && exceptionIds.has('cel25c-66_A'), 'exactly one card keeps its own claim instead of the set rule')

for (const card of CONFETTI_CARDS.filter((c) => c.setId === 'me55c' || c.setId === 'cel25c')) {
  const art = holoFor({ cardId: card.cardId })
  if (exceptionIds.has(card.cardId)) {
    // Shining Magikarp's Celebrations reprint has its own sourced finish; the per-card
    // claim outranks the subset's paper, and its paper is unnamed, so it draws plain.
    ok(art?.style !== 'confetti' && art?.pattern !== 'confetti', `${card.cardId}: keeps its own claim, not the subset paper`, art?.style ?? 'nothing')
    continue
  }
  ok(art?.pattern === 'confetti' || art?.style === 'confetti', `${card.cardId}: resolves to confetti`, art?.style ?? 'nothing')
}

// The 2026 rows answer through the printing database, not only the style rule.
{
  const p = printingFor({ cardId: 'me55c-106', rarity: 'Rare Secret', name: 'Shining Celebi' })
  ok(p?.pattern === 'confetti', 'Shining Celebi resolves to the confetti printing', p?.pattern ?? 'nothing')
  ok(p?.status === 'verified', 'at a verified status', p?.status)
  ok(p?.matchedRule === 'explicit', 'answered by its own claim', p?.matchedRule)
  ok(p?.maskVerified === false, 'with the foil area still unclaimed', String(p?.maskVerified))
}

// The McDonald's rows are the paper's other documented home.
{
  const art = holoFor({ cardId: 'mcd21-1' })
  ok(art?.style === 'confetti', 'a McDonald’s card resolves through the style rule', art?.style ?? 'nothing')
}

// A card from an unrelated modern set must not borrow it.
for (const [id, set] of [['sv8-2', 'Surging Sparks'], ['me6-1', 'Delta Reign'], ['me55-1', '30th Celebration']] as const) {
  const art = holoFor({ cardId: id })
  ok(art?.style !== 'confetti' && art?.pattern !== 'confetti', `${set} does not borrow the confetti paper`, art?.style ?? 'nothing')
  ok(art?.pattern !== 'confetti', `${id}: the pattern is not confetti either`)
}

ok(PATTERNS.confetti.implemented === true, 'the registry says confetti is painted')
ok(PATTERNS.confetti.texture === CONFETTI_SHEET.pattern, 'the registry points at this sheet')
ok(fs.existsSync('public' + PATTERNS.confetti.texture!), 'the file it points at ships')

// ---------------------------------------------------------------------------
// 5. The render obeys the layer contract.
// ---------------------------------------------------------------------------
const W = 200
const H = 279
const base = new Uint8ClampedArray(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    base[i] = 62 + Math.round((x / W) * 96)
    base[i + 1] = 88 + Math.round((y / H) * 64)
    base[i + 2] = 104
    base[i + 3] = 255
  }
}

const target = 'me55c-4'
const spec = foilMaskFor({ cardId: target, rarity: 'Rare Holo' })
ok(!!spec, 'the render target has a mask')
const area = coverageFraction(spec!)
ok(area > 0.2, 'the Classic Collection window is a real foil area', area.toFixed(3))

const out = new Uint8ClampedArray(W * H * 4)
paintFoil(out, base, W, H, spec!, FACE_ON, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
let restDiff = 0
for (let i = 0; i < base.length; i++) if (out[i] !== base[i]) restDiff++
ok(restDiff === 0, 'at rest the composite is the scan byte for byte', `${restDiff} bytes differ`)

paintFoil(out, base, W, H, spec!, { deg: 55, axis: 45 }, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
let outsideChanged = 0
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (maskValue(spec!, (x + 0.5) / W, (y + 0.5) / H, W / H) !== 0) continue
    const i = (y * W + x) * 4
    if (out[i] !== base[i] || out[i + 1] !== base[i + 1] || out[i + 2] !== base[i + 2]) outsideChanged++
  }
}
ok(outsideChanged === 0, 'tilted light never lands outside the mask', `${outsideChanged} pixels`)
const lift = meanLift(base, out, W, H, spec!)
ok(lift > 0.5, 'the paper lifts its face at 55°', lift.toFixed(2))

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
ok(modHi - modLo > 0.05, 'the flakes shape the reflection across the card', `${modLo.toFixed(2)}–${modHi.toFixed(2)}`)
ok(modLo > 0.1, 'and never extinguish it', modLo.toFixed(3))

// ---------------------------------------------------------------------------
// 6. The report exists, matches the database, and does not overclaim.
// ---------------------------------------------------------------------------
{
  const report = JSON.parse(fs.readFileSync('reports/confetti-printings.json', 'utf8')) as {
    counts: { claimed: number; painted: number; exceptions: number; textureVerified: boolean; reliefClaimed: boolean; classicCollection2026: number; mcdonalds: number }
    cards: unknown[]
    sheet: typeof CONFETTI_SHEET
    problems: string[]
  }
  ok(report.counts.claimed === CONFETTI_CARDS.length, 'the report covers every card the index names', `${report.counts.claimed} vs ${CONFETTI_CARDS.length}`)
  ok(report.counts.painted === CONFETTI_CARDS.length - CONFETTI_EXCEPTIONS.length, 'every row except the exception is painted')
  ok(report.counts.exceptions === CONFETTI_EXCEPTIONS.length, 'the report counts the exception')
  ok(report.counts.classicCollection2026 === 30, 'the 2026 subset is counted', String(report.counts.classicCollection2026))
  ok(report.counts.mcdonalds > 0, 'the McDonald’s rows are counted', String(report.counts.mcdonalds))
  ok(report.counts.textureVerified === false, 'the report refuses to call the texture verified')
  ok(report.counts.reliefClaimed === false, 'and claims no relief')
  ok(report.cards.length === CONFETTI_CARDS.length && report.problems.length === 0, 'the report has no unresolved card')
  ok(report.sheet.pattern === CONFETTI_SHEET.pattern, 'the report ships the registry’s sheet')
}

// The pattern must never be generated at render time.
for (const f of [
  'src/foil/confetti-sheet.ts',
  'src/foil/confetti.ts',
  'scripts/confetti-foil.ts',
  'src/foil/confetti-index.ts',
]) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
