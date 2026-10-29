import { db, nowIso, getMeta, setMeta, logActivity } from '../lib/db'
import { gameDayKey, gameDayMs } from '../lib/gameday'
import { tierOf, eraOf } from './estimates'

// ---------------------------------------------------------------------------
// POPULATION & META DRIFT — the scene itself changes over months.
//
// Three ideas share one engine (local round2: regimes imports this module,
// which must never import market/regimes back):
//
//   • POPULATION — era tastes drift. Collectors age into hold-forever, a
//     revival sends one era hot, a generation's money moves to the next
//     format. Each era carries a slow mean-reverting taste multiplier
//     (0.82–1.35) with a permanent scarcity creep on vintage: as the old
//     guard holds rather than sells, vintage PRICES climb while vintage
//     SUPPLY thins (eraSupply feeds the marketplace feed — fewer old boxes
//     hit the block exactly when they're worth the most).
//
//   • META BOOMS — the hobby's celebrity weather. Every game-day the scene
//     may catch fire: a pop star's Charizard photo, a viral rewatch, the new
//     set exploding on card-Tok. A boom lifts demand across an era (chase
//     hardest, bulk tagged along at 40%) for 6–16 game-days, decaying
//     through its life, then cools with a feed line.
//
//   • SET DEMAND PROFILES — each set's long-term value profile emerges from
//     two SIMULATED collector cohorts instead of a fixed curve: the chase
//     cohort (hunters of the top hits, a ~57 game-day rhythm) and the build
//     cohort (set completists who carry the bulk, ~89 game-days). Every set
//     has its own phase; the cohorts' live heats are stored in set_demand and
//     walked toward their oscillators daily with noise. Card prices read the
//     split — chase cards price at chase/mean, bulk at build/mean around the
//     set's population-and-boom level — and sealed boxes (rip vehicles) track
//     chase hardest, so a set's chase-vs-bulk profile is a living thing the
//     player can watch move in the Market view.
// ---------------------------------------------------------------------------

export type Era = 'vintage' | 'mid' | 'modern'

const round2 = (n: number) => Math.round(n * 100) / 100
const round3 = (n: number) => Math.round(n * 1000) / 1000
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

const POP_KEY = 'demo:pop'
const BOOMS_KEY = 'demo:booms'
const DAY_KEY = 'demo:day'

// ---------------------------------------------------------------------------
// Population state — era taste multipliers, one walk per game-day.
// ---------------------------------------------------------------------------

type Pop = { vintage: number; mid: number; modern: number }

function loadPop(): Pop {
  const raw = getMeta(POP_KEY)
  if (raw) {
    try {
      const p = JSON.parse(raw) as Pop
      if (typeof p.vintage === 'number' && typeof p.mid === 'number' && typeof p.modern === 'number') return p
    } catch { /* fall through */ }
  }
  return { vintage: 1, mid: 1, modern: 1 }
}

function savePop(p: Pop) {
  setMeta(POP_KEY, JSON.stringify(p))
}

// ---------------------------------------------------------------------------
// Meta booms — celebrity/hype events with a decay through their life.
// ---------------------------------------------------------------------------

export type Boom = {
  id: string
  era: Era | 'all'
  headline: string
  blurb: string
  mult: number // peak demand multiplier for the hot era's chase cards
  started: string
  until: string
}

function loadBooms(): Boom[] {
  const raw = getMeta(BOOMS_KEY)
  if (!raw) return []
  try {
    const b = JSON.parse(raw)
    return Array.isArray(b) ? (b as Boom[]) : []
  } catch {
    return []
  }
}

function saveBooms(list: Boom[]) {
  setMeta(BOOMS_KEY, JSON.stringify(list))
}

// Hot read path (regimes.factor runs on every price resolve): cache the meta
// state briefly; demoTick invalidates immediately.
type SceneCache = { at: number; pop: Pop; booms: Boom[] }
let cache: SceneCache | null = null

function scene(): SceneCache {
  const now = Date.now()
  if (cache && now - cache.at < 5000) return cache
  const booms = loadBooms().filter((b) => new Date(b.until).getTime() > now)
  cache = { at: now, pop: loadPop(), booms }
  return cache
}

function invalidateSceneCache() {
  cache = null
  rowCache.clear()
}

/** Live boom multiplier for an era, decaying from peak to 50% over its life. */
function boomFactor(era: Era, chase: boolean, s: SceneCache = scene()): number {
  if (s.booms.length === 0) return 1
  const now = Date.now()
  let m = 1
  for (const b of s.booms) {
    if (b.era !== 'all' && b.era !== era) continue
    const start = new Date(b.started).getTime()
    const end = new Date(b.until).getTime()
    const frac = end > start ? clamp(1 - (now - start) / (end - start), 0, 1) : 1
    const eff = (b.mult - 1) * (0.5 + 0.5 * frac)
    m *= 1 + (chase ? eff : eff * 0.4) // bulk comes along, tagged along at 40%
  }
  return m
}

