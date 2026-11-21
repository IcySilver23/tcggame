// Water Web: the sheet, the sampler, the printings and the render.
//
// Run: ./node_modules/.bin/tsx tmp/check-waterweb.ts
//
// The checks are split the way the claims are:
//   - the GENERATOR is a drawing: eight WAVY bands (a crest column must move down the
//     sheet), a foil that never goes dark, a sheet that wraps, deterministic pixels,
//     neutral colour;
//   - the PRINTING is a set-level identification: Sun & Moon through Cosmic Eclipse
//     resolves to Water Web (Detective Pikachu does not — it has no Water Web card), and
//     the neighbouring eras keep their own papers;
//   - the RENDER obeys the layer contract: at rest it is the scan byte for byte, at tilt
//     it adds light only inside the mask.
//
// Read reports/waterweb-printings.md first if a number here looks arbitrary.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  renderWaterwebSheet,
  waterwebInkAt,
  waterwebInternalStep,
  waterwebPhase,
  waterwebSeamMismatch,
  WATERWEB_MARK_LINE,
  WATERWEB_SHEET_SIZE,
  WATERWEB_VALLEY,
  WATERWEB_WAVES,
} from '../src/foil/waterweb-sheet'
import {
  buildWaterwebGrid,
  sampleWaterweb,
  waterwebCopyFor,
  waterwebFieldFor,
  WATERWEB_TEXTURE_VERIFIED,
} from '../src/foil/waterweb'
import { WATERWEB_CLAIM, WATERWEB_LIMITATION, WATERWEB_SHEET } from '../src/foil/waterweb-index'
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

console.log('Water Web — sheet, sampler, printings, render')

// ---------------------------------------------------------------------------
// 1. The generator draws wavy bands over foil that never goes dark.
// ---------------------------------------------------------------------------
const sheet = renderWaterwebSheet(WATERWEB_SHEET_SIZE)
ok(sheet.size === 1024, 'the sheet is 1024px square')
ok(sheet.waves === WATERWEB_WAVES && WATERWEB_WAVES === 8, 'eight bands across the sheet', String(sheet.waves))
ok(sheet.valley >= 0.25, 'the valley stays bright: Water Web is a continuous foil', sheet.valley.toFixed(3))
ok(Math.abs(sheet.valley - WATERWEB_VALLEY) < 1e-6, 'and it is the declared valley')
ok(sheet.peak >= 0.75, 'a crest is bright', sheet.peak.toFixed(3))
ok(sheet.peak / sheet.valley >= 1.8, 'crest-to-valley contrast lets the waves read', (sheet.peak / sheet.valley).toFixed(2))
ok(sheet.coverage > 0.35 && sheet.coverage < 0.85, 'the crests cover enough to read without burying the art', `${(sheet.coverage * 100).toFixed(2)}%`)

// The phase must be a whole number of turns in both axes, or the sheet cannot wrap.
{
  let periodic = true
  for (const [u, v] of [[0.13, 0.27], [0.4, 0.61], [0.77, 0.05], [0.5, 0.5]] as const) {
    const base = waterwebPhase(u, v)
    if (Math.abs(waterwebPhase(u + 1, v) - base) > 1e-9) periodic = false
    if (Math.abs(waterwebPhase(u, v + 1) - base) > 1e-9) periodic = false
  }
  ok(periodic, 'the phase repeats every full turn in u and in v, which is what lets it wrap')
}

// WAVY, not ruled: at a crest column the ink must swing far down the sheet, because the
// band moves away and back. Line's ruled field would move only by its slow drift (~0.1).
{
  const column = []
  for (let y = 0; y < WATERWEB_SHEET_SIZE; y += 4) column.push(waterwebInkAt(0, y))
  const swing = Math.max(...column) - Math.min(...column)
  ok(swing > 0.25, 'the bands are wavy: a crest column swings down the sheet', swing.toFixed(3))
}

// Eight crests cross a row. Count LOCAL MAXIMA: the slow swell can leave one crest
// hovering at a fixed threshold, which would count twice.
{
  let crests = 0
  for (let x = 0; x < WATERWEB_SHEET_SIZE; x++) {
    const prev = waterwebInkAt((x - 1 + WATERWEB_SHEET_SIZE) % WATERWEB_SHEET_SIZE, 0)
    const here = waterwebInkAt(x, 0)
    const next = waterwebInkAt((x + 1) % WATERWEB_SHEET_SIZE, 0)
    if (here > prev && here >= next && here >= 0.6) crests++
  }
  ok(crests === WATERWEB_WAVES, 'a row crosses one crest per band', `${crests} crests`)
}

const seam = waterwebSeamMismatch(sheet.rgba, sheet.size)
const internal = waterwebInternalStep(sheet.rgba, sheet.size)
ok(seam <= internal + 0.01, 'the wrap step is no larger than one pixel of a band’s slope', `${(seam * 100).toFixed(2)}% vs ${(internal * 100).toFixed(2)}%`)
ok(seam < 0.06, 'so the sheet is continuous at its own edges and a card may sample any window', `${(seam * 100).toFixed(2)}%`)

