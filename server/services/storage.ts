import { db, nowIso, logActivity } from '../lib/db'
import { valueOf, CONDITION_MULT, round2, type Condition } from './market'
import * as vault from './vault'

// The scrap dealer's street rate — shared with the auto-scrap overflow policy
// (vault.ts), so a haul sort and an overflow scrap never pay different rates.
const BULK_RATE = vault.BULK_RATE

// ---------------------------------------------------------------------------
// STORAGE UNIT AUCTIONS — the locker gamble. Facilities roll new delinquent
// units onto the block every so often; each lists a blind starting bid and a
// one-line peek (a sealed bin label, not the contents). You bid against NPC
// pickers who have their own noisy read on the door contents. Win, and the
// roll-up door rattles open: sort the haul card by card into the binder or
// the junk pile — the junk pile pays out instantly at bulk rates (the scrap
// dealer buys by the pound), the binder keeps everything else at an even
// per-card cost basis. Roughly one locker in ten hides a real collection.
// ---------------------------------------------------------------------------

type Flavor = { id: string; label: string; blurb: string; minV: number; maxV: number; size: [number, number]; conds: Condition[]; collectionChance: number }

const FLAVORS: Flavor[] = [
  {
    id: 'junk_drawer',
    label: 'Junk drawer',
    blurb: 'Someone\'s abandoned odds and ends. Mostly a loss — sometimes a lesson.',
    minV: 0.05, maxV: 1.5, size: [12, 30], conds: ['MP', 'HP', 'DM'], collectionChance: 0.02,
  },
  {
    id: 'random_locker',
    label: 'Random locker',
    blurb: 'The everyday delinquency clean-out: boxes of who-knows-what.',
    minV: 0.1, maxV: 12, size: [15, 40], conds: ['NM', 'NM', 'LP', 'MP', 'HP'], collectionChance: 0.08,
  },
  {
    id: 'collector_unit',
    label: 'Collector\'s unit',
    blurb: 'The neighbors say someone in a Charizard shirt rented this one. Bidding gets spicy.',
    minV: 0.5, maxV: 60, size: [20, 45], conds: ['NM', 'NM', 'NM', 'LP', 'MP'], collectionChance: 0.18,
  },
  {
    id: 'hoarder_dream',
    label: 'Hoarder\'s dream',
    blurb: 'Packed floor to ceiling. The auctioneer\'s voice cracks when he starts it.',
    minV: 0.25, maxV: 200, size: [30, 60], conds: ['NM', 'NM', 'LP', 'LP', 'MP', 'HP', 'DM'], collectionChance: 0.3,
  },
]

const FACILITIES = ['Sunbelt Self Storage', 'U-Stor-It on Fairview', 'LockTite storage Co.', 'Route 9 Mini Storage', 'Greenfield Lockups']
const UNIT_ROWS = ['A', 'B', 'C', 'D', 'E']
const SNIPE_BIDS = [
  { name: 'Locker Larry', skill: 0.9 }, { name: 'Pickin\' Paula', skill: 1.05 }, { name: 'Backlot Bruno', skill: 1.2 },
  { name: 'Storage Steve', skill: 0.8 }, { name: 'Auction Annie', skill: 1.1 }, { name: 'Dumpster Dave', skill: 0.7 },
]


function flavorInfo(id: string) { return FLAVORS.find((f) => f.id === id) ?? FLAVORS[1] }

function rand(min: number, max: number) { return min + Math.random() * (max - min) }
function randInt(min: number, max: number) { return Math.floor(rand(min, max + 1)) }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

// ---------------------------------------------------------------------------
// Spawning — a unit or two shows up most game days; windows last ~2 game days.
// ---------------------------------------------------------------------------

