import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { valueOf, gradedPriceOf, round2, CONDITIONS, type Condition } from './market'

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------

const BIDDERS = [
  'GrailChaser_88', 'SlabWhisperer', 'VintageVanessa', 'BidWarBenny', 'CardboardCarl',
  'PSAorDeath', 'PackToTheFuture', 'HoloHawk', 'ReverseRiley', 'FlipZoneFred',
  'BinderBossBridget', 'GemRateGoblin', 'MomentumMike', 'QuietQLou', 'NostalgiaNed',
  'CheapCheapChen', 'LastSecondLena', 'ZoomZoomZack',
]

const DRAMA = [
  'The room leans forward.', 'Phones come out — this one is being watched.',
  'Two collectors are NOT letting this go.', 'Auctioneer is struggling to keep up.',
  'Someone in the back just discovered their limit.', 'This is the lot people came for.',
]

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ---------------------------------------------------------------------------
// Lot spawning — the house only auctions cards with REAL market data
// ---------------------------------------------------------------------------

function scheduleFor(anchor: number): number {
  // Tighter windows (was 5–35 min): with ~10 lots live the room always has
  // something starting and something about to hammer.
  if (anchor <= 50) return rand(3, 9) * 60_000
  if (anchor <= 200) return rand(5, 14) * 60_000
  return rand(8, 20) * 60_000
}

function spawnLot() {
  const slab = Math.random() < 0.15
  const grade = slab ? pick(['PSA10', 'PSA9', 'PSA8', 'BGS10']) : null
  const minMarket = grade ? 30 : 1
  const maxMarket = grade ? 5000 : 2500
  const cond: Condition = grade ? 'NM' : pick(CONDITIONS.filter((c) => c !== 'DM'))

  // Premier nights: rare chance of a high-value headliner.
  const premier = Math.random() < 0.12
  const pool = db
    .prepare(
      `SELECT c.id FROM cards c
       WHERE (SELECT market FROM price_records pr WHERE pr.card_id = c.id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) BETWEEN ? AND ?
       ORDER BY RANDOM() LIMIT 1`,
    )
    .get(premier ? 400 : minMarket, premier ? 5000 : maxMarket) as { id: string } | undefined
  if (!pool) return

  const cardId = pool.id
  const anchor = grade ? gradedPriceOf(cardId, grade).usd : valueOf(cardId, 'normal', cond)
  if (anchor <= 0) return

  // Opening bid well under the anchor — that's what drags the room in.
  const openFrac = premier ? rand(0.35, 0.5) : rand(0.4, 0.6)
  const low = anchor * (premier ? 1.1 : 0.9)
  const high = anchor * (premier ? 2.2 : 1.35)
  const dur = scheduleFor(anchor) * (premier ? 1.6 : 1)

  db.prepare(
    `INSERT INTO auctions (card_id, variant, condition, graded_grade, seller, anchor, estimate_low, estimate_high, current_bid, opened_at, closes_at, status)
     VALUES (?, 'normal', ?, ?, 'house', ?, ?, ?, ?, ?, ?, 'live')`,
  ).run(cardId, cond, grade, round2(anchor), round2(low), round2(high), round2(anchor * openFrac), nowIso(), new Date(Date.now() + dur).toISOString())

  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(cardId) as { name: string }).name
  logActivity('auction', `Lot opens: ${name}${grade ? ` (${grade})` : ` (${cond})`} — bidding from $${round2(anchor * openFrac).toFixed(2)} (est. $${round2(low).toFixed(2)}–${round2(high).toFixed(2)}).`)
}

// ---------------------------------------------------------------------------
// The war — NPCs push each other around the estimate band
// ---------------------------------------------------------------------------

