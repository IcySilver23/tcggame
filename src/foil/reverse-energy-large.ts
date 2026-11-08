// Ascended Heroes' Energy-pattern reverse, sampled.
//
// One large symbol from the card's own type sits behind the attack text. The glyph
// never comes from the set: a Pokémon resolves through its `types`, a Trainer or
// Energy card returns null (those printings are plain reverses), and an unknown
// type returns null so the renderer draws plain foil instead of a wrong symbol.
//
// The symbol is not a repeating field. The sampler maps a 0.95 window around the
// sheet's centre to (0.5, 0.675) down the card, with a small per-card jitter,
// clamped so it cannot leave the card. The etch and the ball are separate
// papers; this module owns only the Energy stamp.

import { hashKey } from '../holo'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import {
  ENERGY_REVERSE_ASSETS,
  ENERGY_REVERSE_GEOMETRY,
  ENERGY_REVERSE_NOTE,
  ENERGY_REVERSE_REFERENCE,
  ENERGY_REVERSE_TEXTURE_VERIFIED,
  type EnergyReverseGlyph,
} from './reverse-energy-large-index'
import { cardMetaFor, glyphForCard } from './type-symbol'
import type { MarkField } from './mark-field'

export const ENERGY_REVERSE_GRID = 320

export type EnergyReverseGrid = CosmosGrid
export type EnergyReverseCopy = {
  sx: number
  sy: number
  offsetU: number
  offsetV: number
  seed: number
}

export function buildEnergyReverseGrid(
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = ENERGY_REVERSE_GRID,
): EnergyReverseGrid {
  return buildCosmosGrid(w, h, rgba, grid)
}

/**
 * Anchor the single stamp behind the attack text. The reference puts the symbol
 * around 0.675 down the card; the per-card wander is small and every offset is
 * clamped. A square sheet is sampled at 0.95 on both axes, because the card's
 * aspect is already expressed by the card-space coordinates.
 */
