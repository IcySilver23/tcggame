import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { round2, valueOf, type Condition } from './market'
import { getShop } from './shop'
import * as pnl from './pnl'
import * as salesTax from './salestax'
import { isNonprofit, NONPROFIT_SPEND_FACTOR } from './tax'

// ---------------------------------------------------------------------------
// YOUR OWN REPACKS — the one product line where you make the margin instead of
// finding it.
//
// A repack batch is five sealed five-card packs. One of the five holds a chase
// card you put up (worth at least 4× the pack price); the other four are filler
// pulled from your cheapest stock. You set the price and the odds you print on
// the wrapper.
//
// The odds are the interesting part: they are a CLAIM, not a stat. Advertise
// 1 in 3 when the truth is 1 in 5 and the batch sells faster — until buyers
// compare pulls on the community board and complain, which costs you standing
// you cannot buy back with a discount. Print the truth (or understate it) and
// the batch moves slower, but the people who open it stay customers.
// ---------------------------------------------------------------------------

db.exec(`CREATE TABLE IF NOT EXISTS repacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL DEFAULT 'Repack',
  price REAL NOT NULL,
  cards_per_pack INTEGER NOT NULL DEFAULT 5,
  pack_count INTEGER NOT NULL DEFAULT 5,
  published_odds INTEGER NOT NULL,      -- "1 in N" printed on the wrapper
  actual_odds INTEGER NOT NULL,         -- the truth: 1 in pack_count
  chase_card_id TEXT NOT NULL REFERENCES cards(id),
  chase_value REAL NOT NULL,
  chase_slot INTEGER NOT NULL,          -- which pack (0-based) holds it
  cost_basis REAL NOT NULL,
  sold INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0,
  complaints INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'on_shelf',  -- on_shelf | sold_out | stocked_back
  created_at TEXT NOT NULL,
  resolved_at TEXT
)`)

db.exec(`CREATE TABLE IF NOT EXISTS repack_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repack_id INTEGER NOT NULL REFERENCES repacks(id),
  pack_index INTEGER NOT NULL,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id),
  sold_at TEXT
)`)

export const REPACK_TERMS = {
  prices: [8, 12, 20] as const,
  packCount: 5,
  cardsPerPack: 5,
  publishedOdds: [3, 5, 10] as const,
  minChaseMultiple: 4,
  fillerCeiling: 2, // cards at or under $2 are filler
}

const BUYER_NAMES = ['Kai', 'Rosa', 'Trent', 'Amira', 'Dorian', 'Elle', 'Sasha', 'Nate', 'Ivy', 'Bo']
const REP_KEY = 'repack:rep'

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}
function cardName(cardId: string): string {
  return (db.prepare('SELECT name FROM cards WHERE id = ?').get(cardId) as { name: string } | undefined)?.name ?? cardId
}

/** 0–100. Sales scale with it; complaints knock it down and it recovers slowly. */
export function reputation(): number {
  const raw = Number(getMeta(REP_KEY) ?? '50')
  return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 50
}

function adjustRep(delta: number): number {
  const next = Math.max(0, Math.min(100, reputation() + delta))
  setMeta(REP_KEY, String(next))
  return next
}

