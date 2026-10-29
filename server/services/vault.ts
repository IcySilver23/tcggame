import { db, nowIso, getMeta, setMeta, logActivity } from '../lib/db'
import { round2, valueOf } from './market'

// ---------------------------------------------------------------------------
// STORAGE & THE VAULT — where the collection physically lives.
//
// Your bedroom shelf holds the first 100 cards for free. Past that, every
// acquisition path (packs, market buys, buylist shelves, storage hauls, trades,
// live shows, tournaments, estate lots, yard sales, break houses) refuses at
// the door: there's no room at the inn. Buy a locker at the facility, or scrap
// your junk to bulk. Raw cards and graded slabs are metered separately — slabs
// are boxed, insured, and awkward to stack, and the vault rider policy is the
// only way to hold more than a couple.
// ---------------------------------------------------------------------------

// The apartment shelf. Free, always there.
export const FREE_RAW = 100
// The two slabs on the dresser (the PSA 10 deserves the spot anyway).
export const FREE_SLAB = 2
// Past this fraction of capacity the meter runs hot and acquisitions warn.
export const HOT_AT = 0.75

// Locker tiers — monthly rent, cards each, size class. Billed weekly (the game
// week is the game's real rhythm), price shown as /mo with four weeks a month.
type Locker = { id: string; label: string; blurb: string; capacity: number; monthly: number }
const LOCKERS: Locker[] = [
  { id: 'small', label: 'Small locker', blurb: 'A 5×5 unit — binder overflow and longboxes.', capacity: 100, monthly: 15 },
  { id: 'medium', label: 'Medium locker', blurb: 'A 10×10 — the real collection starts here.', capacity: 250, monthly: 30 },
  { id: 'large', label: 'Large locker', blurb: 'A 10×20 with climate control. Dealer-grade storage.', capacity: 600, monthly: 55 },
]

// The vault rider — a paid policy for graded slabs, billed with the lockers.
const VAULT = { monthly: 12, capacity: 25 }

// What the scrap dealer pays per card's market value, cash on the spot. Lives
// here so the auto-scrap overflow policy and the storage-haul sort pay the
// same street rate.
export const BULK_RATE = 0.08

// --- Overflow policy --------------------------------------------------------
// What happens when an acquisition lands on a full shelf:
//   'refuse' — the delivery is refused, nothing changes (the safe default)
//   'scrap'  — the cheapest non-favorite bulk cards are sold to the scrap
//              dealer at BULK_RATE until the delivery fits

export type OverflowPolicy = 'refuse' | 'scrap'
const POLICY_KEY = 'storage:overflowPolicy'

export function getOverflowPolicy(): OverflowPolicy {
  return getMeta(POLICY_KEY) === 'scrap' ? 'scrap' : 'refuse'
}

export function setOverflowPolicy(p: string): { ok: true; policy: OverflowPolicy } | { ok: false; error: string } {
  if (p !== 'refuse' && p !== 'scrap') return { ok: false, error: 'Unknown overflow policy' }
  setMeta(POLICY_KEY, p)
  logActivity(
    'storage',
    p === 'scrap'
      ? `Overflow policy: auto-scrap — when the shelf is full, your cheapest bulk cards sell to the scrap dealer (${Math.round(BULK_RATE * 100)}¢ on the dollar) to make room. Favorites are always spared${getScrapFloor() > 0 ? `, and nothing worth more than ${fmtMoney(getScrapFloor())} is touched` : ''}.`
      : 'Overflow policy: refuse — when the shelf is full, deliveries are refused at the door and nothing you own is touched.',
    0,
  )
  return { ok: true, policy: p as OverflowPolicy }
}

// --- Scrap floor ------------------------------------------------------------
// A per-card market-value floor: cards worth more than this are collector
// cardboard, not filler — auto-scrap will never sell them, even to fit a buy.
// 0 = no floor (any spare is fair game).

const FLOOR_KEY = 'storage:scrapFloor'

export function getScrapFloor(): number {
  const raw = Number(getMeta(FLOOR_KEY) ?? 0)
  return Number.isFinite(raw) && raw > 0 ? round2(raw) : 0
}

