// One command for the sealed-pack checks: the full audit, the hit-odds check
// (no rarity may ship on the generic 1-in-50 fallback), the daily-deal history
// snapshot and claimed/missed check, and the below-EV failure fixture, all
// against an isolated save.
//
//   npm run check:sealed
//
// The save is, in order:
//   1. SEALED_AUDIT_HOME, if set (must contain data/tcglife.db);
//   2. a fresh tmp/sealed-audit-home copied from data/tcglife.db;
//   3. tmp/audit-home, the fallback audit snapshot when there is no dev save;
//   4. a full catalogue built from the tracked data/catalog-seed.db;
//   5. the tracked small smoke fixture in tmp/fixtures/, seeded at runtime.
//
// SEALED_AUDIT_USE_FULL_CATALOG=1 forces step 4; SEALED_AUDIT_USE_FIXTURE=1
// forces the small step 5. It never audits data/tcglife.db in place, and smoke
// runs write their reports under tmp/ instead of reports/.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const audit = join(root, 'tmp', 'check-sealed-products.ts')
const fixture = join(root, 'tmp', 'check-sealed-audit-failure.ts')
const hitOdds = join(root, 'tmp', 'check-hit-odds.ts')
const dailyDeals = join(root, 'tmp', 'check-daily-deals-history.ts')
const seed = join(root, 'tmp', 'fixtures', 'seed-sealed-fixture.ts')
const fullSeed = join(root, 'tmp', 'fixtures', 'seed-full-catalog.ts')
const fixtureHome = join(root, 'tmp', 'sealed-audit-home')

type Home = { path: string; fixture: boolean; full?: boolean }

function dbAt(home: string): string {
  return join(home, 'data', 'tcglife.db')
}

function seedFixture(): Home {
  rmSync(fixtureHome, { recursive: true, force: true })
  mkdirSync(join(fixtureHome, 'data'), { recursive: true })
  copyFileSync(join(root, 'server', 'schema.sql'), join(fixtureHome, 'schema.sql'))
  console.log('sealed check: no dev save available; using the tracked small catalog fixture')
  const result = spawnSync(process.execPath, [tsx, seed], {
    cwd: root,
    env: { ...process.env, TCGLIFE_HOME: fixtureHome },
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`the tracked catalog fixture failed to seed (exit ${result.status})`)
  }
  return { path: fixtureHome, fixture: true }
}

function seedFullCatalog(): Home {
  const seedFile = join(root, 'data', 'catalog-seed.db')
  if (!existsSync(seedFile)) {
    throw new Error('data/catalog-seed.db is missing; the full catalog check cannot run')
  }
  rmSync(fixtureHome, { recursive: true, force: true })
  mkdirSync(join(fixtureHome, 'data'), { recursive: true })
  copyFileSync(join(root, 'server', 'schema.sql'), join(fixtureHome, 'schema.sql'))
  console.log('sealed check: no dev save available; building the full catalog from data/catalog-seed.db')
  const result = spawnSync(process.execPath, [tsx, fullSeed], {
    cwd: root,
    env: { ...process.env, TCGLIFE_HOME: fixtureHome },
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`the full catalog seed failed (exit ${result.status})`)
  }
  return { path: fixtureHome, fixture: false, full: true }
}

function findHome(): Home {
  const explicit = process.env.SEALED_AUDIT_HOME
  if (explicit) {
    const home = resolve(explicit)
    if (!existsSync(dbAt(home))) throw new Error(`SEALED_AUDIT_HOME has no data/tcglife.db: ${home}`)
    return { path: home, fixture: false }
  }

  if (process.env.SEALED_AUDIT_USE_FIXTURE === '1') return seedFixture()
  if (process.env.SEALED_AUDIT_USE_FULL_CATALOG === '1') return seedFullCatalog()

  const source = join(root, 'data', 'tcglife.db')
  if (existsSync(source)) {
    // A copy, never the real save: the audit seeds pack products and exercises
    // pull tables, and the fixture rewrites scratch reports.
    const home = join(root, 'tmp', 'sealed-audit-home')
    rmSync(home, { recursive: true, force: true })
    mkdirSync(join(home, 'data'), { recursive: true })
    for (const suffix of ['', '-wal', '-shm']) {
      const file = join(root, 'data', `tcglife.db${suffix}`)
      if (existsSync(file)) copyFileSync(file, join(home, 'data', `tcglife.db${suffix}`))
    }
    copyFileSync(join(root, 'server', 'schema.sql'), join(home, 'schema.sql'))
    console.log(`sealed check: copied data/tcglife.db to ${home}`)
    return { path: home, fixture: false }
  }

  // Fallback for a checkout with no dev save: a prepared snapshot, then the
  // tracked full catalogue, then the small smoke fixture. Never prefer a stale
  // snapshot over the live save — that is how old pull weights fail a clean
  // build.
  const snapshot = join(root, 'tmp', 'audit-home')
  if (existsSync(dbAt(snapshot))) return { path: snapshot, fixture: false }

  if (existsSync(join(root, 'data', 'catalog-seed.db'))) return seedFullCatalog()
  return seedFixture()
}

function run(label: string, script: string, env: NodeJS.ProcessEnv): number | null {
  console.log(`\n=== ${label} ===`)
  const result = spawnSync(process.execPath, [tsx, script], { cwd: root, env, stdio: 'inherit' })
  return result.status
}

let home: Home
try {
  home = findHome()
} catch (error) {
  console.error(`sealed check: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}

const reportDir =
  process.env.SEALED_AUDIT_REPORT_DIR ??
  (home.fixture ? join(root, 'tmp', 'sealed-audit-fixture', 'reports') : join(root, 'reports'))
const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  TCGLIFE_HOME: home.path,
  SEALED_AUDIT_REPORT_DIR: reportDir,
}
delete baseEnv.SEALED_AUDIT_FIXTURE_RIP
delete baseEnv.SEALED_AUDIT_USE_FIXTURE
delete baseEnv.SEALED_AUDIT_USE_FULL_CATALOG

const auditStatus = run('sealed audit', audit, baseEnv)
const oddsStatus = run('hit odds', hitOdds, { ...baseEnv, HIT_ODDS_REPORT_DIR: reportDir })
const dailyStatus = run('daily-deal history', dailyDeals, baseEnv)
const fixtureStatus = run('sealed audit failure fixture', fixture, {
  ...baseEnv,
  SEALED_AUDIT_HOME: home.path,
})

if (auditStatus !== 0 || oddsStatus !== 0 || dailyStatus !== 0 || fixtureStatus !== 0) {
  console.error(
    `\nsealed check FAILED (audit ${auditStatus}, hit odds ${oddsStatus}, daily deals ${dailyStatus}, fixture ${fixtureStatus})`,
  )
  process.exit(1)
}
const sourceLabel = home.fixture ? 'smoke fixture' : home.full ? 'full catalog seed' : 'dev save'
console.log(
  `\nsealed check passed: audit clean + hit odds clean + daily-deal history clean + failure path enforced (${sourceLabel})`,
)