const CELEBS = [
  'a chart-topping pop star',
  'an NBA All-Star',
  'a streamer with 40M followers',
  'an Oscar nominee',
  'a pro quarterback',
  'a reality-TV name',
  'a K-pop idol',
]
const NUMBERS = ['PSA 10 Base Set Charizard', 'a sealed 1st Edition booster', 'the new set’s chase SIR', 'a Gold Star', 'an Umbreon gold card']

function spawnBoom(): Boom {
  const eraRoll = Math.random()
  const era: Era | 'all' = eraRoll < 0.35 ? 'all' : eraRoll < 0.6 ? 'vintage' : eraRoll < 0.75 ? 'mid' : 'modern'
  const who = CELEBS[Math.floor(Math.random() * CELEBS.length)]
  const what = NUMBERS[Math.floor(Math.random() * NUMBERS.length)]
  const flavors: Record<Era | 'all', { headline: string; blurb: string }> = {
    all: {
      headline: `${who} posted ${what} — “Pokémon is the new watch collection”`,
      blurb: 'The timeline runs it: money that has never touched cardboard starts shopping. The whole hobby bids up.',
    },
    vintage: {
      headline: `a viral nostalgia rewatch sent the after-school crew back for ${what}`,
      blurb: 'WOTC-era holos get bid up at every show and nothing old changes hands — holders are watching their decade come back.',
    },
    mid: {
      headline: `${who} called the mid era “the most underrated cardboard there is”`,
      blurb: 'Buylists go shopping for the era everyone forgot — XYZ-era oddballs and full arts start clearing.',
    },
    modern: {
      headline: `the new set’s chase hit went viral on card-Tok — ${who} was seen opening packs`,
      blurb: 'Rip fever. Modern product moves at ask and the picker who comps first gets there first.',
    },
  }
  const mult = round2(1.08 + Math.random() * 0.18) // +8% … +26% at peak, chase-side
  const days = 6 + Math.floor(Math.random() * 11) // 6–16 game-days
  const f = flavors[era]
  const boom: Boom = {
    id: `boom_${Date.now()}`,
    era,
    headline: f.headline,
    blurb: f.blurb,
    mult,
    started: nowIso(),
    until: new Date(Date.now() + days * gameDayMs()).toISOString(),
  }
  const where = era === 'all' ? 'the whole hobby' : `${era} demand`
  logActivity('market', `🌟 META SHIFT: ${f.headline}. ${f.blurb} (+${Math.round((mult - 1) * 100)}% ${where} at peak, cooling over ~${days} game-days.)`)
  return boom
}

// ---------------------------------------------------------------------------
// Set demand profiles — two simulated cohorts per set, walked daily.
// ---------------------------------------------------------------------------

db.exec(`CREATE TABLE IF NOT EXISTS set_demand (
  set_id TEXT PRIMARY KEY,
  chase REAL NOT NULL,     -- chase cohort heat (hunters of the top hits)
  build REAL NOT NULL,     -- build cohort heat (set completists, the bulk)
  demand REAL NOT NULL,    -- (chase + build) / 2 — the set's overall level
  tilt REAL NOT NULL,      -- chase - build: >0 chase-led, <0 bulk-led
  trend REAL NOT NULL,     -- demand change since the last game-day
  updated_at TEXT NOT NULL
)`)

function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** The cohorts' oscillator targets for a set — independent rhythms, own phase. */
function targets(setId: string): { chase: number; build: number } {
  const h = hash32(setId)
  const day = Math.floor(Date.now() / gameDayMs())
  const p1 = ((h % 628) / 100)
  const p2 = (((h >>> 10) % 628) / 100)
  const chase = 1 + 0.3 * Math.sin((2 * Math.PI * day) / 57 + p1)
  const build = 1 + 0.24 * Math.sin((2 * Math.PI * day) / 89 + p2)
  return { chase, build }
}

type DemandRow = { set_id: string; chase: number; build: number; demand: number; tilt: number; trend: number }

const rowCache = new Map<string, { row: DemandRow; at: number }>()
const ROW_TTL = 60_000

