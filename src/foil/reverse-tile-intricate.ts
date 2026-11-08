// Scarlet & Violet intricate-tile reverse paper: sampling and loading.
//
// Bulbapedia describes nested tiles with type symbols of different sizes. The
// sheets tile, so a card samples any window; the glyph comes from the card and an
// unknown type renders plain foil rather than a wrong symbol.

import { hashKey } from '../holo'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import { cardMetaFor, glyphForCard } from './type-symbol'
import type { GlyphId } from './type-glyph'
import {
  REVERSE_TILE_INTRICATE_ASSETS, REVERSE_TILE_INTRICATE_SCALE,
  REVERSE_TILE_INTRICATE_TEXTURE_VERIFIED, REVERSE_TILE_INTRICATE_NOTE,
} from './reverse-tile-intricate-index'
import type { MarkField } from './mark-field'

export const REVERSE_TILE_INTRICATE_GRID = 320

export type ReverseTileIntricateGrid = CosmosGrid

export function buildReverseTileIntricateGrid(
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = REVERSE_TILE_INTRICATE_GRID,
): ReverseTileIntricateGrid {
  return buildCosmosGrid(w, h, rgba, grid)
}

const wrap = (t: number) => t - Math.floor(t)
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

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

export function intricateOffsetFor(cardId: string): { offsetU: number; offsetV: number } {
  const seed = hashKey(cardId + ':reversetileintricate')
  return {
    offsetU: ((seed >>> 7) % 10007) / 10007,
    offsetV: ((seed >>> 17) % 7919) / 7919,
  }
}

export function sampleReverseTileIntricate(
  cardId: string,
  grid: ReverseTileIntricateGrid,
  u: number,
  v: number,
  scale = 1,
): number {
  const s = REVERSE_TILE_INTRICATE_SCALE * Math.max(0.1, scale)
  const { offsetU, offsetV } = intricateOffsetFor(cardId)
  return bilinearWrap(grid.mark, grid.size, offsetU + u * s, offsetV + v * s)
}

export function reverseTileIntricateFieldFor(
  cardId: string,
  glyph: GlyphId,
  grid: ReverseTileIntricateGrid,
): MarkField {
  const asset = REVERSE_TILE_INTRICATE_ASSETS[glyph]
  const { offsetU, offsetV } = intricateOffsetFor(cardId)
  return {
    id: `reversetileintricate:${glyph}:${cardId}`,
    label: `Reverse intricate tile · ${asset.label}`,
    mark: (u, v, scale = 1) => sampleReverseTileIntricate(cardId, grid, u, v, scale),
    opacity: (u, v) => sampleReverseTileIntricate(cardId, grid, u, v, 1),
    coverage: grid.coverage,
    peak: grid.peak,
    verified: REVERSE_TILE_INTRICATE_TEXTURE_VERIFIED,
    note: REVERSE_TILE_INTRICATE_NOTE,
    meta: {
      pattern: 'reverse-tile-intricate',
      glyph,
      scale: REVERSE_TILE_INTRICATE_SCALE,
      offsetU: Number(offsetU.toFixed(4)),
      offsetV: Number(offsetV.toFixed(4)),
      approximation: true,
      reproduction: 'nested tile lattice reconstruction',
      sheet: asset.texture,
    },
  }
}

const grids = new Map<GlyphId, ReverseTileIntricateGrid>()
const pending = new Map<GlyphId, Promise<ReverseTileIntricateGrid | null>>()

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
      if (!ctx) return fail(new Error('no 2d context for the intricate tile'))
      ctx.drawImage(img, 0, 0)
      ok({ w: img.naturalWidth, h: img.naturalHeight, data: ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data })
    }
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('intricate tile texture did not decode')) }
    img.src = url
  })
}

function loadGrid(glyph: GlyphId): Promise<ReverseTileIntricateGrid | null> {
  const hit = grids.get(glyph)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(glyph)
  if (inflight) return inflight
  const task = (async () => {
    try {
      const res = await fetch(REVERSE_TILE_INTRICATE_ASSETS[glyph].texture, { credentials: 'same-origin' })
      if (!res.ok) return null
      const { w, h, data } = await decode(await res.blob())
      return buildReverseTileIntricateGrid(w, h, data)
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

export async function loadReverseTileIntricateField(
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
  return grid ? reverseTileIntricateFieldFor(cardId, glyph, grid) : null
}
