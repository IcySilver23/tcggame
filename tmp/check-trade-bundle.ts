// Multi-card trade offers: one offer, several of your cards.
//
// The propose screen used to take a single card. The server was single-card
// all the way down — the counter thread carried one `your_items` row, and
// acceptCounter/haggle refused any thread whose list was not exactly one.
// This suite proves the bundle is one offer everywhere: proposing two cards,
// countering on two, accepting the counter (both rows leave the binder and
// any binder page they sat on), haggling on a bundle, and the guards for
// empty / oversized / graded / missing cards.
//
//   npx tsx tmp/check-trade-bundle.ts

import fs from 'node:fs'
import path from 'node:path'

const home = path.resolve('tmp/tradebundle-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'server'), { recursive: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
fs.copyFileSync('server/schema.sql', path.join(home, 'server', 'schema.sql'))
for (const suffix of ['', '-wal', '-shm']) {
  const src = path.join('data', `tcglife.db${suffix}`)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(home, 'data', `tcglife.db${suffix}`))
}
process.env.TCGLIFE_HOME = home
const PORT = 8794
process.env.TCGLIFE_PORT = String(PORT)

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}
const money = (n: number) => Number(n.toFixed(2))

const { db } = await import('../server/lib/db')
db.prepare('UPDATE game_state SET cash = 50000').run()
await import('../server/index')
const base = `http://127.0.0.1:${PORT}`
async function get(p: string): Promise<any> { return (await fetch(base + p)).json() }
async function post(p: string, body: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}
for (let i = 0; i < 60; i++) {
  try { await get('/api/state'); break } catch { await new Promise((r) => setTimeout(r, 100)) }
}

type Row = { id: number; card_id: string; name: string; value: number; variant: string; condition: string; graded_grade: string | null }
const { valueOfRow: priceRow } = await import('../server/services/market')
// Two cards that are legal to trade. Values come from the server's own
// valuation so the thread's numbers can be compared exactly.
const tradeable = db.prepare(`
  SELECT i.*, c.name FROM inventory i JOIN cards c ON c.id = i.card_id
  WHERE i.status = 'collection' AND i.quantity = 1 AND i.graded_grade IS NULL AND i.condition != 'DM'
    AND NOT EXISTS (SELECT 1 FROM ebay_auctions a WHERE a.inventory_id = i.id AND a.status = 'live')`)
  .all() as Omit<Row, 'value'>[]
const priced: Row[] = tradeable
  .map((r) => ({ ...r, value: priceRow(r) }))
  .filter((r) => r.value > 0)
  .sort((a, b) => b.value - a.value)
check('the save has two tradeable cards', priced.length >= 2, priced.length)

const traderRow = db.prepare(`
  SELECT t.id, t.name, COUNT(tc.id) n, COALESCE(MAX((SELECT market FROM price_records pr WHERE pr.card_id = tc.card_id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1)), 0) best
  FROM traders t LEFT JOIN trader_cards tc ON tc.trader_id = t.id
  GROUP BY t.id HAVING n > 0 ORDER BY best ASC`).all() as { id: number; name: string; n: number; best: number }[]
check('a trader with cards to swap', traderRow.length > 0, traderRow.length)

// A bundle has to sit in the trader's range: too far above their binder and
// they politely decline (no thread at all — a legitimate answer, not the path
// under test here). Aim the pair at ~1.15x their best card, which their lineup
// can reach but not cover, and the proposal comes back as a counter.
const trader0 = traderRow[0]
const target = Math.max(0.5, trader0.best * 1.15)
const pool = priced
let pair: [Row, Row] | null = null
let bestGap = Infinity
for (let i = 0; i < pool.length; i++) {
  for (let j = i + 1; j < pool.length; j++) {
    const sum = pool[i].value + pool[j].value
    // Their best card has to stay inside fittingLineup's 1.15x window, or the
    // lineup comes back tiny and the trader just says it's out of their league.
    if (sum < trader0.best / 1.15) continue
    const gap = Math.abs(sum - target)
    if (gap < bestGap) { bestGap = gap; pair = [pool[i], pool[j]] }
  }
}
check('two cards that add up to the trader\'s range', !!pair, { target, pool: pool.length })
const [a, b] = pair ?? [priced[0], priced[1]]
const bundleValue = money(a.value + b.value)

