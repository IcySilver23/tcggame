// EX Hidden Legends – EX Team Rocket Returns: energy symbols inside the picture
// window.
//
// The paper is a dense field of the card's own type symbol behind the Pokémon.
// The glyph sheets are the same stylised drawings used by the BW/XY paper, sampled
// at a tighter repeat and cut by the art-window mask. A reconstruction, not a scan:
// every field says so.

import { hashKey } from '../holo'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import { cardMetaFor, glyphForCard } from './type-symbol'
import { TYPE_SYMBOL_ASSETS, type TypeSymbolGlyph } from './type-symbol-index'
import type { MarkField } from './mark-field'

export const REVERSE_ENERGY_GRID = 320
/** Copies across the card. Denser than the body paper: symbols sit behind the art. */
export const REVERSE_ENERGY_SCALE = 2.6
export const REVERSE_ENERGY_TEXTURE_VERIFIED = false
export const REVERSE_ENERGY_NOTE =
  "Energy symbols of the card's own type inside the picture window; stylised glyph drawings from the type-symbol sheets, reconstructed rather than scanned."

export type ReverseEnergyGrid = CosmosGrid

export function buildReverseEnergyGrid(
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = REVERSE_ENERGY_GRID,
): ReverseEnergyGrid {
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

export function energyOffsetFor(cardId: string): { offsetU: number; offsetV: number } {
  const seed = hashKey(cardId + ':reverseenergy')
  return {
    offsetU: ((seed >>> 5) % 10007) / 10007,
    offsetV: ((seed >>> 15) % 7919) / 7919,
  }
}

export function sampleReverseEnergy(
  cardId: string,
  grid: ReverseEnergyGrid,
  u: number,
  v: number,
  scale = 1,
): number {
  const s = REVERSE_ENERGY_SCALE * Math.max(0.1, scale)
  const { offsetU, offsetV } = energyOffsetFor(cardId)
  return bilinearWrap(grid.mark, grid.size, offsetU + u * s, offsetV + v * s)
}

export function reverseEnergyFieldFor(
  cardId: string,
  glyph: TypeSymbolGlyph,
  grid: ReverseEnergyGrid,
): MarkField {
  const asset = TYPE_SYMBOL_ASSETS[glyph]
  const { offsetU, offsetV } = energyOffsetFor(cardId)
  return {
    id: `reverseenergy:${glyph}:${cardId}`,
    label: `Reverse energy symbols · ${asset.label}`,
    mark: (u, v, scale = 1) => sampleReverseEnergy(cardId, grid, u, v, scale),
    opacity: (u, v) => sampleReverseEnergy(cardId, grid, u, v, 1),
    coverage: grid.coverage,
    peak: grid.peak,
    verified: REVERSE_ENERGY_TEXTURE_VERIFIED,
    note: REVERSE_ENERGY_NOTE,
    meta: {
      pattern: 'reverse-energy-symbol',
      glyph,
      scale: REVERSE_ENERGY_SCALE,
      offsetU: Number(offsetU.toFixed(4)),
      offsetV: Number(offsetV.toFixed(4)),
      approximation: true,
      reproduction: 'energy-symbol field reconstruction',
      sheet: asset.texture,
    },
  }
}

const grids = new Map<TypeSymbolGlyph, ReverseEnergyGrid>()
const pending = new Map<TypeSymbolGlyph, Promise<ReverseEnergyGrid | null>>()

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
      if (!ctx) return fail(new Error('no 2d context for the energy-symbol sheet'))
      ctx.drawImage(img, 0, 0)
      ok({ w: img.naturalWidth, h: img.naturalHeight, data: ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data })
    }
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('energy-symbol sheet did not decode')) }
    img.src = url
  })
}

function loadGrid(glyph: TypeSymbolGlyph): Promise<ReverseEnergyGrid | null> {
  const hit = grids.get(glyph)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(glyph)
  if (inflight) return inflight
  const task = (async () => {
    try {
      const res = await fetch(TYPE_SYMBOL_ASSETS[glyph].texture, { credentials: 'same-origin' })
      if (!res.ok) return null
      const { w, h, data } = await decode(await res.blob())
      return buildReverseEnergyGrid(w, h, data)
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

export async function loadReverseEnergyField(
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
  const glyph = glyphForCard({ types, supertype }) as TypeSymbolGlyph | null
  if (!glyph) return null
  const grid = await loadGrid(glyph)
  return grid ? reverseEnergyFieldFor(cardId, glyph, grid) : null
}
