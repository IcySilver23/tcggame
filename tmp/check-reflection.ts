// Reflection tests — Phase 3.
//
// The claims this layer makes, and the ones these tests hold it to:
//   1. face-on adds nothing, so the card at rest is the scan, byte for byte;
//   2. light only lands where the coverage mask says foil exists;
//   3. the light is neutral — R, G and B move by the same integer;
//   4. it only brightens, and never clips one channel before another;
//   5. it sweeps across the card as the tilt increases.
//
// Note on (2): the bounds are read from the mask itself. An earlier version
// hand-rolled the corner radius and the art window here and "failed" the
// renderer while actually disagreeing with the mask by a few pixels — the mask
// is the authority, so the test asks it, and pinned probe points below prove it
// is not just agreeing with itself.
import { foilMaskFor, maskValue, type FoilMaskSpec } from '../src/foil/mask'
import { applyReflection, reflectionAt, tiltForPointer, FACE_ON, lightCentroid } from '../src/foil/reflection'

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

/** A base image with a real spread of brightness, including near-white pixels. */
function baseImage(w = W, h = H): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      d[i] = (x * 7 + y * 3) % 256
      d[i + 1] = (x * 5 + y * 11) % 256
      d[i + 2] = (x * 13 + y * 2) % 256
      d[i + 3] = 255
      // A blown-out corner, to prove the headroom cap keeps deltas equal.
      if (x > w - 12 && y < 12) { d[i] = 254; d[i + 1] = 255; d[i + 2] = 250 }
    }
  }
  return d
}

// --- 1. face-on is the artwork -------------------------------------------------
const still = baseImage()
const before = Uint8ClampedArray.from(still)
const changedAtRest = applyReflection(still, W, H, rc6, FACE_ON)
ok(changedAtRest === 0, 'face-on changes no pixels', String(changedAtRest))
ok(still.every((v, i) => v === before[i]), 'face-on composite is byte-identical to the base')

// --- pinned points, so the mask checks below are not self-confirming ----------
type Probe = { u: number; v: number; foil: boolean; what: string }
const PROBES: { name: string; spec: FoilMaskSpec; probes: Probe[] }[] = [
  {
    name: 'full-bleed RC6', spec: rc6, probes: [
      { u: 0.5, v: 0.5, foil: true, what: 'centre' },
      { u: 0.5, v: 0.03, foil: true, what: 'top edge' },
      { u: 0.002, v: 0.002, foil: false, what: 'cut corner' },
      { u: 0.998, v: 0.998, foil: false, what: 'cut corner' },
    ],
  },
  {
    name: 'art-window RC16', spec: rc16, probes: [
      { u: 0.5, v: 0.3, foil: true, what: 'art window' },
      { u: 0.5, v: 0.05, foil: false, what: 'name bar' },
      { u: 0.5, v: 0.63, foil: false, what: 'text panel' },
      { u: 0.02, v: 0.3, foil: false, what: 'left frame' },
      { u: 0.002, v: 0.002, foil: false, what: 'cut corner' },
    ],
  },
]

// --- 2/3/4. tilted: masked, neutral, brightening only --------------------------
for (const deg of [30, 60]) {
  const tilt = { deg, axis: Math.PI / 4 }
  for (const { name, spec, probes } of PROBES) {
    const data = baseImage()
    const base = Uint8ClampedArray.from(data)
    const changed = applyReflection(data, W, H, spec, tilt)

    let outsideMask = 0
    let hueShift = 0
    let darkened = 0
    let maxAdd = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const dr = data[i] - base[i]
        const dg = data[i + 1] - base[i + 1]
        const db = data[i + 2] - base[i + 2]
        if (dr === 0 && dg === 0 && db === 0) continue
        if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, ASPECT) !== 255) outsideMask++
        if (dr !== dg || dg !== db) hueShift++
        if (dr < 0 || dg < 0 || db < 0) darkened++
        if (dr > maxAdd) maxAdd = dr
      }
    }
    ok(changed > 0, `${deg}° ${name}: adds light`, String(changed))
    ok(outsideMask === 0, `${deg}° ${name}: no light where the mask is black`, String(outsideMask))
    ok(hueShift === 0, `${deg}° ${name}: neutral (R=G=B delta on every changed pixel)`, String(hueShift))
    ok(darkened === 0, `${deg}° ${name}: only brightens`, String(darkened))
    ok(maxAdd <= 255, `${deg}° ${name}: never wraps a channel`, String(maxAdd))

    // Pinned probes: the band should reach the centre of RC6 and the middle of
    // RC16's art window, and must be blocked by the name bar, text panel, frame
    // and cut corners even where the band itself is bright.
    for (const p of probes) {
      const x = Math.min(W - 1, Math.max(0, Math.floor(p.u * W)))
      const y = Math.min(H - 1, Math.max(0, Math.floor(p.v * H)))
      const i = (y * W + x) * 4
      const lit = data[i] - base[i]
      if (p.foil) {
        // Not every foil point is inside the band at a given tilt, so only the
        // probes that should be lit are asserted; centre/window are in the band.
        const expected = p.what === 'centre' || p.what === 'art window' || p.what === 'top edge'
        if (expected) ok(lit > 0, `${deg}° ${name}: ${p.what} is lit`, String(lit))
      } else {
        ok(lit === 0, `${deg}° ${name}: ${p.what} stays unlit`, String(lit))
      }
    }
  }
}

// --- 5. the band sweeps ---------------------------------------------------------
const c30 = lightCentroid(rc6, { deg: 30, axis: Math.PI / 4 })
const c60 = lightCentroid(rc6, { deg: 60, axis: Math.PI / 4 })
ok(c60 > c30 + 0.02, 'the reflection sweeps across the card as tilt increases',
  `30°=${c30.toFixed(3)} 60°=${c60.toFixed(3)}`)

// --- pointer mapping -------------------------------------------------------------
ok(tiltForPointer(0, 0).deg === 0, 'pointer at the centre is face-on')
ok(tiltForPointer(1, 0).deg > tiltForPointer(0.3, 0).deg, 'further from centre tilts further')
ok(tiltForPointer(0, -1).axis < 0, 'pointer above centre sweeps the other way',
  String(tiltForPointer(0, -1).axis))
ok(reflectionAt(0.5, 0.5, FACE_ON) === 0, 'reflection is exactly zero face-on')
ok(reflectionAt(0.5, 0.5, { deg: 60, axis: Math.PI / 4 }) > 0, 'there is light at 60°')
ok(reflectionAt(0.5, 0.5, { deg: 60, axis: Math.PI / 4 }) <= 0.85, 'the reflection is bounded')

console.log(failed === 0 ? '\nALL OK — neutral reflection, masked, zero at rest' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
