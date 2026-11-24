import { db, nowIso, getMeta, setMeta, logActivity } from '../lib/db'
import { markCatalogChanged, markPricesChanged, onDerivedDataChanged } from '../lib/derived-cache'
import { round2, valueOf } from './market'
import { fetchPriceCharting, pcAuthFailed, markPcAuthFailure } from './pricesources'
import { sealedFactor } from './demographics'
import { expectedPackValue, planFor } from './packodds'
import { miniPackFor } from '../catalog/general-mills'
import { ART_EXACT, ART_LESS_PRODUCTS, ETB_SHELF, LOCAL_PRODUCT_IMAGES, PC_ETB_SHELF, PRODUCT_IMAGE_PRODUCT_IDS, productImageFor, sealedEvidenceFor, shelfPriceFor, NO_DISPLAY_SETS, PC_ETB_SETS, SPECIAL_BUNDLE_SETS, SPECIAL_PRODUCTS, unsellableReason } from '../catalog/sealed-evidence'

// ---------------------------------------------------------------------------
// Sealed catalog for EVERY set. WotC sets get boosters + 36-pack displays;
// modern sets get the full line (booster, bundle, ETB, display). Prices come
// from PriceCharting's real sealed listings (the same token already used for
// graded comps), falling back to a derived estimate until that product's
// lookup lands. The backfill paces itself at PC's 1-call/second limit.
// ---------------------------------------------------------------------------

const DISPLAY_PACKS = 36
const BUNDLE_PACKS = 6
const ETB_PACKS = 9

type EraProducts = { kinds: { kind: string; name: string; msrp: number; packs: number }[] }

function seriesEra(series: string, releaseDate: string): 'wotc' | 'modern' | 'none' {
  const year = Number((releaseDate || '').slice(0, 4))
  if (year >= 2011) return 'modern'
  if (year >= 1998 && year <= 2010) return 'wotc'
  // Series-name fallbacks for odd rows without dates.
  const s = series.toLowerCase()
  if (/(sword|scarlet|sun & moon|xy|black & white)/.test(s)) return 'modern'
  if (/(base|jungle|fossil|neo|gym|e-card|ex|team rocket|diamond|platinum|heartgold|legendary|call of legends|pop|wizards)/.test(s)) return 'wotc'
  return 'none'
}

function isSpecialSet(setId: string): boolean {
  // Half sets (sv3pt5, swsh4.5,…) and promo-ish sets don't get displays.
  return setId.includes('.5') || setId.endsWith('pt5') || /(p|sm\d+p)$/.test(setId) === false && /(mcp|swshp|smp|xyp|dpp|hgssp|bwp|xy\d*p|sm\d*p)$/.test(setId)
}

function promoLike(setId: string): boolean {
  return /(^|)(mcp|swshp|smp|xyp|pop\d*|bwp|dpp|hgssp)$/.test(setId) || setId.endsWith('p') && setId.length <= 6
}

/**
 * Sets that only ever came inside another set's packs: Shiny Vault (Hidden Fates,
 * Shining Fates), the four Trainer Galleries, Crown Zenith's Galarian Gallery,
 * and the Basic Energy set. None has a wrapper of its own on a real shelf, and
 * their catalogue is pure chase cards, so a ten-card pack is either a lie (one
 * card dealt) or a money printer (a $4 wrapper worth hundreds). No sealed
 * product is sold for them; their cards stay in the catalogue.
 *
 * The two Classic Collection subsets belong here too: their cards came inside
 * 30th Celebration and Celebrations packs, never in a wrapper of their own.
 */
export const SUBSET_ONLY_SETS = new Set([
  'sma',
  'swsh45sv',
  'swsh9tg',
  'swsh10tg',
  'swsh11tg',
  'swsh12tg',
  'swsh12pt5gg',
  'sve',
  'cel25c',
  'me55c',
])

/**
 * Sets whose cards never shipped in a randomised booster of their own. These
 * are not subset-only — each is a set with its own name — but a ten-card
 * wrapper over them is still fabricated: the cards came in decks, promo
 * giveaways, a fixed binder, or one per toy. Their rows stay so owned stock
 * resolves; the shop, pack battles and live shows refuse them.
 */
export const NO_BOOSTER_SETS = new Set([
  'si1', // English Southern Islands: a fixed 18-card binder plus 3 boosters from other sets
  'xy0', // Kalos Starter Set: three theme decks, no booster
  'tk1a', // EX Trainer Kit Latias: a fixed two-deck kit
  'tk1b', // EX Trainer Kit Latios
  'tk2a', // EX Trainer Kit 2 Plusle
  'tk2b', // EX Trainer Kit 2 Minun
  'fut20', // Pokémon Futsal: promotional cards, never a pack
  'ru1', // Pokémon Rumble: promotional cards, never a booster
  // 2011–2019 McDonald's cards came one per toy. Only 2021 and 2022 shipped
  // the four-card Happy Meal pack.
  'mcd11',
  'mcd12',
  'mcd14',
  'mcd15',
  'mcd16',
  'mcd17',
  'mcd18',
  'mcd19',
])

/** True when this set has sealed product of its own to sell. */
export function sellsOwnPacks(setId: string): boolean {
  return !SUBSET_ONLY_SETS.has(setId) && !NO_BOOSTER_SETS.has(setId)
}

/** True when this exact product is offered, not merely a product in a sellable set. */
export function sellsProduct(productId: string, setId: string): boolean {
  return sellsOwnPacks(setId) && unsellableReason(productId) === null
}

/**
 * Delete rows for wrappers no shelf ever carried: pre-Lost Origin bundles,
 * ETBs before the line began, displays and bundles on special sets that never
 * shipped one, and every product of a set whose cards only came inside another
 * product. Keeping them as hidden rows still told the catalogue a product
 * existed; the only honest row count is the one a shop could stock.
 *
 * A box the save already owns is the exception: removing its row would strand
 * that stock, so it stays hidden until the player sells it. Nothing is granted
 * or refunded here, and the prune is idempotent.
 */
/**
 * The phantom booster rows that cannot go yet. A set's pull table is keyed
 * `${setId}-booster`, and the real Double Crisis and Dragon Vault blisters and
 * the Generations ETB roll that table. Deleting the parent would either cascade
 * the table away or strand it behind a foreign key, so these rows stay as
 * unsold table hosts. They are the only unsellable rows the prune leaves
 * behind; every other phantom product is deleted.
 *
 * me55c-booster is the same shape for a different reason: the 30th Celebration
 * UPC holds one three-card Classic Collection pack, and those cards never had a
 * wrapper on a shelf (SUBSET_ONLY_SETS), so the host row exists only so the
 * box's last wrapper has a table to deal from.
 */
