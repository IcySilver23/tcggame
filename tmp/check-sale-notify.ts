// A market listing that sells now lands in the header bell, not only in the
// activity feed. Runs against a COPY of the save under tmp/salenotify-home.
//
//   npx tsx tmp/check-sale-notify.ts

import fs from 'node:fs'
import path from 'node:path'

let checks = 0
const fails: string[] = []
function ok(cond: unknown, label: string) {
  checks++
  if (!cond) fails.push(label)
}

const home = path.resolve('tmp/salenotify-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'server'), { recursive: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
fs.copyFileSync('server/schema.sql', path.join(home, 'server', 'schema.sql'))
for (const suffix of ['', '-wal', '-shm']) {
  const src = path.join('data', `tcglife.db${suffix}`)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(home, 'data', `tcglife.db${suffix}`))
}
process.env.TCGLIFE_HOME = home

const { db } = await import('../server/lib/db')
const { installClock } = await import('../server/lib/clock')
const market = await import('../server/services/market')
const notify = await import('../server/services/notify')

installClock()

const cash = () => Math.round((db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash * 100) / 100
const old = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
// The sale paths fire the notification through a lazy import, so give the
// promise chain a moment to land before the bell is read.
const settle = () => new Promise<void>((r) => setTimeout(r, 250))

try {
  // Nothing else of the player's is on the block, so every sale below is ours.
  db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL WHERE status = 'listed'`)

  const card = db
    .prepare(`SELECT c.id, c.name FROM cards c WHERE EXISTS (SELECT 1 FROM price_records p WHERE p.card_id = c.id AND p.market > 0) LIMIT 1`)
    .get() as { id: string; name: string } | undefined
  ok(Boolean(card), 'the catalogue has a priced card to list')
  if (!card) throw new Error('no priced card')

  const ins = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at, listing_price, listed_at)
     VALUES (?, 'normal', 'NM', 2, 'listed', 'test', 6, ?, 25, ?)`,
  )
  const id = ins.run(card.id, old, old).lastInsertRowid as number

  // A listing two game-days stale sells on the first tick; retry in case the
  // hazard roll misses, because an unsold row proves nothing.
  let sold = false
  for (let i = 0; i < 200 && !sold; i++) {
    market.resolveSales()
    const row = db.prepare('SELECT status, quantity FROM inventory WHERE id = ?').get(id) as { status: string; quantity: number }
    sold = row.status === 'sold' && row.quantity === 0
  }
  ok(sold, 'the stale listing sold to an NPC buyer')
  ok(cash() > 0, 'the drawer took the proceeds')
  await settle()

  const rows = notify.list(20)
  const mine = rows.filter((r) => r.title.includes(card.name))
  ok(mine.length === 1, 'exactly one notification names the sold card')
  if (mine[0]) {
    const n = mine[0]
    ok(n.kind === 'sale', 'it is filed as a sale')
    ok(n.title.startsWith('💵'), 'the title carries the money icon')
    ok(/2× /.test(n.title), 'a stack sale says how many sold')
    ok(n.href === '#/inventory', 'it points at the inventory')
    ok(/paid \$50\.00/.test(n.body ?? ''), 'the body quotes what the buyer paid ($25 each)')
    ok(/\$45\.00/.test(n.body ?? ''), 'and what reached the player after the 10% fee')
    ok(/\+\$33\.00/.test(n.body ?? ''), 'and the profit against the $12 basis')
    ok(!n.read_at, 'it arrives unread, so the bell badges')
  }
  ok(notify.unreadCount() >= 1, 'the unread count includes it')

  // Re-running the tick must not stack a duplicate for the same sale.
  for (let i = 0; i < 5; i++) market.resolveSales()
  await settle()
  ok(notify.list(40).filter((r) => r.title.includes(card.name)).length === 1, 'a second tick does not re-notify the same sale')

  // Graded slabs take the same route through their own resolver.
  const slabId = db
    .prepare(
      `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at, listing_price, listed_at, graded_grade)
       VALUES (?, 'normal', 'NM', 1, 'listed', 'test', 40, ?, 120, ?, 'PSA 10')`,
    )
    .run(card.id, old, old).lastInsertRowid as number
  let slabSold = false
  for (let i = 0; i < 200 && !slabSold; i++) {
    market.resolveGradedSales()
    const row = db.prepare('SELECT status FROM inventory WHERE id = ?').get(slabId) as { status: string }
    slabSold = row.status === 'sold'
  }
  ok(slabSold, 'the stale slab listing sold')
  await settle()
  const slabNote = notify.list(40).find((r) => r.title.includes('PSA 10'))
  ok(Boolean(slabNote), 'a sold slab lands in the bell too')
  if (slabNote) {
    ok(slabNote.title.includes(card.name), 'the slab notification names the card')
    ok(/\$108\.00/.test(slabNote.body ?? ''), 'and quotes the $120 ask less the 10% fee')
    ok(slabNote.href === '#/inventory', 'and points at the inventory')
  }
} catch (e) {
  fails.push(`threw: ${e instanceof Error ? e.message : String(e)}`)
}

// The copy is left in place: Windows keeps the file open past db.close().
try { db.close() } catch { /* already closed */ }

if (fails.length > 0) {
  console.error(`FAIL — ${fails.length}/${checks} checks failed:`)
  for (const f of fails) console.error(`  • ${f}`)
  process.exit(1)
}
console.log(`PASS — ${checks} checks`)
