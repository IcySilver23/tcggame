// Line: the sheet, the sampler, the printings and the render.
//
// Run: ./node_modules/.bin/tsx tmp/check-line.ts
//
// The checks are split the way the claims are:
//   - the GENERATOR is a drawing: thin VERTICAL ridges at an exact pitch, a foil that
//     never goes dark, a sheet that wraps, deterministic pixels, neutral colour;
//   - the PRINTING is a set-level identification: Sword & Shield through Crown Zenith
//     resolves to Line, and the neighbouring eras keep their own papers;
//   - the RENDER obeys the layer contract: at rest it is the scan byte for byte, at tilt
//     it adds light only inside the mask.
//
// Read reports/line-printings.md first if a number here looks arbitrary.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  lineDrift,
  lineInkAt,
  lineInternalStep,
  lineProfile,
  lineSeamMismatch,
  lineStripeFor,
  LINE_MARK_LINE,
  LINE_PITCH,
  LINE_SHEET_SIZE,
  LINE_VALLEY,
  renderLineSheet,
} from '../src/foil/line-sheet'
import {
  buildLineGrid,
  lineCopyFor,
  lineFieldFor,
  sampleLine,
  LINE_TEXTURE_VERIFIED,
} from '../src/foil/line'
import { LINE_CLAIM, LINE_LIMITATION, LINE_SHEET } from '../src/foil/line-index'
import { PATTERNS } from '../src/foil/patterns'
import { holoFor } from '../src/holo'
import { coverageFraction, foilMaskFor, maskValue } from '../src/foil/mask'
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

console.log('Line — sheet, sampler, printings, render')

// ---------------------------------------------------------------------------
// 1. The generator draws thin vertical ridges, not noise and not a dark marksheet.
// ---------------------------------------------------------------------------
ok(lineProfile(0) === 1, 'a ridge is brightest on its centre line')
ok(lineProfile(1) === 0, 'and falls to the valley midway between two ridges', lineProfile(1).toFixed(3))
ok(lineProfile(0.5) > 0.4 && lineProfile(0.5) < 0.6, 'the shoulder is a smooth cosine, not a hard edge', lineProfile(0.5).toFixed(3))

const sheet = renderLineSheet(LINE_SHEET_SIZE)
ok(sheet.size === 1024, 'the sheet is 1024px square')
ok(sheet.pitch === LINE_PITCH, 'the pitch is the one the index records', String(sheet.pitch))
ok(LINE_SHEET_SIZE % LINE_PITCH === 0, 'the pitch divides the sheet exactly')
ok(sheet.stripes === LINE_SHEET_SIZE / LINE_PITCH, 'so the stripe count is exact', String(sheet.stripes))
ok(sheet.floor >= 0.25, 'the valley stays bright: Line is a ruled foil, not a marked paper', sheet.floor.toFixed(3))
ok(Math.abs(sheet.floor - LINE_VALLEY) < 1e-6, 'and it is the declared valley', sheet.floor.toFixed(3))
ok(sheet.peak >= 0.75, 'a ridge is bright', sheet.peak.toFixed(3))
ok(sheet.peak / sheet.floor >= 1.6, 'ridge-to-valley contrast lets the stripes read', (sheet.peak / sheet.floor).toFixed(2))
ok(sheet.coverage > 0.35 && sheet.coverage < 0.9, 'the ridges cover enough to read without filling the card', `${(sheet.coverage * 100).toFixed(2)}%`)

// Orientation: a ROW must vary far more than a COLUMN, which is what makes these lines
// vertical. A horizontal-stripe sheet would fail this in the other direction.
{
  const at = (x: number, y: number) => sheet.rgba[(y * sheet.size + x) * 4 + 3] / 255
  let rowDiff = 0
  let rowN = 0
  let colDiff = 0
  let colN = 0
  for (let y = 11; y < 900; y += 31) {
    for (let x = 11; x < 900; x += 7) {
      rowDiff += Math.abs(at(x + 1, y) - at(x, y))
      rowN++
      colDiff += Math.abs(at(x, y + 1) - at(x, y))
      colN++
    }
  }
  const horizontal = rowDiff / rowN
  const vertical = colDiff / colN
  ok(horizontal > vertical * 5, 'the marks run vertically: a row varies far more than a column', `${horizontal.toFixed(4)} vs ${vertical.toFixed(4)}`)
  ok(vertical < 0.01, 'a column is smooth apart from the slow drift', vertical.toFixed(5))
}

