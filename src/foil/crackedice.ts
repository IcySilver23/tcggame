// Cracked Ice, sampled: a tiling fracture field.
//
// Unlike the Starlight and Cosmos sheets, this one is a TILE. The generator cuts
// the Voronoi fracture with toroidal distances, so the cracks continue across the
// wrap; a card samples any window at a scale, and the pattern repeats. That is a
// modelling choice, disclosed: no source read here says whether the printed
// Cracked Ice foil repeated or was cut per card.
//
// The layer rules are the same as every other field: ink is luminance x alpha (the
// texture carries no colour), the marks do not move under tilt, and a card's
// registration against the sheet is seeded from its id so the cracks are stable
// frame to frame.

import { hashKey } from '../holo'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import { CRACKEDICE_SCALE, CRACKEDICE_SHEET } from './crackedice-index'
import type { MarkField } from './mark-field'

export const CRACKEDICE_GRID = 320

/** The texture is a drawing. No printing is verified against it. */
export const CRACKEDICE_TEXTURE_VERIFIED = false

export type IceGrid = CosmosGrid

/** RGBA texels → sampling grid, using the shared mark/opacity interpretation. */
export function buildIceGrid(
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = CRACKEDICE_GRID,
): IceGrid {
  return buildCosmosGrid(w, h, rgba, grid)
}

export type IceCopy = {
  offsetU: number
  offsetV: number
  seed: number
}

/** A card's registration against the repeating sheet. Deterministic in the id. */
export function iceCopyFor(cardId: string, opts: { copySeed?: string | number } = {}): IceCopy {
  const seed = hashKey(String(opts.copySeed ?? cardId) + ':crackedice')
  return {
    offsetU: ((seed >>> 3) % 10007) / 10007,
    offsetV: ((seed >>> 13) % 7919) / 7919,
    seed,
  }
}

const wrap = (t: number) => t - Math.floor(t)
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

/** Bilinear read that wraps — the sheet is a tile, so any window is valid. */
function bilinearWrap(field: Float32Array, size: number, tx: number, ty: number): number {
  const x = wrap(tx) * size - 0.5
  const y = wrap(ty) * size - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const gx0 = ((x0 % size) + size) % size
  const gx1 = (gx0 + 1) % size
  const gy0 = ((y0 % size) + size) % size
  const gy1 = (gy0 + 1) % size
  const top = field[gy0 * size + gx0] * (1 - fx) + field[gy0 * size + gx1] * fx
  const bottom = field[gy1 * size + gx0] * (1 - fx) + field[gy1 * size + gx1] * fx
  return clamp01(top * (1 - fy) + bottom * fy)
}

/**
 * The mark at a card point. `scale` multiplies the shipped pattern scale, so the
 * inspector's slider zooms into the fracture without changing its shape.
 */
export function sampleCrackedIce(
  copy: IceCopy,
  grid: IceGrid,
  u: number,
  v: number,
  scale = 1,
): { mark: number; opacity: number } {
  const s = CRACKEDICE_SCALE * Math.max(0.1, scale)
  const tx = copy.offsetU + u * s
  const ty = copy.offsetV + v * s
  return {
    mark: bilinearWrap(grid.mark, grid.size, tx, ty),
    opacity: bilinearWrap(grid.opacity, grid.size, tx, ty),
  }
}

/** Wrap the grid as the renderer's mark field. */
export function crackedIceFieldFor(cardId: string, grid: IceGrid, copy = iceCopyFor(cardId)): MarkField {
  return {
    id: `crackedice:${cardId}`,
    label: 'Cracked Ice · shattered facets',
    mark: (u, v, scale = 1) => sampleCrackedIce(copy, grid, u, v, scale).mark,
    opacity: (u, v) => sampleCrackedIce(copy, grid, u, v, 1).opacity,
    coverage: grid.coverage,
    peak: grid.peak,
    verified: CRACKEDICE_TEXTURE_VERIFIED,
    note: 'Procedural Voronoi fracture drawn from Bulbapedia’s description. Not a scan.',
    meta: {
      reproduction: 'procedural reconstruction',
      motif: 'shattered facets',
      facets: CRACKEDICE_SHEET.facets,
      offsetU: Number(copy.offsetU.toFixed(4)),
      offsetV: Number(copy.offsetV.toFixed(4)),
      scale: CRACKEDICE_SCALE,
      sheet: CRACKEDICE_SHEET.texture,
    },
  }
}

// ---------------------------------------------------------------------------
// Browser loading
// ---------------------------------------------------------------------------

let grid: IceGrid | null = null
let pending: Promise<IceGrid | null> | null = null

async function readIceTexels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
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

function loadGrid(): Promise<IceGrid | null> {
  if (grid) return Promise.resolve(grid)
  if (pending) return pending
  const task = (async () => {
    try {
      const { w, h, data } = await readIceTexels(CRACKEDICE_SHEET.texture)
      return buildIceGrid(w, h, data)
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

/** The card's Cracked Ice field, or null if the sheet cannot be read. */
export async function loadCrackedIceField(cardId: string): Promise<MarkField | null> {
  const copy = iceCopyFor(cardId)
  const loaded = await loadGrid()
  return loaded ? crackedIceFieldFor(cardId, loaded, copy) : null
}

/** Drop the cached sheet. Only the debug panel needs this. */
export function forgetCrackedIceSheet(): void {
  grid = null
  pending = null
}
