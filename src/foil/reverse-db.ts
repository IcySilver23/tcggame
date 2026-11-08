// Reverse holo: which expansions have one, what pattern, and where the foil sits.
//
// The reverse paper is a property of the SET, not of the card's rarity — which is
// why the earlier blanket "reverse = foil outside the art" rule was wrong for a
// whole run of EX sets. Bulbapedia's reverse-holo history is specific:
//
//   - Legendary Collection (2002) introduced reverse holos, with a fireworks
//     design over the card body.
//   - Expedition through EX Team Magma vs Team Aqua use a flat finish over the
//     card body, apart from the art.
//   - EX Hidden Legends through EX Unseen Forces move the pattern INTO the
//     picture window (energy symbols, pinwheel, Poké Balls), so foiling the body
//     would be wrong.
//   - EX Delta Species through EX Power Keepers keep it in the artwork background
//     (Dragon Frontiers puts it on the Pokémon itself).
//   - Diamond & Pearl through Black & White return to a plain finish on the body.
//   - Emerging Powers through Steam Siege put the type symbol in the background;
//     Sun & Moon enlarges it; Sword & Shield uses tiles; Scarlet & Violet uses
//     intricate tiles; Mega Evolution returns to a plain background.
//
// Eligibility is separate from pattern: reverse counterparts exist for the
// regular cards of a set but NOT for ultra rares, secret rares, LV.X, LEGEND,
// Prime, Gold Star, Pokémon-ex/V/GX and full arts. Expedition is the exception
// that proves it — its holo rares DID get reverse counterparts, while Aquapolis
// and Skyridge renumbered their holos (H1…) and skipped them, which is why an
// H-number is excluded here.
//
// https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

import type { FoilPatternId } from './patterns'

const BULBA = 'https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)'

export type ReverseMaskId = 'outside-art' | 'art'
export type ReverseStatus = 'verified' | 'approximated' | 'unresolved'

export type ReverseConfig = {
  setId: string
  /** Expansion (or series) name; the report joins the catalog's own name too. */
  name: string
  era: string
  year: number
  pattern: FoilPatternId
  mask: ReverseMaskId
  status: ReverseStatus
  maskNote: string
  note: string
  source: string
  /** Numbers that never received a reverse counterpart (H-numbers). */
  excludeNumbers?: RegExp
  /** Ultra/secret/special rarities in this range have no reverse counterpart. */
  excludeUltra: boolean
  settings: { intensity: number; iridescence: number; patternOpacity: number }
  /**
   * True when this expansion has been VALIDATED end to end: its pattern is
   * painted and a rendering test covers it. A painted pattern shared by an
   * unvalidated expansion does not make that expansion complete.
   */
  implemented: boolean
}

const EXCLUDE = /ultra|secret|rainbow|hyper|illustration|double rare|holo ex\b|holo gx|holo v\b|vmax|vstar|lv\.x|legend|prime|shining|lv x|star$|amazing|ace spec|classic collection|mega hyper|shiny|radiant|break/i

function cfg(
  setId: string,
  name: string,
  era: string,
  year: number,
  pattern: FoilPatternId,
  mask: ReverseMaskId,
  status: ReverseStatus,
  note: string,
  maskNote: string,
  extra: Partial<ReverseConfig> = {},
): ReverseConfig {
  return {
    setId,
    name,
    era,
    year,
    pattern,
    mask,
    status,
    note,
    maskNote,
    source: BULBA,
    excludeUltra: true,
    settings: { intensity: 0.95, iridescence: 0.85, patternOpacity: 1 },
    implemented: false,
    ...extra,
  }
}

const BODY = 'Foil covers the card body; the illustration window stays matte.'
const WINDOW = 'Foil sits inside the picture window; the card body stays matte.'