export function setScrapFloor(value: number): { ok: true; floor: number } | { ok: false; error: string } {
  const v = Number(value)
  if (!Number.isFinite(v) || v < 0) return { ok: false, error: 'Floor must be a dollar amount (0 = no floor)' }
  const floor = round2(Math.min(v, 1000))
  setMeta(FLOOR_KEY, String(floor))
  logActivity(
    'storage',
    floor > 0
      ? `Scrap floor set: auto-scrap will never sell cards worth more than ${fmtMoney(floor)} — they're collector cardboard, not filler.`
      : 'Scrap floor cleared — auto-scrap can sell any spare again.',
    0,
  )
  return { ok: true, floor }
}

/** Surfaces that honor the overflow policy (exact-count player buys). */
export const OVERFLOW_SURFACES = [
  { id: 'market', label: 'Market buys' },
  { id: 'buylist', label: 'Shop shelves' },
  { id: 'local', label: 'Local deals' },
  { id: 'trade', label: 'Trades' },
]

const RENT_KEY = 'vault:rentChargedAt'

// --- Migrations (existing saves predate these tables) -----------------------

try {
  db.exec(`CREATE TABLE IF NOT EXISTS storage_rentals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'locker',   -- locker | vault
    tier TEXT,                             -- small | medium | large (lockers)
    monthly REAL NOT NULL,
    capacity INTEGER NOT NULL,
    rented_at TEXT NOT NULL,
    next_bill_at TEXT NOT NULL
  )`)
} catch { /* exists */ }
try {
  db.exec(`CREATE TABLE IF NOT EXISTS vault_policy (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    active INTEGER NOT NULL DEFAULT 1,
    monthly REAL NOT NULL,
    capacity INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    next_bill_at TEXT NOT NULL
  )`)
} catch { /* exists */ }

function lockerInfo(id: string): Locker { return LOCKERS.find((l) => l.id === id) ?? LOCKERS[0] }

// --- Capacity math ----------------------------------------------------------

/** Count of raw (unslabbed) cards you own, across all live statuses. */
export function rawOwned(): number {
  return (db.prepare(
    `SELECT COALESCE(SUM(quantity),0) AS n FROM inventory WHERE graded_grade IS NULL AND status IN ('collection','grading','listed')`,
  ).get() as { n: number }).n
}

/** Count of graded slabs you own, across all live statuses. */
export function slabOwned(): number {
  return (db.prepare(
    `SELECT COALESCE(SUM(quantity),0) AS n FROM inventory WHERE graded_grade IS NOT NULL AND status IN ('collection','grading','listed')`,
  ).get() as { n: number }).n
}

/** Raw cards that can still be admitted right now. */
export function freeRawSpace(): number {
  const lockers = (db.prepare(`SELECT COALESCE(SUM(capacity),0) AS n FROM storage_rentals WHERE kind = 'locker'`).get() as { n: number }).n
  return Math.max(0, lockers + FREE_RAW - rawOwned())
}

function freeSlabSpace(): number {
  const pol = db.prepare(`SELECT COALESCE(capacity,0) AS n FROM vault_policy WHERE id = 1 AND active = 1`).get() as { n: number } | undefined
  return Math.max(0, FREE_SLAB + (pol?.n ?? 0) - slabOwned())
}

/** Slabs from a haul that can't be admitted (no vault, no free-slab space). */
export function slabOverflow(count: number): number {
  return Math.max(0, count - freeSlabSpace())
}

/** Is the vault rider live? While it is, up to its capacity of slabs sleep
 * off-site — the insurance/disaster system treats those as untouchable at
 * home. Slabs beyond the slots are the overflow that still sleeps at home. */
export function vaultActive(): boolean {
  const pol = db.prepare(`SELECT active FROM vault_policy WHERE id = 1`).get() as { active: number } | undefined
  return !!pol?.active
}

