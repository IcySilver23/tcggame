// Phase 1 engine tests.
//
// The engine is only worth having if it does not change what the shipped cards
// already look like, so the first test is a byte comparison against the stage
// pipeline it now wraps. The rest hold the new capabilities to the rules the
// layers below already keep: the mask gates every layer, a region can be dimmer
// than the card, disjoint regions compose in either order, and embossing is
// inert without a normal map and confined to the foil when it has one.
import { foilMaskFor, maskValue, type FoilMaskSpec } from '../src/foil/mask'
import { FACE_ON, type FoilTilt } from '../src/foil/reflection'
import { DEFAULT_FOIL_SETTINGS, meanLift, paintFoil } from '../src/foil/stages'
import { composeFrame, type FoilLayer } from '../src/foil/engine'
import { applySurface, normalMapFromHeight, type NormalMap } from '../src/foil/surface'
import type { MarkField } from '../src/foil/mark-field'

let failed = 0
const ok = (cond: boolean, label: string, detail?: string) => {
  if (cond) console.log('ok    ' + label)
  else { failed++; console.log('FAIL  ' + label + (detail ? ' — ' + detail : '')) }
}

const W = 200
const H = 279
const ASPECT = W / H
const TILT: FoilTilt = { deg: 48, axis: Math.PI / 4 }

const art = foilMaskFor({ cardId: 'g1-RC16', rarity: 'Uncommon' })!
const outside: FoilMaskSpec = { ...art, kind: 'outsideArt', evidence: 'test: the complement of the window' }

/** A plain foil has no marks, so nothing but light and mask is in play. */
const plain: MarkField = {
  id: 'test:plain',
  label: 'plain',
  mark: () => 1,
  opacity: () => 1,
  coverage: 1,
  peak: 1,
  verified: false,
  plain: true,
  note: 'uniform light, no marks',
  meta: {},
}

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

const base = baseImage()

function same(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function changedCount(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++
  }
  return n
}

/** Every changed pixel must sit inside this layer's own mask. */
function onlyInside(a: Uint8ClampedArray, b: Uint8ClampedArray, spec: FoilMaskSpec): boolean {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const changed = a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]
      if (!changed) continue
      if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, ASPECT) === 0) return false
    }
  }
  return true
}

/** Pixel indices changed by a composition, for comparing two layers' regions. */
function changedSet(a: Uint8ClampedArray, b: Uint8ClampedArray): Set<number> {
  const s = new Set<number>()
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) s.add(i / 4)
  }
  return s
}

const one = (spec: FoilMaskSpec | null): FoilLayer => ({ id: 'test', spec, field: plain })

// ---------------------------------------------------------------- compatibility
{
  const staged = new Uint8ClampedArray(base.length)
  paintFoil(staged, base, W, H, art, TILT, {
    mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field: plain,
  })
  const framed = composeFrame(base, W, H, { tilt: TILT, layers: [one(art)] })
  ok(same(staged, framed), 'one engine layer is byte-identical to the stage pipeline')
  ok(changedCount(base, framed) > 0, 'and that layer actually did something', String(changedCount(base, framed)))
}

{
  const rest = composeFrame(base, W, H, { tilt: FACE_ON, layers: [one(art)] })
  ok(same(rest, base), 'a frame at rest is the scan, byte for byte')
}

{
  const none = composeFrame(base, W, H, { tilt: TILT, layers: [one(null)] })
  ok(same(none, base), 'a null spec is no layer, not an unmasked one')
}

// ------------------------------------------------------------------- two regions
{
  const both = composeFrame(base, W, H, { tilt: TILT, layers: [one(art), one(outside)] })
  const artOnly = composeFrame(base, W, H, { tilt: TILT, layers: [one(art)] })
  const outOnly = composeFrame(base, W, H, { tilt: TILT, layers: [one(outside)] })
  ok(onlyInside(base, artOnly, art), 'the window layer stays inside the window')
  ok(onlyInside(base, outOnly, outside), 'the body layer stays outside the window')
  const a = changedSet(base, artOnly)
  const b = changedSet(base, outOnly)
  let overlap = 0
  for (const p of a) if (b.has(p)) overlap++
  ok(a.size > 0 && b.size > 0, 'both regions are lit', `${a.size} + ${b.size}`)
  ok(overlap === 0, 'the two masks are disjoint, so no pixel is lit twice', String(overlap))
  ok(changedCount(base, both) === a.size + b.size, 'two disjoint layers change exactly their two areas',
    `${changedCount(base, both)} vs ${a.size + b.size}`)
}