const EXPANSIONS: ReverseConfig[] = [
  cfg(
    'base6', 'Legendary Collection', 'Wizards', 2002, 'reverse-fireworks', 'outside-art', 'verified',
    'Introduced reverse holos: a fireworks design over the card body, and every card in the set received one.',
    BODY,
    { excludeUltra: false, implemented: true },
  ),
  cfg(
    'ecard1', 'Expedition Base Set', 'e-Card', 2002, 'reverse-flat', 'outside-art', 'verified',
    'Plain reverse foil over the card body, apart from the art. Holo rares also got reverse counterparts here.',
    BODY,
    { excludeUltra: false, implemented: true },
  ),
  cfg(
    'ecard2', 'Aquapolis', 'e-Card', 2003, 'reverse-flat', 'outside-art', 'verified',
    'Plain body finish. Holo cards were renumbered (H1…) and have no reverse printing, so H-numbers are excluded.',
    BODY,
    { excludeNumbers: /^H/i },
  ),
  cfg(
    'ecard3', 'Skyridge', 'e-Card', 2003, 'reverse-flat', 'outside-art', 'verified',
    'Plain body finish, same H-number exception as Aquapolis.',
    BODY,
    { excludeNumbers: /^H/i },
  ),
  ...['ex1', 'ex2', 'ex3', 'ex4'].map((id, i) =>
    cfg(id, ['EX Ruby & Sapphire', 'EX Sandstorm', 'EX Dragon', 'EX Team Magma vs Team Aqua'][i], 'EX', 2003 + (i > 1 ? 1 : 0),
      'reverse-flat', 'outside-art', 'verified',
      'Flat finish across the card body, apart from the art.', BODY),
  ),
  ...['ex5', 'ex6', 'ex7'].map((id, i) =>
    cfg(id, ['EX Hidden Legends', 'EX FireRed & LeafGreen', 'EX Team Rocket Returns'][i], 'EX', 2004,
      'reverse-energy-symbol', 'art', 'verified',
      'The reverse pattern moved into the picture window: energy symbols behind the Pokémon.',
      WINDOW + ' The faint foil symbol in the attack box is part of the print, not something this renderer may add.'),
  ),
  cfg('ex8', 'EX Deoxys', 'EX', 2005, 'reverse-pinwheel', 'art', 'verified',
    'Pinwheel pattern inside the artwork, with the set logo bottom-right.',
    WINDOW + ' The logo is printed, so the pattern must not duplicate it.',
    { implemented: true }),
  ...['ex9', 'ex10'].map((id, i) =>
    cfg(id, ['EX Emerald', 'EX Unseen Forces'][i], 'EX', 2005, 'reverse-pokeball', 'art', 'verified',
      'Poké Ball and star pattern inside the picture window.', WINDOW,
      { implemented: true }),
  ),
  ...['ex11', 'ex12', 'ex13', 'ex14', 'ex15', 'ex16'].map((id, i) =>
    cfg(id, ['EX Delta Species', 'EX Legend Maker', 'EX Holon Phantoms', 'EX Crystal Guardians', 'EX Dragon Frontiers', 'EX Power Keepers'][i],
      'EX', 2005 + Math.floor(i / 3), 'reverse-flat-background', 'art', 'approximated',
      'Plain reverse pattern inside the artwork background rather than the card body.',
      WINDOW + ' The Pokémon itself is excluded in print; this build cannot segment the subject, so the whole window is used and the mask is marked approximate.'),
  ),
  ...Array.from({ length: 7 }, (_, i) =>
    cfg(`dp${i + 1}`, `Diamond & Pearl ${i + 1}`, 'Diamond & Pearl', 2007, 'reverse-flat', 'outside-art', 'verified',
      'Diamond & Pearl returns to a plain reverse finish on the card body.', BODY,
      { implemented: true }),
  ),
  ...Array.from({ length: 4 }, (_, i) =>
    cfg(`pl${i + 1}`, `Platinum ${i + 1}`, 'Platinum', 2009, 'reverse-flat', 'outside-art', 'verified',
      'Plain reverse finish on the card body.', BODY, { implemented: true }),
  ),
  ...Array.from({ length: 4 }, (_, i) =>
    cfg(`hgss${i + 1}`, `HeartGold & SoulSilver ${i + 1}`, 'HGSS', 2010, 'reverse-flat', 'outside-art', 'verified',
      'Plain reverse finish on the card body. Prime cards are excluded: no reverse counterpart is documented here.',
      BODY, { implemented: true }),
  ),
  cfg('col1', 'Call of Legends', 'HGSS', 2011, 'reverse-flat', 'outside-art', 'verified',
    'Plain reverse finish on the card body.', BODY, { implemented: true }),
  cfg('bw1', 'Black & White', 'Black & White', 2011, 'reverse-flat', 'outside-art', 'verified',
    'Plain reverse finish; the type-symbol paper starts with Emerging Powers.',
    BODY, { implemented: true }),
  ...['bw2', 'bw3', 'bw4', 'bw5', 'bw6', 'bw7', 'bw8', 'bw9', 'bw10', 'bw11'].map((id) =>
    cfg(id, 'Black & White expansion', 'Black & White', 2012, 'reverse-type-symbol', 'outside-art', 'verified',
      'The card\'s type symbol (Poké Ball for Trainers) in the card body background.', BODY, { implemented: true }),
  ),
  ...[...Array.from({ length: 13 }, (_, i) => `xy${i}`), 'g1'].map((id) =>
    cfg(id, 'XY Series', 'XY', 2014, 'reverse-type-symbol', 'outside-art', 'verified',
      'Type symbol in the card body background.', BODY, { implemented: true }),
  ),
  ...Array.from({ length: 12 }, (_, i) =>
    cfg(`sm${i + 1}`, 'Sun & Moon expansion', 'Sun & Moon', 2017, 'reverse-type-symbol-large', 'outside-art', 'verified',
      'A large type symbol (Poké Ball for Trainers) on the left of the card body.', BODY, { implemented: true }),
  ),
  cfg('det1', 'Detective Pikachu', 'Sun & Moon', 2019, 'reverse-type-symbol-large', 'outside-art', 'verified',
    'Large type symbol in the card body background.', BODY, { implemented: true }),
  ...['swsh1', 'swsh2', 'swsh3', 'swsh4', 'swsh5', 'swsh6', 'swsh7', 'swsh8', 'swsh9', 'swsh10', 'swsh11', 'swsh12', 'swsh12pt5', 'pgo', 'fut20'].map((id) =>
    cfg(id, 'Sword & Shield expansion', 'Sword & Shield', 2021, 'reverse-tile', 'outside-art', 'verified',
      'Tile design with the type symbol or Poké Ball inside each tile, across the card body.', BODY, { implemented: true }),
  ),
  ...['sv1', 'sv2', 'sv3', 'sv3pt5', 'sv4', 'sv4pt5', 'sv5', 'sv6', 'sv6pt5', 'sv7', 'sv8', 'sv8pt5', 'sv9', 'sv10', 'rsv10pt5', 'zsv10pt5'].map((id) =>
    cfg(id, 'Scarlet & Violet expansion', 'Scarlet & Violet', 2024, 'reverse-tile-intricate', 'outside-art', 'verified',
      'Intricate tile design with type symbols of different sizes, across the card body.', BODY, { implemented: true }),
  ),
  ...['me1', 'me2', 'me2pt5', 'me3', 'me4', 'me5', 'me55'].map((id) =>
    cfg(id, 'Mega Evolution expansion', 'Mega Evolution', 2026, 'reverse-flat', 'outside-art', 'verified',
      'Mega Evolution returns to a plain reverse background on the card body.', BODY),
  ),
]

