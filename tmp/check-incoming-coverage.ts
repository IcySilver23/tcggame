// An incoming offer must be one the trader can actually cover.
//
// The tick used to fit a lineup to the pile's worth and top it up with a slice
// of wallet, so a $900 bundle could draw a $98 card plus pocket change — a
// lowball nobody would make. Now the pile is shrunk (priciest extra first)
// until their side reaches 85% of it, and the offer is skipped when even the
// lead card is out of reach. This suite generates real offers, checks the
// coverage rule on every one, and then starves the traders to prove a grail
// never gets asked for by someone who cannot pay for it.
//
//   npx tsx tmp/check-incoming-coverage.ts

import fs from 'node:fs'
import path from 'node:path'

const home = path.resolve('tmp/incomingcoverage-home')
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
// The copied save carries whatever offers the live game had pending (some made
// before this cap existed); start from an empty board so every offer measured
// here was written by the code under test.
db.prepare('DELETE FROM trade_offers').run()

const COVERAGE = 0.85
type Want = { inventoryId: number; cardId: string; name: string; value: number }
type Their = { cardId: string; name: string; value: number }
type Collected = { id: number; trader: number; items: Want[]; their: Their[]; cash: number }

function traderBestCard(traderId: number): number {
  const rows = db.prepare('SELECT card_id, condition FROM trader_cards WHERE trader_id = ?').all(traderId) as { card_id: string; condition: string }[]
  return rows.reduce((a, r) => Math.max(a, market.valueOf(r.card_id, 'normal', (r.condition as market.Condition) || 'NM')), 0)
}

/** Run the trader tick, harvest the pending incoming offers it wrote, clear them. */
function harvest(wanted: number, maxTicks = 6000): Collected[] {
  const out: Collected[] = []
  for (let i = 0; i < maxTicks && out.length < wanted; i++) {
    trading.tradeTick()
    const pending = db.prepare(`SELECT * FROM trade_offers WHERE status = 'pending' AND direction = 'incoming'`).all() as
      | { id: number; trader_id: number; your_items: string; their_cards: string; their_cash: number }[] as never
    const rows = pending as unknown as { id: number; trader_id: number; your_items: string; their_cards: string; their_cash: number }[]
    for (const r of rows) {
      out.push({
        id: r.id,
        trader: r.trader_id,
        items: JSON.parse(r.your_items) as Want[],
        their: JSON.parse(r.their_cards) as Their[],
        cash: r.their_cash,
      })
      db.prepare(`UPDATE trade_offers SET status = 'rejected' WHERE id = ?`).run(r.id)
    }
  }
  return out
}
const bundleValue = (o: Collected) => money(o.items.reduce((a, i) => a + i.value, 0))
const theirSide = (o: Collected) => money(o.their.reduce((a, c) => a + c.value, 0))
const coverage = (o: Collected) => (bundleValue(o) > 0 ? (theirSide(o) + o.cash) / bundleValue(o) : Infinity)

console.log('1. a normal economy: every ask is one they can cover')
const offers = harvest(40)
check('the tick still writes offers', offers.length >= 15, offers.length)
check('bundles still happen (coverage did not flatten every offer to one card)',
  offers.some((o) => o.items.length > 1), offers.map((o) => o.items.length))
const underCovered = offers.filter((o) => coverage(o) < COVERAGE - 0.01)
check('no offer asks for more than 85% of what they can pay',
  underCovered.length === 0,
  underCovered.map((o) => ({ bundle: bundleValue(o), theirs: theirSide(o), cash: o.cash, cover: money(coverage(o)) })))
console.log(`     (coverage range ${Math.min(...offers.map(coverage)).toFixed(2)}–${Math.max(...offers.map(coverage)).toFixed(2)} across ${offers.length} offers)`)

console.log('\n2. a starved market: a trader who cannot pay for a grail never asks for it')
// Every trader keeps one cheap card and no cash; the player's grail stays the
// most expensive card in the binder. Before the cap, the tick would happily fit
// a $98 lineup to a $900 pile and call it an offer.
const grail = (db.prepare(`
  SELECT i.card_id, i.condition, i.variant FROM inventory i
  WHERE i.status = 'collection' AND i.quantity = 1 AND i.graded_grade IS NULL
  ORDER BY (SELECT market FROM price_records pr WHERE pr.card_id = i.card_id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) DESC
  LIMIT 1`).get() as { card_id: string; condition: string; variant: string } | undefined)
const grailValue = grail ? market.valueOf(grail.card_id, grail.variant, (grail.condition as market.Condition) || 'NM') : 0
check('the save has a grail to protect', !!grail && grailValue > 100, grailValue)
db.prepare('UPDATE traders SET cash = 0').run()
const traderIds = (db.prepare('SELECT id FROM traders').all() as { id: number }[]).map((r) => r.id)
for (const id of traderIds) {
  const cards = db.prepare('SELECT id, card_id, condition FROM trader_cards WHERE trader_id = ?').all(id) as { id: number; card_id: string; condition: string }[]
  const priced = cards.map((c) => ({ ...c, value: market.valueOf(c.card_id, 'normal', (c.condition as market.Condition) || 'NM') })).sort((a, b) => a.value - b.value)
  for (const c of priced.slice(1)) db.prepare('DELETE FROM trader_cards WHERE id = ?').run(c.id)
}
const poor = harvest(40)
check('offers still happen for cards they can reach', poor.length >= 5, poor.length)
check('the grail is never asked for by anyone who cannot pay for it',
  poor.every((o) => !o.items.some((i) => i.cardId === grail?.card_id && money(i.value) === money(grailValue))),
  { grailValue, asked: poor.filter((o) => o.items.some((i) => i.cardId === grail?.card_id)).length })
check('coverage holds on every starved offer', poor.every((o) => coverage(o) >= COVERAGE - 0.01),
  poor.map((o) => money(coverage(o))).sort((a, b) => a - b).slice(0, 5))

try { db.close() } catch { /* closed */ }
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass} checks${fail ? `, ${fail} failed` : ''}`)
process.exit(fail === 0 ? 0 : 1)
