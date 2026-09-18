import { db, nowIso, logActivity } from '../lib/db'
import { valueOf, round2, type Condition } from './market'
import { getActiveShow } from './conventions'

// ---------------------------------------------------------------------------
// Vendor tables — rent a spot at the current show and sell your own cards.
// Stock lives in inventory with status 'at_table' (ask in listing_price), so
// binders/listings/graders can't touch a unit while it sits on the table.
// ---------------------------------------------------------------------------

// Migrations for databases created before vendor tables existed.
try { db.exec(`ALTER TABLE inventory ADD COLUMN vendor_table_id INTEGER`) } catch { /* column exists */ }
try { db.exec(`ALTER TABLE vendor_tables ADD COLUMN settled INTEGER NOT NULL DEFAULT 0`) } catch { /* column exists */ }

const TABLE_SLOTS = 24
const TICK_MS = 45_000

const LOCATIONS = [
  { id: 'entrance', label: 'Entrance row', feeMult: 1.6, traffic: 1.5, blurb: 'First table everyone walks past. Priciest spot, busiest foot traffic.' },
  { id: 'main', label: 'Main floor', feeMult: 1.0, traffic: 1.0, blurb: 'Solid middle-of-the-hall position. Steady browsers all show long.' },
  { id: 'back', label: 'Back wall', feeMult: 0.6, traffic: 0.55, blurb: 'Cheap rent, quiet corner. The deal-hunters who make it back here know their stuff.' },
] as const

const BUYERS = [
  'Wade', 'Priya', 'Marco', 'Sana', 'Kai', 'Rosie', 'Dmitri', 'June',
  'Talia', 'Owen', 'Bruno', 'Mei', 'Felix', 'Cleo', 'Hank', 'Nadia',
]

type VendorTable = {
  id: number
  convention_id: number
  fee: number
  location: string
  revenue: number
  cost_out: number
  buyer_count: number
  opened_at: string
  settled: number
}

type StockRow = {
  id: number
  card_id: string
  variant: string
  condition: string
  quantity: number
  listing_price: number | null
  listed_at: string | null
  cost_basis: number
  name: string
  image_small: string | null
  rarity: string | null
  number: string
  set_name: string
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function getMyTable(): VendorTable | undefined {
  const show = getActiveShow()
  if (!show) return undefined
  return db
    .prepare(`SELECT * FROM vendor_tables WHERE convention_id = ? AND settled = 0`)
    .get(show.id) as VendorTable | undefined
}

/** Tables at shows that have already closed — packed up on the next tick. */
function settleStaleTables() {
  const stale = db
    .prepare(
      `SELECT vt.* FROM vendor_tables vt JOIN conventions cv ON cv.id = vt.convention_id
       WHERE vt.settled = 0 AND cv.closes_at <= ?`,
    )
    .all(nowIso()) as VendorTable[]
  for (const t of stale) settleTable(t)
}

function settleTable(t: VendorTable) {
  const rows = db
    .prepare(`SELECT id FROM inventory WHERE status = 'at_table' AND vendor_table_id = ?`)
    .all(t.id) as { id: number }[]
  db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL WHERE status = 'at_table' AND vendor_table_id = ?`).run(t.id)
  db.prepare(`UPDATE vendor_tables SET settled = 1 WHERE id = ?`).run(t.id)
  const profit = round2(t.revenue - t.cost_out - t.fee)
  if (t.buyer_count > 0) {
    logActivity(
      'convention',
      `Packed up the ${t.location} table: ${t.buyer_count} sale${t.buyer_count === 1 ? '' : 's'}, $${t.revenue.toFixed(2)} gross ($${profit.toFixed(2)} after rent & cost). ${rows.length} card${rows.length === 1 ? '' : 's'} back in the binder.`,
      profit,
    )
  } else if (rows.length > 0) {
    logActivity('convention', `Packed up the ${t.location} table. Nobody bit — ${rows.length} card${rows.length === 1 ? '' : 's'} back in the binder.`, -t.fee)
  }
}

// ---------------------------------------------------------------------------
// Renting
// ---------------------------------------------------------------------------

export function rent(location: string) {
  settleStaleTables()
  const show = getActiveShow()
  if (!show) return { ok: false as const, error: 'No show is running right now' }
  if (getMyTable()) return { ok: false as const, error: 'You already have a table at this show' }
  const loc = LOCATIONS.find((l) => l.id === location) ?? LOCATIONS[1]
  const fee = round2(Math.max(15, show.entry_fee * 6) * loc.feeMult)
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < fee) return { ok: false as const, error: `Table rent is $${fee.toFixed(2)} — not enough cash` }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(fee)
  db.prepare(`INSERT INTO vendor_tables (convention_id, fee, location, opened_at) VALUES (?, ?, ?, ?)`)
    .run(show.id, fee, loc.label, nowIso())
  logActivity('convention', `Rented the ${loc.label} table at ${show.name} for $${fee.toFixed(2)} — stock it and sell.`, -fee)
  return { ok: true as const, fee, location: loc.label }
}

// ---------------------------------------------------------------------------
// Stocking — from your own collection, at your own ask
// ---------------------------------------------------------------------------

export function stock(inventoryId: number, ask: number) {
  const show = getActiveShow()
  if (!show) return { ok: false as const, error: 'No show running' }
  const table = getMyTable()
  if (!table) return { ok: false as const, error: 'Rent a table first' }
  if (!ask || ask <= 0) return { ok: false as const, error: 'Set a real price' }
  const row = db
    .prepare(`SELECT id, card_id, status, quantity, graded_grade FROM inventory WHERE id = ?`)
    .get(inventoryId) as { id: number; card_id: string; status: string; quantity: number; graded_grade: string | null } | undefined
  if (!row) return { ok: false as const, error: 'Card not found' }
  if (row.status !== 'collection') return { ok: false as const, error: 'Only cards sitting in your collection (not listed, grading, or already on a table) can be stocked' }
  if (row.graded_grade) return { ok: false as const, error: 'Slabs stay home — table sales are raw cards only' }
  // A card can only live in one display at a time: stocking frees any binder pocket.
  import('./binders').then((b) => b.cleanupSlotsForInventory([inventoryId])).catch(() => {})
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM inventory WHERE status = 'at_table' AND vendor_table_id = ?`).get(table.id) as { n: number }).n
  if (count >= TABLE_SLOTS) return { ok: false as const, error: `Table is full — ${TABLE_SLOTS} slots max` }
  db.prepare(`UPDATE inventory SET status = 'at_table', vendor_table_id = ?, listing_price = ?, listed_at = ? WHERE id = ?`)
    .run(table.id, round2(ask), nowIso(), inventoryId)
  const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(row.card_id) as { name: string }).name
  logActivity('convention', `Put ${name} (${row.quantity}×) on the table at $${ask.toFixed(2)}`)
  return { ok: true as const, slotsLeft: TABLE_SLOTS - count - 1 }
}

