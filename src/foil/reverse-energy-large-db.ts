// Ascended Heroes' Energy-pattern reverse: the paper, as data.
//
// The set prints two reverse versions of each regular Pokémon: the Energy-pattern
// reverse (this paper) in the first reverse slot, and the assigned Poké Ball
// reverse in the second. Trainers and Energy cards received only the ordinary
// reverse paper, so the Energy stamp is never applied to them.
//
// This module holds only the printing identity, so the resolver, the printing
// database and the game can share it without importing the renderer or holo.ts.

import type { FoilPatternId } from './patterns'

export const ENERGY_REVERSE_VARIANT = 'reverseHolofoilEnergy'

export type EnergyReversePrinting = {
  setId: string
  setName: string
  year: number
  pattern: FoilPatternId
  mask: 'outside-art'
  /** Measured on the Ascended Heroes scan: the modern art window ends higher. */
  artRect: { x: number; y: number; w: number; h: number }
  status: 'verified'
  /** Explicit variant token; a plain reverse keeps the set's ordinary paper. */
  variant: typeof ENERGY_REVERSE_VARIANT
  note: string
  source: string
}

const POKEBEACH_ASCENDED =
  'https://www.pokebeach.com/2026/01/ascended-heroes-set-guide-full-set-list-god-packs-reverse-holos-product-lineup-and-more'

/**
 * One printing is documented here. The source describes the Energy-pattern
 * reverse on regular Pokémon, with one large Energy symbol behind the attack
 * text on the card body; the artwork stays matte. The stamp's artwork is a
 * reconstruction (see reverse-energy-large-sheet.ts), but the paper and its
 * area are identified.
 */
export const ENERGY_REVERSE_PRINTINGS: readonly EnergyReversePrinting[] = [
  {
    setId: 'me2pt5',
    setName: 'Ascended Heroes',
    year: 2026,
    pattern: 'reverse-energy-large',
    mask: 'outside-art',
    artRect: { x: 0.083, y: 0.094, w: 0.838, h: 0.375 },
    status: 'verified',
    variant: ENERGY_REVERSE_VARIANT,
    note: 'A large Energy symbol for the card’s own type behind the attack text, with foil on the card body and the illustration window matte.',
    source: POKEBEACH_ASCENDED,
  },
]

/** The Energy-pattern printing for an explicit variant, or null. */
export function energyReverseFor(
  setId: string | null | undefined,
  variant: string | null | undefined,
): EnergyReversePrinting | null {
  if (!setId) return null
  if ((variant ?? '').toLowerCase() !== ENERGY_REVERSE_VARIANT.toLowerCase()) return null
  return ENERGY_REVERSE_PRINTINGS.find((p) => p.setId === setId) ?? null
}

/** True only for the explicit Energy-pattern variant token. */
export function isEnergyReverseVariant(variant: string | null | undefined): boolean {
  return (variant ?? '').toLowerCase() === ENERGY_REVERSE_VARIANT.toLowerCase()
}

/** Sets in this table, for the game-side mirror and its suite. */
export const ENERGY_REVERSE_SET_IDS: readonly string[] = ENERGY_REVERSE_PRINTINGS.map((p) => p.setId)
