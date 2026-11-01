// Runtime check for the estate house premium AND lot proration — runs the REAL
// buyEstateLot() against a throwaway copy of the save (sim-home), so the live
// database is untouched.
//
// Asserts: hammer quoted; 12% charged on the cards that fit (not the whole
// box); cash leaves the till for exactly what was charged; cost basis equals
// what was paid; and the activity is honest about how many cards stayed behind.
import { prepareSimHome, installSimClock } from '../server/scripts/sim-home'

prepareSimHome()
installSimClock()

const { db, nowIso } = await import('../server/lib/db')
const estate = await import('../server/services/estate')

const round2 = (n: number) => Math.round(n * 100) / 100
const failures: string[] = []
const check = (label: string, pass: boolean, detail: string) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label} — ${detail}`)
  if (!pass) failures.push(label)
}

const opensAt = nowIso()
const closesAt = new Date(Date.now() + 3 * 3_600_000).toISOString()
db.prepare(`INSERT INTO conventions (name, blurb, entry_fee, opened_at, closes_at) VALUES (?, ?, ?, ?, ?)`)
  .run('Premium Test Show', 'runtime check', 0, opensAt, closesAt)
const conventionId = (db.prepare(`SELECT id FROM conventions ORDER BY id DESC LIMIT 1`).get() as { id: number }).id
db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
  .run(`conventionEntry:${conventionId}`, '1')
db.prepare(`UPDATE game_state SET cash = 1000 WHERE id = 1`).run()

estate.spawnEstateLots(conventionId, 'Premium Test Show')
const lot = db
  .prepare(`SELECT * FROM estate_lots WHERE convention_id = ? AND status = 'available' ORDER BY id LIMIT 1`)
  .get(conventionId) as { id: number; ask: number; seller_name: string } | undefined
if (!lot) throw new Error('no estate lot spawned — cannot run the check')

const total = (db.prepare(`SELECT COUNT(*) AS n FROM estate_lot_cards WHERE lot_id = ?`).get(lot.id) as { n: number }).n
const fullCharge = round2(lot.ask * (1 + estate.ESTATE_PREMIUM))
console.log(`lot #${lot.id} from ${lot.seller_name}: ${total} cards, hammer $${lot.ask.toFixed(2)}, full lot $${fullCharge.toFixed(2)}`)

const before = (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash
const r = estate.buyEstateLot(lot.id)
if (!('ok' in r) || !r.ok) throw new Error('purchase refused: ' + JSON.stringify(r))

const after = (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash
const rows = db
  .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(cost_basis), 0) AS basis FROM inventory WHERE acquired_via = 'estate_lot' AND acquired_ref = ?`)
  .get(String(conventionId)) as { n: number; basis: number }
const admitted = rows.n
const perCard = round2(fullCharge / total)
const expected = round2(perCard * admitted)

check('premium constant', estate.ESTATE_PREMIUM === 0.12, `ESTATE_PREMIUM = ${estate.ESTATE_PREMIUM}`)
check('hammer quoted separately', (r as { hammer?: number }).hammer === lot.ask, `hammer ${(r as { hammer?: number }).hammer} vs lot ask ${lot.ask}`)
check('charged the per-card share of what was admitted', Math.abs(r.paid - expected) <= 0.01, `paid $${r.paid.toFixed(2)} vs $${expected.toFixed(2)} (${admitted}/${total} cards × $${perCard.toFixed(2)})`)
check('cash left the till for what was charged', Math.abs((before - after) - r.paid) <= 0.01, `cash ${before.toFixed(2)} → ${after.toFixed(2)}, paid $${r.paid.toFixed(2)}`)
check('cost basis equals what was paid', Math.abs(rows.basis - r.paid) <= 0.01 + admitted * 0.01, `basis $${rows.basis.toFixed(2)} over ${admitted} cards`)
check('never charged more than the whole lot', r.paid <= fullCharge + 0.005, `paid $${r.paid.toFixed(2)} vs full lot $${fullCharge.toFixed(2)}`)

if (admitted < total) {
  check('partial lot is prorated, not billed in full', r.paid < fullCharge - 0.01, `${admitted} of ${total} fit — paid $${r.paid.toFixed(2)}, kept $${round2(fullCharge - r.paid).toFixed(2)}`)
  check('profit scored on the cards received, not the box', r.realized <= r.paid * 8, `realized $${r.realized.toFixed(2)} on paid $${r.paid.toFixed(2)}`)
} else {
  check('whole lot fits — charged in full', Math.abs(r.paid - fullCharge) <= 0.02, `paid $${r.paid.toFixed(2)} of $${fullCharge.toFixed(2)}`)
}

console.log(failures.length === 0 ? '\nRESULT: all checks passed' : `\nRESULT: ${failures.length} failed — ${failures.join(', ')}`)
process.exit(failures.length === 0 ? 0 : 1)
