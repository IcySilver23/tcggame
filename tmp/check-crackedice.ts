// Phase 7: the Cracked Ice fracture, its one printing, and the correction.
//
// The claims are checked separately:
//   - the GENERATOR produces angular shards with bright boundaries, not noise,
//     and it tiles;
//   - the PRINTING is narrow: Frost Rotom (pl2-RT2), mask over everything but the
//     artwork, verified by the sentence that names it;
//   - the CORRECTION holds: no EX Trainer Kit card and no unnamed Rotom claims the
//     pattern;
//   - the RENDER obeys the layer contract, with light only outside the window.
//
// Run: ./node_modules/.bin/tsx tmp/check-crackedice.ts

import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  crackedIceInkAt,
  crackedIceSeeds,
  renderCrackedIceSheet,
  CRACKEDICE_SEED,
  CRACKEDICE_SHEET_SIZE,
} from '../src/foil/crackedice-sheet'
import {
  buildIceGrid,
  crackedIceFieldFor,
  iceCopyFor,
  sampleCrackedIce,
  CRACKEDICE_TEXTURE_VERIFIED,
} from '../src/foil/crackedice'
import { CRACKEDICE_SCALE, CRACKEDICE_SHEET, CRACKEDICE_SHOWCASE } from '../src/foil/crackedice-index'
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

console.log('Cracked Ice — fracture, printing, correction, render')

// ---------------------------------------------------------------------------
// 1. The generator cuts angular facets; boundaries are brighter than interiors.
// ---------------------------------------------------------------------------

const size = 512
const seeds = crackedIceSeeds(size, CRACKEDICE_SEED)
ok(seeds.length === 400, 'the fracture has 400 seeds (20x20)', String(seeds.length))

const first = seeds[0]
let nearest = seeds[1]
let best = Infinity
for (const s of seeds) {
  if (s.id === first.id) continue
  const dx = s.x - first.x
  const dy = s.y - first.y
  const d = dx * dx + dy * dy
  if (d < best) { best = d; nearest = s }
}
const centre = crackedIceInkAt(seeds, size, first.x, first.y)
// Walk from the facet centre to the shared boundary and find the brightest point.
let brightest = 0
let brightestT = 0
for (let i = 0; i <= 100; i++) {
  const t = i / 100
  const x = first.x + (nearest.x - first.x) * t
  const y = first.y + (nearest.y - first.y) * t
  const { ink } = crackedIceInkAt(seeds, size, x, y)
  if (ink > brightest) { brightest = ink; brightestT = t }
}
ok(brightest > centre.ink + 0.15, 'a fracture boundary is brighter than the facet centre', `${brightest.toFixed(3)} vs ${centre.ink.toFixed(3)}`)
ok(brightestT > 0.15 && brightestT < 0.85, 'the brightest point is on the boundary, not at a seed', brightestT.toFixed(2))

// A facet is a FLAT plane: two points well inside it share the same brightness.
const flatA = crackedIceInkAt(seeds, size, first.x, first.y)
const flatB = crackedIceInkAt(seeds, size, first.x + 3, first.y + 2)
ok(flatA.facet === flatB.facet && flatA.level === flatB.level, 'two points inside one facet share its brightness', `${flatA.level.toFixed(3)} vs ${flatB.level.toFixed(3)}`)
ok(flatA.facet === flatB.facet && Math.abs(flatA.ink - flatB.ink) < 0.05, 'and the facet interior is flat apart from a nearby crack', `${flatA.ink.toFixed(3)} vs ${flatB.ink.toFixed(3)}`)

// Angular, not round: the crack's brightness collapses within a few pixels, so it
// reads as a line rather than a soft gradient spread across the facet.
const span = Math.hypot(nearest.x - first.x, nearest.y - first.y)
let fallPx = Infinity
for (let i = 0; i <= 200; i++) {
  const t = brightestT + i / 200
  if (t > 1) break
  const { ink } = crackedIceInkAt(seeds, size, first.x + (nearest.x - first.x) * t, first.y + (nearest.y - first.y) * t)
  if (ink < brightest - 0.3) { fallPx = (i / 200) * span; break }
}
ok(fallPx < 20, 'the crack has a bright line that falls off within 20px', `${fallPx.toFixed(1)}px`)

const sheet = renderCrackedIceSheet(CRACKEDICE_SHEET_SIZE, CRACKEDICE_SEED)
ok(sheet.coverage > 0.9, 'every shard carries foil; only the brightness differs', sheet.coverage.toFixed(3))
ok(sheet.peak > 0.8, 'the cracks reach a bright peak', sheet.peak.toFixed(3))
ok(sheet.seamRatio < 1.5, 'the sheet tiles: the wrap seam looks like an interior seam', sheet.seamRatio.toFixed(3))
ok(sheet.seeds.length === 400, 'the shipped-size sheet keeps 400 facets')

