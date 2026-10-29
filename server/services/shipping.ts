import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayMs } from '../lib/gameday'
import { round2 } from './market'
import { append as pnlAppend } from './pnl'

// ---------------------------------------------------------------------------
// SHIPPING & CONDITION DISPUTES (Phase 5 — realism)
//
// A BidBay sale isn't money until the envelope lands. Every sold order enters
// a TO-SHIP limbo where the seller decides three things, each with consequences:
//
//   • POSTAGE   — 📬 economy (cheap, slow, damage-prone, no tracking: disputes
//                 likelier) / 📦 standard / 🚚 priority (pricey, fast, tracked:
//                 disputes rarer)
//   • PACKING   — burn real supplies stock: penny sleeve, toploader, one-touch,
//                 and a bubble mailer per card. Ship it BARE to save stock and
//                 the buyer's corner test gets to decide your fate.
//   • PHOTOS    — take pack-out photos (free, instant). They are your EVIDENCE:
//                 a dispute with photos and a decent pack is decided in your
//                 favor; without them the refund is automatic.
//
// When the envelope lands, a small chance the buyer claims "it arrived
// damaged" (or economy parcels go "lost"). eBay-style: the buyer usually wins.
// A won dispute (photos + pack) costs a token fee; a lost one refunds the
// buyer the full order AND the card never comes back — the loss is total.
// ---------------------------------------------------------------------------

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export type ShipMethod = 'economy' | 'standard' | 'priority'

export const SHIP_METHODS: { id: ShipMethod; label: string; icon: string; base: number; pct: number; blurb: string }[] = [
  { id: 'economy', label: 'Economy', icon: '📬', base: 0.8, pct: 0.01, blurb: 'Cheapest, no tracking, ~2 game-days in transit. Damage claims ~3× likelier.' },
  { id: 'standard', label: 'Standard', icon: '📦', base: 1.5, pct: 0.025, blurb: 'The default envelope, ~1 game-day in transit. Tracked, insured up to $50.' },
  { id: 'priority', label: 'Priority', icon: '🚚', base: 3.5, pct: 0.04, blurb: 'Fastest — lands in about half a game-day. Tracked, insured, rigid.' },
]

export type PackLevel = 'bare' | 'sleeved' | 'toploaded' | 'museum'

/** What one order consumes from supplies stock (per card, +1 mailer per order). */
export const PACK_LEVELS: { id: PackLevel; label: string; icon: string; perCard: { kind: string; n: number }[]; blurb: string }[] = [
  { id: 'bare', label: 'Bare', icon: '🃏', perCard: [], blurb: 'Straight into an envelope. The buyer\'s corner test decides your fate.' },
  { id: 'sleeved', label: 'Sleeved', icon: '🀄', perCard: [{ kind: 'sleeve', n: 1 }], blurb: 'A penny sleeve per card — the minimum professional pack.' },
  { id: 'toploaded', label: 'Toploaded', icon: '🛡️', perCard: [{ kind: 'sleeve', n: 1 }, { kind: 'toploader', n: 1 }], blurb: 'Sleeve + rigid toploader per card. Survives most postal journeys.' },
  { id: 'museum', label: 'Museum', icon: '💎', perCard: [{ kind: 'sleeve', n: 1 }, { kind: 'one_touch', n: 1 }], blurb: 'One-touch per card + team bag. Overkill is its own kind of insurance.' },
]

export type ShipmentRow = {
  id: number
  kind: 'fixed' | 'auction'
  ref_id: number            // ebay_listings / ebay_auctions id
  card_id: string
  quantity: number
  gross: number
  fee: number
  postage: number           // charged at ship time (replaces the flat shipping est.)
  net: number               // paid out on success
  buyer: string
  method: ShipMethod | null
  pack: PackLevel | null
  photos: number            // 0/1 — pack-out photos taken
  status: string            // to_ship | in_transit | delivered | disputed | lost
  packed_at: string | null
  arrives_at: string | null
  resolved_at: string | null
  outcome: string | null    // clean | refund | won_dispute
  name?: string
  image_small?: string | null
}

// --- stock helpers (mirror supplies.ts but local to avoid cycles) -----------

function supplyQty(kind: string): number {
  const row = db.prepare('SELECT quantity FROM supplies WHERE kind = ?').get(kind) as { quantity: number } | undefined
  return row?.quantity ?? 0
}

function consumeSupply(kind: string, n: number) {
  db.prepare('UPDATE supplies SET quantity = quantity - ? WHERE kind = ?').run(n, kind)
}

