// ---------------------------------------------------------------------------
// The save's clock, client mirror of server/lib/clock.ts.
//
// A save can run ahead of this machine's clock: the day pass moves the game's
// clock one game-day forward, and every timestamp the server hands the page
// (resetsAt, grading ETAs, listing ages, auction closes) is stamped on that
// shifted clock. Once the state arrives the page adopts the same shift, so a
// countdown measures the same "now" the server does instead of reading a day
// short. `/api/state` → day.offsetMs is the only input.
// ---------------------------------------------------------------------------

let offsetMs = 0
let installed = false

/** Adopt the save's clock offset. Safe to call on every state poll. */
export function installClientClock(offset: number): void {
  offsetMs = Number.isFinite(offset) && offset > 0 ? offset : 0
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
