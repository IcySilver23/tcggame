const D = require('better-sqlite3')
const db = new D('data/tcglife.db')
const phase = process.argv[2] || 'pre'
const KEYS = ['lastPriceSnapshotDay', 'lastSimMarketDay', 'lastOwnedPriceRefreshDay', 'lastOwnedRefreshFailAt']

function meta(key) {
  const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
  return r ? r.value : null
}

const historyTable = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%histor%' OR name LIKE '%snapshot%')")
  .all()
  .map((r) => r.name)

if (phase === 'pre') {
  console.log('history tables:', historyTable.join(',') || 'none')
  for (const k of KEYS) db.prepare('DELETE FROM meta WHERE key = ?').run(k)
  db.prepare("UPDATE game_state SET last_tick_at = '2020-01-01T00:00:00.000Z' WHERE id = 1").run()
  console.log('cleared day keys; tick forced')
  for (const t of historyTable) {
    try {
      console.log('count', t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n)
    } catch { /* not a row-countable table */ }
  }
} else {
  for (const k of KEYS) console.log(k, '=', meta(k))
  for (const t of historyTable) {
    try {
      console.log('count', t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n)
    } catch { /* ignore */ }
  }
  const act = db.prepare("SELECT message FROM activity_log WHERE kind = 'market' ORDER BY id DESC LIMIT 3").all()
  console.log('recent market activity:', JSON.stringify(act))
}
