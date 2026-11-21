import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

// Read the player's save through a copy: this audit must not open the live
// database read-write just to ask which products are offered.
const root = path.resolve('.')
const home = path.join(root, 'tmp', 'product-audit-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
const source = new Database(path.join(root, 'data', 'tcglife.db'), { readonly: true })
await source.backup(path.join(home, 'data', 'tcglife.db'))
source.close()
process.env.TCGLIFE_HOME = home

const { db } = await import('../server/lib/db')
const sealed = await import('../server/services/sealed')
const { unsellableReason } = await import('../server/catalog/sealed-evidence')

type Row = { id: string; set_id: string; set_name: string; name: string; kind: string; packs: number | null; msrp: number }
const rows = db.prepare(`
  SELECT p.id, p.set_id, s.name AS set_name, p.name, p.kind, p.packs, p.msrp
  FROM pack_products p JOIN sets s ON s.id = p.set_id
  ORDER BY s.release_date, p.set_id, p.kind, p.id
`).all() as Row[]

const api = await fetch('http://127.0.0.1:8787/api/shop/products').then((r) => r.json()) as { id: string; name: string; market_price?: number }[]
const apiIds = new Set(api.map((p) => p.id))
const sold = rows.filter((r) => sealed.sellsProduct(r.id, r.set_id))
const hidden = rows.filter((r) => !sealed.sellsProduct(r.id, r.set_id))

function reason(r: Row): string {
  const product = unsellableReason(r.id)
  if (product) return product
  if (!sealed.sellsOwnPacks(r.set_id)) {
    if (sealed.SUBSET_ONLY_SETS.has(r.set_id)) return 'Set is a subset that only exists inside another set’s packs.'
    if (sealed.NO_BOOSTER_SETS.has(r.set_id)) return 'Set never shipped a randomised booster.'
  }
  return 'UNEXPLAINED: no product or set rule rejects this row'
}

const upcs = rows.filter((r) => /(^|-)upc($|-)/i.test(r.id) || /ultra[- ]premium/i.test(r.name))
console.log(`rows=${rows.length} sold=${sold.length} hidden=${hidden.length} api=${api.length}`)
console.log('\nUPCs:')
for (const r of upcs) {
  const pool = (db.prepare('SELECT COUNT(*) AS n FROM pack_product_cards WHERE pack_product_id = ?').get(`${r.set_id}-booster`) as { n: number }).n
  const detail = sealed.priceDetail(r.id)
  const listed = apiIds.has(r.id)
  console.log(`${r.id} | ${r.name} | sold=${sealed.sellsProduct(r.id, r.set_id)} | api=${listed} | $${detail.market.toFixed(2)} (${detail.source}) | pool=${pool}`)
}

const unexplained = hidden.filter((r) => reason(r).startsWith('UNEXPLAINED'))
console.log(`\nUnexplained hidden rows: ${unexplained.length}`)
for (const r of unexplained) console.log(`${r.set_id} | ${r.id} | ${r.kind} | ${r.name}`)

const groups = new Map<string, Row[]>()
for (const r of hidden) {
  const key = reason(r)
  const list = groups.get(key) ?? []
  list.push(r)
  groups.set(key, list)
}
console.log('\nHidden rows by reason:')
for (const [key, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n[${list.length}] ${key}`)
  for (const r of list) console.log(`  ${r.set_id} | ${r.id} | ${r.kind} | ${r.name}`)
}

const missingSold = sold.filter((r) => !apiIds.has(r.id))
const extraApi = api.filter((p) => !sold.some((r) => r.id === p.id))
console.log(`\nSold rows missing from API: ${missingSold.length}`)
for (const r of missingSold) console.log(`  ${r.set_id} | ${r.id} | ${r.name}`)
console.log(`API rows not sold by the rule: ${extraApi.length}`)
for (const p of extraApi) console.log(`  ${p.id} | ${p.name}`)

const soldWithoutPool = sold.filter((r) => {
  const pool = (db.prepare('SELECT COUNT(*) AS n FROM pack_product_cards WHERE pack_product_id = ?').get(`${r.set_id}-booster`) as { n: number }).n
  return pool === 0
})
console.log(`Sold rows without a pull table: ${soldWithoutPool.length}`)
for (const r of soldWithoutPool) console.log(`  ${r.set_id} | ${r.id} | ${r.name}`)
