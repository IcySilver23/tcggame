// Cosmos / Galaxy: the sheet, loaded and sampled per card copy.
//
// Cosmos is not a sparkle. It is a printed sheet of round marks — a few large
// "planets", many medium orbs, a fine speckle, and (on the vintage paper) small
// four-point stars — with the foil's iridescence moving over them. Three
// consequences shape this module:
//
//   - The marks are the pattern layer, so they must never move. Tilt changes the
//     light (reflection.ts + iridescence.ts), never the sampling position here.
//
//   - The pack's four textures are PROCEDURAL approximations of the sheet, not
//     scans, so `verified` is false wherever the texture is what is being
//     described. Which CARDS are Cosmos is a separate, evidenced claim in
//     cosmos-masks.ts.
//
//   - Real copies differ because the sheet was cut differently for each card, so
//     a swirl that sits centre-left on one copy sits off the edge on another.
//     That is modelled as a per-card CROP of the sheet, seeded from the card id:
//     fixed for a given card (no shimmer between frames), different between
//     copies. The sheet's orientation flips between sets, so that bit is seeded
//     from the set id instead — every card of a set was cut from the same
//     orientation.
//
// Why a crop and not a repeat: measured on the shipped files, the seam across a
// wrap is 3-10x the variation inside the tile (classic_dense 0.017 vs 0.0014),
// so tiling would draw a visible grid seam across the artwork. One card-sized
// window, never wrapped, is the honest reading of these assets — and it is also
// what makes copy-to-copy variation possible at all.

import { hashKey, setIdOf } from '../holo'
import { printingFor } from './printing-db'
import { COSMOS_VARIANTS, type CosmosVariant, type CosmosVariantId } from './cosmos-index'
import { CARD_ASPECT } from './radiant'
import type { MarkField } from './mark-field'

/** Side of the downsampled sampling grid (1024px texture → 320px grid). */
export const COSMOS_GRID = 320

/** The pack's textures are concept art. No printing is verified against them. */
export const COSMOS_TEXTURE_VERIFIED = false

export type CosmosGrid = {
  size: number
  /** 0..1 per texel: ink, weighted by the texture's own alpha. */
  mark: Float32Array
  /** 0..1 per texel: alpha alone, for the alpha debug view. */
  opacity: Float32Array
  peak: number
  coverage: number
}

/**
 * RGBA texels → sampling grid. Pure and browser-free, so the test suite runs the
 * same code the overlay does.
 */
export function buildCosmosGrid(
  w: number,
  h: number,
  rgba: Uint8ClampedArray | Uint8Array,
  grid = COSMOS_GRID,
): CosmosGrid {
  if (rgba.length !== w * h * 4) throw new Error(`expected ${w * h * 4} bytes, got ${rgba.length}`)
  const mark = new Float32Array(grid * grid)
  const opacity = new Float32Array(grid * grid)
  let peak = 0
  for (let ty = 0; ty < grid; ty++) {
    const y0 = Math.floor((ty * h) / grid)
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / grid))
    for (let tx = 0; tx < grid; tx++) {
      const x0 = Math.floor((tx * w) / grid)
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / grid))
      let sumMark = 0
      let sumAlpha = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4
          const a = rgba[i + 3] / 255
          const luma = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255
          sumMark += luma * a
          sumAlpha += a
          n++
        }
      }
      const idx = ty * grid + tx
      mark[idx] = n ? sumMark / n : 0
      opacity[idx] = n ? sumAlpha / n : 0
      if (mark[idx] > peak) peak = mark[idx]
    }
  }
  let covered = 0
  for (let i = 0; i < opacity.length; i++) if (opacity[i] > 0.1) covered++
  return { size: grid, mark, opacity, peak, coverage: covered / opacity.length }
}

/**
 * Which sheet a set's holos were printed on.
 *
 * Bulbapedia puts Cosmos on English holo rares from Base Set 2 (2000) to Call of
 * Legends (2011). Within that run collectors distinguish two papers: the coarse
 * "pixel" Cosmos of Base Set 2 → Platinum, and the smoother paper of the late
 * HGSS → Call of Legends sets. Both are represented by the pack's two retro
 * textures; which physical file a set used is an interpretation, so the index
 * says "interpretation" rather than asserting it.
 *
 * The modern smooth paper only appears on post-2013 promos, which holo.ts routes
 * to their own era patterns — it is kept here for the inspector's comparison.
 */
/**
 * The sheet a card was printed on, from the printing database.
 *
 * The database distinguishes the retro paper (2000–2011, pixel Cosmos) from the
 * HD paper that replaced it around 2013, because that split is documented. The
 * earlier two-way retro split this function used to make — dense for Base Set 2
 * to Platinum, sparse for HGSS to Call of Legends — was an assumption with no
 * source, and the sources put every set in that run on the same retro paper.
 */
