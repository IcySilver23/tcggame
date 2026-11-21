// Phase 6: the Starlight sheet, its sampler, and the three-set printing claim.
//
// The checks are split the same way the claims are:
//   - the GENERATOR is a drawing: four-point stars, several sizes, even spread,
//     deterministic, not tileable;
//   - the PRINTING is documented: every Base/Jungle/Fossil holo rare resolves to
//     starlight with the illustration-window mask, and Base Set 2 does not;
//   - the RENDER still obeys the layer contract: at rest it is the scan byte for
//     byte, at tilt it adds light only inside the mask, and never doubles a
//     printed white decoration.
//
// Run: ./node_modules/.bin/tsx tmp/check-starlight.ts

import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  renderStarlightSheet,
  starInk,
  starlightSeamMismatch,
  STARLIGHT_SEED,
  STARLIGHT_SHEET_SIZE,
} from '../src/foil/starlight-sheet'
import {
  buildStarGrid,
  sampleStarlight,
  starlightCopyFor,
  starlightFieldFor,
  STARLIGHT_TEXTURE_VERIFIED,
} from '../src/foil/starlight'
import { STARLIGHT_SHEET, STARLIGHT_SHOWCASE, STARLIGHT_SETS } from '../src/foil/starlight-index'
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

console.log('Starlight — sheet, sampler, printings, render')

// ---------------------------------------------------------------------------
// 1. The generator draws four-point starbursts, not sparkle noise.
// ---------------------------------------------------------------------------

ok(Math.abs(starInk(0, 0) - 1) < 1e-6, 'a star is brightest at its centre')
ok(starInk(0.5, 0) > 0.4, 'a star has a bright arm on the horizontal axis', String(starInk(0.5, 0).toFixed(3)))
ok(starInk(0, 0.5) > 0.4, 'and on the vertical axis', String(starInk(0, 0.5).toFixed(3)))
// Same radius, 45° off the arms: a four-point star is much dimmer there than on
// an arm. A round orb would score the same at both points.
const axis = starInk(0.5, 0)
const diagonal = starInk(0.5 * Math.SQRT1_2, 0.5 * Math.SQRT1_2)
ok(axis > diagonal * 2, 'the arms are brighter than the diagonals at equal radius — four points, not an orb', `${axis.toFixed(3)} vs ${diagonal.toFixed(3)}`)
ok(starInk(1.2, 0) === 0 && starInk(0, -1.3) === 0, 'ink stops at the star radius')
ok(starInk(-0.5, 0) === starInk(0.5, 0), 'a star is symmetric across its centre')
// Rotating the star and the sample point together must give the same ink.
const rot = Math.PI / 4
const px = 0.5 * Math.cos(rot)
const py = 0.5 * Math.sin(rot)
ok(Math.abs(starInk(px, py, rot) - starInk(0.5, 0, 0)) < 1e-6, 'rotation moves the arms with the star')

const sheet = renderStarlightSheet(STARLIGHT_SHEET_SIZE, STARLIGHT_SEED)
ok(sheet.size === 1024, 'sheet is 1024px square')
ok(sheet.counts.large === 10 && sheet.counts.medium === 46, 'the large and medium star counts are the generated ones', JSON.stringify(sheet.counts))
ok(sheet.counts.small >= 150 && sheet.counts.dust >= 400, 'small stars and dust are present in quantity')
ok(sheet.coverage > 0.02 && sheet.coverage < 0.16, 'ink coverage is sparse enough to leave the artwork readable', `${(sheet.coverage * 100).toFixed(2)}%`)
ok(sheet.peak > 0.45 && sheet.peak < 0.99, 'the blur leaves a bright but not clipped core', sheet.peak.toFixed(3))
// Four-point stars are not high-frequency noise: neighbouring pixels inside a
// large star must be close in value. A white-noise field would fail this.
let grad = 0
let gradN = 0
const big = sheet.stars.find((s) => s.kind === 'large')!
for (let y = Math.floor(big.y - big.r * 0.3); y < big.y + big.r * 0.3; y++) {
  for (let x = Math.floor(big.x - big.r * 0.3); x < big.x + big.r * 0.3; x++) {
    const a = sheet.rgba[(y * sheet.size + x) * 4 + 3] / 255
    const b = sheet.rgba[(y * sheet.size + x + 1) * 4 + 3] / 255
    grad += Math.abs(a - b)
    gradN++
  }
}
ok(gradN > 0 && grad / gradN < 0.035, 'star interiors vary smoothly — this is a drawing, not per-pixel noise', (grad / gradN).toFixed(4))

