// Modern stamped reverses, game side.
//
// The renderer's registry is src/foil/reverse-special.ts, and the per-card
// assignment Ascended Heroes needs lives in src/foil/ball-stamps.ts. This module
// is the copy the game needs at pull time: which set stamps which paper, at what
// per-pack rate, and which cards can carry it. tmp/check-special-pulls.ts and
// tmp/check-ascended-balls.ts compare it with the renderer so they cannot drift.
//
// Two kinds of set exist, and the difference matters:
//
//   - a FIXED-stamp set prints one ball paper (plus a rarer Master Ball upgrade),
//     so the slot rolls the paper and then draws a card that can carry it;
//   - Ascended Heroes assigns one stamp to each regular Pokémon from six papers —
//     Poké Ball, Love Ball, Friend Ball, Quick Ball, Dusk Ball and Team Rocket's
//     R — so the slot cannot roll a ball at all. It draws a card and stamps that
//     card's own paper. Rolling "Poké Ball" there would be a fiction.
//
// Odds are per pack, from published opening studies where one exists:
//
//   - Prismatic Evolutions: TCGplayer's 1,200-pack study measured Poké Ball at
//     33.10% ± 2.60% and Master Ball at 1 in 20.
//   - Black Bolt / White Flare: TCGplayer's 700+ pack study measured Poké Ball
//     at 30.56% ± 3.36% and Master Ball at 5.14% ± 1.61% (1 in 19).
//   - Ascended Heroes: TCGplayer's 2,000+ pack study measured the second
//     reverse slot's Illustration Rare (11.25% ± 1.33%) and Special Illustration
//     Rare (1.44% ± 0.50%) rates. An assigned stamp fills that slot otherwise, so
//     its pack-level rate is 87.31% (derived, not directly counted).
//
// Prismatic Evolutions is modelled with its real two reverse slots: Poké Ball
// rolls in the first, Master Ball in the second, so one pack can hold both.
// Black Bolt and White Flare have one reverse slot, so their packs hold at most
// one ball. Ascended Heroes has two: the Energy-pattern paper first and the
// card's assigned stamp second (or an IR/SIR in that slot).

import {
  ASCENDED_PUBLISHED_COUNTS,
  BALL_STAMPS,
  STAMP_IDS,
  ascendedVariantFor,
  type SpecialStampId,
} from '../../src/foil/ball-stamps'

export type BallId = 'pokeball' | 'masterball'
export type BallOddsBasis = 'measured' | 'derived' | 'modelled'
export type BallSlot = 'first' | 'second'

export type BallPrinting = {
  setId: string
  setName: string
  ball: BallId
  pattern: string
  /** Which reverse slot carries this stamp. */
  slot: BallSlot
  /** Reverse slots the game models for this set. */
  reverseSlots: 1 | 2
  /** Per-pack chance that this ball appears in its slot. */
  packOdds: number
  /** Measured upgrades that replace this ball in its slot, after the ball roll. */
  upgrades?: { rarity: string; odds: number }[]
  oddsBasis: BallOddsBasis
  source: string
  note: string
}

const TCG_PRISMATIC =
  'https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Prismatic-Evolutions-Pull-Rates/d94889ea-f76a-4a13-b74d-5b0b071220a7/'
const TCG_BLACK_WHITE =
  'https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Black-Bolt-and-White-Flare-Pull-Rates/bac92199-a2a7-4668-b4a4-2647a111776f'
const TCG_ASCENDED =
  'https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Ascended-Heroes-Pull-Rates/60143d94-88a7-42ce-8e73-babd7b3fabd6/'