/** Supplies needed to pack this order at the given level; null if short. */
export function packNeeds(qty: number, pack: PackLevel): { kind: string; n: number }[] {
  const lvl = PACK_LEVELS.find((p) => p.id === pack)
  if (!lvl || lvl.perCard.length === 0) return [{ kind: 'mailer', n: 1 }]
  const needs: { kind: string; n: number }[] = []
  for (const pc of lvl.perCard) needs.push({ kind: pc.kind, n: pc.n * qty })
  needs.push({ kind: 'mailer', n: 1 })
  return needs
}

export function canPack(qty: number, pack: PackLevel): { ok: boolean; missing?: string } {
  for (const need of packNeeds(qty, pack)) {
    if (supplyQty(need.kind) < need.n) return { ok: false, missing: need.kind }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Postage math — the charged postage replaces the old flat estimate on the
// listing; the difference books against overhead at ship time.
// ---------------------------------------------------------------------------

export function postageFor(method: ShipMethod, gross: number): number {
  const m = SHIP_METHODS.find((x) => x.id === method)
  return m ? round2(m.base + gross * m.pct) : round2(1 + gross * 0.04)
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

type SaleRef = { kind: 'fixed' | 'auction'; id: number }

/** Orders waiting on the seller to pack + ship. */
export function toShip(): (ShipmentRow & { est_postage: Record<ShipMethod, number> })[] {
  const rows = db.prepare(
    `SELECT sh.*, c.name, c.image_small FROM shipments sh
     JOIN cards c ON c.id = sh.card_id WHERE sh.status = 'to_ship' ORDER BY sh.id`,
  ).all() as ShipmentRow[]
  return rows.map((r) => ({
    ...r,
    est_postage: {
      economy: postageFor('economy', r.gross),
      standard: postageFor('standard', r.gross),
      priority: postageFor('priority', r.gross),
    },
  }))
}

export function inFlight(): ShipmentRow[] {
  return db.prepare(
    `SELECT sh.*, c.name, c.image_small FROM shipments sh
     JOIN cards c ON c.id = sh.card_id WHERE sh.status IN ('in_transit','disputed') ORDER BY sh.id DESC LIMIT 30`,
  ).all() as ShipmentRow[]
}

export function history(): ShipmentRow[] {
  return db.prepare(
    `SELECT sh.*, c.name, c.image_small FROM shipments sh
     JOIN cards c ON c.id = sh.card_id WHERE sh.status IN ('delivered','lost') ORDER BY sh.resolved_at DESC LIMIT 30`,
  ).all() as ShipmentRow[]
}

/** Legacy sold rows (from before shipments existed) still pay out on their
 *  own clocks via payOutShipped — shipments only take over NEW sales. */
export function ensureForSale(ref: SaleRef, cardId: string, qty: number, gross: number, fee: number, net: number, buyer: string) {
  const existing = db.prepare(`SELECT id FROM shipments WHERE kind = ? AND ref_id = ?`).get(ref.kind, ref.id) as { id: number } | undefined
  if (existing) return
  db.prepare(
    `INSERT INTO shipments (kind, ref_id, card_id, quantity, gross, fee, postage, net, buyer, method, pack, photos, status, arrives_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL, 0, 'to_ship', NULL)`,
  ).run(ref.kind, ref.id, cardId, qty, gross, fee, net, buyer)
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(cardId) as { name: string }).name
  logActivity('ebay', `📦 ${name} sold to ${buyer} — pack it and ship it (BidBay → To-ship).`, 0)
}

function shipmentByRef(ref: SaleRef): ShipmentRow | undefined {
  return db.prepare(`SELECT * FROM shipments WHERE kind = ? AND ref_id = ?`).get(ref.kind, ref.id) as ShipmentRow | undefined
}

/** Ship an order: choose postage, packing, photos. The card is already gone
 *  from the binder (sales leave at hammer/sale time) — this moves money state. */
export function ship(ref: SaleRef, method: ShipMethod, pack: PackLevel, photos: boolean): { ok: boolean; error?: string; postage?: number } {
  if (getMeta('tut:shipping') !== '1') setMeta('tut:shipping', '1')
  const sh = shipmentByRef(ref)
  if (!sh || sh.status !== 'to_ship') return { ok: false, error: 'That order is not waiting to ship' }
  const m = SHIP_METHODS.find((x) => x.id === method)
  if (!m) return { ok: false, error: 'Unknown postage method' }

  const needs = packNeeds(sh.quantity, pack)
  for (const need of needs) {
    if (supplyQty(need.kind) < need.n) {
      const label = need.kind === 'mailer' ? 'bubble mailers' : need.kind
      return { ok: false, error: `Not enough ${label} (need ${need.n}, have ${supplyQty(need.kind)}) — restock in Inventory 🛡 or ship bare` }
    }
  }

  const cash = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
  const postage = postageFor(method, sh.gross)
  if (cash < postage) return { ok: false, error: `Not enough cash for ${m.label} postage ($${postage.toFixed(2)})` }

  for (const need of needs) consumeSupply(need.kind, need.n)
  db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(postage)
  pnlAppend('overhead', -postage, `BidBay postage (${m.label})`)

  // Transit is quoted in game-days (see SHIP_METHODS blurb) — the pre-12h
  // clock hardcoded 25/45/80 seconds, so parcels "delivered" before the
  // buyer finished paying. Two game-days economy, one standard, half a
  // game-day priority.
  const transitMs = method === 'priority' ? gameDayMs() / 2 : method === 'standard' ? gameDayMs() : 2 * gameDayMs()
  const arrives = new Date(Date.now() + transitMs).toISOString()
  db.prepare(`UPDATE shipments SET method = ?, pack = ?, photos = ?, postage = ?, net = ?, status = 'in_transit', packed_at = ?, arrives_at = ? WHERE id = ?`)
    .run(method, pack, photos ? 1 : 0, postage, round2(sh.gross - sh.fee - postage), nowIso(), arrives, sh.id)

  // The listing's stored shipping/net becomes historical; the shipment is truth.
  db.prepare(ref.kind === 'fixed'
    ? `UPDATE ebay_listings SET shipping = ?, net = ?, ships_at = ? WHERE id = ?`
    : `UPDATE ebay_auctions SET shipping = ?, net = ?, ships_at = ? WHERE id = ?`)
    .run(postage, round2(sh.gross - sh.fee - postage), arrives, ref.id)

  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(sh.card_id) as { name: string }).name
  const packLabel = PACK_LEVELS.find((p) => p.id === pack)?.label ?? pack
  logActivity('ebay', `📮 ${name} shipped ${m.icon} ${m.label} · ${packLabel}${photos ? ' · 📷 pack-out photos' : ''} — postage $${postage.toFixed(2)} booked.`, -postage)
  return { ok: true, postage }
}

/** The arrival dice: delivered, disputed, or lost. Runs from the ebay tick. */
export function shipmentTick() {
  // Economy "lost in the mail": rare, but it happens when there's no tracking.
  const flying = db.prepare(`SELECT * FROM shipments WHERE status = 'in_transit' AND arrives_at <= ?`).all(nowIso()) as ShipmentRow[]
  for (const sh of flying) {
    const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(sh.card_id) as { name: string }).name
    if (sh.method === 'economy' && Math.random() < 0.04) {
      db.prepare(`UPDATE shipments SET status = 'lost', resolved_at = ? WHERE id = ?`).run(nowIso(), sh.id)
      db.prepare(`UPDATE ebay_listings SET paid = -1 WHERE id = ? AND paid = 0`).run(sh.ref_id)
      logActivity('ebay', `📬 LOST IN THE MAIL: ${name}'s economy parcel never arrived and there was no tracking. Refund due — the card is gone.`, 0)
      refundBuyer(sh, 'lost in mail (no tracking)')
      continue
    }
    // Damage dispute: base 2%, +14% bare, −8% photos, ± method. Packing counts:
    // bare cards rattle; slugged toploaders shrug off the sorting machine.
    let p = 0.02
    if (sh.pack === 'bare') p += 0.14
    else if (sh.pack === 'sleeved') p += 0.02
    else if (sh.pack === 'toploaded') p -= 0.005
    else if (sh.pack === 'museum') p -= 0.008
    if (sh.method === 'economy') p += 0.03
    else if (sh.method === 'priority') p -= 0.015
    if (!sh.photos) p += 0.08 // buyers dodge disputes when they know you have evidence… wait, reverse: WITHOUT photos the seller can't fight, so buyers try it more
    p = Math.max(0.01, p)

    if (Math.random() < p) {
      db.prepare(`UPDATE shipments SET status = 'disputed' WHERE id = ?`).run(sh.id)
      db.prepare(`UPDATE ebay_listings SET paid = -1 WHERE id = ? AND paid = 0`).run(sh.ref_id)
      db.prepare(`UPDATE ebay_auctions SET paid = -1 WHERE id = ? AND paid = 0`).run(sh.ref_id)
      const claim = sh.pack === 'bare'
        ? pick(['arrived bent in half', 'corner is crushed — was this even in a sleeve?', 'came loose in the envelope, scratched'])
        : pick(['bubble mailer looked fine but the card is dented', 'toploader was cracked on one corner', 'surface scuffs on the holo — not as described'])
      logActivity('ebay', `⚖️ DISPUTE: ${name} — ${sh.buyer} claims it ${claim}. ${sh.photos ? 'Your pack-out photos are attached.' : 'You have no pack-out photos.'} You have one tick to respond.`, 0)
    } else {
      db.prepare(`UPDATE shipments SET status = 'delivered', resolved_at = ? WHERE id = ?`).run(nowIso(), sh.id)
      payOut(sh)
      logActivity('ebay', `📬 Delivered: ${name} arrived safe. Payout $${sh.net.toFixed(2)} released.`, sh.net)
    }
  }
}

