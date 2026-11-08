// Foil IRIDESCENCE — Phase 5.
//
// Layer 5 of the sheet, and the ONLY layer in the system permitted to add
// colour. Everything before it is neutral: the mask says where foil is, the tile
// says what is on it, the reflection says how bright. This decides what hue that
// light carries — and it changes nothing else.
//
// The three rules it keeps, each of which a pixel test checks:
//
//   1. Face-on is colourless. Chroma is exactly 0 at 0°, so the card at rest is
//      the scan, byte for byte, with no tint to explain away.
//   2. Colour is light, not paint. Every channel delta is >= 0 and no channel
//      wraps; the artwork's own pixels are only ever added to.
//   3. Colour does not change brightness. The tint is renormalised to unit
//      luminance, so the neutral layer still decides how much light there is and
//      this layer only decides what colour it is. A pink highlight and a white
//      one of the same strength measure the same.
//
// Clipping is handled by scaling the whole tint at once, never channel by
// channel: a per-channel clamp is how a hue shift sneaks in where the card is
// near-white.
//
// The hue comes from two things, which is what makes it read as a surface rather
// than a sticker: where you are along the sweep (a band of colour across the
// card) and how far the card is tipped (the whole spectrum slides with the
// angle, ~30° and ~60° being visibly different).

import { maskValue, type FoilMaskSpec } from './mask'
import { MAX_TILT_DEG, bandPosition, reflectionAt, type FoilTilt } from './reflection'

/** Relative luminance weights, so "same brightness" means the same thing here as in the eye. */
const LUM = { r: 0.2126, g: 0.7152, b: 0.0722 }

/** The most colour the light is ever allowed to carry — a strong tint, not a gel. */
export const MAX_CHROMA = 0.75

const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const smoothstep = (t: number) => {
  const c = clamp01(t)
  return c * c * (3 - 2 * c)
}

export type FoilTint = { r: number; g: number; b: number }

/**
 * How much colour the added light carries, 0 (white) to MAX_CHROMA. Deliberately
 * 0 at rest: near face-on a foil is a very slight sheen, and a card you are
 * looking straight at should not look tinted.
 */
export function chromaAt(tilt: FoilTilt): number {
  const deg = Math.min(MAX_TILT_DEG, Math.max(0, tilt.deg))
  if (deg <= 0.001) return 0
  return MAX_CHROMA * smoothstep(deg / MAX_TILT_DEG)
}

/**
 * Hue in degrees at a point: a ramp along the sweep, slid by the tilt. At ~30°
 * the band runs blue-violet into green; at ~60° it has moved well past that.
 */
export function hueAt(u: number, v: number, tilt: FoilTilt): number {
  const t = clamp01(tilt.deg / MAX_TILT_DEG)
  const s = bandPosition(u, v, tilt)
  const hue = 200 + 380 * s + 210 * t
  return ((hue % 360) + 360) % 360
}

/** A hue wheel, softened: three cosine lobes 120° apart. */
function spectrum(hue: number): [number, number, number] {
  const lobe = (x: number) => 0.5 + 0.5 * Math.cos((x * Math.PI) / 180)
  return [lobe(hue), lobe(hue - 120), lobe(hue - 240)]
}

/**
 * The colour of the light at a point, as weights whose luminance is exactly 1.
 * Anything multiplied by these gains the hue without gaining brightness.
 */
export function tintAt(u: number, v: number, tilt: FoilTilt, chromaScale = 1): FoilTint {
  const chroma = chromaAt(tilt) * clamp01(chromaScale)
  if (chroma <= 0) return { r: 1, g: 1, b: 1 }
  const [r0, g0, b0] = spectrum(hueAt(u, v, tilt))
  // Blend toward white, so low tilt is a barely-tinted highlight and high tilt is
  // a full pastel. Then renormalise to unit luminance: the blend must not change
  // how bright the light is, only its colour.
  const white = 1 - chroma
  const r = white + chroma * r0
  const g = white + chroma * g0
  const b = white + chroma * b0
  const lum = LUM.r * r + LUM.g * g + LUM.b * b
  return { r: r / lum, g: g / lum, b: b / lum }
}

/**
 * Composite the iridescent reflection over already-drawn base pixels, in place.
 * Returns how many pixels changed.
 *
 * `modulate` is the Phase 4 pattern; it can only reduce the light, exactly as it
 * does for the neutral layer. It is applied before the tint, so the pattern
 * shapes a coloured highlight rather than the colour shaping the pattern.
 */
export function applyIridescence(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  spec: FoilMaskSpec | null,
  tilt: FoilTilt,
  modulate?: ((u: number, v: number, baseLuma?: number) => number) | null,
  opts: { light?: number; chroma?: number } = {},
): number {
  if (!spec || tilt.deg <= 0.001) return 0
  const lightScale = opts.light ?? 1
  const chromaScale = opts.chroma ?? 1
  const aspect = w / h
  let changed = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const u = (x + 0.5) / w
      const v = (y + 0.5) / h
      if (maskValue(spec, u, v, aspect) === 0) continue
      let light = reflectionAt(u, v, tilt)
      if (light <= 0) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (modulate) light *= modulate(u, v, Math.max(r, g, b) / 255)
      light *= lightScale
      if (light <= 0) continue
      const tint = tintAt(u, v, tilt, chromaScale)
      const wantR = light * 255 * tint.r
      const wantG = light * 255 * tint.g
      const wantB = light * 255 * tint.b
      // One scale factor for all three channels: if the pixel is near-white the
      // whole tint shrinks together, so clipping can never change the hue.
      let k = 1
      if (wantR > 0) k = Math.min(k, (255 - r) / wantR)
      if (wantG > 0) k = Math.min(k, (255 - g) / wantG)
      if (wantB > 0) k = Math.min(k, (255 - b) / wantB)
      k = clamp01(k)
      // Never add more light than the neutral layer would have: a pixel that the
      // neutral reflection left alone has no room for any colour either, even if
      // one channel of the tint would have fitted.
      const headroom = 255 - Math.max(r, g, b)
      k = Math.min(k, headroom / (light * 255))
      const dr = Math.min(255 - r, Math.round(wantR * k))
      const dg = Math.min(255 - g, Math.round(wantG * k))
      const db = Math.min(255 - b, Math.round(wantB * k))
      if (dr <= 0 && dg <= 0 && db <= 0) continue
      data[i] = r + dr
      data[i + 1] = g + dg
      data[i + 2] = b + db
      changed++
    }
  }
  return changed
}

/**
 * Hue in degrees of an additive delta, or NaN when the delta is neutral (a white
 * highlight has no hue, which is the point of the layer underneath).
 */
export function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const c = max - min
  if (c < 1e-9) return NaN
  let h: number
  if (max === r) h = ((g - b) / c) % 6
  else if (max === g) h = (b - r) / c + 2
  else h = (r - g) / c + 4
  return (((h * 60) % 360) + 360) % 360
}
