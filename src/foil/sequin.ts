// Sequin, sampled: one window of the polygon sheet per card.
//
// The sheet is a procedural reconstruction (`sequin-sheet.ts`). This module is the only
// place that turns it into the renderer's MarkField, and it inherits the layer
// contract's rules unchanged:
//
//   - the pattern decides WHERE light lands, never colour: ink is luminance x alpha,
//     so the white pixels of the sheet cannot tint anything;
//   - the mark never moves under tilt. The cut is seeded from the card id and fixed for
//     every frame;
//   - the sheet WRAPS, measured rather than assumed, so a card may sample any window.
//
// Copy variation is a CROP, not a re-seed: each card id derives its own offset and a
// slight zoom into the sheet. A save does not distinguish physical copies, so two
// copies of one card id share a cut — the variation is between cards.
//
// Which cards wear it: Bulbapedia names Sequin for the General Mills promotional cards
// exclusively (Sun & Moon, Let's Go Kanto! and 25th Anniversary mini packs), and
// printing-db.ts resolves those ids for the explicit `sequinHolofoil` variant only — the
// plain promo of the same number stays plain. The generated index lists the cards the
// sweep finds, so the list is never hand-written.

import { hashKey } from '../holo'
import { CARD_ASPECT } from './radiant'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import { SEQUIN_SHEET } from './sequin-index'
import type { MarkField } from './mark-field'

/** Side of the downsampled sampling grid (1024px sheet → 384px grid). */
export const SEQUIN_GRID = 384

/** The texture is a drawing. No printing is verified against it. */
export const SEQUIN_TEXTURE_VERIFIED = false

export type SequinGrid = CosmosGrid

/** RGBA texels → sampling grid: mark = luminance x alpha, opacity = alpha. */
export function buildSequinGrid(
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = SEQUIN_GRID,
): SequinGrid {
  return buildCosmosGrid(w, h, rgba, grid)
}

export type SequinCopy = {
  /** Sheet-space offset, 0..1. Free to wrap: the sheet tiles. */
  offsetU: number
  offsetV: number
  /** How far the window is zoomed into the sheet (1 = the whole width). */
  zoom: number
  seed: number
}

export type SequinCopyOptions = {
  /** Pin the cut for one physical copy without inventing a printing. */
  copySeed?: string | number
}

/** The crop this card sits at. Deterministic in the card id. */
export function sequinCopyFor(cardId: string, opts: SequinCopyOptions = {}): SequinCopy {
  const seed = hashKey(String(opts.copySeed ?? cardId) + ':sequin')
  return {
    offsetU: ((seed >>> 3) % 10007) / 10007,
    offsetV: ((seed >>> 13) % 7919) / 7919,
    zoom: 0.94 + (((seed >>> 21) % 613) / 613) * 0.12,
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
 * The mark at a point of the card. `u` is scaled by the card's aspect so the shapes
 * stay proportionate on a 734x1024 card; `scale` > 1 zooms further into the sheet — the
 * inspector's texture-scale slider — and still wraps.
 */
export function sampleSequin(
  copy: SequinCopy,
  grid: SequinGrid,
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
export function sequinFieldFor(
  cardId: string,
  grid: SequinGrid,
  copy = sequinCopyFor(cardId),
): MarkField {
  return {
    id: `sequin:${cardId}`,
    label: 'Sequin · small reflective shapes',
    mark: (u, v, scale = 1) => sampleSequin(copy, grid, u, v, scale).mark,
    opacity: (u, v) => sampleSequin(copy, grid, u, v, 1).opacity,
    coverage: grid.coverage,
    peak: grid.peak,
    verified: SEQUIN_TEXTURE_VERIFIED,
    note: 'Procedural reconstruction of the Sequin paper from Bulbapedia (“many small reflective geometric shapes scattered across the image, giving it a sequined appearance”). The sides, size, density and brightness are this build’s drawing; not a scan.',
    meta: {
      reproduction: 'procedural reconstruction',
      motif: 'small scattered polygons',
      offsetU: Number(copy.offsetU.toFixed(4)),
      offsetV: Number(copy.offsetV.toFixed(4)),
      zoom: Number(copy.zoom.toFixed(3)),
      sheet: SEQUIN_SHEET.pattern,
      tiling: 'disclosed choice: marks wrap, seam measured',
    },
  }
}

// ---------------------------------------------------------------------------
// Browser loading
// ---------------------------------------------------------------------------

let grid: SequinGrid | null = null
let pending: Promise<SequinGrid | null> | null = null

/** Texture pixels, same-origin only. */
async function readSequinTexels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
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

function loadGrid(): Promise<SequinGrid | null> {
  if (grid) return Promise.resolve(grid)
  if (pending) return pending
  const task = (async () => {
    try {
      const { w, h, data } = await readSequinTexels(SEQUIN_SHEET.pattern)
      return buildSequinGrid(w, h, data)
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
 * The card's sequin field, or null when the texture cannot be read. Null means the
 * renderer draws plain foil rather than a wrong pattern.
 */
export async function loadSequinField(cardId: string): Promise<MarkField | null> {
  const copy = sequinCopyFor(cardId)
  const loaded = await loadGrid()
  return loaded ? sequinFieldFor(cardId, loaded, copy) : null
}

/** Drop the cached sheet. Only the debug panel needs this. */
export function forgetSequinSheet(): void {
  grid = null
  pending = null
}