/** Cheapest collection cards that can serve as filler, plus a valid chase. */
export function stockable() {
  const rows = db
    .prepare(
      `SELECT i.id, i.card_id, i.variant, i.condition, i.cost_basis, c.name, c.image_small, c.rarity, s.name AS set_name
       FROM inventory i JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
       WHERE i.status = 'collection' AND i.graded_grade IS NULL AND i.quantity = 1
       ORDER BY i.acquired_at DESC LIMIT 600`,
    )
    .all() as { id: number; card_id: string; variant: string; condition: Condition; cost_basis: number; name: string; image_small: string | null; rarity: string | null; set_name: string }[]
  const out = rows.map((r) => ({ ...r, anchor: round2(valueOf(r.card_id, r.variant || 'normal', r.condition || 'NM')) }))
  const filler = out.filter((r) => r.anchor > 0 && r.anchor <= REPACK_TERMS.fillerCeiling).sort((a, b) => a.anchor - b.anchor)
  return {
    ok: true as const,
    rows: out.sort((a, b) => b.anchor - a.anchor),
    fillerCount: filler.length,
    need: REPACK_TERMS.packCount * REPACK_TERMS.cardsPerPack - 1,
    terms: REPACK_TERMS,
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function assemble(opts: { price: number; chaseInventoryId: number; publishedOdds: number }) {
  const shop = getShop()
  if (!shop) return { ok: false as const, error: 'Lease a shop first — repacks sell off your own shelf' }
  const { price, chaseInventoryId, publishedOdds } = opts
  if (!REPACK_TERMS.prices.includes(price as (typeof REPACK_TERMS.prices)[number])) {
    return { ok: false as const, error: `A repack price must be ${REPACK_TERMS.prices.map((p) => `$${p}`).join(', ')}` }
  }
  if (!REPACK_TERMS.publishedOdds.includes(publishedOdds as (typeof REPACK_TERMS.publishedOdds)[number])) {
    return { ok: false as const, error: `Printed odds must be 1 in ${REPACK_TERMS.publishedOdds.join(', 1 in ')}` }
  }
  const chase = db
    .prepare(
      `SELECT i.id, i.card_id, i.variant, i.condition, i.cost_basis, i.quantity, i.graded_grade, i.status
       FROM inventory i WHERE i.id = ?`,
    )
    .get(chaseInventoryId) as
    | { id: number; card_id: string; variant: string; condition: Condition; cost_basis: number; quantity: number; graded_grade: string | null; status: string }
    | undefined
  if (!chase || chase.status !== 'collection' || chase.quantity < 1) return { ok: false as const, error: 'That chase card is not in your collection' }
  const chaseValue = round2(valueOf(chase.card_id, chase.variant || 'normal', chase.condition || 'NM'))
  if (chaseValue < price * REPACK_TERMS.minChaseMultiple) {
    return { ok: false as const, error: `A $${price} repack needs a chase worth at least $${(price * REPACK_TERMS.minChaseMultiple).toFixed(2)} (this one is ~$${chaseValue.toFixed(2)})` }
  }

  const need = REPACK_TERMS.packCount * REPACK_TERMS.cardsPerPack - 1
  const filler = db
    .prepare(
      `SELECT i.id, i.card_id, i.variant, i.condition, i.cost_basis FROM inventory i
       WHERE i.status = 'collection' AND i.graded_grade IS NULL AND i.quantity = 1 AND i.id != ?
       ORDER BY i.acquired_at DESC LIMIT 600`,
    )
    .all(chaseInventoryId) as { id: number; card_id: string; variant: string; condition: Condition; cost_basis: number }[]
  const cheap = filler
    .map((r) => ({ ...r, anchor: round2(valueOf(r.card_id, r.variant || 'normal', r.condition || 'NM')) }))
    .filter((r) => r.anchor > 0 && r.anchor <= REPACK_TERMS.fillerCeiling)
    .sort((a, b) => a.anchor - b.anchor)
    .slice(0, need)
  if (cheap.length < need) {
    return {
      ok: false as const,
      error: `A batch eats ${need} filler cards worth $${REPACK_TERMS.fillerCeiling} or less — you have ${cheap.length}. Rip more, or buy a junk lot.`,
    }
  }

  const chaseSlot = Math.floor(Math.random() * REPACK_TERMS.packCount)
  let basis = chase.cost_basis
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO repacks (label, price, cards_per_pack, pack_count, published_odds, actual_odds, chase_card_id, chase_value, chase_slot, cost_basis, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        `Repack — ${cardName(chase.card_id)} chase`,
        price,
        REPACK_TERMS.cardsPerPack,
        REPACK_TERMS.packCount,
        publishedOdds,
        REPACK_TERMS.packCount,
        chase.card_id,
        chaseValue,
        chaseSlot,
        nowIso(),
      )
    const repackId = Number(info.lastInsertRowid)
    const put = db.prepare(`INSERT INTO repack_cards (repack_id, pack_index, inventory_id) VALUES (?, ?, ?)`)
    db.prepare(`UPDATE inventory SET status = 'in_repack' WHERE id = ?`).run(chase.id)
    put.run(repackId, chaseSlot, chase.id)
    let slot = 0
    for (const c of cheap) {
      if (slot === chaseSlot) slot++ // the chase already owns that pack
      db.prepare(`UPDATE inventory SET status = 'in_repack' WHERE id = ?`).run(c.id)
      put.run(repackId, slot % REPACK_TERMS.packCount, c.id)
      slot++
      basis += c.cost_basis
    }
    db.prepare(`UPDATE repacks SET cost_basis = ? WHERE id = ?`).run(round2(basis), repackId)
    return repackId
  })
  try {
    const repackId = tx()
    logActivity(
      'shop',
      `Sealed a run of ${REPACK_TERMS.packCount} repacks at $${price} — chase ${cardName(chase.card_id)} (~$${chaseValue.toFixed(2)}), printed odds 1 in ${publishedOdds}, truth 1 in ${REPACK_TERMS.packCount}. Basis $${round2(basis).toFixed(2)}.`,
    )
    return { ok: true as const, repackId, chaseValue: round2(chaseValue), printedOdds: publishedOdds, actualOdds: REPACK_TERMS.packCount }
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Assembly failed' }
  }
}

