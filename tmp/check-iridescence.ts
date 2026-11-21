// Iridescence tests — Phase 5.
//
// The claims this layer makes, and what this file holds it to:
//   1. face-on is colourless and pixel-identical to the scan;
//   2. colour arrives with tilt and the hue slides as the card tips;
//   3. colour is light: nothing darkens, nothing wraps, nothing lands outside
//      the mask;
//   4. colour never out-shines the neutral layer, and on a card with room to
//      spare it adds exactly the same brightness — the tint carries unit
//      luminance;
//   5. clipping scales the whole tint at once, so a near-white pixel keeps the
//      hue it was given instead of skewing toward whichever channel clipped;
//   6. the pattern still shapes the light, and can only take it away.
//
// Note on (4): a saturated highlight needs more of one channel than a white one,
// so where the card is already near-white the tint is scaled back and adds LESS
// light than the neutral layer would. That is a property, not a bug — you cannot
// add magenta to white — so the brightness claim is measured on a card with
// headroom, and the near-white case is checked separately under (5).
import { foilMaskFor, maskValue, type FoilMaskSpec } from '../src/foil/mask'
import { applyReflection, reflectionAt, FACE_ON, type FoilTilt } from '../src/foil/reflection'
import { applyIridescence, chromaAt, hueAt, hueOf, tintAt, MAX_CHROMA } from '../src/foil/iridescence'
import { patternModulator } from '../src/foil/pattern'

let failed = 0
const ok = (cond: boolean, label: string, detail?: string) => {
  if (cond) console.log('ok    ' + label)
  else { failed++; console.log('FAIL  ' + label + (detail ? ' — ' + detail : '')) }
}

const W = 200
const H = 279
const ASPECT = W / H
const AXIS = Math.PI / 4
const rc6 = foilMaskFor({ cardId: 'g1-RC6', rarity: 'Rare Holo EX' })!
const rc16 = foilMaskFor({ cardId: 'g1-RC16', rarity: 'Uncommon' })!
const T = (deg: number): FoilTilt => ({ deg, axis: AXIS })
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** A mid-tone card: every channel has room, so the tint is never scaled back. */
function darkImage(w = W, h = H): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      d[i] = 30 + ((x * 7 + y * 3) % 40)
      d[i + 1] = 34 + ((x * 5 + y * 11) % 36)
      d[i + 2] = 38 + ((x * 13 + y * 2) % 32)
      d[i + 3] = 255
    }
  }
  return d
}

/**
 * A card with a mid-grey block inside the print. Grey, not white, on purpose: on
 * a near-white pixel every delta is 1 or 2 and integer rounding swamps the hue
 * ratio being measured. Mid-grey still clips the tint's dominant channel, with
 * deltas large enough that the ratio means something.
 */
function blockImage(w = W, h = H): Uint8ClampedArray {
  const d = darkImage(w, h)
  for (let y = 140; y < 156; y++) {
    for (let x = 150; x < 166; x++) {
      const i = (y * w + x) * 4
      d[i] = 148
      d[i + 1] = 152
      d[i + 2] = 147
    }
  }
  return d
}

/** A spread of tones, for mask and hue checks. */
function baseImage(w = W, h = H): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      d[i] = (x * 7 + y * 3) % 256
      d[i + 1] = (x * 5 + y * 11) % 256
      d[i + 2] = (x * 13 + y * 2) % 256
      d[i + 3] = 255
    }
  }
  return d
}

/** Circular mean hue of the added light, weighted by how much light was added. */
function meanHue(data: Uint8ClampedArray, base: Uint8ClampedArray): number {
  let sx = 0
  let sy = 0
  for (let i = 0; i < base.length; i += 4) {
    const dr = data[i] - base[i]
    const dg = data[i + 1] - base[i + 1]
    const db = data[i + 2] - base[i + 2]
    if (dr === 0 && dg === 0 && db === 0) continue
    const h = hueOf(dr, dg, db)
    if (Number.isNaN(h)) continue
    const wgt = lum(dr, dg, db)
    sx += wgt * Math.cos((h * Math.PI) / 180)
    sy += wgt * Math.sin((h * Math.PI) / 180)
  }
  return ((((Math.atan2(sy, sx) * 180) / Math.PI) % 360) + 360) % 360
}
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

// --- 1. face-on is colourless ----------------------------------------------------
ok(chromaAt(FACE_ON) === 0, 'chroma is exactly zero face-on', String(chromaAt(FACE_ON)))
{
  const t = tintAt(0.4, 0.6, FACE_ON)
  ok(t.r === 1 && t.g === 1 && t.b === 1, 'the tint face-on is plain white light')
}
{
  const still = baseImage()
  const before = Uint8ClampedArray.from(still)
  const changed = applyIridescence(still, W, H, rc6, FACE_ON, patternModulator(ASPECT))
  ok(changed === 0, 'face-on adds nothing', String(changed))
  ok(still.every((v, i) => v === before[i]), 'face-on composite is byte-identical to the scan')
}

