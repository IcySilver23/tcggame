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
 * Card art for the lines this catalogue has no scans for.
 *
 * images.pokemontcg.io has no Simplified Chinese sets, so every picture these
 * cards can honestly show is an English print's. Four tiers, in order:
 *
 *   1. the same card at the same number in the sibling English set — the same
 *      physical printing, so the same illustration (Black Bolt, White Flare, the
 *      151 base set);
 *   2. the same card at a different number in that set (the renumbered tails);
 *   3. the same name at the same rarity anywhere — this is what gives the
 *      China-only Shiny Rares a shiny print rather than the plain art;
 *   4. any printing of the name, newest set first.
 *
 * A printing is used once per set, so nine Sprigatito treatments in a Gem Pack get
 * nine different Sprigatito arts rather than one repeated. Where the catalogue has
 * fewer printings than the line has treatments, the extra rows share the last one;
 * where it has none, the card keeps no image and renders the placeholder.
 */
export function assignArt(db, cards, { siblingSetId = null } = {}) {
  const q = db.prepare(`
    SELECT c.id, c.set_id, c.position, c.rarity, c.image_small, c.image_large,
           COALESCE(s.release_date, '') AS rel
      FROM cards c LEFT JOIN sets s ON s.id = c.set_id
     WHERE c.name = @name AND c.image_small IS NOT NULL AND c.image_small <> ''
     ORDER BY (c.set_id = @sibling AND c.position = @pos) DESC,
              (c.set_id = @sibling) DESC,
              (c.rarity = @rarity) DESC,
              rel DESC, c.position ASC`)
  const used = new Set()
  const stats = { exact: 0, sibling: 0, other: 0, none: 0 }
  for (const card of cards) {
    const list = q.all({ name: card.name, sibling: siblingSetId ?? '\u0000', pos: card.position, rarity: card.rarity })
    const hit = list.find((c) => !used.has(c.id)) ?? list[0] ?? null
    if (!hit) {
      card.image_small = null
      card.image_large = null
      stats.none++
      continue
    }
    used.add(hit.id)
    card.image_small = hit.image_small
    card.image_large = hit.image_large
    if (hit.set_id === siblingSetId && hit.position === card.position) stats.exact++
    else if (hit.set_id === siblingSetId) stats.sibling++
    else stats.other++
  }
  return stats
}

/**
 * Real scans for the Gem Pack line.
 *
 * No CDN hosts a Simplified Chinese card, so these rows would otherwise wear an
 * English printing of the same Pokémon. Captain Pikachu (Gem Pack Vol. 1 0701-0709
 * and Vol. 5 0101-0107) has no English printing at all — Bulbapedia: "has not yet
 * been officially released in English" — so the card that is actually in the pack
 * is the only honest art. Twelve are the Simplified Chinese product scans on
 * simplifiedcollector.com's per-volume card lists; the two chase treatments those
 * lists do not cover (0709 and 0107) are Bulbapedia's own card images, fetched
 * from the Wayback Machine because the wiki's media host refuses this build.
 * Every file was opened and checked against the printed number before shipping.
 */
export const GEM_CARD_ART = {
  'cbb1-0701': '/catalog-art/cbb/cbb1-0701.webp',
  'cbb1-0702': '/catalog-art/cbb/cbb1-0702.webp',
  'cbb1-0703': '/catalog-art/cbb/cbb1-0703.webp',
  'cbb1-0704': '/catalog-art/cbb/cbb1-0704.webp',
  'cbb1-0705': '/catalog-art/cbb/cbb1-0705.webp',
  'cbb1-0707': '/catalog-art/cbb/cbb1-0707.webp',
  'cbb1-0709': '/catalog-art/cbb/cbb1-0709.webp',
  'cbb5-0101': '/catalog-art/cbb/cbb5-0101.webp',
  'cbb5-0102': '/catalog-art/cbb/cbb5-0102.webp',
  'cbb5-0103': '/catalog-art/cbb/cbb5-0103.webp',
  'cbb5-0104': '/catalog-art/cbb/cbb5-0104.webp',
  'cbb5-0105': '/catalog-art/cbb/cbb5-0105.webp',
  'cbb5-0106': '/catalog-art/cbb/cbb5-0106.webp',
  'cbb5-0107': '/catalog-art/cbb/cbb5-0107.webp',
}

/** Overwrite the borrowed art with the real scan wherever one is recorded. */
export function applyGemArt(cards) {
  let real = 0
  for (const card of cards) {
    const art = GEM_CARD_ART[card.id]
    if (!art) continue
    card.image_small = art
    card.image_large = art
    real++
  }
  return real
}

/** A sibling English set's own logo and symbol, for the shelf to show. */
export function setArt(db, setId) {
  const row = pick(db, `SELECT logo_url, symbol_url FROM sets WHERE id = ?`, setId)
  return { logo_url: row?.logo_url ?? null, symbol_url: row?.symbol_url ?? null }
}

/**
 * The release string is the applied-marker: a save re-applies the file when this
 * text changes, which is how a save that already took the catalogue picks up a
 * later pass over it (the upserts are idempotent).
 */
export const RELEASE = 'Gem Pack Vol. 1-7, Black Bolt / White Flare and Collection 151 (Simplified Chinese) · art 4'

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