const again = renderStarlightSheet(STARLIGHT_SHEET_SIZE, STARLIGHT_SEED)
let identical = again.rgba.length === sheet.rgba.length
for (let i = 0; identical && i < sheet.rgba.length; i++) if (again.rgba[i] !== sheet.rgba[i]) identical = false
ok(identical, 'the same seed renders byte-identical pixels (the pattern cannot move between frames)')
const other = renderStarlightSheet(256, STARLIGHT_SEED + 1)
let differs = false
for (let i = 0; i < other.rgba.length && !differs; i += 4) if (other.rgba[i + 3] !== sheet.rgba[i + 3]) differs = true
ok(differs, 'a different seed draws a different sheet')

const seam = starlightSeamMismatch(sheet.rgba, sheet.size)
ok(seam > 0.05, 'the sheet does not wrap cleanly, so cards must sample one window', `${(seam * 100).toFixed(1)}%`)

// ---------------------------------------------------------------------------
// 2. The shipped asset and generated index agree with a fresh render.
// ---------------------------------------------------------------------------

const png = fs.readFileSync('public/foil/starlight/sheet.png')
ok(png.length > 50_000, 'the sheet is shipped and not a stub', `${png.length} bytes`)
ok(png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, 'the sheet is a PNG')
ok(png.readUInt32BE(16) === 1024 && png.readUInt32BE(20) === 1024, 'the PNG is 1024x1024', `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`)
ok(Math.abs(STARLIGHT_SHEET.coverage - sheet.coverage) < 1e-4, 'index coverage matches the rendered sheet', `${STARLIGHT_SHEET.coverage} vs ${sheet.coverage.toFixed(5)}`)
ok(Math.abs(STARLIGHT_SHEET.peak - sheet.peak) < 1e-4, 'index peak matches the rendered sheet')
ok(STARLIGHT_SHEET.stars.large === sheet.counts.large && STARLIGHT_SHEET.stars.dust === sheet.counts.dust, 'index star counts match the render')
ok(Math.abs(STARLIGHT_SHEET.seamMismatch - seam) < 1e-3, 'index records the measured wrap mismatch')
ok(STARLIGHT_SHEET.concept === true && STARLIGHT_SHEET.textureVerified === false, 'the index declares the texture a reconstruction, not a scan')
ok(STARLIGHT_TEXTURE_VERIFIED === false, 'the sampler exposes no verified texture claim')

const grid = buildStarGrid(sheet.size, sheet.size, sheet.rgba)
ok(Math.abs(grid.coverage - sheet.coverage) < 0.01, 'the sampling grid measures the same coverage')
ok(grid.peak > 0.45, 'the sampling grid has a bright peak', grid.peak.toFixed(3))

// ---------------------------------------------------------------------------
// 3. Per-card cuts are deterministic, varied, and set-oriented.
// ---------------------------------------------------------------------------

const c1 = starlightCopyFor('base1-4')
const c1b = starlightCopyFor('base1-4')
const c2 = starlightCopyFor('base1-5')
ok(c1.seed === c1b.seed && c1.offsetU === c1b.offsetU && c1.zoom === c1b.zoom, 'a card keeps its cut between frames')
ok(c1.offsetU !== c2.offsetU || c1.offsetV !== c2.offsetV || c1.zoom !== c2.zoom, 'two cards do not share a cut')
ok(c1.rotated === starlightCopyFor('base1-1').rotated, 'one set is cut from one sheet orientation')
ok(c1.zoom >= 0.97 && c1.zoom <= 1.06, 'the cut zooms only slightly', c1.zoom.toFixed(3))

const s1 = sampleStarlight(c1, grid, 0.31, 0.42)
const s2 = sampleStarlight(c1, grid, 0.31, 0.42)
ok(s1.mark === s2.mark && s1.opacity === s2.opacity, 'sampling is stable for a fixed point and tilt')
ok(s1.mark >= 0 && s1.mark <= 1, 'a mark is a 0..1 fraction', String(s1.mark))
let maxDiff = 0
for (let i = 0; i < 40; i++) {
  const u = (i * 0.7919) % 1
  const v = (i * 0.3779) % 1
  maxDiff = Math.max(maxDiff, Math.abs(sampleStarlight(c1, grid, u, v).mark - sampleStarlight(c2, grid, u, v).mark))
}
ok(maxDiff > 0.05, 'different cards sample different ink at the same card point', maxDiff.toFixed(3))

const field = starlightFieldFor('base1-4', grid)
ok(field.verified === false, 'the field carries no verified-texture claim')
ok(String(field.meta.reproduction) === 'procedural reconstruction', 'the field names its reproduction as procedural')
ok(field.coverage > 0.02 && field.peak > 0.45, 'the field reports real coverage and peak')

// ---------------------------------------------------------------------------
// 4. The printings: 47 holo rares across the three sets, and Base Set 2 is not
//    one of them.
// ---------------------------------------------------------------------------

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db
  .prepare("select id, name, rarity from cards where set_id in ('base1','base2','base3') and rarity like '%Holo%'")
  .all() as { id: string; name: string; rarity: string }[]
