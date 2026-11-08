// The Radiant Collection concept textures, loaded and sampled.
//
// Each card owns a 768x768 RGBA motif in the pack. That file is the *pattern*;
// its alpha channel is the pattern's own opacity (the separate pattern_alpha.png
// turned out to be byte-identical to it for all 57 cards, which the generator
// verifies and records).
//
// Two things this module refuses to do:
//
//   - It never turns the motif's pastel colour into card colour. The bows are
//     pink, peach and lilac in the PNG; here only their coverage and their
//     luminance survive, because the pattern layer is only allowed to decide
//     WHERE light lands. Hue belongs to the iridescence layer and to the print.
//   - It never invents a motif. If a card has no asset, or the texture cannot be
//     fetched or decoded, the answer is null and the caller falls back rather
//     than drawing something made up.
//
// Textures are decoded once per card and cached, downsampled to a 192-grid with
// a box filter: a 768px motif sampled bilinearly at 200px card width would
// shimmer, and the full-resolution float copy would cost ~9 MB per card.

import { RADIANT_ASSETS, type RadiantAsset } from './radiant-index'

/** Side of the downsampled sampling grid. */
export const GRID = 192

/**
 * The card the texture is drawn on is 734x1024, so a square motif cannot cover
 * it without stretching. Anchoring one copy to the card WIDTH and letting the
 * square wrap vertically keeps the bows circular; stretching the square over a
 * card-shaped area would turn every bow into a vertical oval.
 */
export const CARD_ASPECT = 734 / 1024

export type PatternMap = {
  cardId: string
  /** Side of the square grid `mark` and `opacity` are stored on. */
  size: number
  /** 0..1 per texel: the motif's ink, weighted by its own opacity. */
  mark: Float32Array
  /** 0..1 per texel: opacity alone, for the debug panel's alpha view. */
  opacity: Float32Array
  /** Fraction of texels that carry a mark at all. */
  coverage: number
  /** Peak mark value, for tests that must notice an empty texture. */
  peak: number
  asset: RadiantAsset
}

/** The pack asset for a card id, or null when the card is not in the pack. */
export function radiantAssetFor(cardId: string | null | undefined): RadiantAsset | null {
  if (!cardId) return null
  return RADIANT_ASSETS[cardId] ?? null
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
const wrap01 = (t: number) => t - Math.floor(t)

/**
 * RGBA texels → the sampling grid. Pure and browser-free so the test suite can
 * feed it synthetic pixels and the same code path the game uses.
 */
export function buildPatternMap(
  cardId: string,
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = GRID,
): PatternMap {
  const asset = radiantAssetFor(cardId)
  if (!asset) throw new Error(`no radiant asset for ${cardId}`)
  if (rgba.length !== w * h * 4) throw new Error(`expected ${w * h * 4} bytes, got ${rgba.length}`)
  const mark = new Float32Array(grid * grid)
  const opacity = new Float32Array(grid * grid)
  let peak = 0
  for (let ty = 0; ty < grid; ty++) {
    const y0 = Math.floor((ty * h) / grid)
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / grid))
    for (let tx = 0; tx < grid; tx++) {
      const x0 = Math.floor((tx * w) / grid)
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / grid))
      let sumMark = 0
      let sumAlpha = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4
          const a = rgba[i + 3] / 255
          const luma = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255
          sumMark += luma * a
          sumAlpha += a
          n++
        }
      }
      const idx = ty * grid + tx
      mark[idx] = n ? sumMark / n : 0
      opacity[idx] = n ? sumAlpha / n : 0
      if (mark[idx] > peak) peak = mark[idx]
    }
  }
  let covered = 0
  for (let i = 0; i < opacity.length; i++) if (opacity[i] > 0.1) covered++
  return { cardId, size: grid, mark, opacity, coverage: covered / opacity.length, peak, asset }
}

/**
 * Box-filter resampling again for the runtime grid, but this time only what the
 * shader needs: the mark field. Kept separate from `buildPatternMap` because the
 * browser path decodes at native size first and the Node tests may not.
 */
function sampleField(field: Float32Array, size: number, tx: number, ty: number): number {
  const u = wrap01(tx) * size - 0.5
  const v = wrap01(ty) * size - 0.5
  const x0 = Math.floor(u)
  const y0 = Math.floor(v)
  const fx = u - x0
  const fy = v - y0
  const at = (x: number, y: number) => {
    const xx = ((x % size) + size) % size
    const yy = ((y % size) + size) % size
    return field[yy * size + xx]
  }
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx
  return clamp01(top * (1 - fy) + bottom * fy)
}

/**
 * The motif at a point of the card, 0 (bare foil) to 1 (mark body).
 *
 * `scale` is how many motif copies span the card width; vertical wrapping keeps
 * the marks round rather than stretched to the card's 0.717 aspect.
 */
export function samplePattern(
  map: PatternMap,
  u: number,
  v: number,
  scale = 1,
): { mark: number; opacity: number } {
  const tx = u * scale
  const ty = v * scale * (1 / CARD_ASPECT)
  return {
    mark: sampleField(map.mark, map.size, tx, ty),
    opacity: sampleField(map.opacity, map.size, tx, ty),
  }
}

// ---------------------------------------------------------------------------
// Browser loading
// ---------------------------------------------------------------------------

const cache = new Map<string, PatternMap>()
const pending = new Map<string, Promise<PatternMap | null>>()

/** Texture pixels, same-origin only. */
async function readTexels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  const blob = await res.blob()

  // createImageBitmap is the fast path; an <img> covers browsers without it.
  let draw: (ctx: CanvasRenderingContext2D) => void
  let w = 0
  let h = 0
  let close: (() => void) | null = null
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob)
    w = bmp.width
    h = bmp.height
    draw = (ctx) => ctx.drawImage(bmp, 0, 0)
    close = () => bmp.close()
  } else {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok()
      img.onerror = () => fail(new Error('texture did not decode'))
      img.src = url
    }).finally(() => URL.revokeObjectURL(url))
    w = img.naturalWidth
    h = img.naturalHeight
    draw = (ctx) => ctx.drawImage(img, 0, 0)
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('no 2d context for the texture')
  draw(ctx)
  const data = ctx.getImageData(0, 0, w, h).data
  close?.()
  return { w, h, data }
}

/**
 * Load (once) and cache a card's motif. Resolves null — never rejects — when the
 * card has no texture or the network/decoder failed, so the overlay can fall
 * back to an unpatterned reflection instead of drawing a wrong motif.
 */
export function loadPatternMap(cardId: string | null | undefined): Promise<PatternMap | null> {
  const asset = radiantAssetFor(cardId)
  if (!asset) return Promise.resolve(null)
  const key = asset.cardId
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(key)
  if (inflight) return inflight

  const task = (async () => {
    try {
      const { w, h, data } = await readTexels(asset.pattern)
      return buildPatternMap(key, w, h, data)
    } catch {
      return null
    } finally {
      pending.delete(key)
    }
  })()
  pending.set(key, task)
  task.then((map) => {
    if (map) cache.set(key, map)
  })
  return task
}

/** Drop a cached motif. Only the debug panel needs this. */
export function forgetPattern(cardId: string): void {
  cache.delete(cardId)
}
