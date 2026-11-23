import { round2 } from './market'

/**
 * The room's hidden ceiling, described instead of quoted.
 *
 * A host needs a sense of what the crowd will pay, but the number itself is
 * the room's: it is drawn per break and per lot, and handing the penny to the
 * browser turns pricing into copying an answer out of a JSON field. So the
 * read models carry a coarse band instead — roughly 75% to 120% of the real
 * ceiling, snapped to a step that suits the magnitude, never tighter than a
 * quarter. Price at the bottom and it sells; price at the top and it is a
 * gamble. That is the game the band leaves in place.
 */
/** The ladder a band snaps to: a quarter under a dollar, then bigger steps. */
export function moneyStep(v: number): number {
  return v < 1 ? 0.25 : v < 5 ? 0.5 : v < 20 ? 1 : v < 50 ? 5 : v < 200 ? 10 : 25
}

export function bandedCeiling(v: number): { low: number; high: number } {
  const step = moneyStep(v)
  const low = Math.max(step, Math.floor((v * 0.75) / step) * step)
  // Always at least two steps wide, so a band can never collapse onto one number.
  const high = Math.max(low + step, Math.ceil((v * 1.2) / step) * step)
  return { low: round2(low), high: round2(high) }
}

/** "…$1.50–$3.00" for log and chat lines — same coarse band, no exact ceiling. */
export function bandText(b: { low: number; high: number }): string {
  const money = (n: number) => `$${n.toFixed(2)}`
  return `${money(b.low)}\u2013${money(b.high)}`
}
