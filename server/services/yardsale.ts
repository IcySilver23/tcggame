import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { round2, type Condition } from './market'

// ---------------------------------------------------------------------------
// YARD SALES — the Saturday-morning gamble. NPC households put card tables on
// the lawn; most price from vibes, a few know exactly what they have. There is
// no market column on the table: each pile gets a one-line PEEK ("rubber-banded,
// looks like a prize-era holo") calibrated at ~25–35% of true value — reading
// the table IS the skill. Offers are welcome: sellers have a hidden rigidity,
// lowball too hard and they wave you off (two counters max, then the attitude
// sours). Some sales also run a MYSTERY BOX — flat price, contents generated at
// spawn, revealed the moment you pay. Windows are weekend mornings; by Sunday
// evening the driveways are bare.
// ---------------------------------------------------------------------------

// Migration: yard sales (existing DBs predate the tables).
db.exec(`
CREATE TABLE IF NOT EXISTS yard_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller TEXT NOT NULL,
  neighborhood TEXT NOT NULL,
  rigidity REAL NOT NULL DEFAULT 0.7,      -- fraction of ask the seller accepts before countering
  box_ask REAL,                            -- NULL = no box this sale
  box_taken INTEGER NOT NULL DEFAULT 0,
  player_offered REAL NOT NULL DEFAULT 0,  -- last offer made (any card)
  seller_counters INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'live',     -- live | done
  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  created_at TEXT NOT NULL
)`)
db.exec(`
CREATE TABLE IF NOT EXISTS yard_sale_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES yard_sales(id),
  card_id TEXT NOT NULL REFERENCES cards(id),
  condition TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  ask REAL NOT NULL,
  peek TEXT NOT NULL,
  true_market REAL NOT NULL,               -- hidden; used for the box reveal + verify
  status TEXT NOT NULL DEFAULT 'available' -- available | boxed | sold
)`)

export const TERMS = {
  peekCalibration: [0.25, 0.35] as [number, number],
  counterWindow: 0.15,     // offers within ask × (rigidity + this) draw a counter
  counterMax: 2,
  boxAskPct: 0.55,         // box ask ≈ 55% of contents EV (they didn't price it either)
  tableSize: [8, 14] as [number, number],
  boxSize: [16, 26] as [number, number],
  windowHours: [6, 14] as [number, number],
}

const SELLERS = [
  'the Hendersons', 'Dot from the cul-de-sac', "Marty's garage", 'the Ortiz family',
  'Wayne & the boys', 'Mrs. Kowalski', 'the127 street house', 'Grandpa Joe',
  'the teen up the block', "Coach Dan's driveway", 'the Whitmans', 'Randy (moving out)',
]
const NEIGHBORHOODS = ['Maple Grove', 'the Fairview sale circle', 'Old Town blocks', 'the Lakeside subdivision', 'Route 9 frontage', 'Heritage Hills']

// Peek frames by TRUE value band; calibration number rides on the end.
const PEEK_FRAMES: [number, string][] = [
  [40, 'in a toploader under the folding table — they keep asking people not to breathe on it'],
  [12, 'a thick holo in a screwdown, clearly the good stuff'],
  [3, 'a shiny one in a penny sleeve, kept out of the sun'],
  [0.8, 'a short stack of rares, rubber-banded'],
  [0, 'a shoebox of commons, mostly doubles'],
]

function peekFor(trueValue: number): string {
  const frame = PEEK_FRAMES.find(([min]) => trueValue >= min)?.[1] ?? PEEK_FRAMES[PEEK_FRAMES.length - 1][1]
  const skill = TERMS.peekCalibration[0] + Math.random() * (TERMS.peekCalibration[1] - TERMS.peekCalibration[0])
  const guess = Math.max(0.05, trueValue * skill)
  return `Looks like ${guess >= 1 ? `$${guess.toFixed(0)}` : `${Math.round(guess * 100)}¢`} of card, if the tape means anything — ${frame}.`
}

function rand(min: number, max: number) { return min + Math.random() * (max - min) }
function randInt(min: number, max: number) { return Math.floor(rand(min, max + 1)) }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

// ---------------------------------------------------------------------------
// Spawning — weekend mornings, a sale or two per neighborhood loop
// ---------------------------------------------------------------------------

function isWeekendNow(): boolean {
  const d = new Date().getDay()
  return d === 0 || d === 6
}

export function spawnSales() {
  const live = (db.prepare(`SELECT COUNT(*) AS n FROM yard_sales WHERE status = 'live'`).get() as { n: number }).n
  if (live >= 4) return
  // Weekend mornings are prime time; a stray weekday driveway happens sometimes.
  const chance = isWeekendNow() ? 0.5 : 0.04
  if (Math.random() > chance) return

  const n = Math.random() < 0.7 ? 1 : 2
  for (let i = 0; i < n && live + i < 4; i++) createSale()
}