function seedRow(setId: string): DemandRow {
  const t = targets(setId)
  const demand = round3((t.chase + t.build) / 2)
  db.prepare(
    `INSERT INTO set_demand (set_id, chase, build, demand, tilt, trend, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(set_id) DO NOTHING`,
  ).run(setId, round3(t.chase), round3(t.build), demand, round3(t.chase - t.build), nowIso())
  const row = db.prepare(`SELECT set_id, chase, build, demand, tilt, trend FROM set_demand WHERE set_id = ?`).get(setId) as DemandRow | undefined
  return row ?? { set_id: setId, chase: 1, build: 1, demand: 1, tilt: 0, trend: 0 }
}

/** A set's live demand profile (cached ~60s; invalidated each game-day). */
export function demandOf(setId: string): DemandRow {
  const hit = rowCache.get(setId)
  if (hit && Date.now() - hit.at < ROW_TTL) return hit.row
  const got = db.prepare(`SELECT set_id, chase, build, demand, tilt, trend FROM set_demand WHERE set_id = ?`).get(setId) as DemandRow | undefined
  const row = got ?? seedRow(setId)
  rowCache.set(setId, { row, at: Date.now() })
  return row
}

function ensureRows(): number {
  const sets = db.prepare(`SELECT id FROM sets`).all() as { id: string }[]
  let seeded = 0
  const ins = db.prepare(
    `INSERT INTO set_demand (set_id, chase, build, demand, tilt, trend, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?) ON CONFLICT(set_id) DO NOTHING`,
  )
  for (const s of sets) {
    const t = targets(s.id)
    const r = ins.run(s.id, round3(t.chase), round3(t.build), round3((t.chase + t.build) / 2), round3(t.chase - t.build), nowIso())
    if (r.changes > 0) seeded++
  }
  return seeded
}

// ---------------------------------------------------------------------------
// Card/set metadata cache — era + chase-or-bulk per card (static facts).
// ---------------------------------------------------------------------------

type CardMeta = { setId: string; era: Era; chase: boolean }
const cardMetaCache = new Map<string, CardMeta | null>()

function cardMeta(cardId: string): CardMeta | null {
  if (cardMetaCache.has(cardId)) return cardMetaCache.get(cardId) ?? null
  const row = db
    .prepare(`SELECT c.set_id, substr(s.release_date, 1, 4) AS yr, c.rarity FROM cards c LEFT JOIN sets s ON s.id = c.set_id WHERE c.id = ?`)
    .get(cardId) as { set_id: string; yr: string | null; rarity: string | null } | undefined
  let meta: CardMeta | null = null
  if (row) {
    const era = eraOf(row.yr ? Number(row.yr) : null)
    const t = tierOf(row.rarity)
    const chase = t === 'ur' || t === 'ir' || t === 'sir' || t === 'double'
    meta = { setId: row.set_id, era, chase }
  }
  if (cardMetaCache.size > 20000) cardMetaCache.clear()
  cardMetaCache.set(cardId, meta)
  return meta
}

const setEraCache = new Map<string, Era>()
function setEra(setId: string): Era {
  const hit = setEraCache.get(setId)
  if (hit) return hit
  const row = db.prepare(`SELECT release_date FROM sets WHERE id = ?`).get(setId) as { release_date: string | null } | undefined
  const era = eraOf(row?.release_date ? Number(row.release_date.slice(0, 4)) : null)
  setEraCache.set(setId, era)
  return era
}

// ---------------------------------------------------------------------------
// The factors every other system reads.
// ---------------------------------------------------------------------------

/**
 * One card's scene factor: population taste for its era × any live boom
 * (chase cards catch the full wave, bulk rides along at 40%) × the card's own
 * side of its set's chase-vs-bulk split. Everything clamped so weather can
 * never eat a card alive.
 */
export function sceneCardFactor(cardId: string): number {
  const meta = cardMeta(cardId)
  if (!meta) return 1
  const s = scene()
  const row = demandOf(meta.setId)
  const split = meta.chase ? row.chase / row.demand : row.build / row.demand
  return clamp(s.pop[meta.era] * boomFactor(meta.era, meta.chase, s) * split, 0.5, 2)
}

/**
 * A sealed box's scene factor — rip vehicles track the chase cohort hardest
 * (0.65/0.35), so a set's chase heat drives its sealed curve. Applied by
 * sealed.priceDetail only OUT of print: in-print product sells at retail no
 * matter what the scene is doing.
 */
export function sealedFactor(setId: string): number {
  const s = scene()
  const row = demandOf(setId)
  const heat = 0.65 * row.chase + 0.35 * row.build
  return clamp(s.pop[setEra(setId)] * boomFactor(setEra(setId), true, s) * heat, 0.5, 2)
}

