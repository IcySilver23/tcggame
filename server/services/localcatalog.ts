import localReleases from '../catalog/local-releases.json'
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
}

type LocalReleases = { release: string; note?: string; sets: LocalSet[]; cards: LocalCard[]; products: LocalProduct[] }

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
    symbol_url=COALESCE(sets.symbol_url, excluded.symbol_url),
    logo_url=COALESCE(sets.logo_url, excluded.logo_url)
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

function load(): LocalReleases | null {
  return localReleases as LocalReleases
}

/**
 * Upsert the releases newer than the upstream catalog. Safe to call on every
 * boot: it inserts once, then only refreshes fields and prices that are absent.
 */
export function applyLocalReleases(): LocalReleaseResult {
  const data = load()
  if (!data) return { applied: false, release: null, sets: 0, cards: 0, prices: 0, products: 0, rebuilt: [], reason: 'no local release file' }

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
    }
  })
  tx()

  const prices = priceCount() - pricesBefore
  const products = productCount() - productsBefore

  // A new set also needs its generic sealed line (booster, bundle, ETB,
  // display) before the explicit products above can be overrides — call the
  // same seeder the sync does, then ensure this set has a pull table.
  sealed.ensureFullCatalog()

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

  const previously = getMeta(APPLIED_META)
  const firstTime = previously !== data.release
  if (prices > 0 || products > 0 || firstTime) markCatalogChanged()
  const rebuilt: string[] = []
  if (firstTime) {
    for (const s of data.sets) {
      const hasBooster = db.prepare('SELECT 1 FROM pack_products WHERE id = ?').get(`${s.id}-booster`)
      if (!hasBooster) continue
      packs.buildPullTable(s.id)
      rebuilt.push(s.id)
    }
    setMeta(APPLIED_META, data.release)
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