/** Exported for verification only: bypasses the weekend gate. */
export function debugSpawnSale() { createSale() }

function createSale() {
  const priceRecords = db
    .prepare(
      `SELECT c.id, (SELECT market FROM price_records pr WHERE pr.card_id = c.id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) AS m
       FROM cards c WHERE c.rarity IS NOT NULL AND c.rarity != ''
       ORDER BY RANDOM() LIMIT 600`,
    )
    .all() as { id: string; m: number | null }[]
  const valued = priceRecords.filter((p) => p.m != null && p.m >= 0.1 && p.m <= 120)
  if (valued.length < 20) return

  const seller = pick(SELLERS)
  const neighborhood = pick(NEIGHBORHOODS)
  const rigidity = round2(rand(0.55, 0.9))
  const opensAt = new Date()
  const closesAt = new Date(Date.now() + randInt(TERMS.windowHours[0], TERMS.windowHours[1]) * 3_600_000)

  const tx = db.transaction(() => {
    const saleId = db
      .prepare(`INSERT INTO yard_sales (seller, neighborhood, rigidity, opens_at, closes_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(seller, neighborhood, rigidity, opensAt.toISOString(), closesAt.toISOString(), nowIso()).lastInsertRowid as number

    const insert = db.prepare(
      `INSERT INTO yard_sale_cards (sale_id, card_id, condition, qty, ask, peek, true_market, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const conds: Condition[] = ['NM', 'NM', 'LP', 'LP', 'MP', 'HP']

    // The card table: vibes-priced singles and small stacks.
    const tableN = randInt(TERMS.tableSize[0], TERMS.tableSize[1])
    const usedTable = new Set<string>()
    for (let i = 0; i < tableN; i++) {
      const c = pick(valued)
      if (usedTable.has(c.id)) continue
      usedTable.add(c.id)
      const m = c.m as number
      const condition = pick(conds)
      const trueV = round2(m * (condition === 'NM' ? 1 : condition === 'LP' ? 0.8 : condition === 'MP' ? 0.65 : condition === 'HP' ? 0.5 : 0.35))
      const qty = m < 2 ? randInt(1, 4) : 1
      // Vibes pricing: most sellers guess wildly, a rare few price near market.
      const mult = Math.random() < 0.12 ? rand(0.9, 1.1) : rand(0.25, 2.2)
      const ask = Math.max(0.1, round2(trueV * mult))
      insert.run(saleId, c.id, condition, qty, ask, peekFor(trueV), trueV, 'available')
    }

    // The mystery box, if this household runs one.
    if (Math.random() < 0.55) {
      const boxN = randInt(TERMS.boxSize[0], TERMS.boxSize[1])
      const pool = valued.filter((c) => (c.m as number) >= 0.1 && (c.m as number) <= 30)
      if (pool.length >= 10) {
        let ev = 0
        for (let i = 0; i < boxN; i++) {
          const c = pick(pool)
          const m = c.m as number
          const condition = pick(conds)
          const trueV = round2(m * (condition === 'NM' ? 1 : condition === 'LP' ? 0.8 : condition === 'MP' ? 0.65 : condition === 'HP' ? 0.5 : 0.35))
          ev += trueV
          insert.run(saleId, c.id, condition, 1, 0, 'sealed — buy the box to find out', trueV, 'boxed')
        }
        const boxAsk = Math.max(1, round2(ev * TERMS.boxAskPct * rand(0.8, 1.15)))
        db.prepare(`UPDATE yard_sales SET box_ask = ? WHERE id = ?`).run(boxAsk, saleId)
      }
    }
  })
  tx()
}

// ---------------------------------------------------------------------------
// Read model (API)
// ---------------------------------------------------------------------------

export function section(): unknown {
  const sales = db
    .prepare(`SELECT * FROM yard_sales WHERE status = 'live' ORDER BY closes_at ASC`)
    .all() as SaleRow[]
  const cardStmt = db.prepare(
    `SELECT ysc.id, ysc.condition, ysc.qty, ysc.ask, ysc.peek, ysc.status, c.name
     FROM yard_sale_cards ysc JOIN cards c ON c.id = ysc.card_id
     WHERE ysc.sale_id = ? AND ysc.status != 'sold'`,
  )
  const now = Date.now()
  return {
    terms: TERMS,
    isWeekend: isWeekendNow(),
    sales: sales.map((s) => {
      const cards = cardStmt.all(s.id) as { id: number; condition: Condition; qty: number; ask: number; peek: string; status: string; name: string }[]
      return {
        id: s.id,
        seller: s.seller,
        neighborhood: s.neighborhood,
        opensAt: s.opens_at,
        closesAt: s.closes_at,
        expired: new Date(s.closes_at).getTime() <= now,
        boxAsk: s.box_ask,
        boxTaken: !!s.box_taken,
        playerOffered: s.player_offered,
        sellerCounters: s.seller_counters,
        // Table rows only; the box stays sealed. Names stay hidden — the peek is the data.
        table: cards.filter((c) => c.status === 'available').map(({ id, condition, qty, ask, peek }) => ({ id, condition, qty, ask, peek })),
        boxCount: cards.filter((c) => c.status === 'boxed').length,
      }
    }),
  }
}

type SaleRow = {
  id: number; seller: string; neighborhood: string; rigidity: number; box_ask: number | null
  box_taken: number; player_offered: number; seller_counters: number; status: string
  opens_at: string; closes_at: string; created_at: string
}

// ---------------------------------------------------------------------------
// The table: haggling
// ---------------------------------------------------------------------------

export function negotiate(
  cardRowId: number,
  offer: number,
): { ok: true; accepted: boolean; paid?: number; counter?: number | null; card?: string; message?: string } | { ok: false; error: string } {
  const row = db
    .prepare(
      `SELECT ysc.*, ys.id AS sale_id, ys.status AS sale_status, ys.rigidity, ys.seller_counters, ys.seller, c.name
       FROM yard_sale_cards ysc JOIN yard_sales ys ON ys.id = ysc.sale_id JOIN cards c ON c.id = ysc.card_id
       WHERE ysc.id = ?`,
    )
    .get(cardRowId) as ( { card_id: string; condition: Condition; qty: number; ask: number; status: string; sale_id: number; sale_status: string; rigidity: number; seller_counters: number; seller: string; name: string } ) | undefined
  if (!row || row.sale_status !== 'live' || row.status !== 'available') return { ok: false, error: 'That table is gone — the sale packed up.' }
  const bid = round2(Math.max(0.05, offer || 0))

  const accept = () => {
    let newInvId = 0
    const tx = db.transaction(() => {
      db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(bid)
      const ins = db.prepare(
        `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, acquired_ref, cost_basis, acquired_at)
         VALUES (?, 'normal', ?, ?, 'collection', 'yard_sale', ?, ?, ?)`,
      ).run(row.card_id, row.condition, row.qty, String(row.sale_id), bid, nowIso())
      newInvId = Number(ins.lastInsertRowid)
      db.prepare(`UPDATE yard_sale_cards SET status = 'sold' WHERE id = ?`).run(cardRowId)
      db.prepare(`UPDATE yard_sales SET player_offered = ? WHERE id = ?`).run(bid, row.sale_id)
    })
    tx()
    // Driveway provenance — the dice can land a counterfeit (auth.ts).
    import('./auth').then((a) => a.stampRisk(newInvId, row.card_id, 'normal', row.condition, 'yard_sale')).catch(() => {})
    logActivity('yard', `Yard sale: talked ${row.seller} down to $${bid.toFixed(2)} for ${row.name} (asked $${row.ask.toFixed(2)}).`, -bid)
    return { ok: true as const, accepted: true, paid: bid, card: row.name }
  }

  if (bid >= row.ask * row.rigidity) return accept()

  // Just under their number — close enough to counter rather than show you the hose.
  if (bid >= row.ask * (row.rigidity - TERMS.counterWindow) && row.seller_counters < TERMS.counterMax) {
    const counter = round2((bid + row.ask) / 2)
    db.prepare(`UPDATE yard_sales SET player_offered = ?, seller_counters = seller_counters + 1 WHERE id = ?`).run(bid, row.sale_id)
    return { ok: true, accepted: false, counter, card: row.name, message: `“Best I'll do is $${counter.toFixed(2)}.”` }
  }

  db.prepare(`UPDATE yard_sales SET player_offered = ? WHERE id = ?`).run(bid, row.sale_id)
  return { ok: true, accepted: false, counter: null, card: row.name, message: `“Nah, I know what I've got.”` }
}

/** Buy a table pile at the sticker ask — no haggling, no risk of souring anyone. */
export function buyAtAsk(cardRowId: number): { ok: true; paid: number; card: string } | { ok: false; error: string } {
  const row = db
    .prepare(
      `SELECT ysc.*, ys.id AS sale_id, ys.status AS sale_status, ys.seller, c.name
       FROM yard_sale_cards ysc JOIN yard_sales ys ON ys.id = ysc.sale_id JOIN cards c ON c.id = ysc.card_id
       WHERE ysc.id = ?`,
    )
    .get(cardRowId) as ({ card_id: string; condition: Condition; qty: number; ask: number; status: string; sale_id: number; sale_status: string; seller: string; name: string } | undefined)
  if (!row || row.sale_status !== 'live' || row.status !== 'available') return { ok: false, error: 'That table is gone — the sale packed up.' }
  let newInvId = 0
  const tx = db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(row.ask)
    const ins = db.prepare(
      `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, acquired_ref, cost_basis, acquired_at)
       VALUES (?, 'normal', ?, ?, 'collection', 'yard_sale', ?, ?, ?)`,
    ).run(row.card_id, row.condition, row.qty, String(row.sale_id), row.ask, nowIso())
    newInvId = Number(ins.lastInsertRowid)
    db.prepare(`UPDATE yard_sale_cards SET status = 'sold' WHERE id = ?`).run(cardRowId)
  })
  tx()
  // Driveway provenance — the dice can land a counterfeit (auth.ts).
  import('./auth').then((a) => a.stampRisk(newInvId, row.card_id, 'normal', row.condition, 'yard_sale')).catch(() => {})
  logActivity('yard', `Yard sale: paid ${row.seller} $${row.ask.toFixed(2)} for ${row.name} ×${row.qty}.`, -row.ask)
  return { ok: true, paid: row.ask, card: row.name }
}

