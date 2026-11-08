// Modern special reverses: Poké Ball and Master Ball papers.
//
// The finish is an ordinary reverse holo — foil on the frame and text box, art
// matte — and only the stamps change. Sources describe two layouts:
//
//   - ONE LARGE ball behind the attack text (Prismatic Evolutions, Ascended
//     Heroes), and
//   - ROWS of balls (Black Bolt, White Flare).
//
// Real Prismatic Evolutions Poké Ball and Master Ball photographs and published
// Terastal Festival ex / Black Bolt / White Flare renders confirm the two layouts,
// the M on the Master Ball, the fine etch crossing artwork and body, and the
// alternating large/small rows. The Sylveon Poké Ball photo measures the large
// ball at about 0.52 card widths across, centred about 0.675 down the card, and
// the Terastal render agrees. The rows references show five columns of balls,
// alternating large and small in staggered rows; the large ring is about 56px and
// the small about 32px on a 335px-wide card, with about 67.5px column pitch and
// 69px row pitch. The sheet uses those measured sizes; the glyphs, facet spacing
// and exact registration remain procedural drawings. Every asset records
// `approximation: true`. The etched field is rendered separately by
// reverse-etch.ts as a full-card relief; this layer only owns the ball foil.
//
// Variants are explicit tokens ('reverseHolofoilPokeBall',
// 'reverseHolofoilMasterBall'); a normal 'reverseHolofoil' keeps the set's
// ordinary paper. The game now rolls these tokens in a special set's reverse
// slot and prices them from the card's reverse row (see
// server/services/special-reverse.ts); a card row on its own still never
// implies a ball.

import { hashKey } from '../holo'
import { buildCosmosGrid, type CosmosGrid } from './cosmos'
import type { FoilPatternId } from './patterns'
import {
  ASCENDED_ART_RECT,
  ASCENDED_SET_ID,
  BALL_STAMPS,
  STAMP_IDS,
  stampForVariant,
  type SpecialStampId,
} from './ball-stamps'
import type { MarkField } from './mark-field'
import {
  SPECIAL_REVERSE_ASSETS,
  SPECIAL_REVERSE_NOTE,
  SPECIAL_REVERSE_TEXTURE_VERIFIED,
  type SpecialReverseAsset,
} from './reverse-special-index'

export const SPECIAL_REVERSE_GRID = 320
export const CARD_ASPECT = 734 / 1024

export type SpecialBallId = SpecialStampId
export type SpecialLayout = 'large' | 'rows'

export type SpecialReverseSet = {
  setId: string
  setName: string
  year: number
  ball: SpecialBallId
  layout: SpecialLayout
  pattern: FoilPatternId
  mask: 'outside-art'
  status: 'verified'
  /** Published print-run count, where a set guide states one. */
  published?: number
  /** Coverage window, when the set's own scan differs from the shared one. */
  artRect?: { x: number; y: number; w: number; h: number }
  note: string
  source: string
}

const FOILFOX = 'https://foilfox.app/guides/pokemon-finishes'
const POKEBEACH_PRE = 'https://www.pokebeach.com/2025/01/prismatic-evolutions-set-guide-full-card-list-secret-rares-cut-cards-products-and-more'
const POKEBEACH_BW = 'https://www.pokebeach.com/2025/07/black-bolt-and-white-flare-english-set-guides-full-card-lists-pull-rates-cut-cards-products-and-more'

/**
 * Which set printed which ball, and in which layout. A set absent here makes no
 * claim: passes, theme decks and sets that only carry the ordinary reverse paper
 * are deliberately not listed.
 */
