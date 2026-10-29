import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { round2, type Condition } from './market'
import { trueStats } from './substats'

// ---------------------------------------------------------------------------
// FLEA MARKETS — the junk-bin hunt. Weekend mornings from 6 AM: long folding
// tables of bins priced FLAT (25¢, 50¢, $1, $2, $5 — "25¢ for a shadowless"
// is the fantasy that gets you out of bed). Every card in a bin is one flat
// price; a few are mispriced GOLD (worth 10–200× the bin). The catch: the
// flea opens at 6 AM and NPC PICKERS are already there with flashlights and
// coffee, digging the same bins — every tick they take the best remaining
// cards, so the stall drains while you read the table. FOMO is the mechanic.
//
// Condition Wars rides along: the dig doesn't show the card's condition
// sub-grade, but the market still pays for it later — a 25¢ bin find can be
// a clean-strike NM worth grading, or a snow-capped HP beater. The dig
// PUBLISHES nothing; your eye stays the edge.
// ---------------------------------------------------------------------------

db.exec(`
CREATE TABLE IF NOT EXISTS flea_markets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grounds TEXT NOT NULL,                    -- flavor name of the flea grounds
  status TEXT NOT NULL DEFAULT 'live',      -- live | done
  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  created_at TEXT NOT NULL
)`)
db.exec(`
CREATE TABLE IF NOT EXISTS flea_bins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id INTEGER NOT NULL REFERENCES flea_markets(id),
  price REAL NOT NULL,                      -- flat bin price per card
  label TEXT NOT NULL,                      -- bin flavor line
  created_at TEXT NOT NULL
)`)
db.exec(`
CREATE TABLE IF NOT EXISTS flea_bin_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bin_id INTEGER NOT NULL REFERENCES flea_bins(id),
  card_id TEXT NOT NULL REFERENCES cards(id),
  true_market REAL NOT NULL,                -- hidden band value (NM anchor)
  condition TEXT NOT NULL,
  taken_by TEXT,                            -- NULL = available; else picker name
  taken_at TEXT,
  created_at TEXT NOT NULL
)`)

export const TERMS = {
  binPrices: [0.25, 0.5, 1, 2, 5] as number[],
  binsPerMarket: [5, 9] as [number, number],
  cardsPerBin: [18, 40] as [number, number],
  scoreChance: 0.03,         // chance a bin card is mispriced gold (a real card, really underpriced)
  scorePoolMultiple: [15, 120] as [number, number],  // score cards are worth 15–120× the bin price, honestly
  opensHour: 6,              // the grounds open at 6 AM — pickers know it too
  windowHours: [6, 11] as [number, number],
  maxLive: 2,
  pickerNames: [
    'a guy with a flashlight', 'the graded-slab regular', 'a reseller on her phone',
    'the vintage guy', 'someone\'s kid (shockingly sharp)', 'a Pokémon dad on a mission',
    'the flippers', 'a quiet pro with cotton gloves', 'the 6 AM crew',
  ] as string[],
}

function rand(min: number, max: number) { return min + Math.random() * (max - min) }
function randInt(min: number, max: number) { return Math.floor(rand(min, max + 1)) }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

const GROUNDS = [
  'the drive-in flea', 'the fairgrounds lot', 'the stadium swap meet', 'the elks lodge lot',
  'the community college lot', 'the old Kmart parking lot',
]

const BIN_LABELS = [
  'CARDS 25¢ EACH', 'vintage bin — make an offer we said flat', 'foreign & misc',
  'commons box — fill a bag $2', 'baseball too, sorry', 'the good bin (per grandpa)',
  'ripped pack leftovers', 'papers & postcards & cards?', '50¢ bin, prices firm-ish',
]

// ---------------------------------------------------------------------------
// Spawning — weekend markets that open at 6 AM
// ---------------------------------------------------------------------------

function isWeekendNow(): boolean {
  const d = new Date().getDay()
  return d === 0 || d === 6
}

function beforeOpen(): boolean {
  return new Date().getHours() < TERMS.opensHour
}

