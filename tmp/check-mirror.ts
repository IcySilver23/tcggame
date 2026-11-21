// Phase 22: the Mirror / Sheen sheet, its sampler, the BW promo rule, and the render.
//
// The checks are split the way the claims are:
//   - the GENERATOR is a drawing: a smooth diagonal band, deterministic, never dark,
//     and tileable (measured, not asserted);
//   - the PRINTING is documented: nine BW Black Star Promos resolve to mirror with
//     the token each needs, the neighbouring treatments keep their own papers, and
//     the row no source lists makes no claim;
//   - the RENDER still obeys the layer contract: at rest it is the scan byte for
//     byte, at tilt it adds light only inside the mask, and a mirror is not mistaken
//     for a plain field.
//
// Run: ./node_modules/.bin/tsx tmp/check-mirror.ts

import fs from 'node:fs'
import {
  MIRROR_SHEET_SIZE,
  mirrorSeamMismatch,
  renderMirrorSheet,
} from '../src/foil/mirror-sheet'
import { MIRROR_FLOOR, MIRROR_PEAK, MIRROR_WAVES, mirrorSheenAt } from '../src/foil/mirror-sheen'
import {
  buildMirrorGrid,
  mirrorCopyFor,
  mirrorFieldFor,
  sampleMirror,
  MIRROR_TEXTURE_VERIFIED,
} from '../src/foil/mirror'
import { MIRROR_CARDS, MIRROR_NEIGHBOURS, MIRROR_SHEET } from '../src/foil/mirror-index'
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

console.log('Mirror — sheet, sampler, printings, render')

// ---------------------------------------------------------------------------
// 1. The generator draws a smooth diagonal band that never stops reflecting.
// ---------------------------------------------------------------------------

let lo = 1
let hi = 0
for (let i = 0; i < 2000; i++) {
  const v = mirrorSheenAt(i / 2000)
  lo = Math.min(lo, v)
  hi = Math.max(hi, v)
}
ok(lo >= MIRROR_FLOOR - 1e-9, 'the sheen never falls below the floor: a mirror keeps reflecting', lo.toFixed(3))
ok(hi <= MIRROR_PEAK + 1e-9, 'and never exceeds the peak', hi.toFixed(3))
ok(lo > 0.2, 'no point of the band is dark enough to read as a mark', lo.toFixed(3))
ok(hi - lo > 0.3, 'the band has enough contrast to read as a sheen', (hi - lo).toFixed(3))
ok(Math.abs(mirrorSheenAt(0.25) - mirrorSheenAt(1.25)) < 1e-9, 'the band wraps: a phase of one is the same phase')

const sheet = renderMirrorSheet(MIRROR_SHEET_SIZE)
ok(sheet.size === 1024, 'sheet is 1024px square')
ok(sheet.coverage === 1, 'every pixel carries ink — uniform foil, not marks', String(sheet.coverage))
ok(sheet.floor >= 0.25, 'the dimmest point still reflects', sheet.floor.toFixed(3))
ok(sheet.peak <= 0.96, 'the brightest point leaves the reflection some headroom', sheet.peak.toFixed(3))

const alphaAt = (x: number, y: number) => sheet.rgba[(y * sheet.size + x) * 4 + 3] / 255

// The defining property of a diagonal: ink is constant along (x − y) and varies
// along the other diagonal.
let diagonalMismatch = 0
let antiDiagonalSpread = 0
for (let i = 20; i < 900; i += 37) {
  diagonalMismatch = Math.max(diagonalMismatch, Math.abs(alphaAt(i, i - 7) - alphaAt(i + 1, i - 6)))
  antiDiagonalSpread = Math.max(antiDiagonalSpread, Math.abs(alphaAt(i, 400) - alphaAt(i + 200, 400)))
}
ok(diagonalMismatch < 1e-9, 'ink is constant along the diagonal the source names', diagonalMismatch.toFixed(9))
ok(antiDiagonalSpread > 0.1, 'and varies along it, so the sheet is not a flat fill', antiDiagonalSpread.toFixed(3))

const seam = mirrorSeamMismatch(sheet.rgba, sheet.size)
ok(seam < 0.02, 'the sheet wraps cleanly, so cards may sample any window', `${(seam * 100).toFixed(3)}%`)

