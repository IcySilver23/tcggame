// Cards the upstream catalogue files below their real tier, which the pack
// builder then deals out of the bulk pool. Two secret rares arrived labelled
// plain "Rare": Black Bolt 171/086 Victini and White Flare 172/086 Victini.
// Both are the sets' Black White Rare chase cards (TCGdex names both "Black
// White Rare"), and a secret number cannot be a plain rare.
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
  return relabel(CARDS, 'Black White Rare')
}

// Celebrations' gold Mew (025/025) arrived labelled "Rare Holo" like the rest of
// the set. That filed the 1-in-150 secret rare into the holo pool, so a four-card
// Celebrations wrapper dealt it about three times per pack instead of once in 150
// packs — the same failure the two Victini rows above had. TCGplayer sells the
// card as "Mew (Secret)" with Rarity=Secret Rare, and the set's published pull
// rates list one secret rare at 1 in 150 packs.
const CELEBRATIONS_SECRETS = [{ id: 'cel25-25', set: 'cel25', name: 'Mew' }] as const

/** Celebrations prints one secret rare: relabel it so the hit pool can hold it. */
export function repairCelebrationsSecrets(): { repaired: number } {
  return relabel(CELEBRATIONS_SECRETS, 'Secret Rare', 4)
}

function relabel(
  cards: readonly { id: string; set: string; name: string }[],
  rarity: string,
  cardsPerPack = 10,
): { repaired: number } {
  const update = db.prepare('UPDATE cards SET rarity = ? WHERE id = ? AND (rarity IS NULL OR rarity <> ?)')
  let repaired = 0
  const sets = new Set<string>()
  for (const c of cards) {
    if (update.run(rarity, c.id, rarity).changes > 0) {
      repaired++
      sets.add(c.set)
    }
  }
  for (const setId of sets) buildPullTable(setId, cardsPerPack)
  if (repaired > 0) {
    console.log(`[catalog] relabelled ${repaired} ${rarity} card(s) and rebuilt their pull tables`)
  }
  return { repaired }
}
