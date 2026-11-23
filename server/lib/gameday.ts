// ---------------------------------------------------------------------------
// The game-day clock — ONE definition of how long a game-day is and where its
// boundaries fall. The length is a per-save setting (2, 12 or 24 real hours,
// default 2): boundaries are every N hours of UTC, so a 2h day rolls at every
// even hour (twelve game-days per real day), 12h at 00:00 and 12:00, and 24h at
// 00:00. Every daily system derives its timing from here; real-world syncs
// (price crawls, catalog deltas, API quotas, the tcgcsv mirror) are NOT game
// systems and stay on the 24h wall clock regardless. The length is cached and
// reset by the Settings endpoint when the player switches it.
// ---------------------------------------------------------------------------

import { getSetting } from './db'

export type GameDayHours = 2 | 12 | 24

const LENGTHS: GameDayHours[] = [2, 12, 24]
/** A new save starts on 2-hour days unless the player picks otherwise. */
export const DEFAULT_GAME_DAY_HOURS: GameDayHours = 2

function msOf(at: number | string | Date): number {
  if (typeof at === 'number') return at
  return at instanceof Date ? at.getTime() : Date.parse(at)
}

const SETTING_KEY = 'dayLengthHours'
let cachedHours: GameDayHours | null = null

/** Current game-day length in real hours (2, 12 or 24), read once until changed. */
export function gameDayHours(): GameDayHours {
  if (cachedHours == null) {
    const stored = Number(getSetting(SETTING_KEY))
    cachedHours = LENGTHS.includes(stored as GameDayHours) ? (stored as GameDayHours) : DEFAULT_GAME_DAY_HOURS
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

/**
 * The real-world instant the current game-day began: UTC midnight cut into
 * equal `hours` blocks, so 2h rolls at every even hour, 12h at 00:00/12:00 and
 * 24h at 00:00 only.
 */
export function gameDayStart(at: number | string | Date = Date.now()): Date {
  const d = new Date(msOf(at))
  const hour = Math.floor(d.getUTCHours() / gameDayHours()) * gameDayHours()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour))
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
 * The day-key gate stamp for "already ran this game-day". At 24h the key is the
 * plain UTC date; at 12h it is date-am/pm; at 2h it is date-HH. Keys are
 * comparable across settings switches in the one sense that matters: an old key
 * from another length simply does not match, so the gate re-runs once.
 */
export function gameDayKey(at: number | string | Date = Date.now()): string {
  const d = gameDayStart(at)
  const date = d.toISOString().slice(0, 10)
  const hours = gameDayHours()
  if (hours === 24) return date
  if (hours === 12) return `${date}-${d.getUTCHours() === 0 ? 'am' : 'pm'}`
  return `${date}-${String(d.getUTCHours()).padStart(2, '0')}`
}

/** N game-days ago as a real timestamp (for lookback windows). */
export function gameDaysAgoMs(n: number, at: number | string | Date = Date.now()): number {
  return msOf(at) - n * gameDayMs()
}

/**
 * Resolve a `last_accrual_day` stamp to a real game-day key. Builds before the
 * day-key fix wrote a bare date ('2026-11-23'), which parses as MIDNIGHT: billed
 * between keys, such a stamp charges every two-hour bucket since midnight on the
 * first tick after an upgrade instead of the days the loan actually ran. Such a
 * stamp is read as the key the loan was issued in.
 */
export function accrualStamp(stamp: string, issuedAt: string, fallback = Date.now()): string {
  if (stamp && stamp.length > 10) return stamp
  const ms = Date.parse(issuedAt)
  return gameDayKey(Number.isFinite(ms) ? ms : fallback)
}

/** Parse a day key ('2026-09-30-am' / '-pm' / '-14' / plain date) to its boundary instant. */
export function gameDayKeyStartMs(key: string): number {
  const datePart = key.slice(0, 10)
  const tail = key.slice(11)
  const hour = tail === 'pm' ? 12 : tail === 'am' ? 0 : /^\d{1,2}$/.test(tail) ? Number(tail) : 0
  const [y, m, d] = datePart.split('-').map(Number)
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1, hour)
}
