import { db, nowIso, logActivity } from '../lib/db'
import { valueOf, round2, type Condition } from './market'
import { getShop } from './shop'
import * as pnl from './pnl'
import * as salesTax from './salestax'
import { isNonprofit, NONPROFIT_SPEND_FACTOR } from './tax'

// ---------------------------------------------------------------------------
// Mystery grab bags — sealed packs of 10 junk cards with one guaranteed hit
// worth at least 5× the bag price. You assemble them from your own stock
// (junk + one underpriced hit = margin), price them, and walk-in customers
// gamble. You can also buy your own bags at retail for the reveal — a fun
// way to turn bulk inventory into a streamable moment.
// ---------------------------------------------------------------------------

// Migration for pre-bag databases.
try { db.exec(`ALTER TABLE grab_bags ADD COLUMN cost_basis REAL NOT NULL DEFAULT 0`) } catch { /* exists */ }

const BAG_SIZE = 10
const BAG_PRICES = [5, 10, 25] as const
const HIT_MULTIPLIER = 5 // the hit must be worth ≥ 5× the bag price

type Bag = {
  id: number
  label: string
  price: number
  hit_value: number
  status: 'in_shop' | 'sold' | 'opened' | 'stocked_back'
  cost_basis: number
  sold_to: string | null
  revenue: number | null
  created_at: string
  resolved_at: string | null
}