export const BALL_PRINTINGS: BallPrinting[] = [
  {
    setId: 'sv8pt5', setName: 'Prismatic Evolutions', ball: 'pokeball',
    pattern: 'reverse-pokeball-large', slot: 'first', reverseSlots: 2,
    packOdds: 0.331, oddsBasis: 'measured',
    source: TCG_PRISMATIC,
    note: '33.10% ± 2.60% of packs, in the first reverse slot.',
  },
  {
    setId: 'sv8pt5', setName: 'Prismatic Evolutions', ball: 'masterball',
    pattern: 'reverse-masterball-large', slot: 'second', reverseSlots: 2,
    packOdds: 0.05, oddsBasis: 'measured',
    source: TCG_PRISMATIC,
    note: '1 in 20 packs, in the second reverse slot.',
  },
  {
    setId: 'zsv10pt5', setName: 'Black Bolt', ball: 'pokeball',
    pattern: 'reverse-pokeball-rows', slot: 'first', reverseSlots: 1,
    packOdds: 0.3056, oddsBasis: 'measured',
    source: TCG_BLACK_WHITE,
    note: '30.56% ± 3.36% of packs.',
  },
  {
    setId: 'zsv10pt5', setName: 'Black Bolt', ball: 'masterball',
    pattern: 'reverse-masterball-rows', slot: 'first', reverseSlots: 1,
    packOdds: 0.0514, oddsBasis: 'measured',
    source: TCG_BLACK_WHITE,
    note: '5.14% ± 1.61% of packs (1 in 19); an earlier preliminary figure said 1 in 15.',
  },
  {
    setId: 'rsv10pt5', setName: 'White Flare', ball: 'pokeball',
    pattern: 'reverse-pokeball-rows', slot: 'first', reverseSlots: 1,
    packOdds: 0.3056, oddsBasis: 'measured',
    source: TCG_BLACK_WHITE,
    note: '30.56% ± 3.36% of packs.',
  },
  {
    setId: 'rsv10pt5', setName: 'White Flare', ball: 'masterball',
    pattern: 'reverse-masterball-rows', slot: 'first', reverseSlots: 1,
    packOdds: 0.0514, oddsBasis: 'measured',
    source: TCG_BLACK_WHITE,
    note: '5.14% ± 1.61% of packs (1 in 19); an earlier preliminary figure said 1 in 15.',
  },
]

/**
 * A set that stamps each card with its own paper instead of rolling one ball.
 * The six stamps are the whole vocabulary the set prints; `printed` is the
 * published card count per paper, and the assignment reproduces it exactly.
 */
export type AssignedStampPrinting = {
  setId: string
  setName: string
  slot: BallSlot
  reverseSlots: 2
  /** Per-pack chance that the slot carries the card's assigned stamp. */
  packOdds: number
  /** Measured outcomes that take the slot instead of the stamp. */
  upgrades: { rarity: string; odds: number }[]
  oddsBasis: 'derived'
  stamps: {
    stamp: SpecialStampId
    label: string
    pattern: string
    variant: string
    printed: number
  }[]
  source: string
  note: string
}

export const ASSIGNED_STAMP_PRINTINGS: AssignedStampPrinting[] = [
  {
    setId: 'me2pt5', setName: 'Ascended Heroes', slot: 'second', reverseSlots: 2,
    packOdds: 0.8731, oddsBasis: 'derived',
    upgrades: [
      { rarity: 'Illustration Rare', odds: 0.1125 },
      { rarity: 'Special Illustration Rare', odds: 0.0144 },
    ],
    // Master Ball is absent on purpose: the set printed no such reverse, so a
    // marketplace flag must not be able to invent one here.
    stamps: STAMP_IDS.filter((s) => s !== 'masterball').map((stamp) => ({
      stamp,
      label: BALL_STAMPS[stamp].label,
      pattern: BALL_STAMPS[stamp].pattern,
      variant: BALL_STAMPS[stamp].variant,
      printed: ASCENDED_PUBLISHED_COUNTS[stamp],
    })),
    source: TCG_ASCENDED,
    note: '87.31% of packs, derived from the measured second reverse slot: 11.25% ± 1.33% Illustration Rare and 1.44% ± 0.50% Special Illustration Rare replace the stamp. The slot carries the drawn card’s own assigned paper — Poké Ball, Love Ball, Friend Ball, Quick Ball, Dusk Ball, or Team Rocket’s R for Team Rocket’s Pokémon — not a rolled ball. The first reverse slot is the Energy-pattern paper for a regular Pokémon; Trainers and Energy cards keep plain reverses.',
  },
]

