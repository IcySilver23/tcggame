// Starlight, sampled: one cut of the sheet per card.
//
// The sheet itself is a procedural reconstruction (`starlight-sheet.ts`), and
// this module is the only place that turns it into the renderer's MarkField. The
// rules it inherits are the layer contract's:
//
//   - the pattern decides WHERE light lands, never colour: ink is luminance x
//     alpha, so the white pixels of the sheet cannot tint anything;
//   - the mark never moves under tilt. The cut is seeded from the card id and is
//     fixed for every frame; only reflection.ts and iridescence.ts react to the
//     pointer;
//   - the sheet is one window, never a tile. Measured wrap mismatch is 5.5% of
//     rows, so wrapping would slice stars in half across a seam. Sampling clamps
//     inside the sheet exactly as the Cosmos sampler does.
//
// Copy variation is a crop, not a re-seed: two cards of the same set do not share
// a window. The sheet's quarter-turn orientation is seeded from the SET id, since
// a print run was cut from one orientation. This mirrors cosmos.ts on purpose —
// both are cut sheets — while the mark vocabulary stays Starlight's own.

import { hashKey, setIdOf } from '../holo'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import { CARD_ASPECT } from './radiant'
import { STARLIGHT_SHEET } from './starlight-index'
import type { MarkField } from './mark-field'

/** Side of the downsampled sampling grid (1024px sheet → 320px grid). */
export const STARLIGHT_GRID = 320

/** The texture is a drawing. No printing is verified against it. */
export const STARLIGHT_TEXTURE_VERIFIED = false

export type StarGrid = CosmosGrid

/**
 * RGBA texels → sampling grid. The maths is the same box filter Cosmos uses —
 * mark = luminance x alpha, opacity = alpha — because both textures are neutral
 * ink on transparency. Wrapped in a named function so the suite and the report
 * do not have to know that detail.
 */
export function buildStarGrid(
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = STARLIGHT_GRID,
): StarGrid {
  return buildCosmosGrid(w, h, rgba, grid)
}

export type StarlightCopy = {
  /** Sheet orientation for the set this card belongs to. */
  rotated: boolean
  /** Sheet-space origin of the card's window (0..1). */
  offsetU: number
  offsetV: number
  /** How far the window is zoomed into the sheet (1 = the whole width). */
  zoom: number
  seed: number
}

export type StarlightCopyOptions = {
  /** Pin the cut for one physical copy without inventing a printing. */
  copySeed?: string | number
}

/**
 * The cut this card came from. Deterministic in the card id, so a card looks the
 * same on every frame and different from its neighbours.
 */
export function starlightCopyFor(cardId: string, opts: StarlightCopyOptions = {}): StarlightCopy {
  const setId = setIdOf(cardId) ?? ''
  const seed = hashKey(String(opts.copySeed ?? cardId) + ':starlight')
  const zoom = 0.97 + (((seed >>> 20) % 997) / 997) * 0.09
  const rotated = (hashKey(setId + ':starlight-orientation') & 1) === 1
  const fU = ((seed >>> 3) % 10007) / 10007
  const fV = ((seed >>> 13) % 7919) / 7919
  const sx = CARD_ASPECT * zoom
  const sy = Math.min(1, zoom)
  return {
    rotated,
    // A rotated sheet reads the card's height across the texture's width, so the
    // free axes swap along with the spans.
    offsetU: fU * Math.max(0, 1 - (rotated ? sy : sx)),
    offsetV: fV * Math.max(0, 1 - (rotated ? sx : sy)),
    zoom,
    seed,
  }
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

/** Bilinear read with clamping — the window is always inside the sheet, so no wrap. */
function bilinear(field: Float32Array, size: number, tx: number, ty: number): number {
  const x = clamp01(tx) * (size - 1)
  const y = clamp01(ty) * (size - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(size - 1, x0 + 1)
  const y1 = Math.min(size - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const top = field[y0 * size + x0] * (1 - fx) + field[y0 * size + x1] * fx
  const bottom = field[y1 * size + x0] * (1 - fx) + field[y1 * size + x1] * fx
  return clamp01(top * (1 - fy) + bottom * fy)
}

/**
 * The mark at a point of the card. `scale` > 1 zooms further into the sheet —
 * the inspector's texture-scale slider — and never zooms out past the card
 * window, because that would wrap the sheet.
 */
export function sampleStarlight(
  copy: StarlightCopy,
  grid: StarGrid,
  u: number,
  v: number,
  scale = 1,
): { mark: number; opacity: number } {
  const z = Math.max(1, scale) * copy.zoom
  const sx = CARD_ASPECT / z
  const sy = Math.min(1, 1 / z)
  const offU = Math.min(copy.offsetU, Math.max(0, 1 - (copy.rotated ? sy : sx)))
  const offV = Math.min(copy.offsetV, Math.max(0, 1 - (copy.rotated ? sx : sy)))
  const tx = copy.rotated ? offU + v * sy : offU + u * sx
  const ty = copy.rotated ? offV + u * sx : offV + v * sy
  return {
    mark: bilinear(grid.mark, grid.size, tx, ty),
    opacity: bilinear(grid.opacity, grid.size, tx, ty),
  }
}

/** Wrap a grid + cut position as the renderer's mark field. */
export function starlightFieldFor(cardId: string, grid: StarGrid, copy = starlightCopyFor(cardId)): MarkField {
  return {
    id: `starlight:${cardId}`,
    label: 'Starlight · four-point starbursts',
    mark: (u, v, scale = 1) => sampleStarlight(copy, grid, u, v, scale).mark,
    opacity: (u, v) => sampleStarlight(copy, grid, u, v, 1).opacity,
    coverage: grid.coverage,
    peak: grid.peak,
    verified: STARLIGHT_TEXTURE_VERIFIED,
    note: 'Procedural reconstruction of the 1999 Starlight sheet from Bulbapedia’s description. Not a scan.',
    meta: {
      reproduction: 'procedural reconstruction',
      motif: 'four-point starbursts',
      rotated: copy.rotated,
      offsetU: Number(copy.offsetU.toFixed(4)),
      offsetV: Number(copy.offsetV.toFixed(4)),
      zoom: Number(copy.zoom.toFixed(3)),
      sheet: STARLIGHT_SHEET.pattern,
    },
  }
}

// ---------------------------------------------------------------------------
// Browser loading
// ---------------------------------------------------------------------------

let grid: StarGrid | null = null
let pending: Promise<StarGrid | null> | null = null

/** Texture pixels, same-origin only. */
async function readStarlightTexels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
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

function loadGrid(): Promise<StarGrid | null> {
  if (grid) return Promise.resolve(grid)
  if (pending) return pending
  const task = (async () => {
    try {
      const { w, h, data } = await readStarlightTexels(STARLIGHT_SHEET.pattern)
      return buildStarGrid(w, h, data)
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
 * The card's Starlight field, or null when the texture cannot be read. Null
 * means the renderer draws plain foil rather than a wrong pattern.
 */
export async function loadStarlightField(cardId: string): Promise<MarkField | null> {
  const copy = starlightCopyFor(cardId)
  const loaded = await loadGrid()
  return loaded ? starlightFieldFor(cardId, loaded, copy) : null
}

/** Drop the cached sheet. Only the debug panel needs this. */
export function forgetStarlightSheet(): void {
  grid = null
  pending = null
}