/** Resolve the dispute the player opened the panel for: present evidence. */
export function resolveDispute(ref: SaleRef): { ok: boolean; error?: string; outcome?: 'won' | 'lost'; message?: string } {
  const sh = shipmentByRef(ref)
  if (!sh || sh.status !== 'disputed') return { ok: false, error: 'No dispute pending on that order' }
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(sh.card_id) as { name: string }).name

  // Evidence score: photos matter most, then packing grade. Bare + no photos
  // is an automatic loss; toploaded + photos is near-certain win.
  let score = 0
  if (sh.photos) score += 2
  if (sh.pack === 'sleeved') score += 1
  if (sh.pack === 'toploaded') score += 2
  if (sh.pack === 'museum') score += 3
  if (sh.method === 'priority') score += 1

  const win = score >= 2
  if (win) {
    db.prepare(`UPDATE shipments SET status = 'delivered', outcome = 'won_dispute', resolved_at = ? WHERE id = ?`).run(nowIso(), sh.id)
    payOut(sh, 0.1) // eBay-style: the seller eats a 10% "goodwill" fee even when they win
    logActivity('ebay', `⚖️ Dispute WON: ${name} — the photos and pack proved the card shipped safe. Payout released minus a 10% goodwill fee.`, round2(sh.net * 0.9))
    return { ok: true, outcome: 'won', message: `Evidence held up (${sh.photos ? 'photos' : 'no photos'}, ${sh.pack} pack). Payout $${round2(sh.net * 0.9).toFixed(2)} after the goodwill fee.` }
  }
  refundBuyer(sh, 'damaged on arrival')
  db.prepare(`UPDATE shipments SET status = 'lost', outcome = 'refund', resolved_at = ? WHERE id = ?`).run(nowIso(), sh.id)
  logActivity('ebay', `⚖️ Dispute LOST: ${name} — ${sh.photos ? 'weak evidence' : 'no photos, no proof of packing'}. Full refund issued, and the card is NOT coming back.`, 0)
  return { ok: true, outcome: 'lost', message: `Refunded $${sh.net.toFixed(2)} — and the card is gone for good. ${sh.photos ? 'Photos were not enough.' : 'Take pack-out photos next time.'}` }
}