export function spawnMarkets() {
  const live = (db.prepare(`SELECT COUNT(*) AS n FROM flea_markets WHERE status = 'live'`).get() as { n: number }).n
  if (live >= TERMS.maxLive) return
  if (!isWeekendNow() || beforeOpen()) return
  // Two chances to see a market per weekend morning; by 6 AM it's on.
  if (Math.random() > 0.6) return
  createMarket()
}

/** Exported for verification only: bypasses the weekend/6AM gate. */
export function debugSpawnMarket() { createMarket() }

function createMarket() {
  // Junk-bin pool: anything with a real price, weighted toward the cheap —
  // the flea is a dig, not a showcase. Rarely (per bin), something real lands.
  const pool = db
    .prepare(
      `SELECT c.id, (SELECT market FROM price_records pr WHERE pr.card_id = c.id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) AS m
       FROM cards c WHERE c.rarity IS NOT NULL AND c.rarity != ''
       ORDER BY RANDOM() LIMIT 800`,
    )
    .all() as { id: string; m: number | null }[]
  const valued = pool.filter((p) => p.m != null && p.m >= 0.05 && p.m <= 400)
  if (valued.length < 30) return

  const grounds = pick(GROUNDS)
  const opensAt = new Date()
  const hours = randInt(TERMS.windowHours[0], TERMS.windowHours[1])
  const closesAt = new Date(Date.now() + hours * 3_600_000)
  const createdAt = nowIso()

  const tx = db.transaction(() => {
    const marketId = db
      .prepare(`INSERT INTO flea_markets (grounds, opens_at, closes_at, created_at) VALUES (?, ?, ?, ?)`)
      .run(grounds, opensAt.toISOString(), closesAt.toISOString(), createdAt).lastInsertRowid as number

    const binN = randInt(TERMS.binsPerMarket[0], TERMS.binsPerMarket[1])
    const insertCard = db.prepare(
      `INSERT INTO flea_bin_cards (bin_id, card_id, true_market, condition, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    const used = new Set<string>()
    for (let b = 0; b < binN; b++) {
      const price = pick(TERMS.binPrices)
      const label = pick(BIN_LABELS)
      const binId = db
        .prepare(`INSERT INTO flea_bins (market_id, price, label, created_at) VALUES (?, ?, ?, ?)`)
        .run(marketId, price, label, createdAt).lastInsertRowid as number
      const n = randInt(TERMS.cardsPerBin[0], TERMS.cardsPerBin[1])
      const conds: Condition[] = ['NM', 'NM', 'NM', 'LP', 'LP', 'MP', 'MP', 'HP', 'DM']
      // Score pool for THIS bin: real cards worth 15–120× the bin price — so
      // every comp the game quotes is honest and verifiable in the app.
      const scorePool = valued.filter((p) => (p.m as number) >= price * TERMS.scorePoolMultiple[0] && (p.m as number) <= Math.min(400, price * TERMS.scorePoolMultiple[1]))
      for (let i = 0; i < n; i++) {
        const isScore = scorePool.length >= 5 && Math.random() < TERMS.scoreChance
        const c = isScore ? pick(scorePool) : pick(valued)
        if (used.has(c.id)) continue
        used.add(c.id)
        const condition = pick(conds)
        const mult = condition === 'NM' ? 1 : condition === 'LP' ? 0.8 : condition === 'MP' ? 0.65 : condition === 'HP' ? 0.5 : 0.35
        insertCard.run(binId, c.id, round2((c.m as number) * mult), condition, createdAt)
      }
    }
  })
  tx()
  logActivity('flea', `🛒 The flea at ${grounds} is open — bins are out and the 6 AM crew got there before you.`, 0)
}

// ---------------------------------------------------------------------------
// Read model (API) — bins show price/label and a live count; contents stay
// anonymous until dug. Digging is one card, visible AFTER you commit.
// ---------------------------------------------------------------------------

export function section(): unknown {
  const markets = db
    .prepare(`SELECT * FROM flea_markets WHERE status = 'live' ORDER BY closes_at ASC`)
    .all() as MarketRow[]
  const now = Date.now()
  const binStmt = db.prepare(`SELECT id, price, label FROM flea_bins WHERE market_id = ? ORDER BY price ASC`)
  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM flea_bin_cards WHERE bin_id = ? AND taken_by IS NULL`)
  const totalStmt = db.prepare(`SELECT COUNT(*) AS n FROM flea_bin_cards WHERE bin_id = ?`)
  // Best-remaining teaser per bin: how many cards are worth >20× the bin price,
  // in the player's own words — the vibe that keeps you digging.
  const scoreStmt = db.prepare(`SELECT COUNT(*) AS n FROM flea_bin_cards WHERE bin_id = ? AND taken_by IS NULL AND true_market >= ?`)

  const digs = recentDigs()

  return {
    terms: { ...TERMS, pickerNames: undefined },
    isWeekend: isWeekendNow(),
    openHour: TERMS.opensHour,
    pickersActive: isWeekendNow() && !beforeOpen(),
    markets: markets.map((m) => {
      const bins = (binStmt.all(m.id) as { id: number; price: number; label: string }[]).map((b) => {
        const remaining = (countStmt.get(b.id) as { n: number }).n
        const total = (totalStmt.get(b.id) as { n: number }).n
        const scores = (scoreStmt.get(b.id, b.price * 20) as { n: number }).n
        return { id: b.id, price: b.price, label: b.label, remaining, total, hotScores: scores }
      })
      return {
        id: m.id,
        grounds: m.grounds,
        opensAt: m.opens_at,
        closesAt: m.closes_at,
        expired: new Date(m.closes_at).getTime() <= now,
        bins,
      }
    }),
    myDigs: digs,
  }
}

type MarketRow = { id: number; grounds: string; status: string; opens_at: string; closes_at: string; created_at: string }

function recentDigs(): DigRow[] {
  const raw = getMeta('flea:myDigs')
  if (!raw) return []
  try {
    const arr = JSON.parse(raw) as DigRow[]
    return Array.isArray(arr) ? arr.slice(0, 12) : []
  } catch {
    return []
  }
}

type DigRow = { name: string; condition: Condition; paid: number; trueMarket: number; stolen: boolean; at: string }

// ---------------------------------------------------------------------------
// The dig — buy one blind card from a bin at the flat price
// ---------------------------------------------------------------------------

export function dig(binId: number): { ok: true; card: DigRow } | { ok: false; error: string } {
  const bin = db.prepare(`SELECT * FROM flea_bins WHERE id = ?`).get(binId) as { id: number; market_id: number; price: number; label: string } | undefined
  if (!bin) return { ok: false, error: 'No such bin.' }
  const market = db.prepare(`SELECT * FROM flea_markets WHERE id = ? AND status = 'live'`).get(bin.market_id) as MarketRow | undefined
  if (!market) return { ok: false, error: 'That flea packed up.' }
  if (new Date(market.closes_at).getTime() <= Date.now()) return { ok: false, error: 'The grounds are closing — too late.' }

  const row = db
    .prepare(
      `SELECT fbc.id, fbc.card_id, fbc.true_market, fbc.condition, c.name
       FROM flea_bin_cards fbc JOIN cards c ON c.id = fbc.card_id
       WHERE fbc.bin_id = ? AND fbc.taken_by IS NULL
       ORDER BY RANDOM() LIMIT 1`,
    )
    .get(binId) as { id: number; card_id: string; true_market: number; condition: Condition; name: string } | undefined
  if (!row) return { ok: false, error: 'That bin is picked clean.' }

  const paid = bin.price
  const at = nowIso()
  let newInvId = 0
  const tx = db.transaction(() => {
    db.prepare(`UPDATE flea_bin_cards SET taken_by = 'player', taken_at = ? WHERE id = ?`).run(at, row.id)
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(paid)
    const ins = db.prepare(
      `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, acquired_ref, cost_basis, acquired_at)
       VALUES (?, 'normal', ?, 1, 'collection', 'flea', ?, ?, ?)`,
    ).run(row.card_id, row.condition, String(binId), paid, at)
    newInvId = Number(ins.lastInsertRowid)
    // The dig log (last 12) — the FOMO scrapbook.
    const digs = recentDigs()
    digs.unshift({ name: row.name, condition: row.condition, paid, trueMarket: row.true_market, stolen: false, at })
    setMeta('flea:myDigs', JSON.stringify(digs.slice(0, 12)))
  })
  tx()
  // The bins are uncurated: high-value digs can be counterfeit (auth.ts).
  import('./auth').then((a) => a.stampRisk(newInvId, row.card_id, 'normal', row.condition, 'flea')).catch(() => {})

  const multiple = row.true_market >= paid * 10
  logActivity(
    'flea',
    multiple
      ? `🛒 SCORE: ${row.name} (${row.condition}) out of the $${paid.toFixed(2)} bin — comps ~$${row.true_market.toFixed(2)}. The 6 AM crew missed it.`
      : `🛒 Flea dig: ${row.name} (${row.condition}) for $${paid.toFixed(2)} — comps ~$${row.true_market.toFixed(2)}.`,
    -paid,
  )
  return { ok: true, card: { name: row.name, condition: row.condition, paid, trueMarket: row.true_market, stolen: false, at } }
}

// ---------------------------------------------------------------------------
// NPC pickers — the drain. Every tick they take the BEST remaining cards,
// highest true-market first with noise, so the score you're chewing on might
// be gone next tick. Starts at the 6 AM open; they're ravenous early.
// ---------------------------------------------------------------------------

export function pickerTick() {
  const markets = db.prepare(`SELECT id, closes_at FROM flea_markets WHERE status = 'live'`).all() as { id: number; closes_at: string }[]
  for (const m of markets) {
    if (new Date(m.closes_at).getTime() <= Date.now()) continue
    // Each market sees 1–3 pickers per tick; they take 1–4 cards each.
    const pickerCount = randInt(1, 3)
    for (let p = 0; p < pickerCount; p++) {
      const who = pick(TERMS.pickerNames)
      const takeN = randInt(1, 4)
      for (let i = 0; i < takeN; i++) {
        // Weighted toward value but with a casual hand: they miss things.
        const victim = db
          .prepare(
            `SELECT id, true_market FROM flea_bin_cards WHERE bin_id IN (SELECT id FROM flea_bins WHERE market_id = ?) AND taken_by IS NULL
             ORDER BY RANDOM() * true_market DESC LIMIT 1`,
          )
          .get(m.id) as { id: number; true_market: number } | undefined
        if (!victim) break
        // A picker might pass a low-value card (they're human, mostly).
        if (victim.true_market < 0.5 && Math.random() < 0.4) continue
        db.prepare(`UPDATE flea_bin_cards SET taken_by = ?, taken_at = ? WHERE id = ? AND taken_by IS NULL`).run(who, nowIso(), victim.id)
      }
    }
    // The FOMO feed: when a picker pulls something GOOD, tell everyone.
    const stolen = db
      .prepare(
        `SELECT fbc.true_market, fbc.taken_by, fb.price, c.name
         FROM flea_bin_cards fbc JOIN flea_bins fb ON fb.id = fbc.bin_id JOIN cards c ON c.id = fbc.card_id
         WHERE fb.market_id = ? AND fbc.taken_by IS NOT NULL AND fbc.taken_by != 'player' AND fbc.taken_at >= ?
         ORDER BY fbc.true_market DESC LIMIT 1`,
      )
      .get(m.id, new Date(Date.now() - 25_000).toISOString()) as { true_market: number; taken_by: string; price: number; name: string } | undefined
    if (stolen && stolen.true_market >= stolen.price * 15 && Math.random() < 0.35) {
      logActivity('flea', `😳 ${stolen.taken_by} just pulled ${stolen.name} from a $${stolen.price.toFixed(2)} bin — comps ~$${stolen.true_market.toFixed(2)}. You were reading that table.`, 0)
    }
  }
}

// ---------------------------------------------------------------------------
// Tick — expire, spawn, pickers dig
// ---------------------------------------------------------------------------

export function fleaTick() {
  db.prepare(`UPDATE flea_markets SET status = 'done' WHERE status = 'live' AND closes_at <= ?`).run(nowIso())
  spawnMarkets()
  pickerTick()

  // One-time tutorial nudge the first time a live market exists.
  if (getMeta('tut:flea') !== '1') {
    const live = (db.prepare(`SELECT COUNT(*) AS n FROM flea_markets WHERE status = 'live'`).get() as { n: number }).n
    if (live > 0) {
      setMeta('tut:flea', '1')
      logActivity('flea', 'Flea markets are open this weekend — bins go flat-price, and the pickers dig fast. Score or spectate.')
    }
  }
}
