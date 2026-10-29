// Bootstrap: full-empire audit — `npm run sim:empire [runs] [days]`
// Flagship + satellite + DM + second satellite + regional + store #3, run
// through the real chainTick. Isolation ordering matters (see sim-home.ts).
import { prepareSimHome, installSimClock } from './sim-home'

prepareSimHome()
installSimClock()
process.env.SIM_RUNS = process.argv[2] ?? '8'
process.env.SIM_DAYS = process.argv[3] ?? '60'
// Owner policy: attentive (grant every raise) or negligent (ignore them all).
process.env.SIM_OWNER = process.argv[4] ?? process.env.SIM_OWNER ?? 'attentive'

await import('./empire-sim-run')