/** How many slabs the active vault rider can shield right now. */
export function vaultProtectedSlots(): number {
  if (!vaultActive()) return 0
  const pol = db.prepare(`SELECT capacity FROM vault_policy WHERE id = 1`).get() as { capacity: number } | undefined
  return Math.min(pol?.capacity ?? 0, slabOwned())
}

/** Slabs sleeping at home: none while the rider covers them all, the overflow
 * when the vault is full, and every slab when there's no rider at all. */
export function homeSlabs(): number {
  return Math.max(0, slabOwned() - vaultProtectedSlots())
}

// Insurance passes this through: each locker is another door to watch, so the
// shop's weekly premium draft carries a small storage surcharge per locker.
export const LOCKER_SURCHARGE_WEEKLY = 0.75

export function lockerSurchargeWeekly(): number {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM storage_rentals WHERE kind = 'locker'`).get() as { n: number }).n
  return round2(LOCKER_SURCHARGE_WEEKLY * n)
}

export type Capacity = {
  rawOwned: number
  slabOwned: number
  rawCapacity: number
  slabCapacity: number
  rawFree: number
  slabFree: number
  rawPct: number
  slabPct: number
  hot: boolean
  full: boolean
  lockers: { id: number; tier: string; label: string; capacity: number; monthly: number; rentedAt: string; nextBillAt: string }[]
  vault: { active: boolean; capacity: number; monthly: number; startedAt: string; nextBillAt: string } | null
  monthlyTotal: number
  tiers: { id: string; label: string; blurb: string; capacity: number; monthly: number }[]
  overflowPolicy: 'refuse' | 'scrap'
  bulkRate: number
  overflowSurfaces: { id: string; label: string }[]
  scrapFloor: number
}

export function capacity(): Capacity {
  const rows = db.prepare(`SELECT * FROM storage_rentals WHERE kind = 'locker' ORDER BY id`).all() as {
    id: number; tier: string | null; capacity: number; monthly: number; rented_at: string; next_bill_at: string
  }[]
  const rawCapacity = rows.reduce((a, l) => a + l.capacity, 0) + FREE_RAW
  const pol = db.prepare(`SELECT * FROM vault_policy WHERE id = 1`).get() as
    { active: number; capacity: number; monthly: number; started_at: string; next_bill_at: string } | undefined
  const slabCapacity = FREE_SLAB + (pol?.active ? pol.capacity : 0)
  const ro = rawOwned()
  const so = slabOwned()
  const rawPct = rawCapacity > 0 ? ro / rawCapacity : 1
  return {
    rawOwned: ro,
    slabOwned: so,
    rawCapacity,
    slabCapacity,
    rawFree: Math.max(0, rawCapacity - ro),
    slabFree: Math.max(0, slabCapacity - so),
    rawPct: Math.min(1, rawPct),
    slabPct: Math.min(1, slabCapacity > 0 ? so / slabCapacity : 1),
    hot: rawPct >= HOT_AT,
    full: ro >= rawCapacity,
    lockers: rows.map((l) => ({
      id: l.id,
      tier: l.tier ?? 'small',
      label: lockerInfo(l.tier ?? 'small').label,
      capacity: l.capacity,
      monthly: l.monthly,
      rentedAt: l.rented_at,
      nextBillAt: l.next_bill_at,
    })),
    vault: pol?.active
      ? { active: true, capacity: pol.capacity, monthly: pol.monthly, startedAt: pol.started_at, nextBillAt: pol.next_bill_at }
      : null,
    monthlyTotal: round2(rows.reduce((a, l) => a + l.monthly, 0) + (pol?.active ? pol.monthly : 0)),
    tiers: LOCKERS.map((l) => ({ id: l.id, label: l.label, blurb: l.blurb, capacity: l.capacity, monthly: l.monthly })),
    overflowPolicy: getOverflowPolicy(),
    bulkRate: BULK_RATE,
    overflowSurfaces: OVERFLOW_SURFACES,
    scrapFloor: getScrapFloor(),
  }
}

// --- Admission --------------------------------------------------------------

export type Admission = { ok: true } | { ok: false; error: string; needLockers?: number; needVault?: boolean }

/** Pre-check a raw-card acquisition — call before cash moves or rows insert. */
export function admitRaw(count: number, what: string): Admission {
  const free = freeRawSpace()
  if (free >= count) return { ok: true }
  const cap = capacity()
  const need = count - free
  const cheapest = LOCKERS[0]
  const needLockers = Math.ceil(need / cheapest.capacity)
  const advice = cap.lockers.length === 0
    ? `Rent a ${cheapest.label.toLowerCase()} (+${cheapest.capacity} cards, $${cheapest.monthly}/mo) or scrap your junk to bulk.`
    : 'Rent another locker or scrap your junk to bulk.'
  return {
    ok: false,
    error: `${what}: no room on the shelf — ${cap.rawOwned}/${cap.rawCapacity} cards stored. ${advice}`,
    needLockers,
  }
}

/** Pre-check a slab acquisition (graded returns, vault-side buys). */
export function admitSlab(count: number, what: string): Admission {
  if (freeSlabSpace() >= count) return { ok: true }
  return {
    ok: false,
    error: `${what}: nowhere to put ${count > 1 ? `${count} graded slabs` : 'that graded slab'} — slabs don't stack. Get the vault rider ($${VAULT.monthly}/mo for ${VAULT.capacity} slab slots) or move one out.`,
    needVault: true,
  }
}

