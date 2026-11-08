// Sword & Shield reverse paper: a lattice of rounded tiles, each carrying the
// card's own type symbol (Poké Ball for Trainers).
//
// Bulbapedia describes the pattern as tiles each containing the type symbol or a
// Poké Ball. The lattice and glyphs here are PROCEDURAL RECONSTRUCTIONS: the
// identity of the paper is documented, the artwork is not.
//
// The sheet tiles, so a card samples it repeatedly at the pattern's own scale and
// registration; the type comes from the card, never from the set.

import { hashKey } from '../holo'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import { glyphForCard } from './type-symbol'
import { cardMetaFor } from './type-symbol'
import { GLYPH_IDS, type GlyphId } from './type-glyph'
import { renderReverseTileSheet, REVERSE_TILE_SIZE, type ReverseTileSheet } from './reverse-tile-sheet'
export { renderReverseTileSheet, REVERSE_TILE_SIZE, type ReverseTileSheet }
import {
  REVERSE_TILE_ASSETS, REVERSE_TILE_SCALE, REVERSE_TILE_TEXTURE_VERIFIED, REVERSE_TILE_NOTE,
} from './reverse-tile-index'
import type { MarkField } from './mark-field'

export const REVERSE_TILE_GRID = 320

export type ReverseTileGrid = CosmosGrid

export function buildReverseTileGrid(w: number, h: number, rgba: Uint8ClampedArray | Uint8Array, grid = REVERSE_TILE_GRID): ReverseTileGrid {
  return buildCosmosGrid(w, h, rgba, grid)
}

const wrap = (t: number) => t - Math.floor(t)
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

/** One tile sheet: a staggered lattice of rounded tiles, each with one glyph. */

export function tileOffsetFor(cardId: string): { offsetU: number; offsetV: number } {
  const seed = hashKey(cardId + ':reversetile')
  return {
    offsetU: ((seed >>> 5) % 10007) / 10007,
    offsetV: ((seed >>> 15) % 7919) / 7919,
  }
}

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

export function sampleReverseTile(
  cardId: string,
  grid: ReverseTileGrid,
  u: number,
  v: number,
  scale = 1,
): number {
  const s = REVERSE_TILE_SCALE * Math.max(0.1, scale)
  const { offsetU, offsetV } = tileOffsetFor(cardId)
  return bilinearWrap(grid.mark, grid.size, offsetU + u * s, offsetV + v * s)
}

export function reverseTileFieldFor(cardId: string, glyph: GlyphId, grid: ReverseTileGrid): MarkField {
  const asset = REVERSE_TILE_ASSETS[glyph]
  const { offsetU, offsetV } = tileOffsetFor(cardId)
  return {
    id: `reversetile:${glyph}:${cardId}`,
    label: `Reverse tile · ${asset.label}`,
    mark: (u, v, scale = 1) => sampleReverseTile(cardId, grid, u, v, scale),
    opacity: (u, v) => sampleReverseTile(cardId, grid, u, v, 1),
    coverage: grid.coverage,
    peak: grid.peak,
    verified: REVERSE_TILE_TEXTURE_VERIFIED,
    note: REVERSE_TILE_NOTE,
    meta: {
      pattern: 'reverse-tile',
      glyph,
      scale: REVERSE_TILE_SCALE,
      offsetU: Number(offsetU.toFixed(4)),
      offsetV: Number(offsetV.toFixed(4)),
      approximation: true,
      reproduction: 'stylised tile lattice reconstruction',
      sheet: asset.texture,
    },
  }
}

const grids = new Map<GlyphId, ReverseTileGrid>()
const pending = new Map<GlyphId, Promise<ReverseTileGrid | null>>()

function decode(blob: Blob): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      URL.revokeObjectURL(url)
      if (!ctx) return fail(new Error('no 2d context for the reverse tile'))
      ctx.drawImage(img, 0, 0)
      ok({ w: img.naturalWidth, h: img.naturalHeight, data: ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data })
    }
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('reverse tile texture did not decode')) }
    img.src = url
  })
}

function loadGrid(glyph: GlyphId): Promise<ReverseTileGrid | null> {
  const hit = grids.get(glyph)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(glyph)
  if (inflight) return inflight
  const task = (async () => {
    try {
      const res = await fetch(REVERSE_TILE_ASSETS[glyph].texture, { credentials: 'same-origin' })
      if (!res.ok) return null
      const { w, h, data } = await decode(await res.blob())
      return buildCosmosGrid(w, h, data, REVERSE_TILE_GRID)
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

export async function loadReverseTileField(
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
  const grid = await loadGrid(glyph)
  return grid ? reverseTileFieldFor(cardId, glyph, grid) : null
}

export { GLYPH_IDS }
