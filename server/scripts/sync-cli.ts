// One-shot sync runner: `npm run sync` — syncs sets + all cards with progress output.
import * as sync from '../services/sync'
import { db } from '../lib/db'

async function main() {
  console.log('TCG Life — syncing card database from pokemontcg.io…')
  const n = await sync.syncSets()
  console.log(`Sets synced: ${n}`)
  const sets = db.prepare('SELECT id, name FROM sets ORDER BY release_date DESC').all() as { id: string; name: string }[]
  const doneRow = db.prepare('SELECT value FROM meta WHERE key = ?').get('sync:set') as { value: string } | undefined
  const done = new Set([doneRow?.value].filter(Boolean) as string[])
  let i = 0
  for (const s of sets) {
    i++
    if (done.has(s.id)) { console.log(`[${i}/${sets.length}] ${s.name} — already synced, skipping`); continue }
    try {
      const count = await sync.syncCardsForSet(s.id)
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('sync:set', s.id)
      console.log(`[${i}/${sets.length}] ${s.name}: ${count} cards`)
    } catch (e) {
      console.error(`[${i}/${sets.length}] ${s.name} FAILED:`, e instanceof Error ? e.message : e)
    }
  }
  const total = (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n
  console.log(`Done. ${total} cards in database.`)
  process.exit(0)
}

void main()
