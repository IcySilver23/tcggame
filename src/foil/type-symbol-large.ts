// Sun & Moon large type symbol, sampled as one glyph at the left of the card.
//
// The paper is not a repeating field: the print has a single large symbol on the
// left of the body. So this sampler maps an aspect-correct window of the sheet
// (card width 0.717 of its height) around the symbol, clamped rather than wrapped,
// and leaves the rest of the window blank — plain foil with no invented marks.
//
// The type still comes from the card (Trainer → Poké Ball, Pokémon → its type,
// unknown → nothing), and the artwork is still a reconstruction.

import { hashKey } from '../holo'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import { CARD_ASPECT } from './radiant'
import { cardMetaFor } from './type-symbol'
import { glyphForCard, parseTypes } from './type-symbol'
import {
  LARGE_TYPE_SYMBOL_ASSETS,
  LARGE_TYPE_SYMBOL_NOTE,
  LARGE_TYPE_SYMBOL_TEXTURE_VERIFIED,
  type LargeTypeSymbolGlyph,
} from './type-symbol-large-index'
import type { MarkField } from './mark-field'

export const LARGE_SYMBOL_GRID = 320

export type LargeSymbolGrid = CosmosGrid

export function buildLargeSymbolGrid(
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = LARGE_SYMBOL_GRID,
): LargeSymbolGrid {
  return buildCosmosGrid(w, h, rgba, grid)
}

export type LargeSymbolCopy = { offsetU: number; offsetV: number; zoom: number; seed: number }

/**
 * Anchor the window so the sheet's symbol sits near the left third of the card.
 * A few per-cent wander is seeded per card, then clamped so the symbol cannot be
 * pushed out of view.
 */
export function largeSymbolCopyFor(
  cardId: string,
  asset: { centerU: number; centerV: number },
  opts: { copySeed?: string | number } = {},
): LargeSymbolCopy {
  const seed = hashKey(String(opts.copySeed ?? cardId) + ':largesymbol')
  const zoom = 1.02 + (((seed >>> 20) % 997) / 997) * 0.06
  const sx = CARD_ASPECT * zoom
  const sy = Math.min(1, zoom)
  const jitterU = ((((seed >>> 3) % 10007) / 10007) - 0.5) * 0.05
  const targetU = 0.25 + jitterU
  const targetV = 0.5
  return {
    offsetU: Math.min(Math.max(0, asset.centerU - targetU * sx), Math.max(0, 1 - sx)),
    offsetV: Math.min(Math.max(0, asset.centerV - targetV * sy), Math.max(0, 1 - sy)),
    zoom,
    seed,
  }
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

function bilinearClamp(field: Float32Array, size: number, tx: number, ty: number): number {
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

export function sampleLargeTypeSymbol(
  copy: LargeSymbolCopy,
  grid: LargeSymbolGrid,
  u: number,
  v: number,
): { mark: number; opacity: number } {
  const sx = CARD_ASPECT * copy.zoom
  const sy = Math.min(1, copy.zoom)
  return {
    mark: bilinearClamp(grid.mark, grid.size, copy.offsetU + u * sx, copy.offsetV + v * sy),
    opacity: bilinearClamp(grid.opacity, grid.size, copy.offsetU + u * sx, copy.offsetV + v * sy),
  }
}

export function largeTypeSymbolFieldFor(
  cardId: string,
  glyph: LargeTypeSymbolGlyph,
  grid: LargeSymbolGrid,
  copy = largeSymbolCopyFor(cardId, LARGE_TYPE_SYMBOL_ASSETS[glyph]),
): MarkField {
  const asset = LARGE_TYPE_SYMBOL_ASSETS[glyph]
  return {
    id: `largesymbol:${glyph}:${cardId}`,
    label: `Large type symbol · ${asset.label}`,
    mark: (u, v) => sampleLargeTypeSymbol(copy, grid, u, v).mark,
    opacity: (u, v) => sampleLargeTypeSymbol(copy, grid, u, v).opacity,
    coverage: grid.coverage,
    peak: grid.peak,
    verified: LARGE_TYPE_SYMBOL_TEXTURE_VERIFIED,
    note: LARGE_TYPE_SYMBOL_NOTE,
    meta: {
      glyph,
      reproduction: 'stylised glyph reconstruction',
      placement: 'left of the card body',
      zoom: Number(copy.zoom.toFixed(3)),
      sheet: asset.texture,
    },
  }
}

const grids = new Map<LargeTypeSymbolGlyph, LargeSymbolGrid>()
const pending = new Map<LargeTypeSymbolGlyph, Promise<LargeSymbolGrid | null>>()

async function readTexels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  const blob = await res.blob()
  let draw: (ctx: CanvasRenderingContext2D) => void
  let w = 0
  let h = 0
  let close: (() => void) | null = null
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob)
    w = bmp.width; h = bmp.height
    draw = (ctx) => ctx.drawImage(bmp, 0, 0)
    close = () => bmp.close()
  } else {
    const objectUrl = URL.createObjectURL(blob)
    const img = new Image()
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok()
      img.onerror = () => fail(new Error('large type-symbol texture did not decode'))
      img.src = objectUrl
    }).finally(() => URL.revokeObjectURL(objectUrl))
    w = img.naturalWidth; h = img.naturalHeight
    draw = (ctx) => ctx.drawImage(img, 0, 0)
  }
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('no 2d context for the large type-symbol texture')
  draw(ctx)
  const data = ctx.getImageData(0, 0, w, h).data
  close?.()
  return { w, h, data }
}

function loadGrid(glyph: LargeTypeSymbolGlyph): Promise<LargeSymbolGrid | null> {
  const hit = grids.get(glyph)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(glyph)
  if (inflight) return inflight
  const task = (async () => {
    try {
      const { w, h, data } = await readTexels(LARGE_TYPE_SYMBOL_ASSETS[glyph].texture)
      return buildLargeSymbolGrid(w, h, data)
    } catch {
      return null
    } finally {
      pending.delete(glyph)
    }
  })()
  pending.set(glyph, task)
  task.then((g) => { if (g) grids.set(glyph, g) })
  return task
}

export async function loadLargeTypeSymbolField(
  cardId: string,
  input: { types?: string | string[] | null; supertype?: string | null } = {},
): Promise<MarkField | null> {
  let types = input.types ?? null
  let supertype = input.supertype ?? null
  if (!types && !supertype) {
    const meta = await cardMetaFor(cardId)
    types = meta?.types ?? null
    supertype = meta?.supertype ?? null
  }
  const glyph = glyphForCard({ types, supertype })
  if (!glyph) return null
  const copy = largeSymbolCopyFor(cardId, LARGE_TYPE_SYMBOL_ASSETS[glyph])
  const loaded = await loadGrid(glyph)
  return loaded ? largeTypeSymbolFieldFor(cardId, glyph, loaded, copy) : null
}

export { parseTypes }