export function unstock(inventoryId: number) {
  const table = getMyTable()
  if (!table) return { ok: false as const, error: 'No active table' }
  const row = db
    .prepare(`SELECT id FROM inventory WHERE id = ? AND status = 'at_table' AND vendor_table_id = ?`)
    .get(inventoryId, table.id)
  if (!row) return { ok: false as const, error: 'That card is not on your table' }
  db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL WHERE id = ?`).run(inventoryId)
  return { ok: true as const }
}

/** Collection rows eligible for the table: raw, unlisted, with a market value to price against. */
export function stockableInventory() {
  const show = getActiveShow()
  if (!show) return { ok: false as const, error: 'No show running' }
  const rows = db
    .prepare(
      `SELECT i.id, i.card_id, i.variant, i.condition, i.quantity, i.cost_basis,
              c.name, c.image_small, c.rarity, c.number, s.name AS set_name
       FROM inventory i JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
       WHERE i.status = 'collection' AND i.graded_grade IS NULL
       ORDER BY i.favorite DESC, i.acquired_at DESC LIMIT 200`,
    )
    .all() as (StockRow & { variant: string; condition: string })[]
  const out = rows.map((r) => {
    const anchor = valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
    return { ...r, anchor, suggestedAsk: round2(anchor * 0.95) }
  })
  return { ok: true as const, rows: out }
}

// ---------------------------------------------------------------------------
// Read model for the UI
// ---------------------------------------------------------------------------

export function tableStock(tableId: number): (StockRow & { ask: number; anchor: number; delta: number | null; daysOnTable: number })[] {
  const rows = db
    .prepare(
      `SELECT i.id, i.card_id, i.variant, i.condition, i.quantity, i.listing_price, i.listed_at, i.cost_basis,
              c.name, c.image_small, c.rarity, c.number, s.name AS set_name
       FROM inventory i JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
       WHERE i.status = 'at_table' AND i.vendor_table_id = ?
       ORDER BY i.listing_price ASC`,
    )
    .all(tableId) as (StockRow & { variant: string; condition: string })[]
  return rows.map((r) => {
    const ask = r.listing_price ?? 0
    const anchor = valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
    const days = r.listed_at ? (Date.now() - new Date(r.listed_at).getTime()) / 86_400_000 : 0
    return {
      ...r,
      ask,
      anchor,
      delta: anchor > 0 ? ask / anchor - 1 : null,
      daysOnTable: Math.max(0, Math.floor(days * 24 * 60) / 60), // hours-ish, shown in minutes
    }
  })
}

export function status() {
  const show = getActiveShow()
  if (!show) return { active: false as const, showOpen: false as const }
  const table = getMyTable()
  const minutesLeft = Math.max(0, Math.round((new Date(show.closes_at).getTime() - Date.now()) / 60_000))
  if (!table) {
    const base = Math.max(15, show.entry_fee * 6)
    return {
      active: false as const,
      showOpen: true as const,
      showName: show.name,
      minutesLeft,
      locations: LOCATIONS.map((l) => ({ id: l.id, label: l.label, blurb: l.blurb, traffic: l.traffic, fee: round2(base * l.feeMult) })),
    }
  }
  const stockRows = tableStock(table.id)
  const units = stockRows.reduce((a, r) => a + r.quantity, 0)
  const profit = round2(table.revenue - table.cost_out - table.fee)
  return {
    active: true as const,
    showOpen: true as const,
    showName: show.name,
    minutesLeft,
    table: {
      location: table.location,
      fee: table.fee,
      revenue: round2(table.revenue),
      costOut: round2(table.cost_out),
      buyerCount: table.buyer_count,
      profit,
    },
    stock: stockRows,
    slotsUsed: stockRows.length,
    slotsMax: TABLE_SLOTS,
    unitsOnTable: units,
  }
}

// ---------------------------------------------------------------------------
// NPC walk-up buyers — the show's foot traffic meets your prices
// ---------------------------------------------------------------------------

function trafficCurve(minutesLeft: number, totalMin: number): number {
  // Light start, mid-show rush, wind-down at close.
  const progress = Math.min(1, Math.max(0, 1 - minutesLeft / Math.max(totalMin, 1)))
  return 0.3 + Math.sin(progress * Math.PI) * 0.7
}

function runBuyers(table: VendorTable, show: { opened_at: string; closes_at: string }) {
  const rows = db
    .prepare(
      `SELECT id, card_id, variant, condition, quantity, listing_price, cost_basis
       FROM inventory WHERE status = 'at_table' AND vendor_table_id = ?`,
    )
    .all(table.id) as { id: number; card_id: string; variant: string; condition: string; quantity: number; listing_price: number | null; cost_basis: number }[]
  if (rows.length === 0) return
  const totalMin = Math.max(1, (new Date(show.closes_at).getTime() - new Date(show.opened_at).getTime()) / 60_000)
  const minutesLeft = Math.max(0, (new Date(show.closes_at).getTime() - Date.now()) / 60_000)
  const traffic = trafficCurve(minutesLeft, totalMin)
  const loc = LOCATIONS.find((l) => l.label === table.location)
  const trafficMult = loc?.traffic ?? 1

  const insertSale = db.prepare(
    `INSERT INTO vendor_sales (table_id, inventory_id, card_id, variant, condition, quantity, price, cost_basis, sold_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  let cashIn = 0
  let sales = 0
  for (const r of rows) {
    const ask = r.listing_price ?? 0
    if (ask <= 0) continue
    const anchor = valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
    if (anchor <= 0) continue // no data — buyers can't judge it, it just sits
    const ratio = ask / anchor
    // Deals vanish fast; overpriced cardboard gathers looks, not offers.
    const priceFactor = Math.min(1.4, Math.max(0.02, 1.35 - ratio))
    const chance = Math.min(0.2, 0.045 * trafficMult * traffic * priceFactor)
    if (Math.random() >= chance) continue
    const buyer = pick(BUYERS)
    const cost = round2(r.cost_basis * r.quantity)
    const profit = round2(ask - cost)
    const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(r.card_id) as { name: string }).name
    insertSale.run(table.id, r.id, r.card_id, r.variant, r.condition, r.quantity, ask, r.cost_basis, nowIso())
    db.prepare(`UPDATE inventory SET status = 'sold', quantity = 0 WHERE id = ?`).run(r.id)
    db.prepare(
      `INSERT INTO sale_history (inventory_id, card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'convention_table', ?)`,
    ).run(r.id, r.card_id, r.variant, r.condition, r.quantity, ask, cost, profit, buyer, nowIso())
    db.prepare(`UPDATE vendor_tables SET revenue = revenue + ?, cost_out = cost_out + ?, buyer_count = buyer_count + 1 WHERE id = ?`)
      .run(round2(ask), cost, table.id)
    cashIn += ask
    sales++
    const ratioNote = ratio < 0.85 ? ' — priced to move' : ratio > 1.15 ? ' (paid over market!)' : ''
    logActivity('sale', `Table sale: ${name} → ${buyer} for $${ask.toFixed(2)} (${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} vs cost)${ratioNote}`, ask)
  }
  if (cashIn > 0) db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(round2(cashIn))
  void sales
}

// ---------------------------------------------------------------------------
// Tick — drive buyers, settle closed shows. Called from the market tick.
// ---------------------------------------------------------------------------

export function vendorTick() {
  settleStaleTables()
  const show = getActiveShow()
  const table = getMyTable()
  if (!show || !table) return
  runBuyers(table, show)
}

export const TICK_INTERVAL_MS = TICK_MS
