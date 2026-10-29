// ---------------------------------------------------------------------------
// The game-day clock, client mirror of server/lib/gameday.ts. The length is a
// per-save setting the server reports on /api/state (day.lengthHours): 12h
// rolls at 00:00 and 12:00 UTC (two game-days per real day), 24h rolls at
// 00:00 UTC (the original cadence). Keep in sync with the server module.
// ---------------------------------------------------------------------------

/** Length of one game-day in real milliseconds for the given setting. */
export function gameDayMsFor(hours: 12 | 24): number {
  return hours * 3_600_000
}

/** The real-world instant the current game-day began. */
export function gameDayStartFor(hours: 12 | 24, at: number | Date = Date.now()): Date {
  const t = typeof at === 'number' ? at : at.getTime()
  const d = new Date(t)
  const half = hours === 24 ? 0 : d.getUTCHours() < 12 ? 0 : 1
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), half * 12))
}

/** Human ETA for a game-day deadline: game-days when it's day-scale, then hours/minutes. */
export function gameDayEtaFor(hours: 12 | 24, msLeft: number): string {
  const dayMs = gameDayMsFor(hours)
  const days = Math.max(0, Math.ceil(msLeft / dayMs))
  if (msLeft >= dayMs) return `~${days} game-day${days === 1 ? '' : 's'}`
  if (msLeft >= 3_600_000) return `~${Math.ceil(msLeft / 3_600_000)}h`
  if (msLeft > 0) return `~${Math.max(1, Math.ceil(msLeft / 60_000))}m`
  return 'any tick now'
}
