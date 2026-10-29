import { db, nowIso, logActivity, getMeta } from '../lib/db'
import { gameDayMs } from '../lib/gameday'
import { valueOf, liquidityFactor, round2, type Condition } from './market'
import { walkInMultiplier as seasonalWalkInMult } from './seasonal'
import { getActiveShow } from './conventions'
import { type ShowRow, type Venue, upcomingShow, venueById, dealerRoster, marketHeatIndex } from './shows'

// ---------------------------------------------------------------------------
// Vendor tables — rent a spot at the current show and sell your own cards.
// Stock lives in inventory with status 'at_table' (ask in listing_price), so
// binders/listings/graders can't touch a unit while it sits on the table.
//
// Since the player became an organizer (shows.ts), a vendor table has TWO
// venues: the NPC convention floor, and — when doors are open at their own
// hosted show — their own hall. At your own show the table is free in dollars
// but costs a dealer slot: the roster locks with one fewer table sold than it
// would have, and the missed table_price is the rent. Selling to the crowd
// you paid to gather, at the show premium convention tables enjoy.
// ---------------------------------------------------------------------------

// Migrations for databases created before vendor tables existed.
try { db.exec(`ALTER TABLE inventory ADD COLUMN vendor_table_id INTEGER`) } catch { /* column exists */ }
try { db.exec(`ALTER TABLE vendor_tables ADD COLUMN settled INTEGER NOT NULL DEFAULT 0`) } catch { /* column exists */ }
// Host-show booths: NULL convention_id + a host_show_id when the table is at
// the player's own hosted show instead of an NPC convention.
try { db.exec(`ALTER TABLE vendor_tables ADD COLUMN host_show_id INTEGER`) } catch { /* column exists */ }

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
  host_show_id: number | null
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
  if (show) {
    const t = db.prepare(`SELECT * FROM vendor_tables WHERE convention_id = ? AND settled = 0`).get(show.id) as VendorTable | undefined
    if (t) return t
  }
  return db.prepare(`SELECT * FROM vendor_tables WHERE host_show_id = ? AND settled = 0`).get(hostedShowDoorsOpen()?.id ?? 0) as VendorTable | undefined
}

/**
 * The player's own hosted show while its doors are OPEN (after open, before
 * close — resolution packs the booth). Before doors, pricing is still tunable
 * and the hall isn't walking yet; the host booth unlocks at open and its cost
 * is paid at settlement: one of your own tables is the booth (see shows.ts
 * showsTick).
 */
export function hostedShowDoorsOpen(): ShowRow | undefined {
  const s = upcomingShow()
  if (!s) return undefined
  if (new Date(s.opens_at).getTime() > Date.now()) return undefined
  if (new Date(s.closes_at).getTime() <= Date.now()) return undefined
  return s
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
  const hostShow = hostedShowDoorsOpen()
  if (!show && !hostShow) return { ok: false as const, error: hostShow == null && upcomingShow() ? "Your show hasn't opened its doors yet" : 'No show running' }
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

/** Collection rows eligible for a table: raw, unlisted, with a market value to price against. */
export function stockableInventory() {
  const show = getActiveShow()
  const hostShow = hostedShowDoorsOpen()
  if (!show && !hostShow) return { ok: false as const, error: hostShow == null && upcomingShow() ? "Your show hasn't opened its doors yet" : 'No show running' }
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
    // Suggested ask covers the whole stack (per-unit × count) — sales credit ask × quantity.
    return { ...r, anchor, suggestedAsk: round2(anchor * 0.95 * r.quantity) }
  })
  return { ok: true as const, rows: out }
}

// ---------------------------------------------------------------------------
// The host's own booth — sell at the show you organized.
//
// No cash rent: the booth IS one of your dealer tables. Claim it any time
// after doors open; shows.ts locks the roster with one fewer table sold than
// it would have, and the missed table_price is what the spot cost you. The
// reward: your stock meets the crowd you paid to gather, at the same show
// premium convention buyers pay.
// ---------------------------------------------------------------------------

export function claimHostBooth() {
  const show = hostedShowDoorsOpen()
  if (!show) {
    const upcoming = upcomingShow()
    return { ok: false as const, error: upcoming ? "Doors aren't open yet — the booth unlocks when the show starts" : 'You have no show on the calendar' }
  }
  const venue = venueById(show.venue)!
  if (getMyTable()) return { ok: false as const, error: 'You already have a table at this show' }
  if (new Date(show.closes_at).getTime() <= Date.now()) return { ok: false as const, error: 'The show has already packed up' }
  const committed = dealerRoster(show).filter((d) => d.committed).length
  if (committed >= show.tables_total) return { ok: false as const, error: `The floor is full — all ${show.tables_total} tables spoken for` }
  const info = db.prepare(`INSERT INTO vendor_tables (convention_id, host_show_id, fee, location, opened_at) VALUES (NULL, ?, 0, ?, ?)`)
    .run(show.id, `${venue.name} — your booth`, nowIso())
  logActivity('show', `Set up your own booth at the ${venue.name} — the spot costs you a dealer table, but every sale is yours. Stock it while the doors are open.`, 0)
  return { ok: true as const, tableId: Number(info.lastInsertRowid), venue: venue.name }
}