const again = renderMirrorSheet(MIRROR_SHEET_SIZE)
let identical = again.rgba.length === sheet.rgba.length
for (let i = 0; identical && i < sheet.rgba.length; i++) if (again.rgba[i] !== sheet.rgba[i]) identical = false
ok(identical, 'the same seed renders byte-identical pixels (the field cannot move between frames)')

const small = renderMirrorSheet(256)
ok(small.coverage === 1 && small.floor >= 0.25, 'a smaller sheet keeps the same shape', small.floor.toFixed(3))

// ---------------------------------------------------------------------------
// 2. The shipped asset and the generated index agree with a fresh render.
// ---------------------------------------------------------------------------

const png = fs.readFileSync('public/foil/mirror/sheet.png')
ok(png.length > 20_000, 'the sheet is shipped and not a stub', `${png.length} bytes`)
ok(png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, 'the sheet is a PNG')
ok(png.readUInt32BE(16) === 1024 && png.readUInt32BE(20) === 1024, 'the PNG is 1024x1024')
ok(Math.abs(MIRROR_SHEET.floor - sheet.floor) < 1e-4, 'index floor matches the render')
ok(Math.abs(MIRROR_SHEET.peak - sheet.peak) < 1e-4, 'index peak matches the render')
ok(Math.abs(MIRROR_SHEET.seamMismatch - seam) < 1e-3, 'index records the measured wrap step')
ok(MIRROR_SHEET.concept === true && MIRROR_SHEET.textureVerified === false, 'the index declares the sheet a reconstruction')
ok(MIRROR_SHEET.direction.includes('bottom right'), 'the index records the international direction', MIRROR_SHEET.direction)
ok(MIRROR_TEXTURE_VERIFIED === false, 'the sampler exposes no verified-texture claim')

const grid = buildMirrorGrid(sheet.size, sheet.size, sheet.rgba)
ok(grid.coverage > 0.95, 'the sampling grid keeps the field uniform', grid.coverage.toFixed(3))
ok(grid.peak > 0.7 && grid.peak <= 0.96, 'the grid has a bright band', grid.peak.toFixed(3))
let gridFloor = 1
for (let i = 0; i < grid.mark.length; i++) gridFloor = Math.min(gridFloor, grid.mark[i])
ok(gridFloor >= 0.25, 'no cell of the grid is dark', gridFloor.toFixed(3))
let gridHi = 0
for (let i = 0; i < grid.mark.length; i++) gridHi = Math.max(gridHi, grid.mark[i])
ok(gridHi - gridFloor > 0.3, 'the grid varies along the diagonal', `${gridFloor.toFixed(2)}–${gridHi.toFixed(2)}`)

// ---------------------------------------------------------------------------
// 3. Per-card cuts: stable between frames, different between cards, wrapping.
// ---------------------------------------------------------------------------

const c1 = mirrorCopyFor('bwp-BW45')
const c1b = mirrorCopyFor('bwp-BW45')
const c2 = mirrorCopyFor('bwp-BW46')
ok(c1.seed === c1b.seed && c1.offsetU === c1b.offsetU && c1.offsetV === c1b.offsetV, 'a card keeps its cut between frames')
ok(c1.offsetU !== c2.offsetU || c1.offsetV !== c2.offsetV, 'two cards sit at different phases')

const s1 = sampleMirror(c1, grid, 0.31, 0.42)
ok(s1.mark === sampleMirror(c1, grid, 0.31, 0.42).mark, 'sampling is stable for a fixed point')
ok(s1.mark >= MIRROR_FLOOR - 0.05 && s1.mark <= 0.96, 'a mark is a bright 0..1 fraction', String(s1.mark))
// The sheen lives in the alpha channel, so opacity tracks the ink instead of sitting
// at 1 — but it never reaches 0, which is what separates this paper from a marked
// foil whose bare field is fully transparent.
ok(s1.opacity > 0.25, 'no point of the sheet is transparent: a mirror is uniform foil', s1.opacity.toFixed(3))
ok(Math.abs(s1.opacity - s1.mark) < 1e-6, 'opacity and ink are the same sheen value', `${s1.opacity.toFixed(4)} vs ${s1.mark.toFixed(4)}`)
const wrappedU = sampleMirror({ ...c1, offsetU: c1.offsetU + 1 }, grid, 0.31, 0.42).mark
const wrappedV = sampleMirror({ ...c1, offsetV: c1.offsetV + 1 }, grid, 0.31, 0.42).mark
ok(Math.abs(wrappedU - s1.mark) < 1e-9 && Math.abs(wrappedV - s1.mark) < 1e-9, 'the sampler wraps instead of clamping at the sheet edge')

