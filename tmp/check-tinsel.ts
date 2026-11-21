// Phase 21: the Tinsel sheet, its sampler, the Generation V printing rule, and the
// render.
//
// The checks are split the way the claims are:
//   - the GENERATOR is a drawing: horizontal lines of differing intensity, broken,
//     deterministic, and tileable (measured, not asserted);
//   - the PRINTING is documented: every Generation V holo rare resolves to tinsel
//     with the illustration window, and the rare cases that must not (a common, a
//     Rare Holo EX, a reverse printing, Black Bolt / White Flare) do not;
//   - the RENDER still obeys the layer contract: at rest it is the scan byte for
//     byte, at tilt it adds light only inside the mask, and a mark over printed
//     white adds nothing.
//
// Run: ./node_modules/.bin/tsx tmp/check-tinsel.ts

import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  renderTinselSheet,
  tinselProfile,
  tinselSeamMismatch,
  TINSEL_PERIOD,
  TINSEL_SEED,
  TINSEL_SHEET_SIZE,
  TINSEL_STRIPES,
} from '../src/foil/tinsel-sheet'
import { tinselInkAt } from '../src/foil/tinsel-lines'
import {
  buildTinselGrid,
  sampleTinsel,
  tinselCopyFor,
  tinselFieldFor,
  TINSEL_TEXTURE_VERIFIED,
} from '../src/foil/tinsel'
import { TINSEL_SHEET, TINSEL_SETS, TINSEL_SHOWCASE } from '../src/foil/tinsel-index'
import { coverageFraction, foilMaskFor, maskValue } from '../src/foil/mask'
import { holoFor } from '../src/holo'
import { printingFor } from '../src/foil/printing-db'
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

console.log('Tinsel — sheet, sampler, printings, render')

// ---------------------------------------------------------------------------
// 1. The generator draws horizontal stripes, not noise and not a ruled grid.
// ---------------------------------------------------------------------------

ok(tinselProfile(0) === 1, 'a line is brightest at its centre')
ok(tinselProfile(0.9) === 0, 'ink stops before the next line', String(tinselProfile(0.9)))
const shoulder = tinselProfile(0.38)
ok(shoulder > 0 && shoulder < 1, 'the shoulder is soft, not a hard edge', shoulder.toFixed(3))
const profile: number[] = []
for (let b = 0; b <= 1.0001; b += 0.05) profile.push(tinselProfile(b))
ok(profile.every((v, i) => i === 0 || v <= profile[i - 1] + 1e-9), 'ink falls monotonically away from the line')

const sheet = renderTinselSheet(TINSEL_SHEET_SIZE, TINSEL_SEED)
ok(sheet.size === 1024, 'sheet is 1024px square')
ok(sheet.period === TINSEL_PERIOD && sheet.stripes === TINSEL_STRIPES, 'the pitch divides the sheet exactly', `${sheet.stripes} lines`)
ok(sheet.coverage > 0.3 && sheet.coverage < 0.62, 'ink covers enough to read as banding without hiding the art', `${(sheet.coverage * 100).toFixed(2)}%`)
ok(sheet.peak > 0.85 && sheet.peak <= 1, 'a line core is bright', sheet.peak.toFixed(3))
ok(new Set(sheet.lines.map((l) => l.ink.toFixed(3))).size >= 30, 'lines differ from each other — tinsel, not a uniform grid')
const breaks = sheet.lines.reduce((n, l) => n + l.gaps.length, 0)
ok(breaks >= sheet.stripes, 'every line is broken somewhere', `${breaks} breaks`)

// Orientation: rows must vary far more than columns.
const rowMean: number[] = new Array(sheet.size).fill(0)
const colMean: number[] = new Array(sheet.size).fill(0)
for (let y = 0; y < sheet.size; y++) {
  for (let x = 0; x < sheet.size; x++) {
    const a = sheet.rgba[(y * sheet.size + x) * 4 + 3] / 255
    rowMean[y] += a / sheet.size
    colMean[x] += a / sheet.size
  }
}
const variance = (v: number[]) => {
  const m = v.reduce((s, x) => s + x, 0) / v.length
  return v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length
}
const rowVar = variance(rowMean)
const colVar = variance(colMean)
ok(rowVar > colVar * 10, 'the bands run horizontally: rows vary far more than columns', `${rowVar.toFixed(4)} vs ${colVar.toFixed(5)}`)