export const BALL_VARIANTS = {
  pokeball: BALL_STAMPS.pokeball.variant,
  masterball: BALL_STAMPS.masterball.variant,
} as const

/** Ascended Heroes' first reverse slot: one large symbol for the card's type. */
export const ENERGY_REVERSE_VARIANT = 'reverseHolofoilEnergy'

/** Sets whose first reverse slot carries the Energy-pattern paper. */
export const ENERGY_REVERSE_SET_IDS: readonly string[] = ['me2pt5']

export function hasEnergyReverse(setId: string | null | undefined): boolean {
  return !!setId && ENERGY_REVERSE_SET_IDS.includes(setId)
}

export function isEnergyReverseVariant(variant: string | null | undefined): boolean {
  return (variant ?? '').toLowerCase() === ENERGY_REVERSE_VARIANT.toLowerCase()
}

/**
 * Price premium over the same card's ordinary reverse. Common-card comps run
 * roughly 1.5x for Poké Ball and 5–15x for Master Ball; a flat multiplier is a
 * labelled model that understates popular Pokémon and overstates bulk.
 *
 * The four other ball papers and the Team Rocket mark have no measured comps in
 * this repo, so they use the same 1.5x ball-reverse premium: they are the same
 * class of card (one assigned stamp, no chase multiplier), and inventing a
 * different multiplier per ball would be a number with no source behind it.
 */
export const BALL_VALUE_MULT: Record<SpecialStampId, number> = {
  pokeball: 1.5,
  masterball: 8,
  loveball: 1.5,
  friendball: 1.5,
  quickball: 1.5,
  duskball: 1.5,
  teamrocket: 1.5,
}

/** The stamp named by a variant token, or null for an ordinary printing. */
export function specialBallFor(variant: string | null | undefined): SpecialStampId | null {
  const v = (variant ?? '').toLowerCase()
  if (!v) return null
  for (const stamp of STAMP_IDS) {
    if (v === BALL_STAMPS[stamp].variant.toLowerCase()) return stamp
  }
  if (/master\s*ball|masterball/.test(v)) return 'masterball'
  if (/poke\s*ball|pokeball/.test(v)) return 'pokeball'
  if (/love\s*ball|loveball/.test(v)) return 'loveball'
  if (/friend\s*ball|friendball/.test(v)) return 'friendball'
  if (/quick\s*ball|quickball/.test(v)) return 'quickball'
  if (/dusk\s*ball|duskball/.test(v)) return 'duskball'
  if (/team\s*rocket|teamrocket/.test(v)) return 'teamrocket'
  return null
}

/** The set that assigns a stamp per card, or null. */
export function assignedStampPrintingFor(
  setId: string | null | undefined,
): AssignedStampPrinting | null {
  if (!setId) return null
  return ASSIGNED_STAMP_PRINTINGS.find((p) => p.setId === setId) ?? null
}

export function isSpecialSet(setId: string | null | undefined): boolean {
  if (!setId) return false
  return BALL_PRINTINGS.some((p) => p.setId === setId) || !!assignedStampPrintingFor(setId)
}

export function ballPrintingFor(setId: string, ball: BallId): BallPrinting | null {
  return BALL_PRINTINGS.find((p) => p.setId === setId && p.ball === ball) ?? null
}

/** Player-facing label for a stamp token, or null for any other variant. */
export function ballLabelFor(variant: string | null | undefined): string | null {
  const ball = specialBallFor(variant)
  return ball ? BALL_STAMPS[ball].label : null
}