let cardDiff = 0
for (let i = 0; i < 60; i++) {
  const u = (i * 0.7919) % 1
  const v = (i * 0.3779) % 1
  cardDiff = Math.max(cardDiff, Math.abs(sampleMirror(c1, grid, u, v).mark - sampleMirror(c2, grid, u, v).mark))
}
ok(cardDiff > 0.05, 'different cards sample different ink at the same card point', cardDiff.toFixed(3))

const field = mirrorFieldFor('bwp-BW45', grid)
ok(field.verified === false, 'the field carries no verified-texture claim')
ok(field.plain !== true, 'a mirror is not a plain field: it varies along its diagonal')
ok(String(field.meta.reproduction) === 'procedural reconstruction', 'the field names its reproduction as procedural')
ok(String(field.meta.direction).includes('bottom right'), 'the field records the direction it was drawn to')
ok(String(field.meta.tiling) === 'disclosed choice', 'the field discloses that tiling is this build’s choice')

let fieldLo = 1
let fieldHi = 0
for (let v = 0.01; v < 1; v += 0.01) {
  for (let u = 0.01; u < 1; u += 0.01) {
    const m = field.mark(u, v)
    fieldLo = Math.min(fieldLo, m)
    fieldHi = Math.max(fieldHi, m)
  }
}
ok(fieldLo >= 0.25, 'the card’s field never goes dark', fieldLo.toFixed(3))
ok(fieldHi - fieldLo > 0.3, 'and it varies across the card', `${fieldLo.toFixed(2)}–${fieldHi.toFixed(2)}`)

// ---------------------------------------------------------------------------
// 4. The nine BW promos, and the cases that must not match.
// ---------------------------------------------------------------------------

ok(MIRROR_CARDS.length === 9, 'the table names nine Mirror BW promos', String(MIRROR_CARDS.length))
ok(MIRROR_CARDS.filter((c) => c.reverse).length === 4, 'four of them exist only as reverse printings')
ok(new Set(MIRROR_CARDS.map((c) => c.cardId)).size === 9, 'no card is listed twice')

for (const card of MIRROR_CARDS) {
  const p = printingFor({ cardId: card.cardId, rarity: 'Promo' })
  ok(p?.pattern === 'mirror', `${card.cardId}: resolves to mirror`, p?.pattern ?? 'nothing')
  ok(p?.status === 'verified', `${card.cardId}: the identification is verified`, p?.status)
  ok(p?.matchedRule === 'explicit', `${card.cardId}: answered by the card’s own row`, p?.matchedRule)
  ok(p?.maskVerified === false, `${card.cardId}: the foil area is not claimed`, String(p?.maskVerified))
  const spec = foilMaskFor({ cardId: card.cardId, rarity: 'Promo' })
  ok(!!spec, `${card.cardId}: has a coverage mask`)
  if (card.reverse) {
    const withToken = printingFor({ cardId: card.cardId, rarity: 'Promo', variant: 'reverseHolofoil' })
    ok(withToken?.pattern === 'mirror', `${card.cardId}: a reverse token keeps the paper`, withToken?.pattern ?? 'nothing')
  } else {
    ok(!printingFor({ cardId: card.cardId, rarity: 'Promo', variant: 'reverseHolofoil' }), `${card.cardId}: invents no reverse printing`)
  }
  if (card.alsoOn.includes('non-holo')) {
    ok(!!nonHoloFor({ cardId: card.cardId, rarity: 'Promo' }), `${card.cardId}: the plain copy still answers through nonHoloFor`)
  }
  ok(holoFor({ cardId: card.cardId, rarity: 'Promo' })?.pattern === 'mirror', `${card.cardId}: holoFor carries the mirror pattern`)
}

