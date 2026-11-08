// Shared plumbing for the economy simulators (`sim:rival`, `sim:franchise`,
// `sim:resale`). Each economy gets a bootstrap script that calls these BEFORE
// importing anything from ../lib or ../services.
//
// WHY THE ORDER MATTERS: in ESM, `import` statements evaluate before any
// module body runs. A sim that sets process.env.TCGLIFE_HOME between its own
// imports is too late — server/lib/db has already bound to the real
// data/tcglife.db (the original rival sim trashed the dev save exactly this
// way). The bootstraps therefore prepare the temp home and install the clock
// shim FIRST, then dynamically import the runner.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Copy the dev database + boot files into a fresh temp home and aim TCGLIFE_HOME at it. */
export function prepareSimHome(): string {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tcglife-sim-'))
  fs.mkdirSync(path.join(tmpHome, 'data'), { recursive: true })
  fs.mkdirSync(path.join(tmpHome, 'server'), { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    const f = path.join('data', 'tcglife.db' + suffix)
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(tmpHome, 'data', 'tcglife.db' + suffix))
  }
  // The temp home IS the app root for the sim (repo layout: server/schema.sql,
  // data/tcgcsv-groups.json) — mirror the boot files so db.ts can boot.
  fs.copyFileSync('server/schema.sql', path.join(tmpHome, 'server', 'schema.sql'))
  if (fs.existsSync(path.join('data', 'tcgcsv-groups.json'))) {
    fs.copyFileSync(path.join('data', 'tcgcsv-groups.json'), path.join(tmpHome, 'data', 'tcgcsv-groups.json'))
  }
  process.env.TCGLIFE_HOME = tmpHome
  return tmpHome
}

/**
 * A simulated day IS a game-day: 12 real hours by default (SIM_DAY_HOURS=24
 * pins the save's 24h cadence instead), aligned to the same UTC boundaries
 * gameDayStart() uses — 00:00 and 12:00.
 *
 * That alignment is the whole point. Rent and payroll key on gameDayKey(), so a
 * sim day that spans MORE than one game-day charges rent more than once and
 * reports a store as far more expensive than a player would ever experience.
 * The earlier fullday clock advanced 24h per simulated day and pinned a fresh
 * hour every tick; the guard fired ~2.8× per day, which inflated rent and
 * payroll by that factor and made the manager-quality ladder look flat.
 */
function dayMs(): number {
  return Number(process.env.SIM_DAY_HOURS ?? 12) * 3_600_000
}

/** Start of the game-day containing `ms` — the same buckets gameDayStart() picks. */
function bucketStart(ms: number): number {
  return Math.floor(ms / dayMs()) * dayMs()
}

/**
 * Install the simulated clock BEFORE any service import: Date.now() and
 * `new Date()` return sim time, which advances one game-day per advance() call.
 * Every date computation inside the services (day keys, war windows, expiries)
 * then agrees with the simulated calendar. Ticks are pinned INSIDE the current
 * game-day, so the day key is constant for a whole simulated day and every
 * once-a-day charge fires exactly once.
 *
 * SIM_HOUR=night samples the late band instead (70% 21–24, 30% 0–6) — the
 * unwatched hours where manager skims live. Run the economy sims both ways:
 * the day run carries the traffic, the night run carries the shrink.
 */
