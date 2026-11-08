// The reverse pattern layer: sampling a reverse sheet for a card.
//
// Reverse patterns are printed on a repeating master sheet, unlike Cosmos (which
// is cut as one window per card). So this module wraps where cosmos.ts clamps:
// the generated reverse textures are drawn with wrap-around and verified for a
// low seam, and a card samples them repeatedly at the pattern's own scale.
//
// Two pattern families exist so far:
//
//   - `reverse-fireworks` — Legendary Collection. Real burst-shaped marks, not
//     sparkle noise: each burst is a glow plus rays and trailing dots.
//   - `reverse-flat` — Expedition and the Diamond & Pearl run. A PLAIN foil with
//     no printed marks. It is modelled as a `plain` field, which means the
//     reflection is uniform and the duplicate-decoration guard is skipped; a
//     mark-shaped modulation here would invent a pattern the card never had.
//
// A reverse pattern that has no texture yet returns null, so the renderer falls
// back to the generic tile rather than pretending. `reversePending()` lists them.

import { hashKey } from '../holo'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import { reverseConfigFor } from './reverse-db'
import { REVERSE_ASSETS } from './reverse-index'
import type { MarkField } from './mark-field'
import type { FoilPatternId } from './patterns'

export const REVERSE_GRID = 320

export type ReverseGrid = CosmosGrid

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

/**
 * Each card gets its own registration against the sheet: two copies of a
 * printing do not have their bursts in the same place. Seeded by the card id, so
 * it is stable frame to frame — the pattern must not swim under tilt.
 */
export function reverseOffsetFor(cardId: string): { offsetU: number; offsetV: number; seed: number } {
  const seed = hashKey(cardId + ':reverse')
  return {
    offsetU: ((seed >>> 3) % 10007) / 10007,
    offsetV: ((seed >>> 13) % 7919) / 7919,
    seed,
  }
}

export function sampleReverse(
  cardId: string,
  pattern: FoilPatternId,
  grid: ReverseGrid,
  u: number,
  v: number,
  scale = 1,
): number {
  const asset = REVERSE_ASSETS[pattern]
  const s = (asset?.scale ?? 1) * Math.max(0.1, scale)
  const { offsetU, offsetV } = reverseOffsetFor(cardId)
  return bilinearWrap(grid.mark, grid.size, offsetU + u * s, offsetV + v * s)
}

/** A reverse printing's field, or null when this pattern has no texture yet. */
export function reverseFieldFor(cardId: string, pattern: FoilPatternId, grid: ReverseGrid | null): MarkField | null {
  const asset = REVERSE_ASSETS[pattern]
  if (!asset) return null

  if (asset.plain) {
    return {
      id: `reverse:${pattern}:${cardId}`,
      label: `Reverse · ${asset.label}`,
      // A plain foil has no marks. Returning 1 (not 0) is what keeps the light
      // uniform instead of leaving the bare-field floor showing through.
      mark: () => 1,
      opacity: () => 1,
      coverage: 1,
      peak: 1,
      verified: asset.approximation === false,
      note: asset.note,
      meta: {
        pattern,
        plain: true,
        approximation: asset.approximation,
        reproduction: asset.reproduction,
      },
      plain: true,
    }
  }
  if (!grid) return null
  const { offsetU, offsetV } = reverseOffsetFor(cardId)
  return {
    id: `reverse:${pattern}:${cardId}`,
    label: `Reverse · ${asset.label}`,
    mark: (u, v, scale = 1) => sampleReverse(cardId, pattern, grid, u, v, scale),
    opacity: (u, v) => sampleReverse(cardId, pattern, grid, u, v, 1),
    coverage: grid.coverage,
    peak: grid.peak,
    verified: asset.approximation === false,
    note: asset.note,
    meta: {
      pattern,
      scale: asset.scale,
      offsetU: Number(offsetU.toFixed(4)),
      offsetV: Number(offsetV.toFixed(4)),
      approximation: asset.approximation,
      reproduction: asset.reproduction,
    },
  }
}

// ---------------------------------------------------------------------------
// Browser loading
// ---------------------------------------------------------------------------

const grids = new Map<FoilPatternId, ReverseGrid>()
const pending = new Map<FoilPatternId, Promise<ReverseGrid | null>>()

async function readTexels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const img = new Image()
  await new Promise<void>((ok, fail) => {
    img.onload = () => ok()
    img.onerror = () => fail(new Error('reverse texture did not decode'))
    img.src = objectUrl
  }).finally(() => URL.revokeObjectURL(objectUrl))
  const w = img.naturalWidth
  const h = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('no 2d context for the reverse texture')
  ctx.drawImage(img, 0, 0)
  return { w, h, data: ctx.getImageData(0, 0, w, h).data }
}

function loadGrid(pattern: FoilPatternId): Promise<ReverseGrid | null> {
  const hit = grids.get(pattern)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(pattern)
  if (inflight) return inflight
  const asset = REVERSE_ASSETS[pattern]
  if (!asset || asset.plain) return Promise.resolve(null)
  const task = (async () => {
    try {
      const { w, h, data } = await readTexels(asset.texture)
      return buildCosmosGrid(w, h, data)
    } catch {
      return null
    } finally {
      pending.delete(pattern)
    }
  })()
  pending.set(pattern, task)
  task.then((g) => {
    if (g) grids.set(pattern, g)
  })
  return task
}

/**
 * The reverse field for a card, or null when its pattern is not painted yet.
 * Async only because a texture has to be decoded; a plain pattern resolves
 * immediately.
 */
export async function loadReverseField(
  cardId: string,
  input: { setId?: string | null; rarity?: string | null; variant?: string | null },
): Promise<MarkField | null> {
  const cfg = reverseConfigFor(input.setId ?? null)
  if (!cfg) return null
  const asset = REVERSE_ASSETS[cfg.pattern]
  if (!asset) return null
  if (asset.plain) return reverseFieldFor(cardId, cfg.pattern, null)
  const grid = await loadGrid(cfg.pattern)
  return grid ? reverseFieldFor(cardId, cfg.pattern, grid) : null
}