export const PULL_TABLE_HOSTS: ReadonlySet<string> = new Set(['dc1-booster', 'dv1-booster', 'g1-booster', 'me55c-booster'])

export function pruneNeverShippedProducts(): number {
  const rows = db.prepare('SELECT id, set_id FROM pack_products').all() as { id: string; set_id: string }[]
  const held = db.prepare('SELECT 1 FROM sealed_inventory WHERE product_id = ? AND quantity > 0 LIMIT 1')
  const doomed = rows
    .filter((r) => !sellsProduct(r.id, r.set_id) && !held.get(r.id) && !PULL_TABLE_HOSTS.has(r.id))
    .map((r) => r.id)
  if (doomed.length === 0) return 0
  const marks = doomed.map(() => '?').join(',')
  const tx = db.transaction(() => {
    // A marketplace listing for a wrapper that never existed is the same lie in
    // another table; it goes with the row rather than dangling as an item that
    // cannot resolve. Pull and battle rows are records of opening one of these
    // wrappers, so they go too. Breaks and shows keep their history: those
    // tables are journals, and their product id is only a label.
    db.prepare(`DELETE FROM local_listings WHERE item_ref IN (${marks})`).run(...doomed)
    db.prepare(`DELETE FROM pack_product_cards WHERE pack_product_id IN (${marks})`).run(...doomed)
    db.prepare(`DELETE FROM sealed_prices WHERE product_id IN (${marks})`).run(...doomed)
    db.prepare(`DELETE FROM sealed_box_open WHERE product_id IN (${marks})`).run(...doomed)
    db.prepare(`DELETE FROM pull_history WHERE pack_product_id IN (${marks})`).run(...doomed)
    db.prepare(`DELETE FROM pack_battles WHERE product_id IN (${marks})`).run(...doomed)
    db.prepare(`DELETE FROM pack_products WHERE id IN (${marks})`).run(...doomed)
  })
  tx()
  return doomed.length
}

export function productsForSet(setId: string, setName: string, series: string, releaseDate: string): EraProducts['kinds'] {
  if (!sellsOwnPacks(setId)) return []
  if (promoLike(setId)) return []
  const era = seriesEra(series, releaseDate)
  if (era === 'none') return []
  const year = Number((releaseDate || '').slice(0, 4))
  const boosterMsrp = year >= 2020 ? 4.49 : year >= 2011 ? 3.99 : 3.29
  const etbMsrp = year >= 2020 ? 54.99 : year >= 2011 ? 39.99 : 0
  const kinds: EraProducts['kinds'] = [
    { kind: 'booster', name: `${setName} Booster Pack`, msrp: boosterMsrp, packs: 1 },
  ]
  if (era === 'wotc') {
    kinds.push({ kind: 'display', name: `${setName} Booster Display (36 packs)`, msrp: round2(boosterMsrp * DISPLAY_PACKS), packs: DISPLAY_PACKS })
  } else {
    const special = setId.includes('.5') || setId.endsWith('pt5')
    // Most half sets skipped the bundle, but 151, Paldean Fates, Shrouded
    // Fable, Prismatic Evolutions, Black Bolt and White Flare all shipped one.
    if (!special || SPECIAL_BUNDLE_SETS.has(setId)) kinds.push({ kind: 'bundle', name: `${setName} Booster Bundle`, msrp: 26.99, packs: BUNDLE_PACKS })
    kinds.push({ kind: 'etb', name: `${setName} Elite Trainer Box`, msrp: etbMsrp, packs: ETB_PACKS })
    if (!special && !NO_DISPLAY_SETS.has(setId)) kinds.push({ kind: 'display', name: `${setName} Booster Display (36 packs)`, msrp: round2(boosterMsrp * DISPLAY_PACKS), packs: DISPLAY_PACKS })
  }
  // The era shape says a bundle or an ETB is possible; the product registry
  // says whether this set actually shipped one. A wrapper the registry refuses
  // is not generated at all, so a fresh save never grows the row back.
  return kinds.filter((k) => unsellableReason(`${setId}-${k.kind}`) === null)
}

/**
 * Products that are not the set's ordinary booster, bundle, ETB or display:
 * poster and binder collections, tech sticker collections, mini tins and the
 * premium boxes. They are ordinary `pack_products` rows so the shop, opener and
 * manifest read one table, and their pack count and promo list come from the
 * per-product evidence row rather than from an era default.
 */
function seedSpecialProducts(): number {
  const upsert = db.prepare(
    `INSERT INTO pack_products (id, set_id, name, kind, msrp, market_price, packs, cards_per_pack, release_date, description)
     VALUES (@id, @set_id, @name, @kind, @msrp, NULL, @packs, @cards_per_pack, @release_date, @description)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, kind = excluded.kind, msrp = excluded.msrp, packs = excluded.packs,
       cards_per_pack = excluded.cards_per_pack, release_date = excluded.release_date,
       description = excluded.description`,
  )
  const exists = db.prepare('SELECT 1 FROM pack_products WHERE id = ?')
  // Box art a row carries as evidence wins over the set symbol, but never over
  // artwork the set's own matcher already found: the evidence claims are for
  // SKUs the matcher does not know (the Enhanced and half displays).
  const setArt = db.prepare("UPDATE pack_products SET image_url = ? WHERE id = ? AND (image_url IS NULL OR image_url = '')")
  // A row whose art does not exist must not keep a stale URL from an earlier
  // pass: a 403 image renders worse than the set symbol.
  const clearArt = db.prepare('UPDATE pack_products SET image_url = NULL WHERE id = ? AND image_url IS NOT NULL')
  // A split variant's photo is part of the claim, not a fallback.
  const exactArt = db.prepare('UPDATE pack_products SET image_url = ? WHERE id = ?')
  const hasCards = db.prepare('SELECT 1 FROM cards WHERE set_id = ? LIMIT 1')
  let added = 0
  const tx = db.transaction(() => {
    for (const p of SPECIAL_PRODUCTS) {
      // A set with no synced cards has no wrapper to open; the row would be a
      // phantom on the shelf.
      if (!hasCards.get(p.setId)) continue
      // `p.cardsPerPack` is the physical wrapper. `cards_per_pack` on this row
      // is what the opener deals, and the two are not always the same: the
      // 30th Celebration wrapper holds six cards and the game's ten-card
      // abstraction deals ten of them. Resolve the game count through the same
      // blueprint `rollPack` reads, so the shelf, slot list and opener agree.
      const cardsPerPack = Math.max(
        1,
        planFor(p.setId, p.cardsPerPack).reduce((a, slot) => a + slot.count, 0),
      )
      const before = exists.get(p.id)
      upsert.run({
        id: p.id,
        set_id: p.setId,
        name: p.name,
        kind: p.kind ?? 'special',
        msrp: p.msrp,
        packs: p.packs,
        cards_per_pack: cardsPerPack,
        release_date: p.releaseDate,
        description: p.description,
      })
      if (p.image) {
        if (ART_EXACT.has(p.id)) exactArt.run(p.image, p.id)
        else setArt.run(p.image, p.id)
      }
      if (ART_LESS_PRODUCTS[p.id]) clearArt.run(p.id)
      if (!before) added++
    }
    // An era ETB's quote comes from a TCGplayer listing, and that listing's
    // photo is the box. Art already found by the set matcher is kept.
    for (const [id, quote] of Object.entries(ETB_SHELF)) {
      setArt.run(`https://tcgplayer-cdn.tcgplayer.com/product/${quote.productId}_in_400x400.jpg`, id)
    }
    // The per-set Pokémon Center boxes carry a TCGplayer quote too; its listing
    // photo is the box, so fill art from it where the set matcher left none.
    for (const [id, quote] of Object.entries(PC_ETB_SHELF)) {
      setArt.run(`https://tcgplayer-cdn.tcgplayer.com/product/${quote.productId}_in_400x400.jpg`, id)
    }
    // Special collections, tins and blisters are not one of the four kinds the
    // tcgcsv matcher knows, so their exact listings are named here. This also
    // covers the 30th Celebration local-release rows, which are inserted after
    // the generic catalogue has already been seeded.
    for (const id of new Set([...Object.keys(PRODUCT_IMAGE_PRODUCT_IDS), ...Object.keys(LOCAL_PRODUCT_IMAGES)])) {
      const image = productImageFor(id)
      if (image) setArt.run(image, id)
    }
  })
  tx()
  return added
}

