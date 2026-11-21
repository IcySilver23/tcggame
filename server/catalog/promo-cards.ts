// The two SVP Black Star Promos the upstream catalogue has not published yet.
//
// Black Bolt's Elite Trainer Box seals Thundurus (SVP 209) and White Flare's
// seals Tornadus (SVP 210) — Bulbapedia's SVP table names both promotions, and
// the printed product copy says "one illustration rare style promo card
// featuring Thundurus or Tornadus, respectively".
//
// The promo NAMES were already in the evidence, but with no catalogue id the
// opener could not resolve them and granted nothing. pokemontcg.io has no rows
// for 209/210 yet (its image paths 404), so these two are seeded here the same
// way a local release is: insert-if-missing, never overwrite a row the sync owns.
//
// Identity (name, type, HP, stage, illustrator, Pokédex number, regulation mark)
// and the USD market price come from TCGdex's card record, which reads
// TCGplayer: Thundurus market $1.50 and Tornadus $1.09 as of 2026-11-08. Those
// are the ordinary ETB printings; the Pokémon Center stamped copies (TCGdex
// reports them at $17.33 and $14.41) are separate printings this build does not
// model, so a box hands over the plain card, as it does for the other stamped
// promos.
import { db, nowIso, logActivity } from '../lib/db'
import { markCatalogChanged } from '../lib/derived-cache'

type PromoSeed = {
  id: string
  name: string
  number: string
  types: string[]
  hp: number
  artist: string
  dex: number
  /** TCGplayer market, USD, plain ETB printing. */
  market: number
}

const PROMO_CARDS: PromoSeed[] = [
  { id: 'svp-209', name: 'Thundurus', number: '209', types: ['Lightning'], hp: 120, artist: 'Anesaki Dynamic', dex: 642, market: 1.5 },
  { id: 'svp-210', name: 'Tornadus', number: '210', types: ['Colorless'], hp: 120, artist: 'Kouki Saitou', dex: 641, market: 1.09 },
]

let done = false

/** Idempotent: a row or price that already exists is left exactly as it is. */
export function applyPromoCards(): { inserted: number } {
  if (done) return { inserted: 0 }
  const now = nowIso()
  const insertCard = db.prepare(`
    INSERT INTO cards (id, set_id, name, supertype, subtypes, number, position, rarity, types, hp,
                       artist, dex_numbers, image_small, image_large, regulation_mark, updated_at)
    VALUES (@id, 'svp', @name, 'Pokémon', '["Basic"]', @number, @position, 'Promo', @types, @hp,
            @artist, @dex, @image_small, @image_large, 'I', @now)
    ON CONFLICT(id) DO NOTHING
  `)
  const insertPrice = db.prepare(`
    INSERT INTO price_records (card_id, kind, variant, low, mid, high, market, direct_low, avg1, avg7, avg30, retrieved_at)
    SELECT @id, 'tcgplayer', 'holofoil', NULL, NULL, NULL, @market, NULL, NULL, NULL, NULL, @now
    WHERE NOT EXISTS (
      SELECT 1 FROM price_records WHERE card_id = @id AND kind = 'tcgplayer' AND variant = 'holofoil'
    )
  `)

  // The promos belong to the SVP set. On a save with no catalogue yet that set
  // does not exist, and inserting the cards would violate cards.set_id's
  // foreign key. Leave the work for the next boot after the sync brings SVP in;
  // `done` stays false so this is retried rather than silently retired.
  if (!db.prepare("SELECT 1 FROM sets WHERE id = 'svp'").get()) return { inserted: 0 }

  let inserted = 0
  for (const c of PROMO_CARDS) {
    const row = {
      id: c.id,
      name: c.name,
      number: c.number,
      position: Number(c.number),
      types: JSON.stringify(c.types),
      hp: c.hp,
      artist: c.artist,
      dex: JSON.stringify([c.dex]),
      image_small: `https://images.scrydex.com/pokemon/${c.id}/small`,
      image_large: `https://images.scrydex.com/pokemon/${c.id}/large`,
      now,
    }
    inserted += insertCard.run(row).changes
    insertPrice.run({ id: c.id, market: c.market, now })
  }
  if (inserted > 0) {
    markCatalogChanged()
    logActivity('release', `${inserted} Black Star Promo${inserted === 1 ? '' : 's'} added to the catalogue — the Black Bolt and White Flare Elite Trainer Boxes can hand over the card that was inside`)
  }
  done = true
  return { inserted }
}