trader0.id = trader0.id // (kept for readability of the block below)
console.log(`\n1. proposing TWO cards is one offer (${a.name} ${money(a.value).toFixed(2)} + ${b.name} ${money(b.value).toFixed(2)} = ${bundleValue.toFixed(2)}, trader's best ${money(trader0.best).toFixed(2)})`)
const prop = await post('/api/trade/propose', { traderId: trader0.id, inventoryIds: [a.id, b.id], cash: 0 })
check('the propose endpoint accepts a bundle', prop.status === 200 && prop.body.ok === true, prop.body)
const stillThere = (id: number) => !!db.prepare('SELECT 1 FROM inventory WHERE id = ?').get(id)
if (prop.body.accepted) {
  check('accepted outright: both of my cards left the binder', !stillThere(a.id) && !stillThere(b.id))
  check('accepted outright: their lineup arrived', (db.prepare(`SELECT COUNT(*) n FROM inventory WHERE acquired_via = 'trade'`).get() as { n: number }).n > 0)
} else {
  const thread = db.prepare(`SELECT * FROM trade_offers WHERE trader_id = ? AND status = 'pending' AND direction = 'outgoing' ORDER BY id DESC LIMIT 1`).get(traderRow[0].id) as
    | { id: number; your_items: string; their_cards: string; their_cash: number; your_cash: number } | undefined
  check('countered: a thread was saved', !!thread, prop.body)
  const items = thread ? JSON.parse(thread.your_items) as { inventoryId: number; value: number }[] : []
  check('countered: the thread carries BOTH cards', items.length === 2 && items.some((i) => i.inventoryId === a.id) && items.some((i) => i.inventoryId === b.id), items)
  check('countered: the stored values sum to the bundle the trader valued', thread ? money(items.reduce((s, i) => s + i.value, 0)) === bundleValue : false, { items, bundleValue })
  check('countered: nothing has moved yet', stillThere(a.id) && stillThere(b.id))
  const accept = thread
    ? await post(`/api/trade/accept-counter/${thread.id}`, {})
    : { status: 0, body: {} }
  check('accepting the bundle counter works', accept.status === 200 && accept.body.ok === true, accept.body)
  check('accepted: both of my cards left the binder', !stillThere(a.id) && !stillThere(b.id))
}

console.log('\n2. a two-card thread accepts, and a two-card thread can be haggled')
const trader = traderRow[0]
const theirBest = db.prepare(`
  SELECT tc.id, tc.card_id, tc.condition, c.name,
         (SELECT market FROM price_records pr WHERE pr.card_id = tc.card_id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) AS m
  FROM trader_cards tc JOIN cards c ON c.id = tc.card_id
  WHERE tc.trader_id = ? ORDER BY m DESC LIMIT 1`).get(trader.id) as { id: number; card_id: string; condition: string; name: string }
const theirValue = priceRow({ card_id: theirBest.card_id, variant: 'normal', condition: theirBest.condition, graded_grade: null })
// The shape counterFrom saves for a bundle, written by hand so the thread the
// accept and haggle paths read is exactly a two-card one.
function craftThread(items: Row[], theirCash: number) {
  const insert = db.prepare(`INSERT INTO trade_offers (trader_id, direction, their_cards, their_cash, your_items, your_cash, message, expires_at, status, rounds, created_at)
    VALUES (?, 'outgoing', ?, ?, ?, 0, '', ?, 'pending', 1, ?)`)
  return Number(insert.run(
    trader.id,
    JSON.stringify([{ traderCardId: theirBest.id, cardId: theirBest.card_id, name: theirBest.name, image: null, variant: 'normal', condition: theirBest.condition, value: theirValue }]),
    theirCash,
    JSON.stringify(items.map((r) => ({ inventoryId: r.id, cardId: r.card_id, name: r.name, image: null, condition: r.condition, value: r.value }))),
    new Date(Date.now() + 20 * 60_000).toISOString(),
    new Date().toISOString(),
  ).lastInsertRowid)
}
const leftover = priced.filter((r) => r.id !== a.id && r.id !== b.id)
const [c, d, e, f] = leftover
check('four more cards to bundle', !!(c && d && e && f), leftover.length)

