// Bootstrap: resale-desk economy audit — `npm run sim:resale [runs] [days]`
// Isolation ordering matters: the temp home + clock shim go in BEFORE the
// runner import (see sim-home.ts).
import { prepareSimHome, installSimClock } from './sim-home'

prepareSimHome()
installSimClock()
process.env.SIM_RUNS = process.argv[2] ?? '15'
process.env.SIM_DAYS = process.argv[3] ?? '30'

await import('./resale-sim-run')