// The field is a RULED GRID: a peak on every multiple of the pitch, the declared valley
// exactly midway between two of them. Each line has its own brightness, so the field does
// NOT repeat as a whole — the structure is what has to hold.
{
  let ruled = true
  for (const i of [0, 1, 7, 64, 127]) {
    const stripe = lineStripeFor(i)
    for (const y of [0, 137, 512, 901]) {
      const expected = Math.min(1, LINE_VALLEY + (stripe.ink * lineDrift(stripe, y, LINE_SHEET_SIZE) - LINE_VALLEY))
      if (Math.abs(lineInkAt(i * LINE_PITCH, y) - expected) > 1e-9) ruled = false
      if (Math.abs(lineInkAt(i * LINE_PITCH + LINE_PITCH / 2, y) - LINE_VALLEY) > 1e-9) ruled = false
    }
  }
  ok(ruled, 'the sheet is a ruled grid: a peak on every pitch mark, the valley between')
  ok(lineInkAt(0, 300) > LINE_VALLEY + 0.2, 'the left edge lands on a ridge, not a flank', lineInkAt(0, 300).toFixed(3))
  ok(Math.abs(lineInkAt(0, 300) - lineInkAt(1024, 300)) < 1e-9, 'and x = 1024 is the same ridge as x = 0')
}

// The drift travels down the sheet and is periodic in its height, so it can wrap.
{
  const stripe = lineStripeFor(5)
  ok(Math.abs(lineDrift(stripe, 0, 1024) - lineDrift(stripe, 1024, 1024)) < 1e-9, 'the top-to-bottom drift is periodic in the sheet height')
  const samples = [0, 128, 256, 384, 512, 640, 768, 896].map((y) => lineDrift(stripe, y, 1024))
  ok(Math.max(...samples) - Math.min(...samples) > 0.05, 'and it visibly changes a ridge down the sheet', `${Math.min(...samples).toFixed(3)}–${Math.max(...samples).toFixed(3)}`)
}

const seam = lineSeamMismatch(sheet.rgba, sheet.size)
const internal = lineInternalStep(sheet.rgba, sheet.size)
ok(seam <= internal + 0.01, 'the wrap step is no larger than one pixel of the ridge gradient', `${(seam * 100).toFixed(2)}% vs ${(internal * 100).toFixed(2)}%`)
ok(seam < 0.05, 'so the sheet is continuous at its own edges and a card may sample any window', `${(seam * 100).toFixed(2)}%`)

const again = renderLineSheet(LINE_SHEET_SIZE)
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

const small = renderLineSheet(256)
ok(small.pitch >= 2 && small.coverage > 0.3, 'a smaller sheet keeps the same shape', `pitch ${small.pitch}`)

// ---------------------------------------------------------------------------
// 2. The shipped asset and the generated index agree with a fresh render.
// ---------------------------------------------------------------------------
const png = fs.readFileSync('public/foil/line/sheet.png')
ok(png.length > 10_000, 'the sheet is shipped and not a stub', `${png.length} bytes`)
ok(png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, 'the sheet is a PNG')
ok(png.readUInt32BE(16) === 1024 && png.readUInt32BE(20) === 1024, 'the PNG is 1024x1024')
ok(Math.abs(LINE_SHEET.valley - sheet.floor) < 1e-4, 'the index valley matches the render')
ok(Math.abs(LINE_SHEET.peak - sheet.peak) < 1e-4, 'the index ridge matches the render')
ok(Math.abs(LINE_SHEET.coverage - sheet.coverage) < 1e-4, 'the index coverage matches the render')
ok(Math.abs(LINE_SHEET.seamMismatch - seam) < 1e-3, 'the index records the measured wrap step')
ok(LINE_SHEET.concept === true && LINE_SHEET.textureVerified === false, 'the index declares the sheet a reconstruction')
ok(LINE_SHEET.pitch === LINE_PITCH && LINE_SHEET.stripes === sheet.stripes, 'the index records the pitch and stripe count')
ok(LINE_TEXTURE_VERIFIED === false, 'the sampler exposes no verified-texture claim')
ok(LINE_CLAIM.includes('thin vertical lines'), 'the claim quotes the source, not a paraphrase')
ok(/pitch/.test(LINE_LIMITATION) && /not a count/i.test(LINE_LIMITATION), 'the index states what is this build’s choice')

