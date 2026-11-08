// Player-facing names for the stamped reverses. The server keeps its own label
// map in server/services/market.ts; both name the same explicit tokens.
const REVERSE_TAGS: Record<string, string> = {
  reverseHolofoilPokeBall: 'Poké Ball',
  reverseHolofoilMasterBall: 'Master Ball',
  reverseHolofoilLoveBall: 'Love Ball',
  reverseHolofoilFriendBall: 'Friend Ball',
  reverseHolofoilQuickBall: 'Quick Ball',
  reverseHolofoilDuskBall: 'Dusk Ball',
  // Team Rocket's paper replaces the ball with an R, so it is labelled as itself
  // and never as a ball.
  reverseHolofoilTeamRocket: 'Team Rocket',
  reverseHolofoilEnergy: 'Energy',
}

/** 'Poké Ball' … 'Energy' for a stamped reverse, else null. */
export function reverseTag(variant?: string | null): string | null {
  return variant ? REVERSE_TAGS[variant] ?? null : null
}

/** The ball-only subset, for callers that must not treat Energy or R as a ball. */
export function ballTag(variant?: string | null): string | null {
  const tag = reverseTag(variant)
  return tag === 'Energy' || tag === 'Team Rocket' ? null : tag
}

// The General Mills Sequin copy is a separate printing, not a finish of the plain promo, so
// it carries its own inventory variant and its own name rather than a reverse tag.
const SEQUIN_TAGS: Record<string, string> = {
  sequinHolofoil: 'Sequin Holofoil',
}

/** The player-facing name for any explicit variant this build labels, else null. */
export function variantTag(variant?: string | null): string | null {
  if (!variant) return null
  return reverseTag(variant) ?? SEQUIN_TAGS[variant] ?? null
}