export function spawnUnits() {
  const openCount = (db.prepare(`SELECT COUNT(*) AS n FROM storage_units WHERE status = 'open'`).get() as { n: number }).n
  if (openCount >= 4) return
  if (Math.random() > 0.35) return // most ticks: nothing new on the block

  const prof = pick(FLAVORS)
  const code = `${pick(UNIT_ROWS)}-${randInt(1, 48)}`
  const insert = db.prepare(
    `INSERT INTO storage_units (facility, unit_code, flavor, street_price, closes_at) VALUES (?, ?, ?, ?, ?)`,
  )
  // Anchor the ask loosely to expected contents so the gamble isn't pure noise.
  const expected = expectedValueFor(prof)
  const street = Math.max(5, round2(expected * rand(0.35, 0.7)))
  insert.run(pick(FACILITIES), code, prof.id, street, new Date(Date.now() + rand(30, 55) * 3_600_000).toISOString())
}

/** Rough expected contents value for a flavor, from real priced cards. */
function expectedValueFor(prof: Flavor): number {
  const row = db
    .prepare(
      `SELECT AVG(p.market) AS m FROM cards c
       JOIN price_records p ON p.card_id = c.id AND p.kind = 'tcgplayer' AND p.market IS NOT NULL
       WHERE c.rarity IS NOT NULL AND c.rarity != '' AND p.market >= ? AND p.market <= ?`,
    )
    .get(prof.minV, prof.maxV) as { m: number | null }
  const avg = row.m ?? 0.6
  const n = randInt(prof.size[0], prof.size[1])
  const base = avg * n * 0.75 // condition discounts
  // The collection jackpot skews the mean upward for everyone.
  return base * (1 + prof.collectionChance * 6)
}

// ---------------------------------------------------------------------------
// Unit generation — contents drawn from the real priced catalog
// ---------------------------------------------------------------------------

function generateContents(prof: Flavor): { card_id: string; condition: Condition; hidden_collection: number; value: number }[] {
  const pool = db
    .prepare(
      `SELECT c.id, (SELECT market FROM price_records pr WHERE pr.card_id = c.id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) AS m
       FROM cards c WHERE c.rarity IS NOT NULL AND c.rarity != ''
       ORDER BY RANDOM() LIMIT 600`,
    )
    .all() as { id: string; m: number | null }[]
  const valued = pool.filter((p) => p.m != null && p.m >= prof.minV && p.m <= prof.maxV)
  if (valued.length < 5) return []

  const n = Math.min(randInt(prof.size[0], prof.size[1]), valued.length)
  const out: { card_id: string; condition: Condition; hidden_collection: number; value: number }[] = []
  const isCollection = Math.random() < prof.collectionChance
  let collectionBudget = isCollection ? randInt(4, 9) : 0

  const used = new Set<string>()
  for (let i = 0; i < n; i++) {
    const c = pick(valued)
    if (used.has(c.id)) continue
    used.add(c.id)
    let cond = pick(prof.conds)
    let inCollection = false
    // The found collection: near-mint high-value cards tucked in card-saver boxes.
    if (collectionBudget > 0) {
      const worthMore = valued.filter((v) => (v.m ?? 0) >= 8)
      if (worthMore.length > 0 && Math.random() < 0.5) {
        const cc = pick(worthMore)
        if (!used.has(cc.id)) {
          used.add(cc.id)
          out.push({ card_id: cc.id, condition: 'NM', hidden_collection: 1, value: valueOf(cc.id, 'normal', 'NM') })
          collectionBudget--
          continue
        }
        continue
      }
      collectionBudget--
      cond = 'NM'
      inCollection = out.length >= 0 && Math.random() < 0.4
    }
    out.push({ card_id: c.id, condition: cond, hidden_collection: inCollection ? 1 : 0, value: valueOf(c.id, 'normal', cond) })
  }
  return out
}

// ---------------------------------------------------------------------------
// Read model — the block: open units + your history
// ---------------------------------------------------------------------------

type UnitRow = {
  id: number; facility: string; unit_code: string; flavor: string
  street_price: number; contents_value: number | null; winner_bid: number | null
  status: string; closes_at: string; opened_by: string | null; opened_at: string | null
}

