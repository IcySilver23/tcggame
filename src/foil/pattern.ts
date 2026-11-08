// Foil PATTERN — Phase 4, now carrying the reference sheet's own tile.
//
// Layer 3 of the sheet (Pattern Texture) and layer 4 (Alpha Pattern) live here.
// The pattern answers a different question from the mask: the mask says WHERE
// foil is, this says WHAT is on it.
//
// Where the marks come from
// -------------------------
// This used to be an invented dot-and-sparkle field, because the two RC6 photos
// disagreed about whether the card's hearts were foil or printed artwork, and
// the documented fallback was to leave the hearts alone. The reference asset
// sheet ("Flareon EX RC6/RC32 — Radiant Collection Foil Pattern Assets") settles
// it: its Pattern Tile panel draws glossy hearts AND four-point sparkles as the
// foil marks, at 1:1 with the card. So the marks are no longer drawn by code.
// `tile-data.ts` is that panel, sampled once out of the sheet and reduced to
// luminance; this module only reads it.
//
// Two consequences worth stating plainly:
//
//   - The tile is a CARD-SPACE map: one copy across the card, exactly as the
//     sheet lays it out. That is why PATTERN_SCALE is 1 and not the old 26. The
//     sheet's own edges do not continue across the join (measured: mean 36.6/255
//     left-to-right, 19.4/255 top-to-bottom), so repeating it would show a seam;
//     one copy per card has no join to show.
//   - It carries no colour. The tile is read as luminance only, so it can decide
//     how much light lands where, never what colour the card is. Only the
//     iridescence layer may add colour.
//
// This module is NOT the renderer's fallback. A printing with no shipped
// texture renders plain foil (stages.ts); the RC6 sheet's tile is kept for the
// reference lab, the inspector's provenance and this file's own suite, and it is
// never handed to a card that has a different pattern.

// The one thing this module still does structurally: it can only ever REDUCE
// light. `patternAlpha` maps the tile into [ALPHA_FLOOR, 1] and the reflection is
// multiplied by it, so a mark cannot brighten a card and nothing here can paint.

import { maskValue, type FoilMaskSpec } from './mask'
import { TILE_B64, TILE_H, TILE_MAX, TILE_W } from './tile-data'

/**
 * Copies of the tile across the card. 1 is the sheet's own scale: the tile is a
 * card-shaped map, and the reference draws it once. Raising this repeats it and
 * will show the join described above.
 */
export const PATTERN_SCALE = 1

/**
 * How much light the bare field between the marks keeps.
 *
 * This has to be low for the pattern to mean anything. The sheet's tile is mostly
 * black (69% of it is bare field) because a foil pattern IS the answer to "where
 * does the light land": the marks are the glint and the space between them is
 * quiet foil. With the old 0.58 floor a heart carried roughly 15% more light than
 * the gap beside it, which reads as mottle, not as a heart.
 *
 * It cannot be zero: matte-printed gaps still catch some light, and a hard black
 * field would look like the card had holes in the shiniest part of it.
 */
export const ALPHA_FLOOR = 0.18

/**
 * A mark's own luminance is not linear in how much light it should return — the
 * hearts are mid-grey bodies with bright rims, and read as one shape. Lifting the
 * middle lets the body matter instead of only the rim.
 */
export const PATTERN_GAMMA = 0.85

/** base64 → bytes, in both the browser bundle and the Node test run. */
function decode(bytes: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(bytes)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  const B = (globalThis as unknown as { Buffer: { from(s: string, e: string): Uint8Array } }).Buffer
  return new Uint8Array(B.from(bytes, 'base64'))
}

const TILE = decode(TILE_B64)
if (TILE.length !== TILE_W * TILE_H) {
  throw new Error(`foil tile is ${TILE.length} bytes, expected ${TILE_W * TILE_H}`)
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

/** Position within one tile, wrapped so u=1 is u=0 rather than an edge. */
const wrap = (t: number) => t - Math.floor(t)

/** One tile pixel as a 0..1 value, wrapping in both axes. */
function at(x: number, y: number): number {
  const xx = ((x % TILE_W) + TILE_W) % TILE_W
  const yy = ((y % TILE_H) + TILE_H) % TILE_H
  return TILE[yy * TILE_W + xx] / TILE_MAX
}

/**
 * The tile sampled bilinearly at tile coordinates, wrapping at the edges. Marks
 * are soft at card size (the render is 200px wide against a 192px tile), so
 * nearest-neighbour would alias the fine dots into noise.
 */
export function tileSample(tx: number, ty: number): number {
  const u = wrap(tx) * TILE_W - 0.5
  const v = wrap(ty) * TILE_H - 0.5
  const x0 = Math.floor(u)
  const y0 = Math.floor(v)
  const fx = u - x0
  const fy = v - y0
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx
  return clamp01(top * (1 - fy) + bottom * fy)
}

/**
 * Marks at a point, 0 (bare foil) to 1 (glint centre).
 *
 * `aspect` is accepted for call-site compatibility and deliberately unused: the
 * tile is a card-space map from the sheet, so it is placed by fraction of the
 * card rather than by physical pixels.
 */
export function patternTexture(u: number, v: number, _aspect = 734 / 1024, scale = PATTERN_SCALE): number {
  return tileSample(u * scale, v * scale)
}

/**
 * The same tile in grayscale: the height/`alpha` field. It is not a second
 * pattern — it is the same marks, remapped so bare foil still reflects well over
 * half the light rather than none.
 */
export function patternAlpha(u: number, v: number, _aspect = 734 / 1024, scale = PATTERN_SCALE): number {
  const mark = Math.pow(patternTexture(u, v, _aspect, scale), PATTERN_GAMMA)
  return clamp01(ALPHA_FLOOR + (1 - ALPHA_FLOOR) * mark)
}

/** The multiplier handed to `applyReflection` for a card of this aspect. */
export function patternModulator(aspect = 734 / 1024, scale = PATTERN_SCALE) {
  return (u: number, v: number) => patternAlpha(u, v, aspect, scale)
}

/**
 * Draw the tile into a box, for the lab. Deliberately not card-shaped and not
 * masked: this is what the tile is, before anything cuts it.
 */
export function drawPattern(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: { scale?: number; mode?: 'texture' | 'alpha' } = {},
): void {
  const scale = opts.scale ?? PATTERN_SCALE
  const mode = opts.mode ?? 'texture'
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w
      const v = (y + 0.5) / h
      const g = mode === 'texture' ? patternTexture(u, v, w / h, scale) : patternAlpha(u, v, w / h, scale)
      const c = Math.round(g * 255)
      const i = (y * w + x) * 4
      img.data[i] = c
      img.data[i + 1] = c
      img.data[i + 2] = c
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

/**
 * What fraction of the foil carries a mark (texture above `threshold`). A sanity
 * number: a tile that marks nothing and a tile that marks everything both fail.
 */
export function patternCoverage(
  spec: FoilMaskSpec | null,
  w = 200,
  h = 279,
  threshold = 0.5,
  scale = PATTERN_SCALE,
): number {
  if (!spec) return 0
  const aspect = w / h
  let foil = 0
  let marked = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w
      const v = (y + 0.5) / h
      if (maskValue(spec, u, v, aspect) === 0) continue
      foil++
      if (patternTexture(u, v, aspect, scale) >= threshold) marked++
    }
  }
  return foil > 0 ? marked / foil : 0
}
