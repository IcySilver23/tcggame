// Type-symbol reverse paper, sampled: the card's own type, never a substitute.
//
// The BW/XY reverse holo repeats the card's type symbol over the card body, with a
// Poké Ball for Trainers. The glyph must therefore come from the card, so this
// module resolves it in one place:
//
//   - a Trainer resolves to the Poké Ball;
//   - a Pokémon resolves through its `types` entry (first recognised type);
//   - an unknown or missing type resolves to NOTHING, and the caller draws plain
//     foil. Guessing a type would put the wrong symbol on the card, which is worse
//     than no symbol and is exactly what this project refuses to do.
//
// Types normally arrive with the card row. Thumbnails only pass rarity, variant and
// id, so when the type is absent this loader asks `/api/cards/meta` once per card
// and caches the answer; the server returns `types` and `supertype`.
//
// The sheets are tiles (glyphs are stamped with wrap-around), so a card samples a
// window with wrapped bilinear reads. Every field carries `verified: false`: the
// glyphs are stylised drawings, not official icons.

import { hashKey } from '../holo'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import {
  TYPE_SYMBOL_ASSETS,
  TYPE_SYMBOL_SCALE,
  TYPE_SYMBOL_TEXTURE_VERIFIED,
  TYPE_SYMBOL_NOTE,
  type TypeSymbolGlyph,
} from './type-symbol-index'
import type { MarkField } from './mark-field'

export const TYPE_SYMBOL_GRID = 320

export type SymbolGrid = CosmosGrid

export function buildSymbolGrid(
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = TYPE_SYMBOL_GRID,
): SymbolGrid {
  return buildCosmosGrid(w, h, rgba, grid)
}

const TYPE_TO_GLYPH: Record<string, TypeSymbolGlyph> = {
  Grass: 'grass',
  Fire: 'fire',
  Water: 'water',
  Lightning: 'lightning',
  Psychic: 'psychic',
  Fighting: 'fighting',
  Darkness: 'darkness',
  Metal: 'metal',
  Dragon: 'dragon',
  Fairy: 'fairy',
  Colorless: 'colorless',
}

export function parseTypes(types: string | string[] | null | undefined): string[] {
  if (!types) return []
  if (Array.isArray(types)) return types
  try {
    const parsed = JSON.parse(types) as unknown
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return types.split(/[,\s]+/).filter(Boolean)
  }
}

/**
 * The glyph for a card, or null when the type is unknown. Trainers use the Poké
 * Ball regardless of any type field.
 */
export function glyphForCard(input: {
  types?: string | string[] | null
  supertype?: string | null
}): TypeSymbolGlyph | null {
  if ((input.supertype ?? '').toLowerCase() === 'trainer') return 'trainer'
  for (const type of parseTypes(input.types)) {
    const glyph = TYPE_TO_GLYPH[type]
    if (glyph) return glyph
  }
  return null
}

export type SymbolCopy = { offsetU: number; offsetV: number; seed: number }