/**
 * Mixed haul (storage units, estate lots, resale deals): admit as much raw as
 * fits and let the caller scrap/leave the rest. Slabs in a haul don't pass raw
 * checks (they're metered separately) — the caller leaves them in the pile.
 */
export function admitMixed(rawCount: number, slabCount: number, what: string): { rawAdmitted: number; warning?: string } {
  const rawAdmitted = Math.min(rawCount, freeRawSpace())
  let warning: string | undefined
  const cap = capacity()
  if (rawAdmitted < rawCount) {
    const left = rawCount - rawAdmitted
    warning = cap.lockers.length === 0
      ? `${what}: only ${rawAdmitted} of ${rawCount} cards fit on the shelf — the rest stay in the haul pile for the scrap dealer.`
      : `${what}: only ${rawAdmitted} of ${rawCount} cards fit — ${left} left on the table. Rent a bigger locker next time.`
  }
  const slabLeft = slabOverflow(slabCount)
  if (slabCount > 0 && slabLeft > 0) {
    warning = `${warning ? warning + ' ' : ''}${slabLeft} slab${slabLeft === 1 ? '' : 's'} and no vault space — graded cards don't stack, so they stay in the pile.`
  }
  return { rawAdmitted, warning }
}

/**
 * Keep-hook for haul sorts (storage.ts): re-check inside the transaction.
 * Returns how many of the planned keeps actually fit; the caller scraps the
 * rest at bulk rates.
 */
export function trimToCapacity(plannedKeeps: number): number {
  return Math.min(plannedKeeps, freeRawSpace())
}

// --- Auto-scrap engine ------------------------------------------------------

export type ScrapRow = { id: number; name: string; condition: string; value: number; cash: number }

/**
 * The auto-scrap pool: your cheapest non-favorite bulk. Only true spares —
 * status 'collection', never favorited, never a binder pocket, bulk box,
 * grab bag, shop case, or franchise shelf row — and never above the floor.
 */
