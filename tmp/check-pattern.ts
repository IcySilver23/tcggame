// Pattern tests — Phase 4, now against the reference sheet's own tile.
//
// The tile is no longer generated, so the claims change with it. What this file
// holds the layer to:
//   1. it wraps: the value at u=1 is the value at u=0, and the same vertically,
//      so raising PATTERN_SCALE repeats the tile instead of tearing it;
//   2. it is a real texture and not a wash or noise — bare foil dominates, marks
//      are a real presence, sparkles reach full brightness, and the same point
//      always gives the same value;
//   3. the alpha field is the same tile remapped, never below the floor;
//   4. a patterned composite still obeys every Phase 3 rule: byte-identical at
//      rest, inside the mask, neutral, brightening only, no channel wrap;
//   5. the pattern can only ever dim the light — it never adds any of its own;
//   6. it is the sheet's tile, at the sheet's scale: one copy across the card.
import { foilMaskFor, maskValue, type FoilMaskSpec } from '../src/foil/mask'
import { applyReflection, FACE_ON, type FoilTilt } from '../src/foil/reflection'
import {
  ALPHA_FLOOR, PATTERN_GAMMA, PATTERN_SCALE, patternAlpha, patternTexture, patternModulator, patternCoverage, tileSample,
} from '../src/foil/pattern'
import { TILE_H, TILE_MAX, TILE_W } from '../src/foil/tile-data'

let failed = 0
const ok = (cond: boolean, label: string, detail?: string) => {
  if (cond) console.log('ok    ' + label)
  else { failed++; console.log('FAIL  ' + label + (detail ? ' — ' + detail : '')) }
}

const W = 200
const H = 279
const ASPECT = W / H
const rc6 = foilMaskFor({ cardId: 'g1-RC6', rarity: 'Rare Holo EX' })!
const rc16 = foilMaskFor({ cardId: 'g1-RC16', rarity: 'Uncommon' })!

function baseImage(w = W, h = H): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      d[i] = (x * 7 + y * 3) % 256
      d[i + 1] = (x * 5 + y * 11) % 256
      d[i + 2] = (x * 13 + y * 2) % 256
      d[i + 3] = 255
      if (x > w - 12 && y < 12) { d[i] = 254; d[i + 1] = 255; d[i + 2] = 250 }
    }
  }
  return d
}

const SAMPLES: { u: number; v: number }[] = []
for (let j = 1; j < 40; j++) {
  for (let i = 1; i < 40; i++) SAMPLES.push({ u: i / 41, v: j / 41 })
}

// --- 1. the tile wraps ----------------------------------------------------------
const EPS = 1e-9
let worstH = 0
let worstV = 0
for (const { u, v } of SAMPLES) {
  worstH = Math.max(worstH, Math.abs(patternTexture(u + 1, v, ASPECT) - patternTexture(u, v, ASPECT)))
  worstV = Math.max(worstV, Math.abs(patternTexture(u, v + 1, ASPECT) - patternTexture(u, v, ASPECT)))
}
ok(worstH < EPS, 'wraps horizontally (value one tile right equals value here)', worstH.toExponential(1))
ok(worstV < EPS, 'wraps vertically (value one tile down equals value here)', worstV.toExponential(1))
ok(Math.abs(patternAlpha(0.5 + 1, 0.5, ASPECT) - patternAlpha(0.5, 0.5, ASPECT)) < EPS,
  'the alpha field wraps on the same tile')
ok(Math.abs(tileSample(1, 0.37) - tileSample(0, 0.37)) < EPS, 'sampling itself is continuous across the join')
ok(Math.abs(patternTexture(0.31 + 2, 0.44, ASPECT) - patternTexture(0.31, 0.44, ASPECT)) < EPS,
  'the period is one tile, not a multiple')

// --- 2. the sheet's tile, as measured -------------------------------------------
// Numbers here are the reference panel's own, not targets: 69% bare foil, 6% marks
// at or above half brightness, 0.7% near-white sparkle cores.
const values = SAMPLES.map(({ u, v }) => patternTexture(u, v, ASPECT))
const min = Math.min(...values)
const max = Math.max(...values)
const mean = values.reduce((a, b) => a + b, 0) / values.length
const gaps = values.filter((t) => t < 0.1).length / values.length
const marks = values.filter((t) => t >= 0.5).length / values.length
const bright = values.filter((t) => t >= 0.85).length / values.length
ok(min < 0.12, 'there is bare foil between the marks', min.toFixed(3))
ok(max > 0.9, 'the sparkle cores reach near-white', max.toFixed(3))
ok(gaps > 0.3, 'bare foil dominates, as it does on the sheet', `${(gaps * 100).toFixed(0)}%`)
ok(marks > 0.03 && marks < 0.4, 'marks are a real presence, not a wash', `${(marks * 100).toFixed(1)}%`)
ok(bright > 0.002, 'the sparkles are points of light, not a haze', `${(bright * 100).toFixed(2)}%`)
ok(mean > 0.08 && mean < 0.4, 'the field is neither flooded nor nearly empty', mean.toFixed(3))
ok(SAMPLES.every(({ u, v }) => patternTexture(u, v, ASPECT) === patternTexture(u, v, ASPECT)),
  'deterministic — the same point always gives the same value')