/** A "peek": a flavor-tinted one-liner plus the smell of the door, never numbers. */
function peekFor(u: UnitRow) {
  const f = flavorInfo(u.flavor)
  const lines: Record<string, string[]> = {
    junk_drawer: ['Cardboard dust and old magazines.', 'A single PG-rated binder, face-down.', 'Empty longboxes. Emphasis on empty.'],
    random_locker: ['Sealed banker\'s boxes, taped shut.', 'A filing cabinet and two totes.', 'Christmas decorations... hopefully on top.'],
    collector_unit: ['Card-saver boxes stacked like bricks.', 'A graded-slab case under a moving blanket.', 'Toploader brick, sealed, dusty.'],
    hoarder_dream: ['Floor-to-ceiling: no back wall visible.', 'The door is hard to open — it\'s that full.', 'Something heavy under a tarp.'],
  }
  return { label: f.label, blurb: f.blurb, line: pick(lines[u.flavor] ?? lines.random_locker) }
}

export function unitsSection() {
  const open = db
    .prepare(`SELECT * FROM storage_units WHERE status = 'open' ORDER BY closes_at ASC`)
    .all() as UnitRow[]
  const history = db
    .prepare(`SELECT * FROM storage_units WHERE status != 'open' ORDER BY id DESC LIMIT 12`)
    .all() as UnitRow[]
  return {
    units: open.map((u) => {
      const f = flavorInfo(u.flavor)
      const bidder = nextBidderFor(u)
      return {
        id: u.id,
        facility: u.facility,
        unit_code: u.unit_code,
        flavor: u.flavor,
        flavor_label: f.label,
        flavor_blurb: f.blurb,
        street_price: u.street_price,
        peek: peekFor(u),
        closes_at: u.closes_at,
        minutes_left: Math.max(0, Math.round((new Date(u.closes_at).getTime() - Date.now()) / 60_000)),
        current_bid: round2(u.street_price * bidder.sinceFactor),
        current_bidder: bidder.name,
      }
    }),
    history: history.map((u) => ({
      id: u.id,
      unit_code: u.unit_code,
      facility: u.facility,
      flavor_label: flavorInfo(u.flavor).label,
      paid: u.winner_bid,
      contents_value: u.contents_value,
      profit: u.winner_bid != null && u.contents_value != null ? round2(u.contents_value - u.winner_bid) : null,
      won: u.status === 'settled' && u.winner_bid != null && u.opened_by == null,
    })),
    bulkRate: BULK_RATE,
  }
}

function nextBidderFor(u: UnitRow) {
  const elapsed = Date.now() - new Date(u.opened_at ?? u.closes_at).getTime()
  const windows = Math.max(0, Math.min(4, Math.floor(elapsed / (6 * 3_600_000))))
  const base = u.street_price * rand(0.9, 1.15)
  let bid = base
  let name = 'no bids yet'
  let sinceFactor = 1
  if (windows > 0) {
    const snipe = pick(SNIPE_BIDS)
    bid = base * Math.pow(1.18, windows) * snipe.skill
    name = snipe.name
    sinceFactor = bid / Math.max(0.01, u.street_price)
  }
  return { name, bid: round2(bid), sinceFactor }
}

// ---------------------------------------------------------------------------
// Bidding — you against one noisy NPC read
// ---------------------------------------------------------------------------

export function placeBid(unitId: number, amount: number) {
  const u = db.prepare(`SELECT * FROM storage_units WHERE id = ? AND status = 'open'`).get(unitId) as UnitRow | undefined
  if (!u) return { ok: false as const, error: 'That locker already closed' }
  if (!(amount >= u.street_price)) return { ok: false as const, error: `Opening bid is $${u.street_price.toFixed(2)}` }
  if (new Date(u.closes_at).getTime() <= Date.now()) return { ok: false as const, error: 'The gavel already fell' }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < amount) return { ok: false as const, error: `Not enough cash (need $${amount.toFixed(2)})` }

  // The NPC read: one picker prices the door contents with real noise (±45%)
  // and bids up to 90% of their read. Their skill tilts how sharp they are.
  const prof = flavorInfo(u.flavor)
  const contents = generateContents(prof)
  const trueValue = round2(contents.reduce((a, c) => a + c.value, 0))
  const npcRead = Math.max(1, trueValue * rand(0.55, 1.45))
  const snipe = pick(SNIPE_BIDS)
  const npcMax = Math.min(npcRead * 0.9 * snipe.skill, state.cash * 1.5) // they don't chase you infinitely

  let counterBid: number | null = null
  const tx = db.transaction(() => {
    if (amount > npcMax) {
      // You outbid the field outright.
      winUnit(u, amount, contents, null)
    } else {
      // They counter once — one increment over you. Raise again or walk.
      const counter = round2(Math.min(npcMax, amount * rand(1.06, 1.14)))
      if (counter > amount) {
        counterBid = counter
        db.prepare(`UPDATE storage_units SET opened_at = COALESCE(opened_at, ?) WHERE id = ?`).run(nowIso(), u.id)
        logActivity('storage', `${u.facility} unit ${u.unit_code}: ${snipe.name} bids $${counter.toFixed(2)} over your $${amount.toFixed(2)} — raise or walk.`, 0)
      }
    }
  })
  tx()
  const after = db.prepare(`SELECT status, winner_bid FROM storage_units WHERE id = ?`).get(unitId) as { status: string; winner_bid: number | null }
  if (after.status === 'won') {
    return { ok: true as const, won: true as const, paid: after.winner_bid }
  }
  return { ok: true as const, won: false as const, counter: counterBid, bidder: snipe.name }
}