// --- 2. colour arrives with tilt, and the hue slides ------------------------------
const c10 = chromaAt(T(10))
const c30 = chromaAt(T(30))
const c60 = chromaAt(T(60))
ok(c10 < c30 && c30 < c60, 'chroma grows with tilt', `${c10.toFixed(2)} < ${c30.toFixed(2)} < ${c60.toFixed(2)}`)
ok(c30 > 0.15 && c30 < 0.4, 'at 30° the tint is a pastel, not a gel', c30.toFixed(3))
ok(c60 > 0.5 && c60 <= MAX_CHROMA, 'at 60° the tint is strong but bounded', c60.toFixed(3))
ok(hueAt(0.5, 0.5, T(30)) >= 0 && hueAt(0.5, 0.5, T(30)) < 360, 'hue is a usable angle')
{
  const hues = [T(30), T(60)].map((tilt) => {
    const data = baseImage()
    const base = Uint8ClampedArray.from(data)
    applyIridescence(data, W, H, rc6, tilt)
    return meanHue(data, base)
  })
  ok(hueGap(hues[0], hues[1]) >= 20, 'the hue slides as the card tips',
    `30° ${hues[0].toFixed(0)}° → 60° ${hues[1].toFixed(0)}° (Δ ${hueGap(hues[0], hues[1]).toFixed(0)}°)`)
}

// --- 3. the tint itself carries unit luminance ------------------------------------
{
  let worst = 0
  for (let n = 0; n < 400; n++) {
    const u = ((n * 37) % 200) / 200
    const v = ((n * 53) % 279) / 279
    const t = tintAt(u, v, T(20 + (n % 58)))
    worst = Math.max(worst, Math.abs(lum(t.r, t.g, t.b) - 1))
  }
  ok(worst < 1e-9, 'every tint has unit luminance — colour cannot change brightness', worst.toExponential(1))
}

// --- 4/5/6. the composite rules ---------------------------------------------------
const mod = patternModulator(ASPECT)
for (const deg of [30, 60]) {
  const tilt = T(deg)
  for (const [name, spec] of [['full-bleed RC6', rc6], ['art-window RC16', rc16]] as [string, FoilMaskSpec][]) {
    const data = baseImage()
    const base = Uint8ClampedArray.from(data)
    const plain = baseImage()
    applyReflection(plain, W, H, spec, tilt)
    const changed = applyIridescence(data, W, H, spec, tilt, mod)

    let outside = 0
    let darkChannel = 0
    let wrapped = 0
    let over = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const dr = data[i] - base[i]
        const dg = data[i + 1] - base[i + 1]
        const db = data[i + 2] - base[i + 2]
        if (dr === 0 && dg === 0 && db === 0) continue
        if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, ASPECT) !== 255) outside++
        if (dr < 0 || dg < 0 || db < 0) darkChannel++
        if (data[i] > 255 || data[i + 1] > 255 || data[i + 2] > 255) wrapped++
        // Colour may never put more light on a pixel than the neutral layer did.
        if (lum(dr, dg, db) > plain[i] - base[i] + 1.6) over++
      }
    }
    ok(changed > 0, `${deg}° ${name}: the iridescent card is lit`, String(changed))
    ok(outside === 0, `${deg}° ${name}: colour never leaves the mask`, String(outside))
    ok(darkChannel === 0, `${deg}° ${name}: no channel darkens`, String(darkChannel))
    ok(wrapped === 0, `${deg}° ${name}: no channel wraps`, String(wrapped))
    ok(over === 0, `${deg}° ${name}: never out-shines the neutral layer`, String(over))
  }
}

