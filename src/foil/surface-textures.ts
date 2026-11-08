// Textured printings: which cards get an embossed surface, and how it loads.
//
// Two reliefs ship, split by the era the sources describe:
//
//   - `etched-deep` for Black & White and XY full arts, described as heavy with
//     deeply etched texture;
//   - `etched` for Sun & Moon, Sword & Shield and Scarlet & Violet tiers, where
//     the texture is lighter and finer.
//
// Both are MODELLED: no scan or photograph of a textured card exists in this repo,
// so the lattices are drawn from those descriptions. Scarlet & Violet textures are
// in reality art-specific; using one fine relief there is this build's disclosed
// simplification.
//
// A third family wears a relief without a paper: the Shiny Vault tiers (Hidden Fates,
// Shining Fates, Paldean Fates) are documented as "embossed", "etched" and "textured"
// foil, which is relief rather than a repeat. Their paper stays unnamed in shiny-db.ts
// and they borrow no sheet. Macro photographs then showed a granular shimmer with no
// periodic repeat (`reports/shiny-etch-photos.md`), so they wear their own `sparkle`
// surface rather than the diagonal lattice the numbered full arts use.

import type { FoilSurface } from './engine'
import { printingFor } from './printing-db'
import type { NormalMap } from './surface'
import { normalMapFromHeight } from './surface'
import { ETCHED_SIZE, etchedDeepHeight, etchedHeight, sparkleHeight } from './surface-map'

export type SurfaceTextureId = 'etched' | 'etched-deep' | 'sparkle'

export type SurfaceTexture = {
  id: SurfaceTextureId
  label: string
  /** Encoded normal map (R = x, G = y), served from /public. */
  texture: string
  /** Default relief depth, 0..1. */
  strength: number
  /** True only when a scan or photograph confirmed the relief. */
  verified: boolean
  /** This build's disclosed choice. */
  modelled: boolean
  note: string
  /** What the era description comes from. */
  source: string
}

const SOURCE_ETCHING =
  'https://bleedingcool.com/games/a-holographic-history-of-the-pokemon-tcg-full-art-trainers'

export const SURFACE_TEXTURES: Record<SurfaceTextureId, SurfaceTexture> = {
  etched: {
    id: 'etched',
    label: 'Etched relief',
    texture: '/foil/surface/etched.png',
    strength: 0.45,
    verified: false,
    modelled: true,
    note: 'A fine diagonal lattice of shallow grooves for the lighter modern papers. The depth, spacing and strength are modelled from the description of later full arts as finer and wavier, not measured from a card. The Shiny Vault finish moved off this lattice to its own granular `sparkle` surface after macro photographs showed no periodic repeat (`reports/shiny-etch-photos.md`).',
    source: SOURCE_ETCHING,
  },
  sparkle: {
    id: 'sparkle',
    label: 'Granular sparkle',
    texture: '/foil/surface/sparkle.png',
    strength: 0.34,
    verified: false,
    modelled: true,
    note: 'A fine isotropic grain for the Shiny Vault finish. Photographs of the English SV107 and its Shiny Star V print show a dense granular shimmer, and the measurement finds no periodic repeat even at a 2700 px card width, so the surface is drawn as three octaves of grain rather than a lattice. The grain scale and depth are modelled: a correlation-length test against the same photographs (`reports/shiny-grain.md`) finds no attributable density — rendered down to the flat scan width, the same still climbs from 0.36% to 0.97% of card width, so the figure tracks pixel size rather than the paper. Extrapolating that ladder to zero pixel size is not stable across sources, under a linear fit (0.162%, 0.085%, -0.290%, 0.532%) or under a squared one that cannot go negative (0.365%, 0.284%, 0.000%, 0.709%), so no true length is recorded. Restricting the measurement to the flattest 16%-of-card patches narrows the spread but leaves two negative intercepts, so no length is attributable. The drawn density is accepted as final in that report, not pending: four tests, two models and two patch selections all fail to converge, so the 48/96/192 periods are this build\'s decision rather than a measurement. What the photographs settle is that the finish is granular.',
    source: 'https://bulbapedia.bulbagarden.net/wiki/Hidden_Fates_(TCG)',
  },
  'etched-deep': {
    id: 'etched-deep',
    label: 'Deep etched relief',
    texture: '/foil/surface/etched-deep.png',
    strength: 0.62,
    verified: false,
    modelled: true,
    note: 'A coarser, deeper diagonal lattice for Black & White and XY full arts, described as heavy with deeply etched texture. Modelled from that description; no scan exists here to measure the real spacing.',
    source: SOURCE_ETCHING,
  },
}

export const TEXTURED_SURFACE_VERIFIED = false

/**
 * Rarities that carry an etched relief. Deliberately a named list rather than
 * "anything above Rare": the tiers below are printed smooth, and a wrong emboss
 * is worse than none.
 */
const ETCHED_RARITIES = /special illustration rare|illustration rare|ultra rare|rare ultra|hyper rare|rare secret|rare rainbow|full art|trainer gallery/i