const seam = tinselSeamMismatch(sheet.rgba, sheet.size)
ok(seam < 0.06, 'the sheet wraps cleanly, so cards may sample any window', `${(seam * 100).toFixed(2)}%`)

// A break must actually cut its line.
const broken = sheet.lines.find((l) => l.gaps.length > 0)!
const gap = broken.gaps[0]
ok(tinselInkAt(broken, gap.start, sheet.size) < broken.ink * 0.35, 'the middle of a break is dark', tinselInkAt(broken, gap.start, sheet.size).toFixed(3))
ok(Math.abs(tinselInkAt(broken, 0, sheet.size) - tinselInkAt(broken, sheet.size, sheet.size)) < 1e-9, 'a line continues across the wrap')

const again = renderTinselSheet(TINSEL_SHEET_SIZE, TINSEL_SEED)
let identical = again.rgba.length === sheet.rgba.length
for (let i = 0; identical && i < sheet.rgba.length; i++) if (again.rgba[i] !== sheet.rgba[i]) identical = false
ok(identical, 'the same seed renders byte-identical pixels (the pattern cannot move between frames)')
// A small sheet keeps the same pitch RATIO, but its duty cycle drops because a
// 4px pitch quantises the shoulder away — the shipped 1024px sheet is what the
// coverage gate applies to, so this only proves the pitch scales with the size.
const other = renderTinselSheet(256, TINSEL_SEED + 1)
ok(other.stripes === TINSEL_STRIPES && other.coverage > 0.2, 'a smaller sheet keeps the same line count and still draws ink', other.coverage.toFixed(3))

// ---------------------------------------------------------------------------
// 2. The shipped asset and the generated index agree with a fresh render.
// ---------------------------------------------------------------------------

const png = fs.readFileSync('public/foil/tinsel/sheet.png')
ok(png.length > 20_000, 'the sheet is shipped and not a stub', `${png.length} bytes`)
ok(png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, 'the sheet is a PNG')
ok(png.readUInt32BE(16) === 1024 && png.readUInt32BE(20) === 1024, 'the PNG is 1024x1024')
ok(Math.abs(TINSEL_SHEET.coverage - sheet.coverage) < 1e-4, 'index coverage matches the render')
ok(Math.abs(TINSEL_SHEET.peak - sheet.peak) < 1e-4, 'index peak matches the render')
ok(Math.abs(TINSEL_SHEET.seamMismatch - seam) < 1e-3, 'index records the measured wrap step')
ok(TINSEL_SHEET.concept === true && TINSEL_SHEET.textureVerified === false, 'the index declares the sheet a reconstruction')
ok(TINSEL_TEXTURE_VERIFIED === false, 'the sampler exposes no verified-texture claim')

const grid = buildTinselGrid(sheet.size, sheet.size, sheet.rgba)
// The grid is a 320px box filter of a 1024px stripe field. Bleeding across a 16px
// pitch can only ADD ink to the cells between lines, so the grid's coverage must be
// at least the sheet's and not wildly above it. Equality would be the wrong claim.
ok(
  grid.coverage >= sheet.coverage - 0.02 && grid.coverage <= sheet.coverage * 1.5,
  'the grid bleeds ink between lines but stays in the sheet’s range',
  `${grid.coverage.toFixed(3)} vs ${sheet.coverage.toFixed(3)}`,
)
ok(grid.peak > 0.85, 'the sampling grid has a bright line core', grid.peak.toFixed(3))

// ---------------------------------------------------------------------------
// 3. Per-card cuts: stable between frames, different between cards, wrapping.
// ---------------------------------------------------------------------------

const c1 = tinselCopyFor('bw1-5')
const c1b = tinselCopyFor('bw1-5')
const c2 = tinselCopyFor('bw1-6')
ok(c1.seed === c1b.seed && c1.offsetU === c1b.offsetU && c1.offsetV === c1b.offsetV, 'a card keeps its cut between frames')
ok(c1.offsetU !== c2.offsetU || c1.offsetV !== c2.offsetV, 'two cards sit at different phases')
ok(c1.zoom >= 0.98 && c1.zoom <= 1.06, 'the cut zooms only slightly', c1.zoom.toFixed(3))

