import fs from 'node:fs'
import { prepareSimHome } from '../server/scripts/sim-home'

const home = prepareSimHome()
const packs = await import('../server/services/packs')
const { db } = await import('../server/lib/db')

type Product = { id: string; name: string; packs: number }
const products = db
  .prepare("SELECT id, name, packs FROM pack_products WHERE packs > 1 AND kind IN ('bundle', 'etb', 'display') ORDER BY packs ASC")
  .all() as Product[]
if (products.length === 0) throw new Error('no multi-pack product in the test save')

let first: ReturnType<typeof packs.beginBox> | null = null
let product: Product | null = null
for (const candidate of products) {
  db.prepare('DELETE FROM sealed_inventory WHERE product_id = ?').run(candidate.id)
  db.prepare('DELETE FROM sealed_box_open WHERE product_id = ?').run(candidate.id)
  db.prepare("INSERT INTO sealed_inventory (product_id, quantity, cost, condition, acquired_at) VALUES (?, 1, 100, 'fresh', ?)")
    .run(candidate.id, new Date().toISOString())
  try {
    first = packs.beginBox(candidate.id)
    product = candidate
    break
  } catch {
    db.prepare('DELETE FROM sealed_box_open WHERE product_id = ?').run(candidate.id)
  }
}
if (!first || !product) throw new Error('no multi-pack box could be opened from the test save')
if (first.packsTotal <= 1) throw new Error(`${product.id} did not start a multi-pack box`)
if (first.packsLeft !== first.packsTotal - 1) throw new Error('first pack did not count down the box')

const expectedRemaining = first.packsLeft
const rest = packs.openBoxRest(first.boxId)
const cardsInPacks = rest.perPack.reduce((n, p) => n + p.cards.length, 0)

if (rest.packsOpened !== expectedRemaining) throw new Error(`opened ${rest.packsOpened} of ${expectedRemaining} remaining packs`)
if (!rest.done || rest.packsLeft !== 0) throw new Error('box still reports wrappers left')
if (rest.cards.length !== cardsInPacks) throw new Error('combined card list does not match the packs')
if (rest.perPack.some((p) => p.cards.length === 0)) throw new Error('a skipped pack returned no cards')
// Per-pack costs are rounded, so a six-pack $100 box can sum to $100.02.
if (Math.abs(rest.spent + first.spent - 100) > 0.05) throw new Error(`skipped spend ${rest.spent} + first ${first.spent} did not equal the box cost`)

const boxRow = db.prepare('SELECT COUNT(*) AS n FROM sealed_box_open WHERE id = ?').get(first.boxId) as { n: number }
if (boxRow.n !== 0) throw new Error('the finished box row was not removed')

console.log(`box skip: ${product.name} — ${first.packsTotal} packs, ${rest.packsOpened} skipped, ${rest.cards.length + first.cards.length} cards`)
db.close()
fs.rmSync(home, { recursive: true, force: true })
console.log('BOX_SKIP_OK')