export function installSimClock(): () => void {
  const mode = process.env.SIM_HOUR ?? '18.5'
  const mixed = mode === 'mixed'
  const night = mode === 'night'
  const fullday = mode === 'fullday'
  // One play session per day at a plausible hour: dead nights are rare but real.
  const mixedHour = () => {
    const r = Math.random()
    if (r < 0.15) return Math.random() * 8        // 0–8   dead hours (skim country)
    if (r < 0.4) return 8 + Math.random() * 3     // 8–11  quiet morning
    if (r < 0.6) return 11 + Math.random() * 3    // 11–14 lunch bump
    if (r < 0.75) return 14 + Math.random() * 3   // 14–17 afternoon
    return 17 + Math.random() * 5                 // 17–22 evening peak
  }
  const nightHour = () => {
    const r = Math.random()
    return r < 0.7 ? 21 + Math.random() * 3 : Math.random() * 6 // 21–24 staffless close, 0–6 deep night
  }
  const hour = mixed ? mixedHour() : night ? nightHour() : fullday ? 10 : Number(mode)

  const realNow = Date
  const simBoot = new realNow()
  simBoot.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0)
  let simNow = bucketStart(simBoot.getTime())

  const RealDate = Date
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SimDate: any = function (this: unknown, ...args: any[]) {
    if (new.target) return args.length === 0 ? new RealDate(simNow) : new (RealDate as any)(...args)
    return (RealDate as any)(...args) // Date() without new returns a string, as usual
  }
  SimDate.prototype = RealDate.prototype
  SimDate.now = () => simNow
  SimDate.parse = RealDate.parse
  SimDate.UTC = RealDate.UTC
  globalThis.Date = SimDate

  /**
   * Pin a clock hour INSIDE the current game-day. The hour is mapped proportionally
   * into the day (h/24 of the day's length), so a 12h game-day covers its own half
   * of the clock: the simulated session still lands at plausible trading hours,
   * while the day key — and therefore rent, payroll and every daily rollover —
   * stays fixed. Consecutive days alternate am/pm buckets, so a multi-day run
   * samples the whole clock instead of one fixed band.
   */
  const pin = (h: number) => {
    const span = dayMs()
    const off = Math.max(0, Math.min(span - 60_000, Math.round((h / 24) * span)))
    simNow = bucketStart(simNow) + off
  }
  pin(hour)

  const advance = () => {
    simNow = bucketStart(simNow) + dayMs()
    if (mixed || night) pin(mixed ? mixedHour() : nightHour())
    // fullday keeps the clock where the runner last pinned it — the runner
    // re-pins every tick from simDayPlan anyway.
  }
  ;(globalThis as { advanceSimDay?: () => void }).advanceSimDay = advance
  // Re-pin the hour within the current game-day (fullday mode: the runner sets
  // each tick's hour from simDayPlan so one simulated day spans the clock).
  ;(globalThis as { setSimHour?: (h: number) => void }).setSimHour = pin
  return advance
}

/** Runner-side guard: refuse to run unless bound to a temp-dir home. */
export function requireSimHome(): string {
  const home = process.env.TCGLIFE_HOME
  if (!home || !path.resolve(home).startsWith(path.resolve(os.tmpdir()))) {
    console.error('This sim must be launched via its `sim:*` npm script (it needs an isolated TCGLIFE_HOME in the OS temp dir) — refusing to run against your real save.')
    process.exit(1)
  }
  return home
}

/**
 * One simulated day's tick hours for SIM_HOUR=fullday: mostly staffed hours
 * (heavy on the evening peak) plus a real late-night slice (~11% of ticks),
 * so a simulated day spans the whole clock and night-only mechanics — the
 * manager skim above all — get honest sampling weight instead of none.
 */
export function simDayPlan(ticks: number): number[] {
  const plan: number[] = []
  for (let i = 0; i < ticks; i++) {
    const r = Math.random()
    if (r < 0.05) plan.push(Math.random() * 6)          // 0–6 deep night
    else if (r < 0.11) plan.push(21 + Math.random() * 3) // 21–24 after close
    else if (r < 0.25) plan.push(8 + Math.random() * 3)  // quiet morning
    else if (r < 0.42) plan.push(11 + Math.random() * 3) // lunch bump
    else if (r < 0.58) plan.push(14 + Math.random() * 3) // afternoon
    else plan.push(17 + Math.random() * 5)               // evening peak
  }
  return plan
}

/** Runs/days from the bootstrap (SIM_RUNS / SIM_DAYS env). */
export function simArgs(): { runs: number; days: number } {
  return {
    runs: Math.max(1, Number(process.env.SIM_RUNS ?? 20)),
    days: Math.max(1, Number(process.env.SIM_DAYS ?? 30)),
  }
}
