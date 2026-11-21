// Two secret rares arrived from the upstream catalogue labelled plain "Rare":
// Black Bolt 171/086 Victini and White Flare 172/086 Victini. Both are the sets'
// Black White Rare chase cards (TCGdex names both "Black White Rare"), and a
// secret number cannot be a plain rare.
//
// The mislabel was expensive: the pull-table builder files a "Rare" card into the
// 1-in-18 holo pool, so a $615/$533 card was being dealt as often as a bulk rare.
// That alone valued a Black Bolt pack at $105 and a White Flare pack at $111
// against a $13.74 / $13.28 shelf, which then pushed both nine-pack ETBs past $870.
//
// Idempotent: the rarity is only written when it differs, and the two tables are
// rebuilt only when something changed.
import { db } from '../lib/db'
import { buildPullTable } from '../services/packs'

const CARDS = [
  { id: 'zsv10pt5-171', set: 'zsv10pt5', name: 'Victini' },
  { id: 'rsv10pt5-172', set: 'rsv10pt5', name: 'Victini' },
] as const

export function repairBlackWhiteRarities(): { repaired: number } {
  const update = db.prepare(`UPDATE cards SET rarity = 'Black White Rare' WHERE id = ? AND (rarity IS NULL OR rarity <> 'Black White Rare')`)
  let repaired = 0
  const sets = new Set<string>()
  for (const c of CARDS) {
    if (update.run(c.id).changes > 0) {
      repaired++
      sets.add(c.set)
    }
  }
  for (const setId of sets) buildPullTable(setId, 10)
  if (repaired > 0) {
    console.log(`[catalog] relabelled ${repaired} Black White Rare card(s) and rebuilt their pull tables`)
  }
  return { repaired }
}