const again = renderCrackedIceSheet(CRACKEDICE_SHEET_SIZE, CRACKEDICE_SEED)
let identical = again.rgba.length === sheet.rgba.length
for (let i = 0; identical && i < sheet.rgba.length; i++) if (again.rgba[i] !== sheet.rgba[i]) identical = false
ok(identical, 'the same seed renders byte-identical pixels')
const other = renderCrackedIceSheet(256, CRACKEDICE_SEED + 1)
let differs = false
for (let i = 0; i < other.rgba.length && !differs; i += 4) if (other.rgba[i + 3] !== sheet.rgba[i + 3]) differs = true
ok(differs, 'a different seed cuts a different fracture')

// ---------------------------------------------------------------------------
// 2. The shipped sheet and index agree with a fresh render.
// ---------------------------------------------------------------------------

const png = fs.readFileSync('public/foil/crackedice/sheet.png')
ok(png.length > 50_000, 'the sheet is shipped', `${png.length} bytes`)
ok(png.readUInt32BE(16) === 1024 && png.readUInt32BE(20) === 1024, 'the PNG is 1024x1024')
ok(Math.abs(CRACKEDICE_SHEET.coverage - sheet.coverage) < 1e-4, 'index coverage matches the render')
ok(Math.abs(CRACKEDICE_SHEET.peak - sheet.peak) < 1e-4, 'index peak matches the render')
ok(CRACKEDICE_SHEET.facets === sheet.seeds.length, 'index facet count matches the render')
ok(Math.abs(CRACKEDICE_SHEET.seamRatio - sheet.seamRatio) < 1e-3, 'index records the measured seam ratio')
ok(CRACKEDICE_SHEET.concept === true && CRACKEDICE_SHEET.textureVerified === false, 'the index declares a reconstruction')
ok(CRACKEDICE_TEXTURE_VERIFIED === false, 'the sampler exposes no verified texture claim')

const grid = buildIceGrid(sheet.size, sheet.size, sheet.rgba)
ok(grid.coverage > 0.9 && grid.peak > 0.8, 'the sampling grid keeps the fracture', `${grid.coverage.toFixed(3)} / ${grid.peak.toFixed(3)}`)

// ---------------------------------------------------------------------------
// 3. Sampling wraps because the sheet tiles, and is stable per card.
// ---------------------------------------------------------------------------

const copy = iceCopyFor('pl2-RT2')
ok(copy.seed === iceCopyFor('pl2-RT2').seed && copy.offsetU === iceCopyFor('pl2-RT2').offsetU, 'a card keeps its registration')
const a = sampleCrackedIce(copy, grid, 0.2, 0.4)
// The sheet repeats every 1/scale in card space; that is the tile period.
const b = sampleCrackedIce(copy, grid, 0.2 + 1 / CRACKEDICE_SCALE, 0.4)
ok(Math.abs(a.mark - b.mark) < 1e-6, 'sampling wraps: one tile later is the same point', `${a.mark} vs ${b.mark}`)
const c = sampleCrackedIce(iceCopyFor('pl2-RT1'), grid, 0.2, 0.4)
ok(Math.abs(a.mark - c.mark) > 1e-6, 'two cards do not share a registration')
ok(CRACKEDICE_SCALE > 1, 'the shipped pattern scale is recorded')
ok(sampleCrackedIce(copy, grid, 0.3, 0.3, 1).mark === sampleCrackedIce(copy, grid, 0.3, 0.3, 1).mark, 'sampling is stable frame to frame')

const field = crackedIceFieldFor('pl2-RT2', grid)
ok(field.verified === false, 'the field carries no verified-texture claim')
ok(String(field.meta.reproduction) === 'procedural reconstruction', 'the field names its reproduction')
ok(field.coverage > 0.9 && field.peak > 0.8, 'the field reports the fracture it actually samples')

// ---------------------------------------------------------------------------
// 4. The printing: one named card, mask verified, and the correction.
// ---------------------------------------------------------------------------

const printing = printingFor({ cardId: 'pl2-RT2', rarity: 'Rare', name: 'Frost Rotom' })
ok(printing?.pattern === 'crackedice', 'Frost Rotom resolves to Cracked Ice', printing?.pattern)
ok(printing?.mask === 'outside-art' && printing?.maskVerified === true, 'the foil area is the body, not the artwork', printing?.mask)
ok(printing?.status === 'verified' && printing?.matchedRule === 'explicit', 'the printing is an explicit, verified entry')
ok(holoFor({ cardId: 'pl2-RT2', rarity: 'Rare' })?.pattern === 'crackedice', 'the routing carries the pattern id')

