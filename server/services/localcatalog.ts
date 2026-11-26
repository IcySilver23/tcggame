import localReleases from '../catalog/local-releases.json'
import regionalReleases from '../catalog/regional-releases.json'
import { db, getMeta, setMeta, nowIso, logActivity } from '../lib/db'
import { markCatalogChanged } from '../lib/derived-cache'
import * as packs from './packs'
import * as sealed from './sealed'

// ---------------------------------------------------------------------------
// Releases the upstream catalog does not carry yet.
//
// pokemontcg.io is the catalog, but it publishes on its own schedule: the 30th
// Celebration Wave 4 products and Delta Reign (ME6) went on sale on 2026-11-06
// while the API's newest set was still me55 from September. Waiting for the API
// would mean a game where a released set cannot be opened, bought or priced, so
// the release ships beside the code in catalog/local-releases.json and this
// loader upserts it through the same tables the API sync writes: sets, cards,
// prices, sealed products, then the set's pull table.
//
// It is additive and idempotent — it inserts what is missing, refreshes the
// fields it owns, and never deletes or renames a synced row. Once the API
// publishes the same set, its rows simply win on the next sync, because the
// sync's retrieved_at is later and its card fields overwrite these.
// ---------------------------------------------------------------------------

// Bundled into the server on purpose: the packaged build is CJS inside a Node
// single executable, where import.meta.url does not exist. A runtime path here
// crashed the exe before the API could boot.
const APPLIED_META = 'catalog:localReleases'

// A separate marker, because the two files are applied independently: a save can
// hold the Delta Reign wave without the Chinese Gem Pack, or the other way round.
const REGIONAL_APPLIED_META = 'catalog:regionalReleases'

type LocalSet = {
  id: string
  name: string
  series: string
  printed_total: number
  total: number
  ptcgo_code: string | null
  release_date: string
  symbol_url: string | null
  logo_url: string | null
}

type LocalCard = {
  id: string
  /** Printed tier (Gem C/U/R/RR/RRR), used only to weight the pull table. */
  tier?: string
  set_id: string
  name: string
  supertype: string
  subtypes: string[] | null
  number: string
  position: number
  rarity: string | null
  types: string[] | null
  hp: number | null
  artist: string | null
  dex_numbers: number[] | null
  image_small: string | null
  image_large: string | null
  regulation_mark: string | null
  price: { market: number; variant: string } | null
}

type LocalProduct = {
  id: string
  set_id: string
  name: string
  kind: string
  msrp: number
  packs: number
  cards_per_pack: number
  release_date: string
  description: string | null
  /** A published picture of the product itself, when one exists (Gem Pack wrappers). */
  image_url?: string | null
}

type LocalReleases = {
  release: string
  note?: string
  sets: LocalSet[]
  cards: LocalCard[]
  products: LocalProduct[]
  /**
   * Sets whose whole population is one foil pool, so the pack deals from all of
   * it: Gem Pack prints no commons and no reverse holos, and the era table's
   * common/uncommon/reverse slots have nothing to fill. Flattening the table is
   * described where the set's plan is declared (packodds BLUEPRINTS).
   */
  uniformPoolSets?: string[]
  /**
   * Each printed tier's share of the whole print run, which is the form the Gem
   * Pack line publishes it in: ★ 17.39%, ★★ 5.80%, ★★★ 1.81%, with ● and ◆ taking
   * the remainder. Carried as shares of cards rather than weights, because a
   * weight is not a number anyone can check against a source; the loader turns
   * each share into a per-card weight over the cards that print at that tier.
   */
  tierShares?: Record<string, number>
  /**
   * A pack whose slots are filled from rarity groups at published rates, rather
   * than one pool or an era template. Black Bolt and White Flare's spec sheet
   * prints each group's share of all cards dealt — 13.23% Poké Ball holos and
   * Rares, 6.04% RR/AR/Master Ball, 0.73% SR/SAR/BWR, with C and U making up the
   * other 80% — so the group shares ARE the weights once each is divided by the
   * cards it holds. Keyed by set id, in the order the slots are filled.
   */
  ladderPacks?: Record<string, { slot: string; share: number; rarities?: string[]; tiers?: string[] }[]>
}

