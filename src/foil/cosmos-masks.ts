// Cosmos coverage, read from the printing database.
//
// Coverage used to be researched in this file. It now lives with each printing
// in printing-db.ts, because "this card is Cosmos" and "the foil covers this
// area" have to travel together: an explicit promo entry can be verified for its
// identity and unmapped for its foil area, and two files would eventually
// disagree about that.
//
// This module stays as the Cosmos-only view the suite and the inspector read. It
// answers for Cosmos printings and returns null for everything else — including
// reverse printings, which now carry their set's reverse paper instead.

import type { FoilMaskKind } from './mask'
import { DELTA_SPECIES_EXCEPTION, printingFor, type PrintingInput } from './printing-db'
import { isCosmosPattern } from './patterns'

export type CosmosCoverageKind = Extract<FoilMaskKind, 'art' | 'outsideArt' | 'artBorder' | 'full'>

export type CosmosCoverage = {
  kind: CosmosCoverageKind
  /** True only where a source describes this printing's actual foil area. */
  verified: boolean
  evidence: string
}

const KIND: Record<string, CosmosCoverageKind> = {
  art: 'art',
  'art-border': 'artBorder',
  full: 'full',
  'outside-art': 'outsideArt',
  'full-art': 'art',
}

/**
 * Coverage for a Cosmos printing, or null when this card is not a Cosmos
 * printing. Whether a card is foil at all is still decided once, in holoFor().
 */
export function cosmosCoverage(input: PrintingInput): CosmosCoverage | null {
  const printing = printingFor(input)
  if (!printing || !isCosmosPattern(printing.pattern)) return null
  return {
    kind: KIND[printing.mask] ?? 'art',
    verified: printing.maskVerified,
    evidence: `${printing.note} (${printing.printingId}; ${printing.source})`,
  }
}

export { DELTA_SPECIES_EXCEPTION }