export const SPECIAL_REVERSE_SETS: SpecialReverseSet[] = [
  {
    setId: 'sv8pt5', setName: 'Prismatic Evolutions', year: 2025,
    ball: 'pokeball', layout: 'large', pattern: 'reverse-pokeball-large',
    mask: 'outside-art', status: 'verified', published: 100,
    note: 'One large Poké Ball behind the attack text. The Poké Ball version covers every main-set card except Pokémon ex and ACE SPEC.',
    source: POKEBEACH_PRE,
  },
  {
    setId: 'sv8pt5', setName: 'Prismatic Evolutions', year: 2025,
    ball: 'masterball', layout: 'large', pattern: 'reverse-masterball-large',
    mask: 'outside-art', status: 'verified', published: 67,
    note: 'One large Master Ball behind the attack text, with an M on the upper half. Only regular Pokémon in the main set received it.',
    source: POKEBEACH_PRE,
  },
  {
    setId: 'zsv10pt5', setName: 'Black Bolt', year: 2025,
    ball: 'pokeball', layout: 'rows', pattern: 'reverse-pokeball-rows',
    mask: 'outside-art', status: 'verified',
    note: 'Rows of Poké Balls across the frame and text box.',
    source: POKEBEACH_BW,
  },
  {
    setId: 'zsv10pt5', setName: 'Black Bolt', year: 2025,
    ball: 'masterball', layout: 'rows', pattern: 'reverse-masterball-rows',
    mask: 'outside-art', status: 'verified',
    note: 'Rows of Master Balls, each with an M on the upper half.',
    source: POKEBEACH_BW,
  },
  {
    setId: 'rsv10pt5', setName: 'White Flare', year: 2025,
    ball: 'pokeball', layout: 'rows', pattern: 'reverse-pokeball-rows',
    mask: 'outside-art', status: 'verified',
    note: 'Rows of Poké Balls across the frame and text box.',
    source: POKEBEACH_BW,
  },
  {
    setId: 'rsv10pt5', setName: 'White Flare', year: 2025,
    ball: 'masterball', layout: 'rows', pattern: 'reverse-masterball-rows',
    mask: 'outside-art', status: 'verified',
    note: 'Rows of Master Balls, each with an M on the upper half.',
    source: POKEBEACH_BW,
  },
]

/** The stamp named by a variant token, or null for an ordinary printing. */
export function specialBallFor(variant: string | null | undefined): SpecialBallId | null {
  const exact = stampForVariant(variant)
  if (exact) return exact
  const v = (variant ?? '').toLowerCase()
  if (/master\s*ball|masterball/.test(v)) return 'masterball'
  if (/poke\s*ball|pokeball/.test(v)) return 'pokeball'
  if (/love\s*ball|loveball/.test(v)) return 'loveball'
  if (/friend\s*ball|friendball/.test(v)) return 'friendball'
  if (/quick\s*ball|quickball/.test(v)) return 'quickball'
  if (/dusk\s*ball|duskball/.test(v)) return 'duskball'
  if (/team\s*rocket|teamrocket/.test(v)) return 'teamrocket'
  return null
}

/** The set's ball printing for this explicit variant, or null. */
export function specialReverseFor(
  setId: string | null | undefined,
  variant: string | null | undefined,
): SpecialReverseSet | null {
  const ball = specialBallFor(variant)
  if (!ball || !setId) return null
  return SPECIAL_REVERSE_SETS.find((s) => s.setId === setId && s.ball === ball) ?? null
}

export function specialPatternFor(
  setId: string | null | undefined,
  variant: string | null | undefined,
): FoilPatternId | null {
  return specialReverseFor(setId, variant)?.pattern ?? null
}

export function isSpecialReversePattern(id: FoilPatternId | null | undefined): boolean {
  return !!id && id.startsWith('reverse-') && !!SPECIAL_REVERSE_ASSETS[id as FoilPatternId]
}

const POKEBEACH_ASCENDED =
  'https://www.pokebeach.com/2026/01/ascended-heroes-set-guide-full-set-list-god-packs-reverse-holos-product-lineup-and-more'