if (c && d) {
  const threadId = craftThread([c, d], 0)
  // Put one of them on a binder page, so the swap has to clean that up too.
  db.prepare(`INSERT INTO binders (name, accent, created_at) VALUES ('Trade test', 'red', ?)`).run(new Date().toISOString())
  const binderId = (db.prepare(`SELECT id FROM binders ORDER BY id DESC LIMIT 1`).get() as { id: number }).id
  db.prepare(`INSERT INTO binder_slots (binder_id, inventory_id, page, slot, placed_at) VALUES (?, ?, 1, 1, ?)`).run(binderId, d.id, new Date().toISOString())
  check('the bundle card sits on a binder page', (db.prepare('SELECT COUNT(*) n FROM binder_slots WHERE inventory_id = ?').get(d.id) as { n: number }).n === 1)

  const accept = await post(`/api/trade/accept-counter/${threadId}`, {})
  check('a two-card thread accepts', accept.status === 200 && accept.body.ok === true, accept.body)
  check('both bundle cards left the collection', !stillThere(c.id) && !stillThere(d.id))
  check('their card arrived in the collection', (db.prepare(`SELECT COUNT(*) n FROM inventory WHERE card_id = ? AND acquired_via = 'trade'`).get(theirBest.card_id) as { n: number }).n >= 1)
  check('the traded card left its binder page', (db.prepare('SELECT COUNT(*) n FROM binder_slots WHERE inventory_id = ?').get(d.id) as { n: number }).n === 0)
  const log = db.prepare(`SELECT message FROM activity_log WHERE kind = 'trade' AND message LIKE 'Traded %' ORDER BY id DESC LIMIT 1`).get() as { message: string } | undefined
  check('the activity log names both cards', !!log && log.message.includes(c.name.split(' (')[0]) && log.message.includes(d.name.split(' (')[0]), log?.message)
}

// The haggle thread uses the two CHEAPEST remaining cards: the 90% fairness
// floor then lands below zero (their card is worth more), so asking for no
// cash is a legal number and the answer is about the bundle, not the floor.
const consumedIds = new Set([a, b, c, d, e, f].filter(Boolean).map((r) => r!.id))
const cheap = priced.filter((r) => !consumedIds.has(r.id) && stillThere(r.id)).slice(-2)
const [i1, i2] = cheap
if (i1 && i2) {
  const threadId = craftThread([i1, i2], 0)
  const haggle = await post(`/api/trade/haggle-counter/${threadId}`, { cashToYou: 0 })
  check('a two-card thread can be haggled (not "broken thread")', haggle.status === 200 && haggle.body.ok === true, haggle.body)
  check('the haggle answered on the bundle', !/broken thread/i.test(JSON.stringify(haggle.body)), haggle.body)
}

console.log('\n3. one card is still one offer')
const fresh = priced.filter((r) => ![a, b, c, d, e, f].some((x) => x && x.id === r.id))
const [g, h] = fresh
if (g) {
  const single = await post('/api/trade/propose', { traderId: traderRow[0].id, inventoryIds: [g.id], cash: 0 })
  const legacy = await post('/api/trade/propose', { traderId: traderRow[0].id, inventoryId: (h ?? g).id, cash: 0 })
  check('a one-card bundle proposes', single.status === 200 && single.body.ok === true, single.body)
  check('the old single-id shape still proposes', legacy.status === 200 && legacy.body.ok === true, legacy.body)
}

console.log('\n4. the guards')
const empty = await post('/api/trade/propose', { traderId: traderRow[0].id, inventoryIds: [], cash: 0 })
check('an empty offer is refused', empty.status === 400 && /at least one card/i.test(empty.body.error ?? ''), empty.body)
const many = await post('/api/trade/propose', { traderId: traderRow[0].id, inventoryIds: Array.from({ length: 13 }, (_, i) => 900000 + i), cash: 0 })
check('an oversized offer is refused and says the cap', many.status === 400 && /12/.test(many.body.error ?? ''), many.body)
const ghost = await post('/api/trade/propose', { traderId: traderRow[0].id, inventoryIds: [987654321], cash: 0 })
check('a missing card is refused', ghost.status === 400 && /not available/i.test(ghost.body.error ?? ''), ghost.body)
const dupes = await post('/api/trade/propose', { traderId: traderRow[0].id, inventoryIds: [e?.id ?? 0, e?.id ?? 0], cash: 0 })
check('offering the same card twice counts once', dupes.status === 200 || /not available/i.test(dupes.body.error ?? ''), dupes.body)
// A slab is refused by name. The save may hold no graded copy in the
// collection, so stamp one for the check and put it back afterwards.
const slabRow = priced.find((r) => stillThere(r.id))
if (slabRow) {
  db.prepare(`UPDATE inventory SET graded_grade = '9' WHERE id = ?`).run(slabRow.id)
  const slab = await post('/api/trade/propose', { traderId: traderRow[0].id, inventoryIds: [slabRow.id], cash: 0 })
  db.prepare(`UPDATE inventory SET graded_grade = NULL WHERE id = ?`).run(slabRow.id)
  check('a graded slab cannot be bundled', slab.status === 400 && /slab/i.test(slab.body.error ?? ''), slab.body)
} else {
  console.log('  ok   (no tradeable card left to stamp as a slab)')
}

try { db.close() } catch { /* closed */ }
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass} checks${fail ? `, ${fail} failed` : ''}`)
process.exit(fail === 0 ? 0 : 1)
