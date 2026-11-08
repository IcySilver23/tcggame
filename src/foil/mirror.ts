// Mirror, sampled: a uniform mirror modulated along one diagonal.
//
// The sheet is a procedural reconstruction (`mirror-sheet.ts`); this module is the
// only place that turns it into the renderer's MarkField. The rules it inherits are
// the layer contract's:
//
//   - the pattern decides WHERE light lands, never colour: ink is luminance x
//     alpha, so the white pixels of the sheet cannot tint anything;
//   - the field never moves under tilt. The cut is seeded from the card id and is
//     fixed for every frame; only reflection.ts and iridescence.ts react to the
//     pointer;
//   - the sheet TILES, so a card may sample any window. Wrapping is this build's
//     disclosed choice: whether the real paper repeated is undocumented.
//
// The paper prints no marks, which is why this field is NOT a `plain` one: a plain
// field is uniform light, and a mirror is uniform light that varies along a
// diagonal. Every value stays above `MIRROR_FLOOR`, so the surface never goes dark
// the way a marked foil's bare field does.
//
// Copy variation is a phase, not a re-seed: two cards sit at different points along
// the band, and a card keeps its phase between frames. A save does not distinguish
// physical copies, so two copies of one card id share a cut — the variation is
// between cards, exactly as Cosmos, Starlight and Tinsel document.

import { hashKey } from '../holo'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import { MIRROR_DIRECTION } from './mirror-sheen'
import { CARD_ASPECT } from './radiant'
import { MIRROR_SHEET } from './mirror-index'
import type { MarkField } from './mark-field'

/** Side of the downsampled sampling grid (1024px sheet → 320px grid). */
export const MIRROR_GRID = 320

/** The texture is a drawing. No printing is verified against it. */
export const MIRROR_TEXTURE_VERIFIED = false

export type MirrorGrid = CosmosGrid

/** RGBA texels → sampling grid: mark = luminance x alpha, opacity = alpha. */
export function buildMirrorGrid(
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = MIRROR_GRID,
): MirrorGrid {
  return buildCosmosGrid(w, h, rgba, grid)
}

export type MirrorCopy = {
  /** Sheet-space offset, 0..1. Free to wrap: the sheet tiles. */
  offsetU: number
  offsetV: number
  seed: number
}

export type MirrorCopyOptions = {
  /** Pin the phase for one physical copy without inventing a printing. */
  copySeed?: string | number
}

/** The phase this card sits at. Deterministic in the card id. */
export function mirrorCopyFor(cardId: string, opts: MirrorCopyOptions = {}): MirrorCopy {
  const seed = hashKey(String(opts.copySeed ?? cardId) + ':mirror')
  return {
    offsetU: ((seed >>> 3) % 10007) / 10007,
    offsetV: ((seed >>> 13) % 7919) / 7919,
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
 * The mark at a point of the card. `u` is scaled by the card's aspect so the
 * diagonal stays physically diagonal on a 734x1024 card; `scale` > 1 zooms further
 * into the sheet — the inspector's texture-scale slider — and still wraps.
 */
export function sampleMirror(
  copy: MirrorCopy,
  grid: MirrorGrid,
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

/** Wrap a grid + phase as the renderer's mark field. */
export function mirrorFieldFor(cardId: string, grid: MirrorGrid, copy = mirrorCopyFor(cardId)): MarkField {
  return {
    id: `mirror:${cardId}`,
    label: 'Mirror · diagonal sheen',
    mark: (u, v, scale = 1) => sampleMirror(copy, grid, u, v, scale).mark,
    opacity: (u, v) => sampleMirror(copy, grid, u, v, 1).opacity,
    coverage: grid.coverage,
    peak: grid.peak,
    verified: MIRROR_TEXTURE_VERIFIED,
    note: 'Procedural reconstruction of the Mirror / Sheen foil from Bulbapedia’s description (diagonal refraction, bottom right to top left on international cards). The paper prints no marks, so this is uniform foil modulated along that diagonal — not a scan.',
    meta: {
      reproduction: 'procedural reconstruction',
      motif: 'diagonal sheen, no marks',
      direction: MIRROR_DIRECTION,
      offsetU: Number(copy.offsetU.toFixed(4)),
      offsetV: Number(copy.offsetV.toFixed(4)),
      sheet: MIRROR_SHEET.pattern,
      tiling: 'disclosed choice',
    },
  }
}

// ---------------------------------------------------------------------------
// Browser loading
// ---------------------------------------------------------------------------

let grid: MirrorGrid | null = null
let pending: Promise<MirrorGrid | null> | null = null

/** Texture pixels, same-origin only. */
async function readMirrorTexels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
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

function loadGrid(): Promise<MirrorGrid | null> {
  if (grid) return Promise.resolve(grid)
  if (pending) return pending
  const task = (async () => {
    try {
      const { w, h, data } = await readMirrorTexels(MIRROR_SHEET.pattern)
      return buildMirrorGrid(w, h, data)
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
 * The card's Mirror field, or null when the texture cannot be read. Null means the
 * renderer draws plain foil rather than a wrong pattern.
 */
export async function loadMirrorField(cardId: string): Promise<MarkField | null> {
  const copy = mirrorCopyFor(cardId)
  const loaded = await loadGrid()
  return loaded ? mirrorFieldFor(cardId, loaded, copy) : null
}

/** Drop the cached sheet. Only the debug panel needs this. */
export function forgetMirrorSheet(): void {
  grid = null
  pending = null
}