function winUnit(u: UnitRow, bid: number, contents: { card_id: string; condition: Condition; hidden_collection: number; value: number }[], openedBy: string | null) {
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(bid)
  db.prepare(`DELETE FROM storage_unit_cards WHERE unit_id = ?`).run(u.id)
  const insertCard = db.prepare(`INSERT INTO storage_unit_cards (unit_id, card_id, condition, hidden_collection) VALUES (?, ?, ?, ?)`)
  for (const c of contents) insertCard.run(u.id, c.card_id, c.condition, c.hidden_collection)
  db.prepare(`UPDATE storage_units SET status = 'won', winner_bid = ?, contents_value = ?, opened_by = ?, opened_at = ? WHERE id = ?`)
    .run(bid, round2(contents.reduce((a, c) => a + c.value, 0)), openedBy, nowIso(), u.id)
  logActivity('storage', `Won ${u.facility} unit ${u.unit_code} for $${bid.toFixed(2)} — the roll-up door is waiting.`, -bid)
}

// ---------------------------------------------------------------------------
// NPC snipes — an open unit you ignored can close to someone else
// ---------------------------------------------------------------------------

export function storageTick() {
  spawnUnits()
  const open = db.prepare(`SELECT * FROM storage_units WHERE status = 'open'`).all() as UnitRow[]
  for (const u of open) {
    if (new Date(u.closes_at).getTime() > Date.now()) continue
    const prof = flavorInfo(u.flavor)
    const contents = generateContents(prof)
    const trueValue = round2(contents.reduce((a, c) => a + c.value, 0))
    const snipe = pick(SNIPE_BIDS)
    const theirBid = round2(Math.max(u.street_price, trueValue * rand(0.5, 1.1) * snipe.skill))
    const tx = db.transaction(() => {
      db.prepare(`UPDATE storage_units SET status = 'settled', winner_bid = ?, contents_value = ?, opened_by = ? WHERE id = ?`)
        .run(theirBid, trueValue, snipe.name, u.id)
    })
    tx()
    logActivity('storage', `${u.facility} unit ${u.unit_code} hammer to ${snipe.name} at $${theirBid.toFixed(2)} — you watched it go.`, 0)
  }
}

// ---------------------------------------------------------------------------
// Opening the haul — the reveal + the sort
// ---------------------------------------------------------------------------

export type HaulCard = {
  card_id: string; name: string; image_small: string | null; rarity: string | null
  set_name: string; condition: Condition; value: number; hidden_collection: number
}