const BUYER_NAMES = ['Kyle', 'Amara', 'Theo', 'Sofia', 'Dev', 'Nina', 'Marcus', 'Ellie', 'Raj', 'June', 'Wes', 'Cora']

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function bagCount(bagId: number): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM grab_bag_cards WHERE bag_id = ?`).get(bagId) as { n: number }).n
}

// ---------------------------------------------------------------------------
// Assembly — 9 junk + 1 hit, sealed at creation
// ---------------------------------------------------------------------------

export function stockable(price: number) {
  const rows = db
    .prepare(
      `SELECT i.id, i.card_id, i.variant, i.condition, i.quantity, i.cost_basis,
              c.name, c.image_small, c.rarity, s.name AS set_name
       FROM inventory i JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
       WHERE i.status = 'collection' AND i.graded_grade IS NULL AND i.quantity = 1
       ORDER BY i.acquired_at DESC LIMIT 400`,
    )
    .all() as { id: number; card_id: string; variant: string; condition: string; quantity: number; cost_basis: number; name: string; image_small: string | null; rarity: string | null; number: string; set_name: string }[]
  const out = rows.map((r) => {
    const anchor = valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
    return { ...r, anchor, isHitTier: anchor >= price * HIT_MULTIPLIER, isJunkTier: anchor > 0 && anchor < price * 2.5 }
  })
  return { ok: true as const, rows: out, price }
}

export function assemble(price: number, junkIds: number[], hitId: number) {
  const shop = getShop()
  if (!shop) return { ok: false as const, error: 'Lease a shop first' }
  if (!BAG_PRICES.includes(price as (typeof BAG_PRICES)[number])) return { ok: false as const, error: `Bag price must be ${BAG_PRICES.join(', ')}` }
  if (!Array.isArray(junkIds) || junkIds.length !== BAG_SIZE - 1) return { ok: false as const, error: `Pick exactly ${BAG_SIZE - 1} junk cards` }
  if (new Set(junkIds).size !== junkIds.length) return { ok: false as const, error: 'Duplicate cards picked' }
  const all = [...junkIds, hitId]

  let basis = 0
  let hitValue = 0
  const tx = db.transaction(() => {
    const info = db
      .prepare(`INSERT INTO grab_bags (label, price, hit_value, status, created_at) VALUES ('Mystery Grab Bag', ?, 0, 'in_shop', ?)`)
      .run(price, nowIso())
    const bagId = Number(info.lastInsertRowid)
    for (const invId of all) {
      const row = db.prepare(`SELECT id, status, quantity, graded_grade, cost_basis FROM inventory WHERE id = ?`).get(invId) as
        | { id: number; status: string; quantity: number; graded_grade: string | null; cost_basis: number }
        | undefined
      if (!row || row.status !== 'collection' || row.graded_grade) throw new Error('One of the picked cards is no longer available')
      try { import('./binders').then((b) => b.cleanupSlotsForInventory([row.id])).catch(() => {}) } catch { /* non-fatal */ }
      db.prepare(`UPDATE inventory SET status = 'in_bag' WHERE id = ?`).run(row.id)
      db.prepare(`INSERT INTO grab_bag_cards (bag_id, inventory_id, is_hit) VALUES (?, ?, ?)`).run(bagId, row.id, invId === hitId ? 1 : 0)
      basis += row.cost_basis
      if (invId === hitId) {
        const v = (db.prepare(`SELECT id, card_id, variant, condition FROM inventory WHERE id = ?`).get(invId) as { card_id: string; variant: string; condition: string })
        hitValue = valueOf(v.card_id, v.variant || 'normal', (v.condition as Condition) || 'NM')
      }
    }
    if (hitValue < price * HIT_MULTIPLIER) throw new Error(`The hit must be worth at least $${(price * HIT_MULTIPLIER).toFixed(2)} (this one is ~$${hitValue.toFixed(2)})`)
    db.prepare(`UPDATE grab_bags SET hit_value = ?, cost_basis = ? WHERE id = ?`).run(round2(hitValue), round2(basis), bagId)
    return bagId
  })
  try {
    const bagId = tx()
    logActivity('shop', `Sealed a Mystery Grab Bag ($${price}) — 10 cards, one guaranteed hit worth ~$${hitValue.toFixed(2)}. Basis $${basis.toFixed(2)}.`)
    return { ok: true as const, bagId }
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Assembly failed' }
  }
}

// ---------------------------------------------------------------------------
// Player reveal — buy your own bag at retail and open it
// ---------------------------------------------------------------------------

export function buyBag(bagId: number) {
  const bag = db.prepare(`SELECT * FROM grab_bags WHERE id = ? AND status = 'in_shop'`).get(bagId) as Bag | undefined
  if (!bag) return { ok: false as const, error: 'That bag is not in the shop' }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < bag.price) return { ok: false as const, error: `The bag costs $${bag.price.toFixed(2)} — not enough cash` }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(bag.price)
  logActivity('shop', `Bought your own ${bag.label} for $${bag.price.toFixed(2)} — time to rip it.`, -bag.price)
  return { ok: true as const, bagId, price: bag.price }
}

/** Opens a purchased bag: every card returns to the collection. Returns the ordered reveal. */
export function openBag(bagId: number) {
  const bag = db.prepare(`SELECT * FROM grab_bags WHERE id = ? AND status = 'in_shop'`).get(bagId) as Bag | undefined
  if (!bag) return { ok: false as const, error: 'Bag not available to open' }
  const cards = db
    .prepare(
      `SELECT g.is_hit, i.id, i.card_id, i.variant, i.condition, i.quantity, i.cost_basis, c.name, c.image_small, s.name AS set_name
       FROM grab_bag_cards g JOIN inventory i ON i.id = g.inventory_id JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
       WHERE g.bag_id = ? ORDER BY g.is_hit ASC, RANDOM()`,
    )
    .all(bagId) as { is_hit: number; id: number; card_id: string; variant: string; condition: string; quantity: number; cost_basis: number; name: string; image_small: string | null; set_name: string }[]
  if (cards.length === 0) return { ok: false as const, error: 'Bag is empty' }

  let totalValue = 0
  const reveal = cards.map((c) => {
    const v = valueOf(c.card_id, c.variant || 'normal', (c.condition as Condition) || 'NM')
    totalValue += v
    return { inventoryId: c.id, cardId: c.card_id, name: c.name, image: c.image_small, setName: c.set_name, isHit: c.is_hit === 1, value: round2(v), costBasis: round2(c.cost_basis) }
  })
  const hit = reveal.find((r) => r.isHit)

  const tx = db.transaction(() => {
    for (const c of cards) {
      db.prepare(`UPDATE inventory SET status = 'collection' WHERE id = ?`).run(c.id)
      db.prepare(`DELETE FROM grab_bag_cards WHERE inventory_id = ?`).run(c.id)
    }
    db.prepare(`UPDATE grab_bags SET status = 'opened', resolved_at = ? WHERE id = ?`).run(nowIso(), bagId)
  })
  tx()
  const roi = bag.price > 0 ? totalValue / bag.price - 1 : 0
  logActivity(
    'shop',
    `Ripped the ${bag.label}: ${hit ? `hit was ${hit.name} (${fmt(hit.value)})` : 'no hit?!'} — ${fmt(totalValue)} of cards for ${fmt(bag.price)} (${roi >= 0 ? '+' : ''}${Math.round(roi * 100)}%).`,
    0,
  )
  return { ok: true as const, reveal, totalValue: round2(totalValue), price: bag.price, roi: round2(roi), hit: hit ?? null }
}

function fmt(n: number): string {
  return `$${n.toFixed(2)}`
}

// ---------------------------------------------------------------------------
// Walk-in customers — they buy sealed bags on the shop tick
// ---------------------------------------------------------------------------

export function bagTick() {
  const shop = getShop()
  if (!shop) return
  const bags = db.prepare(`SELECT * FROM grab_bags WHERE status = 'in_shop'`).all() as Bag[]
  if (bags.length === 0) return
  // Bags are an impulse gamble: modest per-tick chance, better for cheaper bags.
  for (const bag of bags) {
    const chance = bag.price <= 5 ? 0.05 : bag.price <= 10 ? 0.035 : 0.02
    if (Math.random() >= chance) continue
    const buyer = pick(BUYER_NAMES)
    const margin = round2(bag.price - bag.cost_basis)
    const tx = db.transaction(() => {
      const cards = db.prepare(`SELECT inventory_id, card_id, variant, condition, quantity, cost_basis FROM grab_bag_cards g JOIN inventory i ON i.id = g.inventory_id WHERE bag_id = ?`).all(bag.id) as { inventory_id: number; card_id: string; variant: string; condition: string; quantity: number; cost_basis: number }[]
      for (const c of cards) {
        db.prepare(`UPDATE inventory SET status = 'sold', quantity = 0 WHERE id = ?`).run(c.inventory_id)
        db.prepare(`DELETE FROM grab_bag_cards WHERE inventory_id = ?`).run(c.inventory_id)
        db.prepare(
          `INSERT INTO sale_history (inventory_id, card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'grab_bag', ?)`,
        ).run(c.inventory_id, c.card_id, c.variant, c.condition, c.quantity, round2(bag.price / cards.length), round2(c.cost_basis), round2(bag.price / cards.length - c.cost_basis), buyer, nowIso())
      }
      db.prepare(`UPDATE grab_bags SET status = 'sold', sold_to = ?, revenue = ?, resolved_at = ? WHERE id = ?`).run(buyer, bag.price, nowIso(), bag.id)
      const take = isNonprofit() ? round2(bag.price * NONPROFIT_SPEND_FACTOR) : bag.price
      db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(take)
      db.prepare(`UPDATE shop SET lifetime_revenue = lifetime_revenue + ?, lifetime_cost = lifetime_cost + ?, customer_count = customer_count + 1, today_customers = today_customers + 1, today_revenue = today_revenue + ? WHERE id = 1`)
        .run(take, round2(bag.cost_basis), take)
      pnl.append('bags', take, `sealed bag bought by ${buyer}${isNonprofit() ? ' (donation-framed)' : ''}`)
      if (!isNonprofit()) salesTax.collect('bags', bag.price, `bag sold to ${buyer}`)
      // Selling gambles builds word of mouth when the hit is genuinely good.
      if (bag.hit_value >= bag.price * HIT_MULTIPLIER * 2) {
        db.prepare(`UPDATE shop SET reputation = reputation + 1 WHERE id = 1`).run()
      }
    })
    tx()
    logActivity('shop', `${buyer} bought a Mystery Grab Bag for ${fmt(bag.price)} — sealed and gone. (margin ${margin >= 0 ? '+' : ''}${fmt(margin)} vs basis)`, bag.price)
    return // one bag sale per tick keeps them feeling special
  }
}

// ---------------------------------------------------------------------------
// Stocking back — pull the hit out of an unsold bag and reuse the rest
// ---------------------------------------------------------------------------

export function stockBack(bagId: number) {
  const bag = db.prepare(`SELECT * FROM grab_bags WHERE id = ? AND status = 'in_shop'`).get(bagId) as Bag | undefined
  if (!bag) return { ok: false as const, error: 'Bag not available' }
  const cards = db.prepare(`SELECT inventory_id FROM grab_bag_cards WHERE bag_id = ?`).all(bagId) as { inventory_id: number }[]
  const tx = db.transaction(() => {
    for (const c of cards) {
      db.prepare(`UPDATE inventory SET status = 'collection' WHERE id = ?`).run(c.inventory_id)
      db.prepare(`DELETE FROM grab_bag_cards WHERE inventory_id = ?`).run(c.inventory_id)
    }
    db.prepare(`UPDATE grab_bags SET status = 'stocked_back', resolved_at = ? WHERE id = ?`).run(nowIso(), bagId)
  })
  tx()
  logActivity('shop', `Unsealed the ${bag.label} and returned all ${cards.length} cards to the collection.`)
  return { ok: true as const, returned: cards.length }
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export function history(limit = 8) {
  const rows = db
    .prepare(`SELECT * FROM grab_bags WHERE status != 'in_shop' ORDER BY id DESC LIMIT ?`)
    .all(limit) as Bag[]
  return rows.map((b) => {
    const value = b.status === 'sold' ? (b.revenue ?? 0) : b.hit_value
    return { ...b, profit: round2(value - b.cost_basis) }
  })
}

export function status() {
  const bags = db.prepare(`SELECT * FROM grab_bags WHERE status = 'in_shop' ORDER BY id DESC`).all() as Bag[]
  return {
    bags: bags.map((b) => ({
      ...b,
      count: bagCount(b.id),
      hitOdds: Math.round((1 / BAG_SIZE) * 100),
      margin: round2(b.price - b.cost_basis),
    })),
    history: history(),
    prices: BAG_PRICES,
    hitMultiplier: HIT_MULTIPLIER,
  }
}
