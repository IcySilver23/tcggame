// Bootstrap for the manager-quality ladder audit — same isolation dance as the
// `sim:*` scripts: temp home + clock shim BEFORE the runner imports anything.
import { prepareSimHome, installSimClock } from '../server/scripts/sim-home'

prepareSimHome()
installSimClock()
process.env.LADDER_RUNS = process.argv[2] ?? '10'
process.env.LADDER_DAYS = process.argv[3] ?? '18'

await import('./sim-manager-ladder-run')
