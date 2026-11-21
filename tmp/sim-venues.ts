// Venue balance sims — auction room, NPC proxy lots and fixed-price listings.
// Bootstrap mirrors server/scripts/*-sim.ts: prepare the temp home and clock
// BEFORE any service import, then dynamically import the runner.
//
//   node ./node_modules/tsx/dist/cli.mjs tmp/sim-venues.ts
//
// Never touches data/tcglife.db: prepareSimHome copies it into the OS temp dir.
import { prepareSimHome } from '../server/scripts/sim-home'

const home = prepareSimHome()
console.log(`sim home: ${home}`)

await import('./sim-venues-run')