/**
 * Rewrite a set's booster table from the tiers the wrapper is printed with.
 *
 * The generated table sorts cards into commons, uncommons, holos, hits and the
 * two parallel slots, which is the right shape for a pack that prints those
 * tiers. A product where every card is the same finish has no tiers to sort, and
 * a plan asking for a slot the set cannot fill deals a short pack — this is what
 * stops a four-card Gem Pack from arriving with three cards in it.
 *
 * Weighting is how the ladder stays a ladder. Drawing all 196 cards evenly made
 * an art rare turn up in almost every other Gem Pack and priced a ¥10 wrapper at
 * $9.71, because 28 of the set's cards are art rares. The publisher prints the
 * share of the run each tier makes up, so a card of tier t carries weight
 * `share(t) / count(t)`: every other weight in the table is then a number a
 * reader can check against that table and the set's own card counts.
 *
 * A group names either the catalog's own `rarities` or, where several printed
 * tiers share one rarity in the catalog (`tiers`, which the Gem Packs do — ●, ◆,
 * ★ and ★★ are all Rare Holo), the printed tier. Two groups may carry the same
 * slot and different shares: that is how a hit slot's ★/★★/★★★ shares divide it.
 */
function flattenLadder(
  setId: string,
  groups: { slot: string; share: number; rarities?: string[]; tiers?: string[] }[],
  tiers?: Map<string, string>,
) {
  const pid = `${setId}-booster`
  const cards = db.prepare('SELECT id, rarity FROM cards WHERE set_id = ?').all(setId) as { id: string; rarity: string | null }[]
  if (cards.length === 0) return
  const taken = new Set<string>()
  const rows: { id: string; slot: string; weight: number }[] = []
  for (const g of groups) {
    const inGroup = (c: { id: string; rarity: string | null }) =>
      g.tiers && tiers ? g.tiers.includes(tiers.get(c.id) ?? '') : (g.rarities ?? []).includes(c.rarity ?? '')
    const ids = cards.filter((c) => !taken.has(c.id) && inGroup(c))
    for (const c of ids) taken.add(c.id)
    const weight = Math.round((g.share / Math.max(1, ids.length)) * 1e6) / 1e6
    for (const c of ids) rows.push({ id: c.id, slot: g.slot, weight: Math.max(0.000001, weight) })
  }
  // A rarity the sheet does not name would otherwise be undrawable: the card is
  // real and in the set, so it goes in the last group's slot rather than vanish.
  const left = cards.filter((c) => !taken.has(c.id))
  if (left.length > 0) {
    const last = groups[groups.length - 1]
    console.warn(`[catalog] ${setId}: ${left.length} card(s) outside the published rate table, added to ${last.slot}`)
    for (const c of left) rows.push({ id: c.id, slot: last.slot, weight: 0.000001 })
  }
  const clear = db.prepare('DELETE FROM pack_product_cards WHERE pack_product_id = ?')
  const insert = db.prepare('INSERT OR IGNORE INTO pack_product_cards (pack_product_id, card_id, slot, weight) VALUES (?, ?, ?, ?)')
  db.transaction(() => {
    clear.run(pid)
    for (const r of rows) insert.run(pid, r.id, r.slot, r.weight)
  })()
}