{
  const ab = composeFrame(base, W, H, { tilt: TILT, layers: [one(art), one(outside)] })
  const ba = composeFrame(base, W, H, { tilt: TILT, layers: [one(outside), one(art)] })
  ok(same(ab, ba), 'disjoint regions compose identically in either order')
}

// ---------------------------------------------------------- per-region brightness
{
  const full = composeFrame(base, W, H, { tilt: TILT, layers: [one(art)] })
  const dim = composeFrame(base, W, H, {
    tilt: TILT, layers: [{ ...one(art), reflectivity: 0.5 }],
  })
  const off = composeFrame(base, W, H, {
    tilt: TILT, layers: [{ ...one(art), reflectivity: 0 }],
  })
  const lf = meanLift(base, full, W, H, art)
  const ld = meanLift(base, dim, W, H, art)
  ok(lf > ld && ld > 0, 'a region at 0.5 reflectivity is dimmer but still lit', `${lf.toFixed(1)} vs ${ld.toFixed(1)}`)
  ok(same(off, base), 'reflectivity 0 turns that region off entirely')
}

// ----------------------------------------------------------------------- surface
{
  const withLayer = composeFrame(base, W, H, { tilt: FACE_ON, layers: [one(art)] })
  const withNullSurface = composeFrame(base, W, H, {
    tilt: FACE_ON, layers: [{ ...one(art), surface: null }],
  })
  ok(same(withLayer, withNullSurface), 'no surface map means no surface pass')

  const flatMap = normalMapFromHeight(64, 64, () => 0.5, 8)
  const flat = composeFrame(base, W, H, {
    tilt: FACE_ON,
    layers: [{ ...one(art), surface: { map: flatMap, strength: 0.8 } }],
  })
  ok(same(flat, base), 'a flat normal map adds nothing at all')

  const bump = normalMapFromHeight(64, 64, (u, v) => 0.5 + 0.25 * Math.cos(u * Math.PI * 2) * Math.cos(v * Math.PI * 2), 8)
  // Surfaces fade in with tilt, so a relief is measured away from rest.
  const relief = composeFrame(base, W, H, {
    tilt: TILT,
    layers: [{ ...one(art), surface: { map: bump, strength: 0.6 } }],
  })
  ok(onlyInside(base, relief, art), 'embossing never leaves the foil mask')
  ok(changedCount(base, relief) > 0, 'a bumpy normal map does shade the foil', String(changedCount(base, relief)))
  let alpha = true
  for (let i = 3; i < relief.length; i += 4) if (relief[i] !== base[i]) { alpha = false; break }
  ok(alpha, 'embossing never writes alpha')
  // The relief sits on top of the foil, so its own mean is measured against the
  // same frame without a surface — otherwise the sheen's light is counted as bias.
  const unembossed = composeFrame(base, W, H, { tilt: TILT, layers: [one(art)] })
  let sum = 0
  let n = 0
  for (let i = 0; i < relief.length; i += 4) {
    const d = relief[i] - unembossed[i]
    if (d !== 0) { sum += d; n++ }
  }
  const mean = n ? sum / n : 0
  ok(Math.abs(mean) < 2, 'a symmetric relief has no net brightness change', mean.toFixed(2))
}