/**
 * Ascended Heroes assigns one stamp per regular Pokémon, so the set contributes
 * one row per stamp rather than one ball. Master Ball is deliberately absent: the
 * set prints no such reverse, and a row for it would let a marketplace flag
 * invent a printing that does not exist. Which card carries which row is in
 * src/foil/ball-stamps.ts.
 */
const ASCENDED_STAMP_ROWS: SpecialReverseSet[] = STAMP_IDS
  .filter((stamp) => stamp !== 'masterball')
  .map((stamp) => ({
    setId: ASCENDED_SET_ID,
    setName: 'Ascended Heroes',
    year: 2026,
    ball: stamp,
    layout: 'large' as const,
    pattern: BALL_STAMPS[stamp].pattern,
    mask: 'outside-art' as const,
    status: 'verified' as const,
    artRect: ASCENDED_ART_RECT,
    note: stamp === 'teamrocket'
      ? 'One large Team Rocket mark — an R where the ball would sit — behind the attack text, on the body only. Team Rocket’s Pokémon never carry a ball paper.'
      : `One large ${BALL_STAMPS[stamp].label} behind the attack text, on the body only. The set’s first reverse slot is a separate Energy-pattern paper (reverse-energy-large); this row is the assigned stamp in its second slot.`,
    source: POKEBEACH_ASCENDED,
  }))

SPECIAL_REVERSE_SETS.push(...ASCENDED_STAMP_ROWS)

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

type LargeCopy = { sx: number; sy: number; offsetU: number; offsetV: number; seed: number }

/**
 * Anchor the large ball behind the attack text. The window is 0.95 of the sheet
 * (0.78 before the photo correction), which makes its 252/512-sheet-wide outer
 * ring about 0.52 of the card's width, and the target centre is 0.675 down the
 * card: the Sylveon photo and the Terastal render agree on both. The per-card
 * jitter is small, and the offsets are clamped so the ball is never pushed off
 * the card.
 */
export function largeBallCopyFor(cardId: string, asset: SpecialReverseAsset): LargeCopy {
  const seed = hashKey(cardId + ':special-reverse')
  const sx = 0.95
  const sy = 0.95
  const jitterU = ((((seed >>> 4) % 1000) / 1000) - 0.5) * 0.05
  const jitterV = ((((seed >>> 14) % 1000) / 1000) - 0.5) * 0.05
  const targetU = 0.5 + jitterU
  const targetV = 0.675 + jitterV
  return {
    sx, sy, seed,
    offsetU: Math.min(Math.max(0, asset.centerU - targetU * sx), 1 - sx),
    offsetV: Math.min(Math.max(0, asset.centerV - targetV * sy), 1 - sy),
  }
}

function rowsCopyFor(cardId: string): { offsetU: number; offsetV: number; seed: number } {
  const seed = hashKey(cardId + ':special-rows')
  return {
    seed,
    offsetU: ((seed >>> 3) % 10007) / 10007,
    offsetV: ((seed >>> 13) % 7919) / 7919,
  }
}

export type SpecialSample = { mark: number; opacity: number }

/** Sample a special reverse paper in card space. */
export function sampleSpecialReverse(
  cardId: string,
  asset: SpecialReverseAsset,
  grid: CosmosGrid,
  u: number,
  v: number,
): SpecialSample {
  if (asset.layout === 'large') {
    const copy = largeBallCopyFor(cardId, asset)
    const x = copy.offsetU + u * copy.sx
    const y = copy.offsetV + v * copy.sy
    return {
      mark: bilinearClamp(grid.mark, grid.size, x, y),
      opacity: bilinearClamp(grid.opacity, grid.size, x, y),
    }
  }
  const copy = rowsCopyFor(cardId)
  // A square sheet sampled at the same rate on both axes would draw tall ovals
  // on a 734x1024 card. The vertical span carries the card aspect so a ball in
  // the sheet stays a circle on the card.
  const sx = asset.scale
  const sy = asset.scale / CARD_ASPECT
  return {
    mark: bilinearWrap(grid.mark, grid.size, copy.offsetU + u * sx, copy.offsetV + v * sy),
    opacity: bilinearWrap(grid.opacity, grid.size, copy.offsetU + u * sx, copy.offsetV + v * sy),
  }
}