const base4 = db
  .prepare("select count(*) n from cards where set_id = 'base4' and rarity like '%Holo%'")
  .get() as { n: number }
db.close()

ok(rows.length === 47, 'Base, Jungle and Fossil hold 47 holo rares', String(rows.length))
ok(rows.every((r) => printingFor({ cardId: r.id, rarity: r.rarity })?.pattern === 'starlight'), 'every one resolves to the starlight pattern')
ok(rows.every((r) => {
  const spec = foilMaskFor({ cardId: r.id, rarity: r.rarity })
  return spec?.kind === 'art' && spec.verified
}), 'every one uses the verified illustration-window mask')
ok(base4.n > 0, 'Base Set 2 has holo rares to contrast against', String(base4.n))
ok(printingFor({ cardId: 'base4-4', rarity: 'Rare Holo' })?.pattern === 'cosmos-retro', 'Base Set 2 resolves to Cosmos, not Starlight')
ok(STARLIGHT_SETS.join(',') === 'base1,base2,base3', 'only the three documented sets are listed')

const holo = holoFor({ cardId: 'base1-4', rarity: 'Rare Holo' })
ok(holo?.pattern === 'starlight' && holo.style === 'starfoil', 'the routing keeps both the starfoil style and the pattern id', JSON.stringify(holo))
ok(holoFor({ cardId: 'base3-1', rarity: 'Rare Holo' })?.pattern === 'starlight', 'Fossil routes to Starlight too')
// Base, Jungle and Fossil predate reverse holos (Legendary Collection is the
// first), so a marketplace flag cannot invent one on them.
ok(holoFor({ cardId: 'base1-4', rarity: 'Rare Holo', variant: 'Reverse Holo' }) === null, 'a reverse flag on Base Set invents nothing')
ok(holoFor({ cardId: 'base6-1', rarity: 'Rare Holo', variant: 'Reverse Holo' }) !== null, 'Legendary Collection still has its reverse printing')

ok(PATTERNS.starlight.implemented === true, 'the registry now says Starlight is painted')
ok(fs.existsSync('public' + PATTERNS.starlight.texture!), 'the registry points at a shipped file', PATTERNS.starlight.texture)

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

const spec = foilMaskFor({ cardId: 'base1-4', rarity: 'Rare Holo' })!
ok(spec.kind === 'art' && spec.verified, 'the render target uses the verified art window')
const area = coverageFraction(spec)
ok(area > 0.36 && area < 0.39, 'the window is 37.5% of the card box', area.toFixed(4))

const out = new Uint8ClampedArray(W * H * 4)
paintFoil(out, base, W, H, spec, FACE_ON, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
let restDiff = 0
for (let i = 0; i < base.length; i++) if (out[i] !== base[i]) restDiff++
ok(restDiff === 0, 'at rest the composite is the scan byte for byte', `${restDiff} bytes differ`)

const tilt = { deg: 55, axis: 45 }
paintFoil(out, base, W, H, spec, tilt, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
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
ok(lift > 0.5, 'the starfield lifts the window at 55°', lift.toFixed(2))

// The duplicate-decoration guard: a star over an already-white pixel adds
// nothing, so a printed white decoration cannot gain a second copy of itself.
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
ok(bestMark > 0.5, 'a star core exists inside the card window', bestMark.toFixed(3))
ok(modulate(coreU, coreV, 1) < 1e-6, 'a mark over pure white adds no light', modulate(coreU, coreV, 1).toFixed(6))
ok(modulate(coreU, coreV, 0) > 0.2, 'and over dark print it shapes the reflection', modulate(coreU, coreV, 0).toFixed(3))

// ---------------------------------------------------------------------------
// 6. The report exists, matches the database, and does not overclaim.
// ---------------------------------------------------------------------------

const report = JSON.parse(fs.readFileSync('reports/starlight-printings.json', 'utf8')) as {
  counts: { identified: number; validated: number; maskVerified: number; textureVerified: boolean }
  cards: unknown[]
  problems: string[]
}
ok(report.counts.identified === rows.length, 'the report covers every holo rare', String(report.counts.identified))
ok(report.counts.maskVerified === rows.length, 'the report counts every mask as verified')
ok(report.counts.textureVerified === false, 'the report refuses to call the texture verified')
ok(report.counts.validated === STARLIGHT_SHOWCASE.length, 'the report counts exactly the render-validated cards')
ok(report.cards.length === rows.length && report.problems.length === 0, 'the report has no unresolved cards')
ok(STARLIGHT_SHOWCASE.length === 3, 'three representative cards are showcased')

// The sheet is drawn, so nothing in the new code may reach for random at render
// time: an unseeded generator would make the pattern swim between frames.
for (const f of ['src/foil/starlight-sheet.ts', 'src/foil/starlight.ts', 'scripts/starlight-foil.ts']) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
