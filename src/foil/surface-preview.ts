// Preview helpers for the dev inspector: the relief, the normal map itself and a
// pixel diff against the scan.
//
// These are pure functions so the inspector can draw them and a suite can check
// them. They never decide where foil is: the relief is gated by the coverage mask
// exactly as `applySurface` is, and the normal-map and diff previews are
// diagnostic images drawn after the frame is composed.

import { applySurface, type NormalMap } from './surface'
import { maskValue, type FoilMaskSpec } from './mask'

/** Draw the encoded normal map itself: R = x, G = y, B constant. */
export function renderNormalPreview(
  target: Uint8ClampedArray,
  w: number,
  h: number,
  map: NormalMap,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const mx = Math.min(map.w - 1, Math.floor(((x + 0.5) / w) * map.w))
      const my = Math.min(map.h - 1, Math.floor(((y + 0.5) / h) * map.h))
      const i = (my * map.w + mx) * 2
      const o = (y * w + x) * 4
      target[o] = map.data[i]
      target[o + 1] = map.data[i + 1]
      target[o + 2] = 255
      target[o + 3] = 255
    }
  }
}

/** Shade an already-drawn frame with the relief. `strength` is already scaled. */
export function applyRelief(
  target: Uint8ClampedArray,
  w: number,
  h: number,
  spec: FoilMaskSpec | null,
  map: NormalMap,
  strength: number,
): number {
  return applySurface(target, w, h, spec, map, { strength })
}

/** The relief alone over the scan, for the inspector's "relief only" view. */
export function renderReliefPreview(
  target: Uint8ClampedArray,
  base: Uint8ClampedArray,
  w: number,
  h: number,
  spec: FoilMaskSpec | null,
  map: NormalMap,
  strength: number,
): number {
  target.set(base)
  return applyRelief(target, w, h, spec, map, strength)
}

export type DiffStats = {
  /** Pixels whose RGB differs from the scan by any amount. */
  changed: number
  /** Largest per-channel difference, 0..255. */
  maxDelta: number
  /** Mean per-channel difference over changed pixels. */
  meanDelta: number
  /** Changed pixels outside the coverage mask — must stay 0. */
  outside: number
}

/**
 * Overlay where the composed frame differs from the untouched scan. This is the
 * check that the artwork layer really is untouched: at rest every pixel must match,
 * and under tilt changes must stay inside the mask. Changed pixels glow orange,
 * getting whiter with magnitude; a change outside the mask is drawn magenta so a
 * leak cannot hide.
 */
export function renderDiffPreview(
  target: Uint8ClampedArray,
  base: Uint8ClampedArray,
  composite: Uint8ClampedArray,
  w: number,
  h: number,
  spec: FoilMaskSpec | null,
  gain = 6,
): DiffStats {
  let changed = 0
  let maxDelta = 0
  let sumDelta = 0
  let outside = 0
  const aspect = w / h
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const dr = Math.abs(composite[i] - base[i])
      const dg = Math.abs(composite[i + 1] - base[i + 1])
      const db = Math.abs(composite[i + 2] - base[i + 2])
      const d = Math.max(dr, dg, db)
      if (d === 0) {
        // Keep the scan as dim context so the diff still reads as a card.
        const grey = (base[i] + base[i + 1] + base[i + 2]) / 3 * 0.18
        target[i] = grey
        target[i + 1] = grey
        target[i + 2] = grey
      } else {
        changed++
        sumDelta += d
        if (d > maxDelta) maxDelta = d
        const inside = !spec || maskValue(spec, (x + 0.5) / w, (y + 0.5) / h, aspect) !== 0
        if (!inside) outside++
        if (!inside) {
          target[i] = 255
          target[i + 1] = 0
          target[i + 2] = 255
        } else {
          const t = Math.min(1, (d / 255) * gain)
          target[i] = 255
          target[i + 1] = 90 + 165 * t
          target[i + 2] = 40 + 215 * t
        }
      }
      target[i + 3] = 255
    }
  }
  return { changed, maxDelta, meanDelta: changed ? sumDelta / changed : 0, outside }
}
