// ---------------------------------------------------------------------------
// THE SAVE'S CLOCK — real time, plus any game-days the player paid to skip.
//
// Every system in the game asks Date.now() (or builds `new Date()`), so a
// skipped day is kept as an offset and installed here as a shift on Date
// itself: day keys, rent stamps, grading ETAs, listing ages and the HUD all
// move together, which is the only way "the day turned over" can be true for
// all of them at once. The offset lives in meta, so it survives a restart.
//
// This is a clock, not a counter: a skipped day is time that passed, not a
// free roll. Interval-driven work (sync loops, the release check) is untouched
// because it runs on timers; anything that stamps or compares a time simply
// sees a save whose clock already ran ahead.
// ---------------------------------------------------------------------------

import { db, getMeta, setMeta } from './db'

const OFFSET_KEY = 'clock:offsetMs'
const SKIPS_KEY = 'clock:skips'

let offsetMs = 0
let installed = false

/** How far this save's clock runs ahead of the wall clock, in ms. */
export function clockOffsetMs(): number {
  return offsetMs
}

/** Game-days this save has skipped (a display fact; the clock is the offset). */
export function clockSkips(): number {
  const n = Number(getMeta(SKIPS_KEY) ?? '0')
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/**
 * Install the save's clock. Call once at boot, before any request is served:
 * it reads the stored offset and replaces the global Date with one shifted by
 * it. `new Date(knownTime)` and Date.parse/UTC are untouched, so parsing stored
 * timestamps still means exactly what it did.
 */
export function installClock(): void {
  const stored = Number(getMeta(OFFSET_KEY) ?? '0')
  offsetMs = Number.isFinite(stored) && stored > 0 ? stored : 0
  if (installed) return
  installed = true
  const RealDate = Date
  const now = () => RealDate.now() + offsetMs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ShiftedDate: any = function (this: unknown, ...args: any[]) {
    if (new.target) return args.length === 0 ? new RealDate(now()) : new (RealDate as any)(...args)
    return (RealDate as any)(...args) // Date() without new still returns a string
  }
  ShiftedDate.prototype = RealDate.prototype
  ShiftedDate.now = now
  ShiftedDate.parse = RealDate.parse
  ShiftedDate.UTC = RealDate.UTC
  globalThis.Date = ShiftedDate
}

/** Move the save's clock forward by `ms` and remember it (the day pass). */
export function advanceClock(ms: number): number {
  const step = Math.round(ms)
  if (!Number.isFinite(step) || step <= 0) return offsetMs
  offsetMs += step
  setMeta(OFFSET_KEY, String(Math.round(offsetMs)))
  return offsetMs
}

/**
 * Put the running clock back on real time and forget the bought days. A save
 * reset starts a fresh world, so the skips the old one paid for must not
 * survive as an offset the new save never earned — and the offset is deleted
 * from meta as well, because the reset's keep-list sweep would drop it anyway
 * and the in-memory clock would then disagree with the save it is playing.
 */
export function resetClock(): void {
  offsetMs = 0
  db.prepare('DELETE FROM meta WHERE key IN (?, ?)').run(OFFSET_KEY, SKIPS_KEY)
}

/** Count one paid skip. The clock itself moves in advanceClock. */
export function noteClockSkip(): number {
  const n = clockSkips() + 1
  setMeta(SKIPS_KEY, String(n))
  return n
}