// ---------------------------------------------------------------------------
// The mystery box: flat price, instant reveal
// ---------------------------------------------------------------------------

export function revealBox(saleId: number): { ok: true; cards: { name: string; condition: Condition; qty: number; value: number }[]; paid: number; trueTotal: number } | { ok: false; error: string } {
  const s = db.prepare(`SELECT * FROM yard_sales WHERE id = ? AND status = 'live'`).get(saleId) as SaleRow | undefined
  if (!s) return { ok: false, error: 'Sale not found or already packed up.' }
  if (s.box_ask == null || s.box_taken) return { ok: false, error: 'No box left at this sale.' }
  const rows = db
    .prepare(
      `SELECT ysc.card_id, ysc.condition, ysc.true_market, c.name FROM yard_sale_cards ysc JOIN cards c ON c.id = ysc.card_id
       WHERE ysc.sale_id = ? AND ysc.status = 'boxed'`,
    )
    .all(saleId) as { card_id: string; condition: Condition; true_market: number; name: string }[]
  if (rows.length === 0) return { ok: false, error: 'No box left at this sale.' }

  const paid = s.box_ask
  const stamped: { inventoryId: number; cardId: string; condition: string }[] = []
  const tx = db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(paid)
    const insert = db.prepare(
      `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, acquired_ref, cost_basis, acquired_at)
       VALUES (?, 'normal', ?, 1, 'collection', 'yard_sale_box', ?, ?, ?)`,
    )
    for (const r of rows) {
      const res = insert.run(r.card_id, r.condition, String(saleId), round2(paid / rows.length), nowIso())
      stamped.push({ inventoryId: Number(res.lastInsertRowid), cardId: r.card_id, condition: r.condition })
    }
    db.prepare(`UPDATE yard_sale_cards SET status = 'sold' WHERE sale_id = ? AND status = 'boxed'`).run(saleId)
    db.prepare(`UPDATE yard_sales SET box_taken = 1 WHERE id = ?`).run(saleId)
  })
  tx()
  // Mystery boxes are the wildest buy in the game — the dice know it (auth.ts).
  import('./auth').then((a) => a.stampRiskBatch(stamped, 'mystery')).catch(() => {})

  const trueTotal = round2(rows.reduce((a, r) => a + r.true_market, 0))
  logActivity(
    'yard',
    `Yard sale: ${s.seller}'s box — ${rows.length} cards for $${paid.toFixed(2)}, worth $${trueTotal.toFixed(2)} (${trueTotal >= paid ? '+' : ''}$${(trueTotal - paid).toFixed(2)}).`,
    -paid,
  )
  return {
    ok: true,
    paid,
    trueTotal,
    cards: rows.map((r) => ({ name: r.name, condition: r.condition, qty: 1, value: r.true_market })),
  }
}

// ---------------------------------------------------------------------------
// Tick — expire dead windows, spawn weekend driveways
// ---------------------------------------------------------------------------

export function yardSaleTick() {
  const now = nowIso()
  db.prepare(`UPDATE yard_sales SET status = 'done' WHERE status = 'live' AND closes_at <= ?`).run(now)
  spawnSales()

  // One-time tutorial nudge the first time a live sale exists.
  if (getMeta('tut:yard') !== '1') {
    const live = (db.prepare(`SELECT COUNT(*) AS n FROM yard_sales WHERE status = 'live'`).get() as { n: number }).n
    if (live > 0) {
      setMeta('tut:yard', '1')
      logActivity('yard', 'Card tables on the lawns this weekend — check Yard Sales before someone else reads the table first.')
    }
  }
}
