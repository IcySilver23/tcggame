// Foil SURFACE — embossing and normal maps.
//
// Layers 1-5 decide where foil is, what is on it, how bright it is and what
// colour it carries. They deliberately only ever ADD light. That is right for a
// flat sheet, and wrong for an etched card: a textured ultra rare has ridges that
// catch light on one side and fall into shadow on the other, and a renderer that
// can only brighten cannot show a ridge at all.
//
// So this module is the one place allowed to shade DOWN, and it is fenced:
//
//   - it does nothing unless a normal map is supplied for the printing. No
//     shipped card has one yet, so today this layer is inert and the suite
//     asserts that a frame without a surface is unchanged;
//   - it is gated by the same coverage mask as every other layer, so an emboss
//     can never leave the foil area;
//   - its shading is a single delta applied equally to R, G and B, clamped
//     against the pixel's own headroom in BOTH directions. That keeps the
//     neutral rule (no hue shift) even on a dark pixel where the shadow side
//     would otherwise clip red before green;
//   - it never writes alpha, and never moves a pixel at all when the surface is
//     flat (normal straight out of the card).
//
// Height maps are the practical input: a motif's luminance, or a scan of the
// etched texture, converted by `normalMapFromHeight`. Normals are stored as two
// bytes per pixel (x, y); z is reconstructed, because a height field's normals
// always point out of the card. Two bytes means a decoded normal is unit length
// only within byte quantisation (measured worst case 0.0116), which is the
// tolerance the suite uses.

import { maskValue, type FoilMaskSpec } from './mask'

/** X/Y slope per pixel, encoded 0..255 with 128 meaning "flat". */
export type NormalMap = { w: number; h: number; data: Uint8Array }

/** Raking light from upper-left, which is how an embossed card is usually seen. */
export const DEFAULT_LIGHT: [number, number, number] = [0.32, -0.42, 0.85]

const clamp = (t: number, lo: number, hi: number) => (t < lo ? lo : t > hi ? hi : t)

/**
 * Convert a height field into a normal map.
 *
 * `sample` is asked for height in 0..1 at card-space (u, v); sampling wraps, so a
 * tiling motif produces a tiling relief with no seam. `strength` scales the slope
 * before normalisation — larger values read as a deeper emboss.
 */
export function normalMapFromHeight(
  w: number,
  h: number,
  sample: (u: number, v: number) => number,
  strength = 4,
): NormalMap {
  const data = new Uint8Array(w * h * 2)
  const du = 1 / w
  const dv = 1 / h
  const wrap = (t: number) => t - Math.floor(t)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w
      const v = (y + 0.5) / h
      const hl = sample(wrap(u - du), v)
      const hr = sample(wrap(u + du), v)
      const hu = sample(u, wrap(v - dv))
      const hd = sample(u, wrap(v + dv))
      // Height rises toward the right/bottom → the surface tilts away from it.
      const nx = -(hr - hl) * 0.5 * strength
      const ny = -(hd - hu) * 0.5 * strength
      const len = Math.hypot(nx, ny, 1)
      const i = (y * w + x) * 2
      data[i] = Math.round((nx / len) * 127.5 + 127.5)
      data[i + 1] = Math.round((ny / len) * 127.5 + 127.5)
    }
  }
  return { w, h, data }
}

/** Decode one stored normal into a unit vector, z reconstructed from the slope. */
function normalAt(map: NormalMap, x: number, y: number): [number, number, number] {
  const i = (y * map.w + x) * 2
  const nx = (map.data[i] - 127.5) / 127.5
  const ny = (map.data[i + 1] - 127.5) / 127.5
  const len = Math.hypot(nx, ny, 1)
  return [nx / len, ny / len, 1 / len]
}

/**
 * Shade an embossed foil region in place. Returns how many pixels changed.
 *
 * The flat reference is important: a normal of (0, 0, 1) gives exactly zero
 * delta, so "no relief here" means "pixels untouched" rather than "pixels
 * multiplied by one".
 */
export function applySurface(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  spec: FoilMaskSpec | null,
  map: NormalMap,
  opts: { strength?: number; light?: [number, number, number] } = {},
): number {
  if (!spec) return 0
  const strength = clamp(opts.strength ?? 0.5, 0, 1)
  if (strength <= 0) return 0
  const l = opts.light ?? DEFAULT_LIGHT
  const lLen = Math.hypot(l[0], l[1], l[2]) || 1
  const lx = l[0] / lLen
  const ly = l[1] / lLen
  const lz = l[2] / lLen
  const aspect = w / h
  // Two passes: collect each pixel's clamped delta and its symmetric room, then
  // remove the mean. Embossing should redistribute light across a ridge, not
  // change the card's exposure, and clamping would otherwise leave a bias.
  const deltas = new Int16Array(w * h)
  const rooms = new Uint8Array(w * h)
  let changed = 0
  let sum = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w
      const v = (y + 0.5) / h
      if (maskValue(spec, u, v, aspect) === 0) continue
      const mx = clamp(Math.floor(u * map.w), 0, map.w - 1)
      const my = clamp(Math.floor(v * map.h), 0, map.h - 1)
      const [nx, ny, nz] = normalAt(map, mx, my)
      // Difference from a flat surface lit by the same lamp: positive is the lit
      // side of a ridge, negative is the shadow side.
      const shade = nx * lx + ny * ly + nz * lz - lz
      if (Math.abs(shade) < 1e-6) continue
      const i = (y * w + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const want = shade * strength * 255
      // One delta for all channels, clamped by the tightest room in the needed
      // direction, so shading never shifts hue.
      // Symmetric room: the tighter direction is used for BOTH signs, so a lit
      // ridge cannot buy more light than its matching groove can spend. Clamping
      // each direction separately would leave a net brightening on light cards.
      const room = Math.min(Math.min(r, g, b), 255 - Math.max(r, g, b))
      const delta = Math.round(clamp(want, -room, room))
      if (delta === 0) continue
      deltas[y * w + x] = delta
      rooms[y * w + x] = room
      sum += delta
      changed++
    }
  }
  if (changed === 0) return 0
  const bias = Math.round(sum / changed)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      if (deltas[k] === 0) continue
      const i = k * 4
      const delta = clamp(deltas[k] - bias, -rooms[k], rooms[k])
      data[i] += delta
      data[i + 1] += delta
      data[i + 2] += delta
    }
  }
  return changed
}