/** The MarkField for one special reverse printing. */
export function specialReverseFieldFor(
  cardId: string,
  asset: SpecialReverseAsset,
  grid: CosmosGrid,
): MarkField {
  const ball = BALL_STAMPS[asset.ball].label
  return {
    id: `special-reverse:${asset.ball}:${cardId}`,
    label: `Reverse · ${ball} (${asset.layout})`,
    mark: (u, v) => sampleSpecialReverse(cardId, asset, grid, u, v).mark,
    opacity: (u, v) => sampleSpecialReverse(cardId, asset, grid, u, v).opacity,
    coverage: grid.coverage,
    peak: grid.peak,
    verified: SPECIAL_REVERSE_TEXTURE_VERIFIED,
    note: SPECIAL_REVERSE_NOTE,
    meta: {
      ball: asset.ball,
      layout: asset.layout,
      reproduction: 'procedural reconstruction',
      reference: asset.evidence.kind,
      referenceUrl: asset.evidence.url,
      referenceNote: asset.evidence.limits,
      sheet: asset.texture,
      ...(asset.layout === 'rows'
        ? {
            scale: asset.scale,
            verticalScale: Number((asset.scale / CARD_ASPECT).toFixed(4)),
            columns: asset.rows?.columns ?? 0,
            rows: asset.rows?.rows ?? 0,
            largeBallWidth: asset.rows?.largeBallWidth ?? 0,
            smallBallWidth: asset.rows?.smallBallWidth ?? 0,
            columnPitchPx: asset.rows?.measured.columnPitchPx ?? 0,
            rowPitchPx: asset.rows?.measured.rowPitchPx ?? 0,
          }
        : { placement: 'behind the attack text' }),
    },
  }
}

// ---------------------------------------------------------------------------
// Browser loading
// ---------------------------------------------------------------------------

const grids = new Map<FoilPatternId, CosmosGrid>()
const pending = new Map<FoilPatternId, Promise<CosmosGrid | null>>()

async function readTexels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const img = new Image()
  await new Promise<void>((ok, fail) => {
    img.onload = () => ok()
    img.onerror = () => fail(new Error('special reverse texture did not decode'))
    img.src = objectUrl
  }).finally(() => URL.revokeObjectURL(objectUrl))
  const w = img.naturalWidth
  const h = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('no 2d context for the special reverse texture')
  ctx.drawImage(img, 0, 0)
  return { w, h, data: ctx.getImageData(0, 0, w, h).data }
}

function loadGrid(pattern: FoilPatternId): Promise<CosmosGrid | null> {
  const hit = grids.get(pattern)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(pattern)
  if (inflight) return inflight
  const asset = SPECIAL_REVERSE_ASSETS[pattern]
  if (!asset) return Promise.resolve(null)
  const task = (async () => {
    try {
      const { w, h, data } = await readTexels(asset.texture)
      return buildCosmosGrid(w, h, data, SPECIAL_REVERSE_GRID)
    } catch {
      return null
    } finally {
      pending.delete(pattern)
    }
  })()
  pending.set(pattern, task)
  task.then((g) => { if (g) grids.set(pattern, g) })
  return task
}

/** Load the paper named by a special pattern; null means plain foil. */
export async function loadSpecialReverseField(
  cardId: string,
  pattern: FoilPatternId,
): Promise<MarkField | null> {
  const asset = SPECIAL_REVERSE_ASSETS[pattern]
  if (!asset) return null
  const grid = await loadGrid(pattern)
  return grid ? specialReverseFieldFor(cardId, asset, grid) : null
}
