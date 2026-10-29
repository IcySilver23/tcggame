// ---------------------------------------------------------------------------
// Incoming deliveries — the "ETA N days" on a listing is a promise, not
// flavor. Remote buys (NPC market listings, BidBay snipes) schedule a real
// arrival on the game-day clock: cash leaves at purchase, the card lands in
// the vault when the delivery window closes. In-person buys (shop floor,
// conventions, estate lots, yard sales) stay instant — you walk out with it.
// ---------------------------------------------------------------------------
import { db, nowIso, logActivity } from '../lib/db'
import { gameDayMs } from '../lib/gameday'
import * as vault from './vault'

export type IncomingRow = {
  id: number
  card_id: string
  variant: string
  condition: string
  quantity: number
  cost_basis: number
  via: string
  seller: string | null
  eta_days: number
  due_at: string
  purchased_at: string
}

db.exec(`CREATE TABLE IF NOT EXISTS incoming_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(id),
  variant TEXT NOT NULL DEFAULT 'normal',
  condition TEXT NOT NULL DEFAULT 'NM',
  quantity INTEGER NOT NULL DEFAULT 1,
  cost_basis REAL NOT NULL DEFAULT 0,
  via TEXT NOT NULL DEFAULT 'market',
  seller TEXT,
  eta_days INTEGER NOT NULL DEFAULT 1,
  due_at TEXT NOT NULL,
  purchased_at TEXT NOT NULL
)`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_incoming_due ON incoming_deliveries (due_at)`)

/** Schedule a parcel: due `etaDays` game-days from now. */
export function schedule(o: {
  cardId: string
  variant?: string
  condition?: string
  quantity?: number
  costBasis: number
  via: string
  seller?: string | null
  etaDays: number
}): void {
  const etaDays = Math.max(1, Math.round(o.etaDays))
  const due = new Date(Date.now() + etaDays * gameDayMs()).toISOString()
  db.prepare(
    `INSERT INTO incoming_deliveries (card_id, variant, condition, quantity, cost_basis, via, seller, eta_days, due_at, purchased_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(o.cardId, o.variant ?? 'normal', o.condition ?? 'NM', o.quantity ?? 1, o.costBasis, o.via, o.seller ?? null, etaDays, due, nowIso())
}

/** Everything still on the road, soonest first. */
export function pending(): IncomingRow[] {
  return db
    .prepare(
      `SELECT d.*, c.name, c.image_small, c.image_large
       FROM incoming_deliveries d JOIN cards c ON c.id = d.card_id
       ORDER BY d.due_at ASC`,
    )
    .all() as IncomingRow[]
}

/** Land every parcel whose window has closed. Returns how many arrived. */
export function deliverDue(): number {
  const due = db.prepare(`SELECT * FROM incoming_deliveries WHERE due_at <= ?`).all(nowIso()) as IncomingRow[]
  let n = 0
  for (const d of due) {
    // Storage: a full shelf holds the parcel on the doorstep until there's
    // room (or auto-scrap makes some) — retried on the next tick.
    const admit = vault.admitRawFor(d.quantity, 'Delivery')
    if (!admit.ok) continue
    db.prepare(
      `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
       VALUES (?, ?, ?, ?, 'collection', ?, ?, ?)`,
    ).run(d.card_id, d.variant, d.condition, d.quantity, d.via === 'ebay' ? 'market' : d.via, d.cost_basis, nowIso())
    db.prepare(`DELETE FROM incoming_deliveries WHERE id = ?`).run(d.id)
    n++
    const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(d.card_id) as { name: string }).name
    const channel = d.via === 'ebay' ? 'ebay' : 'buy'
    logActivity(
      channel,
      `📦 ${d.quantity > 1 ? `${d.quantity}× ` : ''}${name} arrived — ${d.seller ? `from ${d.seller}, ` : ''}${d.eta_days} game-day${d.eta_days === 1 ? '' : 's'} on the road.`,
      0,
    )
  }
  return n
}
