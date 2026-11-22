// Incoming offers can ask for a bundle of your cards, not just one.
//
// The trader tick used to pick a single card, price the whole offer from it and
// save a one-item thread. Now it can want two or three, valued as one deal, and
// the offers screen lists every card named. This suite generates real incoming
// offers on a save copy, proves the bundle shape and per-card values, then
// accepts a multi-card offer and checks every named card actually left — and
// that the pending feed (what the Offers tab renders) carries them all.
//
//   npx tsx tmp/check-incoming-bundle.ts

import fs from 'node:fs'
import path from 'node:path'

const home = path.resolve('tmp/incomingbundle-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'server'), { recursive: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
fs.copyFileSync('server/schema.sql', path.join(home, 'server', 'schema.sql'))
for (const suffix of ['', '-wal', '-shm']) {
  const src = path.join('data', `tcglife.db${suffix}`)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(home, 'data', `tcglife.db${suffix}`))
}
process.env.TCGLIFE_HOME = home

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}
const money = (n: number) => Number(n.toFixed(2))

const { db } = await import('../server/lib/db')
const market = await import('../server/services/market')
const trading = await import('../server/services/trading')

type Want = { inventoryId: number; cardId: string; name: string; condition: string; value: number }
type Offer = { id: number; their_cards: string; their_cash: number; your_items: string; trader_id: number; your_cash: number }

// Collect incoming offers. The tick caps pending incoming at three, so each
// batch is harvested and cleared; the first multi-card offer is kept so it can
// be accepted at the end.
const generated: { items: Want[]; their: { name: string; value: number }[]; cash: number }[] = []
let multi: { id: number; items: Want[]; trader: number } | null = null
let ticks = 0
for (; ticks < 3000 && generated.length < 60; ticks++) {
  trading.tradeTick()
  const pending = db.prepare(`SELECT * FROM trade_offers WHERE status = 'pending' AND direction = 'incoming'`).all() as Offer[]
  for (const o of pending) {
    // The kept multi-card offer stays pending for the accept test; harvesting
    // it again would count it twice and (in the else branch) reject it.
    if (multi && o.id === multi.id) continue
    const items = JSON.parse(o.your_items) as Want[]
    generated.push({ items, their: JSON.parse(o.their_cards) as { name: string; value: number }[], cash: o.their_cash })
    if (items.length > 1 && !multi && items.every((i) => !!db.prepare('SELECT 1 FROM inventory WHERE id = ? AND status = ?').get(i.inventoryId, 'collection'))) {
      multi = { id: o.id, items, trader: o.trader_id }
    } else {
      db.prepare(`UPDATE trade_offers SET status = 'rejected' WHERE id = ?`).run(o.id)
    }
  }
  if (multi && generated.length >= 30) break
}
console.log(`\n(looked at ${generated.length} incoming offers over ${ticks} ticks)`)

check('the tick writes incoming offers', generated.length >= 10, generated.length)
const bundles = generated.filter((o) => o.items.length > 1)
check('some offers ask for more than one card', bundles.length >= 1, { bundles: bundles.length, of: generated.length })
check('single-card offers still happen', generated.some((o) => o.items.length === 1), generated.filter((o) => o.items.length === 1).length)
check('no offer asks for more than three', generated.every((o) => o.items.length <= 3), generated.map((o) => o.items.length))
check('an offer never names the same card twice', generated.every((o) => new Set(o.items.map((i) => i.inventoryId)).size === o.items.length))

console.log('\n1. a bundle is priced as one deal, card by card')
let valueChecks = 0
let valueOk = 0
for (const o of bundles) {
  for (const item of o.items) {
    const row = db.prepare('SELECT card_id, variant, condition, graded_grade FROM inventory WHERE id = ?').get(item.inventoryId) as
      | { card_id: string; variant: string; condition: string; graded_grade: string | null } | undefined
    if (!row) continue
    valueChecks++
    const want = money(market.valueOf(row.card_id, row.variant, (row.condition as market.Condition) || 'NM'))
    if (money(item.value) === want && item.cardId === row.card_id) valueOk++
  }
}
check('every wanted card carries its own market value', valueChecks > 0 && valueOk === valueChecks, { valueOk, valueChecks })
check('their side of a bundle is real and priced off the bundle',
  bundles.every((o) => {
    const theirSide = o.their.reduce((a, c) => a + c.value, 0)
    const bundleValue = o.items.reduce((a, i) => a + i.value, 0)
    return theirSide > 0 && theirSide + o.cash >= bundleValue * 0.3
  }),
  bundles.map((o) => ({ their: money(o.their.reduce((a, c) => a + c.value, 0)), mine: money(o.items.reduce((a, i) => a + i.value, 0)), cash: o.cash })))

console.log('\n2. the offers feed carries every card it wants')
if (multi) {
  const feed = trading.pendingOffers().find((o) => (o as { id: number }).id === multi!.id) as
    | { your_items: Want[]; haggle?: { min: number; current: number } } | undefined
  check('the pending offer is in the feed', !!feed, !!multi)
  check('the feed lists all wanted cards', !!feed && feed.your_items.length === multi.items.length, feed?.your_items?.length)
  check('the feed can haggle the bundle (bounds present)', !!feed?.haggle, feed?.haggle)

  console.log('\n3. accepting the bundle takes every named card')
  const before = multi.items.map((i) => i.inventoryId)
  const theirCardIds = (db.prepare('SELECT their_cards FROM trade_offers WHERE id = ?').get(multi.id) as { their_cards: string }).their_cards
  const theirIds = (JSON.parse(theirCardIds) as { cardId: string }[]).map((c) => c.cardId)
  const res = trading.acceptIncoming(multi.id)
  check('the bundle offer accepts', res.ok === true, res)
  check('every wanted card left the collection', before.every((id) => !db.prepare('SELECT 1 FROM inventory WHERE id = ?').get(id)))
  check('their side arrived', theirIds.every((cid) => !!db.prepare(`SELECT 1 FROM inventory WHERE card_id = ? AND acquired_via = 'trade'`).get(cid)))
  const log = db.prepare(`SELECT message FROM activity_log WHERE kind = 'trade' AND message LIKE 'Traded %' ORDER BY id DESC LIMIT 1`).get() as { message: string } | undefined
  check('the activity log names every traded-away card',
    !!log && multi.items.every((i) => log.message.includes(i.name)),
    { log: log?.message, wanted: multi.items.map((i) => i.name) })
  check('the offer is no longer pending', !db.prepare(`SELECT 1 FROM trade_offers WHERE id = ? AND status = 'pending'`).get(multi.id))
} else {
  check('an incoming bundle was generated to accept', false)
}

try { db.close() } catch { /* closed */ }
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass} checks${fail ? `, ${fail} failed` : ''}`)
process.exit(fail === 0 ? 0 : 1)