function npcWarPass() {
  const lots = db.prepare(`SELECT * FROM auctions WHERE status = 'live'`).all() as {
    id: number; card_id: string; condition: string; graded_grade: string | null; anchor: number
    current_bid: number; bid_count: number; leader: string | null; closes_at: string
    estimate_high: number; my_escrow: number; seller: string
  }[]
  for (const lot of lots) {
    const msLeft = new Date(lot.closes_at).getTime() - Date.now()
    const heat = lot.current_bid / lot.estimate_high // how far into the estimate we've climbed

    // Waning interest once bids overshoot the high estimate.
    let chance = heat < 0.7 ? 0.5 : heat < 1 ? 0.3 : 0.12
    // Hammer guarantee: never let a watched lot die quietly at 2 bids.
    if (msLeft < 45_000 && lot.bid_count < 3) chance = 1
    if (Math.random() > chance) continue

    const inc = Math.max(0.5, round2(lot.current_bid * rand(0.1, 0.25)))
    let newBid = round2(lot.current_bid + inc)

    if (lot.leader === 'you') {
      // Proxy semantics: NPCs can't see your max. A raise at or above it means
      // they stomp off; below it, your proxy answers — but never beyond your max.
      if (lot.my_escrow > 0 && newBid >= lot.my_escrow) {
        const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(lot.card_id) as { name: string }).name
        logActivity('auction', `${name}: ${pick(BIDDERS)} drops out at $${newBid.toFixed(2)} — your max holds.`)
        continue
      }
      const proxy = lot.my_escrow > 0 ? Math.min(round2(newBid * 1.05), lot.my_escrow) : newBid
      if (proxy <= lot.current_bid) {
        // Your max can't answer — the NPC takes the lead outright.
        db.prepare(`UPDATE auctions SET current_bid = ?, bid_count = bid_count + 1, leader = ? WHERE id = ?`).run(newBid, pick(BIDDERS), lot.id)
      } else {
        db.prepare(`UPDATE auctions SET current_bid = ?, bid_count = bid_count + 1 WHERE id = ?`).run(proxy, lot.id)
      }
      continue
    }

    const newLeader = lot.leader ? pick(BIDDERS.filter((b) => b !== lot.leader)) : pick(BIDDERS)
    db.prepare(`UPDATE auctions SET current_bid = ?, bid_count = bid_count + 1, leader = ? WHERE id = ?`).run(newBid, newLeader, lot.id)

    if (lot.bid_count === 3 || newBid > lot.estimate_high * 1.25) {
      const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(lot.card_id) as { name: string }).name
      logActivity('auction', `${name}: $${newBid.toFixed(2)} — ${pick(DRAMA)}`)
    }
  }
}

/** Your bid — escrows your full max, proxy-counters NPCs, refunds if beaten. */
export function placeBid(auctionId: number, maxBid: number) {
  const lot = db.prepare(`SELECT * FROM auctions WHERE id = ? AND status = 'live'`).get(auctionId) as
    | { id: number; current_bid: number; my_escrow: number; leader: string | null; closes_at: string; extended: number; card_id: string; seller: string }
    | undefined
  if (!lot) return { ok: false, error: 'Lot is not live' }
  if (lot.seller === 'you') return { ok: false, error: "That's your own lot — no self-bidding" }
  // First-use tutorial gate: any real bid attempt counts as taught.
  if (getMeta('tut:auction') !== '1') setMeta('tut:auction', '1')
  const msLeft = new Date(lot.closes_at).getTime() - Date.now()
  if (msLeft <= 0) return { ok: false, error: 'The hammer already fell' }

  const minBid = lot.current_bid > 0 ? round2(lot.current_bid * 1.05) : 0.5
  if (maxBid < minBid) return { ok: false, error: `Bid at least $${minBid.toFixed(2)}` }
  const required = round2(maxBid - lot.my_escrow)
  const gs = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (gs.cash < required) return { ok: false, error: `Escrow needs $${required.toFixed(2)} — not enough cash` }
  // Lock the incremental escrow NOW; it comes back as a refund if you're outbid
  // or as change when you win below your max.
  if (required > 0) db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(required)

  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(lot.card_id) as { name: string }).name
  const wasLeading = lot.leader === 'you'
  if (wasLeading) {
    // Raising your own max: escrow grows, hammer price doesn't move.
    db.prepare(`UPDATE auctions SET my_escrow = ? WHERE id = ?`).run(round2(maxBid), lot.id)
  } else {
    // You take the lead at one increment over the current bid; your max stays hidden.
    db.prepare(`UPDATE auctions SET my_escrow = ?, leader = 'you', current_bid = ?, bid_count = bid_count + 1 WHERE id = ?`).run(round2(maxBid), minBid, lot.id)
  }

  const snipe = msLeft < 45_000 && !lot.extended
  if (snipe) {
    db.prepare(`UPDATE auctions SET extended = 1, closes_at = ? WHERE id = ?`).run(new Date(Date.now() + 45_000).toISOString(), lot.id)
    logActivity('auction', `⏱️ Snipe guard: ${name} extended 45 seconds — the room reacts.`)
  }
  logActivity('auction', `You bid up to $${maxBid.toFixed(2)} on ${name}. Escrow locked: $${maxBid.toFixed(2)}.`)
  return { ok: true, escrowed: round2(maxBid), minBid, message: `Max bid $${maxBid.toFixed(2)} locked. ${wasLeading ? 'Your max is raised.' : 'You lead.'}${snipe ? ' Extended 45s!' : ''}` }
}

