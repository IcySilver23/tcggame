// The renderer's pattern interface.
//
// Layer 3 (pattern texture) is whatever the printing carries: a Radiant card's
// own motif, the Cosmos sheet, or the generic tile. stages.ts only needs three
// things from it — ink, opacity, and enough metadata to be honest about what it
// is — so the pack-specific loaders live behind this one type instead of the
// renderer growing a branch per subset.
//
// `verified` means "a source confirms this texture is the printing's foil".
// It is false for every Cosmos texture (the pack is concept art) even though the
// coverage rules are verified; those are separate claims and stay separate.

import { holoFor, setIdOf } from '../holo'
import { loadPatternMap, samplePattern, type PatternMap } from './radiant'
import { radiantAssetFor } from './radiant'
import { loadCosmosField } from './cosmos'
import { isCosmosPattern } from './patterns'
import { loadReverseField } from './reverse'
import { isSpecialReversePattern, loadSpecialReverseField } from './reverse-special'
import { loadStarlightField } from './starlight'
import { loadTinselField } from './tinsel'
import { loadMirrorField } from './mirror'
import { loadCrosshatchField } from './crosshatch'
import { loadConfettiField } from './confetti'
import { loadSequinField } from './sequin'
import { loadLineField } from './line'
import { loadWaterwebField } from './waterweb'
import { loadMirageField } from './mirage'
import { loadRadiantEtchedField } from './radiant-etched'
import { loadCrackedIceField } from './crackedice'
import { loadTypeSymbolField } from './type-symbol'
import { loadLargeTypeSymbolField } from './type-symbol-large'
import { loadReverseTileField } from './reverse-tile'
import { loadReverseTileIntricateField } from './reverse-tile-intricate'
import { loadReverseEnergyField } from './reverse-energy'
import { loadEnergyReverseField } from './reverse-energy-large'
import { flatBackgroundFieldFor } from './reverse-flat-background'

export type MarkField = {
  /** Stable identity, for caching and the inspector. */
  id: string
  label: string
  /** Ink at a card point, 0 (bare foil) .. 1 (mark body). */
  mark(u: number, v: number, scale?: number): number
  /** Opacity at a card point, for the alpha view. */
  opacity(u: number, v: number): number
  /** Fraction of the field carrying a mark. */
  coverage: number
  /** Peak ink, so a blank texture cannot pass silently. */
  peak: number
  /** True only when the texture is verified against the printing. */
  verified: boolean
  /** Uniform foil with no printed marks (plain reverse finishes). */
  plain?: boolean
  note: string
  /** Inspector readout: variant, paper, cut position, reproduction. */
  meta: Record<string, string | number | boolean>
}

/** A Radiant card's motif, presented as a field. */
export function fieldFromPatternMap(map: PatternMap): MarkField {
  return {
    id: `radiant:${map.cardId}`,
    label: `Radiant · ${map.asset.motif}`,
    mark: (u, v, scale = 1) => samplePattern(map, u, v, scale).mark,
    opacity: (u, v) => samplePattern(map, u, v, 1).opacity,
    coverage: map.coverage,
    peak: map.peak,
    verified: false,
    note: 'Reconstructed concept motif from the Radiant Collection pack, reduced to luminance x opacity.',
    meta: { motif: map.asset.motif, setId: map.asset.setId, reproduction: 'concept motif' },
  }
}

/**
 * The field for a card, or null when it should use the generic tile.
 *
 * Order matters only in that a card is at most one of these: Radiant Collection
 * printings own a motif per card, Cosmos printings share the sheet, and everything
 * else has no shipped texture: it renders plain foil (stages.ts), a state the
 * inspector names rather than dresses up as a pattern.
 */