const grid = buildLineGrid(sheet.size, sheet.size, sheet.rgba)
{
  let lo = 1
  let hi = 0
  for (let i = 0; i < grid.mark.length; i++) {
    lo = Math.min(lo, grid.mark[i])
    hi = Math.max(hi, grid.mark[i])
  }
  ok(lo >= 0.2, 'the grid keeps the bright valley: no cell goes dark', lo.toFixed(3))
  ok(hi - lo > 0.3, 'and the ridges survive the downsample', `${lo.toFixed(2)}–${hi.toFixed(2)}`)
  let marked = 0
  for (let i = 0; i < grid.mark.length; i++) if (grid.mark[i] >= LINE_MARK_LINE) marked++
  const frac = marked / grid.mark.length
  // Averaging a stripe field pulls flanks up past the mark line, so the downsampled
  // fraction can only rise; what must not happen is losing ridges.
  ok(frac >= sheet.coverage - 0.05 && frac <= 0.97, 'the downsample keeps the ridges', `${(frac * 100).toFixed(1)}% vs ${(sheet.coverage * 100).toFixed(1)}%`)
}

// ---------------------------------------------------------------------------
// 3. Per-card cuts: stable between frames, different between cards, wrapping.
// ---------------------------------------------------------------------------
const c1 = lineCopyFor('swsh1-1')
const c1b = lineCopyFor('swsh1-1')
const c2 = lineCopyFor('swsh1-2')
ok(c1.seed === c1b.seed && c1.offsetU === c1b.offsetU && c1.offsetV === c1b.offsetV, 'a card keeps its cut between frames')
ok(c1.offsetU !== c2.offsetU || c1.offsetV !== c2.offsetV, 'two cards sit at different cuts')

const s1 = sampleLine(c1, grid, 0.31, 0.42)
ok(s1.mark === sampleLine(c1, grid, 0.31, 0.42).mark, 'sampling is stable for a fixed point')
const wrappedU = sampleLine({ ...c1, offsetU: c1.offsetU + 1 }, grid, 0.31, 0.42).mark
const wrappedV = sampleLine({ ...c1, offsetV: c1.offsetV + 1 }, grid, 0.31, 0.42).mark
ok(Math.abs(wrappedU - s1.mark) < 1e-9 && Math.abs(wrappedV - s1.mark) < 1e-9, 'the sampler wraps instead of clamping at the sheet edge')

const field = lineFieldFor('swsh1-1', grid)
ok(field.verified === false, 'the field carries no verified-texture claim')
ok(field.plain !== true, 'Line is not a plain field')
ok(String(field.meta.reproduction) === 'procedural reconstruction', 'the field names its reproduction as procedural')
ok(String(field.meta.motif) === 'thin vertical ridges', 'the field names the motif')
ok(Number(field.meta.pitch) === LINE_PITCH, 'the field records the pitch')

{
  let lo = 1
  let hi = 0
  for (let u = 0.005; u < 1; u += 0.0025) {
    const m = field.mark(u, 0.5)
    lo = Math.min(lo, m)
    hi = Math.max(hi, m)
  }
  ok(hi - lo > 0.3, 'the ridges vary across the card', `${lo.toFixed(2)}–${hi.toFixed(2)}`)
  ok(lo >= 0.2, 'and the card never goes dark between them', lo.toFixed(3))
}

