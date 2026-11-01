const D = require('better-sqlite3')
const db = new D('data/tcglife.db')
const KEYS = ['lastPriceSnapshotDay', 'lastSimMarketDay', 'lastOwnedPriceRefreshDay', 'lastOwnedRefreshFailAt']

const meta = (k) => (db.prepare('SELECT value FROM meta WHERE key = ?').get(k) || {}).value ?? null
const setMeta = (k, v) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v)
const stamps = () => db.prepare('SELECT COUNT(DISTINCT retrieved_at) AS n, MAX(retrieved_at) AS last FROM price_records').get()
const rowsAt = (t) => db.prepare('SELECT COUNT(*) AS n FROM price_records WHERE retrieved_at = ?').get(t).n

function report(label) {
  const s = stamps()
  console.log(`\n[${label}]` + KEYS.map((k) => `  ${k} = ${meta(k)}`).join(''))
  console.log(`  price_records: ${s.n} distinct stamps, newest ${s.last} (${rowsAt(s.last)} rows)`)
}

report('before')
// Pretend the clock just rolled over: yesterday's keys, stale tick.
setMeta('lastPriceSnapshotDay', '2026-10-31-pm')
setMeta('lastSimMarketDay', '2026-10-31-pm')
setMeta('lastOwnedPriceRefreshDay', '2026-10-31-pm')
db.prepare("UPDATE game_state SET last_tick_at = '2020-01-01T00:00:00.000Z' WHERE id = 1").run()
console.log('\nsimulated new game day -> day keys set to 2026-10-31-pm, tick forced')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const res = await fetch('http://localhost:8787/api/state')
  console.log('GET /api/state ->', res.status)
  await sleep(12_000)
  report('after tick')
  process.exit(0)
})()
