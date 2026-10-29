// Bootstrap: single-deal resale probe — `npm run sim:resale-probe`
import { prepareSimHome, installSimClock } from './sim-home'

prepareSimHome()
installSimClock()
process.env.SIM_RUNS = '1'
process.env.SIM_DAYS = '1'

await import('./resale-probe-run')
