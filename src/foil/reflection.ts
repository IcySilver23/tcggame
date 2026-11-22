// Foil REFLECTION — Phase 3.
//
// The only layer allowed to change how bright a card looks, and (from Phase 5)
// the only one allowed to add colour. This phase is deliberately neutral: the
// reflection adds the same amount to R, G and B, so every pixel it touches gets
// brighter without shifting hue. If the maths here is wrong, it is wrong in a
// way a pixel test can catch.
//
// Rules this module keeps:
//   - face-on (0°) reflects nothing at all, so the composite at rest is the
//     scan, byte for byte;
//   - reflection never writes where the coverage mask says there is no foil;
//   - reflection only ever brightens, and never clips one channel harder than
//     another (that would be a hue shift wearing a neutral's clothes).
//
// It does not know about patterns, textures or hue — those are later layers. The
// Phase 4 pattern enters through an optional `modulate` multiplier, which can
// only scale the light down (0..1), never recolour it or move it outside the
// mask, so the rules above hold whether or not a pattern is present.

import { maskCoverage, maskValue, type FoilMaskSpec } from './mask'

/**
 * Width of the foil's soft edge, in buffer pixels. Wide enough that the boundary
 * is a ramp rather than a one-pixel jump, narrow enough that the foil still ends
 * where the printing says it does.
 */
export const EDGE_FEATHER_PX = 4

/** Past this, a card is edge-on and no longer readable; we stop there too. */
export const MAX_TILT_DEG = 78

const DEFAULT_AXIS = Math.PI / 4

/** How the card is being held: degrees off face-on, and the axis of the sweep. */
export type FoilTilt = { deg: number; axis: number }

export const FACE_ON: FoilTilt = { deg: 0, axis: DEFAULT_AXIS }

/**
 * Pointer position → tilt. Centre of the card is face-on; the further out the
 * pointer sits, the further the card is imagined to be tipped, up to 60° at the
 * edge. The direction of the offset sets which way the sweep runs.
 */
export function tiltForPointer(nx: number, ny: number): FoilTilt {
  const r = Math.hypot(nx, ny)
  const deg = Math.min(MAX_TILT_DEG, r * 60)
  const axis = r < 1e-3 ? DEFAULT_AXIS : Math.atan2(ny, nx)
  return { deg, axis }
}

/**
 * Position along the band's normal, normalised so the card box spans 0..1 for
 * any axis (the diagonals are longer than the sides). The reflection puts its
 * band here; the iridescence reads the same coordinate, so the colour travels
 * with the light instead of drifting across it.
 */
export function bandPosition(u: number, v: number, tilt: FoilTilt): number {
  const ca = Math.cos(tilt.axis)
  const sa = Math.sin(tilt.axis)
  const norm = Math.abs(ca) + Math.abs(sa) || 1
  return (u * ca + v * sa) / norm
}

/**
 * Added luminance at a point, 0 (nothing) to 1 (a fully lit band). Two bands
 * of different width give the sweep a core and a halo, which is what a curved,
 * slightly uneven foil surface actually does.
 */
export function reflectionAt(u: number, v: number, tilt: FoilTilt): number {
  const deg = Math.min(MAX_TILT_DEG, Math.max(0, tilt.deg))
  // Face-on is not "a dim reflection" — it is no reflection. Anything else
  // would change the artwork at rest, which is exactly what went wrong before.
  if (deg <= 0.001) return 0

  const t = deg / MAX_TILT_DEG
  const s = bandPosition(u, v, tilt)

  // The band crosses the card as it tips: upper-left at low angles, lower-right
  // as the card comes up.
  const core = Math.max(0, 1 - Math.abs(s - (0.10 + 0.80 * t)) / 0.46)
  const halo = Math.max(0, 1 - Math.abs(s - (0.10 + 0.80 * t) + 0.36) / 0.86)
  const gain = 0.80 * Math.pow(t, 0.5) * Math.pow(core, 1.1)
    + 0.30 * Math.pow(t, 0.6) * Math.pow(halo, 1.4)
  return Math.min(0.85, Math.max(0, gain))
}

/**
 * Composite the reflection over already-drawn base pixels, in place.
 * Returns how many pixels changed, which is what the tests count.
 *
 * The base is read, never inferred: a pixel outside the mask is not touched at
 * all, and the added amount is capped by the darkest channel's headroom so R, G
 * and B always move by the same integer.
 *
 * `modulate` is the Phase 4 pattern hook: a 0..1 multiplier per point. It can
 * only reduce the light, so a patterned card is dimmer than a bare one and never
 * brighter, and the mask still decides where any light may land.
 */
export function applyReflection(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  spec: FoilMaskSpec | null,
  tilt: FoilTilt,
  modulate?: ((u: number, v: number, baseLuma?: number) => number) | null,
  strength = 1,
): number {
  if (!spec || tilt.deg <= 0.001) return 0
  const aspect = w / h
  let changed = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const u = (x + 0.5) / w
      const v = (y + 0.5) / h
      // Coverage, not a yes/no: the mask's edge fades inward so the foil meets
      // the print instead of drawing a line around itself.
      const cov = maskCoverage(spec, u, v, aspect, EDGE_FEATHER_PX / w)
      if (cov <= 0) continue
      let b = reflectionAt(u, v, tilt)
      if (b <= 0) continue
      const r = data[i]
      const g = data[i + 1]
      const bl = data[i + 2]
      const m = modulate ? modulate(u, v, Math.max(r, g, bl) / 255) : 1
      if (m <= 0) continue
      b *= strength * cov
      if (b <= 0) continue
      const headroom = 255 - Math.max(r, g, bl)
      const add = Math.min(Math.round(b * m * 255), headroom)
      if (add <= 0) continue
      data[i] = r + add
      data[i + 1] = g + add
      data[i + 2] = bl + add
      changed++
    }
  }
  return changed
}

/** The fractional position of the added light, for checking that it sweeps. */
export function lightCentroid(spec: FoilMaskSpec | null, tilt: FoilTilt, w = 160, h = 223): number {
  if (!spec) return 0
  const aspect = w / h
  const axis = tilt.axis
  const norm = Math.abs(Math.cos(axis)) + Math.abs(Math.sin(axis)) || 1
  let sum = 0
  let weight = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w
      const v = (y + 0.5) / h
      if (maskValue(spec, u, v, aspect) === 0) continue
      const b = reflectionAt(u, v, tilt)
      if (b <= 0) continue
      sum += b * ((u * Math.cos(axis) + v * Math.sin(axis)) / norm)
      weight += b
    }
  }
  return weight > 0 ? sum / weight : 0
}