export async function loadMarkFieldFor(input: {
  cardId?: string | null
  rarity?: string | null
  variant?: string | null
  /** Card type(s), when the caller already has them; otherwise the loader asks. */
  types?: string | string[] | null
  supertype?: string | null
}): Promise<MarkField | null> {
  const cardId = input.cardId ?? null
  if (cardId && radiantAssetFor(cardId)) {
    const map = await loadPatternMap(cardId)
    return map ? fieldFromPatternMap(map) : null
  }
  // Only a Cosmos PRINTING loads the sheet. A reverse printing of a Cosmos-era
  // card carries its set's reverse paper, so it must not borrow this texture.
  const art = holoFor(input)
  // The BW/XY reverse paper repeats the CARD'S OWN type symbol, so it needs the
  // type, not just the set. Unknown type → null → plain foil, never a wrong glyph.
  if (cardId && art?.reverse && art.pattern === 'reverse-type-symbol') {
    return loadTypeSymbolField(cardId, { types: input.types, supertype: input.supertype })
  }
  // Sun & Moon: one large symbol at the left of the body.
  if (cardId && art?.reverse && art.pattern === 'reverse-type-symbol-large') {
    return loadLargeTypeSymbolField(cardId, { types: input.types, supertype: input.supertype })
  }
  // Sword & Shield: rounded tiles, each carrying the card's own symbol.
  if (cardId && art?.reverse && art.pattern === 'reverse-tile') {
    return loadReverseTileField(cardId, { types: input.types, supertype: input.supertype })
  }
  // Scarlet & Violet: nested tiles with the symbol at different sizes.
  if (cardId && art?.reverse && art.pattern === 'reverse-tile-intricate') {
    return loadReverseTileIntricateField(cardId, { types: input.types, supertype: input.supertype })
  }
  // EX Hidden Legends – Team Rocket Returns: energy symbols behind the Pokémon.
  if (cardId && art?.reverse && art.pattern === 'reverse-energy-symbol') {
    return loadReverseEnergyField(cardId, { types: input.types, supertype: input.supertype })
  }
  // Ascended Heroes: one large Energy symbol for the card's own type, behind the
  // attack text. Trainers, Energy and unknown types stay plain.
  if (cardId && art?.reverse && art.pattern === 'reverse-energy-large') {
    return loadEnergyReverseField(cardId, { types: input.types, supertype: input.supertype })
  }
  // EX Delta Species – Power Keepers: plain foil in the artwork background.
  if (cardId && art?.reverse && art.pattern === 'reverse-flat-background') {
    return flatBackgroundFieldFor(cardId)
  }
  // Poké Ball / Master Ball reverses are their own paper, chosen by variant.
  if (cardId && art?.reverse && art.pattern && isSpecialReversePattern(art.pattern)) {
    return loadSpecialReverseField(cardId, art.pattern)
  }
  // A reverse printing carries its own reverse paper, with its own mask and
  // texture — the Cosmos sheet must never stand in for it.
  if (cardId && art?.reverse) {
    return loadReverseField(cardId, { setId: setIdOf(cardId), rarity: input.rarity, variant: input.variant })
  }
  // Starlight printings sample the procedural starfield sheet. The printing
  // identification is verified; the texture is not, and the field says so.
  if (cardId && art?.pattern === 'starlight') return loadStarlightField(cardId)
  // Tinsel is the Generation V paper: horizontal stripes across the image. One
  // sheet for every set it covers; the cut is a phase, not a per-card motif.
  if (cardId && art?.pattern === 'tinsel') return loadTinselField(cardId)
  // Mirror / Sheen prints no marks: uniform foil modulated along one diagonal.
  if (cardId && art?.pattern === 'mirror') return loadMirrorField(cardId)
  // Crosshatch is a diamond lattice on the card body.
  if (cardId && art?.pattern === 'crosshatch') return loadCrosshatchField(cardId)
  // Pixel / Confetti: blocky flakes across the image. Two routes reach it — the
  // printing database names it for the Classic Collections (pattern), while the
  // McDonald's sets are resolved by the style rule, so both are accepted here and
  // a wrong paper can never be borrowed by either.
  if (cardId && (art?.pattern === 'confetti' || art?.style === 'confetti')) return loadConfettiField(cardId)
  // Sequin: the General Mills promo paper. It has no era style — no set's standard holo
  // was printed on it — so only a printing record names it; printing-db.ts resolves the
  // 19 cards Bulbapedia's per-series Sequin tables list.
  if (cardId && art?.pattern === 'sequin') return loadSequinField(cardId)
  // Radiant Pokémon (2022): the etched silver lattice across the whole card. Its own
  // sheet and its own lookup; the Radiant Collection motifs above are a different paper.
  if (cardId && art?.pattern === 'radiant-etched') return loadRadiantEtchedField(cardId)
  // Cracked Ice is a tiling fracture: one named printing, one sheet.
  if (cardId && art?.pattern === 'crackedice') return loadCrackedIceField(cardId)
  // Line is the Sword & Shield era paper: thin vertical ridges. It has no printing
  // record, so it arrives as the era STYLE; the pattern check keeps the door open for
  // the day one is added. A reverse card never reaches here — its own paper answered above.
  if (cardId && (art?.pattern === 'line' || art?.style === 'line')) return loadLineField(cardId)
  // Water Web is the Sun & Moon era paper: wavy bands. Era style only, for the same
  // reason as Line — no printing record claims a Water Web card yet.
  if (cardId && (art?.pattern === 'waterweb' || art?.style === 'waterweb')) return loadWaterwebField(cardId)
  // Mirage is the Scarlet & Violet era paper: a smooth horizontal sheen. Era style only,
  // for the same reason as Line and Water Web — no printing record claims one yet.
  if (cardId && (art?.pattern === 'mirage' || art?.style === 'mirage')) return loadMirageField(cardId)
  if (cardId && art && isCosmosPattern(art.pattern)) return loadCosmosField(cardId)
  return null
}
