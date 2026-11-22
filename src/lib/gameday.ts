// ---------------------------------------------------------------------------
// The game-day clock, client mirror of server/lib/gameday.ts. The length is a
// per-save setting the server reports on /api/state (day.lengthHours): 2h rolls
// at every even UTC hour (the default), 12h at 00:00 and 12:00, 24h at 00:00.
// Keep in sync with the server module.
// ---------------------------------------------------------------------------

export type GameDayHours = 2 | 12 | 24

/** Length of one game-day in real milliseconds for the given setting. */
export function gameDayMsFor(hours: GameDayHours): number {
  return hours * 3_600_000
}

/** The real-world instant the current game-day began. */
export function gameDayStartFor(hours: GameDayHours, at: number | Date = Date.now()): Date {
  const t = typeof at === 'number' ? at : at.getTime()
  const d = new Date(t)
  const hour = Math.floor(d.getUTCHours() / hours) * hours
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour))
}

/** Human ETA for a game-day deadline: game-days when it's day-scale, then hours/minutes. */
export function gameDayEtaFor(hours: GameDayHours, msLeft: number): string {
  const dayMs = gameDayMsFor(hours)
  const days = Math.max(0, Math.ceil(msLeft / dayMs))
  if (msLeft >= dayMs) return `~${days} game-day${days === 1 ? '' : 's'}`
  if (msLeft >= 3_600_000) return `~${Math.ceil(msLeft / 3_600_000)}h`
  if (msLeft > 0) return `~${Math.max(1, Math.ceil(msLeft / 60_000))}m`
  return 'any tick now'
}