const spec = foilMaskFor({ cardId: 'pl2-RT2', rarity: 'Rare' })
ok(spec?.kind === 'outsideArt' && spec.verified, 'the mask is the verified outside-art kind', spec?.kind)
ok(spec ? maskValue(spec, 0.5, 0.3) === 0 : false, 'the artwork stays matte')
ok(spec ? maskValue(spec, 0.5, 0.95) === 255 : false, 'the text panel is foil')
ok(spec ? maskValue(spec, 0.05, 0.5) === 255 : false, 'the frame is foil')
const area = coverageFraction(spec)
ok(area > 0.6 && area < 0.65, 'the foil covers the card minus the window', area.toFixed(4))

// The correction: the four Trainer Kits predate the pattern, and the other Rotom
// printings are not named by the source.
const db = new Database('data/tcglife.db', { readonly: true })
const tk = db.prepare("select id from cards where set_id like 'tk%'").all() as { id: string }[]
db.close()
ok(tk.length === 44, 'the four EX Trainer Kits hold 44 cards', String(tk.length))
ok(tk.every((r) => holoFor({ cardId: r.id })?.pattern !== 'crackedice'), 'no Trainer Kit card claims Cracked Ice')
ok(tk.every((r) => printingFor({ cardId: r.id }) === null), 'and none of them resolves a printing on that assumption')
for (const id of ['pl2-RT1', 'pl2-RT3', 'pl2-RT4', 'pl2-RT5']) {
  ok(printingFor({ cardId: id, rarity: 'Rare' }) === null, `${id} makes no Cracked Ice claim`)
}

ok(PATTERNS.crackedice.implemented === true, 'the registry says Cracked Ice is painted')
ok(fs.existsSync('public' + PATTERNS.crackedice.texture!), 'the registry points at the shipped sheet')
ok(CRACKEDICE_SHOWCASE.length === 1 && CRACKEDICE_SHOWCASE[0].cardId === 'pl2-RT2', 'the showcase is the one named printing')

// ---------------------------------------------------------------------------
// 5. The render obeys the layer contract.
// ---------------------------------------------------------------------------

const W = 200
const H = 279
const base = new Uint8ClampedArray(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    base[i] = 30 + Math.round((x / W) * 80)
    base[i + 1] = 45 + Math.round((y / H) * 70)
    base[i + 2] = 70
    base[i + 3] = 255
  }
}

const out = new Uint8ClampedArray(W * H * 4)
paintFoil(out, base, W, H, spec, FACE_ON, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
let restDiff = 0
for (let i = 0; i < base.length; i++) if (out[i] !== base[i]) restDiff++
ok(restDiff === 0, 'at rest the composite is the scan byte for byte', `${restDiff} bytes`)

const tilt = { deg: 55, axis: 45 }
paintFoil(out, base, W, H, spec, tilt, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
let artChanged = 0
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W
    const v = (y + 0.5) / H
    if (maskValue(spec, u, v, W / H) !== 0) continue
    const i = (y * W + x) * 4
    if (out[i] !== base[i] || out[i + 1] !== base[i + 1] || out[i + 2] !== base[i + 2]) artChanged++
  }
}
ok(artChanged === 0, 'tilted light never enters the matte artwork', `${artChanged} pixels`)
ok(meanLift(base, out, W, H, spec) > 0.5, 'the fracture lifts the body at 55°')

// A bright facet under an already-white printed pixel adds nothing.
const modulate = patternModulatorFor(null, W / H, DEFAULT_FOIL_SETTINGS, field)
ok(modulate(0.5, 0.95, 1) < 1e-6, 'a facet over pure white adds no light', modulate(0.5, 0.95, 1).toFixed(6))
ok(modulate(0.5, 0.95, 0) > 0.2, 'and over dark print it shapes the reflection', modulate(0.5, 0.95, 0).toFixed(3))

// ---------------------------------------------------------------------------
// 6. The report matches the catalogue and does not overclaim.
// ---------------------------------------------------------------------------

const report = JSON.parse(fs.readFileSync('reports/crackedice-printings.json', 'utf8')) as {
  counts: { namedPrintings: number; maskVerified: number; validated: number; textureVerified: boolean; tkCardsCorrected: number }
  problems: string[]
}
ok(report.counts.namedPrintings === 1, 'the report names exactly one printing')
ok(report.counts.maskVerified === 1, 'the report counts the verified mask')
ok(report.counts.textureVerified === false, 'the report refuses to call the texture verified')
ok(report.counts.validated === 1, 'the report counts the render-validated card')
ok(report.counts.tkCardsCorrected === 44, 'the report records the Trainer Kit correction')
ok(report.problems.length === 0, 'the report has no unresolved problems')

for (const f of ['src/foil/crackedice-sheet.ts', 'src/foil/crackedice.ts', 'scripts/crackedice-foil.ts']) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
