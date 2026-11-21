// Pins the three General Mills mini packs: what they hold, that the Sequin copy
// is what they hand out, and that the shop prices them like a three-card pack
// rather than a display. Runs against a COPY of the save under tmp/gm-home, so
// the roll may write pull_history freely.
//
//   node ./node_modules/.bin/tsx tmp/check-gmpacks.ts

import fs from 'node:fs'
import path from 'node:path'
import { MINI_PACKS } from '../server/catalog/general-mills'
import { SEQUIN_PRINTINGS, SEQUIN_PRODUCTS, SEQUIN_VARIANT } from '../src/foil/printing-db'

let checks = 0
const fails: string[] = []
function ok(cond: unknown, label: string) {
  checks++
  if (!cond) fails.push(label)
}
function eq<T>(got: T, want: T, label: string) {
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`)
}

const sequinByProduct = (product: string) => SEQUIN_PRINTINGS.filter((p) => p.product === product).map((p) => p.cardId)

// ---------------------------------------------------------------------------
// 1. Composition — the three products partition the 19 named Sequin printings
// ---------------------------------------------------------------------------

eq(MINI_PACKS.length, 3, 'three mini-pack products')

const seen = new Set<string>()
for (const def of MINI_PACKS) {
  const sequinEntries = def.slots.flatMap((s) => s.entries).filter((e) => e.variant === SEQUIN_VARIANT)
  const want =
    def.id === 'gm-25th-mini'
      ? sequinByProduct(SEQUIN_PRODUCTS.anniversary)
      : def.id === 'gm-letsgo-mini'
        ? sequinByProduct(SEQUIN_PRODUCTS.letsGo)
        : sequinByProduct(SEQUIN_PRODUCTS.sunMoon)
  const got = sequinEntries.map((e) => e.cardId).sort()
  eq(JSON.stringify(got), JSON.stringify([...want].sort()), `${def.id}: Sequin pool is the sourced list`)
  for (const id of got) {
    ok(!seen.has(id), `${def.id}: ${id} belongs to exactly one product`)
    seen.add(id)
    ok(SEQUIN_PRINTINGS.some((p) => p.cardId === id), `${def.id}: ${id} is a catalogued Sequin printing`)
  }
  // Every slot is a real number of cards, and the pack is three of them.
  eq(def.slots.reduce((a, s) => a + s.count, 0), 3, `${def.id}: three cards per pack`)
  for (const s of def.slots) ok(s.entries.length > 0 || s.hostFill === true, `${def.id}/${s.slot}: has a pool`)
  eq(def.setId.length > 0, true, `${def.id}: names a host expansion`)
}
eq(seen.size, 19, 'all 19 Sequin printings are dispensed by the three products')

// The 25th pack guarantees the stamped Pikachu, in its own slot.
const twenty = MINI_PACKS.find((d) => d.id === 'gm-25th-mini')!
const guaranteed = twenty.slots.filter((s) => s.entries.some((e) => e.cardId === 'swshp-SWSH039'))
eq(guaranteed.length, 1, '25th: exactly one slot holds the guaranteed Pikachu')
eq(guaranteed[0].count, 1, '25th: the guaranteed Pikachu is one card')
eq(guaranteed[0].entries.length, 1, '25th: that slot holds nothing else')
eq(guaranteed[0].entries[0].variant, SEQUIN_VARIANT, '25th: the guaranteed Pikachu is the Sequin printing')

// The two Rebel Clash reprints are declared absent, not silently dropped.
for (const a of twenty.absent ?? []) {
  ok(!twenty.slots.some((s) => s.entries.some((e) => e.cardId === a.cardId)), `25th: ${a.cardId} is absent, not in a pool`)
  ok(a.why.length > 0, `25th: ${a.cardId} says why it is absent`)
}

// ---------------------------------------------------------------------------
// 2. Against a COPY of the save: seeding, pricing, rolling
// ---------------------------------------------------------------------------

const home = path.resolve('tmp/gm-home')
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
const gm = await import('../server/services/gmpacks')
const sealed = await import('../server/services/sealed')

const seeded = gm.ensureMiniPacks()
eq(seeded, 3, 'seeding touches the three products')
eq(gm.ensureMiniPacks(), 3, 'seeding is idempotent')
const rows = db.prepare(`SELECT id, kind, packs, cards_per_pack, msrp FROM pack_products WHERE id LIKE 'gm-%' ORDER BY id`).all() as {
  id: string
  kind: string
  packs: number
  cards_per_pack: number
  msrp: number
}[]
eq(rows.length, 3, 'three product rows in the catalog')
for (const r of rows) {
  const def = MINI_PACKS.find((d) => d.id === r.id)!
  eq(r.kind, 'special', `${r.id}: kind`)
  eq(r.packs, 1, `${r.id}: one pack`)
  eq(r.cards_per_pack, 3, `${r.id}: three cards`)
  eq(r.msrp, def.msrp, `${r.id}: msrp is the pack's own price`)
  // The shop must charge the pack's price, not the display formula (~$90).
  eq(sealed.priceOf(r.id).market, def.msrp, `${r.id}: priced at the shelf price`)
  ok(sealed.priceOf(r.id).market < 20, `${r.id}: not priced like a box`)
}