const again = renderWaterwebSheet(WATERWEB_SHEET_SIZE)
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

const small = renderWaterwebSheet(256)
ok(small.valley >= 0.25 && small.coverage > 0.3, 'a smaller sheet keeps the same shape', small.valley.toFixed(3))

// ---------------------------------------------------------------------------
// 2. The shipped asset and the generated index agree with a fresh render.
// ---------------------------------------------------------------------------
const png = fs.readFileSync('public/foil/waterweb/sheet.png')
ok(png.length > 10_000, 'the sheet is shipped and not a stub', `${png.length} bytes`)
ok(png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, 'the sheet is a PNG')
ok(png.readUInt32BE(16) === 1024 && png.readUInt32BE(20) === 1024, 'the PNG is 1024x1024')
ok(Math.abs(WATERWEB_SHEET.valley - sheet.valley) < 1e-4, 'the index valley matches the render')
ok(Math.abs(WATERWEB_SHEET.peak - sheet.peak) < 1e-4, 'the index crest matches the render')
ok(Math.abs(WATERWEB_SHEET.coverage - sheet.coverage) < 1e-4, 'the index coverage matches the render')
ok(Math.abs(WATERWEB_SHEET.seamMismatch - seam) < 1e-3, 'the index records the measured wrap step')
ok(WATERWEB_SHEET.concept === true && WATERWEB_SHEET.textureVerified === false, 'the index declares the sheet a reconstruction')
ok(WATERWEB_SHEET.waves === WATERWEB_WAVES, 'the index records the band count')
ok(WATERWEB_TEXTURE_VERIFIED === false, 'the sampler exposes no verified-texture claim')
ok(WATERWEB_CLAIM.includes('wavy pattern similar to flowing water'), 'the claim quotes the source, not a paraphrase')
ok(/band/.test(WATERWEB_LIMITATION) && /not/i.test(WATERWEB_LIMITATION), 'the index states what is this build’s choice')

const grid = buildWaterwebGrid(sheet.size, sheet.size, sheet.rgba)
{
  let lo = 1
  let hi = 0
  for (let i = 0; i < grid.mark.length; i++) {
    lo = Math.min(lo, grid.mark[i])
    hi = Math.max(hi, grid.mark[i])
  }
  ok(lo >= 0.2, 'the grid keeps the bright valley: no cell goes dark', lo.toFixed(3))
  ok(hi - lo > 0.3, 'and the crests survive the downsample', `${lo.toFixed(2)}–${hi.toFixed(2)}`)
  let marked = 0
  for (let i = 0; i < grid.mark.length; i++) if (grid.mark[i] >= WATERWEB_MARK_LINE) marked++
  const frac = marked / grid.mark.length
  ok(frac >= sheet.coverage - 0.05 && frac <= 0.97, 'the downsample keeps the crests', `${(frac * 100).toFixed(1)}% vs ${(sheet.coverage * 100).toFixed(1)}%`)
}

// ---------------------------------------------------------------------------
// 3. Per-card cuts: stable between frames, different between cards, wrapping.
// ---------------------------------------------------------------------------
const c1 = waterwebCopyFor('sm1-1')
const c1b = waterwebCopyFor('sm1-1')
const c2 = waterwebCopyFor('sm1-2')
ok(c1.seed === c1b.seed && c1.offsetU === c1b.offsetU && c1.offsetV === c1b.offsetV, 'a card keeps its cut between frames')
ok(c1.offsetU !== c2.offsetU || c1.offsetV !== c2.offsetV, 'two cards sit at different cuts')

const s1 = sampleWaterweb(c1, grid, 0.31, 0.42)
ok(s1.mark === sampleWaterweb(c1, grid, 0.31, 0.42).mark, 'sampling is stable for a fixed point')
const wrappedU = sampleWaterweb({ ...c1, offsetU: c1.offsetU + 1 }, grid, 0.31, 0.42).mark
const wrappedV = sampleWaterweb({ ...c1, offsetV: c1.offsetV + 1 }, grid, 0.31, 0.42).mark
ok(Math.abs(wrappedU - s1.mark) < 1e-9 && Math.abs(wrappedV - s1.mark) < 1e-9, 'the sampler wraps instead of clamping at the sheet edge')

const field = waterwebFieldFor('sm1-1', grid)
ok(field.verified === false, 'the field carries no verified-texture claim')
ok(field.plain !== true, 'Water Web is not a plain field')
ok(String(field.meta.reproduction) === 'procedural reconstruction', 'the field names its reproduction as procedural')
ok(String(field.meta.motif) === 'flowing wavy bands', 'the field names the motif')
ok(Number(field.meta.waves) === WATERWEB_WAVES, 'the field records the band count')