/** Seed pack_products for every synced set that lacks products (INSERT OR IGNORE keeps existing rows). */
export function ensureFullCatalog(): number {
  // Old saves still carry rows for wrappers no shop ever stocked. Clear them
  // before seeding, so the products this pass reports adding are all real.
  const pruned = pruneNeverShippedProducts()
  const sets = db
    .prepare(
      `SELECT s.id, s.name, s.series, s.release_date,
              (SELECT COUNT(*) FROM cards c WHERE c.set_id = s.id) AS n
       FROM sets s WHERE s.id IN (SELECT DISTINCT set_id FROM cards)`,
    )
    .all() as { id: string; name: string; series: string; release_date: string; n: number }[]
  const insert = db.prepare(
    `INSERT OR IGNORE INTO pack_products (id, set_id, name, kind, msrp, market_price, packs, cards_per_pack, release_date, description)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)`,
  )
  // A product's card count is the plan the roller deals, not a fixed ten:
  // Celebrations' real pack is four. Existing rows are corrected too, so a
  // save that seeded them as ten stops advertising a pack it never deals.
  const updatePerPack = db.prepare('UPDATE pack_products SET cards_per_pack = ? WHERE id = ? AND cards_per_pack <> ?')
  // Product evidence can correct an era default: Crown Zenith's ETB holds ten
  // packs, not the nine the modern line otherwise uses.
  const updatePacks = db.prepare('UPDATE pack_products SET packs = ? WHERE id = ? AND packs <> ?')
  let added = 0
  const tx = db.transaction(() => {
    for (const s of sets) {
      if (s.n === 0) continue // no synced cards → nothing to rip
      const perPack = planFor(s.id, 10).reduce((a, slot) => a + slot.count, 0)
      for (const k of productsForSet(s.id, s.name, s.series, s.release_date)) {
        const id = `${s.id}-${k.kind}`
        const evidence = sealedEvidenceFor(id)
        const packs = evidence?.packs ?? k.packs
        const r = insert.run(id, s.id, k.name, k.kind, k.msrp, packs, perPack, s.release_date)
        added += r.changes
        if (r.changes === 0) {
          updatePerPack.run(perPack, id, perPack)
          updatePacks.run(packs, id, packs)
        }
      }
      // The Pokémon Center ETB is the same set's premium box: eleven packs and
      // the promo twice, at the $59.99 Pokémon Center charged. It is not an
      // era-format product, so its name and date come from the set row.
      if (PC_ETB_SETS.has(s.id)) {
        const id = `${s.id}-etb-pc`
        const r = insert.run(
          id,
          s.id,
          `${s.name} Pokémon Center Elite Trainer Box`,
          'etb',
          59.99,
          11,
          perPack,
          s.release_date,
        )
        added += r.changes
        if (r.changes === 0) {
          updatePerPack.run(perPack, id, perPack)
          updatePacks.run(11, id, 11)
        }
      }
      // A wrapper that only ever came inside a box still needs a row of its own:
      // it is the table those boxes deal from, never a shelf item. productsForSet
      // refuses to generate it because no shop sold it alone, so a fresh save
      // never grew the row — and every box of Double Crisis, Dragon Vault,
      // Generations or the 30th Celebration UPC died with "Pull table missing"
      // the first time it was opened, on a machine whose save was new. The row is
      // created here, pruneNeverShippedProducts spares these ids by name, and
      // sellsProduct keeps them off the shelf.
      const hostId = `${s.id}-booster`
      if (PULL_TABLE_HOSTS.has(hostId)) {
        added += insert.run(hostId, s.id, `${s.name} Booster Pack`, 'booster', 0, 1, perPack, s.release_date).changes
      }
    }
  })
  tx()
  added += seedSpecialProducts()
  if (added > 0 || pruned > 0) markCatalogChanged()
  return added
}

// ---------------------------------------------------------------------------
// Pricing: sealed_prices holds real lookups; pack_products.market_price is
// refreshed from it. Fallback = derived per-pack value from the set's pulls.
// ---------------------------------------------------------------------------

type SealedPriceRow = { market: number; source: string; retrieved_at: string }

// ---------------------------------------------------------------------------
// Out-of-print appreciation. Real sealed product leaves print roughly 12–24
// months after a set's release, and boxes only climb from there — supply
// shrinks while collectors keep ripping. The curve below models the real
// shape: slow growth while in print, inflection at OOP, strongest gains in
// the first years, then a long taper (vintage boxes keep compounding, but
// modestly — their price is already high).
// ---------------------------------------------------------------------------

const PRINT_RUN_MONTHS = 24
const SPECIAL_PRINT_RUN_MONTHS = 10

/**
 * Months since this set's product left print (≥0 = out of print). Half/special
 * sets (.5/pt5) get the shorter print run their product line always implied —
 * they exist to be scalped — identified by setId since kinds are era-generic.
 */