function flattenPullTable(setId: string, tierShares?: Record<string, number>, tiers?: Map<string, string>) {
  const pid = `${setId}-booster`
  const cards = db.prepare('SELECT id, rarity FROM cards WHERE set_id = ?').all(setId) as { id: string; rarity: string | null }[]
  if (cards.length === 0) return
  const byTier = new Map<string, string[]>()
  for (const c of cards) {
    const tier = tiers?.get(c.id) ?? (/Illustration Rare|Art Rare/i.test(c.rarity ?? '') ? 'Gem RRR' : 'Gem C')
    if (!byTier.has(tier)) byTier.set(tier, [])
    byTier.get(tier)!.push(c.id)
  }
  const shares = new Map<string, number>()
  if (tierShares) {
    let named = 0
    for (const [tier, share] of Object.entries(tierShares)) {
      if (byTier.has(tier) && share > 0) {
        shares.set(tier, share)
        named += share
      }
    }
    // ● and ◆ are printed as a remainder, not a rate: split what is left between
    // the tiers the table does not name, by the cards each actually has.
    const rest = byTier.size - shares.size
    const left = Math.max(0, 1 - named)
    const unnamed = [...byTier.keys()].filter((t) => !shares.has(t))
    if (rest > 0) for (const t of unnamed) shares.set(t, left / rest)
  }
  const clear = db.prepare('DELETE FROM pack_product_cards WHERE pack_product_id = ?')
  const insert = db.prepare('INSERT OR IGNORE INTO pack_product_cards (pack_product_id, card_id, slot, weight) VALUES (?, ?, ?, ?)')
  db.transaction(() => {
    clear.run(pid)
    for (const [tier, ids] of byTier) {
      const weight = shares.has(tier) ? Math.round((shares.get(tier)! / ids.length) * 1e6) / 1e6 : 1
      for (const id of ids) insert.run(pid, id, 'holo', Math.max(0.000001, weight))
    }
  })()
}

export type LocalReleaseResult = {
  applied: boolean
  release: string | null
  sets: number
  cards: number
  prices: number
  products: number
  rebuilt: string[]
  reason?: string
}

const cardUpsert = db.prepare(`
  INSERT INTO cards (id, set_id, name, supertype, subtypes, number, position, rarity, types, hp,
                     artist, dex_numbers, image_small, image_large, regulation_mark, updated_at)
  VALUES (@id, @set_id, @name, @supertype, @subtypes, @number, @position, @rarity, @types, @hp,
          @artist, @dex_numbers, @image_small, @image_large, @regulation_mark, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    name=excluded.name, supertype=excluded.supertype, subtypes=excluded.subtypes,
    number=excluded.number, position=excluded.position, rarity=excluded.rarity,
    types=excluded.types, hp=excluded.hp, artist=excluded.artist, dex_numbers=excluded.dex_numbers,
    image_small=excluded.image_small, image_large=excluded.image_large,
    regulation_mark=excluded.regulation_mark, updated_at=excluded.updated_at
`)

const setUpsert = db.prepare(`
  INSERT INTO sets (id, name, series, printed_total, total, ptcgo_code, release_date, symbol_url, logo_url)
  VALUES (@id, @name, @series, @printed_total, @total, @ptcgo_code, @release_date, @symbol_url, @logo_url)
  ON CONFLICT(id) DO UPDATE SET
    name=excluded.name, series=excluded.series, printed_total=excluded.printed_total,
    total=excluded.total, ptcgo_code=excluded.ptcgo_code, release_date=excluded.release_date,
    -- This file is the authority for its own sets: no catalog API has a row for
    -- them, so a mark shipped here (the Gem Packs' published logos and symbols)
    -- must be able to replace an earlier placeholder rather than only fill a gap.
    -- A null in the file still leaves whatever is there alone.
    symbol_url=COALESCE(excluded.symbol_url, sets.symbol_url),
    logo_url=COALESCE(excluded.logo_url, sets.logo_url)
`)

// A price is only ever seeded where none exists: a later sync (or the daily
// refresh) is the authority, and re-inserting here every boot would keep this
// build's opening-day market in front of real market data forever.
const priceInsert = db.prepare(`
  INSERT INTO price_records (card_id, kind, variant, low, mid, high, market, direct_low, avg1, avg7, avg30, retrieved_at)
  SELECT @card_id, 'tcgplayer', @variant, NULL, NULL, NULL, @market, NULL, NULL, NULL, NULL, @retrieved_at
  WHERE NOT EXISTS (
    SELECT 1 FROM price_records WHERE card_id = @card_id AND kind = 'tcgplayer' AND variant = @variant
  )
`)

