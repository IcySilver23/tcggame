// Office-star sweep bootstrap — temp home and clock BEFORE any service import.
import { prepareSimHome, installSimClock } from '../server/scripts/sim-home'

prepareSimHome()
process.env.SIM_HOUR = process.env.SIM_HOUR ?? 'night' // skim lives after close
installSimClock()
await import('./sim-offices-run')
