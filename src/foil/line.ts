// Line, sampled: thin vertical ridges, cut per card and tiled.
//
// The sheet is a procedural reconstruction (`line-sheet.ts`); this module is the only
// place that turns it into the renderer's MarkField, and it keeps the layer contract:
//
//   - the pattern decides WHERE light lands, never colour: ink is luminance x alpha, so
//     the white pixels of the sheet cannot tint anything;
//   - the mark never moves under tilt. The cut is seeded from the card id and is fixed
//     for every frame;
//   - the sheet WRAPS (measured, in the generated index), so a card may sample any
//     window and the stripes continue past the card edge rather than stopping.
//
// Copy variation is a crop, not a re-seed: each card id derives its own offset and a
// slight zoom, so two cards of one set sit on different lines of the field. A save does
// not distinguish physical copies, so two copies of one card id share a cut.
//
// Which cards wear it: standard Holo cards from Sword & Shield through Crown Zenith, by
// the renderer's era rule (`holo.ts` → `eraPattern`). No printing record claims Line, so
// this is a set-level identification, not a per-card one; the report says so.

import { hashKey } from '../holo'
import { CARD_ASPECT } from './radiant'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import { LINE_SHEET } from './line-index'
import type { MarkField } from './mark-field'

/** Side of the downsampled sampling grid (1024px sheet → 320px grid). */
export const LINE_GRID = 320

/** The texture is a drawing. No printing is verified against it. */
export const LINE_TEXTURE_VERIFIED = false

export type LineGrid = CosmosGrid

/** RGBA texels → sampling grid: mark = luminance x alpha, opacity = alpha. */
export function buildLineGrid(
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = LINE_GRID,
): LineGrid {
  return buildCosmosGrid(w, h, rgba, grid)
}

export type LineCopy = {
  /** Sheet-space offset, 0..1. Free to wrap: the sheet tiles. */
  offsetU: number
  offsetV: number
  /** How far the window is zoomed into the sheet (1 = the whole width). */
  zoom: number
  seed: number
}

export type LineCopyOptions = {
  /** Pin the cut for one physical copy without inventing a printing. */
  copySeed?: string | number
}

/** The crop this card sits at. Deterministic in the card id. */
export function lineCopyFor(cardId: string, opts: LineCopyOptions = {}): LineCopy {
  const seed = hashKey(String(opts.copySeed ?? cardId) + ':line')
  return {
    offsetU: ((seed >>> 3) % 10007) / 10007,
    offsetV: ((seed >>> 13) % 7919) / 7919,
    zoom: 0.97 + (((seed >>> 21) % 613) / 613) * 0.09,
    seed,
  }
}

const frac = (t: number) => t - Math.floor(t)

/** Bilinear read that wraps, because the ruled field is a tile. */
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
 * The mark at a point of the card. `u` is scaled by the card aspect so the lines stay
 * vertical and evenly spaced on a 734x1024 card; `scale` > 1 zooms further into the
 * sheet — the inspector's texture-scale slider — and still wraps.
 */
export function sampleLine(
  copy: LineCopy,
  grid: LineGrid,
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
export function lineFieldFor(cardId: string, grid: LineGrid, copy = lineCopyFor(cardId)): MarkField {
  return {
    id: `line:${cardId}`,
    label: 'Line · thin vertical ridges',
    mark: (u, v, scale = 1) => sampleLine(copy, grid, u, v, scale).mark,
    opacity: (u, v) => sampleLine(copy, grid, u, v, 1).opacity,
    coverage: grid.coverage,
    peak: grid.peak,
    verified: LINE_TEXTURE_VERIFIED,
    note: 'Procedural reconstruction of the Line paper from Bulbapedia (“thin vertical lines that refract light from the top to the bottom of the Pokémon’s image”). The pitch and the drift depth are this build’s drawing; not a scan.',
    meta: {
      reproduction: 'procedural reconstruction',
      motif: 'thin vertical ridges',
      offsetU: Number(copy.offsetU.toFixed(4)),
      offsetV: Number(copy.offsetV.toFixed(4)),
      zoom: Number(copy.zoom.toFixed(3)),
      sheet: LINE_SHEET.pattern,
      pitch: LINE_SHEET.pitch,
      tiling: 'disclosed choice: pitch divides the sheet, seam measured',
    },
  }
}

// ---------------------------------------------------------------------------
// Browser loading
// ---------------------------------------------------------------------------

let grid: LineGrid | null = null
let pending: Promise<LineGrid | null> | null = null

/** Texture pixels, same-origin only. */
async function readLineTexels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
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

function loadGrid(): Promise<LineGrid | null> {
  if (grid) return Promise.resolve(grid)
  if (pending) return pending
  const task = (async () => {
    try {
      const { w, h, data } = await readLineTexels(LINE_SHEET.pattern)
      return buildLineGrid(w, h, data)
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
 * The card's Line field, or null when the texture cannot be read. Null means the
 * renderer draws plain foil rather than a wrong pattern.
 */
export async function loadLineField(cardId: string): Promise<MarkField | null> {
  const copy = lineCopyFor(cardId)
  const loaded = await loadGrid()
  return loaded ? lineFieldFor(cardId, loaded, copy) : null
}

/** Drop the cached sheet. Only the debug panel needs this. */
export function forgetLineSheet(): void {
  grid = null
  pending = null
}