const productUpsert = db.prepare(`
  INSERT INTO pack_products (id, set_id, name, kind, msrp, market_price, packs, cards_per_pack, release_date, description)
  VALUES (@id, @set_id, @name, @kind, @msrp, NULL, @packs, @cards_per_pack, @release_date, @description)
  ON CONFLICT(id) DO UPDATE SET
    name=excluded.name, kind=excluded.kind, msrp=excluded.msrp, packs=excluded.packs,
    cards_per_pack=excluded.cards_per_pack, release_date=excluded.release_date,
    description=excluded.description
`)

// Product art is a separate, additive write: the generic seeder and the API both
// own `pack_products.image_url`, so this file only ever fills the gap. The Gem
// Packs are the case that needs it — their wrappers are published pictures of the
// product itself and no CDN carries them.
const productArt = db.prepare(
  "UPDATE pack_products SET image_url = ? WHERE id = ? AND (image_url IS NULL OR image_url = '')",
)

function load(): LocalReleases {
  return localReleases as LocalReleases
}

/**
 * Products the English catalogue has no row for at all — not a release it has not
 * reached yet, but a line it will never carry: a booster sold only in mainland
 * China, printed in Simplified Chinese. They go through the same tables and the
 * same upserts as the release above, under their own applied marker, so loading
 * one can never claim the other has been loaded.
 */
function loadRegional(): LocalReleases {
  return regionalReleases as LocalReleases
}

/**
 * Upsert the releases newer than the upstream catalog. Safe to call on every
 * boot: it inserts once, then only refreshes fields and prices that are absent.
 */
export function applyLocalReleases(): LocalReleaseResult {
  return applyRelease(load(), APPLIED_META)
}

/**
 * Upsert the regional catalogue. Identical work to a local release — the file
 * carries the same shape — with its own marker, so a save that already took the
 * Gem Pack still applies the next Delta Reign wave and the other way round.
 */
export function applyRegionalReleases(): LocalReleaseResult {
  return applyRelease(loadRegional(), REGIONAL_APPLIED_META)
}

