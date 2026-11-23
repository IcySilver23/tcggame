// Every Academy action step is proved by a table or an activity kind, written by
// hand. Ten of them, and they drift the moment a system renames its kind or a
// column moves — a predicate that never fires looks exactly like a player who
// has not done the work.
//
//   TCGLIFE_HOME=tmp/academy-test npx tsx tmp/check-academy-steps.ts
//
// This drives the same rows the features write (services log through
// logActivity; the pack, wishlist and protection rows are the ones the real
// calls insert), then asserts each chapter's action step ticks, that answering
// is still its own step, that a wrong answer carries a reason, that a skip pays
// nothing and blocks the claim, and that a chapter finished before the checklist
// is waived rather than left half-done.
//
// Use a scratch home. It DELETES the save's `academy:*` meta to start clean.
import { db, logActivity, setMeta, getMeta } from '../server/lib/db'
import { academyState, academyReadyCount, answerStep, setChapterSkipped } from '../server/services/academy'

const fails: string[] = []
const ok = (cond: boolean, what: string) => {
  if (!cond) fails.push(what)
  console.log((cond ? 'ok   ' : 'FAIL ') + what)
}

const chapter = (id: string) => {
  const c = academyState().chapters.find((x) => x.id === id)
  if (!c) throw new Error(`no chapter ${id}`)
  return c
}
const actStep = (id: string) => chapter(id).steps.find((s) => s.kind === 'act')!
const answerStepOf = (id: string) => chapter(id).steps.find((s) => s.kind === 'answer')!

// A clean run: no flags, and a baseline a minute in the past so a row written
// with SQL's datetime('now') (second precision) is strictly after it.
db.prepare("DELETE FROM meta WHERE key LIKE 'academy:%'").run()
setMeta('academy:since', new Date(Date.now() - 60_000).toISOString())

for (const c of academyState().chapters) {
  ok(!c.steps.some((s) => s.done), `${c.id}: starts with nothing ticked`)
}

// --- the ten actions, written the way the game writes them -------------------
// Everything this writes is recorded so it can be put back exactly: the run is
// repeatable on the same save, which matters because the predicates are
// time-based and yesterday's leftovers would tick the next run's steps.
const maxActivity = (db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM activity_log').get() as { n: number }).n
const maxPull = (db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM pull_history').get() as { n: number }).n
logActivity('system', '⏭ Day pass — $8.33 to skip the wait. It is now 2026-01-01 (game day 2).', -8.33)
const cardId = (db.prepare('SELECT id FROM cards LIMIT 1').get() as { id: string } | undefined)?.id
if (!cardId) throw new Error('the scratch save has no cards to write rows against')
const invRow = db.prepare('SELECT id, protected_at FROM inventory ORDER BY id LIMIT 1').get() as { id: number; protected_at: string | null } | undefined
const wishBefore = (db.prepare("SELECT COUNT(*) AS n FROM wishlist WHERE card_id = ? AND variant = 'normal' AND target_price = 1").get(cardId) as { n: number }).n
db.prepare(
  "INSERT INTO pull_history (session_id, pack_product_id, card_id, value, is_hit, opened_at, owner) VALUES ('acad-steps', 'test', ?, 1, 0, datetime('now'), 'player')",
).run(cardId)
if (invRow) db.prepare("UPDATE inventory SET protected_at = datetime('now') WHERE id = ?").run(invRow.id)
logActivity('market', 'Bought one card from the feed (academy check).', -1)
logActivity('sale', 'Sold one card (academy check).', 1)
logActivity('storage', 'Rented a locker (academy check).', -1)
db.prepare("INSERT INTO wishlist (card_id, variant, target_price, added_at) VALUES (?, 'normal', 1, datetime('now'))").run(cardId)
logActivity('convention', 'Attended a convention (academy check).', -1)
logActivity('shop', 'Rang a shop sale (academy check).', 1)
logActivity('forum', 'Posted in Community (academy check).', 0)

for (const c of academyState().chapters) {
  ok(actStep(c.id).done, `${c.id}: the action step ticks from its own row`)
  ok(!answerStepOf(c.id).done, `${c.id}: the question is still the player's to answer`)
}

// --- the claim gate, and the reason a wrong answer gives --------------------
const beforeClaim = chapter('packs')
ok(beforeClaim.ready === false, 'packs: a ticked action alone does not unlock the reward')
const wrong = answerStep('packs', 'q', 0)
ok(wrong.ok && wrong.correct === false && typeof wrong.why === 'string' && wrong.why.length > 20, 'a wrong answer comes back with the reason')
ok(!answerStepOf('packs').done, 'a wrong answer ticks nothing')
const right = answerStep('packs', 'q', 2)
ok(right.ok && right.correct === true && answerStepOf('packs').done, 'the right answer ticks the question')

// --- the sidebar count and the skip -----------------------------------------
ok(academyReadyCount() >= 1, `academyReadyCount sees the ready chapter (${academyReadyCount()})`)
const skip = setChapterSkipped('packs', true)
ok(skip.ok && skip.state.chapters.find((c) => c.id === 'packs')!.skipped, 'a chapter can be skipped')
ok(!skip.state.chapters.find((c) => c.id === 'packs')!.done, 'a skip is not progress')
ok(academyReadyCount() === 0, 'a skipped chapter is not counted as a claimable reward')
ok(setChapterSkipped('packs', false).state.chapters.find((c) => c.id === 'packs')!.skipped === false, 'a skip can be taken back')

// --- a chapter added after the save graduated ---------------------------------
setMeta('academy:graduatedIn', '0.86.0')
const oldGraduate = academyState()
ok(oldGraduate.chapters.every((c) => c.fresh), 'every chapter reads as new to a 0.86.0 graduate')
ok(oldGraduate.newSinceGraduation === oldGraduate.total, 'the banner count matches the mark')
setMeta('academy:graduatedIn', '0.87.0')
ok(academyState().chapters.every((c) => !c.fresh), 'a graduate of the chapter list sees nothing flagged')

// --- the legacy waiver ------------------------------------------------------
db.prepare("DELETE FROM meta WHERE key LIKE 'academy:%'").run()
setMeta('academy:since', new Date().toISOString())
setMeta('academy:ch:economy', '1')
setMeta('academy:paid:economy', '25')
const legacy = chapter('economy')
ok(legacy.waived, 'a chapter finished before the checklist is waived')
ok(legacy.steps.every((s) => s.done), 'a waived chapter keeps its steps ticked')
ok(getMeta('academy:migrated:checklist') === '1', 'the waiver migration runs once and records itself')
ok(chapter('packs').waived === false, 'an unfinished chapter is not waived')

// Put the save back exactly as it was, so a second run sees the same starting
// state as the first.
db.prepare('DELETE FROM pull_history WHERE id > ?').run(maxPull)
db.prepare('DELETE FROM activity_log WHERE id > ?').run(maxActivity)
if (invRow) db.prepare('UPDATE inventory SET protected_at = ? WHERE id = ?').run(invRow.protected_at, invRow.id)
if (wishBefore === 0) db.prepare("DELETE FROM wishlist WHERE card_id = ? AND variant = 'normal' AND target_price = 1").run(cardId)
db.prepare("DELETE FROM meta WHERE key LIKE 'academy:%'").run()

if (fails.length > 0) {
  console.log(`\n${fails.length} failed`)
  process.exit(1)
}
console.log('\nevery Academy step checks out')
