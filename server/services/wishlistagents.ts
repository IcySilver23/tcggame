import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayKey } from '../lib/gameday'
import { round2 } from './market'
import * as vault from './vault'
import * as deliveries from './deliveries'

// ---------------------------------------------------------------------------
// WISHLIST AGENTS — standing auto-buys for the grail hunt. Arm an agent on a
// wishlisted card with a per-card price cap and it sweeps the buy surfaces
// once per game-day: market feed listings and BidBay market lots, exact
// condition, at or under the cap. A global per-order cash cap bounds every
// buy, and a per-day budget bounds the whole sweep. The agent buys LISTED
// lots only — it will never pay distributor market price, because a standing
// order that buys at full market isn't a bargain, it's a impulse purchase
// with extra steps.
// ---------------------------------------------------------------------------

try { db.exec(`ALTER TABLE wishlist ADD COLUMN agent_enabled INTEGER NOT NULL DEFAULT 0`) } catch { /* exists */ }
try { db.exec(`ALTER TABLE wishlist ADD COLUMN agent_max_price REAL`) } catch { /* exists */ }
try { db.exec(`ALTER TABLE wishlist ADD COLUMN agent_condition TEXT NOT NULL DEFAULT 'NM'`) } catch { /* exists */ }

const CONDITIONS = ['NM', 'LP', 'MP'] as const
const DEFAULT_ORDER_CAP = 250

function cardName(cardId: string): string {
  return (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(cardId) as { name: string } | undefined)?.name ?? cardId
}

export function orderCap(): number {
  const v = Number(getMeta('agent:cashCap') ?? DEFAULT_ORDER_CAP)
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_ORDER_CAP
}

export function setOrderCap(cap: number): { ok: true; cap: number } | { ok: false; error: string } {
  if (!Number.isFinite(cap) || cap < 1) return { ok: false, error: 'Cap must be at least $1' }
  if (cap > 50_000) return { ok: false, error: 'Cap is capped at $50,000 — this is a standing order, not a whale harpoon' }
  setMeta('agent:cashCap', String(round2(cap)))
  logActivity('agent', `🤖 Agent per-order cash cap set to $${round2(cap).toFixed(2)}.`)
  return { ok: true, cap: round2(cap) }
}

export function setAgent(
  cardId: string,
  enabled: boolean,
  maxPrice: number | null,
  condition: string = 'NM',
): { ok: true; enabled: boolean; cap: number | null } | { ok: false; error: string } {
  const row = db.prepare(`SELECT target_price FROM wishlist WHERE card_id = ?`).get(cardId) as { target_price: number | null } | undefined
  if (!row) return { ok: false, error: 'Card is not on your wishlist' }
  if (enabled && maxPrice != null && (!Number.isFinite(maxPrice) || maxPrice < 0.5)) return { ok: false, error: 'Agent cap must be at least $0.50' }
  if (enabled && !CONDITIONS.includes(condition as (typeof CONDITIONS)[number])) return { ok: false, error: 'Condition must be NM, LP, or MP' }
  if (enabled && maxPrice == null && row.target_price == null) {
    return { ok: false, error: 'Set an agent cap (or a 🔔 price alert target) first — the agent needs a number to defend' }
  }
  db.prepare(`UPDATE wishlist SET agent_enabled = ?, agent_max_price = ?, agent_condition = ? WHERE card_id = ?`)
    .run(enabled ? 1 : 0, maxPrice, condition, cardId)
  if (enabled) {
    const cap = maxPrice ?? row.target_price!
    logActivity('agent', `🤖 AGENT ARMED: ${cardName(cardId)} — auto-buy ${condition} at ≤ $${cap.toFixed(2)} (per-order cap $${orderCap().toFixed(2)}). Sweeps the feeds once a game-day.`)
  } else {
    logActivity('agent', `🤖 Agent disarmed: ${cardName(cardId)}.`)
  }
  return { ok: true, enabled, cap: maxPrice ?? row.target_price ?? null }
}

type AgentRow = { card_id: string; agent_max_price: number | null; target_price: number | null; agent_condition: string; variant: string; name: string }

function armedAgents(): AgentRow[] {
  return db
    .prepare(
      `SELECT w.card_id, w.agent_max_price, w.target_price, w.agent_condition, w.variant, c.name
       FROM wishlist w JOIN cards c ON c.id = w.card_id
       WHERE w.agent_enabled = 1`,
    )
    .all() as AgentRow[]
}

type Buy = { cardId: string; name: string; surface: 'market' | 'bidbay'; paid: number; condition: string; seller: string; cap: number }

/** One agent sweep: cheapest qualifying lots first, bounded by the per-order
 * cap, the day's remaining cash, and one buy per agent per sweep. */
