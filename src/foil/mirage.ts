// Mirage, sampled: a horizontal sheen, cut per card and tiled.
//
// The sheet is a procedural reconstruction (`mirage-sheet.ts`); this module turns it into
// the renderer's MarkField and keeps the layer contract:
//
//   - the pattern decides WHERE light lands, never colour: ink is luminance x alpha, so
//     the white pixels of the sheet cannot tint anything;
//   - the mark never moves under tilt. The cut is seeded from the card id and is fixed
//     for every frame;
//   - the sheet WRAPS (measured, in the generated index), so a card may sample any window
//     and the sweep continues past the card edge rather than stopping.
//
// Mirage is a SHEEN, not a marked paper: the field is uniform foil whose brightness varies
// across one axis, so `plain` stays false (there IS a pattern to modulate the reflection)
// but the coverage is total, exactly as Mirror's is.
//
// Which cards wear it: standard Holo cards from Scarlet & Violet onward, by the renderer's
// era rule (`holo.ts` → `eraPattern`). No printing record claims Mirage, so this is a
// set-level identification; the report says so.

import { hashKey } from '../holo'
import { CARD_ASPECT } from './radiant'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import { MIRAGE_SHEET } from './mirage-index'
import type { MarkField } from './mark-field'

/** Side of the downsampled sampling grid (1024px sheet → 320px grid). */
export const MIRAGE_GRID = 320

/** The texture is a drawing. No printing is verified against it. */
export const MIRAGE_TEXTURE_VERIFIED = false

export type MirageGrid = CosmosGrid

/** RGBA texels → sampling grid: mark = luminance x alpha, opacity = alpha. */
export function buildMirageGrid(
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = MIRAGE_GRID,
): MirageGrid {
  return buildCosmosGrid(w, h, rgba, grid)
}

export type MirageCopy = {
  /** Sheet-space offset, 0..1. Free to wrap: the sheet tiles. */
  offsetU: number
  offsetV: number
  /** How far the window is zoomed into the sheet (1 = the whole width). */
  zoom: number
  seed: number
}

export type MirageCopyOptions = {
  /** Pin the cut for one physical copy without inventing a printing. */
  copySeed?: string | number
}

/** The crop this card sits at. Deterministic in the card id. */
export function mirageCopyFor(cardId: string, opts: MirageCopyOptions = {}): MirageCopy {
  const seed = hashKey(String(opts.copySeed ?? cardId) + ':mirage')
  return {
    offsetU: ((seed >>> 3) % 10007) / 10007,
    offsetV: ((seed >>> 13) % 7919) / 7919,
    zoom: 0.97 + (((seed >>> 21) % 613) / 613) * 0.09,
    seed,
  }
}

const frac = (t: number) => t - Math.floor(t)

/** Bilinear read that wraps, because the sheen field is a tile. */
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
 * The mark at a point of the card. `u` is scaled by the card aspect so the bands keep
 * their spacing on a 734x1024 card; `scale` > 1 zooms further into the sheet — the
 * inspector's texture-scale slider — and still wraps.
 */
export function sampleMirage(
  copy: MirageCopy,
  grid: MirageGrid,
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
export function mirageFieldFor(cardId: string, grid: MirageGrid, copy = mirageCopyFor(cardId)): MarkField {
  return {
    id: `mirage:${cardId}`,
    label: 'Mirage · horizontal sheen',
    mark: (u, v, scale = 1) => sampleMirage(copy, grid, u, v, scale).mark,
    opacity: (u, v) => sampleMirage(copy, grid, u, v, 1).opacity,
    coverage: grid.coverage,
    peak: grid.peak,
    verified: MIRAGE_TEXTURE_VERIFIED,
    note: 'Procedural reconstruction of the Scarlet & Violet Mirage paper from Bulbapedia (“visually similar to the Sheen Holofoil … but refracts light horizontally”). The band count and contrast are this build’s drawing; not a scan.',
    meta: {
      reproduction: 'procedural reconstruction',
      motif: 'horizontal sheen',
      direction: 'axis only: bands vertical (travel direction not claimed)',
      offsetU: Number(copy.offsetU.toFixed(4)),
      offsetV: Number(copy.offsetV.toFixed(4)),
      zoom: Number(copy.zoom.toFixed(3)),
      sheet: MIRAGE_SHEET.pattern,
      waves: MIRAGE_SHEET.waves,
      tiling: 'disclosed choice: values depend on x mod size, seam measured',
      border: 'silver foil border documented, not modelled',
    },
  }
}

// ---------------------------------------------------------------------------
// Browser loading
// ---------------------------------------------------------------------------

let grid: MirageGrid | null = null
let pending: Promise<MirageGrid | null> | null = null

/** Texture pixels, same-origin only. */
async function readMirageTexels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
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

function loadGrid(): Promise<MirageGrid | null> {
  if (grid) return Promise.resolve(grid)
  if (pending) return pending
  const task = (async () => {
    try {
      const { w, h, data } = await readMirageTexels(MIRAGE_SHEET.pattern)
      return buildMirageGrid(w, h, data)
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
 * The card's Mirage field, or null when the texture cannot be read. Null means the
 * renderer draws plain foil rather than a wrong pattern.
 */
export async function loadMirageField(cardId: string): Promise<MarkField | null> {
  const copy = mirageCopyFor(cardId)
  const loaded = await loadGrid()
  return loaded ? mirageFieldFor(cardId, loaded, copy) : null
}

/** Drop the cached sheet. Only the debug panel needs this. */
export function forgetMirageSheet(): void {
  grid = null
  pending = null
}