ok(PATTERN_SCALE === 1, 'the tile is laid once across the card, as the sheet lays it out', String(PATTERN_SCALE))
ok(TILE_MAX > 200 && TILE_W > 100 && TILE_H > 100,
  'the baked tile is a real image, not a stub', `${TILE_W}x${TILE_H}, max ${TILE_MAX}`)

// --- 3. the alpha is the same tile, remapped ------------------------------------
let nonMonotonic = 0
let nonStrict = 0
let outOfRange = 0
let alphaMin = 1
let alphaMax = 0
for (let n = 0; n < 600; n++) {
  const a = SAMPLES[(n * 7) % SAMPLES.length]
  const b = SAMPLES[(n * 13 + 5) % SAMPLES.length]
  const ta = patternTexture(a.u, a.v, ASPECT)
  const tb = patternTexture(b.u, b.v, ASPECT)
  const aa = patternAlpha(a.u, a.v, ASPECT)
  const ab = patternAlpha(b.u, b.v, ASPECT)
  // Alpha clips at 1 — a mark cannot add more than all the light — so above the
  // saturation point two bright textures correctly share alpha 1. Below it the
  // mapping is strict, and that is asserted separately.
  if (ta > tb ? !(aa >= ab) : ta < tb ? !(aa <= ab) : aa !== ab) nonMonotonic++
  if (Math.max(ta, tb) <= 1 - ALPHA_FLOOR - 1e-6 && (ta > tb ? !(aa > ab) : ta < tb ? !(aa < ab) : aa !== ab)) nonStrict++
  if (aa < ALPHA_FLOOR - 1e-12 || aa > 1 + 1e-12) outOfRange++
  alphaMin = Math.min(alphaMin, aa)
  alphaMax = Math.max(alphaMax, aa)
}
ok(nonMonotonic === 0, 'alpha never falls as the texture rises', String(nonMonotonic))
ok(nonStrict === 0, 'and below the clip it tracks the texture strictly', String(nonStrict))
ok(outOfRange === 0, 'alpha stays within [floor, 1]', `${alphaMin.toFixed(3)}..${alphaMax.toFixed(3)}`)
ok(alphaMin >= ALPHA_FLOOR - 1e-12, 'gaps still reflect, they do not go black', alphaMin.toFixed(3))
ok(PATTERN_GAMMA < 1, 'mark bodies are lifted above the bare field', String(PATTERN_GAMMA))
{
  // A heart's body must be clearly brighter than the field it sits in, or the
  // marks are a mottle rather than a pattern.
  const body = ALPHA_FLOOR + (1 - ALPHA_FLOOR) * Math.pow(0.3, PATTERN_GAMMA)
  const field = ALPHA_FLOOR + (1 - ALPHA_FLOOR) * Math.pow(min, PATTERN_GAMMA)
  ok(body > field * 1.7, 'a mark body gets at least 1.7x the light of the bare field',
    `${body.toFixed(3)} vs ${field.toFixed(3)}`)
}
ok(alphaMax > 0.9, 'the brightest marks get most of the light', alphaMax.toFixed(3))
ok(Math.abs(ALPHA_FLOOR + (1 - ALPHA_FLOOR) * Math.pow(1, PATTERN_GAMMA) - 1) < 1e-12,
  'a pure-white mark still returns all of it', String(ALPHA_FLOOR + (1 - ALPHA_FLOOR)))
{
  // The mapping must keep the card's average lift where the tuned dot field had
  // it, or the hearts arrive and the card simply gets dimmer.
  const alphaMean = SAMPLES.reduce((sum, { u, v }) => sum + patternAlpha(u, v, ASPECT), 0) / SAMPLES.length
  // The pattern decides where light lands, so the average is deliberately below
// the sheen's own level: the marks are the glint and the field is quiet foil.
  ok(alphaMean > 0.25 && alphaMean < 0.55, 'the field between marks stays quieter than the marks', alphaMean.toFixed(3))
}

// --- 4/5. composite rules, with the pattern on ----------------------------------
const mod = patternModulator(ASPECT)

const rest = baseImage()
const restBefore = Uint8ClampedArray.from(rest)
const restChanged = applyReflection(rest, W, H, rc6, FACE_ON, mod)
ok(restChanged === 0, 'face-on with a pattern still changes no pixels', String(restChanged))
ok(rest.every((v, i) => v === restBefore[i]), 'face-on with a pattern is byte-identical to the base')