/**
 * The Shiny Vault finish, selected by its own rarities.
 *
 * Bulbapedia: the Shiny Vault cards "have a special embossed Holofoil treatment"; Shining
 * Fates adds "beautiful etched cards"; Paldean Fates carries a "holographic, silver,
 * textured foil border". Those are relief words, and none of them names a paper —
 * `shiny-db.ts` keeps these rows on `special-treatment`, so no sheet is borrowed. The
 * relief is the whole claim here, drawn as the fine lattice because all three sets are
 * modern; their documented silver border is still not modelled.
 */
const SHINY_VAULT_RARITIES = /^(rare shiny|rare shiny gx|shiny rare|shiny ultra rare)$/i

/** Eras whose full arts the source calls heavy and deeply etched. */
const DEEP_ERA = /^(bw|xy|g1|dc)/

/**
 * The surface a card wears, or null when it is smooth.
 *
 * Two questions can answer. A tier the sources call textured answers by RARITY.
 * A paper the printing database identifies as `textured-full-art` answers by its
 * PRINTING, which is the only way a promo row (rarity `Promo`) reaches its relief:
 * the three BW textured promos are not ultra rares, and a rarity rule would leave
 * them flat. Both answers pick the era's relief, because that is the paper's
 * description and not the card's label.
 */
export function surfaceFor(input: {
  rarity?: string | null
  variant?: string | null
  cardId?: string | null
  /** The resolved printing's pattern, when the caller already has it. */
  pattern?: string | null
}): SurfaceTextureId | null {
  const variant = (input.variant ?? '').toLowerCase()
  // A reverse takes its etch from the explicit paper variant, never from this
  // route: the ball papers carry a full-card etch the reverse flag cannot imply.
  if (variant.includes('reverse')) return null
  const cut = (input.cardId ?? '').lastIndexOf('-')
  const setId = cut > 0 ? (input.cardId ?? '').slice(0, cut) : ''
  const pattern =
    input.pattern ??
    (input.cardId
      ? printingFor({ cardId: input.cardId, rarity: input.rarity ?? undefined })?.pattern ?? null
      : null)
  if (pattern === 'textured-full-art') return DEEP_ERA.test(setId) ? 'etched-deep' : 'etched'
  const rarity = input.rarity ?? ''
  // The Shiny Vault finish is embossed/etched by its own sources, so it earns a relief
  // without earning a paper. Any other shiny label still renders smooth: the list is
  // named, not a /shiny/ catch-all, because a wrong emboss is worse than none.
  if (SHINY_VAULT_RARITIES.test(rarity)) return 'sparkle'
  if (/shiny/i.test(rarity)) return null
  if (!ETCHED_RARITIES.test(rarity)) return null
  return DEEP_ERA.test(setId) ? 'etched-deep' : 'etched'
}

/** The normal map this build can build without a browser, for tests/reports. */
export function buildEtchedNormalMap(size = ETCHED_SIZE, id: SurfaceTextureId = 'etched'): NormalMap {
  const height = id === 'etched-deep' ? etchedDeepHeight : id === 'sparkle' ? sparkleHeight : etchedHeight
  const strength = id === 'etched-deep' ? 5.2 : id === 'sparkle' ? 2.2 : 3.2
  return normalMapFromHeight(size, size, height, strength)
}

const cache = new Map<SurfaceTextureId, Promise<FoilSurface | null>>()

function decodeNormal(blob: Blob): Promise<NormalMap> {
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      URL.revokeObjectURL(url)
      if (!ctx) return fail(new Error('no 2d context for the surface map'))
      ctx.drawImage(img, 0, 0)
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const n = canvas.width * canvas.height
      const data = new Uint8Array(n * 2)
      for (let i = 0; i < n; i++) {
        data[i * 2] = px[i * 4]
        data[i * 2 + 1] = px[i * 4 + 1]
      }
      ok({ w: canvas.width, h: canvas.height, data })
    }
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('surface map did not decode')) }
    img.src = url
  })
}

/** Load one surface once per page; a failure means smooth foil. */
export function loadSurface(id: SurfaceTextureId): Promise<FoilSurface | null> {
  const meta = SURFACE_TEXTURES[id]
  if (!meta) return Promise.resolve(null)
  const hit = cache.get(id)
  if (hit) return hit
  const task = (async () => {
    try {
      const res = await fetch(meta.texture, { credentials: 'same-origin' })
      if (!res.ok) return null
      const map = await decodeNormal(await res.blob())
      return { map, strength: meta.strength }
    } catch {
      cache.delete(id)
      return null
    }
  })()
  cache.set(id, task)
  return task
}

/** Catalogue cards the inspector opens to show each relief. */
export const SURFACE_SHOWCASE: {
  cardId: string; setId: string; number: string; name: string; rarity: string; group: string
}[] = [
  { cardId: 'sv1-199', setId: 'sv1', number: '199', name: 'Tarountula', rarity: 'Illustration Rare', group: 'Textured' },
  { cardId: 'bw1-113', setId: 'bw1', number: '113', name: 'Reshiram', rarity: 'Rare Ultra', group: 'Textured' },
]