// ---------------------------------------------------------- relief on its own mask
{
  // A special ball reverse needs both claims at once: foil outside the art, etch
  // across it. `surfaceSpec` is the separate relief mask that makes that legal.
  const full: FoilMaskSpec = {
    ...art, kind: 'full', rect: { x: 0, y: 0, w: 1, h: 1 },
    evidence: 'test: full-card etch',
  }
  const bump2 = normalMapFromHeight(48, 48, (u, v) => 0.5 + 0.25 * Math.cos(u * Math.PI * 2) * Math.cos(v * Math.PI * 2), 8)
  const etchedLayer = {
    ...one(outside),
    surface: { map: bump2, strength: 0.6 },
    surfaceSpec: full,
  }
  const foilOnly = composeFrame(base, W, H, { tilt: TILT, layers: [one(outside)] })
  const etched = composeFrame(base, W, H, { tilt: TILT, layers: [etchedLayer] })
  const etchOnly = composeFrame(base, W, H, {
    tilt: TILT,
    layers: [{ id: 'etch', spec: null, surface: { map: bump2, strength: 0.6 }, surfaceSpec: full }],
  })
  const rest = composeFrame(base, W, H, {
    tilt: FACE_ON,
    layers: [{ id: 'etch', spec: null, surface: { map: bump2, strength: 0.6 }, surfaceSpec: full }],
  })
  ok(same(rest, base), 'a full-card etch at rest is the scan, byte for byte')
  let foilInsideArt = 0
  let etchInsideArt = 0
  let etchOutsideArt = 0
  let etchOnlyInsideArt = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W
      const v = (y + 0.5) / H
      const inArt = maskValue(art, u, v, ASPECT) === 255
      const i = (y * W + x) * 4
      const foilChanged = foilOnly[i] !== base[i] || foilOnly[i + 1] !== base[i + 1] || foilOnly[i + 2] !== base[i + 2]
      const etchChanged = etched[i] !== foilOnly[i] || etched[i + 1] !== foilOnly[i + 1] || etched[i + 2] !== foilOnly[i + 2]
      const onlyChanged = etchOnly[i] !== base[i] || etchOnly[i + 1] !== base[i + 1] || etchOnly[i + 2] !== base[i + 2]
      if (inArt && foilChanged) foilInsideArt++
      if (inArt && etchChanged) etchInsideArt++
      if (!inArt && etchChanged) etchOutsideArt++
      if (inArt && onlyChanged) etchOnlyInsideArt++
    }
  }
  ok(foilInsideArt === 0, 'the foil mask still puts no light inside the artwork', String(foilInsideArt))
  ok(etchInsideArt > 0, 'the separate etch mask shades the artwork', String(etchInsideArt))
  ok(etchOutsideArt > 0, 'and keeps shading the body', String(etchOutsideArt))
  ok(etchOnlyInsideArt > 0, 'a surface-only layer can cover the full card', String(etchOnlyInsideArt))
  ok(onlyInside(base, etchOnly, full), 'the full-card relief never leaves the card mask')
}

// ------------------------------------------------------------------ normal maths
{
  const height = (u: number, v: number) => 0.5 + 0.2 * Math.sin(u * Math.PI * 2) * Math.cos(v * Math.PI * 2)
  const map: NormalMap = normalMapFromHeight(32, 32, height, 4)
  let unit = true
  let flatish = true
  for (let i = 0; i < map.data.length; i += 2) {
    const nx = (map.data[i] - 127.5) / 127.5
    const ny = (map.data[i + 1] - 127.5) / 127.5
    const len = Math.hypot(nx, ny, 1)
    // Stored as two bytes: measured worst-case deviation is 0.0116, so 0.012 is
    // the encoder's real precision rather than a tuned tolerance.
    if (Math.abs(len - 1) > 0.012) unit = false
    if (Math.abs(nx) > 1 || Math.abs(ny) > 1) flatish = false
  }
  ok(unit, 'every stored normal is unit length')
  ok(flatish, 'stored slopes stay within the encodable range')
  const flat = normalMapFromHeight(8, 8, () => 0.75, 4)
  let centred = true
  for (let i = 0; i < flat.data.length; i++) if (Math.abs(flat.data[i] - 128) > 1) centred = false
  ok(centred, 'a constant height encodes as a flat normal')

  const copy = new Uint8ClampedArray(base)
  const touched = applySurface(copy, W, H, null, map)
  ok(touched === 0 && same(copy, base), 'the surface pass refuses a null mask')
}

console.log(failed === 0 ? '\nALL OK — engine checks' : `\nFAILURES: ${failed}`)
process.exit(failed === 0 ? 0 : 1)