function hasSubtype(subtypes: string | null | undefined, name: string): boolean {
  try {
    const list = JSON.parse(subtypes ?? '[]') as string[]
    return Array.isArray(list) && list.includes(name)
  } catch {
    return false
  }
}

/**
 * The report's researched rule, applied to one card: the Energy-pattern paper
 * covers regular Pokémon only. Trainers and Energy cards got plain reverses, and
 * Pokémon ex / ACE SPEC are excluded by name.
 */
export function energyReverseEligible(card: {
  supertype?: string | null
  subtypes?: string | null
}): boolean {
  if ((card.supertype ?? '') !== 'Pokémon') return false
  if (hasSubtype(card.subtypes, 'ex') || hasSubtype(card.subtypes, 'ACE SPEC')) return false
  return true
}

/**
 * Which cards can carry a stamp.
 *
 * For a fixed-stamp set the researched rule applies: the Poké Ball paper covers
 * main-set cards except Pokémon ex, ACE SPEC and Energy; Master Ball only regular
 * Pokémon. For Ascended Heroes the card is the authority — it carries the paper
 * its checklist row names, and no other — so a ball token is only legal on a card
 * the assignment gives it to. Team Rocket's R is not a ball and is only ever on
 * Team Rocket's Pokémon.
 */
export function ballEligible(
  ball: SpecialStampId,
  card: { supertype?: string | null; subtypes?: string | null },
  cardId?: string | null,
): boolean {
  const supertype = card.supertype ?? ''
  if (supertype === 'Energy') return false
  if (hasSubtype(card.subtypes, 'ex') || hasSubtype(card.subtypes, 'ACE SPEC')) return false
  if (ball === 'masterball') return supertype === 'Pokémon'
  if (ball === 'pokeball') {
    // An Ascended Heroes card only carries its own paper, so a Poké Ball token
    // is legal there only when that card was assigned one.
    const assignedSet = assignedStampPrintingFor(cardId ? cardId.split('-').slice(0, -1).join('-') : null)
    if (assignedSet) return !!cardId && ascendedVariantFor(cardId) === BALL_STAMPS.pokeball.variant
    return true
  }
  // Love, Friend, Quick, Dusk and the Team Rocket R: assigned papers only.
  return !!cardId && ascendedVariantFor(cardId) === BALL_STAMPS[ball].variant
}

export type SpecialSlotOutcome =
  | { kind: 'ball'; ball: BallId; variant: string }
  /** Ascended Heroes: the slot carries the drawn card's own assigned paper. */
  | { kind: 'assigned' }
  | { kind: 'upgrade'; rarity: string }
  | { kind: 'reverse' }

export type SpecialSlotChances = {
  balls: { ball: BallId; odds: number }[]
  /** Chance the slot carries the card's assigned stamp (Ascended Heroes). */
  assigned: number
  upgrades: { rarity: string; odds: number }[]
  reverse: number
}

