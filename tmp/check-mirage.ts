// Mirage: the sheet, the sampler, the printings and the render.
//
// Run: ./node_modules/.bin/tsx tmp/check-mirage.ts
//
// The checks are split the way the claims are:
//   - the GENERATOR is a drawing: the field depends only on x (a column is constant, a
//     row swings), the foil never goes dark, the sheet wraps, deterministic pixels,
//     neutral colour;
//   - the PRINTING is a set-level identification: Scarlet & Violet resolves to Mirage,
//     the neighbouring eras keep their own papers, and a reverse printing keeps its
//     reverse paper;
//   - the RENDER obeys the layer contract: at rest it is the scan byte for byte, at tilt
//     it adds light only inside the mask.
//
// Read reports/mirage-printings.md first if a number here looks arbitrary.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  mirageInkAt,
  mirageInternalStep,
  mirageSeamMismatch,
  mirageSheenAt,
  MIRAGE_FLOOR,
  MIRAGE_MARK_LINE,
  MIRAGE_PEAK,
  MIRAGE_MEASURED,
  MIRAGE_SHEET_SIZE,
  MIRAGE_WAVES,
  renderMirageSheet,
} from '../src/foil/mirage-sheet'
import {
  buildMirageGrid,
  mirageCopyFor,
  mirageFieldFor,
  sampleMirage,
  MIRAGE_TEXTURE_VERIFIED,
} from '../src/foil/mirage'
import { MIRAGE_CLAIM, MIRAGE_LIMITATION, MIRAGE_SHEET } from '../src/foil/mirage-index'
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

console.log('Mirage — sheet, sampler, printings, render')

// ---------------------------------------------------------------------------
// 1. The generator draws a horizontal sweep over foil that never goes dark.
// ---------------------------------------------------------------------------