/**
 * How much of an era's stock still reaches the marketplace feed. Vintage
 * collectors age into hold-forever: the hotter their era runs, the less of it
 * anybody lists — prices up, supply down, exactly as the old guard intends.
 */
export function eraSupply(yr: number | null): number {
  if (eraOf(yr) !== 'vintage') return 1
  const hot = Math.max(0, scene().pop.vintage - 1)
  return clamp(1 - hot * 1.2, 0.25, 1)
}

// ---------------------------------------------------------------------------
// The tick — once per game-day: expire/spawn booms, walk the population,
// evolve every set's cohorts toward their oscillators.
// ---------------------------------------------------------------------------

export function demoTick(): void {
  const key = gameDayKey()
  if (getMeta(DAY_KEY) === key) return
  setMeta(DAY_KEY, key)

  // 1. Cool the booms that ran out, and maybe start a new one.
  const now = Date.now()
  const live = loadBooms()
  const remain: Boom[] = []
  for (const b of live) {
    if (new Date(b.until).getTime() > now) remain.push(b)
    else logActivity('market', `🌟 ${b.headline} — the hype cools and the scene settles back to normal.`)
  }
  if (remain.length < 2 && Math.random() < 0.07) remain.push(spawnBoom())
  saveBooms(remain)

  // 2. Population walk — mean-reverting tastes with a hold-forever creep on
  //    vintage (old collections move once per lifetime, and right now they
  //    aren't moving).
  const pop = loadPop()
  const walk = (v: number, bias: number) => round3(clamp(v + (Math.random() * 2 - 1) * 0.012 + (1 - v) * 0.02 + bias, 0.82, 1.35))
  pop.vintage = walk(pop.vintage, 0.004)
  pop.mid = walk(pop.mid, 0)
  pop.modern = walk(pop.modern, 0)
  savePop(pop)

  // 3. Set demand — every set steps toward its cohorts' oscillator targets
  //    (the "simulation": two cohorts, own rhythm, per-set phase, plus the
  //    day's noise) and reports the move as a trend.
  ensureRows()
  const rows = db.prepare(`SELECT set_id, chase, build, demand FROM set_demand`).all() as { set_id: string; chase: number; build: number; demand: number }[]
  const upd = db.prepare(`UPDATE set_demand SET chase = ?, build = ?, demand = ?, tilt = ?, trend = ?, updated_at = ? WHERE set_id = ?`)
  db.transaction(() => {
    for (const r of rows) {
      const t = targets(r.set_id)
      const nc = round3(clamp(r.chase + (t.chase - r.chase) * 0.18 + (Math.random() * 2 - 1) * 0.008, 0.6, 1.5))
      const nb = round3(clamp(r.build + (t.build - r.build) * 0.18 + (Math.random() * 2 - 1) * 0.008, 0.6, 1.5))
      const demand = round3((nc + nb) / 2)
      upd.run(nc, nb, demand, round3(nc - nb), round3(demand - r.demand), nowIso(), r.set_id)
    }
  })()

  invalidateSceneCache()
}

// ---------------------------------------------------------------------------
// Read model — the Market view's scene strip.
// ---------------------------------------------------------------------------

export function status(): {
  population: { vintage: number; mid: number; modern: number }
  booms: { id: string; era: Era | 'all'; headline: string; blurb: string; mult: number; daysLeft: number }[]
  hottest: { id: string; name: string; demand: number; trend: number; tilt: number }[]
  coldest: { id: string; name: string; demand: number; trend: number; tilt: number }[]
} {
  ensureRows()
  const s = scene()
  const pick = (dir: 'DESC' | 'ASC') =>
    db
      .prepare(
        `SELECT d.set_id, d.demand, d.trend, d.tilt, s.name
         FROM set_demand d JOIN sets s ON s.id = d.set_id
         ORDER BY d.demand ${dir} LIMIT 5`,
      )
      .all() as { set_id: string; name: string; demand: number; trend: number; tilt: number }[]
  const map = (rows: ReturnType<typeof pick>) =>
    rows.map((r) => ({ id: r.set_id, name: r.name, demand: round3(r.demand), trend: round3(r.trend), tilt: round3(r.tilt) }))
  return {
    population: { vintage: round3(s.pop.vintage), mid: round3(s.pop.mid), modern: round3(s.pop.modern) },
    booms: s.booms.map((b) => ({
      id: b.id,
      era: b.era,
      headline: b.headline,
      blurb: b.blurb,
      mult: b.mult,
      daysLeft: Math.max(1, Math.ceil((new Date(b.until).getTime() - Date.now()) / gameDayMs())),
    })),
    hottest: map(pick('DESC')),
    coldest: map(pick('ASC')),
  }
}