export function energyReverseCopyFor(
  cardId: string,
  asset: { centerU: number; centerV: number },
): EnergyReverseCopy {
  const seed = hashKey(cardId + ':energy-reverse')
  const sx = ENERGY_REVERSE_GEOMETRY.window
  const sy = ENERGY_REVERSE_GEOMETRY.window
  const jitterU = ((((seed >>> 4) % 1000) / 1000) - 0.5) * 0.04
  const jitterV = ((((seed >>> 14) % 1000) / 1000) - 0.5) * 0.04
  const targetU = ENERGY_REVERSE_GEOMETRY.targetU + jitterU
  const targetV = ENERGY_REVERSE_GEOMETRY.targetV + jitterV
  return {
    sx,
    sy,
    seed,
    offsetU: Math.min(Math.max(0, asset.centerU - targetU * sx), 1 - sx),
    // Vertical offsets are deliberately allowed to go negative: the sheet has
    // blank space above the symbol, and this is what maps the glyph centre to
    // the measured .675 target instead of clamping it back to the card centre.
    offsetV: asset.centerV - targetV * sy,
  }
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

function bilinearSample(field: Float32Array, size: number, tx: number, ty: number): number {
  // Outside the sheet is blank foil, not the edge texel stretched across the
  // body. Negative vertical offsets are how the stamp reaches .675 down the card.
  if (tx < 0 || tx > 1 || ty < 0 || ty > 1) return 0
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

export type EnergyReverseSample = { mark: number; opacity: number }

export function sampleEnergyReverse(
  copy: EnergyReverseCopy,
  grid: EnergyReverseGrid,
  u: number,
  v: number,
): EnergyReverseSample {
  const tx = copy.offsetU + u * copy.sx
  const ty = copy.offsetV + v * copy.sy
  return {
    mark: bilinearSample(grid.mark, grid.size, tx, ty),
    opacity: bilinearSample(grid.opacity, grid.size, tx, ty),
  }
}

export function energyReverseFieldFor(
  cardId: string,
  glyph: EnergyReverseGlyph,
  grid: EnergyReverseGrid,
  copy = energyReverseCopyFor(cardId, ENERGY_REVERSE_ASSETS[glyph]),
): MarkField {
  const asset = ENERGY_REVERSE_ASSETS[glyph]
  return {
    id: `energy-reverse:${glyph}:${cardId}`,
    label: `Reverse · Energy symbol · ${asset.label}`,
    mark: (u, v) => sampleEnergyReverse(copy, grid, u, v).mark,
    opacity: (u, v) => sampleEnergyReverse(copy, grid, u, v).opacity,
    coverage: grid.coverage,
    peak: grid.peak,
    verified: ENERGY_REVERSE_TEXTURE_VERIFIED,
    note: ENERGY_REVERSE_NOTE,
    meta: {
      pattern: 'reverse-energy-large',
      glyph,
      reproduction: 'stylised glyph reconstruction',
      placement: 'behind the attack text, on the card body',
      sheet: asset.texture,
      reference: ENERGY_REVERSE_REFERENCE,
      targetU: ENERGY_REVERSE_GEOMETRY.targetU,
      targetV: ENERGY_REVERSE_GEOMETRY.targetV,
      window: ENERGY_REVERSE_GEOMETRY.window,
      stampWidth: ENERGY_REVERSE_GEOMETRY.stampWidth,
      stampHeight: ENERGY_REVERSE_GEOMETRY.stampHeight,
    },
  }
}

// ---------------------------------------------------------------------------
// Browser loading
// ---------------------------------------------------------------------------

const grids = new Map<EnergyReverseGlyph, EnergyReverseGrid>()
const pending = new Map<EnergyReverseGlyph, Promise<EnergyReverseGrid | null>>()

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
      img.onerror = () => fail(new Error('Energy reverse texture did not decode'))
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
  if (!ctx) throw new Error('no 2d context for the Energy reverse texture')
  draw(ctx)
  const data = ctx.getImageData(0, 0, w, h).data
  close?.()
  return { w, h, data }
}

function loadGrid(glyph: EnergyReverseGlyph): Promise<EnergyReverseGrid | null> {
  const hit = grids.get(glyph)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(glyph)
  if (inflight) return inflight
  const task = (async () => {
    try {
      const { w, h, data } = await readTexels(ENERGY_REVERSE_ASSETS[glyph].texture)
      return buildEnergyReverseGrid(w, h, data)
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

/**
 * The field for an Energy-pattern reverse, or null for plain foil. Only a regular
 * Pokémon with a known type gets a stamp; Trainers, Energy and unknown types stay
 * plain.
 */
/** The glyph this card would use, or null when it must stay plain. */
export function energyReverseGlyphFor(input: {
  types?: string | string[] | null
  supertype?: string | null
}): EnergyReverseGlyph | null {
  if ((input.supertype ?? '').toLowerCase() !== 'pokémon') return null
  const glyph = glyphForCard({ types: input.types, supertype: input.supertype })
  return glyph && glyph !== 'trainer' ? glyph : null
}

export async function loadEnergyReverseField(
  cardId: string,
  input: { types?: string | string[] | null; supertype?: string | null } = {},
): Promise<MarkField | null> {
  let types = input.types ?? null
  let supertype = input.supertype ?? null
  if (!types || !supertype) {
    const meta = await cardMetaFor(cardId)
    types = types ?? meta?.types ?? null
    supertype = supertype ?? meta?.supertype ?? null
  }
  const glyph = energyReverseGlyphFor({ types, supertype })
  if (!glyph) return null
  const copy = energyReverseCopyFor(cardId, ENERGY_REVERSE_ASSETS[glyph])
  const grid = await loadGrid(glyph)
  return grid ? energyReverseFieldFor(cardId, glyph, grid, copy) : null
}
