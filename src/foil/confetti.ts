// Confetti, sampled: one window of the blocky sheet per card.
//
// The sheet is a procedural reconstruction (`confetti-sheet.ts`). This module is the
// only place that turns it into the renderer's MarkField, and the rules it inherits
// are the layer contract's:
//
//   - the pattern decides WHERE light lands, never colour: ink is luminance x alpha,
//     so the white pixels of the sheet cannot tint anything;
//   - the mark never moves under tilt. The cut is seeded from the card id and is
//     fixed for every frame;
//   - the sheet WRAPS, measured rather than assumed (blocks are stamped with
//     wrap-around coordinates), so a card may sample any window.
//
// Copy variation is a CROP, not a re-seed: each card id derives its own offset and a
// slight zoom into the sheet. A save does not distinguish physical copies, so two
// copies of one card id share a cut — the variation is between cards.
//
// Which cards wear it: the McDonald's Collections, the Celebrations Classic
// Collection and the 2026 30th Celebration Classic Collection, all named by
// Bulbapedia. `holoFor` resolves the two Classic Collections through the printing
// database as `confetti`, and the McDonald's sets through the style rule.

import { hashKey } from '../holo'
import { CARD_ASPECT } from './radiant'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import { CONFETTI_SHEET } from './confetti-index'
import type { MarkField } from './mark-field'

/** Side of the downsampled sampling grid (1024px sheet → 320px grid). */
export const CONFETTI_GRID = 320

/** The texture is a drawing. No printing is verified against it. */
export const CONFETTI_TEXTURE_VERIFIED = false

export type ConfettiGrid = CosmosGrid

/** RGBA texels → sampling grid: mark = luminance x alpha, opacity = alpha. */
export function buildConfettiGrid(
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = CONFETTI_GRID,
): ConfettiGrid {
  return buildCosmosGrid(w, h, rgba, grid)
}

export type ConfettiCopy = {
  /** Sheet-space offset, 0..1. Free to wrap: the sheet tiles. */
  offsetU: number
  offsetV: number
  /** How far the window is zoomed into the sheet (1 = the whole width). */
  zoom: number
  seed: number
}

export type ConfettiCopyOptions = {
  /** Pin the cut for one physical copy without inventing a printing. */
  copySeed?: string | number
}

/** The crop this card sits at. Deterministic in the card id. */
export function confettiCopyFor(cardId: string, opts: ConfettiCopyOptions = {}): ConfettiCopy {
  const seed = hashKey(String(opts.copySeed ?? cardId) + ':confetti')
  return {
    offsetU: ((seed >>> 3) % 10007) / 10007,
    offsetV: ((seed >>> 13) % 7919) / 7919,
    zoom: 0.96 + (((seed >>> 21) % 613) / 613) * 0.1,
    seed,
  }
}

const frac = (t: number) => t - Math.floor(t)

/** Bilinear read that wraps, because the sheet tiles. */
function sampleWrapped(field: Float32Array, size: number, tx: number, ty: number): number {
  const x = frac(tx) * size
  const y = frac(ty) * size
  const x0 = Math.floor(x) % size
  const y0 = Math.floor(y) % size
  const x1 = (x0 + 1) % size
  const y1 = (y0 + 1) % size
  const fx = x - Math.floor(x)
  const fy = y - Math.floor(y)
  const top = field[y0 * size + x0] * (1 - fx) + field[y0 * size + x1] * fx
  const bottom = field[y1 * size + x0] * (1 - fx) + field[y1 * size + x1] * fx
  return top * (1 - fy) + bottom * fy
}

/**
 * The mark at a point of the card. `u` is scaled by the card's aspect so the blocks
 * stay squarish on a 734x1024 card; `scale` > 1 zooms further into the sheet — the
 * inspector's texture-scale slider — and still wraps.
 */
export function sampleConfetti(
  copy: ConfettiCopy,
  grid: ConfettiGrid,
  u: number,
  v: number,
  scale = 1,
): { mark: number; opacity: number } {
  const z = Math.max(0.1, scale) * copy.zoom
  const tx = copy.offsetU + u * CARD_ASPECT * z
  const ty = copy.offsetV + v * z
  return {
    mark: sampleWrapped(grid.mark, grid.size, tx, ty),
    opacity: sampleWrapped(grid.opacity, grid.size, tx, ty),
  }
}

/** Wrap a grid + crop as the renderer's mark field. */
export function confettiFieldFor(
  cardId: string,
  grid: ConfettiGrid,
  copy = confettiCopyFor(cardId),
): MarkField {
  return {
    id: `confetti:${cardId}`,
    label: 'Pixel / Confetti · blocky flakes',
    mark: (u, v, scale = 1) => sampleConfetti(copy, grid, u, v, scale).mark,
    opacity: (u, v) => sampleConfetti(copy, grid, u, v, 1).opacity,
    coverage: grid.coverage,
    peak: grid.peak,
    verified: CONFETTI_TEXTURE_VERIFIED,
    note: 'Procedural reconstruction of the Pixel / Confetti paper from Bulbapedia (“small, blocky reflective shapes scattered across the image, resembling pieces of confetti”). The block sizes, density and brightness are this build’s drawing; not a scan.',
    meta: {
      reproduction: 'procedural reconstruction',
      motif: 'scattered blocky flakes',
      offsetU: Number(copy.offsetU.toFixed(4)),
      offsetV: Number(copy.offsetV.toFixed(4)),
      zoom: Number(copy.zoom.toFixed(3)),
      sheet: CONFETTI_SHEET.pattern,
      tiling: 'disclosed choice: blocks wrap, seam measured',
    },
  }
}

// ---------------------------------------------------------------------------
// Browser loading
// ---------------------------------------------------------------------------

let grid: ConfettiGrid | null = null
let pending: Promise<ConfettiGrid | null> | null = null

/** Texture pixels, same-origin only. */
async function readConfettiTexels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  const blob = await res.blob()
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
    const objectUrl = URL.createObjectURL(blob)
    const img = new Image()
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok()
      img.onerror = () => fail(new Error('texture did not decode'))
      img.src = objectUrl
    }).finally(() => URL.revokeObjectURL(objectUrl))
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

function loadGrid(): Promise<ConfettiGrid | null> {
  if (grid) return Promise.resolve(grid)
  if (pending) return pending
  const task = (async () => {
    try {
      const { w, h, data } = await readConfettiTexels(CONFETTI_SHEET.pattern)
      return buildConfettiGrid(w, h, data)
    } catch {
      return null
    } finally {
      pending = null
    }
  })()
  pending = task
  task.then((g) => {
    if (g) grid = g
  })
  return task
}

/**
 * The card's confetti field, or null when the texture cannot be read. Null means the
 * renderer draws plain foil rather than a wrong pattern.
 */
export async function loadConfettiField(cardId: string): Promise<MarkField | null> {
  const copy = confettiCopyFor(cardId)
  const loaded = await loadGrid()
  return loaded ? confettiFieldFor(cardId, loaded, copy) : null
}

/** Drop the cached sheet. Only the debug panel needs this. */
export function forgetConfettiSheet(): void {
  grid = null
  pending = null
}
