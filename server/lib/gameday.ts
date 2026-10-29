// ---------------------------------------------------------------------------
// The game-day clock — ONE definition of how long a game-day is and where its
// boundaries fall. The length is a per-save setting ('12' or '24' real hours,
// default 12): 12h rolls at 00:00 and 12:00 UTC (two game-days per real day),
// 24h rolls at 00:00 UTC (the original cadence). Every daily system derives
// its timing from here; real-world syncs (price crawls, catalog deltas, API
// quotas, the tcgcsv mirror) are NOT game systems and stay on the 24h wall
// clock regardless. The length is cached and reset by the Settings endpoint
// when the player switches it.
// ---------------------------------------------------------------------------

import { getSetting } from './db'

export type GameDayHours = 12 | 24

function msOf(at: number | string | Date): number {
  if (typeof at === 'number') return at
  return at instanceof Date ? at.getTime() : Date.parse(at)
}

const SETTING_KEY = 'dayLengthHours'
let cachedHours: GameDayHours | null = null

/** Current game-day length in real hours (12 or 24), read once until changed. */
export function gameDayHours(): GameDayHours {
  if (cachedHours == null) {
    cachedHours = getSetting(SETTING_KEY) === '24' ? 24 : 12
  }
  return cachedHours
}

/** Current game-day length in real milliseconds. */
export function gameDayMs(): number {
  return gameDayHours() * 3_600_000
}

/** Called when the setting changes so the next read picks it up. */
export function resetGameDayCache(): void {
  cachedHours = null
}

/** The real-world instant the current game-day began (00:00 UTC at 24h; 00:00 or 12:00 UTC at 12h). */
export function gameDayStart(at: number | string | Date = Date.now()): Date {
  const d = new Date(msOf(at))
  const half = gameDayHours() === 24 ? 0 : d.getUTCHours() < 12 ? 0 : 1
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), half * 12))
}

/** The real-world instant the current game-day ends = the next boundary. */
export function gameDayEnd(at: number | string | Date = Date.now()): Date {
  return new Date(gameDayStart(at).getTime() + gameDayMs())
}

/**
 * The game-day number for a save: day 1 = the game-day containing the save's
 * created_at, +1 per boundary crossed since.
 */
export function gameDayNumber(createdAt: string | Date, at: number | string | Date = Date.now()): number {
  const created = gameDayStart(createdAt).getTime()
  return Math.max(1, Math.floor((gameDayStart(at).getTime() - created) / gameDayMs()) + 1)
}

/**
 * The day-key gate stamp for "already ran this game-day". At 12h the key
 * changes at every 00:00/12:00 boundary; at 24h it degrades to the plain UTC
 * date, so keys are comparable across settings switches.
 */
export function gameDayKey(at: number | string | Date = Date.now()): string {
  const d = gameDayStart(at)
  return gameDayHours() === 12 ? d.toISOString().slice(0, 10) + '-' + (d.getUTCHours() === 0 ? 'am' : 'pm') : d.toISOString().slice(0, 10)
}

/** N game-days ago as a real timestamp (for lookback windows). */
export function gameDaysAgoMs(n: number, at: number | string | Date = Date.now()): number {
  return msOf(at) - n * gameDayMs()
}

/** Parse a day key ('2026-09-30-am' / '-pm' / plain date) to its boundary instant. */
export function gameDayKeyStartMs(key: string): number {
  const datePart = key.slice(0, 10)
  const half = key.endsWith('-pm') ? 12 : 0
  const [y, m, d] = datePart.split('-').map(Number)
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1, half)
}