// ---------------------------------------------------------------------------
// Sales — walk-ins buy one pack at a time off the shelf
// ---------------------------------------------------------------------------

type Repack = {
  id: number
  label: string
  price: number
  cards_per_pack: number
  pack_count: number
  published_odds: number
  actual_odds: number
  chase_card_id: string
  chase_value: number
  chase_slot: number
  cost_basis: number
  sold: number
  revenue: number
  complaints: number
  status: 'on_shelf' | 'sold_out' | 'stocked_back'
  created_at: string
  resolved_at: string | null
}

function unsoldPacks(repackId: number): { pack_index: number; cards: { inventory_id: number; card_id: string; variant: string; condition: Condition; cost_basis: number }[] }[] {
  const rows = db
    .prepare(
      `SELECT r.pack_index, i.id AS inventory_id, i.card_id, i.variant, i.condition, i.cost_basis
       FROM repack_cards r JOIN inventory i ON i.id = r.inventory_id
       WHERE r.repack_id = ? AND r.sold_at IS NULL ORDER BY r.pack_index`,
    )
    .all(repackId) as { pack_index: number; inventory_id: number; card_id: string; variant: string; condition: Condition; cost_basis: number }[]
  const packs = new Map<number, { pack_index: number; cards: typeof rows }>()
  for (const r of rows) {
    const bucket = packs.get(r.pack_index) ?? { pack_index: r.pack_index, cards: [] as typeof rows }
    bucket.cards.push(r)
    packs.set(r.pack_index, bucket)
  }
  return [...packs.values()]
}