export function openUnit(unitId: number) {
  const u = db.prepare(`SELECT * FROM storage_units WHERE id = ? AND status = 'won'`).get(unitId) as UnitRow | undefined
  if (!u) return { ok: false as const, error: 'Nothing to open — you have to win the unit first' }
  const rows = db
    .prepare(
      `SELECT suc.card_id, suc.condition, suc.hidden_collection, c.name, c.image_small, c.rarity, s.name AS set_name
       FROM storage_unit_cards suc JOIN cards c ON c.id = suc.card_id JOIN sets s ON s.id = c.set_id
       WHERE suc.unit_id = ?`,
    )
    .all(unitId) as { card_id: string; condition: Condition; hidden_collection: number; name: string; image_small: string | null; rarity: string | null; set_name: string }[]
  const cards: HaulCard[] = rows
    .map((c) => ({ ...c, value: round2(valueOf(c.card_id, 'normal', c.condition)) }))
    .sort((a, b) => b.value - a.value)
  return {
    ok: true as const,
    unit: { id: u.id, facility: u.facility, unit_code: u.unit_code, paid: u.winner_bid },
    contentsValue: u.contents_value,
    collectionFound: cards.some((c) => c.hidden_collection === 1 && c.value >= 8),
    cards,
  }
}

/** Sort the haul: everything listed goes to the binder, the rest sells in bulk. */
export function sortHaul(unitId: number, keepCardIds: string[]) {
  const u = db.prepare(`SELECT * FROM storage_units WHERE id = ? AND status = 'won'`).get(unitId) as UnitRow | undefined
  if (!u) return { ok: false as const, error: 'Unit not won or already sorted' }
  const keep = new Set(keepCardIds)
  const rows = db
    .prepare(`SELECT suc.card_id, suc.condition, suc.hidden_collection FROM storage_unit_cards suc WHERE suc.unit_id = ?`)
    .all(unitId) as { card_id: string; condition: Condition; hidden_collection: number }[]
  if (rows.length === 0) return { ok: false as const, error: 'Unit is empty' }

  const perCard = round2((u.winner_bid ?? 0) / rows.length)
  // Storage & the vault: the haul is bigger than your racks. You can only carry
  // what fits — the rest goes to the scrap dealer at bulk rates whether you
  // wanted it or not. (Haul cards are raw; the vault never sees them.)
  const plannedKeeps = keep.size
  const keepAllowed = vault.trimToCapacity(plannedKeeps)
  const storageWarning = plannedKeeps > keepAllowed
    ? `Locker sort: only ${keepAllowed} of ${plannedKeeps} keeps fit on the racks — the rest went to scrap. Rent a locker to keep a full haul.`
    : null
  const insertInv = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, acquired_ref, cost_basis, acquired_at)
     VALUES (?, 'normal', ?, 1, 'collection', 'storage_unit', ?, ?, ?)`,
  )
  const stamped: { inventoryId: number; cardId: string; condition: string }[] = []
  const kept: { card_id: string; name: string }[] = []
  let bulkCash = 0
  let bulkCount = 0

  let keptThisSort = 0
  const tx = db.transaction(() => {
    for (const r of rows) {
      const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(r.card_id) as { name: string }).name
      if (keep.has(r.card_id) && keptThisSort < keepAllowed) {
        const res = insertInv.run(r.card_id, r.condition, String(u.id), perCard, nowIso())
        stamped.push({ inventoryId: Number(res.lastInsertRowid), cardId: r.card_id, condition: r.condition })
        kept.push({ card_id: r.card_id, name })
        keptThisSort++
      } else {
        bulkCash += valueOf(r.card_id, 'normal', r.condition) * BULK_RATE
        bulkCount++
      }
    }
    if (bulkCount > 0) {
      const cash = round2(bulkCash)
      db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(cash)
    }
    db.prepare(`UPDATE storage_units SET status = 'settled' WHERE id = ?`).run(unitId)
  })
  tx()
  // Lockers are uncurated time capsules — high-value keeps can be counterfeit (auth.ts).
  import('./auth').then((a) => a.stampRiskBatch(stamped, 'storage_unit')).catch(() => {})
  if (storageWarning) logActivity('storage', storageWarning, 0)

  const bulkTotal = round2(bulkCash)
  logActivity(
    'storage',
    `Sorted ${u.facility} unit ${u.unit_code}: ${kept.length} card${kept.length === 1 ? '' : 's'} to the binder, ${bulkCount} to the scrap dealer${bulkCount > 0 ? ` (+$${bulkTotal.toFixed(2)})` : ''}.`,
    bulkCount > 0 ? bulkTotal : 0,
  )
  return { ok: true as const, kept: kept.length, bulkCount, bulkCash: bulkTotal }
}
