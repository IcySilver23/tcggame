// One-shot sync runner: `npm run sync` — syncs sets + all cards with progress output.
// Resumable: every pass only fetches sets not yet recorded in meta `sync:doneIds`.
// Sets whose stored card count already matches the API's printed_total/total are
// considered complete and auto-seeded as done.
import * as sync from '../services/sync'
import * as tcgcsv from '../services/tcgcsv'
import { db, getMeta, setMeta } from '../lib/db'

function loadDoneIds(): Set<string> {
  try {
    return new Set(JSON.parse(getMeta('sync:doneIds') || '[]') as string[])
  } catch {
    return new Set()
  }
}

async function main() {
  // `npm run sync -- --mirror` — the free TCGplayer mirror only (tcgcsv.com):
  // no key, no quota, every set. Cheap to re-run; the once-per-card-per-day
  // guard makes repeat passes free for cards it already quoted.
  if (process.argv.includes('--mirror')) {
    console.log('TCG Life — re-pricing every set from the free TCGplayer mirror…')
    const m = await tcgcsv.syncAllTcgcsv(true, true)
    console.log(m.ok
      ? `Done. ${m.cardsPriced} TCGplayer row(s) across ${m.setsSynced} set(s).`
      : `Mirror skipped: ${m.error}`)
    process.exit(m.ok ? 0 : 1)
  }

  // `npm run sync -- --prices` — re-quote EVERY card and exit. Used before
  // rebuilding the offline catalog seed so the shipped installer carries
  // current market prices instead of whatever the last full sync recorded.
  if (process.argv.includes('--prices')) {
    console.log('TCG Life — re-pricing the whole catalog…')

    // 1) The free TCGplayer mirror (tcgcsv.com), every set: no key, no quota,
    //    stable — this is the pass that makes the seed's market prices current.
    let mirrored = false
    try {
      const m = await tcgcsv.syncAllTcgcsv(true, true)
      if (m.ok) {
        mirrored = true
        console.log(`[tcgcsv] ${m.cardsPriced} TCGplayer row(s) across ${m.setsSynced} set(s)`)
      } else {
        console.warn(`[tcgcsv] mirror pass skipped: ${m.error}`)
      }
    } catch (e) {
      console.warn(`[tcgcsv] mirror pass failed: ${e instanceof Error ? e.message : e}`)
    }

    // 2) pokemontcg.io for the Cardmarket (EUR) rows and anything the mirror
    //    doesn't carry. Best-effort on purpose: that API 500s under load, and a
    //    flaky upstream must not fail a build that already has fresh prices.
    let apiCards = 0
    let apiOk = false
    try {
      const r = await sync.refreshCatalogPrices()
      apiCards = r.cards
      apiOk = true
      console.log(`[sync] pokemontcg.io: ${r.cards} card(s) re-priced, ${r.updated} Cardmarket trend(s) moved`)
    } catch (e) {
      console.warn(`[sync] pokemontcg.io pass failed (${e instanceof Error ? e.message : e}) — mirror prices stand`)
    }

    if (!mirrored && !apiOk) {
      console.error('!! no price source could refresh the catalog — not shipping stale prices.')
      process.exit(1)
    }
    console.log(`Done. mirror ${mirrored ? 'ok' : 'failed'}, pokemontcg.io ${apiCards} card(s).`)
    process.exit(0)
  }

  console.log('TCG Life — syncing card database from pokemontcg.io…')
  const n = await sync.syncSets()
  console.log(`Sets synced: ${n}`)

  const sets = db.prepare('SELECT id, name, printed_total, total FROM sets ORDER BY release_date DESC').all() as {
    id: string
    name: string
    printed_total: number
    total: number
  }[]
  const done = loadDoneIds()

  // Seed: sets already holding at least printed_total/total distinct cards are complete.
  const counts = db
    .prepare('SELECT set_id, COUNT(*) AS n FROM cards GROUP BY set_id')
    .all() as { set_id: string; n: number }[]
  const countsBySet = new Map(counts.map((r) => [r.set_id, r.n]))
  let seeded = 0
  for (const s of sets) {
    if (done.has(s.id)) continue
    const have = countsBySet.get(s.id) ?? 0
    if (have > 0 && have >= (s.printed_total || s.total)) {
      done.add(s.id)
      seeded++
    }
  }
  if (seeded > 0) {
    setMeta('sync:doneIds', JSON.stringify([...done]))
    console.log(`Seeded ${seeded} already-complete set(s) as done.`)
  }

  const pending = sets.filter((s) => !done.has(s.id))
  console.log(`${pending.length} set(s) to sync.`)

  let i = 0
  for (const s of pending) {
    i++
    try {
      const count = await sync.syncCardsForSet(s.id)
      done.add(s.id)
      setMeta('sync:doneIds', JSON.stringify([...done]))
      console.log(`[${i}/${pending.length}] ${s.name}: ${count} cards`)
    } catch (e) {
      console.error(`[${i}/${pending.length}] ${s.name} FAILED:`, e instanceof Error ? e.message : e)
    }
  }
  const total = (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n
  console.log(`Done. ${total} cards in database.`)
  process.exit(0)
}

void main()
