import { db, getMeta, setMeta, getSetting, logActivity, nowIso } from '../lib/db'
import { fetchJson } from '../lib/http'
import * as sealed from './sealed'
import * as packs from './packs'
import fs from 'node:fs'
import path from 'node:path'

const API_BASE = 'https://api.pokemontcg.io/v2'
const PAGE_SIZE = 250 // API maximum

// ---------------------------------------------------------------------------
// CATALOG SEED — data/catalog-seed.db ships next to the save (or beside the
// server in packaged layouts) with the full 176-set / ~20k-card catalog and
// its real price history. On boot, any save missing sets or sets missing
// their card count absorbs the missing rows through the exact same upsert
// paths the API sync uses, then checkpoints those sets as done — so a fresh
// install starts fully stocked and an old save tops up only what it lacks,
// in seconds, offline, with zero API requests. The weekly catalog delta
// still talks to the API for releases newer than the seed.
// ---------------------------------------------------------------------------

function seedDbPath(): string | null {
  const candidates = [
    path.join(process.env.TCGLIFE_HOME ?? '', 'data', 'catalog-seed.db'),
    path.join(process.cwd(), 'data', 'catalog-seed.db'),
    path.join(process.cwd(), 'catalog-seed.db'),
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  return null
}

export type SeedResult = { applied: boolean; sets: number; cards: number; prices: number; fresh: boolean; reason?: string }

/** Import the catalog seed into THIS save. Idempotent: only missing sets /
 *  missing cards are copied, via ATTACH + INSERT OR IGNORE + upserts. */
export function applyCatalogSeed(): SeedResult {
  const seedPath = seedDbPath()
  if (!seedPath) return { applied: false, sets: 0, cards: 0, prices: 0, fresh: false, reason: 'no seed file' }
  // A seed older than the newest synced set is better than nothing, but the
  // delta pass will catch the rest up — record its marker for the log line.
  let fresh = false
  try {
    const stmt = db.prepare(`ATTACH ? AS seed`)
    stmt.run(seedPath)
  } catch (err) {
    return { applied: false, sets: 0, cards: 0, prices: 0, fresh: false, reason: `attach failed: ${err instanceof Error ? err.message : err}` }
  }
  try {
    // Sanity: is this actually a catalog seed (not someone's save)?
    const check = db.prepare(`SELECT COUNT(*) AS n FROM seed.cards`).get() as { n: number } | undefined
    if (!check || check.n < 1000) {
      db.exec('DETACH DATABASE seed')
      return { applied: false, sets: 0, cards: 0, prices: 0, fresh: false, reason: 'seed file lacks a card catalog' }
    }
    const beforeSets = (db.prepare('SELECT COUNT(*) AS n FROM sets').get() as { n: number }).n
    const beforeCards = (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n

    db.exec(`
      INSERT OR IGNORE INTO sets (id, name, series, printed_total, total, ptcgo_code, release_date, symbol_url, logo_url)
      SELECT id, name, series, printed_total, total, ptcgo_code, release_date, symbol_url, logo_url FROM seed.sets;

      INSERT OR IGNORE INTO cards (id, set_id, name, supertype, subtypes, number, position, rarity, types, hp, artist, dex_numbers, image_small, image_large, regulation_mark, updated_at)
      SELECT id, set_id, name, supertype, subtypes, number, position, rarity, types, hp, artist, dex_numbers, image_small, image_large, regulation_mark, updated_at FROM seed.cards;

      INSERT OR IGNORE INTO price_records (card_id, kind, variant, low, mid, high, market, direct_low, avg1, avg7, avg30, retrieved_at)
      SELECT s.card_id, s.kind, s.variant, s.low, s.mid, s.high, s.market, s.direct_low, s.avg1, s.avg7, s.avg30, s.retrieved_at
      FROM seed.price_records s
      WHERE NOT EXISTS (
        SELECT 1 FROM price_records p
        WHERE p.card_id = s.card_id AND p.kind = s.kind AND p.variant = s.variant
          AND p.retrieved_at >= s.retrieved_at
      );
    `)

    // Refresh each seed-known set's canonical fields and stamp sets with a
    // full card count (per the API's printedTotal/total) as done — the same
    // completeness rule the sync CLI uses, so the boot loop skips them.
    db.exec(`
      UPDATE sets SET
        name=(SELECT s2.name FROM seed.sets s2 WHERE s2.id=sets.id),
        series=(SELECT s2.series FROM seed.sets s2 WHERE s2.id=sets.id),
        printed_total=(SELECT s2.printed_total FROM seed.sets s2 WHERE s2.id=sets.id),
        total=(SELECT s2.total FROM seed.sets s2 WHERE s2.id=sets.id),
        release_date=(SELECT s2.release_date FROM seed.sets s2 WHERE s2.id=sets.id),
        symbol_url=(SELECT s2.symbol_url FROM seed.sets s2 WHERE s2.id=sets.id),
        logo_url=(SELECT s2.logo_url FROM seed.sets s2 WHERE s2.id=sets.id)
      WHERE id IN (SELECT id FROM seed.sets);
    `)
    const seedSets = db.prepare(`SELECT id, COALESCE(printed_total, total, 0) AS t FROM seed.sets`).all() as { id: string; t: number }[]
    const localCounts = db.prepare('SELECT set_id, COUNT(*) AS n FROM cards GROUP BY set_id').all() as { set_id: string; n: number }[]
    const counts = new Map(localCounts.map((r) => [r.set_id, r.n]))
    let doneIds: string[] = []
    try { doneIds = JSON.parse(getMeta('sync:doneIds') || '[]') as string[] } catch { /* reset */ }
    const done = new Set(doneIds)
    let newlyDone = 0
    for (const s of seedSets) {
      if (done.has(s.id)) continue
      if ((counts.get(s.id) ?? 0) > 0 && (counts.get(s.id) as number) >= s.t) {
        done.add(s.id)
        newlyDone++
      }
    }
    if (newlyDone > 0) setMeta('sync:doneIds', JSON.stringify([...done]))
    if (!getMeta('setsLastSyncedAt')) setMeta('setsLastSyncedAt', nowIso())

    const afterSets = (db.prepare('SELECT COUNT(*) AS n FROM sets').get() as { n: number }).n
    const afterCards = (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n
    const pricesAdded = (db.prepare(`SELECT COUNT(*) AS n FROM price_records`).get() as { n: number }).n -
      Math.max(0, 0)
    fresh = newlyDone > 0
    console.log(`[sync] catalog seed applied — sets ${beforeSets}→${afterSets}, cards ${beforeCards}→${afterCards}, ${newlyDone} set(s) checkpointed${fresh ? '' : ' (catalog already current)'}`)
    return { applied: true, sets: afterSets - beforeSets, cards: afterCards - beforeCards, prices: Math.max(0, pricesAdded), fresh }
  } finally {
    try { db.exec('DETACH DATABASE seed') } catch { /* already detached */ }
  }
}

// ---------------------------------------------------------------------------
// API payload types (subset we consume)
// ---------------------------------------------------------------------------

type ApiSet = {
  id: string
  name: string
  series: string
  printedTotal: number
  total: number
  ptcgoCode?: string
  releaseDate: string
  images: { symbol?: string; logo?: string }
}

type ApiTcgPrice = { low?: number; mid?: number; high?: number; market?: number; directLow?: number }
type ApiCmPrice = {
  averageSellPrice?: number
  lowPrice?: number
  trendPrice?: number
  avg1?: number
  avg7?: number
  avg30?: number
  reverseHoloSell?: number
  reverseHoloTrend?: number
}

type ApiCard = {
  id: string
  name: string
  supertype: string
  subtypes?: string[]
  number: string
  rarity?: string
  types?: string[]
  hp?: string
  artist?: string
  nationalPokedexNumbers?: number[]
  regulationMark?: string
  set: { id: string }
  images: { small?: string; large?: string }
  tcgplayer?: { updatedAt?: string; prices?: Record<string, ApiTcgPrice> }
  cardmarket?: { updatedAt?: string; prices?: ApiCmPrice }
}

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

export type SyncProgress = {
  running: boolean
  phase: 'idle' | 'sets' | 'cards' | 'done'
  setsDone: number
  setsTotal: number
  currentSet: string | null
  cardsSyncedTotal: number
  lastError: string | null
  startedAt: string | null
  finishedAt: string | null
}

const progress: SyncProgress = {
  running: false,
  phase: 'idle',
  setsDone: 0,
  setsTotal: 0,
  currentSet: null,
  cardsSyncedTotal: 0,
  lastError: null,
  startedAt: null,
  finishedAt: null,
}

export function getSyncProgress(): SyncProgress {
  return { ...progress, currentSet: getMeta('sync:currentSetName') }
}

function apiKey(): string | null {
  return process.env.POKEMONTCG_API_KEY || getSetting('pokemontcgApiKey') || null
}

function apiHeaders(): Record<string, string> {
  const key = apiKey()
  return key ? { 'X-Api-Key': key } : {}
}

// ---------------------------------------------------------------------------
// Sets sync
// ---------------------------------------------------------------------------

export async function syncSets(): Promise<number> {
  const data = await fetchJson<{ data: ApiSet[]; totalCount: number }>(`${API_BASE}/sets?pageSize=250`, apiHeaders())
  const upsert = db.prepare(`
    INSERT INTO sets (id, name, series, printed_total, total, ptcgo_code, release_date, symbol_url, logo_url)
    VALUES (@id, @name, @series, @printedTotal, @total, @ptcgoCode, @releaseDate, @symbol, @logo)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, series=excluded.series, printed_total=excluded.printed_total,
      total=excluded.total, ptcgo_code=excluded.ptcgo_code, release_date=excluded.release_date,
      symbol_url=excluded.symbol_url, logo_url=excluded.logo_url
  `)
  const tx = db.transaction((rows: ApiSet[]) => {
    for (const s of rows) {
      upsert.run({
        id: s.id,
        name: s.name,
        series: s.series,
        printedTotal: s.printedTotal,
        total: s.total,
        ptcgoCode: s.ptcgoCode ?? null,
        releaseDate: s.releaseDate,
        symbol: s.images?.symbol ?? null,
        logo: s.images?.logo ?? null,
      })
    }
  })
  tx(data.data)
  setMeta('setsLastSyncedAt', nowIso())
  console.log(`[sync] sets: ${data.data.length} upserted`)
  return data.data.length
}

// ---------------------------------------------------------------------------
// Cards sync (per set, paginated)
// ---------------------------------------------------------------------------

const upsertCard = db.prepare(`
  INSERT INTO cards (id, set_id, name, supertype, subtypes, number, position, rarity, types, hp,
                     artist, dex_numbers, image_small, image_large, regulation_mark, updated_at)
  VALUES (@id, @set_id, @name, @supertype, @subtypes, @number, @position, @rarity, @types, @hp,
          @artist, @dex, @image_small, @image_large, @regulation_mark, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    name=excluded.name, supertype=excluded.supertype, subtypes=excluded.subtypes,
    number=excluded.number, position=excluded.position, rarity=excluded.rarity,
    types=excluded.types, hp=excluded.hp, artist=excluded.artist, dex_numbers=excluded.dex_numbers,
    image_small=excluded.image_small, image_large=excluded.image_large,
    regulation_mark=excluded.regulation_mark, updated_at=excluded.updated_at
`)

const insertPrice = db.prepare(`
  INSERT INTO price_records
    (card_id, kind, variant, low, mid, high, market, direct_low, avg1, avg7, avg30, retrieved_at)
  VALUES (@card_id, @kind, @variant, @low, @mid, @high, @market, @direct_low, @avg1, @avg7, @avg30, @retrieved_at)
`)

function parsePosition(number: string): number {
  const m = number.match(/^(\d+)/)
  return m ? parseInt(m[1], 10) : 9999
}

const alreadyStoredToday = db.prepare(
  `SELECT 1 FROM price_records WHERE card_id = ? AND kind = ? AND variant = ? AND retrieved_at >= date('now') LIMIT 1`,
)

function storePrices(card: ApiCard, retrievedAt: string) {
  if (card.tcgplayer?.prices) {
    for (const [variant, p] of Object.entries(card.tcgplayer.prices)) {
      if (!p || (p.market == null && p.low == null && p.mid == null && p.high == null)) continue
      if (alreadyStoredToday.get(card.id, 'tcgplayer', variant)) continue
      insertPrice.run({
        card_id: card.id,
        kind: 'tcgplayer',
        variant,
        low: p.low ?? null,
        mid: p.mid ?? null,
        high: p.high ?? null,
        market: p.market ?? null,
        direct_low: p.directLow ?? null,
        avg1: null,
        avg7: null,
        avg30: null,
        retrieved_at: retrievedAt,
      })
    }
  }
  if (card.cardmarket?.prices) {
    const p = card.cardmarket.prices
    if (alreadyStoredToday.get(card.id, 'cardmarket', 'normal')) return
    insertPrice.run({
      card_id: card.id,
      kind: 'cardmarket',
      variant: 'normal',
      low: p.lowPrice ?? null,
      mid: p.trendPrice ?? null,
      high: null,
      market: p.trendPrice ?? null,
      direct_low: null,
      avg1: p.avg1 ?? null,
      avg7: p.avg7 ?? null,
      avg30: p.avg30 ?? null,
      retrieved_at: retrievedAt,
    })
  }
}

export async function syncCardsForSet(setId: string): Promise<number> {
  let page = 1
  let total = 0
  const retrievedAt = nowIso()
  for (;;) {
    const data = await fetchJson<{ data: ApiCard[]; totalCount: number; page: number; pageSize: number; count: number }>(
      `${API_BASE}/cards?q=set.id:"${setId}"&pageSize=${PAGE_SIZE}&page=${page}`,
      apiHeaders(),
    )
    const tx = db.transaction((rows: ApiCard[]) => {
      for (const c of rows) {
        upsertCard.run({
          id: c.id,
          set_id: c.set.id,
          name: c.name,
          supertype: c.supertype,
          subtypes: c.subtypes ? JSON.stringify(c.subtypes) : null,
          number: c.number,
          position: parsePosition(c.number),
          rarity: c.rarity ?? null,
          types: c.types ? JSON.stringify(c.types) : null,
          hp: c.hp ? parseInt(c.hp, 10) || null : null,
          artist: c.artist ?? null,
          dex: c.nationalPokedexNumbers ? JSON.stringify(c.nationalPokedexNumbers) : null,
          image_small: c.images?.small ?? null,
          image_large: c.images?.large ?? null,
          regulation_mark: c.regulationMark ?? null,
          updated_at: c.tcgplayer?.updatedAt ?? c.cardmarket?.updatedAt ?? null,
        })
        storePrices(c, retrievedAt)
      }
    })
    tx(data.data)
    total += data.data.length
    if (data.data.length < PAGE_SIZE || page * PAGE_SIZE >= data.totalCount) break
    page++
  }
  return total
}

// ---------------------------------------------------------------------------
// Daily cardmarket refresh — re-sync prices for owned + wishlisted cards
//
// The full card sync runs once and checkpoints per set; day-to-day, cardmarket
// trend prices would otherwise go stale while the ladder serves them as the
// real fallback tier. This pass re-fetches ONLY the cards you own or want
// (a few hundred at most) — cheap, keyless-tier friendly, and it refreshes
// the TCGplayer rows too, since storePrices handles both kinds.
// ---------------------------------------------------------------------------

export async function refreshOwnedPrices(): Promise<{ cards: number; updated: number }> {
  const ids = [
    ...new Set([
      ...(db.prepare(`SELECT DISTINCT card_id FROM inventory WHERE status != 'sold'`).all() as { card_id: string }[]).map((r) => r.card_id),
      ...(db.prepare(`SELECT card_id FROM wishlist`).all() as { card_id: string }[]).map((r) => r.card_id),
    ]),
  ]
  if (ids.length === 0) return { cards: 0, updated: 0 }
  return repriceIds(ids, 'owned/wishlist')
}

// ---------------------------------------------------------------------------
// Whole-catalog re-price — `npm run sync -- --prices`
//
// The daily pass above only refreshes what you own or want, and the external
// backfill only fills cards with NO price at all, so nothing in the game ever
// re-quoted the whole catalog. The offline catalog seed (data/catalog-seed.db)
// ships inside every install and is what a fresh save believes until its own
// syncs catch up, so its rows deserve a real refresh before shipping.
// Same chunked id query, same keyless-friendly tier, no new machinery.
// ---------------------------------------------------------------------------

export async function refreshCatalogPrices(): Promise<{ cards: number; updated: number }> {
  const ids = (db.prepare(`SELECT id FROM cards`).all() as { id: string }[]).map((r) => r.id)
  if (ids.length === 0) return { cards: 0, updated: 0 }
  return repriceIds(ids, 'catalog')
}

async function repriceIds(ids: string[], label: string): Promise<{ cards: number; updated: number }> {
  // Page through q=id:... (id OR-grouping) in chunks of 250 — the API's page cap.
  const CHUNK = 250
  let fetched = 0
  const existing = db.prepare(`SELECT market FROM price_records WHERE card_id = ? AND kind = 'cardmarket' AND market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1`)
  let changed = 0
  const retrievedAt = nowIso()
  let failed = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    // Unquoted id clauses, field on every term. The previous shape
    // (`id:"a" OR "b" OR "c"`) dropped the field after the first term and the
    // API answered 400 for any chunk larger than one card — which silently
    // killed the daily owned/wishlist refresh the moment you owned 2+ cards.
    const query = `q=${chunk.map((id) => `id:${id}`).join(' OR ')}`
    // One chunk that never comes back must not abandon the other 80: skip it,
    // count it, and let a re-run (same day-safe guards) pick it up. Aborting
    // the whole pass on one flaky upstream response is how a "refresh every
    // price" job ends up shipping a half-fresh catalog.
    let data: { data: ApiCard[]; totalCount: number }
    try {
      data = await fetchJson<{ data: ApiCard[]; totalCount: number }>(
        `${API_BASE}/cards?${query}&pageSize=${CHUNK}&page=1`,
        apiHeaders(),
        // A whole-catalog pass is ~80 requests against an upstream that 500s
        // intermittently — more attempts (each already backed off) beats
        // aborting the pass and shipping a half-fresh seed.
        { attempts: 8 },
      )
    } catch (e) {
      failed++
      console.warn(`[sync] ${label}: chunk at id ${chunk[0]} failed (${e instanceof Error ? e.message : e}) — skipping, ${ids.length - i - CHUNK > 0 ? 'continuing' : 'last chunk'}`)
      continue
    }
    for (const card of data.data) {
      if (!card.tcgplayer && !card.cardmarket) continue
      const before = existing.get(card.id) as { market: number } | undefined
      storePrices(card, retrievedAt)
      const after = existing.get(card.id) as { market: number } | undefined
      if (before?.market !== after?.market) changed++
      fetched++
    }
    if (label === 'catalog' && (i / CHUNK) % 20 === 19) {
      console.log(`[sync] catalog refresh: ${Math.min(i + CHUNK, ids.length)}/${ids.length} ids queried…`)
    }
  }
  if (fetched > 0) console.log(`[sync] ${label} refresh: ${fetched} card(s) re-priced, ${changed} cardmarket trend(s) moved`)
  if (failed > 0) console.warn(`[sync] ${label} refresh: ${failed} chunk(s) unreachable — re-run to cover them`)
  return { cards: fetched, updated: changed }
}

// ---------------------------------------------------------------------------
// Background sync orchestration (resumable)
// ---------------------------------------------------------------------------

let loopRunning = false

export function startSyncLoop() {
  if (loopRunning) return
  loopRunning = true
  setTimeout(() => void runLoop(), 800)
}

async function runLoop() {
  try {
    // Phase 0: catalog seed — instant offline stock-up before any API traffic.
    // Covers fresh installs (whole catalog in seconds) and old saves (only the
    // sets they're missing). Whatever the seed can't fill, the API pass below
    // still handles.
    try {
      const seed = applyCatalogSeed()
      if (!seed.applied && seed.reason && seed.reason !== 'no seed file') console.warn(`[sync] catalog seed skipped: ${seed.reason}`)
    } catch (err) {
      console.warn('[sync] catalog seed failed (continuing with API sync):', err instanceof Error ? err.message : err)
    }

    // Phase 1: sets (if never synced)
    if (!getMeta('setsLastSyncedAt')) {
      progress.running = true
      progress.phase = 'sets'
      progress.startedAt = progress.startedAt ?? nowIso()
      await syncSets()
    }

    // Phase 2: cards for every set — shop/priority sets first, then the full backlog
    const PRIORITY = ['sv8.5', 'sv8', 'sv3pt5', 'sv4pt5', 'sv7', 'sv6', 'sv5', 'sv4', 'sv3', 'sv2', 'sv1', 'swsh12pt5', 'swsh12', 'swsh11', 'swsh10', 'swsh9', 'swsh8', 'swsh7', 'swsh6', 'swsh5']
    const allSetsRaw = db.prepare('SELECT id, name FROM sets ORDER BY release_date DESC').all() as { id: string; name: string }[]
    const prioritySets = PRIORITY.map((id) => allSetsRaw.find((s) => s.id === id)).filter((s): s is { id: string; name: string } => Boolean(s))
    const rest = allSetsRaw.filter((s) => !PRIORITY.includes(s.id))
    const allSets = [...prioritySets, ...rest]

    // Per-set done list (JSON array in meta) — resumable regardless of ordering.
    const legacyDone = getMeta('sync:set')
    const doneIds = new Set<string>(JSON.parse(getMeta('sync:doneIds') || '[]') as string[])
    if (legacyDone && !doneIds.has(legacyDone)) doneIds.add(legacyDone)

    progress.running = true
    progress.phase = 'cards'
    progress.setsTotal = allSets.length
    progress.setsDone = doneIds.size
    progress.startedAt = progress.startedAt ?? nowIso()

    for (let i = 0; i < allSets.length; i++) {
      const s = allSets[i]
      if (doneIds.has(s.id)) continue
      progress.currentSet = s.name
      setMeta('sync:currentSetName', s.name)
      try {
        await syncCardsForSet(s.id)
      } catch (err) {
        // Skip this set for now; it is NOT marked done, so it is retried next launch.
        progress.lastError = err instanceof Error ? err.message : String(err)
        console.error(`[sync] set ${s.id} failed — skipping for now, will retry next start:`, progress.lastError)
        continue
      }
      doneIds.add(s.id)
      setMeta('sync:doneIds', JSON.stringify([...doneIds]))
      progress.setsDone = doneIds.size
      progress.cardsSyncedTotal = (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n
      setMeta('cardsLastSyncedAt', nowIso())
    }

    progress.running = false
    progress.phase = 'done'
    progress.finishedAt = nowIso()
    progress.currentSet = null
    console.log('[sync] complete —', progress.cardsSyncedTotal, 'cards in database')
  } catch (err) {
    progress.running = false
    progress.lastError = err instanceof Error ? err.message : String(err)
    console.error('[sync] fatal:', progress.lastError)
  }
}

// ---------------------------------------------------------------------------
// Weekly catalog delta-sync — keep the catalog current as new releases drop
//
// The full sync checkpoints every set into meta `sync:doneIds`, so a settled
// database would never see a new release without a manual restart. This light
// pass re-fetches the set list and diffs it against the local catalog:
//   • sets the API knows that we don't      → full card sync for each
//   • sets whose name / card totals / release date changed upstream → re-sync
//     (upcoming sets reveal cards before release, and totals grow)
// Only the changes are fetched, so a week's releases cost a handful of
// requests. Runs weekly from the server loop (server/index.ts), catches up on
// boot if a week has passed, and can be triggered from Settings. New cards
// land through the same upsert/price paths as the full sync, and stamping
// cardsLastSyncedAt lets the pack/pull-table rebuild pick the sets up.
// ---------------------------------------------------------------------------

export type CatalogDeltaSummary = {
  at: string
  newSets: { id: string; name: string; cards: number }[]
  updatedSets: { id: string; name: string; cards: number }[]
  errors: string[]
}

export type CatalogDeltaStatus = {
  running: boolean
  lastRunAt: string | null
  lastSummary: CatalogDeltaSummary | null
}

export type CatalogDeltaRun = { ran: boolean; reason?: string; summary?: CatalogDeltaSummary }

let deltaRunning = false

export function catalogDeltaStatus(): CatalogDeltaStatus {
  let lastSummary: CatalogDeltaSummary | null = null
  try {
    lastSummary = JSON.parse(getMeta('catalogDeltaLastSummary') || 'null') as CatalogDeltaSummary | null
  } catch {
    /* corrupt meta — treat as never run */
  }
  return { running: deltaRunning, lastRunAt: getMeta('catalogDeltaLastRunAt'), lastSummary }
}

type LocalSetRow = { id: string; name: string; printed_total: number; total: number; release_date: string }

export async function runCatalogDelta(): Promise<CatalogDeltaRun> {
  if (deltaRunning) return { ran: false, reason: 'delta sync is already running' }
  if (progress.running) return { ran: false, reason: 'full sync is running — the delta will run when it finishes' }
  deltaRunning = true
  try {
    const before = new Map(
      (db.prepare('SELECT id, name, printed_total, total, release_date FROM sets').all() as LocalSetRow[]).map((s) => [s.id, s]),
    )
    await syncSets()
    const after = db.prepare('SELECT id, name, printed_total, total, release_date FROM sets').all() as LocalSetRow[]
    const fingerprint = (s: LocalSetRow) => JSON.stringify([s.name, s.printed_total, s.total, s.release_date])

    const newSets = after.filter((s) => !before.has(s.id))
    const updatedSets = after.filter((s) => {
      const prev = before.get(s.id)
      return prev !== undefined && fingerprint(prev) !== fingerprint(s)
    })

    let doneIds = new Set<string>()
    try {
      doneIds = new Set(JSON.parse(getMeta('sync:doneIds') || '[]') as string[])
    } catch {
      /* missing/corrupt checkpoint — full sync will repair it */
    }

    // Newest releases first, mirroring the full sync's priority ordering.
    const targets = [
      ...newSets.map((row) => ({ row, isNew: true })),
      ...updatedSets.map((row) => ({ row, isNew: false })),
    ].sort((a, b) => (b.row.release_date || '').localeCompare(a.row.release_date || ''))

    const summary: CatalogDeltaSummary = { at: nowIso(), newSets: [], updatedSets: [], errors: [] }
    for (const { row, isNew } of targets) {
      try {
        const cards = await syncCardsForSet(row.id)
        doneIds.add(row.id) // delta-synced sets are complete — don't make the boot loop redo them
        ;(isNew ? summary.newSets : summary.updatedSets).push({ id: row.id, name: row.name, cards })
      } catch (err) {
        summary.errors.push(`${row.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    setMeta('sync:doneIds', JSON.stringify([...doneIds]))
    if (summary.newSets.length > 0 || summary.updatedSets.length > 0) setMeta('cardsLastSyncedAt', nowIso())
    setMeta('catalogDeltaLastRunAt', nowIso())
    setMeta('catalogDeltaLastSummary', JSON.stringify(summary))

    // New releases are in-game events — announce them in the activity feed.
    // href deep-links the feed row to the set page (#/set/:id routes client-side).
    for (const s of summary.newSets) {
      logActivity('release', `New release: ${s.name} — ${s.cards} card${s.cards === 1 ? '' : 's'} added to the catalog`, undefined, `#/set/${s.id}`)
    }
    if (summary.updatedSets.length > 0) {
      logActivity('release', `Catalog update: ${summary.updatedSets.map((s) => s.name).join(', ')} gained new cards`)
    }

    // New releases should be buyable the moment they land — seed pack products
    // and rebuild pull tables for the delta sets right now instead of waiting
    // for the next /api/state poll to notice cardsLastSyncedAt moved.
    // Promo-like sets get no products upstream (sealed.productsForSet returns
    // []), so they're skipped exactly like the boot-time rebuild skips them.
    if (targets.length > 0) {
      try {
        const addedProducts = sealed.ensureFullCatalog()
        const withBooster = targets
          .map((t) => t.row.id)
          .filter((id) => db.prepare('SELECT 1 FROM pack_products WHERE id = ?').get(`${id}-booster`))
        for (const id of withBooster) packs.buildPullTable(id)
        setMeta('pullTablesBuiltAt', nowIso())
        if (addedProducts > 0 || withBooster.length > 0) {
          console.log(`[sync] delta: ${addedProducts} new sealed product(s), ${withBooster.length} pull table(s) rebuilt`)
        }
      } catch (err) {
        // Not bumping pullTablesBuiltAt means the next state poll re-runs the
        // global rebuild and repairs whatever failed here.
        console.error('[sync] delta: pack rebuild failed — the state poll will retry:', err instanceof Error ? err.message : err)
      }
    }

    const cards = [...summary.newSets, ...summary.updatedSets].reduce((a, s) => a + s.cards, 0)
    if (targets.length > 0) {
      console.log(
        `[sync] catalog delta: ${summary.newSets.length} new set(s), ${summary.updatedSets.length} updated, ${cards} card(s) upserted` +
          (summary.errors.length ? `, ${summary.errors.length} failed (retried next run)` : ''),
      )
    } else {
      console.log('[sync] catalog delta: catalog already current')
    }
    return { ran: true, summary }
  } catch (err) {
    // Upstream (or DB) failure — leave catalogDeltaLastRunAt untouched so the
    // weekly gate retries on the next daily interval instead of waiting a week.
    const reason = err instanceof Error ? err.message : String(err)
    console.error('[sync] catalog delta failed (will retry next interval):', reason)
    return { ran: false, reason }
  } finally {
    deltaRunning = false
  }
}