// Neighbouring treatments keep their own papers.
for (const cardId of MIRROR_NEIGHBOURS.crosshatch) {
  const p = printingFor({ cardId, rarity: 'Promo' })
  ok(p?.pattern === 'crosshatch', `${cardId}: stays Crosshatch`, p?.pattern ?? 'nothing')
  ok(PATTERNS.crosshatch.implemented === true, `${cardId}: Crosshatch has its own sheet, so Mirror is never lent to it`)
}
for (const cardId of MIRROR_NEIGHBOURS.textured) {
  const p = printingFor({ cardId, rarity: 'Promo' })
  ok(p?.pattern === 'textured-full-art', `${cardId}: stays textured`, p?.pattern ?? 'nothing')
  ok(
    surfaceFor({ cardId, rarity: 'Promo' }) === 'etched-deep',
    `${cardId}: is painted as relief rather than with a mark sheet`,
  )
}
for (const cardId of MIRROR_NEIGHBOURS.unlisted) {
  ok(printingFor({ cardId, rarity: 'Promo' }) === null, `${cardId}: a row no source lists makes no claim`)
  ok(holoFor({ cardId, rarity: 'Promo' }) === null, `${cardId}: and no pattern reaches the renderer`)
}

ok(PATTERNS.mirror.implemented === true, 'the registry says Mirror is painted')
ok(fs.existsSync('public' + PATTERNS.mirror.texture!), 'the registry points at a shipped file', PATTERNS.mirror.texture)

// ---------------------------------------------------------------------------
// 5. The render obeys the layer contract.
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

const target = MIRROR_CARDS.find((c) => !c.reverse)!.cardId
const spec = foilMaskFor({ cardId: target, rarity: 'Promo' })!
ok(!!spec, 'the render target has a mask')
const area = coverageFraction(spec)
ok(area > 0.3 && area < 0.9, 'the mask covers a real part of the card', area.toFixed(4))

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
ok(lift > 0.5, 'the mirror lifts its window at 55°', lift.toFixed(2))

// The sheen must shape the light, and never extinguish it: a mirror has no bare
// field, so the modulator has a floor well above ALPHA_FLOOR.
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
ok(modHi - modLo > 0.1, 'the sheen shapes the reflection across the card', `${modLo.toFixed(2)}–${modHi.toFixed(2)}`)
ok(modLo > 0.4, 'and never dims the foil to a marked field’s bare floor', modLo.toFixed(3))

// ---------------------------------------------------------------------------
// 6. The report exists, matches the database, and does not overclaim.
// ---------------------------------------------------------------------------

const report = JSON.parse(fs.readFileSync('reports/mirror-printings.json', 'utf8')) as {
  counts: {
    claimed: number
    painted: number
    reverseOnly: number
    maskVerified: number
    validated: number
    textureVerified: boolean
    unpaintedCrosshatch: number
    neighboursTextured: number
    unlisted: number
  }
  sheet: typeof MIRROR_SHEET
  cards: unknown[]
  problems: string[]
}
ok(report.counts.claimed === 9, 'the report covers all nine claims', String(report.counts.claimed))
ok(report.counts.painted === 9, 'and every one is painted', String(report.counts.painted))
ok(report.counts.reverseOnly === 4, 'the reverse-only count matches the table', String(report.counts.reverseOnly))
ok(report.counts.maskVerified === 0, 'no foil area is claimed', String(report.counts.maskVerified))
ok(report.counts.textureVerified === false, 'the report refuses to call the texture verified')
ok(report.counts.validated === MIRROR_CARDS.length, 'the report counts the render-validated cards', String(report.counts.validated))
ok(
  report.counts.neighboursTextured === MIRROR_NEIGHBOURS.textured.length,
  'the neighbouring papers are counted, not hidden',
)
ok(report.counts.unlisted === MIRROR_NEIGHBOURS.unlisted.length, 'and the unlisted row')
ok(report.cards.length === 9 && report.problems.length === 0, 'the report has no unresolved cards')
ok(report.sheet.pattern === MIRROR_SHEET.pattern, 'the report ships the registry’s sheet')

// The pattern must never be generated at render time.
for (const f of [
  'src/foil/mirror-sheen.ts',
  'src/foil/mirror-sheet.ts',
  'src/foil/mirror.ts',
  'scripts/mirror-foil.ts',
  'src/foil/mirror-index.ts',
]) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