// A roll is three cards, includes the Sequin printing, and never hands back the
// plain promo of the same number.
for (const def of MINI_PACKS) {
  const sequinPool = new Set(
    def.slots.flatMap((s) => s.entries).filter((e) => e.variant === SEQUIN_VARIANT).map((e) => e.cardId),
  )
  for (let i = 0; i < 60; i++) {
    const pull = gm.rollMiniPack(def.id, `gmcheck_${def.id}_${i}`)
    ok(pull !== null, `${def.id}: rolls`)
    if (!pull) continue
    eq(pull.length, 3, `${def.id}: three cards`)
    const sequin = pull.filter((c) => c.variant === SEQUIN_VARIANT)
    ok(sequin.length >= 1, `${def.id}: always holds a Sequin card`)
    for (const c of sequin) ok(sequinPool.has(c.cardId), `${def.id}: ${c.cardId} is in the sourced Sequin pool`)
    for (const c of pull) {
      ok(c.variant === SEQUIN_VARIANT || c.variant === 'normal', `${def.id}: variant ${c.variant} is modelled`)
      ok(c.value >= 0, `${def.id}: ${c.cardId} has a value`)
    }
    if (def.id === 'gm-25th-mini') {
      ok(pull.some((c) => c.cardId === 'swshp-SWSH039' && c.variant === SEQUIN_VARIANT), '25th: Pikachu in every pack')
    }
  }
}

const stored = db
  .prepare(`SELECT card_id, variant, value FROM pull_history WHERE pack_product_id = ?`)
  .all('gm-sunmoon-mini') as { card_id: string; variant: string; value: number }[]
ok(stored.length > 0, 'rolls are written to pull_history under the product id')
ok(
  stored.every((r) => r.variant === SEQUIN_VARIANT || r.variant === 'normal'),
  'no invented variant reaches the pull log',
)

// The Sequin rows are real inventory identity, so they must survive a write.
const card = stored.find((r) => r.variant === SEQUIN_VARIANT)!
db.prepare(
  `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
   VALUES (?, ?, 'NM', 1, 'collection', 'pack', 1, datetime('now'))`,
).run(card.card_id, card.variant)
const held = db.prepare(`SELECT COUNT(*) AS n FROM inventory WHERE variant = ?`).get(SEQUIN_VARIANT) as { n: number }
ok(held.n >= 1, 'a Sequin pull banks as its own inventory row')

// Anything that is not a mini pack falls straight through to the booster roll.
eq(gm.rollMiniPack('sm1-booster', 'gmcheck_not_a_mini'), null, 'a booster id is not a mini pack')
eq(gm.rollMiniPack('gm-check-missing', 'gmcheck_missing'), null, 'an unknown id is not a mini pack')

// The real path: buy and rip through the sealed-product functions the shop uses.
const packsSvc = await import('../server/services/packs')
const cashOf = () => (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
const before = Math.round(cashOf() * 100) / 100
packsSvc.buySealed('gm-letsgo-mini', 1)
const after = Math.round(cashOf() * 100) / 100
const letsGoMsrp = MINI_PACKS.find((d) => d.id === 'gm-letsgo-mini')!.msrp
eq(Math.round((before - after) * 100) / 100, letsGoMsrp, 'buying a mini pack charges the shelf price')
const opened = packsSvc.openSealed('gm-letsgo-mini')
eq(opened.cards.length, 3, 'opening the product hands over three cards')
eq(opened.packsInBox, 1, 'the mini pack is one pack')
eq(opened.spent, letsGoMsrp, 'the rip is costed at the shelf price')
ok(opened.cards.some((c) => c.variant === SEQUIN_VARIANT), 'the opened pack holds a Sequin card')
ok(opened.cards.every((c) => c.variant === SEQUIN_VARIANT || c.variant === 'normal'), 'the opened pack invents no variant')

// The box path opens one wrapper at a time — it must reach the same mini roll.
packsSvc.buySealed('gm-25th-mini', 1)
const box = packsSvc.beginBox('gm-25th-mini')
eq(box.cards.length, 3, 'the box path opens three cards')
eq(box.packsTotal, 1, 'the mini pack is a one-pack box')
ok(box.cards.some((c) => c.cardId === 'swshp-SWSH039' && c.variant === SEQUIN_VARIANT), 'the box path hands over the guaranteed Sequin Pikachu')
eq(box.done, true, 'one rip empties the mini pack')

// The shop's ESTIMATE line runs over 3 cards, not a 10-card booster.
const est = gm.estimateMiniPack('gm-sunmoon-mini')
ok(est.avg > 0, 'mini-pack estimate has an average')
ok(est.p50 > 0 && est.p90 >= est.p50, 'mini-pack estimate has a median and a p90')
ok(est.topChases.length > 0, 'mini-pack estimate names a chase')
eq(gm.estimateMiniPack('sm1-booster').avg, 0, 'a booster id gets no mini-pack estimate')

// ---------------------------------------------------------------------------
for (const f of fails) console.error('FAIL', f)
console.log(`${checks - fails.length}/${checks} checks passed`)

// Close the handle before removing the copy — Windows keeps a WAL file locked.
try {
  db.close()
  fs.rmSync(home, { recursive: true, force: true })
} catch { /* a locked temp file is not a check failure */ }
if (fails.length > 0) process.exit(1)