const s1 = sampleTinsel(c1, grid, 0.31, 0.42)
ok(s1.mark === sampleTinsel(c1, grid, 0.31, 0.42).mark, 'sampling is stable for a fixed point')
ok(s1.mark >= 0 && s1.mark <= 1, 'a mark is a 0..1 fraction', String(s1.mark))
// One full sheet of offset is the same phase, which is what "the read wraps"
// means. A clamping sampler would answer differently here.
const wrappedU = sampleTinsel({ ...c1, offsetU: c1.offsetU + 1 }, grid, 0.31, 0.42).mark
const wrappedV = sampleTinsel({ ...c1, offsetV: c1.offsetV + 1 }, grid, 0.31, 0.42).mark
ok(Math.abs(wrappedU - s1.mark) < 1e-9 && Math.abs(wrappedV - s1.mark) < 1e-9, 'the sampler wraps instead of clamping at the sheet edge', `${wrappedU.toFixed(6)} / ${wrappedV.toFixed(6)} vs ${s1.mark.toFixed(6)}`)
let maxDiff = 0
for (let i = 0; i < 40; i++) {
  const u = (i * 0.7919) % 1
  const v = (i * 0.3779) % 1
  maxDiff = Math.max(maxDiff, Math.abs(sampleTinsel(c1, grid, u, v).mark - sampleTinsel(c2, grid, u, v).mark))
}
ok(maxDiff > 0.05, 'different cards sample different ink at the same card point', maxDiff.toFixed(3))

const field = tinselFieldFor('bw1-5', grid)
ok(field.verified === false, 'the field carries no verified-texture claim')
ok(String(field.meta.reproduction) === 'procedural reconstruction', 'the field names its reproduction as procedural')
ok(String(field.meta.tiling) === 'disclosed choice', 'the field discloses that tiling is this build’s choice')

// ---------------------------------------------------------------------------
// 4. Per set: 152 Generation V holo rares, and the cases that must not match.
// ---------------------------------------------------------------------------

const EXPECTED: Record<string, number> = {
  bw1: 12, bw2: 10, bw3: 13, bw4: 10, bw5: 9, bw6: 13,
  bw7: 20, bw8: 10, bw9: 14, bw10: 11, bw11: 30,
}

const db = new Database('data/tcglife.db', { readonly: true })
for (const setId of TINSEL_SETS) {
  const rows = db
    .prepare("select id, rarity from cards where set_id = ? and rarity = 'Rare Holo'")
    .all(setId) as { id: string; rarity: string }[]
  ok(rows.length === EXPECTED[setId], `${setId}: ${EXPECTED[setId]} holo rares in the catalogue`, String(rows.length))
  const bad = rows.filter((r) => printingFor({ cardId: r.id, rarity: r.rarity })?.pattern !== 'tinsel')
  ok(bad.length === 0, `${setId}: every holo rare resolves to tinsel`, bad.map((r) => r.id).slice(0, 3).join(', '))
  const wrongMask = rows.filter((r) => foilMaskFor({ cardId: r.id, rarity: r.rarity })?.kind !== 'art')
  ok(wrongMask.length === 0, `${setId}: every holo rare uses the illustration window`, wrongMask.map((r) => r.id).slice(0, 3).join(', '))
  const wrongRule = rows.filter((r) => printingFor({ cardId: r.id, rarity: r.rarity })?.matchedRule !== 'era')
  ok(wrongRule.length === 0, `${setId}: the set rule answered, not an explicit exception`, wrongRule.map((r) => r.id).slice(0, 3).join(', '))
}
db.close()

ok(TINSEL_SETS.length === 11, 'only the documented Generation V sets are listed', String(TINSEL_SETS.length))
ok(TINSEL_SETS.join(',') === 'bw1,bw2,bw3,bw4,bw5,bw6,bw7,bw8,bw9,bw10,bw11', 'the list is Black & White through Legendary Treasures')

// Rare Holo EX is a different treatment: no Tinsel claim.
ok(printingFor({ cardId: 'bw11-25', rarity: 'Rare Holo EX' })?.pattern !== 'tinsel', 'Rare Holo EX is not painted as Tinsel')
// A plain rare/common in the same set makes no claim at all.
ok(printingFor({ cardId: 'bw1-1', rarity: 'Common' }) === null, 'a common makes no foil claim')
// A reverse printing of a holo rare is its own paper, never the striped sheet.
const rev = printingFor({ cardId: 'bw1-5', rarity: 'Rare Holo', variant: 'Reverse Holofoil' })
ok(!!rev && rev.pattern !== 'tinsel' && rev.pattern.startsWith('reverse-'), 'a reverse printing keeps the set’s reverse paper', rev?.pattern)
ok(holoFor({ cardId: 'bw1-5', rarity: 'Rare Holo' })?.pattern === 'tinsel', 'holoFor carries the tinsel pattern id')
ok(holoFor({ cardId: 'bw1-5', rarity: 'Rare Holo' })?.style === 'tinsel', 'with the tinsel style')

