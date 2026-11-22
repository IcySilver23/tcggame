// The record chase's honest baseline.
//
// The bug: rips the server opens itself (Inventory → Sealed, a resumed box)
// already write pull_history before the ceremony mounts. The old client read
// /api/pulls/best *after* that open, so the bar it compared against was the
// rip's own record — a bar no pull can clear, and the 👑 NEW BEST PULL moment
// could never fire. The endpoint now takes ?exclude=<session_id>, and the
// ceremony reads the record excluding the session it is revealing.
//
// Checks the endpoint semantics against a copy of the live save, with one
// real pack opened through the same route Inventory uses.
//
//   npx tsx tmp/check-best-pull-baseline.ts

import fs from 'node:fs'
import path from 'node:path'

const home = path.resolve('tmp/bestpull-check-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'server'), { recursive: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
fs.copyFileSync('server/schema.sql', path.join(home, 'server', 'schema.sql'))
for (const suffix of ['', '-wal', '-shm']) {
  const src = path.join('data', `tcglife.db${suffix}`)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(home, 'data', `tcglife.db${suffix}`))
}
process.env.TCGLIFE_HOME = home
const PORT = 8796
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
async function get(p: string): Promise<any> {
  const r = await fetch(base + p)
  return r.json()
}
async function post(p: string, body: unknown): Promise<any> {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return r.json()
}
// The endpoint's two queries, written out again so the route can be held to
// them: the card record and the best single-pack total, both excluding one
// session when one is named.
function expected(exclude = ''): { value: number; bestPackTotal: number } {
  const row = db.prepare(`
    SELECT ph.value FROM pull_history ph
    WHERE ph.owner = 'player' AND ph.session_id <> ?
    ORDER BY ph.value DESC LIMIT 1`).get(exclude) as { value: number } | undefined
  const pack = db.prepare(`
    SELECT SUM(value) AS total FROM pull_history
    WHERE owner = 'player' AND session_id <> ?
    GROUP BY session_id ORDER BY total DESC LIMIT 1`).get(exclude) as { total: number } | undefined
  return { value: row?.value ?? 0, bestPackTotal: pack?.total ?? 0 }
}

for (let i = 0; i < 60; i++) {
  try { await get('/api/pulls/best'); break } catch { await new Promise((r) => setTimeout(r, 100)) }
}

console.log('\n1. the endpoint still answers the record exactly as before')
const best = await get('/api/pulls/best')
const exp = expected()
check('card record matches the SQL record', money(best.value) === money(exp.value), { got: best.value, want: exp.value })
check('pack total matches the SQL pack record', money(best.bestPackTotal) === money(exp.bestPackTotal), { got: best.bestPackTotal, want: exp.bestPackTotal })
check('the record carries the card it names', typeof best.cardId === 'string' && best.value > 0, best)

console.log('\n2. ?exclude= drops exactly one session from both bars')
const sessions = (db.prepare(`SELECT session_id, SUM(value) total FROM pull_history WHERE owner = 'player' GROUP BY session_id`).all() as { session_id: string; total: number }[])
const top = sessions.sort((a, b) => b.total - a.total)[0]
check('the save has sessions to exclude', sessions.length > 1, sessions.length)
const topSessionBest = (db.prepare(`SELECT MAX(value) v FROM pull_history WHERE session_id = ?`).get(top.session_id) as { v: number }).v
const topSessionCard = (db.prepare(`SELECT card_id FROM pull_history WHERE session_id = ? ORDER BY value DESC LIMIT 1`).get(top.session_id) as { card_id: string }).card_id
const exTop = await get(`/api/pulls/best?exclude=${encodeURIComponent(top.session_id)}`)
const expTop = expected(top.session_id)
check('excluding the top session drops its card from the record', money(exTop.value) === money(expTop.value), { got: exTop.value, want: expTop.value })
check('the excluded session\'s own card is not the record any more', exTop.cardId !== topSessionCard, { returned: exTop.cardId, excluded: topSessionCard, value: exTop.value })
check('excluding a session drops its pack total too', money(exTop.bestPackTotal) === money(expTop.bestPackTotal), { got: exTop.bestPackTotal, want: expTop.bestPackTotal })
const bogus = await get('/api/pulls/best?exclude=sess_does_not_exist')
check('an unknown session id changes nothing', money(bogus.value) === money(best.value) && money(bogus.bestPackTotal) === money(best.bestPackTotal))
// Ten sessions in a row, to be sure this is a rule and not one lucky row.
let agree = 0
for (const s of sessions.slice(0, 10)) {
  const got = await get(`/api/pulls/best?exclude=${encodeURIComponent(s.session_id)}`)
  const want = expected(s.session_id)
  if (money(got.value) === money(want.value) && money(got.bestPackTotal) === money(want.bestPackTotal)) agree++
}
check('ten sessions excluded one at a time all match the SQL', agree === Math.min(10, sessions.length), agree)