// Phase 5K/5L: the last families, validated one expansion at a time. The plain
// body, the energy symbols in the window and the plain background each have their
// own rendering proof in tmp/check-reverse-remaining.ts.
const REMAINING_VALIDATED = new Set<string>([
  'ecard2', 'ecard3', 'ex1', 'ex2', 'ex3', 'ex4',
  'ex5', 'ex6', 'ex7',
  'ex11', 'ex12', 'ex13', 'ex14', 'ex15', 'ex16',
  'me1', 'me2', 'me2pt5', 'me3', 'me4', 'me5', 'me55',
])

const VALIDATED = EXPANSIONS.map((e) => (REMAINING_VALIDATED.has(e.setId) ? { ...e, implemented: true } : e))

const BY_SET = new Map(VALIDATED.map((e) => [e.setId, e]))

export const REVERSE_EXPANSIONS: readonly ReverseConfig[] = VALIDATED

/** The expansion's reverse configuration, or null when it had no reverse holos. */
export function reverseConfigFor(setId: string | null | undefined): ReverseConfig | null {
  return setId ? BY_SET.get(setId) ?? null : null
}

/** Kept for the printing database's existing call site. */
export function reversePatternFor(setId: string): FoilPatternId | null {
  return reverseConfigFor(setId)?.pattern ?? null
}

/**
 * Does this physical card exist as a reverse holo?
 *
 * Base Set 2 and Team Rocket predate reverse holos (no config → false), and in
 * every configured set the ultra/secret tiers were skipped. Aquapolis and
 * Skyridge holos were renumbered with an H prefix and had no reverse printing.
 */
export function reverseEligible(input: { setId: string; number: string; rarity?: string | null }): boolean {
  const cfg = reverseConfigFor(input.setId)
  if (!cfg) return false
  if (cfg.excludeNumbers && cfg.excludeNumbers.test(input.number)) return false
  if (cfg.excludeUltra && EXCLUDE.test(input.rarity ?? '')) return false
  return true
}

/** Patterns this build can actually paint; the rest are recorded, not faked. */
export const REVERSE_IMPLEMENTED: FoilPatternId[] = [...new Set(VALIDATED.filter((e) => e.implemented).map((e) => e.pattern))]

/** Reflection settings a reverse printing asks for (merged over the defaults). */
export function reverseSettingsFor(setId: string | null | undefined): Partial<{
  intensity: number
  iridescence: number
  patternOpacity: number
}> | null {
  const cfg = reverseConfigFor(setId)
  return cfg ? cfg.settings : null
}

/** The expansions still waiting for their texture, grouped by pattern. */
export function reversePending(): { pattern: FoilPatternId; sets: string[] }[] {
  const out = new Map<FoilPatternId, string[]>()
  for (const e of VALIDATED) {
    if (e.implemented) continue
    out.set(e.pattern, [...(out.get(e.pattern) ?? []), e.setId])
  }
  return [...out.entries()].map(([pattern, sets]) => ({ pattern, sets })).sort((a, b) => b.sets.length - a.sets.length)
}