function scrapPool(): { id: number; card_id: string; condition: string; quantity: number; name: string; market: number }[] {
  const floor = getScrapFloor()
  return db.prepare(
    `SELECT i.id, i.card_id, i.condition, i.quantity, c.name,
            (SELECT market FROM price_records p WHERE p.card_id = i.card_id AND p.kind = 'tcgplayer' AND p.market IS NOT NULL ORDER BY p.retrieved_at DESC LIMIT 1) AS market
     FROM inventory i JOIN cards c ON c.id = i.card_id
     WHERE i.status = 'collection' AND i.favorite = 0 AND i.quantity > 0
       AND i.graded_grade IS NULL
       AND (? = 0 OR (SELECT COALESCE(market, 0) FROM price_records p WHERE p.card_id = i.card_id AND p.kind = 'tcgplayer' AND p.market IS NOT NULL ORDER BY p.retrieved_at DESC LIMIT 1) <= ?)
       AND NOT EXISTS (SELECT 1 FROM binder_slots b WHERE b.inventory_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM bulk_box_cards bb WHERE bb.inventory_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM grab_bag_cards g WHERE g.inventory_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM shop_case_cards sc WHERE sc.inventory_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM franchise_shelf_cards fs WHERE fs.inventory_id = i.id)
     ORDER BY (SELECT market FROM price_records p WHERE p.card_id = i.card_id AND p.kind = 'tcgplayer' AND p.market IS NOT NULL ORDER BY p.retrieved_at DESC LIMIT 1) * quantity ASC
     LIMIT 60`,
  ).all(floor, floor) as { id: number; card_id: string; condition: string; quantity: number; name: string; market: number }[]
}

/**
 * Sell n slots' worth of your cheapest non-favorite bulk to the scrap dealer.
 * Only true spares are touched: status 'collection', never favorited, never a
 * binder pocket, consignment, bulk box, grab bag, case, or shelf row.
 */
