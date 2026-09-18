import { db, getMeta, setMeta, getSetting, nowIso } from '../lib/db'
import { fetchJson } from '../lib/http'

const API_BASE = 'https://api.pokemontcg.io/v2'
const PAGE_SIZE = 250 // API maximum

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
