import { db, nowIso, logActivity } from '../lib/db'
import { valueOf, round2 } from './market'
import { getShop } from './shop'
import * as pnl from './pnl'
import * as salesTax from './salestax'
import { isNonprofit, NONPROFIT_SPEND_FACTOR } from './tax'

// ---------------------------------------------------------------------------
// Bulk boxes — the dollar bin. Package junk cards at a flat per-card price;
// walk-in customers buy them by the handful (1-4 cards at a time). Sales run
// on the shop tick alongside case sales: lower margin per card, but volume,
// and every handful is a customer.
// ---------------------------------------------------------------------------

// Migration for pre-bulk databases.
try { db.exec(`ALTER TABLE inventory ADD COLUMN bulk_box_id INTEGER`) } catch { /* exists */ }

export const BOX_PRESETS = [
  { label: 'Quarter Bin', price_per_card: 0.25, capacity: 300, sellRate: 0.9 },
  { label: 'Dollar Box', price_per_card: 1, capacity: 200, sellRate: 0.7 },
  { label: 'Two-Dollar Box', price_per_card: 2, capacity: 150, sellRate: 0.5 },
] as const

type Box = {
  id: number
  label: string
  price_per_card: number
  capacity: number
  paid: number
  revenue: number
  cards_sold: number
  created_at: string
}

function getBox(id: number): Box | undefined {
  return db.prepare(`SELECT * FROM bulk_boxes WHERE id = ?`).get(id) as Box | undefined
}

function boxCount(boxId: number): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM bulk_box_cards WHERE box_id = ?`).get(boxId) as { n: number }).n
}

/** How full the boxes are (0..1 avg) — full bins sell faster; picked-over bins stall. */
function fullness(boxId: number): number {
  const box = getBox(boxId)
  if (!box) return 0
  return Math.min(1, boxCount(boxId) / Math.max(1, box.capacity * 0.4))
}

// ---------------------------------------------------------------------------
// Buying & filling
// ---------------------------------------------------------------------------

export function buyBox(label: string, pricePerCard: number, capacity: number) {
  const shop = getShop()
  if (!shop) return { ok: false as const, error: 'Lease a shop first' }
  const preset = BOX_PRESETS.find((b) => b.label === label)
  if (!preset) return { ok: false as const, error: 'Unknown box type' }
  const cost = round2(preset.price_per_card * 20) // the empty box itself costs a little
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < cost) return { ok: false as const, error: `An empty ${label} costs $${cost.toFixed(2)} — not enough cash` }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(cost)
  db.prepare(`INSERT INTO bulk_boxes (label, price_per_card, capacity, paid, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(label, preset.price_per_card, preset.capacity, cost, nowIso())
  logActivity('shop', `Set up a ${label} (${preset.capacity} cards max) — fill it from your junk cards and let the pickers dig.`, -cost)
  return { ok: true as const, label }
}

export function fill(boxId: number, inventoryIds: number[]) {
  const box = getBox(boxId)
  if (!box) return { ok: false as const, error: 'No such box' }
  const room = box.capacity - boxCount(boxId)
  if (room <= 0) return { ok: false as const, error: `${box.label} is full` }
  if (!Array.isArray(inventoryIds) || inventoryIds.length === 0) return { ok: false as const, error: 'Pick cards to add' }
  if (inventoryIds.length > room) return { ok: false as const, error: `Only ${room} slots left in the ${box.label}` }
  const shop = getShop()
  if (!shop) return { ok: false as const, error: 'No shop' }

  let added = 0
  let basis = 0
  const tx = db.transaction(() => {
    for (const invId of inventoryIds) {
      const blocked = db.prepare(`SELECT COUNT(*) AS n FROM ebay_auctions WHERE inventory_id = ? AND status = 'live'`).get(invId) as { n: number }
      if (blocked.n > 0) continue // on the BidBay block — can't go in a box mid-auction
      const row = db.prepare(`SELECT id, status, quantity, graded_grade, cost_basis FROM inventory WHERE id = ?`).get(invId) as
        | { id: number; status: string; quantity: number; graded_grade: string | null; cost_basis: number }
        | undefined
      if (!row || row.status !== 'collection' || row.graded_grade) continue
      // A card can only live in one display at a time; the box frees pockets too.
      try { import('./binders').then((b) => b.cleanupSlotsForInventory([row.id])).catch(() => {}) } catch { /* non-fatal */ }
      db.prepare(`UPDATE inventory SET status = 'in_bulk', bulk_box_id = ? WHERE id = ?`).run(boxId, row.id)
      db.prepare(`INSERT INTO bulk_box_cards (box_id, inventory_id) VALUES (?, ?)`).run(boxId, row.id)
      basis += row.cost_basis
      added++
    }
  })
  tx()
  if (added > 0) {
    db.prepare(`UPDATE bulk_boxes SET paid = paid + ? WHERE id = ?`).run(round2(basis), boxId)
    logActivity('shop', `Filled the ${box.label} with ${added} card${added === 1 ? '' : 's'} at $${box.price_per_card.toFixed(2)} each (${boxCount(boxId)}/${box.capacity}).`)
  }
  return { ok: true as const, added }
}

