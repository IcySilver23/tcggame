// Binders now have a cover stock, and a cover is EARNED by filling binders.
// Runs on a COPY of the save (tmp/binder-home) — which also proves the column
// migration on a save that predates it.
//
//   npx tsx tmp/check-binders-covers.ts

import fs from 'node:fs'
import path from 'node:path'

let checks = 0
const fails: string[] = []
function ok(cond: unknown, label: string) {
  checks++
  if (!cond) fails.push(label)
}

const home = path.resolve('tmp/binder-home')
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
const { installClock } = await import('../server/lib/clock')
const binders = await import('../server/services/binders')

installClock()

try {
  // ---- migration: an old save grows the column, old rows read vinyl ----
  const cols = (db.prepare('PRAGMA table_info(binders)').all() as { name: string }[]).map((c) => c.name)
  ok(cols.includes('cover'), 'a pre-cover save gains the cover column on boot')
  const existing = binders.listBinders()
  ok(existing.every((b) => b.cover === 'vinyl'), 'binders that existed before read as black vinyl')

  // ---- the catalogue ---------------------------------------------------
  ok(binders.BINDER_COVERS.length === 6, 'six cover stocks')
  ok(binders.BINDER_COVERS.filter((c) => c.unlockAt === 0).length === 2, 'two covers are free from the start')
  ok(binders.BINDER_COVERS.filter((c) => c.special).length === 3, 'three are specials')
  ok(binders.BINDER_COVERS.every((c) => c.blurb.length > 10), 'every cover explains itself')

  // ---- an empty shelf: covers stay locked ------------------------------
  db.prepare('DELETE FROM binder_slots').run()
  ok(binders.slottedTotal() === 0, 'no cards slotted after clearing the copy')
  let msg = ''
  try { binders.createBinder('Locked', 'yellow', 'leather') } catch (e) { msg = e instanceof Error ? e.message : String(e) }
  ok(/unlocks at 12/.test(msg), 'creating with a locked cover is refused, and says what earns it')

  const free = binders.createBinder('Free shelf', 'blue', 'canvas')
  ok(free.cover === 'canvas', 'a free cover can be chosen at creation')
  const upd = binders.updateBinder(free.id, { cover: 'holo' })
  ok(!upd.ok && /unlocks at 36/.test(upd.error ?? ''), 'moving to a locked cover is refused too')
  const bad = binders.updateBinder(free.id, { cover: 'nonsense' })
  ok(!bad.ok && /Unknown cover/.test(bad.error ?? ''), 'an unknown cover id is refused')
  ok(binders.updateBinder(free.id, { name: 'Renamed' }).ok, 'renaming still works')
  ok(binders.updateBinder(free.id, { accent: 'red' }).ok, 'recolouring the spine still works')

  // ---- fill past the first gate ----------------------------------------
  const card = db.prepare(`SELECT id FROM cards LIMIT 1`).get() as { id: string }
  const ins = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
     VALUES (?, 'normal', 'NM', 1, 'collection', 'test', 1, ?)`,
  )
  const slot = db.prepare('INSERT INTO binder_slots (binder_id, page, slot, inventory_id, placed_at) VALUES (?, ?, ?, ?, ?)')
  const at = new Date().toISOString()
  const tx = db.transaction(() => {
    // Nine pockets a page, pages 0..4 — the same layout the UI renders.
    for (let i = 0; i < 40; i++) {
      const invId = Number(ins.run(card.id, at).lastInsertRowid)
      slot.run(free.id, Math.floor(i / 9), i % 9, invId, at)
    }
  })
  tx()
  ok(binders.slottedTotal() === 40, '40 cards slotted across the copy')
  const holo = binders.createBinder('Holo shelf', 'purple', 'holo')
  ok(holo.cover === 'holo', 'at 40 cards the galaxy cover unlocks')
  const still = binders.updateBinder(holo.id, { cover: 'monster' })
  ok(!still.ok && /unlocks at 150/.test(still.error ?? ''), 'the monster cover still needs 150')

  // ---- reads carry the cover -------------------------------------------
  ok(binders.listBinders().find((b) => b.id === holo.id)?.cover === 'holo', 'the shelf list carries the cover')
  const detail = binders.getBinderDetail(free.id)
  ok(detail?.binder.cover === 'canvas', 'the binder detail carries the cover')
  ok(detail?.pages === 5, `five pages of pockets (got ${detail?.pages})`)
  ok(detail?.slots.length === 40, 'and every slotted card is still accounted for')

  // ---- deletion still only drops the binder ----------------------------
  const before = (db.prepare('SELECT COUNT(*) n FROM inventory').get() as { n: number }).n
  binders.deleteBinder(free.id)
  ok(!binders.getBinderDetail(free.id), 'the binder is gone')
  const after = (db.prepare('SELECT COUNT(*) n FROM inventory').get() as { n: number }).n
  ok(after === before, 'deleting a binder never touches the cards')
} catch (e) {
  fails.push(`threw: ${e instanceof Error ? e.message : String(e)}`)
}

// The copy is left in place: Windows keeps the file open past db.close().
try { db.close() } catch { /* already closed */ }

if (fails.length > 0) {
  console.error(`FAIL — ${fails.length}/${checks} checks failed:`)
  for (const f of fails) console.error(`  • ${f}`)
  process.exit(1)
}
console.log(`PASS — ${checks} checks`)
