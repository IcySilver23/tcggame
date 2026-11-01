const D = require('better-sqlite3')
const db = new D('data/tcglife.db')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const rar = db.prepare("SELECT id, rarity FROM cards WHERE id IN ('me55-R','me55-G','me55-B')").all()
console.log('rarities:', JSON.stringify(rar))
console.log('slots:', JSON.stringify(db.prepare("SELECT slot, COUNT(*) n FROM pack_product_cards WHERE pack_product_id='me55-booster' GROUP BY slot").all()))

const curated = db
  .prepare(
    `SELECT c.id, c.name, s.name AS setname FROM cards c JOIN sets s ON s.id = c.set_id
     WHERE c.id IN ('me55-R','me55-G','me55-B','dpp-DP25','dpp-DP54','dpp-DP55','bwp-BW77','bwp-BW78',
                    'me4-84','me4-86','me4-77','me4-107','ecard2-103','xy8-146a','xy9-98a')`,
  )
  .all()

const priceOf = (id) =>
  (db.prepare("SELECT market FROM price_records WHERE card_id=? AND market IS NOT NULL ORDER BY retrieved_at DESC, id DESC LIMIT 1").get(id) || {}).market

console.log('\n--- before regeneration ---')
for (const c of curated) console.log(`  ${c.id.padEnd(16)} $${priceOf(c.id)}`)

// Force the sim pass to re-derive every quote from the new anchors.
db.prepare("DELETE FROM price_records WHERE kind='simulated'").run()
db.prepare("DELETE FROM meta WHERE key='lastSimMarketDay'").run()
db.prepare("UPDATE game_state SET last_tick_at='2020-01-01T00:00:00.000Z' WHERE id=1").run()

;(async () => {
  const res = await fetch('http://localhost:8787/api/state')
  console.log('\nGET /api/state ->', res.status)
  await sleep(6000)
  console.log('--- after regeneration ---')
  for (const c of curated) console.log(`  ${c.id.padEnd(16)} $${priceOf(c.id)}  (${c.name}, ${c.setname})`)
  const sims = db.prepare("SELECT COUNT(*) n FROM price_records WHERE kind='simulated'").get().n
  console.log('total simulated rows:', sims)
  process.exit(0)
})()