// ---------------------------------------------------------------------------
// Settlement — hammers fall, escrow unwinds, slabs and singles change hands
// ---------------------------------------------------------------------------

function settlePass() {
  const lots = db
    .prepare(`SELECT * FROM auctions WHERE status = 'live' AND closes_at <= ?`)
    .all(nowIso()) as {
    id: number; card_id: string; variant: string; condition: string; graded_grade: string | null
    seller: string; inventory_id: number | null; anchor: number; current_bid: number; bid_count: number
    leader: string | null; my_escrow: number
  }[]

  for (const lot of lots) {
    const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(lot.card_id) as { name: string }).name
    const unsold = lot.bid_count === 0

    if (unsold) {
      db.prepare(`UPDATE auctions SET status = 'passed' WHERE id = ?`).run(lot.id)
      if (lot.seller === 'you') {
        db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL WHERE id = ?`).run(lot.inventory_id)
        logActivity('auction', `${name} failed to sell at auction — it's back in your collection.`)
      }
      continue
    }

    const hammer = lot.current_bid
    db.prepare(`UPDATE auctions SET status = 'won', final_bid = ?, settled_at = ? WHERE id = ?`).run(hammer, nowIso(), lot.id)

    if (lot.leader === 'you') {
      // You won: settle against your escrow — excess refunded, shortfall
      // (only possible from pre-proxy legacy lots) charged.
      const refund = round2(lot.my_escrow - hammer)
      if (refund > 0) db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(refund)
      else if (refund < 0) db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(-refund)
      const gradeForDb = lot.graded_grade
      db.prepare(
        `INSERT INTO inventory (card_id, variant, condition, quantity, status, graded_grade, acquired_via, cost_basis, acquired_at)
         VALUES (?, ?, ?, 1, 'collection', ?, 'auction', ?, ?)`,
      ).run(lot.card_id, lot.variant, lot.condition, gradeForDb, hammer, nowIso())
      const deal = hammer < lot.anchor * 0.9 ? 'Under market — nice.' : hammer > lot.anchor * 1.2 ? 'Above market. Love is expensive.' : 'About market.'
      logActivity('auction', `YOU WON ${name}${lot.graded_grade ? ` (${lot.graded_grade})` : ''} for $${hammer.toFixed(2)} — ${deal}`)
    } else if (lot.seller === 'you') {
      // Your consignment sold: 15% buyer's premium taken by the house.
      const proceeds = round2(hammer * 0.85)
      const cost = (db.prepare(`SELECT cost_basis FROM inventory WHERE id = ?`).get(lot.inventory_id) as { cost_basis: number })?.cost_basis ?? 0
      const fee = round2(hammer - proceeds)
      const profit = round2(proceeds - cost)
      db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(proceeds)
      db.prepare(`UPDATE inventory SET status = 'sold', quantity = 0 WHERE id = ?`).run(lot.inventory_id)
      db.prepare(
        `INSERT INTO sale_history (inventory_id, card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'auction', ?)`,
      ).run(lot.inventory_id, lot.card_id, lot.variant, lot.condition, proceeds, cost, fee, profit, lot.leader ?? 'auction', nowIso())
      logActivity('auction', `Your ${name} hammered for $${hammer.toFixed(2)} — $${proceeds.toFixed(2)} to you after the house's 15%.`)
    } else {
      logActivity('auction', `${name} sold for $${hammer.toFixed(2)} to ${lot.leader}.`)
    }

    // If you were outbid on a house lot, your escrow comes straight back.
    if (lot.leader !== 'you' && lot.my_escrow > 0) {
      db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(lot.my_escrow)
      logActivity('auction', `Outbid on ${name} — $${lot.my_escrow.toFixed(2)} escrow returned.`)
    }
  }
}