console.log('\n3. a real rip the server opens itself (the Inventory → Sealed flow)')
const product = db.prepare(`
  SELECT p.id, p.name, p.packs FROM pack_products p WHERE p.packs = 1 ORDER BY p.msrp ASC LIMIT 1
`).get() as { id: string; name: string; packs: number } | undefined
check('a single-pack product to rip', !!product, product)
const preBar = await get('/api/pulls/best')
// Inventory opens SEALED holdings, so buy one first (same as the player: the
// Pack Shop purchase lands sealed, then Inventory rips it).
const bought = await post(`/api/shop/buy/${encodeURIComponent(product!.id)}`, { qty: 1 })
check('the purchase landed in sealed inventory', bought?.ok === true, bought)
const rip = await post('/api/packs/open', { productId: product!.id })
const ripped = Array.isArray(rip?.cards) ? rip.cards as { value: number; cardId: string }[] : []
check('the rip returned cards and a session id', ripped.length > 0 && typeof rip.sessionId === 'string', { n: ripped.length, sessionId: rip?.sessionId })
const ripBest = ripped.reduce((a, c) => Math.max(a, c.value), 0)

const afterPlain = await get('/api/pulls/best')
const afterExcluding = await get(`/api/pulls/best?exclude=${encodeURIComponent(rip.sessionId)}`)
check('the plain read now includes the fresh rip (the old bug)', money(afterPlain.value) >= money(Math.max(preBar.value, ripBest)), { plain: afterPlain.value, pre: preBar.value, rip: ripBest })
check('the excluding read still shows the record BEFORE the rip', money(afterExcluding.value) === money(preBar.value), { got: afterExcluding.value, want: preBar.value })
check('the excluded pack total is the pre-rip bar', money(afterExcluding.bestPackTotal) === money(preBar.bestPackTotal), { got: afterExcluding.bestPackTotal, want: preBar.bestPackTotal })

console.log('\n4. the chase decision the ceremony makes')
// Mirrors PackOpening: bar = max(previousBest, boxRecord); celebrate when
// sessionBest > bar and bar > 0.
const celebrates = (sessionBest: number, bar: number) => bar > 0 && sessionBest > bar
check('old read: a record-beating rip compares against itself and stays silent',
  !celebrates(ripBest, afterPlain.value) || ripBest > afterPlain.value, { ripBest, bar: afterPlain.value })
// A synthetic record-beater against the honest bar: this is the case that was
// dead before. The bar comes from the excluded read, so it cannot contain it.
const honestBar = afterExcluding.value
check('fixed read: a $150 card over a $13 bar celebrates', celebrates(150, honestBar) && honestBar < 150, { honestBar })
check('fixed read: a $1 card under a $13 bar stays silent', !celebrates(1, honestBar), { honestBar })
check('no record yet: nothing celebrates on a bar of 0', !celebrates(500, 0))
check('a tie is not a record', !celebrates(honestBar, honestBar))
// The one real rip, judged the way the ceremony judges it.
const realBar = Math.max(afterExcluding.value, afterExcluding.bestPackTotal ? 0 : 0)
const wouldFire = ripBest > realBar && realBar > 0
check('the real rip is judged against the pre-rip bar, not itself',
  wouldFire === (ripBest > preBar.value), { ripBest, preBar: preBar.value, wouldFire })
console.log(`     (rip best ${money(ripBest).toFixed(2)} vs pre-rip bar ${money(preBar.value).toFixed(2)} → ${wouldFire ? 'crowns' : 'silent'})`)

try { db.close() } catch { /* closed */ }
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass} checks${fail ? `, ${fail} failed` : ''}`)
process.exit(fail === 0 ? 0 : 1)
