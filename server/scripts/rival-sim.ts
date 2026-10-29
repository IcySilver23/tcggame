// Bootstrap for the rival-arc simulator — this file exists to guarantee
// isolation ordering. In ESM, `import` statements evaluate BEFORE any module
// body runs, so a script that sets process.env.TCGLIFE_HOME between its own
// imports is too late: server/lib/db has already bound to the real
// data/tcglife.db (a prior version of this harness trashed the dev save that
// way). Here the temp home is prepared FIRST, then the runner is imported
// dynamically — so every service import binds to the throwaway copy.
//
// Run: `npm run sim:rival [runs] [days]`
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tcglife-sim-'))
fs.mkdirSync(path.join(tmpHome, 'data'), { recursive: true })
for (const suffix of ['', '-wal', '-shm']) {
  const f = path.join('data', 'tcglife.db' + suffix)
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(tmpHome, 'data', 'tcglife.db' + suffix))
}
// The temp home IS the app root for the sim (repo layout: server/schema.sql,
// data/tcgcsv-groups.json) — mirror the boot files so db.ts can boot.
fs.mkdirSync(path.join(tmpHome, 'server'), { recursive: true })
fs.copyFileSync('server/schema.sql', path.join(tmpHome, 'server', 'schema.sql'))
if (fs.existsSync(path.join('data', 'tcgcsv-groups.json'))) {
  fs.copyFileSync(path.join('data', 'tcgcsv-groups.json'), path.join(tmpHome, 'data', 'tcgcsv-groups.json'))
}
process.env.TCGLIFE_HOME = tmpHome
process.env.SIM_RUNS = process.argv[2] ?? '20'
process.env.SIM_DAYS = process.argv[3] ?? '30'

await import('./rival-sim-run')
