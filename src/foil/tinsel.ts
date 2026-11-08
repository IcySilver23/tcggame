// Tinsel, sampled: horizontal stripes, cut per card and tiled.
//
// The sheet itself is a procedural reconstruction (`tinsel-sheet.ts`); this module
// is the only place that turns it into the renderer's MarkField. The rules it
// inherits are the layer contract's:
//
//   - the pattern decides WHERE light lands, never colour: ink is luminance x
//     alpha, so the white pixels of the sheet cannot tint anything;
//   - the mark never moves under tilt. The cut is seeded from the card id and is
//     fixed for every frame; only reflection.ts and iridescence.ts react to the
//     pointer;
//   - the sheet TILES (the measured seam is in the generated index), so a card may
//     sample any window. Wrapping is what makes the stripes read as banding that
//     continues past the card edge rather than as a picture of stripes; tiling is
//     this build's disclosed choice, not a documented fact about the print.
//
// Copy variation is a phase, not a re-seed: two cards of one set sit at different
// offsets into the stripe field, and a card keeps its offset between frames. A save
// does not distinguish physical copies, so two copies of one card id share a cut —
// the variation is between cards, exactly as Cosmos and Starlight document.

import { hashKey } from '../holo'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import { CARD_ASPECT } from './radiant'
import { TINSEL_SHEET } from './tinsel-index'
import type { MarkField } from './mark-field'

/** Side of the downsampled sampling grid (1024px sheet → 320px grid). */
export const TINSEL_GRID = 320

/** The texture is a drawing. No printing is verified against it. */
export const TINSEL_TEXTURE_VERIFIED = false

export type TinselGrid = CosmosGrid

/** RGBA texels → sampling grid: mark = luminance x alpha, opacity = alpha. */
export function buildTinselGrid(
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = TINSEL_GRID,
): TinselGrid {
  return buildCosmosGrid(w, h, rgba, grid)
}

export type TinselCopy = {
  /** Sheet-space offset, 0..1. Free to wrap: the sheet tiles. */
  offsetU: number
  offsetV: number
  /** How far the window is zoomed into the sheet (1 = the whole width). */
  zoom: number
  seed: number
}

export type TinselCopyOptions = {
  /** Pin the phase for one physical copy without inventing a printing. */
  copySeed?: string | number
}

/** The phase this card sits at. Deterministic in the card id. */
export function tinselCopyFor(cardId: string, opts: TinselCopyOptions = {}): TinselCopy {
  const seed = hashKey(String(opts.copySeed ?? cardId) + ':tinsel')
  return {
    offsetU: ((seed >>> 3) % 10007) / 10007,
    offsetV: ((seed >>> 13) % 7919) / 7919,
    zoom: 0.98 + (((seed >>> 21) % 613) / 613) * 0.08,
    seed,
  }
}

const frac = (t: number) => t - Math.floor(t)

/** Bilinear read that wraps, because the stripe field is a tile. */
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
 * The mark at a point of the card. `scale` > 1 zooms further into the sheet — the
 * inspector's texture-scale slider — and still wraps, so there is no edge.
 */
export function sampleTinsel(
  copy: TinselCopy,
  grid: TinselGrid,
  u: number,
  v: number,
  scale = 1,
): { mark: number; opacity: number } {
  const z = Math.max(1, scale) * copy.zoom
  const tx = copy.offsetU + u * CARD_ASPECT * z
  const ty = copy.offsetV + v * z
  return {
    mark: sampleWrapped(grid.mark, grid.size, tx, ty),
    opacity: sampleWrapped(grid.opacity, grid.size, tx, ty),
  }
}

/** Wrap a grid + phase as the renderer's mark field. */
export function tinselFieldFor(cardId: string, grid: TinselGrid, copy = tinselCopyFor(cardId)): MarkField {
  return {
    id: `tinsel:${cardId}`,
    label: 'Tinsel · horizontal stripes',
    mark: (u, v, scale = 1) => sampleTinsel(copy, grid, u, v, scale).mark,
    opacity: (u, v) => sampleTinsel(copy, grid, u, v, 1).opacity,
    coverage: grid.coverage,
    peak: grid.peak,
    verified: TINSEL_TEXTURE_VERIFIED,
    note: 'Procedural reconstruction of the Generation V Tinsel paper from Bulbapedia’s description (“horizontal stripes across the image”). Not a scan.',
    meta: {
      reproduction: 'procedural reconstruction',
      motif: 'horizontal stripes',
      offsetU: Number(copy.offsetU.toFixed(4)),
      offsetV: Number(copy.offsetV.toFixed(4)),
      zoom: Number(copy.zoom.toFixed(3)),
      sheet: TINSEL_SHEET.pattern,
      tiling: 'disclosed choice',
    },
  }
}

// ---------------------------------------------------------------------------
// Browser loading
// ---------------------------------------------------------------------------

let grid: TinselGrid | null = null
let pending: Promise<TinselGrid | null> | null = null

/** Texture pixels, same-origin only. */
async function readTinselTexels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
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

function loadGrid(): Promise<TinselGrid | null> {
  if (grid) return Promise.resolve(grid)
  if (pending) return pending
  const task = (async () => {
    try {
      const { w, h, data } = await readTinselTexels(TINSEL_SHEET.pattern)
      return buildTinselGrid(w, h, data)
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
 * The card's Tinsel field, or null when the texture cannot be read. Null means the
 * renderer draws plain foil rather than a wrong pattern.
 */
export async function loadTinselField(cardId: string): Promise<MarkField | null> {
  const copy = tinselCopyFor(cardId)
  const loaded = await loadGrid()
  return loaded ? tinselFieldFor(cardId, loaded, copy) : null
}

/** Drop the cached sheet. Only the debug panel needs this. */
export function forgetTinselSheet(): void {
  grid = null
  pending = null
}