/** The same slot probabilities, without consuming randomness, for pack estimates. */
export function specialSlotChancesFor(
  setId: string,
  slot: BallSlot = 'first',
): SpecialSlotChances | null {
  if (!isSpecialSet(setId)) return null

  const assignedSet = assignedStampPrintingFor(setId)
  if (assignedSet) {
    if (slot !== assignedSet.slot) return { balls: [], assigned: 0, upgrades: [], reverse: 1 }
    const upgradeTotal = assignedSet.upgrades.reduce((n, u) => n + u.odds, 0)
    return {
      balls: [],
      assigned: assignedSet.packOdds,
      upgrades: assignedSet.upgrades,
      reverse: Math.max(0, 1 - assignedSet.packOdds - upgradeTotal),
    }
  }

  const printings = BALL_PRINTINGS.filter((p) => p.setId === setId)
  const twoSlots = printings.some((p) => p.reverseSlots === 2)

  if (slot === 'second') {
    const second = printings.find((p) => p.slot === 'second')
    if (!second) return { balls: [], assigned: 0, upgrades: [], reverse: 1 }
    const upgrades = second.upgrades ?? []
    const upgradeTotal = upgrades.reduce((n, u) => n + u.odds, 0)
    return {
      balls: [{ ball: second.ball, odds: second.packOdds }],
      assigned: 0,
      upgrades,
      reverse: Math.max(0, 1 - second.packOdds - upgradeTotal),
    }
  }

  if (twoSlots) {
    const first = printings.find((p) => p.slot === 'first')
    return {
      balls: first ? [{ ball: first.ball, odds: first.packOdds }] : [],
      assigned: 0,
      upgrades: [],
      reverse: first ? Math.max(0, 1 - first.packOdds) : 1,
    }
  }

  const master = printings.find((p) => p.ball === 'masterball' && p.slot === 'first')
  const poke = printings.find((p) => p.ball === 'pokeball' && p.slot === 'first')
  const balls: { ball: BallId; odds: number }[] = []
  let reverse = 1
  if (master) {
    balls.push({ ball: 'masterball', odds: master.packOdds })
    reverse *= 1 - master.packOdds
  }
  if (poke) {
    balls.push({ ball: 'pokeball', odds: reverse * poke.packOdds })
    reverse *= 1 - poke.packOdds
  }
  return { balls, assigned: 0, upgrades: [], reverse }
}

export function specialSlotFor(
  setId: string,
  slot: BallSlot = 'first',
  rng: () => number = Math.random,
): SpecialSlotOutcome | null {
  if (!isSpecialSet(setId)) return null

  const assignedSet = assignedStampPrintingFor(setId)
  if (assignedSet) {
    if (slot !== assignedSet.slot) return { kind: 'reverse' }
    const roll = rng()
    if (roll < assignedSet.packOdds) return { kind: 'assigned' }
    let threshold = assignedSet.packOdds
    for (const upgrade of assignedSet.upgrades) {
      threshold += upgrade.odds
      if (roll < threshold) return { kind: 'upgrade', rarity: upgrade.rarity }
    }
    return { kind: 'reverse' }
  }

  const printings = BALL_PRINTINGS.filter((p) => p.setId === setId)
  const twoSlots = printings.some((p) => p.reverseSlots === 2)

  if (slot === 'second') {
    const second = printings.find((p) => p.slot === 'second')
    if (!second) return { kind: 'reverse' }
    const roll = rng()
    if (roll < second.packOdds) {
      return { kind: 'ball', ball: second.ball, variant: BALL_VARIANTS[second.ball] }
    }
    let threshold = second.packOdds
    for (const upgrade of second.upgrades ?? []) {
      threshold += upgrade.odds
      if (roll < threshold) return { kind: 'upgrade', rarity: upgrade.rarity }
    }
    return { kind: 'reverse' }
  }

  if (!twoSlots) {
    const master = printings.find((p) => p.ball === 'masterball' && p.slot === 'first')
    if (master && rng() < master.packOdds) {
      return { kind: 'ball', ball: 'masterball', variant: BALL_VARIANTS.masterball }
    }
  }
  const poke = printings.find((p) => p.ball === 'pokeball' && p.slot === 'first')
  if (poke && rng() < poke.packOdds) {
    return { kind: 'ball', ball: 'pokeball', variant: BALL_VARIANTS.pokeball }
  }
  return { kind: 'reverse' }
}

/**
 * The variant token a slot produces. An assigned set cannot answer this without
 * the card, because the card is what decides its paper; pass the drawn card id.
 */
export function ballVariantFor(
  setId: string,
  slot: BallSlot = 'first',
  rng: () => number = Math.random,
  cardId?: string | null,
): string | null {
  const outcome = specialSlotFor(setId, slot, rng)
  if (!outcome) return null
  if (outcome.kind === 'assigned') return (cardId && ascendedVariantFor(cardId)) || 'reverseHolofoil'
  return outcome.kind === 'ball' ? outcome.variant : 'reverseHolofoil'
}