export function repackTick(): void {
  const shop = getShop()
  if (!shop) return
  const batches = db.prepare(`SELECT * FROM repacks WHERE status = 'on_shelf'`).all() as Repack[]
  const rep = reputation()
  for (const batch of batches) {
    const packs = unsoldPacks(batch.id)
    if (packs.length === 0) {
      db.prepare(`UPDATE repacks SET status = 'sold_out', resolved_at = ? WHERE id = ?`).run(nowIso(), batch.id)
      continue
    }
    // Value the buyer sees: the chase against the price, adjusted by the odds
    // printed on the wrapper and by whether your repacks have a reputation.
    const chaseRatio = batch.price > 0 ? batch.chase_value / batch.price : 0
    const oddsHype = batch.published_odds < batch.actual_odds ? 1.35 : batch.published_odds > batch.actual_odds ? 0.8 : 1
    const repFactor = 0.55 + (rep / 100) * 0.9
    const chance = Math.min(0.45, 0.055 * Math.min(3, chaseRatio / 4 + 0.5) * oddsHype * repFactor)
    if (Math.random() >= chance) continue

    const pack = pick(packs)
    const buyer = pick(BUYER_NAMES)
    const hasChase = pack.pack_index === batch.chase_slot
    const tx = db.transaction(() => {
      for (const c of pack.cards) {
        db.prepare(`UPDATE inventory SET status = 'sold', quantity = 0 WHERE id = ?`).run(c.inventory_id)
        db.prepare(`UPDATE repack_cards SET sold_at = ? WHERE inventory_id = ?`).run(nowIso(), c.inventory_id)
        const share = round2(batch.price / batch.cards_per_pack)
        db.prepare(
          `INSERT INTO sale_history (inventory_id, card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, 0, ?, ?, 'repack', ?)`,
        ).run(c.inventory_id, c.card_id, c.variant, c.condition, share, round2(c.cost_basis), round2(share - c.cost_basis), buyer, nowIso())
      }
      db.prepare(`UPDATE repacks SET sold = sold + 1, revenue = revenue + ? WHERE id = ?`).run(batch.price, batch.id)
      const take = isNonprofit() ? round2(batch.price * NONPROFIT_SPEND_FACTOR) : batch.price
      db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(take)
      db.prepare(
        `UPDATE shop SET lifetime_revenue = lifetime_revenue + ?, customer_count = customer_count + 1, today_customers = today_customers + 1, today_revenue = today_revenue + ? WHERE id = 1`,
      ).run(take, take)
      pnl.append('repacks', take, `repack sold to ${buyer}${isNonprofit() ? ' (donation-framed)' : ''}`)
      if (!isNonprofit()) salesTax.collect('repacks', batch.price, `repack sold to ${buyer}`)

      // The audit: a wrapper that promised better odds than it printed gets
      // talked about. Only when the claim was better than the truth — an
      // honest sheet never earns a complaint, and neither does an understated one.
      const lied = batch.published_odds < batch.actual_odds
      if (lied && !hasChase && Math.random() < 0.4) {
        db.prepare(`UPDATE repacks SET complaints = complaints + 1 WHERE id = ?`).run(batch.id)
        adjustRep(-4)
        db.prepare(`UPDATE shop SET reputation = MAX(0, reputation - 1) WHERE id = 1`).run()
      } else if (hasChase) {
        adjustRep(2) // a real hit posted to the board is free advertising
      }
    })
    tx()
    logActivity(
      'shop',
      hasChase
        ? `${buyer} opened a $${batch.price} repack and hit the chase — ${cardName(batch.chase_card_id)}. Your name is on the wrapper and they know it.`
        : `${buyer} bought a $${batch.price} repack (${packs.length - 1} left in the run).`,
      batch.price,
    )
    return // one repack per shop tick, like the grab bags
  }
}

