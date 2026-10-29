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
 * Install the simulated clock BEFORE any service import: Date.now() and
 * `new Date()` return sim time, which advances one day per advance() call.
 * Every date computation inside the services (day keys, war windows, expiries)
 * then agrees with the simulated calendar. The clock pins to SIM_HOUR local
 * (default 18:30 — the walk-in evening peak) so every simulated day samples
 * the same hour instead of whatever real time the sim happened to start at.
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
  const d = new Date()
  d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0)
  let simNow = d.getTime()
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
  const advance = () => {
    simNow += 86_400_000
    if (mixed || night) {
      const h = mixed ? mixedHour() : nightHour()
      const nd = new RealDate(simNow)
      nd.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0)
      simNow = nd.getTime()
    }
    // fullday keeps the clock where the runner last pinned it — the runner
    // re-pins every tick from simDayPlan anyway.
  }
  ;(globalThis as { advanceSimDay?: () => void }).advanceSimDay = advance
  // Re-pin the LOCAL hour within the current sim-day (fullday mode: the
  // runner sets each tick's hour from simDayPlan so one simulated day spans
  // the clock). The pin must never move the instant off the current UTC
  // calendar day — every day-guard in the services keys on the UTC date —
  // so after pinning we shift ±24h if the UTC date wandered (early-morning
  // local pins regress a day in UTC+ zones; late-evening ones jump ahead in
  // UTC− zones). Services keep reading getHours() (local), so the night band
  // they see is exactly the band the plan asked for.
  ;(globalThis as { setSimHour?: (h: number) => void }).setSimHour = (h) => {
    const utcDay = new RealDate(simNow).toISOString().slice(0, 10)
    const nd = new RealDate(simNow)
    nd.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0)
    let t = nd.getTime()
    const pinnedDay = new RealDate(t).toISOString().slice(0, 10)
    if (pinnedDay < utcDay) t += 86_400_000
    else if (pinnedDay > utcDay) t -= 86_400_000
    simNow = t
  }
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
