// Regression fixture for the sealed audit's pricing-failure path.
//
// The audit normally exits 0 because every sold product is floored at EV. This
// fixture runs it with SEALED_AUDIT_FIXTURE_RIP=sv1-booster, which makes the
// audit quote that one sold booster at a quarter of its shelf price. That run
// must exit 1, list the product as rip-positive, and put it in the failure list.
// A second, unmodified run must exit 0.
//
// Both runs write to a scratch directory, so reports/ is not overwritten.
//
// Run:
//   node ./node_modules/tsx/dist/cli.mjs tmp/check-sealed-audit-failure.ts
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const audit = join(root, 'tmp', 'check-sealed-products.ts')
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const home = process.env.SEALED_AUDIT_HOME
  ? resolve(process.env.SEALED_AUDIT_HOME)
  : join(root, 'tmp', 'audit-home')
const scratch = join(root, 'tmp', 'sealed-audit-fixture')
rmSync(scratch, { recursive: true, force: true })
mkdirSync(scratch, { recursive: true })

type Report = {
  summary: { failures: number }
  ripPositive: { id: string }[]
  failures: { id: string; issues: string[] }[]
}
type Run = { status: number | null; stdout: string; stderr: string; dir: string }

function run(name: string, fixture: boolean): Run {
  const dir = join(scratch, name)
  const env = {
    ...process.env,
    TCGLIFE_HOME: home,
    SEALED_AUDIT_REPORT_DIR: dir,
    ...(fixture ? { SEALED_AUDIT_FIXTURE_RIP: 'sv1-booster' } : {}),
  }
  const result = spawnSync(process.execPath, [tsx, audit], { cwd: root, env, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', dir }
}

function report(dir: string): Report {
  return JSON.parse(readFileSync(join(dir, 'sealed-products.json'), 'utf8')) as Report
}

const ripRun = run('rip', true)
const cleanRun = run('clean', false)
const ripReport = report(ripRun.dir)
const cleanReport = report(cleanRun.dir)
const listed = ripReport.ripPositive.some((r) => r.id === 'sv1-booster')
const failed = ripReport.failures.some((r) => r.id === 'sv1-booster' && r.issues.includes('rip-positive'))
const ok =
  ripRun.status === 1 &&
  ripReport.summary.failures >= 1 &&
  listed &&
  failed &&
  cleanRun.status === 0 &&
  cleanReport.ripPositive.length === 0

console.log(
  `fixture rip exit ${ripRun.status}; listed ${listed}; failure ${failed}; ` +
    `clean exit ${cleanRun.status}; clean rip-positive ${cleanReport.ripPositive.length}`,
)
if (!ok) {
  console.error('--- fixture stderr ---\n' + ripRun.stderr)
  console.error('--- clean stderr ---\n' + cleanRun.stderr)
}
console.log(ok ? 'ok: the audit fails on a deliberately below-EV product and passes clean' : 'FAIL: audit failure path is not enforced')
process.exit(ok ? 0 : 1)