function applyRelease(data: LocalReleases, metaKey: string): LocalReleaseResult {
  if (!data) return { applied: false, release: null, sets: 0, cards: 0, prices: 0, products: 0, rebuilt: [], reason: 'no release file' }

  const now = nowIso()

  // Count real insertions, not statement churn: an upsert reports a changed row
  // on every boot, which would claim a fresh release forever.
  const priceCount = () =>
    (db.prepare('SELECT COUNT(*) AS n FROM price_records WHERE card_id IN (SELECT id FROM cards WHERE set_id IN (' + data.sets.map(() => '?').join(',') + '))').get(...data.sets.map((s) => s.id)) as { n: number }).n
  const productCount = () =>
    (db.prepare('SELECT COUNT(*) AS n FROM pack_products WHERE id IN (' + data.products.map(() => '?').join(',') + ')').get(...data.products.map((p) => p.id)) as { n: number }).n
  const pricesBefore = priceCount()
  const productsBefore = productCount()

  // Products can belong to a set this save does not have yet (the 30th
  // Celebration wave rides on me55, which arrives from the seed or the API).
  // Inserting it anyway violates pack_products.set_id's foreign key, so leave
  // it out until its set exists; the next boot picks it up.
  const setExists = db.prepare('SELECT 1 FROM sets WHERE id = ?')
  let skippedProducts = 0

  const tx = db.transaction(() => {
    for (const s of data.sets) setUpsert.run(s)
    for (const c of data.cards) {
      cardUpsert.run({
        ...c,
        subtypes: c.subtypes ? JSON.stringify(c.subtypes) : null,
        types: c.types ? JSON.stringify(c.types) : null,
        dex_numbers: c.dex_numbers ? JSON.stringify(c.dex_numbers) : null,
        updated_at: now,
      })
      if (c.price) priceInsert.run({ card_id: c.id, variant: c.price.variant, market: c.price.market, retrieved_at: now })
    }
    // Products are rebuilt on top of whatever the generic catalog seeded, so a
    // published MSRP replaces the era default (Delta Reign's ETB is $49.99, not
    // the $54.99 the generic 2020s line would charge).
    for (const p of data.products) {
      if (!setExists.get(p.set_id)) { skippedProducts++; continue }
      productUpsert.run(p)
      if (p.image_url) productArt.run(p.image_url, p.id)
    }
  })
  tx()

  const prices = priceCount() - pricesBefore
  const products = productCount() - productsBefore

  // A new set also needs its generic sealed line (booster, bundle, ETB,
  // display) before the explicit products above can be overrides — call the
  // same seeder the sync does, then ensure this set has a pull table.
  sealed.ensureFullCatalog()

  // The seeder above has just written this file's products over with the era
  // template: a Simplified Chinese pack holds four cards and costs ¥10, not the
  // ten cards and $4.49 an English 2026 booster deals, and the box holds fifteen
  // packs rather than thirty-six. This file's rows are the authority, so they are
  // written once more after the seeder. (Products whose set is missing stay
  // skipped, exactly as above.)
  const reapplyProducts = db.transaction(() => {
    for (const p of data.products) {
      if (!setExists.get(p.set_id)) continue
      productUpsert.run(p)
      if (p.image_url) productArt.run(p.image_url, p.id)
    }
  })
  reapplyProducts()

  // These sets exist here because the catalogue API has no rows for them, and
  // the full sync walks every set in the database. Marking them done stops it
  // retrying an upstream that cannot answer on every launch; the weekly delta
  // still refreshes them if the API publishes the same set later.
  try {
    const done = new Set<string>(JSON.parse(getMeta('sync:doneIds') || '[]') as string[])
    const before = done.size
    for (const s of data.sets) done.add(s.id)
    if (done.size !== before) setMeta('sync:doneIds', JSON.stringify([...done]))
  } catch {
    /* a corrupt checkpoint is repaired by the sync itself */
  }

  const previously = getMeta(metaKey)
  const firstTime = previously !== data.release
  if (prices > 0 || products > 0 || firstTime) markCatalogChanged()
  const rebuilt: string[] = []
  if (firstTime) {
    for (const s of data.sets) {
      const hasBooster = db.prepare('SELECT 1 FROM pack_products WHERE id = ?').get(`${s.id}-booster`)
      if (!hasBooster) continue
      packs.buildPullTable(s.id)
      const ladder = data.ladderPacks?.[s.id]
      const tiers = new Map(
        data.cards.filter((c) => c.set_id === s.id && c.tier).map((c) => [c.id, c.tier as string] as const),
      )
      if (ladder) flattenLadder(s.id, ladder, tiers)
      else if ((data.uniformPoolSets ?? []).includes(s.id)) flattenPullTable(s.id, data.tierShares, tiers)
      rebuilt.push(s.id)
    }
    // The subset wrapper a box holds (the 30th UPC's Classic Collection pack)
    // has no product row, so the loop above skips it.
    packs.buildInBoxSubsetTables()
    setMeta(metaKey, data.release)
    logActivity('release', `New release: ${data.sets.map((s) => s.name).join(', ')} — ${data.cards.length} card${data.cards.length === 1 ? '' : 's'} added to the catalog`, undefined, `#/set/${data.sets[0]?.id ?? ''}`)
    const wave = data.products.filter((p) => p.kind === 'special')
    if (wave.length > 0) {
      logActivity('release', `New on the shelves: ${wave.map((p) => p.name).join(', ')}`)
    }
    console.log(`[catalog] local release applied — ${data.sets.length} set(s), ${data.cards.length} card(s), ${prices} price(s), ${products} product(s), rebuilt ${rebuilt.join(', ') || 'nothing'}${skippedProducts > 0 ? ` (${skippedProducts} product(s) waiting on a set the save does not have yet)` : ''}`)
  }

  return { applied: true, release: data.release, sets: data.sets.length, cards: data.cards.length, prices, products, rebuilt }
}

/** What the running save knows about, for the settings/status screens. */
export function localReleaseStatus(): { release: string | null; applied: boolean } {
  const data = load()
  return { release: data?.release ?? null, applied: data != null && getMeta(APPLIED_META) === data.release }
}

/** What the running save knows about the regional catalogue. */
export function regionalReleaseStatus(): { release: string | null; applied: boolean } {
  const data = loadRegional()
  return { release: data?.release ?? null, applied: data != null && getMeta(REGIONAL_APPLIED_META) === data.release }
}