export function scrapForRoom(n: number): { rows: ScrapRow[]; cash: number; stillShort: number } {
  const rows = scrapPool()

  let need = n
  const sold: ScrapRow[] = []
  let cash = 0
  for (const r of rows) {
    if (need <= 0) break
    const take = Math.min(r.quantity, need)
    const unit = valueOf(r.card_id, 'normal', (r.condition as 'NM') || 'NM') * BULK_RATE
    cash += unit * take
    sold.push({ id: r.id, name: r.name, condition: r.condition, value: round2(unit), cash: round2(unit * take) })
    if (take >= r.quantity) db.prepare(`DELETE FROM inventory WHERE id = ?`).run(r.id)
    else db.prepare(`UPDATE inventory SET quantity = quantity - ? WHERE id = ?`).run(take, r.id)
    need -= take
  }
  cash = round2(cash)
  if (cash > 0) {
    db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(cash)
    logActivity('storage', `Auto-scrap: sold ${n - need} bulk card${n - need === 1 ? '' : 's'} to the scrap dealer for ${fmtMoney(cash)} to make room.`, cash)
  }
  return { rows: sold, cash, stillShort: Math.max(0, need) }
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`
}

/** Does the policy call for auto-scrapping? */
export function autoScrapEnabled(): boolean {
  return getOverflowPolicy() === 'scrap'
}

export type OverflowPreview = {
  needed: number
  wouldScrap: number
  available: number
  estimateLow: number
  estimateHigh: number
  blockedByFloor: boolean
  scrapFloor: number
  label: string | null
}

/**
 * Peek what an n-card buy would have to scrap — without selling anything.
 * The pre-flight hint on buy buttons: "scraps 3 cards (~$0.42)". When the
 * floor blocks the pile, the label says the buy will be refused instead.
 */
export function overflowPreview(count: number): OverflowPreview {
  const free = freeRawSpace()
  const needed = Math.max(0, count - free)
  const floor = getScrapFloor()
  if (needed <= 0 || !autoScrapEnabled()) {
    return { needed: 0, wouldScrap: 0, available: 0, estimateLow: 0, estimateHigh: 0, blockedByFloor: false, scrapFloor: floor, label: null }
  }
  const pool = scrapPool()
  let slots = 0
  let cash = 0
  for (const r of pool) {
    if (slots >= needed) break
    const take = Math.min(r.quantity, needed - slots)
    cash += valueOf(r.card_id, 'normal', (r.condition as 'NM') || 'NM') * BULK_RATE * take
    slots += take
  }
  const blocked = slots < needed
  const lo = round2(cash * 0.85)
  const hi = round2(cash * 1.15)
  return {
    needed,
    wouldScrap: Math.min(slots, needed),
    available: slots + Math.max(0, free),
    estimateLow: lo,
    estimateHigh: hi,
    blockedByFloor: blocked,
    scrapFloor: floor,
    label: blocked
      ? `⚠️ the $${floor > 0 ? floor.toFixed(0) : '0'} floor blocks this buy — nothing scrapable left at that line`
      : `♻️ this buy scraps ${needed} spare card${needed === 1 ? '' : 's'} (~${fmtMoney(lo)}${hi > lo ? `–${fmtMoney(hi)}` : ''})`,
  }
}

/**
 * Exact-count buys (market, shop shelves, local deals, single-card trades).
 * Honors the overflow policy: 'refuse' errors, 'scrap' sells bulk for room
 * and proceeds. Call AFTER the cash check, BEFORE any rows are touched.
 */
export function admitRawFor(count: number, what: string): Admission {
  if (freeRawSpace() >= count) return { ok: true }
  if (!autoScrapEnabled()) return admitRaw(count, what)
  const short = count - freeRawSpace()
  const r = scrapForRoom(short)
  if (r.stillShort > 0) {
    return {
      ok: false,
      error: `${what}: not even the scrap pile could make room — only favorites and spoken-for cards left. ${capacity().rawOwned}/${capacity().rawCapacity} stored.`,
    }
  }
  return { ok: true }
}

/**
 * Multi-count buys (pack rips, lots, hauls). Makes room under the policy and
 * returns how many of count can be admitted (always == count on success).
 */
export function makeRoomFor(count: number, what: string): number {
  const free = freeRawSpace()
  if (free >= count) return count
  if (!autoScrapEnabled()) return free
  const short = count - free
  scrapForRoom(short)
  return freeRawSpace() >= count ? count : freeRawSpace()
}

// --- Money ------------------------------------------------------------------

export function rentLocker(tier: string): { ok: true; id: number; monthly: number } | { ok: false; error: string } {
  const l = LOCKERS.find((x) => x.id === tier)
  if (!l) return { ok: false, error: 'Unknown locker size' }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < l.monthly) return { ok: false, error: `First month is $${l.monthly.toFixed(2)} — not enough cash` }
  const id = db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(l.monthly)
    const r = db.prepare(`INSERT INTO storage_rentals (kind, tier, monthly, capacity, rented_at, next_bill_at) VALUES ('locker', ?, ?, ?, ?, ?)`)
      .run(l.id, l.monthly, l.capacity, nowIso(), new Date(Date.now() + 7 * 86_400_000).toISOString())
    pnlAppend(-l.monthly, 'Storage rental')
    logActivity('storage', `Rented a ${l.label.toLowerCase()} — ${l.capacity} more cards on the racks. $${l.monthly.toFixed(2)}/mo, first month paid.`, -l.monthly)
    return r.lastInsertRowid as number
  })()
  return { ok: true, id, monthly: l.monthly }
}

export function closeLocker(rentalId: number): { ok: true } | { ok: false; error: string } {
  const r = db.prepare(`SELECT * FROM storage_rentals WHERE id = ? AND kind = 'locker'`).get(rentalId) as
    { id: number; tier: string | null; capacity: number } | undefined
  if (!r) return { ok: false, error: 'No such locker' }
  const cap = capacity()
  const excess = cap.rawOwned - (cap.rawCapacity - r.capacity)
  if (excess > 0) {
    return { ok: false, error: `The unit isn't empty — ${excess} card${excess === 1 ? '' : 's'} would be on the curb. Sell or scrap first.` }
  }
  db.prepare(`DELETE FROM storage_rentals WHERE id = ?`).run(rentalId)
  logActivity('storage', `Turned in the ${lockerInfo(r.tier ?? 'small').label.toLowerCase()} — key back, one less bill.`, 0)
  return { ok: true }
}