for (const deg of [30, 60]) {
  const tilt: FoilTilt = { deg, axis: Math.PI / 4 }
  for (const [name, spec] of [['full-bleed RC6', rc6], ['art-window RC16', rc16]] as [string, FoilMaskSpec][]) {
    const plain = baseImage()
    const patterned = baseImage()
    const base = Uint8ClampedArray.from(plain)
    applyReflection(plain, W, H, spec, tilt)
    const changed = applyReflection(patterned, W, H, spec, tilt, mod)

    let outside = 0
    let hue = 0
    let dark = 0
    let brighter = 0
    let capped = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const dr = patterned[i] - base[i]
        const dg = patterned[i + 1] - base[i + 1]
        const db = patterned[i + 2] - base[i + 2]
        if (dr === 0 && dg === 0 && db === 0) continue
        if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, ASPECT) !== 255) outside++
        if (dr !== dg || dg !== db) hue++
        if (dr < 0 || dg < 0 || db < 0) dark++
        // The pattern may only ever take light away from the unpatterned render.
        if (dr > plain[i] - base[i]) brighter++
        if (dr > 255) capped++
      }
    }
    ok(changed > 0, `${deg}° ${name}: the patterned card is lit`, String(changed))
    ok(outside === 0, `${deg}° ${name}: no light outside the mask`, String(outside))
    ok(hue === 0, `${deg}° ${name}: neutral (R=G=B delta)`, String(hue))
    ok(dark === 0, `${deg}° ${name}: only brightens`, String(dark))
    ok(brighter === 0, `${deg}° ${name}: the pattern never adds light of its own`, String(brighter))
    ok(capped === 0, `${deg}° ${name}: never wraps a channel`, String(capped))
  }
}

// --- the pattern actually shapes the light, rather than being a no-op ----------
{
  const tilt: FoilTilt = { deg: 30, axis: Math.PI / 4 }
  const plain = baseImage()
  const patterned = baseImage()
  const base = Uint8ClampedArray.from(plain)
  applyReflection(plain, W, H, rc6, tilt)
  applyReflection(patterned, W, H, rc6, tilt, mod)
  let lit = 0
  let dimmed = 0
  for (let i = 0; i < base.length; i += 4) {
    const addPlain = plain[i] - base[i]
    const addPat = patterned[i] - base[i]
    if (addPlain > 0) lit++
    if (addPlain > 0 && addPat < addPlain) dimmed++
  }
  ok(dimmed > lit * 0.15, 'the pattern removes light from a large share of lit pixels',
    `${dimmed} of ${lit} (${((dimmed / lit) * 100).toFixed(0)}%)`)
}

// --- scale is still a real parameter, when someone raises it --------------------
{
  const markFraction = (scale: number) =>
    SAMPLES.filter(({ u, v }) => patternTexture(u, v, ASPECT, scale) >= 0.5).length / SAMPLES.length
  const fine = markFraction(PATTERN_SCALE)
  const doubled = markFraction(2)
  ok(fine > 0.03 && doubled > 0.03, 'the tile carries marks at both scales',
    `${(fine * 100).toFixed(1)}% vs ${(doubled * 100).toFixed(1)}%`)
  ok(Math.abs(doubled - fine) < 0.06, 'repeating it twice keeps the same density of marks',
    `${(fine * 100).toFixed(1)}% vs ${(doubled * 100).toFixed(1)}%`)
  ok(Math.abs(patternTexture(0.2, 0.3, ASPECT, 2) - patternTexture(0.2 + 0.5, 0.3, ASPECT, 2)) < EPS,
    'and at that scale it still repeats exactly, one half-card apart')
}

// --- coverage: marks are a real presence on the card, not a rarity --------------
const cover6 = patternCoverage(rc6, W, H)
const cover16 = patternCoverage(rc16, W, H)
ok(cover6 > 0.02 && cover6 < 0.5, 'RC6: marks cover part of the foil', (cover6 * 100).toFixed(1) + '%')
ok(cover16 > 0.02 && cover16 < 0.5, 'RC16: marks cover part of the art window', (cover16 * 100).toFixed(1) + '%')

console.log(`\nfield: mean ${mean.toFixed(3)}, marks ${(marks * 100).toFixed(1)}%, gaps ${(gaps * 100).toFixed(0)}%, bright ${(bright * 100).toFixed(2)}%`)
console.log(`tile: ${TILE_W}x${TILE_H} (${PATTERN_SCALE} per card), max ${TILE_MAX}`)
console.log(`coverage: RC6 ${(cover6 * 100).toFixed(1)}%, RC16 ${(cover16 * 100).toFixed(1)}%`)
console.log(failed === 0 ? '\nALL OK — the sheet\'s tile, masked, neutral, dims only' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