export function cosmosPaperFor(cardId: string | null | undefined): CosmosVariantId {
  if (!cardId) return 'classic_dense'
  const printing = printingFor({ cardId })
  return printing?.paper ?? 'classic_dense'
}

export type CosmosCopy = {
  variant: CosmosVariantId
  /** Sheet orientation for the set this card belongs to. */
  rotated: boolean
  /** Texture-space origin of the card's window (0..1). */
  offsetU: number
  offsetV: number
  /** How far the window is zoomed into the sheet (1 = the whole width). */
  zoom: number
  seed: number
}

/**
 * The cut this copy came from. Deterministic in the card id, so a card looks the
 * same on every frame, and different from its neighbours.
 */
export type CosmosCopyOptions = {
  /** Force a paper (the inspector compares sheets on one card). */
  paper?: CosmosVariantId
  /**
   * Pin the cut for one physical copy without inventing a printing: swirl
   * placement varies between copies, and a save does not distinguish them.
   */
  copySeed?: string | number
}

export function cosmosCopyFor(cardId: string, opts: CosmosCopyOptions = {}): CosmosCopy {
  const setId = setIdOf(cardId) ?? ''
  const variant = opts.paper ?? cosmosPaperFor(cardId)
  const seed = hashKey(String(opts.copySeed ?? cardId) + ':cosmos')
  // A few per cent of zoom in or out of the sheet: two copies of the same card
  // should not share a scale, let alone a crop.
  const zoom = 0.96 + (((seed >>> 20) % 997) / 997) * 0.12
  const rotated = (hashKey(setId + ':cosmos-orientation') & 1) === 1
  const fU = ((seed >>> 3) % 10007) / 10007
  const fV = ((seed >>> 13) % 7919) / 7919
  const sx = CARD_ASPECT * zoom
  const sy = Math.min(1, zoom)
  return {
    variant,
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
 * The mark at a point of the card. `scale` > 1 zooms further into the sheet — the
 * debug panel's texture-scale slider — and never zooms out past the card window,
 * because that would wrap the (non-tiling) sheet.
 */
export function sampleCosmos(
  copy: CosmosCopy,
  grid: CosmosGrid,
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
export function cosmosFieldFor(cardId: string, grid: CosmosGrid, copy = cosmosCopyFor(cardId)): MarkField {
  const variant: CosmosVariant = COSMOS_VARIANTS[copy.variant]
  return {
    id: `cosmos:${copy.variant}:${cardId}`,
    label: `Cosmos · ${variant.label}`,
    mark: (u, v, scale = 1) => sampleCosmos(copy, grid, u, v, scale).mark,
    opacity: (u, v) => sampleCosmos(copy, grid, u, v, 1).opacity,
    coverage: grid.coverage,
    peak: grid.peak,
    verified: COSMOS_TEXTURE_VERIFIED,
    note: 'Cosmos sheet, concept texture (not a scan). Coverage is researched in cosmos-masks.ts.',
    meta: {
      variant: copy.variant,
      paper: variant.paper,
      rotated: copy.rotated,
      offsetU: Number(copy.offsetU.toFixed(4)),
      offsetV: Number(copy.offsetV.toFixed(4)),
      zoom: Number(copy.zoom.toFixed(3)),
      reproduction: 'concept texture',
    },
  }
}

// ---------------------------------------------------------------------------
// Browser loading
// ---------------------------------------------------------------------------

const grids = new Map<CosmosVariantId, CosmosGrid>()
const pending = new Map<CosmosVariantId, Promise<CosmosGrid | null>>()

/** Texture pixels, same-origin only. Held here so the Radiant path stays untouched. */
async function readCosmosTexels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
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

function loadGrid(id: CosmosVariantId): Promise<CosmosGrid | null> {
  const hit = grids.get(id)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(id)
  if (inflight) return inflight
  const task = (async () => {
    try {
      const { w, h, data } = await readCosmosTexels(COSMOS_VARIANTS[id].pattern)
      return buildCosmosGrid(w, h, data)
    } catch {
      return null
    } finally {
      pending.delete(id)
    }
  })()
  pending.set(id, task)
  task.then((g) => {
    if (g) grids.set(id, g)
  })
  return task
}

/**
 * The card's Cosmos field, or null when the texture cannot be read. Resolves
 * null rather than rejecting so the overlay can fall back to a plain reflection
 * instead of drawing a wrong pattern.
 */
export async function loadCosmosField(cardId: string): Promise<MarkField | null> {
  const copy = cosmosCopyFor(cardId)
  const grid = await loadGrid(copy.variant)
  return grid ? cosmosFieldFor(cardId, grid, copy) : null
}