{
  let lo = 1
  let hi = 0
  for (let v = 0.005; v < 1; v += 0.0025) {
    const m = field.mark(0.5, v)
    lo = Math.min(lo, m)
    hi = Math.max(hi, m)
  }
  ok(hi - lo > 0.25, 'the waves vary down the card, not just across it', `${lo.toFixed(2)}–${hi.toFixed(2)}`)
  ok(lo >= 0.2, 'and the card never goes dark between crests', lo.toFixed(3))
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
  const sm = pick("set_id like 'sm%' and rarity = 'Rare Holo'")
  const swsh = pick("set_id like 'swsh%' and rarity = 'Rare Holo'")
  const sv = pick("set_id like 'sv%' and rarity = 'Rare'")
  db.close()

  ok(!!sm, 'the catalogue holds a Sun & Moon holo rare')
  ok(!!swsh, 'and a Sword & Shield holo rare')
  ok(!!sv, 'and a Scarlet & Violet holo rare')

  if (sm) {
    const art = holoFor({ cardId: sm.id, rarity: sm.rarity ?? undefined })
    ok(art?.style === 'waterweb', `${sm.id}: resolves to Water Web`, art?.style ?? 'nothing')
    ok(art?.pattern == null, `${sm.id}: by the era rule, not a printing record`, String(art?.pattern))
    const rev = holoFor({ cardId: sm.id, rarity: sm.rarity ?? undefined, variant: 'reverseHolofoil' })
    ok(!!rev?.pattern?.startsWith('reverse-'), `${sm.id}: a reverse printing keeps its own paper`, String(rev?.pattern))
    ok(rev?.pattern !== 'waterweb', `${sm.id}: the reverse paper is never Water Web`)
  }
  if (swsh) {
    const art = holoFor({ cardId: swsh.id, rarity: swsh.rarity ?? undefined })
    ok(art?.style === 'line', `${swsh.id}: Sword & Shield keeps Line`, art?.style ?? 'nothing')
  }
  if (sv) {
    const art = holoFor({ cardId: sv.id, rarity: sv.rarity ?? undefined })
    ok(art?.style === 'mirage', `${sv.id}: Scarlet & Violet keeps Mirage`, art?.style ?? 'nothing')
  }
}

ok(PATTERNS.waterweb.implemented === true, 'the registry says Water Web is painted')
ok(PATTERNS.waterweb.texture === WATERWEB_SHEET.pattern, 'the registry points at this sheet')
ok(fs.existsSync('public' + PATTERNS.waterweb.texture!), 'the file it points at ships')

// ---------------------------------------------------------------------------
// 5. The render obeys the layer contract.
// ---------------------------------------------------------------------------
const W = 200
const H = 279
const base = new Uint8ClampedArray(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    base[i] = 40 + Math.round((x / W) * 120)
    base[i + 1] = 70 + Math.round((y / H) * 70)
    base[i + 2] = 112
    base[i + 3] = 255
  }
}

const target = 'sm1-1'
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
ok(modHi - modLo > 0.05, 'the waves shape the reflection across the card', `${modLo.toFixed(2)}–${modHi.toFixed(2)}`)
ok(modLo > 0.1, 'and never extinguish it', modLo.toFixed(3))

// ---------------------------------------------------------------------------
// 6. The report exists, matches the routing, and does not overclaim.
// ---------------------------------------------------------------------------
{
  const report = JSON.parse(fs.readFileSync('reports/waterweb-printings.json', 'utf8')) as {
    counts: { claimed: number; painted: number; sets: number; textureVerified: boolean; maskVerified: number; waves: number }
    cards: unknown[]
    sheet: typeof WATERWEB_SHEET
    problems: string[]
  }
  ok(report.counts.claimed > 350, 'the report covers the era', String(report.counts.claimed))
  ok(report.counts.painted === report.counts.claimed, 'and every row is painted')
  ok(report.counts.sets >= 12, 'across the Sun & Moon sets', String(report.counts.sets))
  ok(report.counts.textureVerified === false, 'the report refuses to call the texture verified')
  ok(report.counts.waves === WATERWEB_WAVES, 'and records the band count', String(report.counts.waves))
  ok(
    report.counts.maskVerified > 0 && report.counts.maskVerified <= report.counts.claimed,
    'the foil area is counted separately from the texture',
    `${report.counts.maskVerified}/${report.counts.claimed}`,
  )
  ok(report.cards.length === report.counts.claimed && report.problems.length === 0, 'the report has no unresolved card')
  ok(report.sheet.pattern === WATERWEB_SHEET.pattern, 'the report ships the registry’s sheet')
}

// The pattern must never be generated at render time.
for (const f of ['src/foil/waterweb-sheet.ts', 'src/foil/waterweb.ts', 'scripts/waterweb-foil.ts', 'src/foil/waterweb-index.ts']) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
