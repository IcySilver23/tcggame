// Delta Reign's Legendary Stadiums are one Stadium printed across two sleeves,
// and they must arrive back to back: both halves, never a lone half, never a
// repeat of one half, and always in consecutive seats so the connecting art
// reads as one card. This pins that against real rolls.
//
//   TCGLIFE_HOME=tmp/me6-test npx tsx tmp/check-stadium-pair.ts
//
// Needs a home whose save has the me6 pull table (any save that booted with the
// local release). It cleans up after itself: every roll uses a `b2b-` session id
// and those rows are deleted at the end.
import { db } from '../server/lib/db'
import { rollPack, stadiumHalvesFor } from '../server/services/packs'

const halves = new Set(stadiumHalvesFor('me6'))
if (halves.size !== 6) throw new Error(`expected six Stadium halves, got ${halves.size}`)

const ROLLS = 400
let withPair = 0
let adjacent = 0
const problems: string[] = []
for (let i = 0; i < ROLLS; i++) {
  const session = `b2b-${i}`
  db.prepare('DELETE FROM pull_history WHERE session_id = ?').run(session)
  if (!rollPack('me6', session, 'booster', 10, 'player')) throw new Error('me6 has no pull table')
  const rows = db.prepare('SELECT card_id FROM pull_history WHERE session_id = ? ORDER BY id').all(session) as { card_id: string }[]
  const pairRows = rows.filter((r) => halves.has(r.card_id))
  if (rows.length !== 10) problems.push(`${session}: ${rows.length} cards, not 10`)
  if (pairRows.length === 0) continue
  withPair++
  if (pairRows.length !== 2) {
    problems.push(`${session}: ${pairRows.length} halves — ${pairRows.map((r) => r.card_id).join(' + ')}`)
    continue
  }
  const seats = rows.map((r, idx) => (halves.has(r.card_id) ? idx : -1)).filter((i) => i >= 0)
  if (Math.abs(seats[0] - seats[1]) === 1) adjacent++
  else problems.push(`${session}: seats ${seats.join(' & ')} of ${rows.length} — ${pairRows.map((r) => r.card_id).join(' + ')}`)
}
db.prepare("DELETE FROM pull_history WHERE session_id LIKE 'b2b-%'").run()

console.log(`packs ${ROLLS} | with a Stadium ${withPair} | back to back ${adjacent}`)
if (problems.length > 0) {
  console.log(problems.slice(0, 8).join('\n'))
  process.exit(1)
}
if (withPair === 0) { console.log('no Stadium was rolled — the rate or the table moved'); process.exit(1) }
console.log('every pair arrived back to back')