export function subscribeVault(): { ok: true; monthly: number } | { ok: false; error: string } {
  const pol = db.prepare(`SELECT * FROM vault_policy WHERE id = 1`).get() as { active: number } | undefined
  if (pol?.active) return { ok: false, error: 'Vault rider already active' }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < VAULT.monthly) return { ok: false, error: `First month is $${VAULT.monthly.toFixed(2)} — not enough cash` }
  db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(VAULT.monthly)
    db.prepare(
      `INSERT INTO vault_policy (id, active, monthly, capacity, started_at, next_bill_at) VALUES (1, 1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET active = 1, monthly = excluded.monthly, capacity = excluded.capacity,
         started_at = excluded.started_at, next_bill_at = excluded.next_bill_at`,
    ).run(VAULT.monthly, VAULT.capacity, nowIso(), new Date(Date.now() + 7 * 86_400_000).toISOString())
    pnlAppend(-VAULT.monthly, 'Vault rider')
    logActivity('storage', `Vault rider active — ${VAULT.capacity} slab slots under camera and glass. $${VAULT.monthly.toFixed(2)}/mo.`, -VAULT.monthly)
  })()
  return { ok: true, monthly: VAULT.monthly }
}

export function cancelVault(): { ok: true } | { ok: false; error: string } {
  const pol = db.prepare(`SELECT * FROM vault_policy WHERE id = 1`).get() as { active: number } | undefined
  if (!pol?.active) return { ok: false, error: 'No vault rider to cancel' }
  const excess = slabOwned() - FREE_SLAB
  if (excess > 0) {
    return { ok: false, error: `The vault isn't empty — ${excess} slab${excess === 1 ? '' : 's'} beyond the free dresser spots. Sell or trade them first.` }
  }
  db.prepare(`UPDATE vault_policy SET active = 0 WHERE id = 1`).run()
  logActivity('storage', 'Vault rider cancelled — the slabs come home to the dresser.', 0)
  return { ok: true }
}

// --- Billing ----------------------------------------------------------------

/** Weekly rent run: one pass for lockers, one for the vault. */
export function vaultTick(): void {
  try {
    billLockers()
    billVault()
  } catch (e) {
    console.error('[vault] tick failed:', e)
  }
}

function weekDue(nextBillAt: string): boolean {
  return new Date(nextBillAt).getTime() <= Date.now()
}

function billLockers(): void {
  const rows = db.prepare(`SELECT id, monthly, next_bill_at FROM storage_rentals WHERE kind = 'locker'`).all() as
    { id: number; monthly: number; next_bill_at: string }[]
  setMeta(RENT_KEY, '0')
  if (rows.length === 0) return
  const owed = round2(rows.reduce((a, r) => a + r.monthly, 0))
  if (!rows.some((r) => weekDue(r.next_bill_at))) return
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < owed) {
    logActivity('storage', `Storage rent due: $${owed.toFixed(2)} and the account is short. The facility gives you grace — pay up or lose the space.`, 0)
    setMeta(RENT_KEY, '1')
    return
  }
  db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(owed)
    for (const r of rows) {
      db.prepare(`UPDATE storage_rentals SET next_bill_at = ? WHERE id = ?`).run(new Date(Date.now() + 7 * 86_400_000).toISOString(), r.id)
    }
    pnlAppend(-owed, 'Storage rent')
  })()
  logActivity('storage', `Storage rent drafted: $${owed.toFixed(2)}/week for ${rows.length} locker${rows.length === 1 ? '' : 's'}.`, -owed)
}

function billVault(): void {
  const pol = db.prepare(`SELECT * FROM vault_policy WHERE id = 1`).get() as
    { active: number; monthly: number; next_bill_at: string } | undefined
  if (!pol?.active) return
  if (!weekDue(pol.next_bill_at)) return
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < pol.monthly) {
    logActivity('storage', 'Vault invoice unpaid — the facility holds your slabs, but the grace clock is ticking.', 0)
    return
  }
  db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(round2(pol.monthly))
    db.prepare(`UPDATE vault_policy SET next_bill_at = ? WHERE id = 1`).run(new Date(Date.now() + 7 * 86_400_000).toISOString())
    pnlAppend(-pol.monthly, 'Vault rider')
  })()
  logActivity('storage', `Vault rider billed: $${pol.monthly.toFixed(2)} — slabs stay under glass.`, -round2(pol.monthly))
}

// --- P&L --------------------------------------------------------------------

function pnlAppend(delta: number, label: string): void {
  import('./pnl').then((p) => p.append('cases', delta, label)).catch(() => {})
}
