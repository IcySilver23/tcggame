// Proves the sealed rows for products that never existed are gone, not hidden,
// and that no real product went with them.
import fs from 'node:fs'
import Database from 'better-sqlite3'
import path from 'node:path'

const root = path.resolve('.')
const home = path.join(root, 'tmp', 'fabricated-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
const source = new Database(path.join(root, 'data', 'tcglife.db'), { readonly: true })
await source.backup(path.join(home, 'data', 'tcglife.db'))
source.close()
const copy = new Database(path.join(home, 'data', 'tcglife.db'))
copy.pragma('wal_checkpoint(TRUNCATE)')
copy.pragma('journal_mode = DELETE')
copy.close()
process.env.TCGLIFE_HOME = home

const { db } = await import('../server/lib/db')
const sealed = await import('../server/services/sealed')
const { UNSELLABLE_PRODUCTS } = await import('../server/catalog/sealed-evidence')
const { PULL_TABLE_HOSTS } = sealed

sealed.ensureFullCatalog()

type Row = { id: string; set_id: string; kind: string; name: string; release_date: string }
const rows = db
  .prepare(
    `SELECT p.id, p.set_id, p.kind, p.name, s.release_date
     FROM pack_products p JOIN sets s ON s.id = p.set_id`,
  )
  .all() as Row[]

let failures = 0
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++
    console.log(`FAIL ${msg}`)
  }
}

// The whole point: the catalogue holds only wrappers a shop could stock, plus
// the three table hosts a real blister/ETB needs. Anything else is a phantom
// that was left behind.
for (const r of rows) {
  check(
    sealed.sellsProduct(r.id, r.set_id) || PULL_TABLE_HOSTS.has(r.id),
    `${r.id}: phantom row is still catalogued`,
  )
}
for (const id of Object.keys(UNSELLABLE_PRODUCTS)) {
  if (PULL_TABLE_HOSTS.has(id)) continue
  check(!rows.some((r) => r.id === id), `${id}: never-shipped product is still in pack_products`)
}
const hidden = rows.filter((r) => !sealed.sellsProduct(r.id, r.set_id))
check(
  hidden.length === PULL_TABLE_HOSTS.size && hidden.every((r) => PULL_TABLE_HOSTS.has(r.id)),
  `hidden rows are not exactly the pull-table hosts: ${hidden.map((r) => r.id).join(', ')}`,
)

// The specific shapes the request named, beyond the registry: no pre-Lost
// Origin bundle and no special-set display may exist under any id.
const earlyBundles = rows.filter((r) => r.kind === 'bundle' && r.release_date < '2022-09-09' && r.id !== 'swsh12pt5-bundle')
check(earlyBundles.length === 0, `bundles before Lost Origin still catalogued: ${earlyBundles.map((r) => r.id).join(', ')}`)
const SPECIAL = new Set(['cel25', 'pgo', 'det1', 'sv3pt5', 'me55', 'swsh35', 'swsh45', 'sm35', 'sm75', 'sm115', 'g1', 'dc1', 'dv1'])
const specialDisplays = rows.filter((r) => r.kind === 'display' && SPECIAL.has(r.set_id))
check(specialDisplays.length === 0, `special-set displays still catalogued: ${specialDisplays.map((r) => r.id).join(', ')}`)

// The wrappers that really existed must survive.
for (const id of ['cel25-booster', 'cel25-etb', 'pgo-booster', 'pgo-etb', 'mcd21-booster', 'mcd22-booster', 'swsh11-bundle', 'swsh12pt5-bundle', 'bw8-etb', 'bw10-etb', 'xy1-etb', 'sm1-etb', 'dc1-blister', 'dv1-blister']) {
  check(rows.some((r) => r.id === id), `${id}: real product was removed`)
  check(sealed.sellsProduct(id, id.split('-')[0]), `${id}: real product is not sold`)
}

// The prune must be idempotent, and seeding must not grow a removed row back.
const before = rows.length
const added = sealed.ensureFullCatalog()
const after = (db.prepare('SELECT COUNT(*) AS n FROM pack_products').get() as { n: number }).n
check(after === before, `ensureFullCatalog changed the row count ${before} -> ${after}`)
check(added === 0, `ensureFullCatalog re-added ${added} products`)

const sold = rows.filter((r) => sealed.sellsProduct(r.id, r.set_id))
console.log(`rows=${rows.length} sold=${sold.length} pull-table hosts=${rows.length - sold.length}`)
console.log(failures === 0 ? 'OK' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