/** Buy one of your own packs at retail and rip it — the streamable version. */
export function buyOwn(repackId: number) {
  const batch = db.prepare(`SELECT * FROM repacks WHERE id = ? AND status = 'on_shelf'`).get(repackId) as Repack | undefined
  if (!batch) return { ok: false as const, error: 'That run is not on the shelf' }
  const cash = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
  if (cash < batch.price) return { ok: false as const, error: `It costs $${batch.price.toFixed(2)} — not enough cash` }
  const packs = unsoldPacks(repackId)
  if (packs.length === 0) return { ok: false as const, error: 'Every pack in the run is gone' }
  const pack = pick(packs)
  const reveal = pack.cards.map((c) => ({
    inventoryId: c.inventory_id,
    cardId: c.card_id,
    name: cardName(c.card_id),
    value: round2(valueOf(c.card_id, c.variant || 'normal', c.condition || 'NM')),
  }))
  const totalValue = round2(reveal.reduce((a, r) => a + r.value, 0))
  const tx = db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(batch.price)
    // Your own rip is not a sale — no customer, no revenue — but the till did
    // pay the shelf price and the cards came back to you. Without a matching
    // negative line the week's net reads higher than the cash actually did.
    pnl.append('repacks', -batch.price, `own rip at $${batch.price.toFixed(2)} — cards returned, nothing sold`)
    for (const c of pack.cards) {
      db.prepare(`UPDATE inventory SET status = 'collection' WHERE id = ?`).run(c.inventory_id)
      db.prepare(`DELETE FROM repack_cards WHERE inventory_id = ?`).run(c.inventory_id)
    }
    db.prepare(`UPDATE repacks SET sold = sold + 1 WHERE id = ?`).run(repackId)
    const left = unsoldPacks(repackId).length
    if (left === 0) db.prepare(`UPDATE repacks SET status = 'sold_out', resolved_at = ? WHERE id = ?`).run(nowIso(), repackId)
  })
  tx()
  logActivity(
    'shop',
    `Bought your own $${batch.price} repack for $${batch.price.toFixed(2)} and ripped it: ${totalValue >= batch.price ? '+' : ''}$${(totalValue - batch.price).toFixed(2)} of cards, chase ${pack.pack_index === batch.chase_slot ? 'IN THE PACK' : 'still out there'}.`,
    -batch.price,
  )
  return { ok: true as const, reveal, totalValue, price: batch.price, chase: pack.pack_index === batch.chase_slot }
}

/** Unseal a run that is not selling and put the cards back. */
export function stockBack(repackId: number) {
  const batch = db.prepare(`SELECT * FROM repacks WHERE id = ? AND status = 'on_shelf'`).get(repackId) as Repack | undefined
  if (!batch) return { ok: false as const, error: 'That run is not on the shelf' }
  const rows = db.prepare(`SELECT inventory_id FROM repack_cards WHERE repack_id = ? AND sold_at IS NULL`).all(repackId) as { inventory_id: number }[]
  const tx = db.transaction(() => {
    for (const r of rows) {
      db.prepare(`UPDATE inventory SET status = 'collection' WHERE id = ?`).run(r.inventory_id)
      db.prepare(`DELETE FROM repack_cards WHERE inventory_id = ?`).run(r.inventory_id)
    }
    db.prepare(`UPDATE repacks SET status = 'stocked_back', resolved_at = ? WHERE id = ?`).run(nowIso(), repackId)
  })
  tx()
  logActivity('shop', `Pulled a repack run apart — ${rows.length} cards back in the collection, no money lost.`)
  return { ok: true as const, returned: rows.length }
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export function status() {
  const batches = db.prepare(`SELECT * FROM repacks WHERE status = 'on_shelf' ORDER BY id DESC`).all() as Repack[]
  const history = db.prepare(`SELECT * FROM repacks WHERE status != 'on_shelf' ORDER BY id DESC LIMIT 10`).all() as Repack[]
  const soldPacks = (id: number) => (db.prepare(`SELECT COUNT(DISTINCT pack_index) n FROM repack_cards WHERE repack_id = ? AND sold_at IS NOT NULL`).get(id) as { n: number }).n
  return {
    batches: batches.map((b) => ({
      ...b,
      card: cardName(b.chase_card_id),
      remaining: Math.max(0, b.pack_count - soldPacks(b.id)),
      margin: round2(b.price - b.cost_basis / b.pack_count),
      honest: b.published_odds >= b.actual_odds,
    })),
    history: history.map((b) => ({ ...b, card: cardName(b.chase_card_id) })),
    reputation: reputation(),
    terms: REPACK_TERMS,
  }
}