export function symbolCopyFor(cardId: string, opts: { copySeed?: string | number } = {}): SymbolCopy {
  const seed = hashKey(String(opts.copySeed ?? cardId) + ':typesymbol')
  return {
    offsetU: ((seed >>> 3) % 10007) / 10007,
    offsetV: ((seed >>> 13) % 7919) / 7919,
    seed,
  }
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

export function sampleTypeSymbol(
  copy: SymbolCopy,
  grid: SymbolGrid,
  u: number,
  v: number,
  scale = 1,
): { mark: number; opacity: number } {
  const s = TYPE_SYMBOL_SCALE * Math.max(0.1, scale)
  const tx = copy.offsetU + u * s
  const ty = copy.offsetV + v * s
  return {
    mark: bilinearWrap(grid.mark, grid.size, tx, ty),
    opacity: bilinearWrap(grid.opacity, grid.size, tx, ty),
  }
}

export function typeSymbolFieldFor(cardId: string, glyph: TypeSymbolGlyph, grid: SymbolGrid, copy = symbolCopyFor(cardId)): MarkField {
  const asset = TYPE_SYMBOL_ASSETS[glyph]
  return {
    id: `typesymbol:${glyph}:${cardId}`,
    label: `Type symbol · ${asset.label}`,
    mark: (u, v, scale = 1) => sampleTypeSymbol(copy, grid, u, v, scale).mark,
    opacity: (u, v) => sampleTypeSymbol(copy, grid, u, v, 1).opacity,
    coverage: grid.coverage,
    peak: grid.peak,
    verified: TYPE_SYMBOL_TEXTURE_VERIFIED,
    note: TYPE_SYMBOL_NOTE,
    meta: {
      glyph,
      reproduction: 'stylised glyph reconstruction',
      offsetU: Number(copy.offsetU.toFixed(4)),
      offsetV: Number(copy.offsetV.toFixed(4)),
      scale: TYPE_SYMBOL_SCALE,
      sheet: asset.texture,
    },
  }
}

// ---------------------------------------------------------------------------
// Card metadata (type + supertype), cached per card
// ---------------------------------------------------------------------------

type CardMeta = { types: string | null; supertype: string | null }
const metaCache = new Map<string, CardMeta | null>()
const metaPending = new Map<string, Promise<CardMeta | null>>()

export async function cardMetaFor(cardId: string): Promise<CardMeta | null> {
  const hit = metaCache.get(cardId)
  if (hit !== undefined) return hit
  const inflight = metaPending.get(cardId)
  if (inflight) return inflight
  const task = (async () => {
    try {
      const res = await fetch(`/api/cards/meta?ids=${encodeURIComponent(cardId)}`, { credentials: 'same-origin' })
      if (!res.ok) return null
      const json = (await res.json()) as
        | { id?: string; types?: string | null; supertype?: string | null }[]
        | { cards?: { types?: string | null; supertype?: string | null }[] }
      const row = Array.isArray(json) ? json[0] : json.cards?.[0]
      if (!row) return null
      const meta = { types: row.types ?? null, supertype: row.supertype ?? null }
      metaCache.set(cardId, meta)
      return meta
    } catch {
      return null
    } finally {
      metaPending.delete(cardId)
    }
  })()
  metaPending.set(cardId, task)
  return task
}

// ---------------------------------------------------------------------------
// Browser loading
// ---------------------------------------------------------------------------

const grids = new Map<TypeSymbolGlyph, SymbolGrid>()
const pending = new Map<TypeSymbolGlyph, Promise<SymbolGrid | null>>()

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
    w = bmp.width
    h = bmp.height
    draw = (ctx) => ctx.drawImage(bmp, 0, 0)
    close = () => bmp.close()
  } else {
    const objectUrl = URL.createObjectURL(blob)
    const img = new Image()
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok()
      img.onerror = () => fail(new Error('type-symbol texture did not decode'))
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
  if (!ctx) throw new Error('no 2d context for the type-symbol texture')
  draw(ctx)
  const data = ctx.getImageData(0, 0, w, h).data
  close?.()
  return { w, h, data }
}

function loadGrid(glyph: TypeSymbolGlyph): Promise<SymbolGrid | null> {
  const hit = grids.get(glyph)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(glyph)
  if (inflight) return inflight
  const task = (async () => {
    try {
      const { w, h, data } = await readTexels(TYPE_SYMBOL_ASSETS[glyph].texture)
      return buildSymbolGrid(w, h, data)
    } catch {
      return null
    } finally {
      pending.delete(glyph)
    }
  })()
  pending.set(glyph, task)
  task.then((g) => {
    if (g) grids.set(glyph, g)
  })
  return task
}

/**
 * The card's type-symbol field, or null when its type is unknown (plain foil).
 * Types are fetched from the metadata endpoint only when the caller did not
 * supply them.
 */
export async function loadTypeSymbolField(
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
  const copy = symbolCopyFor(cardId)
  const loaded = await loadGrid(glyph)
  return loaded ? typeSymbolFieldFor(cardId, glyph, loaded, copy) : null
}
