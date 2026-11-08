// EX Delta Species – EX Power Keepers: a PLAIN reverse foil confined to the
// artwork background.
//
// There are no printed marks to reproduce, so the field is uniform light and the
// mask alone decides where it lands. The source also excludes the Pokémon itself
// from the foil, which this build cannot segment, so the mask stays approximated
// and the field says so.

import type { MarkField } from './mark-field'

export const REVERSE_FLAT_BACKGROUND_NOTE =
  'Plain reverse foil inside the artwork background; the printed pattern also excludes the Pokémon, which this build cannot segment, so the area is approximated.'

export function flatBackgroundFieldFor(cardId: string): MarkField {
  return {
    id: `reverseflatbackground:${cardId}`,
    label: 'Reverse · Flat background',
    mark: () => 1,
    opacity: () => 1,
    coverage: 1,
    peak: 1,
    verified: false,
    note: REVERSE_FLAT_BACKGROUND_NOTE,
    plain: true,
    meta: {
      pattern: 'reverse-flat-background',
      plain: true,
      approximation: true,
      reproduction: 'plain foil, area approximated',
    },
  }
}
