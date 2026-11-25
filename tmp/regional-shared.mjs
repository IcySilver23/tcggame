// Shared machinery for the Simplified Chinese catalogue emitters, so the two
// lines (Black Bolt / White Flare and Collection 151) value and price cards the
// same way instead of each carrying its own copy.
//
// The three pieces that were duplicated, and the one that disagreed:
//
//   * `marketOf` — a card's worth as the lowest plain listing. MAX over variants
//     picks up a graded or first-edition figure and prices a Simisage common at
//     $16, which is why every emitter here uses the cheapest plain row.
//   * `anchorFor` — the same card in the English print first, then the same name
//     at the same rarity (cheapest such printing), then any printing of the name.
//     Ordering matters: preferring "same name and rarity, newest" put a $20
//     Pikachu common into Collection 151.
//   * `scaleToWrapper` — the set keeps each card's worth relative to the others
//     and is scaled until a pack is worth `target` of its sticker. No Chinese copy
//     of these sets has a recorded sale, so the absolute level has to come from the
//     one price anyone can check: the wrapper.
//
// The disagreement: Black Bolt summed one draw's worth and called it the pack's,
// while Collection 151 multiplied by its five slots. A pack is every slot it
// deals, so the shared version sums per slot — the group's share of THAT slot,
// times the slot's count, times the group's average value.
import Database from 'better-sqlite3'

export function openCatalog(dbPath = 'data/tcglife.db') {
  return new Database(dbPath, { readonly: true })
}

export const pick = (db, sql, ...params) => db.prepare(sql).get(...params)

/** A card's market value: the cheapest plain listing, never the dearest variant. */
export function marketOf(db, cardId) {
  if (!cardId) return null
  return (
    pick(db, `SELECT MIN(market) AS m FROM price_records WHERE card_id = ? AND market > 0 AND variant = 'normal'`, cardId)?.m ??
    pick(db, `SELECT MIN(market) AS m FROM price_records WHERE card_id = ? AND market > 0`, cardId)?.m ??
    null
  )
}

export const tidy = (s) => s.replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim()

/** Cheapest printing of a name at a rarity, then of the name at all. */
export function sameNameCard(db, name, rarity) {
  return (
    pick(
      db,
      `SELECT c.* FROM cards c WHERE c.name = ? AND c.rarity = ?
       ORDER BY (SELECT COALESCE(MIN(market), 9999) FROM price_records p WHERE p.card_id = c.id AND p.market > 0) LIMIT 1`,
      name,
      rarity,
    ) ??
    pick(
      db,
      `SELECT c.* FROM cards c WHERE c.name = ?
       ORDER BY (SELECT COALESCE(MIN(market), 9999) FROM price_records p WHERE p.card_id = c.id AND p.market > 0) LIMIT 1`,
      name,
    ) ??
    null
  )
}

/**
 * What a Chinese card is valued against: the same card in its English print when
 * the caller found one, else the same name at the same rarity, else the name.
 */
export function anchorFor(db, { english, name, rarity }) {
  return english ?? sameNameCard(db, name, rarity)
}

/**
 * Scale a set to the wrapper it ships in and write each card's price.
 *
 * `ladder` groups the set's rarities into slots with their published shares;
 * `plan` is the pack's slot counts. A group's chance within its slot is its share
 * over the shares sharing that slot, so the maths holds whether a wrapper is one
 * pool of five cards or four body cards plus one foil.
 *
 * `cards` entries are read with `_raw` (the English-comparable value) and
 * `rarity`; each gets `price`. Returns the numbers, for the caller's log line.
 */
export function scaleToWrapper({ cards, ladder, plan, packUsd, target = 0.85 }) {
  const slotTotal = new Map()
  for (const g of ladder) slotTotal.set(g.slot, (slotTotal.get(g.slot) ?? 0) + g.share)
  const count = new Map(plan.map((p) => [p.slot, p.count]))
  let ev = 0
  for (const g of ladder) {
    const group = cards.filter((c) => g.rarities.includes(c.rarity) && c._raw > 0)
    if (group.length === 0) continue
    const avg = group.reduce((a, c) => a + c._raw, 0) / group.length
    ev += (count.get(g.slot) ?? 0) * (g.share / slotTotal.get(g.slot)) * avg
  }
  const k = ev > 0 ? Math.min(1, (target * packUsd) / ev) : 1
  for (const card of cards) {
    const raw = card._raw
    card.price = raw > 0 ? { market: Math.max(0.01, Math.round(raw * k * 100) / 100), variant: 'normal' } : null
    delete card._raw
  }
  return { ev, k, packEv: ev * k }
}