/** Junk eligibility: raw collection cards worth under the box's per-card price ceiling. */
export function boxStockable(pricePerCard: number) {
  const rows = db
    .prepare(
      `SELECT i.id, i.card_id, i.variant, i.condition, i.quantity, i.cost_basis,
              c.name, c.image_small, c.rarity, s.name AS set_name
       FROM inventory i JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
       WHERE i.status = 'collection' AND i.graded_grade IS NULL AND i.quantity = 1
       ORDER BY i.acquired_at DESC LIMIT 400`,
    )
    .all() as { id: number; card_id: string; variant: string; condition: string; quantity: number; cost_basis: number; name: string; image_small: string | null; rarity: string | null; number: string; set_name: string }[]
  const out = rows
    .map((r) => ({ ...r, anchor: valueOf(r.card_id, r.variant || 'normal', (r.condition as any) || 'NM') }))
    .filter((r) => r.anchor > 0 && r.anchor < pricePerCard * 3) // genuinely junk-tier vs the bin's price
  return { ok: true as const, rows: out }
}

export function removeFromBox(inventoryId: number) {
  const row = db.prepare(`SELECT box_id FROM bulk_box_cards WHERE inventory_id = ?`).get(inventoryId) as { box_id: number } | undefined
  if (!row) return { ok: false as const, error: 'That card is not in a box' }
  db.prepare(`DELETE FROM bulk_box_cards WHERE inventory_id = ?`).run(inventoryId)
  db.prepare(`UPDATE inventory SET status = 'collection', bulk_box_id = NULL WHERE id = ?`).run(inventoryId)
  return { ok: true as const }
}

export function emptyBox(boxId: number) {
  const box = getBox(boxId)
  if (!box) return { ok: false as const, error: 'No such box' }
  const rows = db.prepare(`SELECT inventory_id FROM bulk_box_cards WHERE box_id = ?`).all(boxId) as { inventory_id: number }[]
  const tx = db.transaction(() => {
    for (const r of rows) {
      db.prepare(`UPDATE inventory SET status = 'collection', bulk_box_id = NULL WHERE id = ?`).run(r.inventory_id)
    }
    db.prepare(`DELETE FROM bulk_box_cards WHERE box_id = ?`).run(boxId)
  })
  tx()
  logActivity('shop', `Dumped the ${box.label} back into the binder — ${rows.length} card${rows.length === 1 ? '' : 's'} returned.`)
  return { ok: true as const, returned: rows.length }
}