export function monthsOutOfPrint(releaseDate: string, kind: string, setId?: string): number {
  const release = new Date(releaseDate)
  if (Number.isNaN(release.getTime())) return 0
  const isSpecial = setId != null ? setId.includes('.5') || setId.endsWith('pt5') : kind === 'special'
  const runMonths = isSpecial ? SPECIAL_PRINT_RUN_MONTHS : PRINT_RUN_MONTHS
  const eop = new Date(release)
  eop.setMonth(eop.getMonth() + runMonths)
  return Math.max(0, (Date.now() - eop.getTime()) / (1000 * 60 * 60 * 24 * 30.44))
}

/** Months since the set hit shelves (used for the launch taper below). */
export function monthsSinceRelease(releaseDate: string): number {
  const release = new Date(releaseDate)
  if (Number.isNaN(release.getTime())) return 0
  return (Date.now() - release.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
}

/**
 * Launch ramp for the DERIVED estimate only: the appreciation curve models a
 * box that already trades as a collectible, so applying it to product that
 * just hit shelves instantly marks up fresh releases. Fresh sets are in print
 * and fully liquid — their estimate should sit near the retail/pull value and
 * let scarcity build. The multiplier ramps from 1 at release to the full curve
 * value across LAUNCH_RAMP_MONTHS. Real PriceCharting prices are never tapered.
 */
const LAUNCH_RAMP_MONTHS = 18
export function launchAdjustedMultiplier(mult: number, monthsSince: number): number {
  if (mult <= 1) return 1
  if (monthsSince >= LAUNCH_RAMP_MONTHS) return mult
  const t = Math.max(0, monthsSince) / LAUNCH_RAMP_MONTHS
  return 1 + (mult - 1) * t
}

/**
 * Appreciation multiplier of market value over retail-derived value for a
 * product that has been out of print for `m` months. In-print products (m=0)
 * sit at retail; the curve then climbs, strongest in the first years and
 * tapering toward a per-kind ceiling: packs get ripped so they appreciate
 * least, sealed displays are the investor grade and appreciate most.
 * Booster lands ~2.1× at 1yr OOP, ~3× at 2yr, ~4.6× at 5yr, capped at 6×.
 */
export function oopMultiplier(m: number, kind = 'booster'): number {
  if (m <= 0) return 1
  const cap = kind === 'booster' ? 6 : kind === 'bundle' ? 8 : kind === 'etb' ? 10 : 12
  return 1 + (cap - 1) * (1 - Math.exp(-m / 48))
}

/**
 * The share of a card's listed market value a player can actually collect.
 *
 * Market value is a sticker, not money: every route out of the binder pays
 * less. The instant dealer pays 70–92% (up to 0.92), a market listing is
 * market minus the 10% commission (sellroutes.ts MARKET_FEE), the best buylist
 * is 75% and the pawn shop 40%. The floor uses the best of them, so pricing at
 * it cannot be turned into a profit by any route even in the ideal case, while
 * a box may still sit below its contents' sticker price the way real boxes do.
 */
export const SEALED_REALIZATION = 0.92

/**
 * A sold sealed product may not cost less than the packs it contains are
 * expected to *realize*.
 *
 * In-print shelves used to sit at MSRP even when the chase EV was several
 * times higher, so a $4.49 booster could be a guaranteed money printer and a
 * six-pack bundle inherited the same gap. The floor is per-pack EV × the
 * product's real pack count × SEALED_REALIZATION, applied to stored real
 * quotes too: a pull is worth what selling it pays, not what the listing says.
 * It skips hidden products: their rows are kept for owned stock, not sold, so
 * repricing a fabricated wrapper at its pull EV would only inflate inventory.
 * Mini packs price from their own three-card composition and return before
 * this floor is reached.
 */
function atLeastPackEv(setId: string, packs: number | null, market: number): number {
  if (!sellsOwnPacks(setId)) return market
  const n = Math.max(1, Math.floor(packs ?? 1))
  const ev = expectedPackValue(setId) * n * SEALED_REALIZATION
  return ev > market ? round2(ev) : market
}

/**
 * How much more a box may cost per wrapper than a loose wrapper of the same set.
 *
 * Measured, not picked: across the 38 displays whose set also has a loose-wrapper
 * quote (TCGplayer market and PriceCharting sold values, November 2026), a box
 * costs 0.22x to 2.03x the wrapper per pack — median 1.09x, p90 1.83x — and 2.03x
 * is the widest a full thirty-six-pack box reaches (Phantom Forces: a $16,763 box
 * against a $229.72 wrapper). Half displays go further, at 2.17x and 2.74x. A
 * six-box CASE quote, the other mistake this catches, runs 6-8x. So the ceiling is
 * 2.05, just past the widest real box: no full box a marketplace quotes is trimmed,
 * and what it does trim are the half displays asking more per pack than their own
 * set's thirty-six-pack box.
 *
 * The reference is a real loose-wrapper quote, never the pack model. Comparing a
 * real box against a modelled pack is what made an earlier 2x band cut Evolving
 * Skies' genuine $2,179 box down to $720: the box was right and the model was
 * four times under what a single sealed pack costs.
 */
export const DISPLAY_PACK_CAP = 2.05

function capDisplayPerPack(setId: string, packs: number | null, market: number): number {
  const n = Math.max(1, Math.floor(packs ?? 1))
  if (!(market > 0)) return market
  // The reference is a loose wrapper with a QUOTE of its own: same set, same
  // marketplace, one pack against thirty-six. A modelled pack is not a reference
  // — it is what the cards inside the wrapper are worth, which for a collector
  // set is a quarter of the wrapper's price — so a set whose packs are still
  // modelled keeps its display quote rather than being judged by one. The booster
  // row is a different kind, so it returns before this cap and cannot recurse.
  const ref = priceOf(`${setId}-booster`)
  const pack = ref.market
  if (!(pack > 0) || ref.source === 'estimated') return market
  const cap = pack * n * DISPLAY_PACK_CAP
  return market > cap ? round2(cap) : market
}

/** A display is floored by its pack EV and capped by the wrappers it holds. */
function displayQuote(setId: string, packs: number | null, market: number): number {
  // Cap first, then floor: the pull-EV floor is a `max`, so flooring the raw
  // quote would hand the case price straight back. With the cap applied first a
  // box can only ever be worth the cheaper of the two, and the floor still wins
  // where the cards really are worth more than the band allows.
  return round2(atLeastPackEv(setId, packs, capDisplayPerPack(setId, packs, round2(market))))
}

/**
 * A wrapper quote has to look like a wrapper beside its own box.
 *
 * Measured on boxes a marketplace actually quotes against their own loose packs,
 * a box costs 0.82x to 2.74x the wrapper per pack — halves and dealer discounts
 * included. Outside a factor of three either way, one of the two numbers is not
 * the product it claims to be: the Black & White wrapper rows read $188 against a
 * $656 box ($18.23 a pack) and Plasma Storm read $720.90 against a $1,297 box,
 * which is a box price in a pack row. Such a quote is refused rather than allowed
 * to price a wrapper or anchor a display band; the set keeps its model.
 */
export const WRAPPER_BOX_BAND = { min: 1 / 3, max: 3 } as const

export function wrapperQuoteAgreesWithBox(setId: string, quote: number): boolean {
  if (!(quote > 0)) return false
  // A set with no display has no box to disagree with, and an in-print wrapper is
  // retail-priced rather than resale-priced, so neither is screened: Ascended
  // Heroes' $9.28 wrapper is a sticker on a shelf this month, not a collector
  // quote that can be a box price in a pack row.
  const hasDisplay = db.prepare(`SELECT 1 AS n FROM pack_products WHERE id = ?`).get(`${setId}-display`) !== undefined
  if (!hasDisplay) return true
  const rel = db.prepare(`SELECT release_date FROM sets WHERE id = ?`).get(setId) as { release_date: string } | undefined
  if (rel && monthsOutOfPrint(rel.release_date, 'display', setId) <= 0) return true
  // A box's own quote is preferred. A modelled box is only a plausibility screen
  // here, never a price: it is what tells us a quote is impossible, not what the
  // wrapper sells for.
  const quoted = shelfPriceFor(`${setId}-display`)
  const box = quoted && quoted.market > 0 ? quoted.market : derivedPrice(setId, 'display')
  const perPack = box / 36
  if (!(perPack > 0)) return true
  const r = perPack / quote
  return r >= WRAPPER_BOX_BAND.min && r <= WRAPPER_BOX_BAND.max
}

/** The pull-EV floor for every kind; a display also gets the per-pack band. */
function sealedMarket(setId: string, kind: string, packs: number | null, market: number): number {
  return kind === 'display' ? displayQuote(setId, packs, market) : atLeastPackEv(setId, packs, market)
}

export function priceDetail(productId: string): {
  market: number
  source: 'pricecharting' | 'tcgplayer' | 'pokeinvest' | 'estimated'
  oopMonths: number
  oop: boolean
  multiplier: number
  status: 'in print' | 'out of print'
} {
  const row = db
    .prepare(`SELECT set_id, kind, msrp, packs FROM pack_products WHERE id = ?`)
    .get(productId) as { set_id: string; kind: string; msrp: number; packs: number | null } | undefined
  if (!row) return { market: 0, source: 'estimated', oopMonths: 0, oop: false, multiplier: 1, status: 'in print' }
  // A General Mills mini pack holds three cards, not ten: the per-pack EV model
  // below is a booster's shape and would price it like a display. It sits at its
  // own shelf price, and a PriceCharting lookup is never run for it (that would
  // match some other product's listing and overwrite the price).
  const mini = miniPackFor(productId)
  if (mini) {
    const rel = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(row.set_id) as { release_date: string } | undefined
    const m = rel ? monthsOutOfPrint(rel.release_date, row.kind, row.set_id) : 0
    return { market: round2(mini.msrp), source: 'estimated', oopMonths: Math.round(m), oop: m > 0, multiplier: 1, status: m > 0 ? 'out of print' : 'in print' }
  }
  // A published quote for the exact product outranks any model of it, whatever
  // its kind: the Enhanced display and the half displays are real marketplace
  // SKUs whose quotes differ from a format-derived estimate. The pull-EV floor
  // is deliberately not applied on top — it exists to stop a MODELLED shelf
  // price from being a money printer, while a real quote is what buyers pay.
  // Floors on real quotes would not be harmless here: Delta Reign's modelled
  // pack EV is $15.80 against the $7.57 its packs trade at on the same
  // marketplace, so flooring the real $19.05 three-pack would replace the truth
  // with the model.
  const shelf = shelfPriceFor(productId)
  // A loose wrapper's quote is screened against its own box before it is allowed
  // to price anything: a wrapper costing a third of a box's per-pack price, or
  // three times it, is a different product's number wearing a pack's name. The
  // set falls back to its model rather than taking the impossible figure.
  const shelfUsable = shelf !== null && (row.kind !== 'booster' || wrapperQuoteAgreesWithBox(row.set_id, shelf.market))
  if (shelf && shelfUsable) {
    const rel = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(row.set_id) as { release_date: string } | undefined
    const s = rel ? monthsOutOfPrint(rel.release_date, row.kind, row.set_id) : 0
    // A DISPLAY is the one real quote that still gets the floor, because a
    // display is thirty-six wrappers and nothing else — no sleeves, dice, binder
    // or promo to justify a price under its contents. The marketplace discounts
    // boxes, and in a game where the box can be ripped that discount is a
    // guaranteed margin: Delta Reign's box traded at $187.23 ($5.20 a pack)
    // while the same set's packs cost $5.91 each and the cards they deal are
    // modelled at $6.88, so ripping it paid about 32% every time — and the bulk
    // rip made that arithmetic repeatable at scale. Single wrappers keep their
    // quote (that IS what a wrapper costs) and collections keep theirs (the
    // extras and the promo inside them are part of the price).
    const quoted = row.kind === 'display' ? displayQuote(row.set_id, row.packs, shelf.market) : round2(shelf.market)
    return {
      market: quoted,
      source: shelf.kind ?? 'tcgplayer',
      oopMonths: Math.round(s),
      oop: s > 0,
      multiplier: 1,
      status: s > 0 ? 'out of print' : 'in print',
    }
  }
  // A special collection shares the kind 'special' with a mini tin, a poster
  // collection and a premium box, so a kind-derived price would charge all of
  // them the same. They sell at their published shelf price, floored by what the
  // packs inside are worth and including the promo the box guarantees.
  if (row.kind === 'special') {
    const rel = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(row.set_id) as { release_date: string } | undefined
    const s = rel ? monthsOutOfPrint(rel.release_date, row.kind, row.set_id) : 0
    const base = row.msrp > 0 ? row.msrp : derivedPrice(row.set_id, row.kind, productId)
    return {
      market: atLeastPackEv(row.set_id, row.packs, round2(base + promoValueOf(productId))),
      source: 'estimated',
      oopMonths: Math.round(s),
      oop: s > 0,
      multiplier: 1,
      status: s > 0 ? 'out of print' : 'in print',
    }
  }
  const release = db
    .prepare(`SELECT release_date FROM sets WHERE id = ?`)
    .get(row.set_id) as { release_date: string } | undefined
  const m = release ? monthsOutOfPrint(release.release_date, row.kind, row.set_id) : 0
  const mult = launchAdjustedMultiplier(oopMultiplier(m, row.kind), release ? monthsSinceRelease(release.release_date) : 999)
  // Population & meta drift: once a product is OUT of print its long-term
  // value profile is demand-driven, not a fixed curve — the set's chase/bulk
  // cohort heat, its era's taste, and any live boom scale the whole curve
  // (demographics.ts). In-print product stays at retail: the presses are
  // running, so the scene's weather can't move a shelf price.
  // Demand heat moves collector-era boxes only: modern sealed is priced at its
  // contents, so the scene would be one more factor with nothing to stack on.
  const year = release ? Number(release.release_date.slice(0, 4)) : 0
  const scene = m > 0 && year > 0 && year < 2011 ? sealedFactor(row.set_id) : 1
  const promo = promoValueOf(productId)
  const stored = storedPrice(productId)
  if (stored && stored.source === 'pricecharting' && stored.market > 0) {
    return { market: sealedMarket(row.set_id, row.kind, row.packs, round2(round2(stored.market * scene) + promo)), source: 'pricecharting', oopMonths: Math.round(m), oop: m > 0, multiplier: round2(mult), status: m > 0 ? 'out of print' : 'in print' }
  }
  return { market: sealedMarket(row.set_id, row.kind, row.packs, round2(round2(derivedPrice(row.set_id, row.kind, productId) * scene) + promo)), source: 'estimated', oopMonths: Math.round(m), oop: m > 0, multiplier: round2(mult), status: m > 0 ? 'out of print' : 'in print' }
}

function storedPrice(productId: string): SealedPriceRow | null {
  return db
    .prepare(`SELECT market, source, retrieved_at FROM sealed_prices WHERE product_id = ?`)
    .get(productId) as SealedPriceRow | null
}

export function derivedPrice(setId: string, kind: string, productId?: string): number {
  // Realistic per-pack value from the set's actual pull table: weighted average
  // of a pack (5 commons + 3 uncommons + 1 holo + 1 hit), hits weighted heavy —
  // sealed boxes trade on their chase cards.
  const cacheKey = setId + '|' + kind + (productId ? '|' + productId : '')
  const cached = derivedCache.get(cacheKey)
  if (cached !== undefined) return cached
  // The row's own pack count and MSRP, not a kind guess: a special collection
  // can hold five, eight or twenty-nine packs instead of a display's
  // thirty-six, and a half display holds eighteen. The MSRP fallback follows
  // the same row, so half a box is never priced at the full box's sticker.
  const productRow = db.prepare(`SELECT packs, msrp FROM pack_products WHERE id = ?`).get(productId ?? `${setId}-${kind}`) as { packs: number | null; msrp: number | null } | undefined
  const packs = Math.max(1, Math.floor(productRow?.packs ?? 1))
  const ownMsrp = productRow?.msrp && productRow.msrp > 0 ? productRow.msrp : msrpFallback(setId, kind, productId)
  // Same structure and odds the roller uses: 4 commons, 3 uncommons, a rare,
  // a reverse holo, and the final card at the era's real hit odds. Sealed boxes
  // trade on the chase cards, and that is now measured rather than fudged.
  const perPack = expectedPackValue(setId)
  if (perPack <= 0) return ownMsrp
  // IN-PRINT sets sell at retail, not at chase-card EV: store shelves price a
  // pack at MSRP no matter what the hit slot comps at — the rip-risk (and the
  // rare double-hit) is the buyer's gamble, and supply is unlimited while the
  // presses run. The pull-EV floor is the exception: a wrapper may not sell
  // below the cards it is expected to deal.
  const rel = db.prepare(`SELECT release_date FROM sets WHERE id = ?`).get(setId) as { release_date: string } | undefined
  if (rel) {
    const oopNow = monthsOutOfPrint(rel.release_date, kind, setId)
    if (oopNow <= 0) return atLeastPackEv(setId, packs, ownMsrp)
  }
  // Anchor every kind to the booster EV, then scale with pack count. Real sealed
  // boxes trade BELOW per-pack × count (dealers discount the rip-risk), with ETBs
  // holding value best (exclusive promos) and raw boxes discounting hardest.
  // That discount cannot go below the raw content EV — see atLeastPackEv below.
  const cap = kind === 'booster' ? 30 : kind === 'bundle' ? 90 : kind === 'etb' ? 350 : 700
  const boxFactor = kind === 'booster' ? 1 : kind === 'bundle' ? 1.0 : kind === 'etb' ? 0.92 : 0.8
  // Out-of-print appreciation: sealed only gets rarer after the print run ends —
  // ramped in over the launch window so fresh releases start near retail.
  const release = db.prepare(`SELECT release_date FROM sets WHERE id = ?`).get(setId) as { release_date: string } | undefined
  const oop = release
    ? launchAdjustedMultiplier(oopMultiplier(monthsOutOfPrint(release.release_date, kind, setId), kind), monthsSinceRelease(release.release_date))
    : 1
  // Modern sealed trades at its contents, not at contents × scarcity. The
  // out-of-print curve is a collector-appreciation model, and applying it to a
  // content EV that is already a today's market figure charges scarcity twice:
  // a $55 Crown Zenith ETB holding $180 of packs priced at $790. Boxes from the
  // collector era (pre-2011) keep the curve — there the sealed box is itself the
  // asset, and the contents alone cannot reach its market.
  const year = release ? Number(release.release_date.slice(0, 4)) : 0
  const modernSealed = year >= 2011
  const est = modernSealed
    ? perPack * packs * boxFactor * SEALED_REALIZATION
    : Math.min(perPack * packs * boxFactor, cap * oop) * oop
  const floor = SEALED_FLOOR[kind] ?? SEALED_FLOOR.display
  const result = atLeastPackEv(setId, packs, round2(Math.max(floor, est)))
  derivedCache.set(cacheKey, result)
  return result
}

// Memoized per set+kind — `valueOf` hits the DB per card, and the shop route
// prices the whole 500-product catalog per request. Cleared when a pull table
// is rebuilt (values change).
const derivedCache = new Map<string, number>()

// Derived sealed prices are built from the set's pack EV, so any price or
// catalogue move must drop the whole set+kind map.
onDerivedDataChanged(() => derivedCache.clear())

export function invalidateDerivedPrices(setId: string) {
  for (const k of derivedCache.keys()) if (k.startsWith(setId + '|')) derivedCache.delete(k)
}

/** The least a kind of sealed product can be worth, whatever its contents say. */
export const SEALED_FLOOR: Record<string, number> = { booster: 2.5, bundle: 18, etb: 32, display: 90 }

/**
 * The promo sealed in a product, weighted by the chance it is the one in the
 * box: evidence names the card(s), and a one-of-two box carries half of each.
 * Without this the shop would sell a box below the guaranteed card inside it.
 */
export function promoValueOf(productId: string): number {
  const e = sealedEvidenceFor(productId)
  if (!e?.promoIds?.length) return 0
  const sum = e.promoIds.reduce((a, id) => a + Math.max(0, Number(valueOf(id) || 0)), 0)
  // A one-of box carries half of each on average. A box documented to hold
  // EVERY named promo is worth all of them, so dividing always underprices the
  // UPC and summing always overprices a blister. The evidence says which it is.
  return e.promoPolicy === 'all' ? round2(sum) : round2(sum / e.promoIds.length)
}

function msrpFallback(setId: string, kind: string, productId?: string): number {
  const row = db.prepare(`SELECT msrp FROM pack_products WHERE id = ?`).get(productId ?? `${setId}-${kind}`) as { msrp: number } | undefined
  return round2(row?.msrp ?? 4.49)
}

/** The live price of a product: stored real lookup → derived estimate. */
export function priceOf(productId: string): { market: number; source: 'pricecharting' | 'tcgplayer' | 'pokeinvest' | 'estimated' } {
  const d = priceDetail(productId)
  return { market: d.market, source: d.source }
}

/**
 * The cheap half of priceDetail: which source would price this row, and its
 * print status. It deliberately never calls the EV model, so the product list
 * can paint its QUOTE/MODEL and OOP badges before any pack is weighed.
 */
export function shelfFacts(productId: string): {
  source: 'pricecharting' | 'tcgplayer' | 'pokeinvest' | 'estimated'
  oopMonths: number
  oop: boolean
  status: 'in print' | 'out of print'
} {
  const row = db
    .prepare('SELECT set_id, kind FROM pack_products WHERE id = ?')
    .get(productId) as { set_id: string; kind: string } | undefined
  if (!row) return { source: 'estimated', oopMonths: 0, oop: false, status: 'in print' }
  const release = db
    .prepare('SELECT release_date FROM sets WHERE id = ?')
    .get(row.set_id) as { release_date: string } | undefined
  const months = release ? monthsOutOfPrint(release.release_date, row.kind, row.set_id) : 0
  const shelf = shelfPriceFor(productId)
  const stored = storedPrice(productId)
  // The badge has to say what the price is: a wrapper quote the screen refused is
  // not pricing this row, so the row reports the model it is actually priced at
  // rather than citing a quote that only appears in the evidence.
  const shelfUsed = shelf !== null && (row.kind !== 'booster' || wrapperQuoteAgreesWithBox(row.set_id, shelf.market))
  const source = miniPackFor(productId)
    ? 'estimated'
    : shelfUsed
      ? (shelf!.kind ?? 'tcgplayer')
      : row.kind === 'special'
        ? 'estimated'
        : stored && stored.source === 'pricecharting' && stored.market > 0
          ? 'pricecharting'
          : 'estimated'
  return {
    source,
    oopMonths: Math.round(months),
    oop: months > 0,
    status: months > 0 ? 'out of print' : 'in print',
  }
}

// PC sealed queries: their catalog titles use human set names.
function pcSealedQuery(setName: string, kind: string): string {
  const suffix = kind === 'booster' ? 'Booster Pack' : kind === 'display' ? 'Booster Box' : kind === 'etb' ? 'Elite Trainer Box' : 'Booster Bundle'
  return `Pokemon ${setName} ${suffix}`
}

function scoreSealed(title: string, setName: string, kind: string): number {
  const t = title.toLowerCase()
  const set = setName.toLowerCase()
  if (!t.includes(set)) return -1
  let score = 1
  const want = kind === 'booster' ? ['booster pack', 'booster'] : kind === 'display' ? ['booster box'] : kind === 'etb' ? ['elite trainer box'] : ['booster bundle']
  for (const w of want) if (t.includes(w)) score += 3
  // Reject sealed products of other kinds.
  const rejects = kind === 'booster' ? ['box', 'bundle', 'etb', 'elite', 'display'] : kind === 'display' ? ['pack', 'bundle', 'etb', 'elite', 'theme'] : kind === 'etb' ? ['booster box', 'booster pack', 'bundle', 'theme'] : ['booster box', 'booster pack', 'etb', 'elite', 'theme']
  for (const r of rejects) if (t.includes(r)) score -= 4
  if (/first edition|1st edition|shadowless/.test(t)) score -= 2 // keep the common printing
  return score
}

async function lookupSealed(setName: string, kind: string): Promise<number | null> {
  const envToken = process.env.PRICECHARTING_TOKEN
  const row = envToken && envToken.trim() ? envToken : (db.prepare(`SELECT value FROM settings WHERE key = 'pricechartingToken'`).get() as { value: string } | undefined)?.value
  const token = row && row.trim() ? row.trim() : null
  if (!token) return null
  if (pcAuthFailed()) return null // token known-bad — don't re-test it on every product
  const q = pcSealedQuery(setName, kind)
  const searchUrl = `https://www.pricecharting.com/api/products?t=${encodeURIComponent(token)}&q=${encodeURIComponent(q)}`
  await sleep(1100)
  const search = await fetchJson<{ status: string; 'error-message'?: string; products?: { id: string; 'product-name': string; 'console-name': string }[] }>(searchUrl)
  if (search.status === 'error') {
    markPcAuthFailure(search['error-message'])
    return null
  }
  if (search.status !== 'success' || !search.products?.length) return null
  const ranked = search.products
    .filter((p) => /pokemon/i.test(p['console-name']))
    .map((p) => ({ p, score: scoreSealed(p['product-name'], setName, kind) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]?.p
  if (!best) return null
  await sleep(1100)
  const product = await fetchJson<{ status: string; 'loose-price'?: number }>(`https://www.pricecharting.com/api/product?t=${encodeURIComponent(token)}&id=${best.id}`)
  if (product.status !== 'success' || product['loose-price'] == null) return null
  return Math.round(product['loose-price']) / 100
}

const insertSealed = db.prepare(
  `INSERT INTO sealed_prices (product_id, market, source, retrieved_at) VALUES (?, ?, 'pricecharting', ?)
   ON CONFLICT(product_id) DO UPDATE SET market = excluded.market, source = 'pricecharting', retrieved_at = excluded.retrieved_at`,
)

export async function refreshSealedPrice(productId: string): Promise<'pricecharting' | 'unchanged'> {
  const p = db.prepare(`SELECT set_id, kind, msrp, packs FROM pack_products WHERE id = ?`).get(productId) as { set_id: string; kind: string; msrp: number; packs: number | null } | undefined
  if (!p) return 'unchanged'
  // Mini packs are a cereal promotion with no sealed listing of its own; a set
  // name + kind query would return a different product's price.
  if (miniPackFor(productId)) return 'unchanged'
  const setName = (db.prepare(`SELECT name FROM sets WHERE id = ?`).get(p.set_id) as { name: string } | undefined)?.name
  if (!setName) return 'unchanged'
  const derived = derivedPrice(p.set_id, p.kind)
  try {
    const price = await lookupSealed(setName, p.kind)
    if (price == null || price <= 0) return 'unchanged'
    // Sanity: reject wild mismatches (>30x the derived estimate) — wrong product.
    if (price > Math.max(derived * 30, 500)) return 'unchanged'
    const quoted = atLeastPackEv(p.set_id, p.packs, round2(price))
    insertSealed.run(productId, quoted, nowIso())
    db.prepare(`UPDATE pack_products SET market_price = ? WHERE id = ?`).run(quoted, productId)
    markPricesChanged()
    return 'pricecharting'
  } catch {
    return 'unchanged'
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Selling sealed stock — dealers rip, investors sell. The market pays what
// the product is worth today (appreciation included), minus a dealer fee.
// ---------------------------------------------------------------------------

export function sellSealed(productId: string, qty: number): { ok: true; units: number; unitPrice: number; gross: number; fee: number; proceeds: number; basis: number; profit: number } | { ok: false; error: string } {
  const n = Math.max(1, Math.floor(qty))
  // Sealed stock is stored in lot rows (quantity per row, per-unit cost) —
  // walk rows FIFO, deplete the last one partially if needed.
  const rows = db
    .prepare(`SELECT id, quantity, cost FROM sealed_inventory WHERE product_id = ? ORDER BY acquired_at ASC`)
    .all(productId) as { id: number; quantity: number; cost: number }[]
  let remaining = n
  let units = 0
  let basis = 0
  const dels: number[] = []
  const decs: { id: number; left: number }[] = []
  for (const r of rows) {
    if (remaining <= 0) break
    const take = Math.min(remaining, r.quantity)
    units += take
    basis += take * r.cost
    remaining -= take
    if (take === r.quantity) dels.push(r.id)
    else decs.push({ id: r.id, left: r.quantity - take })
  }
  if (units === 0) return { ok: false, error: 'No sealed stock of that product' }

  const unitPrice = priceOf(productId).market
  const gross = round2(unitPrice * units)
  const fee = round2(gross * 0.1)
  const proceeds = round2(gross - fee)
  basis = round2(basis)
  const profit = round2(proceeds - basis)

  const name = (db.prepare(`SELECT name FROM pack_products WHERE id = ?`).get(productId) as { name: string } | undefined)?.name ?? productId
  const del = db.prepare(`DELETE FROM sealed_inventory WHERE id = ?`)
  const dec = db.prepare(`UPDATE sealed_inventory SET quantity = ? WHERE id = ?`)
  const insertSale = db.prepare(
    `INSERT INTO sale_history (card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
     VALUES (?, NULL, 'Sealed', ?, ?, ?, ?, ?, 'Local collector', 'sealed', ?)`,
  )
  db.transaction(() => {
    for (const id of dels) del.run(id)
    for (const d of decs) dec.run(d.left, d.id)
    insertSale.run(productId, units, proceeds, basis, fee, profit, nowIso())
    db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(proceeds)
    logActivity('sale', `Sold ${units}× ${name} for $${proceeds.toFixed(2)} after 10% fee${profit >= 0 ? ` (+$${profit.toFixed(2)} vs cost)` : ` (−$${Math.abs(profit).toFixed(2)} vs cost)`}`, proceeds)
  })()

  return { ok: true, units, unitPrice, gross, fee, proceeds, basis, profit }
}

let backfillRunning = false
let backfillProgress = { done: 0, total: 0, updated: 0 }

export function backfillStatus() {
  return { running: backfillRunning, ...backfillProgress, configured: sealedTokenConfigured() }
}

function sealedTokenConfigured(): boolean {
  if (process.env.PRICECHARTING_TOKEN && process.env.PRICECHARTING_TOKEN.trim()) return true
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'pricechartingToken'`).get() as { value: string } | undefined
  return Boolean(row?.value && row.value.trim())
}

/**
 * Fetch real sealed prices for products that have none (or are stale >30 days).
 * Paced for PriceCharting's 1 req/sec — run in the background on boot.
 */
export async function backfillSealedPrices(maxProducts = 400): Promise<void> {
  if (backfillRunning) return
  if (!sealedTokenConfigured()) return
  backfillRunning = true
  try {
    const rows = (
      db
        .prepare(
          `SELECT p.id, p.set_id FROM pack_products p
           LEFT JOIN sealed_prices sp ON sp.product_id = p.id
           WHERE sp.product_id IS NULL OR sp.retrieved_at < datetime('now', '-30 days')
           ORDER BY p.release_date DESC LIMIT ?`,
        )
        .all(maxProducts) as { id: string; set_id: string }[]
      // A pull-table host was never sold, so it has no shelf price to fetch —
      // a lookup would match a different product by name and store its price.
    ).filter((r) => sellsProduct(r.id, r.set_id))
    backfillProgress = { done: 0, total: rows.length, updated: 0 }
    for (const r of rows) {
      const res = await refreshSealedPrice(r.id)
      backfillProgress.done++
      if (res === 'pricecharting') backfillProgress.updated++
    }
    setMeta('sealedBackfilledAt', nowIso())
    console.log(`[sealed] backfill complete: ${backfillProgress.updated}/${backfillProgress.total} real sealed prices`)
  } finally {
    backfillRunning = false
  }
}

/** Kick the backfill without awaiting — used on boot. */
export function startSealedBackfill() {
  ensureFullCatalog()
  void backfillSealedPrices().catch((e) => console.warn('[sealed] backfill failed:', e instanceof Error ? e.message : e))
}

// Boot-time table creation is handled by schema.sql; lazily create for older DBs here.
export function ensureSealedTable() {
  try {
    db.prepare(`SELECT 1 FROM sealed_prices LIMIT 1`).get()
  } catch {
    db.exec(`CREATE TABLE IF NOT EXISTS sealed_prices (
      product_id TEXT PRIMARY KEY,
      market REAL NOT NULL,
      source TEXT NOT NULL,
      retrieved_at TEXT NOT NULL
    )`)
  }
}

void getMeta
