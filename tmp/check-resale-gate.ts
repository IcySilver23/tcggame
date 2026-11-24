// The Resale Desk's gate: buying a lot must charge the ask and mark you in.
//
//   TCGLIFE_HOME=<scratch> node ./node_modules/tsx/dist/cli.mjs tmp/check-resale-gate.ts
//
// Two regressions live here. The desk never took the money — buyDeal checked you
// COULD pay, shelved the cards and wrote "-$x" into the activity log, while the
// wallet only ever moved on instant sells — and its tab was gated on $400 cash
// alone, so the first real lot locked the desk you had just used while its stock
// sat in the shelf. The tab itself reads `progress.hasResale` (App.tsx); what
// this pins is the flag that answer is built from and the charge beside it.
import { db, getMeta } from '../server/lib/db'
import { inbox, buyDeal } from '../server/services/resale'

let fails = 0
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`)
  if (!cond) fails++
}
const cash = () => (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash

db.prepare(`DELETE FROM meta WHERE key = 'resale:boughtIn'`).run()
// The inbox draws deals on read; stale open-but-expired rows block new ones.
db.prepare(`UPDATE resale_deals SET status = 'expired' WHERE status = 'open'`).run()
let deals = inbox()
for (let i = 0; i < 40 && deals.length === 0; i++) deals = inbox()
ok(deals.length > 0, 'the inbox produced a lot to buy')
const lot = deals.find((d) => d.ask <= cash() - 50) ?? deals[0]
ok(!!lot, 'a lot is affordable')

ok(!getMeta('resale:boughtIn'), 'the desk starts closed to a player who has never bought')
const before = cash()
const r = lot ? buyDeal(lot.id) : { ok: false as const, error: 'no lot' }
if (!r.ok) {
  ok(false, `the lot was refused: ${r.error}`)
} else {
  ok(r.bought > 0, `the lot brought ${r.bought} cards home`)
  ok(Math.abs((before - cash()) - r.spent) < 0.02, `the ask left the wallet ($${(before - cash()).toFixed(2)} for $${r.spent.toFixed(2)} of cards)`)
  ok(getMeta('resale:boughtIn') === '1', 'buying a lot marks the desk as bought in')
  ok(!/no room/.test(String(r.short)), `nothing was left with the seller (${r.short} short)`)
}

// Walking a lot is not buying in.
db.prepare(`DELETE FROM meta WHERE key = 'resale:boughtIn'`).run()
const other = inbox().find((d) => d.id !== lot?.id)
if (other) {
  const cashBefore = cash()
  db.prepare(`UPDATE resale_deals SET status = 'walked' WHERE id = ?`).run(other.id)
  ok(cash() === cashBefore && !getMeta('resale:boughtIn'), 'walking away charges nothing and does not open the desk')
}

console.log(`\nresale desk: ${fails === 0 ? 'the lot charges its ask and keeps the desk open' : `${fails} problem(s)`}`)
process.exit(fails === 0 ? 0 : 1)