/**
 * Booth fees by venue kind. Convention tables pay rent up front; at your own
 * show the fee is the dealer table the booth displaces — charged by
 * showsTick at roster lock, not here. Used by the UI to explain the price.
 */
export function hostBoothFee(): number {
  const show = hostedShowDoorsOpen()
  if (!show) return 0
  return show.table_price
}

/**
 * Settlement for the host's own booth, called from showsTick inside the
 * resolution transaction. Gross stays the booth's (no cash rent was paid);
 * the displaced dealer's table_price books as the rent — the opportunity
 * cost of working your own floor instead of renting the spot out.
 */
export function settleHostTable(t: { id: number; revenue: number; cost_out: number; buyer_count: number }, tablePrice: number) {
  const rows = db
    .prepare(`SELECT id FROM inventory WHERE status = 'at_table' AND vendor_table_id = ?`)
    .all(t.id) as { id: number }[]
  db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL, vendor_table_id = NULL WHERE status = 'at_table' AND vendor_table_id = ?`).run(t.id)
  db.prepare(`UPDATE vendor_tables SET settled = 1 WHERE id = ?`).run(t.id)
  const profit = round2(t.revenue - t.cost_out - tablePrice)
  const usd = (n: number) => `$${n.toFixed(2)}`
  if (t.buyer_count > 0) {
    logActivity('show', `Packed up your booth: ${t.buyer_count} sale${t.buyer_count === 1 ? '' : 's'}, ${usd(t.revenue)} gross — the spot cost you a ${usd(tablePrice)} dealer table, netting ${profit >= 0 ? '+' : ''}${usd(profit)} after cost. ${rows.length} card${rows.length === 1 ? '' : 's'} back in the binder.`, profit)
  } else if (rows.length > 0) {
    logActivity('show', `Packed up your booth. Nobody bit — ${rows.length} card${rows.length === 1 ? '' : 's'} back in the binder, and the spot still cost you a ${usd(tablePrice)} dealer table.`, -tablePrice)
  } else {
    logActivity('show', `Packed up your booth — never stocked it, so the spot cost you a ${usd(tablePrice)} dealer table for nothing.`, -tablePrice)
  }
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
    // Asks are stack totals — judge fairness per unit.
    const unitAsk = ask / Math.max(1, r.quantity)
    const days = r.listed_at ? (Date.now() - new Date(r.listed_at).getTime()) / gameDayMs() : 0
    return {
      ...r,
      ask,
      anchor,
      delta: anchor > 0 ? unitAsk / anchor - 1 : null,
      daysOnTable: Math.max(0, Math.floor(days * 24 * 60) / 60), // hours-ish, shown in minutes
    }
  })
}

export function status() {
  const hostShow = hostedShowDoorsOpen()
  if (hostShow) {
    const hostTable = db.prepare(`SELECT * FROM vendor_tables WHERE host_show_id = ? AND settled = 0`).get(hostShow.id) as VendorTable | undefined
    const venue = venueById(hostShow.venue)
    if (!hostTable) {
      return {
        active: false as const,
        showOpen: true as const,
        hostShow: true as const,
        showName: `${venue?.name ?? 'Your show'} — your hall`,
        minutesLeft: Math.max(0, Math.round((new Date(hostShow.closes_at).getTime() - Date.now()) / 60_000)),
        hostBoothFee: hostShow.table_price,
        hostShowTables: hostShow.tables_total,
      }
    }
    const stockRows = tableStock(hostTable.id)
    const profit = round2(hostTable.revenue - hostTable.cost_out)
    return {
      active: true as const,
      showOpen: true as const,
      hostShow: true as const,
      showName: `${venue?.name ?? 'Your show'} — your booth`,
      minutesLeft: Math.max(0, Math.round((new Date(hostShow.closes_at).getTime() - Date.now()) / 60_000)),
      table: {
        location: hostTable.location,
        fee: 0,
        revenue: round2(hostTable.revenue),
        costOut: round2(hostTable.cost_out),
        buyerCount: hostTable.buyer_count,
        profit,
      },
      stock: stockRows,
      slotsUsed: stockRows.length,
      slotsMax: TABLE_SLOTS,
      unitsOnTable: stockRows.reduce((a, r) => a + r.quantity, 0),
    }
  }
  const show = getActiveShow()
  if (!show) return { active: false as const, showOpen: false as const, hostShow: false as const }
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

/**
 * Relative walk-in traffic at one of the player's own hosted shows, normalized
 * so a rep-50 scene with a $5 gate lands near the convention floor's main-row
 * baseline (1.0). Reuses shows.ts's own walk-in model so the booth's sales
 * rate tracks the crowd the host actually paid to draw.
 */
function showWalkinTraffic(showId: number): number {
  const row = db.prepare('SELECT gate, venue FROM card_shows WHERE id = ?').get(showId) as { gate: number; venue: string } | undefined
  if (!row) return 1
  const venue = venueById(row.venue)
  const rep = currentShowRep()
  const gateDraw = Math.max(0.15, 1 - row.gate / 22)
  const repDraw = 0.55 + (rep / 100) * 0.9
  const relative = venue ? (venue.crowd * gateDraw * repDraw * marketHeatIndex()) / 3.2 : 1
  return round2(Math.max(0.35, Math.min(2.2, relative)))
}

function currentShowRep(): number {
  const row = db.prepare('SELECT reputation FROM shop').get() as { reputation: number } | undefined
  if (row) return row.reputation
  const meta = getMeta('shows:rep')
  return meta != null && Number.isFinite(Number(meta)) ? Number(meta) : 50
}

function runBuyers(table: VendorTable, show: { id?: number; opened_at: string; closes_at: string }) {
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
  // Host-show tables draw the show's own walk-in crowd; convention tables pay
  // for position (entrance row outearns the back wall).
  const trafficMult = table.host_show_id != null ? showWalkinTraffic(show.id ?? 0) : (loc?.traffic ?? 1)

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
    // The ask is PER UNIT (the table UI prices stacks at per-unit × count);
    // buyers judge fairness per card, and the sale credits ask × quantity.
    const unitAsk = ask / Math.max(1, r.quantity)
    const ratio = unitAsk / anchor
    // Deals vanish fast; overpriced cardboard gathers looks, not offers.
    // THE SHOW PREMIUM — the vendor table's niche. Shows concentrate exactly
    // the collectors who hunt expensive cards: the liquidity penalty is waived
    // and the price-tolerance curve widens with value (up to ~×1.5 effective
    // tolerance on grails, ~nothing extra on junk) — so tables are where the
    // good stuff moves, and every so often a whale pays over street price.
    const premium = Math.min(0.5, Math.pow(anchor / 10, 0.3) / 3.5)
    const priceFactor = Math.min(1.4, Math.max(0.02, 1.35 - ratio / (1 + premium)))
    const chance = Math.min(0.2, 0.045 * trafficMult * traffic * priceFactor * seasonalWalkInMult())
    if (Math.random() >= chance) continue
    const buyer = pick(BUYERS)
    const cost = round2(r.cost_basis * r.quantity)
    const proceeds = round2(ask * r.quantity)
    const profit = round2(proceeds - cost)
    const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(r.card_id) as { name: string }).name
    const saleType = table.host_show_id != null ? 'host_show' : 'convention_table'
    insertSale.run(table.id, r.id, r.card_id, r.variant, r.condition, r.quantity, proceeds, r.cost_basis, nowIso())
    db.prepare(`UPDATE inventory SET status = 'sold', quantity = 0 WHERE id = ?`).run(r.id)
    db.prepare(
      `INSERT INTO sale_history (inventory_id, card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, '${saleType}', ?)`,
    ).run(r.id, r.card_id, r.variant, r.condition, r.quantity, ask, cost, profit, buyer, nowIso())
    db.prepare(`UPDATE vendor_tables SET revenue = revenue + ?, cost_out = cost_out + ?, buyer_count = buyer_count + 1 WHERE id = ?`)
      .run(proceeds, cost, table.id)
    cashIn += proceeds
    sales++
    const ratioNote = ratio < 0.85 ? ' — priced to move' : ratio > 1.15 ? ' (paid over market!)' : ''
    logActivity('sale', `${table.host_show_id != null ? 'Booth sale' : 'Table sale'}: ${r.quantity > 1 ? `${r.quantity}× ` : ''}${name} → ${buyer} for $${proceeds.toFixed(2)} (${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} vs cost)${ratioNote}`, proceeds)
  }
  if (cashIn > 0) db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(round2(cashIn))
  void sales
}

// ---------------------------------------------------------------------------
// Tick — drive buyers, settle closed shows. Called from the market tick.
// ---------------------------------------------------------------------------

export function vendorTick() {
  settleStaleTables()
  // Each table kind pairs with its own venue: convention tables sell to the
  // NPC show's floor, host-show tables to the player's own crowd. Both can
  // legitimately run in the same tick if a convention overlaps your show.
  const show = getActiveShow()
  const table = getMyTable()
  if (show && table && table.host_show_id == null) runBuyers(table, show)
  const hostShow = hostedShowDoorsOpen()
  if (hostShow) {
    const hostTable = db.prepare(`SELECT * FROM vendor_tables WHERE host_show_id = ? AND settled = 0`).get(hostShow.id) as VendorTable | undefined
    if (hostTable) runBuyers(hostTable, { id: hostShow.id, opened_at: hostShow.opens_at, closes_at: hostShow.closes_at })
  }
}

export const TICK_INTERVAL_MS = TICK_MS