// --- 4. brightness: identical where colour fits, never above it anywhere ------
for (const deg of [30, 60]) {
  const tilt = T(deg)
  const data = darkImage()
  const base = Uint8ClampedArray.from(data)
  const plain = darkImage()
  applyReflection(plain, W, H, rc6, tilt)
  applyIridescence(data, W, H, rc6, tilt)
  let worstFit = 0
  let worstOver = -Infinity
  let fitted = 0
  let saturated = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const dr = data[i] - base[i]
      const dg = data[i + 1] - base[i + 1]
      const db = data[i + 2] - base[i + 2]
      if (dr === 0 && dg === 0 && db === 0) continue
      const neutral = plain[i] - base[i]
      const got = lum(dr, dg, db)
      worstOver = Math.max(worstOver, got - neutral)
      const u = (x + 0.5) / W
      const v = (y + 0.5) / H
      const tint = tintAt(u, v, tilt)
      const brightest = Math.max(tint.r, tint.g, tint.b)
      const wants = reflectionAt(u, v, tilt) * 255 * brightest
      const headroom = 255 - Math.max(base[i], base[i + 1], base[i + 2])
      if (wants <= headroom + 0.5) {
        fitted++
        worstFit = Math.max(worstFit, Math.abs(got - neutral))
      } else {
        saturated++
      }
    }
  }
  ok(fitted > 0 && worstFit <= 1.6, `${deg}° where the tint fits, brightness is the neutral layer's`,
    `worst Δ ${worstFit.toFixed(2)}/255 over ${fitted} px`)
  ok(worstOver <= 1.6, `${deg}° a coloured highlight never out-shines the neutral one`,
    `worst +${worstOver.toFixed(2)}/255`)
  ok(saturated < fitted * 4, `${deg}° most of the foil still carries the full tint`,
    `${saturated} saturated vs ${fitted} fitting`)
}

// --- 5. clipping keeps the hue ----------------------------------------------------
{
  const data = blockImage()
  const base = Uint8ClampedArray.from(data)
  const tilt = T(60)
  applyIridescence(data, W, H, rc6, tilt)
  let checked = 0
  let worstRatio = 0
  let scaledBack = 0
  for (let y = 140; y < 156; y++) {
    for (let x = 150; x < 166; x++) {
      const i = (y * W + x) * 4
      if (maskValue(rc6, (x + 0.5) / W, (y + 0.5) / H, ASPECT) === 0) continue
      const d = [data[i] - base[i], data[i + 1] - base[i + 1], data[i + 2] - base[i + 2]]
      if (Math.max(...d) < 2) continue
      const light = reflectionAt((x + 0.5) / W, (y + 0.5) / H, tilt)
      if (lum(d[0], d[1], d[2]) < light * 255 - 1) scaledBack++
      const want = tintAt((x + 0.5) / W, (y + 0.5) / H, tilt)
      const wa = [want.r, want.g, want.b]
      const dn = d.map((v) => v / Math.max(...d))
      const wn = wa.map((v) => v / Math.max(...wa))
      worstRatio = Math.max(worstRatio, ...dn.map((v, k) => Math.abs(v - wn[k])))
      checked++
    }
  }
  ok(checked > 150, 'the mid-grey block is inside the print and lit', String(checked))
  ok(scaledBack > 0, 'the tint is scaled back where the print has no room', String(scaledBack))
  ok(worstRatio <= 0.06, 'clipping shrinks the whole tint, so the hue survives it', worstRatio.toFixed(3))
}

// --- 6. the pattern can only take light away --------------------------------------
{
  const tilt = T(30)
  const withPattern = baseImage()
  const without = baseImage()
  const base = Uint8ClampedArray.from(withPattern)
  applyIridescence(withPattern, W, H, rc6, tilt, mod)
  applyIridescence(without, W, H, rc6, tilt)
  let lit = 0
  let dimmed = 0
  let brighter = 0
  for (let i = 0; i < base.length; i += 4) {
    const plain = lum(without[i] - base[i], without[i + 1] - base[i + 1], without[i + 2] - base[i + 2])
    const pat = lum(withPattern[i] - base[i], withPattern[i + 1] - base[i + 1], withPattern[i + 2] - base[i + 2])
    if (plain > 0) lit++
    if (plain > 0 && pat < plain - 0.5) dimmed++
    if (plain > 0 && pat > plain + 0.5) brighter++
  }
  ok(brighter === 0, 'the pattern never adds light to the coloured reflection', String(brighter))
  ok(dimmed > lit * 0.15, 'the pattern still shapes the coloured light', `${dimmed} of ${lit} lit px`)
}

// --- hueOf, the measuring stick the tests and the lab share -----------------------
ok(Number.isNaN(hueOf(10, 10, 10)), 'a neutral delta has no hue')
ok(Math.abs(hueOf(10, 0, 0) - 0) < 1, 'red reads as 0°', hueOf(10, 0, 0).toFixed(1))
ok(Math.abs(hueOf(0, 10, 0) - 120) < 1, 'green reads as 120°', hueOf(0, 10, 0).toFixed(1))
ok(Math.abs(hueOf(0, 0, 10) - 240) < 1, 'blue reads as 240°', hueOf(0, 0, 10).toFixed(1))

// --- determinism ------------------------------------------------------------------
ok(tintAt(0.3, 0.7, T(45)).r === tintAt(0.3, 0.7, T(45)).r, 'the tint is deterministic')

console.log(failed === 0 ? '\nALL OK — colour only from tilt, at unit luminance, inside the mask' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