// The refused half: Black Bolt / White Flare make no claim (see TINSEL_RETURN_NOTE).
const bb = new Database('data/tcglife.db', { readonly: true })
const bbRows = bb
  .prepare("select id, rarity from cards where set_id in ('zsv10pt5','rsv10pt5') and rarity = 'Rare'")
  .all() as { id: string; rarity: string }[]
bb.close()
ok(bbRows.length > 0, 'Black Bolt / White Flare holo rares exist in the catalogue', String(bbRows.length))
ok(bbRows.every((r) => printingFor({ cardId: r.id, rarity: r.rarity })?.pattern !== 'tinsel'), 'none of them is painted as Tinsel while the sources disagree')

ok(PATTERNS.tinsel.implemented === true, 'the registry says Tinsel is painted')
ok(fs.existsSync('public' + PATTERNS.tinsel.texture!), 'the registry points at a shipped file', PATTERNS.tinsel.texture)

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

const spec = foilMaskFor({ cardId: 'bw1-5', rarity: 'Rare Holo' })!
ok(spec.kind === 'art' && spec.verified, 'the render target uses the illustration window')
const area = coverageFraction(spec)
ok(area > 0.36 && area < 0.39, 'the window is 37.5% of the card box', area.toFixed(4))

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
ok(lift > 0.5, 'the stripes lift the window at 55°', lift.toFixed(2))

// A mark over printed white adds nothing, so a white decoration in the art cannot
// gain a second copy of itself.
const modulate = patternModulatorFor(null, W / H, DEFAULT_FOIL_SETTINGS, field)
let coreU = 0
let coreV = 0
let bestMark = 0
for (let v = 0.02; v < 0.98; v += 0.011) {
  for (let u = 0.02; u < 0.98; u += 0.011) {
    const m = field.mark(u, v)
    if (m > bestMark) { bestMark = m; coreU = u; coreV = v }
  }
}
ok(bestMark > 0.5, 'a line core exists inside the card window', bestMark.toFixed(3))
ok(modulate(coreU, coreV, 1) < 1e-6, 'a mark over pure white adds no light', modulate(coreU, coreV, 1).toFixed(6))
ok(modulate(coreU, coreV, 0) > 0.2, 'and over dark print it shapes the reflection', modulate(coreU, coreV, 0).toFixed(3))

// ---------------------------------------------------------------------------
// 6. The report exists, matches the database, and does not overclaim.
// ---------------------------------------------------------------------------

const report = JSON.parse(fs.readFileSync('reports/tinsel-printings.json', 'utf8')) as {
  counts: { holoRares: number; identified: number; validated: number; maskVerified: number; textureVerified: boolean; blackBoltPainted: number }
  cards: unknown[]
  blackBolt: { claimedTinsel: boolean }[]
  problems: string[]
}
const totalRares = Object.values(EXPECTED).reduce((s, n) => s + n, 0)
ok(report.counts.holoRares === totalRares, 'the report covers every Generation V holo rare', String(report.counts.holoRares))
ok(report.counts.identified === totalRares, 'every one is identified')
ok(report.counts.maskVerified === totalRares, 'every one has a verified mask')
ok(report.counts.textureVerified === false, 'the report refuses to call the texture verified')
ok(report.counts.validated === TINSEL_SHOWCASE.length, 'the report counts exactly the render-validated cards')
ok(report.counts.blackBoltPainted === 0, 'the report records that no Black Bolt / White Flare row is painted')
ok(report.blackBolt.every((r) => !r.claimedTinsel), 'and the per-card rows agree')
ok(report.cards.length === totalRares && report.problems.length === 0, 'the report has no unresolved cards')
ok(TINSEL_SHOWCASE.length === 3, 'three representative cards are showcased')

// The pattern must never be generated at render time.
for (const f of ['src/foil/tinsel-sheet.ts', 'src/foil/tinsel-lines.ts', 'src/foil/tinsel.ts', 'scripts/tinsel-foil.ts']) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