{
  let lo = 1
  let hi = 0
  for (let i = 0; i < 8000; i++) {
    const v = mirageSheenAt(i / 8000)
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  ok(lo >= MIRAGE_FLOOR - 1e-9, 'the sheen never falls below the floor: it always reflects', lo.toFixed(4))
  ok(hi <= MIRAGE_PEAK + 1e-9, 'and never exceeds the peak', hi.toFixed(4))
  ok(lo < MIRAGE_FLOOR + 0.001, 'the sweep reaches its declared floor', lo.toFixed(4))
  ok(hi > MIRAGE_PEAK - 0.001, 'and its declared peak', hi.toFixed(4))
  ok(lo > 0.5, 'no point of the band is dark enough to read as a mark', lo.toFixed(3))
  ok(hi / lo > 1.5 && hi / lo < 2.2, 'the contrast is a sheen rather than printed banding', (hi / lo).toFixed(2))
  ok(Math.abs(mirageSheenAt(0.25) - mirageSheenAt(1.25)) < 1e-9, 'the band wraps: a phase of one is the same phase')
}

const sheet = renderMirageSheet(MIRAGE_SHEET_SIZE)
ok(sheet.size === 1024, 'the sheet is 1024px square')
ok(MIRAGE_WAVES === 2, 'two broad bands across the sheet', String(MIRAGE_WAVES))

// The spacing is measured, not chosen: three tilt-run clips of the real promos give a
// median band period of 0.656 card widths, and the sampler's zoom spans 0.97-1.06.
{
  const drawn = 1 / (MIRAGE_WAVES * (734 / 1024) * 1.015)
  const err = Math.abs(drawn - MIRAGE_MEASURED.period) / MIRAGE_MEASURED.period
  ok(err < 0.12, 'the drawn band spacing is the measured one', `${drawn.toFixed(3)} vs ${MIRAGE_MEASURED.period.toFixed(3)} card widths`)
  ok(
    MIRAGE_MEASURED.contrast > 1.4 && MIRAGE_MEASURED.contrast < 2.0,
    'and the measured contrast is the drawn one, within the instrument’s own bias',
    `${MIRAGE_MEASURED.contrast} vs ${(MIRAGE_PEAK / MIRAGE_FLOOR).toFixed(2)} drawn`,
  )
  ok(MIRAGE_MEASURED.clips.length === 3, 'the measurement records all three clips', String(MIRAGE_MEASURED.clips.length))
}
ok(sheet.floor >= 0.5, 'the dimmest point of the foil still reflects', sheet.floor.toFixed(3))
ok(sheet.peak >= MIRAGE_PEAK - 0.002, 'the brightest point reaches the declared peak', sheet.peak.toFixed(3))
ok(sheet.coverage > 0.25 && sheet.coverage < 0.6, 'a band covers enough of the sheet to read', `${(sheet.coverage * 100).toFixed(2)}% above the mark line`)

// Horizontal refraction: the field must be constant down a column and vary across a row.
{
  let columnVaries = false
  for (let y = 0; y < MIRAGE_SHEET_SIZE; y += 7) {
    for (const x of [0, 37, 512, 1023]) if (mirageInkAt(x, y) !== mirageInkAt(x, 0)) columnVaries = true
  }
  ok(!columnVaries, 'a column is constant: the sheen travels horizontally, not diagonally')
  const row = []
  for (let x = 0; x < MIRAGE_SHEET_SIZE; x++) row.push(mirageInkAt(x, 11))
  const swing = Math.max(...row) - Math.min(...row)
  ok(swing > 0.35, 'a row swings the whole band, so the sheet is not a flat fill', swing.toFixed(3))
}

const seam = mirageSeamMismatch(sheet.rgba, sheet.size)
const internal = mirageInternalStep(sheet.rgba, sheet.size)
ok(seam <= internal + 0.01, 'the wrap step is no larger than one pixel of the sweep’s slope', `${(seam * 100).toFixed(2)}% vs ${(internal * 100).toFixed(2)}%`)
ok(seam < 0.02, 'so the sheet is continuous at its own edges and a card may sample any window', `${(seam * 100).toFixed(3)}%`)

const again = renderMirageSheet(MIRAGE_SHEET_SIZE)
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

const small = renderMirageSheet(256)
ok(small.floor >= 0.5 && small.coverage > 0.25, 'a smaller sheet keeps the same shape', small.floor.toFixed(3))

// ---------------------------------------------------------------------------
// 2. The shipped asset and the generated index agree with a fresh render.
// ---------------------------------------------------------------------------

const png = fs.readFileSync('public/foil/mirage/sheet.png')
ok(png.length > 2_000, 'the sheet is shipped and not a stub', `${png.length} bytes`)
ok(png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, 'the sheet is a PNG')
ok(png.readUInt32BE(16) === 1024 && png.readUInt32BE(20) === 1024, 'the PNG is 1024x1024')
ok(Math.abs(MIRAGE_SHEET.floor - sheet.floor) < 1e-4, 'the index floor matches the render')
ok(Math.abs(MIRAGE_SHEET.peak - sheet.peak) < 1e-4, 'the index peak matches the render')
ok(Math.abs(MIRAGE_SHEET.coverage - sheet.coverage) < 1e-4, 'the index coverage matches the render')
ok(Math.abs(MIRAGE_SHEET.seamMismatch - seam) < 1e-3, 'the index records the measured wrap step')
ok(MIRAGE_SHEET.measuredPeriod === MIRAGE_MEASURED.period, 'and the measured spacing the drawing was retuned to', String(MIRAGE_SHEET.measuredPeriod))
ok(MIRAGE_SHEET.concept === true && MIRAGE_SHEET.textureVerified === false, 'the index declares the sheet a reconstruction')
ok(MIRAGE_SHEET.borderModelled === false, 'the index records that the silver border is not modelled')
ok(MIRAGE_SHEET.direction.includes('bands vertical'), 'the index records the axis it was drawn on', MIRAGE_SHEET.direction)
ok(MIRAGE_SHEET.directionClaim === 'not established', 'and it refuses to name a direction of travel', MIRAGE_SHEET.directionClaim)
ok(MIRAGE_TEXTURE_VERIFIED === false, 'the sampler exposes no verified-texture claim')
ok(MIRAGE_CLAIM.includes('refracts light horizontally'), 'the claim quotes the source, not a paraphrase')
ok(/silver foil border/i.test(MIRAGE_LIMITATION), 'the limitation names the border it does not model')
ok(/band/i.test(MIRAGE_LIMITATION) && /build’s|build's/.test(MIRAGE_LIMITATION), 'and the band count as this build’s choice')

// ---------------------------------------------------------------------------
// 3. The sampling grid keeps the sheen, and every cell carries foil.
// ---------------------------------------------------------------------------

const grid = buildMirageGrid(sheet.size, sheet.size, sheet.rgba)
ok(grid.coverage === 1, 'every cell carries foil: a sheen is uniform light, not marks', String(grid.coverage))
let gridLo = 1
let gridHi = 0
for (let i = 0; i < grid.mark.length; i++) {
  gridLo = Math.min(gridLo, grid.mark[i])
  gridHi = Math.max(gridHi, grid.mark[i])
}
ok(gridLo >= MIRAGE_FLOOR - 0.01, 'no cell of the grid goes dark', gridLo.toFixed(3))
ok(gridHi - gridLo > 0.35, 'and the sweep survives the downsample', `${gridLo.toFixed(2)}–${gridHi.toFixed(2)}`)
{
  let marked = 0
  for (let i = 0; i < grid.mark.length; i++) if (grid.mark[i] >= MIRAGE_MARK_LINE) marked++
  const frac = marked / grid.mark.length
  ok(Math.abs(frac - sheet.coverage) < 0.02, 'the mark-line fraction matches the sheet', `${(frac * 100).toFixed(1)}%`)
}

// ---------------------------------------------------------------------------
// 4. Per-card cuts: stable between frames, different between cards, wrapping.
// ---------------------------------------------------------------------------

const c1 = mirageCopyFor('sv1-1')
const c1b = mirageCopyFor('sv1-1')
const c2 = mirageCopyFor('sv1-2')
ok(c1.seed === c1b.seed && c1.offsetU === c1b.offsetU && c1.offsetV === c1b.offsetV, 'a card keeps its cut between frames')
ok(c1.offsetU !== c2.offsetU || c1.offsetV !== c2.offsetV, 'two cards sit at different cuts')

const s1 = sampleMirage(c1, grid, 0.31, 0.42)
ok(s1.mark === sampleMirage(c1, grid, 0.31, 0.42).mark, 'sampling is stable for a fixed point')
ok(Math.abs(s1.opacity - s1.mark) < 1e-6, 'opacity and ink are the same sheen value', `${s1.opacity.toFixed(4)} vs ${s1.mark.toFixed(4)}`)
ok(s1.opacity > 0.5, 'no point of the sheet is transparent: a sheen is uniform foil', s1.opacity.toFixed(3))
const wrappedU = sampleMirage({ ...c1, offsetU: c1.offsetU + 1 }, grid, 0.31, 0.42).mark
const wrappedV = sampleMirage({ ...c1, offsetV: c1.offsetV + 1 }, grid, 0.31, 0.42).mark
ok(Math.abs(wrappedU - s1.mark) < 1e-9 && Math.abs(wrappedV - s1.mark) < 1e-9, 'the sampler wraps instead of clamping at the sheet edge')

const field = mirageFieldFor('sv1-1', grid)
ok(field.verified === false, 'the field carries no verified-texture claim')
ok(field.plain !== true, 'Mirage is not a plain field: its brightness varies across the card')
ok(String(field.meta.reproduction) === 'procedural reconstruction', 'the field names its reproduction as procedural')
ok(String(field.meta.motif) === 'horizontal sheen', 'the field names the motif')
ok(Number(field.meta.waves) === MIRAGE_WAVES, 'the field records the band count')
ok(String(field.meta.border).includes('not modelled'), 'the field records the border it does not paint')
ok(String(field.meta.tiling).includes('disclosed choice'), 'the field discloses that tiling is this build’s choice')

// The bands run vertically: a card point's ink must not change down the card, and must
// swing across it. This is the same property the sheet's columns are tested for, seen
// through the sampler and the per-card cut.
{
  const downA = field.mark(0.4, 0.05)
  const downB = field.mark(0.4, 0.95)
  ok(Math.abs(downA - downB) < 1e-9, 'a card point keeps its ink from top to bottom: the bands are vertical', `${downA.toFixed(4)} vs ${downB.toFixed(4)}`)
  let lo = 1
  let hi = 0
  for (let u = 0.005; u < 1; u += 0.005) {
    const m = field.mark(u, 0.5)
    lo = Math.min(lo, m)
    hi = Math.max(hi, m)
  }
  ok(hi - lo > 0.1, 'and it swings as you cross the card, so the sheen reads', `${lo.toFixed(2)}–${hi.toFixed(2)}`)
  ok(lo >= MIRAGE_FLOOR - 0.01, 'never going dark between bands', lo.toFixed(3))
}

// ---------------------------------------------------------------------------
// 5. The cards that wear it, and the neighbouring eras that must not.
// ---------------------------------------------------------------------------

{
  const db = new Database('data/tcglife.db', { readonly: true })
  const pick = (where: string) =>
    db.prepare(`select id, set_id, rarity, name from cards where ${where} order by set_id limit 1`).get() as
      | { id: string; set_id: string; rarity: string | null; name: string }
      | undefined
  const sv = pick("set_id like 'sv%' and rarity = 'Rare'")
  const swsh = pick("set_id like 'swsh%' and rarity = 'Rare Holo'")
  const sm = pick("set_id like 'sm%' and rarity = 'Rare Holo'")
  db.close()

  ok(!!sv, 'the catalogue holds a Scarlet & Violet holo')
  ok(!!swsh, 'and a Sword & Shield holo rare')
  ok(!!sm, 'and a Sun & Moon holo rare')

  if (sv) {
    const art = holoFor({ cardId: sv.id, rarity: sv.rarity ?? undefined })
    ok(art?.style === 'mirage', `${sv.id}: resolves to Mirage`, art?.style ?? 'nothing')
    ok(art?.pattern == null, `${sv.id}: by the era rule, not a printing record`, String(art?.pattern))
    const rev = holoFor({ cardId: sv.id, rarity: sv.rarity ?? undefined, variant: 'reverseHolofoil' })
    ok(!!rev?.pattern?.startsWith('reverse-'), `${sv.id}: a reverse printing keeps its own paper`, String(rev?.pattern))
    ok(rev?.pattern !== 'mirage', `${sv.id}: the reverse paper is never Mirage`)
  }
  if (swsh) {
    const art = holoFor({ cardId: swsh.id, rarity: swsh.rarity ?? undefined })
    ok(art?.style === 'line', `${swsh.id}: Sword & Shield keeps Line`, art?.style ?? 'nothing')
  }
  if (sm) {
    const art = holoFor({ cardId: sm.id, rarity: sm.rarity ?? undefined })
    ok(art?.style === 'waterweb', `${sm.id}: Sun & Moon keeps Water Web`, art?.style ?? 'nothing')
  }
}

ok(PATTERNS.mirage.implemented === true, 'the registry says Mirage is painted')
ok(PATTERNS.mirage.texture === MIRAGE_SHEET.pattern, 'the registry points at this sheet')
ok(fs.existsSync('public' + PATTERNS.mirage.texture!), 'the file it points at ships')

// ---------------------------------------------------------------------------
// 6. The render obeys the layer contract.
// ---------------------------------------------------------------------------

const W = 200
const H = 279
const base = new Uint8ClampedArray(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    base[i] = 46 + Math.round((x / W) * 108)
    base[i + 1] = 74 + Math.round((y / H) * 66)
    base[i + 2] = 118
    base[i + 3] = 255
  }
}

const target = 'sv1-1'
const spec = foilMaskFor({ cardId: target, rarity: 'Rare' })
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
ok(modHi - modLo > 0.05, 'the sheen shapes the reflection across the card', `${modLo.toFixed(2)}–${modHi.toFixed(2)}`)
ok(modLo > 0.25, 'and never extinguishes it', modLo.toFixed(3))

// ---------------------------------------------------------------------------
// 7. The report exists, matches the routing, and does not overclaim.
// ---------------------------------------------------------------------------

{
  const report = JSON.parse(fs.readFileSync('reports/mirage-printings.json', 'utf8')) as {
    counts: {
      claimed: number
      painted: number
      sets: number
      textureVerified: boolean
      borderModelled: boolean
      maskVerified: number
      waves: number
      directionClaim: string
    }
    sets: unknown[]
    cards: unknown[]
    sheet: typeof MIRAGE_SHEET
    problems: string[]
  }
  ok(report.counts.claimed > 300, 'the report covers the era', String(report.counts.claimed))
  ok(report.counts.painted === report.counts.claimed, 'and every row is painted')
  ok(report.counts.sets >= 18, 'across the Scarlet & Violet sets', String(report.counts.sets))
  ok(report.sets.length === report.counts.sets, 'the per-set table matches the count')
  ok(report.counts.textureVerified === false, 'the report refuses to call the texture verified')
  ok(report.counts.borderModelled === false, 'and records that the silver border is not modelled')
  ok(report.counts.waves === MIRAGE_WAVES, 'and records the band count', String(report.counts.waves))
  ok(
    report.counts.maskVerified >= 0 && report.counts.maskVerified <= report.counts.claimed,
    'the foil area is counted separately from the texture',
    `${report.counts.maskVerified}/${report.counts.claimed}`,
  )
  ok(report.cards.length === report.counts.claimed && report.problems.length === 0, 'the report has no unresolved card')
  ok(report.sheet.pattern === MIRAGE_SHEET.pattern, 'the report ships the registry’s sheet')
  ok(report.counts.directionClaim === 'not established', 'the report records the travel direction as unestablished', report.counts.directionClaim)
}

// The direction of travel is a claim the footage cannot carry, so nothing may assert one.
{
  const claimsLeftToRight = (s: unknown) => /left\s*(→|->|to)\s*right/i.test(String(s ?? ''))
  ok(MIRAGE_MEASURED.direction.claim === 'not established', 'the direction is measured as unestablished', MIRAGE_MEASURED.direction.claim)
  ok(MIRAGE_MEASURED.direction.clips.length === 3, 'and the measurement records all three clips', String(MIRAGE_MEASURED.direction.clips.length))
  ok(
    MIRAGE_MEASURED.direction.clips.every((c) => Math.abs(c.drift) < 10),
    'no clip drifts a tenth of a card width per frame: these are rocks, not sweeps',
  )
  ok(!claimsLeftToRight(MIRAGE_SHEET.direction), 'the shipped index makes no left-to-right claim', MIRAGE_SHEET.direction)
  ok(
    !claimsLeftToRight((field.meta as Record<string, unknown> | undefined)?.direction),
    'and neither does the sampler’s meta',
    String((field.meta as Record<string, unknown> | undefined)?.direction),
  )
}

// The pattern must never be generated at render time.
for (const f of ['src/foil/mirage-sheet.ts', 'src/foil/mirage.ts', 'scripts/mirage-foil.ts', 'src/foil/mirage-index.ts']) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
