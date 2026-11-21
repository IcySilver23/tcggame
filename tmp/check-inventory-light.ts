// Focused contract check for GET /api/inventory/light.
//
// The four card pickers use the light route, but its values must stay identical
// to the full inventory route they replaced. This boots the real server on an
// isolated copy of the save, asks both endpoints, and fails when:
//   - a collection row is missing from either response;
//   - a picker field is added, removed, renamed, or differs in value;
//   - hidden server state (fake_revealed / auth_status / fake_flag) leaks into
//     the picker response.
//
// Run:
//   npm run check:inventory-light
// or:
//   node ./node_modules/tsx/dist/cli.mjs tmp/check-inventory-light.ts
import Database from 'better-sqlite3'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

const root = process.cwd()
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const sourceDb = join(root, 'data', 'tcglife.db')
const home = join(root, 'tmp', 'inventory-light-home')

// Exactly the fields a picker is allowed to receive. If the light row grows a
// field, decide whether a picker uses it, then update this list and the type.
const PICKER_FIELDS = [
  'id',
  'card_id',
  'variant',
  'condition',
  'quantity',
  'graded_grade',
  'status',
  'favorite',
  'cost_basis',
  'is_fake',
  'name',
  'image_small',
  'set_name',
  'value',
].sort()

// Values that must agree with the full endpoint for every collection row.
const COMPARE_FIELDS = [
  'card_id',
  'variant',
  'condition',
  'quantity',
  'graded_grade',
  'status',
  'favorite',
  'cost_basis',
  'is_fake',
  'name',
  'image_small',
  'set_name',
  'value',
]

type Row = Record<string, unknown>

let failures = 0
function ok(condition: unknown, message: string): void {
  if (!condition) {
    failures++
    console.error(`FAIL: ${message}`)
  }
}

function eq(actual: unknown, expected: unknown, message: string): void {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
  )
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  const text = await res.text()
  if (!res.ok) throw new Error(`${url} returned ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text) as unknown
}

async function waitForServer(base: string, child: ChildProcess, logs: () => string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited (${child.exitCode})\n${logs()}`)
    try {
      const res = await fetch(base + '/api/state')
      if (res.ok) {
        await res.arrayBuffer()
        return
      }
    } catch {
      // Not listening yet — keep polling until the deadline.
    }
    await sleep(150)
  }
  throw new Error(`server did not answer within 30s\n${logs()}`)
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  if (process.platform === 'win32' && child.pid) {
    // Kill only this test server's process tree. Never a name pattern: the dev
    // server's watch parent can share a command line with this one.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve()
    const timer = setTimeout(resolve, 3_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function main(): Promise<void> {
  if (!existsSync(sourceDb)) {
    throw new Error('data/tcglife.db is missing; this check needs a save with collection rows')
  }

  rmSync(home, { recursive: true, force: true })
  mkdirSync(join(home, 'data'), { recursive: true })
  copyFileSync(join(root, 'server', 'schema.sql'), join(home, 'schema.sql'))

  // A consistent copy while the dev server has the save open. Never points the
  // check at the live save itself.
  const source = new Database(sourceDb, { readonly: true, fileMustExist: true })
  try {
    await source.backup(join(home, 'data', 'tcglife.db'))
  } finally {
    source.close()
  }

  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  let log = ''
  const append = (chunk: Buffer) => {
    log = (log + chunk.toString()).slice(-8_000)
  }
  const child = spawn(process.execPath, [tsx, join(root, 'server', 'index.ts')], {
    cwd: root,
    env: {
      ...process.env,
      TCGLIFE_HOME: home,
      TCGLIFE_PORT: String(port),
      TCGLIFE_NO_OPEN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)

  try {
    await waitForServer(base, child, () => log)
    const full = (await fetchJson(base + '/api/inventory')) as Row[]
    const light = (await fetchJson(base + '/api/inventory/light')) as Row[]

    ok(Array.isArray(full), '/api/inventory returns an array')
    ok(Array.isArray(light), '/api/inventory/light returns an array')
    if (!Array.isArray(full) || !Array.isArray(light)) return

    const fullCollection = full.filter((row) => row.status === 'collection')
    ok(fullCollection.length > 0, 'the save has at least one collection row')

    const fullById = new Map<number, Row>()
    for (const row of fullCollection) {
      const id = Number(row.id)
      ok(!fullById.has(id), `full inventory has one row for inventory id ${id}`)
      fullById.set(id, row)
    }

    const lightById = new Map<number, Row>()
    for (const row of light) {
      const id = Number(row.id)
      ok(!lightById.has(id), `light inventory has one row for inventory id ${id}`)
      lightById.set(id, row)

      eq(
        Object.keys(row).sort(),
        PICKER_FIELDS,
        `light row ${id} carries exactly the picker fields`,
      )
      eq(row.status, 'collection', `light row ${id} is a collection row`)
      for (const hidden of ['fake_revealed', 'auth_status', 'fake_flag']) {
        ok(!(hidden in row), `light row ${id} does not leak ${hidden}`)
      }

      const fullRow = fullById.get(id)
      ok(fullRow !== undefined, `light row ${id} exists in the full inventory`)
      if (!fullRow) continue
      for (const field of COMPARE_FIELDS) {
        eq(row[field], fullRow[field], `light row ${id} matches the full row on ${field}`)
      }
    }

    eq(light.length, fullCollection.length, 'both endpoints return the same number of collection rows')
    for (const id of fullById.keys()) {
      ok(lightById.has(id), `full collection row ${id} is present in the light response`)
    }

    console.log(
      `checked ${light.length} collection rows across ${PICKER_FIELDS.length} picker fields; ` +
        `${COMPARE_FIELDS.length} values matched the full endpoint`,
    )
    ok(failures === 0, `${failures} contract failure${failures === 1 ? '' : 's'}`)
  } finally {
    await stopServer(child)
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {
      // Windows can hold a closed database briefly; the scratch home is safe to
      // leave under tmp/ if the cleanup loses that race.
    }
  }
}

main()
  .then(() => {
    if (failures > 0) process.exit(1)
    console.log('ok: the light inventory picker matches the full inventory contract')
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error)
    process.exit(1)
  })