function payOut(sh: ShipmentRow, feePct = 0) {
  const net = round2(sh.net * (1 - feePct))
  db.prepare(`UPDATE shipments SET net = ? WHERE id = ?`).run(net, sh.id)
  db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(net)
  pnlAppend('overhead', -(sh.fee ?? 0), sh.kind === 'auction' ? 'BidBay auction fee' : 'BidBay seller fees')
  db.prepare(sh.kind === 'fixed'
    ? `UPDATE ebay_listings SET paid = 1 WHERE id = ?`
    : `UPDATE ebay_auctions SET paid = 1 WHERE id = ?`).run(sh.ref_id)
}

function refundBuyer(sh: ShipmentRow, reason: string) {
  // The buyer is made whole from the sale proceeds the seller already holds —
  // the full net claws back; fees and postage stay spent. The CARD is gone:
  // the buyer keeps it (eBay-side "keep it" refunds on INAD claims).
  const clawback = sh.net
  const cash = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
  if (cash < clawback) {
    logActivity('ebay', `⚠️ Cash went negative covering the refund — the credit line floats it.`, -clawback)
  }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(clawback)
  pnlAppend('overhead', -clawback, `BidBay refund (${reason})`)
  logActivity('ebay', `💸 Refunded ${sh.buyer} $${clawback.toFixed(2)} (${reason}).`, -clawback)
}

/** Feedback sting: lost disputes and losses hit the rating like an angry buyer. */
export function disputeFeedback(sh: ShipmentRow) {
  db.prepare(`INSERT INTO ebay_feedback (listing_id, buyer, stars, comment, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(sh.ref_id, sh.buyer, 1, 'Card arrived damaged — refund took days', nowIso())
}