// ---------------------------------------------------------------------------
// 4. The cards that wear it, and the neighbouring eras that must not.
// ---------------------------------------------------------------------------
{
  const db = new Database('data/tcglife.db', { readonly: true })
  const pick = (where: string) =>
    db.prepare(`select id, set_id, rarity, name from cards where ${where} order by set_id limit 1`).get() as
      | { id: string; set_id: string; rarity: string | null; name: string }
      | undefined
  const swsh = pick("set_id like 'swsh%' and rarity = 'Rare Holo'")
  const pgo = pick("set_id = 'pgo' and rarity = 'Rare Holo'")
  const sv = pick("set_id like 'sv%' and rarity in ('Rare', 'Rare Holo')")
  const sm = pick("set_id like 'sm%' and rarity = 'Rare Holo'")
  db.close()

  ok(!!swsh, 'the catalogue holds a Sword & Shield holo rare')
  ok(!!pgo, 'and a Pokémon GO holo rare')
  ok(!!sv, 'and a Scarlet & Violet holo rare')
  ok(!!sm, 'and a Sun & Moon holo rare')

  if (swsh) {
    const art = holoFor({ cardId: swsh.id, rarity: swsh.rarity ?? undefined })
    ok(art?.style === 'line', `${swsh.id}: resolves to Line`, art?.style ?? 'nothing')
    ok(art?.pattern == null, `${swsh.id}: by the era rule, not a printing record`, String(art?.pattern))
    const rev = holoFor({ cardId: swsh.id, rarity: swsh.rarity ?? undefined, variant: 'reverseHolofoil' })
    ok(!!rev?.pattern?.startsWith('reverse-'), `${swsh.id}: a reverse printing keeps its own paper`, String(rev?.pattern))
    ok(rev?.pattern !== 'line', `${swsh.id}: the reverse paper is never Line`)
  }
  if (pgo) {
    ok(holoFor({ cardId: pgo.id, rarity: pgo.rarity ?? undefined })?.style === 'line', `${pgo.id}: Pokémon GO is Line`)
  }
  if (sv) {
    const art = holoFor({ cardId: sv.id, rarity: sv.rarity ?? undefined })
    if (art) ok(art.style === 'mirage', `${sv.id}: Scarlet & Violet keeps Mirage`, art.style)
    ok(art?.style !== 'line', `${sv.id}: and is never painted with Line`)
  }
  if (sm) {
    const art = holoFor({ cardId: sm.id, rarity: sm.rarity ?? undefined })
    ok(art?.style === 'waterweb', `${sm.id}: Sun & Moon keeps Water Web`, art?.style ?? 'nothing')
  }
}

ok(PATTERNS.line.implemented === true, 'the registry says Line is painted')
ok(PATTERNS.line.texture === LINE_SHEET.pattern, 'the registry points at this sheet')
ok(fs.existsSync('public' + PATTERNS.line.texture!), 'the file it points at ships')

// ---------------------------------------------------------------------------
// 5. The render obeys the layer contract.
// ---------------------------------------------------------------------------
const W = 200
const H = 279
const base = new Uint8ClampedArray(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    base[i] = 44 + Math.round((x / W) * 132)
    base[i + 1] = 58 + Math.round((y / H) * 88)
    base[i + 2] = 96
    base[i + 3] = 255
  }
}

const target = 'swsh1-1'
const spec = foilMaskFor({ cardId: target, rarity: 'Rare Holo' })
ok(!!spec, 'the render target has a mask')
const area = coverageFraction(spec!)
ok(area > 0.2 && area < 0.95, 'the illustration window is a real foil area', area.toFixed(3))

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
ok(modHi - modLo > 0.05, 'the ridges shape the reflection across the card', `${modLo.toFixed(2)}–${modHi.toFixed(2)}`)
ok(modLo > 0.1, 'and never extinguish it', modLo.toFixed(3))

// ---------------------------------------------------------------------------
// 6. The report exists, matches the routing, and does not overclaim.
// ---------------------------------------------------------------------------
{
  const report = JSON.parse(fs.readFileSync('reports/line-printings.json', 'utf8')) as {
    counts: { claimed: number; painted: number; sets: number; textureVerified: boolean; maskVerified: number }
    cards: unknown[]
    sheet: typeof LINE_SHEET
    problems: string[]
  }
  ok(report.counts.claimed > 450, 'the report covers the era', String(report.counts.claimed))
  ok(report.counts.painted === report.counts.claimed, 'and every row is painted')
  ok(report.counts.sets >= 15, 'across the Sword & Shield sets', String(report.counts.sets))
  ok(report.counts.textureVerified === false, 'the report refuses to call the texture verified')
  ok(
    report.counts.maskVerified > 0 && report.counts.maskVerified <= report.counts.claimed,
    'the foil area is the researched illustration window, counted separately from the texture',
    `${report.counts.maskVerified}/${report.counts.claimed}`,
  )
  ok(report.cards.length === report.counts.claimed && report.problems.length === 0, 'the report has no unresolved card')
  ok(report.sheet.pattern === LINE_SHEET.pattern, 'the report ships the registry’s sheet')
}

// The pattern must never be generated at render time.
for (const f of ['src/foil/line-sheet.ts', 'src/foil/line.ts', 'scripts/line-foil.ts', 'src/foil/line-index.ts']) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