// ---------------------------------------------------------------------------
// Consignment — put YOUR card on the block
// ---------------------------------------------------------------------------

export function consignCard(inventoryId: number) {
  const row = db
    .prepare(`SELECT i.*, c.name FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ? AND i.status = 'collection'`)
    .get(inventoryId) as { id: number; card_id: string; condition: string; graded_grade: string | null; name: string; fake_revealed: number; is_fake: number } | undefined
  if (!row) return { ok: false, error: 'Card not available to consign' }
  // AUTH META: known fakes trade nowhere but the training wall — and no
  // auction house is authenticating on the player's word.
  if (row.fake_revealed || row.is_fake) return { ok: false, error: 'Known counterfeit — buylist shops pay $1 flat for it (Inventory → 🛡 Authentication)' }
  const anchor = row.graded_grade ? gradedPriceOf(row.card_id, row.graded_grade).usd : valueOf(row.card_id, 'normal', (row.condition as Condition) || 'NM')
  if (anchor <= 0) return { ok: false, error: 'No market data for that card yet' }

  const open = round2(anchor * 1.1)
  const dur = rand(15, 30) * 60_000
  db.transaction(() => {
    db.prepare(`UPDATE inventory SET status = 'listed', listed_at = ? WHERE id = ?`).run(nowIso(), row.id)
    db.prepare(
      `INSERT INTO auctions (card_id, variant, condition, graded_grade, seller, inventory_id, anchor, estimate_low, estimate_high, current_bid, opened_at, closes_at, status)
       VALUES (?, 'normal', ?, ?, 'you', ?, ?, ?, ?, ?, ?, ?, 'live')`,
    ).run(row.card_id, row.condition, row.graded_grade, row.id, round2(anchor), round2(anchor * 0.9), round2(anchor * 1.6), open, nowIso(), new Date(Date.now() + dur).toISOString())
  })()
  logActivity('auction', `You consigned ${row.name} — bidding opens at $${open.toFixed(2)} (est. $${round2(anchor * 0.9).toFixed(2)}+).`)
  return { ok: true, open, message: `${row.name} on the block — opening $${open.toFixed(2)}.` }
}

// ---------------------------------------------------------------------------
// Read models + tick
// ---------------------------------------------------------------------------

export function listLots() {
  const live = db
    .prepare(
      `SELECT a.*, c.name, c.image_small, c.rarity, s.name AS set_name
       FROM auctions a JOIN cards c ON c.id = a.card_id JOIN sets s ON s.id = c.set_id
       WHERE a.status = 'live' ORDER BY a.closes_at ASC`,
    )
    .all() as Record<string, unknown>[]
  const closed = db
    .prepare(
      `SELECT a.*, c.name, c.image_small, s.name AS set_name
       FROM auctions a JOIN cards c ON c.id = a.card_id JOIN sets s ON s.id = c.set_id
       WHERE a.status != 'live' ORDER BY a.settled_at DESC NULLS LAST LIMIT 12`,
    )
    .all() as Record<string, unknown>[]
  return { live, closed }
}

export function auctionTick() {
  settlePass()
  // CONSTANT INFLUX — the house keeps a rolling floor of ~10 live lots at all
  // times (target wobbles 7–13 so the room breathes), spawning up to two per
  // tick, and lot windows are shortened so lots are always starting AND
  // ending. The board never goes quiet: bid now or watch it close.
  const target = 10 + Math.floor(Math.random() * 4) - Math.floor(Math.random() * 4) // 7..13
  const liveCount = (db.prepare(`SELECT COUNT(*) AS n FROM auctions WHERE status = 'live' AND seller = 'house'`).get() as { n: number }).n
  let toSpawn = Math.min(2, Math.max(0, target - liveCount))
  while (toSpawn > 0) {
    spawnLot()
    toSpawn--
  }
  npcWarPass()
}