export function runAgents(): { ok: true; buys: Buy[]; budget: number; spent: number } {
  const agents = armedAgents()
  if (agents.length === 0) return { ok: true, buys: [], budget: 0, spent: 0 }
  let budget = orderCap()
  const buys: Buy[] = []
  const bought = new Set<string>()

  // Candidate pool: every live listing/lot matching an armed agent's card,
  // priced, filtered, then cheapest-first so the sweep is disciplined.
  type Cand = { agent: AgentRow; surface: 'market' | 'bidbay'; id: string | number; total: number; condition: string; seller: string; etaDays: number; variant: string }
  const cands: Cand[] = []
  for (const a of agents) {
    if (bought.has(a.card_id)) continue
    const cap = a.agent_max_price ?? a.target_price
    if (cap == null || cap <= 0) continue
    const ml = db
      .prepare(`SELECT id, price, shipping, condition, seller_name, eta_days FROM listings WHERE card_id = ? AND variant = ? AND condition = ? AND expires_at > ?`)
      .all(a.card_id, a.variant, a.agent_condition, nowIso()) as { id: string; price: number; shipping: number; condition: string; seller_name: string; eta_days: number }[]
    for (const l of ml) {
      const total = round2(l.price + l.shipping)
      if (total <= cap && total <= budget) cands.push({ agent: a, surface: 'market', id: l.id, total, condition: l.condition, seller: l.seller_name, etaDays: l.eta_days, variant: a.variant })
    }
    const el = db
      .prepare(`SELECT id, ask, condition, seller, variant FROM ebay_market WHERE card_id = ? AND quantity = 1 AND condition = ?`)
      .all(a.card_id, a.agent_condition) as { id: number; ask: number; condition: string; seller: string; variant: string }[]
    for (const l of el) {
      if (l.variant !== a.variant) continue
      if (l.ask <= cap && l.ask <= budget) cands.push({ agent: a, surface: 'bidbay', id: l.id, total: round2(l.ask), condition: l.condition, seller: l.seller, etaDays: 1 + (Math.random() < 0.4 ? 1 : 0), variant: l.variant })
    }
  }
  cands.sort((x, y) => x.total - y.total)

  for (const c of cands) {
    if (bought.has(c.agent.card_id) || c.total > budget) continue
    const cash = (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash
    if (cash < c.total) break
    // Storage & the vault: a full shelf refuses the delivery, same as a hand buy.
    const admit = vault.admitRawFor(1, 'Wishlist agent buy')
    if (!admit.ok) continue
    const ok = executeBuy(c)
    if (!ok) continue
    budget = round2(budget - c.total)
    bought.add(c.agent.card_id)
    buys.push({ cardId: c.agent.card_id, name: c.agent.name, surface: c.surface, paid: c.total, condition: c.condition, seller: c.seller, cap: c.agent.agent_max_price ?? c.agent.target_price ?? 0 })
    logActivity(
      'agent',
      `🤖 WISHLIST AGENT: bought ${c.agent.name} (${c.condition}) from ${c.seller} on ${c.surface === 'bidbay' ? 'BidBay' : 'the market feed'} for $${c.total.toFixed(2)} — cap $${(c.agent.agent_max_price ?? c.agent.target_price ?? 0).toFixed(2)}. Lands in ~${c.etaDays} game-day${c.etaDays === 1 ? '' : 's'}.`,
      -c.total,
    )
  }
  return { ok: true, buys, budget: orderCap(), spent: round2(buys.reduce((a, b) => a + b.paid, 0)) }

  function executeBuy(c: Cand): boolean {
    const tx = db.transaction(() => {
      if (c.surface === 'market') {
        const listing = db.prepare(`SELECT * FROM listings WHERE id = ?`).get(c.id) as { id: string; card_id: string; variant: string; condition: string; price: number; shipping: number; seller_name: string; eta_days: number } | undefined
        if (!listing) return false
        db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(c.total)
        db.prepare(`DELETE FROM listings WHERE id = ?`).run(listing.id)
        deliveries.schedule({ cardId: listing.card_id, variant: listing.variant, condition: listing.condition, costBasis: c.total, via: 'market', seller: listing.seller_name, etaDays: listing.eta_days })
      } else {
        const lot = db.prepare(`SELECT * FROM ebay_market WHERE id = ?`).get(c.id) as { id: number; card_id: string; variant: string; condition: string; ask: number; seller: string } | undefined
        if (!lot) return false
        db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(c.total)
        db.prepare(`DELETE FROM ebay_market WHERE id = ?`).run(lot.id)
        deliveries.schedule({ cardId: lot.card_id, variant: lot.variant, condition: lot.condition, costBasis: c.total, via: 'ebay', seller: lot.seller, etaDays: c.etaDays })
      }
      return true
    })
    return tx() as boolean
  }
}

/** Automatic sweep — once per game-day, on the market tick. */
export function wishlistAgentTick(): void {
  const day = gameDayKey()
  if (getMeta('agentsRan') === day) return
  if (armedAgents().length === 0) return
  setMeta('agentsRan', day)
  const r = runAgents()
  if (r.buys.length > 0) {
    logActivity('agent', `🤖 Overnight agent sweep: ${r.buys.length} buy${r.buys.length === 1 ? '' : 's'}, $${r.spent.toFixed(2)} spent (per-order cap $${r.budget.toFixed(2)}).`)
  }
}

/** Read model for the agents panel on the Wishlist view. */
export function section() {
  const rows = db
    .prepare(
      `SELECT w.card_id, w.agent_enabled, w.agent_max_price, w.agent_condition, w.target_price, c.name, c.image_small
       FROM wishlist w JOIN cards c ON c.id = w.card_id
       WHERE w.agent_enabled = 1
       ORDER BY w.added_at DESC`,
    )
    .all() as { card_id: string; agent_enabled: number; agent_max_price: number | null; agent_condition: string; target_price: number | null; name: string; image_small: string | null }[]
  return {
    orderCap: orderCap(),
    armed: rows.map((r) => ({
      cardId: r.card_id,
      name: r.name,
      image: r.image_small,
      cap: r.agent_max_price ?? r.target_price ?? 0,
      condition: r.agent_condition,
      needsTarget: r.agent_max_price == null && r.target_price == null,
    })),
    conditions: CONDITIONS,
  }
}