export function sellBox(boxId: number) {
  const box = getBox(boxId)
  if (!box) return { ok: false as const, error: 'No such box' }
  const count = boxCount(boxId)
  if (count === 0) return { ok: false as const, error: 'Box is already empty' }
  // A dealer buys the whole box at 60% of the sticker price, cash on the spot.
  const gross = round2(count * box.price_per_card * 0.6)
  const tx = db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT b.inventory_id, i.card_id, i.variant, i.condition, i.quantity, i.cost_basis
         FROM bulk_box_cards b JOIN inventory i ON i.id = b.inventory_id WHERE b.box_id = ?`,
      )
      .all(boxId) as { inventory_id: number; card_id: string; variant: string; condition: string; quantity: number; cost_basis: number }[]
    let costOut = 0
    for (const r of rows) {
      costOut += r.cost_basis * r.quantity
      db.prepare(`UPDATE inventory SET status = 'sold', quantity = 0, bulk_box_id = NULL WHERE id = ?`).run(r.inventory_id)
      db.prepare(
        `INSERT INTO sale_history (inventory_id, card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'Bin Dealer', 'bulk_box', ?)`,
      ).run(r.inventory_id, r.card_id, r.variant, r.condition, r.quantity, round2(box.price_per_card * 0.6), round2(r.cost_basis), round2(box.price_per_card * 0.6 - r.cost_basis), nowIso())
    }
    db.prepare(`DELETE FROM bulk_box_cards WHERE box_id = ?`).run(boxId)
    db.prepare(`UPDATE bulk_boxes SET revenue = revenue + ?, cards_sold = cards_sold + ? WHERE id = ?`).run(gross, count, boxId)
    const take = isNonprofit() ? round2(gross * NONPROFIT_SPEND_FACTOR) : gross
    db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(take)
    db.prepare(`UPDATE shop SET lifetime_revenue = lifetime_revenue + ?, customer_count = customer_count + 1, today_customers = today_customers + 1, today_revenue = today_revenue + ? WHERE id = 1`)
      .run(take, take)
    pnl.append('bulk', take, `dealer buyout: ${count} cards${isNonprofit() ? ' (donation-framed)' : ''}`)
    if (!isNonprofit()) salesTax.collect('bulk', gross, 'dealer buyout')
    void costOut
  })
  tx()
  const profit = round2(gross - box.paid)
  logActivity('shop', `Bin Dealer bought out the ${box.label} — ${count} cards at 60¢ on the dollar: $${gross.toFixed(2)} (${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} vs what you paid).`, gross)
  return { ok: true as const, gross, cards: count }
}

// ---------------------------------------------------------------------------
// Handful sales — the picker culture of the dollar bin
// ---------------------------------------------------------------------------

export function bulkTick() {
  const shop = getShop()
  if (!shop) return
  const boxes = db.prepare(`SELECT * FROM bulk_boxes`).all() as Box[]
  if (boxes.length === 0) return

  for (const box of boxes) {
    const count = boxCount(box.id)
    if (count === 0) continue
    const preset = BOX_PRESETS.find((b) => b.label === box.label)
    const base = preset?.sellRate ?? 0.7
    // Full bins sell; picked-over bins stall. Cheap bins always move something.
    const chance = Math.min(0.5, base * (0.3 + fullness(box.id)))
    if (Math.random() >= chance) continue
    // A handful: 1-4 cards, cheaper boxes draw bigger grabs.
    const maxHand = box.price_per_card <= 0.25 ? 4 : box.price_per_card <= 1 ? 3 : 2
    const take = Math.min(count, 1 + Math.floor(Math.random() * maxHand))
    const rows = db
      .prepare(
        `SELECT b.inventory_id, i.card_id, i.variant, i.condition, i.quantity, i.cost_basis, c.name
         FROM bulk_box_cards b JOIN inventory i ON i.id = b.inventory_id JOIN cards c ON c.id = i.card_id
         WHERE b.box_id = ? ORDER BY RANDOM() LIMIT ?`,
      )
      .all(box.id, take) as { inventory_id: number; card_id: string; variant: string; condition: string; quantity: number; cost_basis: number; name: string }[]
    const gross = round2(take * box.price_per_card)
    const names = rows.map((r) => r.name)
    const tx = db.transaction(() => {
      for (const r of rows) {
        db.prepare(`UPDATE inventory SET status = 'sold', quantity = 0, bulk_box_id = NULL WHERE id = ?`).run(r.inventory_id)
        db.prepare(`DELETE FROM bulk_box_cards WHERE inventory_id = ?`).run(r.inventory_id)
        db.prepare(
          `INSERT INTO sale_history (inventory_id, card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'bulk_box', ?)`,
        ).run(r.inventory_id, r.card_id, r.variant, r.condition, r.quantity, box.price_per_card, round2(r.cost_basis), round2(box.price_per_card - r.cost_basis), 'dollar-bin digger', nowIso())
      }
      db.prepare(`UPDATE bulk_boxes SET revenue = revenue + ?, cards_sold = cards_sold + ? WHERE id = ?`).run(gross, take, box.id)
      const take2 = isNonprofit() ? round2(gross * NONPROFIT_SPEND_FACTOR) : gross
      db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(take2)
      db.prepare(`UPDATE shop SET lifetime_revenue = lifetime_revenue + ?, lifetime_cost = lifetime_cost + ?, customer_count = customer_count + 1, today_customers = today_customers + 1, today_revenue = today_revenue + ? WHERE id = 1`)
        .run(take2, round2(rows.reduce((a, r) => a + r.cost_basis, 0)), take2)
      pnl.append('bulk', take2, `handful of ${take} from the ${box.label}${isNonprofit() ? ' (donation-framed)' : ''}`)
      if (!isNonprofit()) salesTax.collect('bulk', gross, `handful of ${take}`)
    })
    tx()
    logActivity('shop', `Dollar-bin digger took ${take} from the ${box.label} (${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}) — $${gross.toFixed(2)}.`, gross)
  }
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export function status() {
  const boxes = db.prepare(`SELECT * FROM bulk_boxes ORDER BY price_per_card`).all() as Box[]
  return boxes.map((b) => {
    const count = boxCount(b.id)
    const sample = db
      .prepare(
        `SELECT i.id, c.name, c.image_small, i.cost_basis
         FROM bulk_box_cards b JOIN inventory i ON i.id = b.inventory_id JOIN cards c ON c.id = i.card_id
         WHERE b.box_id = ? ORDER BY RANDOM() LIMIT 6`,
      )
      .all(b.id) as { id: number; name: string; image_small: string | null; cost_basis: number }[]
    return {
      ...b,
      count,
      fullness: Math.round(fullness(b.id) * 100),
      revenue: round2(b.revenue),
      paid: round2(b.paid),
      sample,
    }
  })
}
