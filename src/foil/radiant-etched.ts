// Radiant Pokémon, sampled: one window of the etched lattice per card.
//
// The sheet is a procedural reconstruction (`radiant-etched-sheet.ts`). This module is
// the only place that turns it into the renderer's MarkField, and the rules it inherits
// are the layer contract's:
//
//   - the pattern decides WHERE light lands, never colour: ink is luminance x alpha, so
//     the white pixels cannot tint anything;
//   - the field never moves under tilt. The cut is seeded from the card id and is fixed
//     for every frame;
//   - the sheet TILES, so a card may sample any window. Wrapping is this build's
//     disclosed choice: the sources name the finish and the area, not a repeat.
//
// Copy variation is a CROP, not a re-seed: each card id derives its own offset, while
// the orientation is fixed for the paper. A save does not distinguish physical copies,
// so two copies of one card id share a cut — the variation is between cards.

import { hashKey } from '../holo'
import { CARD_ASPECT } from './radiant'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import { RADIANT_ETCHED_SHEET } from './radiant-etched-index'
import type { MarkField } from './mark-field'

/** Side of the downsampled sampling grid (1024px sheet → 384px grid). */
export const RADIANT_ETCHED_GRID = 384

/** The texture is a drawing. No printing is verified against it. */
export const RADIANT_ETCHED_TEXTURE_VERIFIED = false

export type RadiantEtchedGrid = CosmosGrid

/** RGBA texels → sampling grid: mark = luminance x alpha, opacity = alpha. */
export function buildRadiantEtchedGrid(
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = RADIANT_ETCHED_GRID,
): RadiantEtchedGrid {
  return buildCosmosGrid(w, h, rgba, grid)
}

export type RadiantEtchedCopy = {
  /** Sheet-space offset, 0..1. Free to wrap: the sheet tiles. */
  offsetU: number
  offsetV: number
  seed: number
}

export type RadiantEtchedCopyOptions = {
  /** Pin the cut for one physical copy without inventing a printing. */
  copySeed?: string | number
}

/** The crop this card sits at. Deterministic in the card id. */
export function radiantEtchedCopyFor(
  cardId: string,
  opts: RadiantEtchedCopyOptions = {},
): RadiantEtchedCopy {
  const seed = hashKey(String(opts.copySeed ?? cardId) + ':radiant-etched')
  return {
    offsetU: ((seed >>> 3) % 10007) / 10007,
    offsetV: ((seed >>> 13) % 7919) / 7919,
    seed,
  }
}

const frac = (t: number) => t - Math.floor(t)

/** Bilinear read that wraps, because the lattice is a tile. */
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
 * The mark at a point of the card. `u` is scaled by the card's aspect so the lattice
 * cells stay square on a 734x1024 card; `scale` > 1 zooms further into the sheet — the
 * inspector's texture-scale slider — and still wraps.
 */
export function sampleRadiantEtched(
  copy: RadiantEtchedCopy,
  grid: RadiantEtchedGrid,
  u: number,
  v: number,
  scale = 1,
): { mark: number; opacity: number } {
  const z = Math.max(0.1, scale)
  const tx = copy.offsetU + u * CARD_ASPECT * z
  const ty = copy.offsetV + v * z
  return {
    mark: sampleWrapped(grid.mark, grid.size, tx, ty),
    opacity: sampleWrapped(grid.opacity, grid.size, tx, ty),
  }
}

/** Wrap a grid + crop as the renderer's mark field. */
export function radiantEtchedFieldFor(
  cardId: string,
  grid: RadiantEtchedGrid,
  copy = radiantEtchedCopyFor(cardId),
): MarkField {
  return {
    id: `radiant-etched:${cardId}`,
    label: 'Radiant Pokémon · etched silver',
    mark: (u, v, scale = 1) => sampleRadiantEtched(copy, grid, u, v, scale).mark,
    opacity: (u, v) => sampleRadiantEtched(copy, grid, u, v, 1).opacity,
    coverage: grid.coverage,
    peak: grid.peak,
    verified: RADIANT_ETCHED_TEXTURE_VERIFIED,
    note: 'Procedural reconstruction of the Radiant Pokémon foil from Bulbapedia (“a special holofoil layer”) and a collector guide (“etched, embossed silver foil covering the entire card”): a fine etched lattice inside a wider diamond grid, over silver that never goes dark. The pitch and contrast are this build’s drawing, not a scan.',
    meta: {
      reproduction: 'procedural reconstruction',
      motif: 'fine etched lattice + coarse diamond grid',
      finePeriod: RADIANT_ETCHED_SHEET.finePeriod,
      coarsePeriod: RADIANT_ETCHED_SHEET.coarsePeriod,
      offsetU: Number(copy.offsetU.toFixed(4)),
      offsetV: Number(copy.offsetV.toFixed(4)),
      sheet: RADIANT_ETCHED_SHEET.pattern,
      tiling: 'disclosed choice',
    },
  }
}

// ---------------------------------------------------------------------------
// Browser loading
// ---------------------------------------------------------------------------

let grid: RadiantEtchedGrid | null = null
let pending: Promise<RadiantEtchedGrid | null> | null = null

/** Texture pixels, same-origin only. */
async function readRadiantEtchedTexels(
  url: string,
): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
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

function loadGrid(): Promise<RadiantEtchedGrid | null> {
  if (grid) return Promise.resolve(grid)
  if (pending) return pending
  const task = (async () => {
    try {
      const { w, h, data } = await readRadiantEtchedTexels(RADIANT_ETCHED_SHEET.pattern)
      return buildRadiantEtchedGrid(w, h, data)
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
 * The card's etched field, or null when the texture cannot be read. Null means the
 * renderer draws plain foil rather than a wrong pattern.
 */
export async function loadRadiantEtchedField(cardId: string): Promise<MarkField | null> {
  const copy = radiantEtchedCopyFor(cardId)
  const loaded = await loadGrid()
  return loaded ? radiantEtchedFieldFor(cardId, loaded, copy) : null
}

/** Drop the cached sheet. Only the debug panel needs this. */
export function forgetRadiantEtchedSheet(): void {
  grid = null
  pending = null
}
