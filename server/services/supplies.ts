import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { round2 } from './market'
import { append as pnlAppend } from './pnl'

// ---------------------------------------------------------------------------
// Supplies & condition wear (Phase 5)
//
// Cards are physical objects: left bare in a drawer, they wear. Protection
// costs money and must be applied deliberately:
//   • penny sleeve  — $0.05 · stops wear (a sleeved card holds its grade)
//   • toploader     — $0.25 · stops wear and shields cards already below NM
//   • one-touch     — $1.00 · museum grade; also stops wear, for the shelf kings
//
// Rules of the world:
//   • Only RAW, unprotected cards wear — listed/cased/at-table stock is
//     "out of the drawer" and safe, graded slabs are sealed forever.
//   • Wear rolls per game-day on each bare card: small chance of dropping one
//     condition step (NM → LP → MP → HP → DM, floored at DM). Real money is
//     on the line: NM is 100% of market, LP 80%, MP 65%, HP 50%, DM 35%.
//   • Value protects itself: cheap cards are handled carelessly, grails get
//     respect. The wear roll scales DOWN with card value.
//   • Bulk is exempt: junk cards (sold by the handful in dollar bins) don't
//     track per-card wear — the sim would burn CPU for pocket change.
//   • The shop's buyer staff sources cards already sleeved (professionals).
// ---------------------------------------------------------------------------

type SupplyKind = 'sleeve' | 'toploader' | 'one_touch' | 'mailer'

type SupplyDef = {
  kind: SupplyKind
  label: string
  icon: string
  unitCost: number
  packSize: number
  blurb: string
  /** Minimum card value at which this protection is worth considering (UI hint). */
  worthItAbove: number
}

export const SUPPLIES: SupplyDef[] = [
  { kind: 'sleeve', label: 'Penny sleeves', icon: '🀄', unitCost: 0.05, packSize: 100, worthItAbove: 1, blurb: 'A cent apiece and wear stops. The default move for anything you intend to keep.' },
  { kind: 'toploader', label: 'Toploaders', icon: '🛡️', unitCost: 0.25, packSize: 25, worthItAbove: 10, blurb: 'Rigid protection for cards you handle often — and the only thing that saves a card already below NM.' },
  { kind: 'one_touch', label: 'One-touches', icon: '💎', unitCost: 1.0, packSize: 10, worthItAbove: 100, blurb: 'Museum-grade magnetic holder. For the shelf kings you never plan to touch again.' },
  { kind: 'mailer', label: 'Bubble mailers', icon: '📬', unitCost: 0.4, packSize: 20, worthItAbove: 0, blurb: 'Padded envelopes — every BidBay order ships in one. Buy before you sell.' },
]

const PROTECTIONS: SupplyKind[] = ['sleeve', 'toploader', 'one_touch']

const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DM'] as const
type Condition = (typeof CONDITIONS)[number]

export function isProtection(kind: string): kind is SupplyKind {
  return (PROTECTIONS as string[]).includes(kind)
}

function qty(kind: SupplyKind): number {
  const row = db.prepare('SELECT quantity FROM supplies WHERE kind = ?').get(kind) as { quantity: number } | undefined
  return row?.quantity ?? 0
}

function consume(kind: SupplyKind, n = 1) {
  db.prepare('UPDATE supplies SET quantity = quantity - ? WHERE kind = ?').run(n, kind)
}

function refundStock(kind: SupplyKind, n = 1) {
  db.prepare(`INSERT INTO supplies (kind, quantity) VALUES (?, ?) ON CONFLICT(kind) DO UPDATE SET quantity = quantity + ?`).run(kind, n, n)
}

export function stockLevels() {
  return SUPPLIES.map((s) => ({ ...s, quantity: qty(s.kind) }))
}

// ---------------------------------------------------------------------------
// Buying — supplies are cash down and an overhead line in the books.
// ---------------------------------------------------------------------------

export function buy(kind: string, packs = 1): { ok: boolean; error?: string; spent?: number; got?: number } {
  const def = SUPPLIES.find((s) => s.kind === kind)
  if (!def) return { ok: false, error: 'Unknown supply' }
  const n = Math.max(1, Math.min(Math.floor(packs), 50))
  const cost = round2(def.unitCost * def.packSize * n)
  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < cost) return { ok: false, error: `Not enough cash — ${n} × ${def.label} (${def.packSize}/pack) costs $${cost.toFixed(2)}` }
  db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(cost)
  refundStock(def.kind, def.packSize * n)
  pnlAppend('overhead', -cost, `${def.label} ×${n} pack${n === 1 ? '' : 's'}`)
  logActivity('supplies', `Bought ${def.packSize * n} ${def.label.toLowerCase()} for $${cost.toFixed(2)} — bare cards don't protect themselves.`, -cost)
  return { ok: true, spent: cost, got: def.packSize * n }
}

// ---------------------------------------------------------------------------
// Applying protection — one unit per inventory ROW (a stack shares a sleeve
// the way a set-builder's dupes live together in one penny sleeve).
// ---------------------------------------------------------------------------

const RAW_STATUSES = `('collection','grading')`

export function protect(inventoryId: number, kind: string): { ok: boolean; error?: string; protected?: boolean } {
  const row = db.prepare(
    `SELECT i.id, i.card_id, c.name, i.condition, i.graded_grade, i.status, i.protection
     FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ?`,
  ).get(inventoryId) as
    | { id: number; card_id: string; name: string; condition: string; graded_grade: string | null; status: string; protection: string | null }
    | undefined
  if (!row) return { ok: false, error: 'Card not found' }
  if (row.graded_grade) return { ok: false, error: 'Graded slabs are sealed — no protection needed' }
  if (row.status === 'sold') return { ok: false, error: 'That card is gone' }
  if (!isProtection(kind)) return { ok: false, error: 'Unknown protection' }
  const pk = kind as SupplyKind
  if (row.protection === pk) return { ok: false, error: `Already in a ${labelOf(pk)}` }
  // Upgrades are allowed (sleeve → toploader); the old unit goes back in stock
  // to reuse. Downgrades are refused — nobody un-toploads a card.
  const rank = (k: string | null) => (k ? PROTECTIONS.indexOf(k as SupplyKind) : -1)
  if (rank(row.protection) > rank(pk)) return { ok: false, error: `It's already safer in a ${labelOf(row.protection)}` }
  if (qty(pk) < 1) return { ok: false, error: `Out of ${labelOf(pk)}s — buy more from the Supplies tab` }
  consume(pk)
  if (row.protection) refundStock(row.protection as SupplyKind) // upgrade: reuse the old sleeve
  db.prepare('UPDATE inventory SET protection = ?, protected_at = ? WHERE id = ?').run(kind, nowIso(), inventoryId)
  const value = (db.prepare('SELECT market FROM price_records WHERE card_id = ? AND kind = ? AND market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1').get(row.card_id, 'tcgplayer') as { market: number } | undefined)?.market
  logActivity('supplies', `Sleeved ${row.name}${value && value >= 100 ? ` — at $${Math.round(value).toLocaleString()} it earns the ${labelOf(kind)}` : ''}.`)
  return { ok: true, protected: true }
}

// ---------------------------------------------------------------------------
// Bulk protection — sleeve everything the multi-select picked, in one call.
// Greedy value-first ordering: there are never enough toploaders for a whole
// wall of cards, so the best cardboard gets the best protection. Every skip
// is reported so the UI can explain the leftovers instead of silently eating
// half the selection.
// ---------------------------------------------------------------------------

export function bulkProtect(
  ids: number[],
  kind: string,
): { ok: boolean; error?: string; protected?: number; skipped?: { id: number; reason: string }[]; outOfStock?: number } {
  if (!isProtection(kind)) return { ok: false, error: 'Unknown protection' }
  const pk = kind as SupplyKind
  const rank = (k: string | null) => (k ? PROTECTIONS.indexOf(k as SupplyKind) : -1)
  if (ids.length === 0) return { ok: false, error: 'Nothing selected' }

  // Newest market value per card, for the value-first pass ordering.
  const placeholders = ids.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT i.id, i.card_id, c.name, i.graded_grade, i.status, i.protection
     FROM inventory i JOIN cards c ON c.id = i.card_id
     WHERE i.id IN (${placeholders})`,
  ).all(...ids) as { id: number; card_id: string; name: string; graded_grade: string | null; status: string; protection: string | null }[]
  const latestMarket = db.prepare(
    `SELECT market FROM price_records WHERE card_id = ? AND kind = 'tcgplayer' AND market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1`,
  )

  // Newest protection first — upgrades eat a unit to free one, so they run
  // before bare cards and stay stock-neutral.
  rows.sort((a, b) => rank(b.protection) - rank(a.protection)
    || ((latestMarket.get(b.card_id) as { market: number } | undefined)?.market ?? 0)
      - ((latestMarket.get(a.card_id) as { market: number } | undefined)?.market ?? 0))

  const skipped: { id: number; reason: string }[] = []
  let outOfStock = 0
  let done = 0
  let upgraded = 0
  let bestValue = 0
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (r.graded_grade) { skipped.push({ id: r.id, reason: 'graded slab' }); continue }
      if (r.status === 'sold') { skipped.push({ id: r.id, reason: 'sold' }); continue }
      if (r.protection === pk) { skipped.push({ id: r.id, reason: `already ${labelOf(pk)}` }); continue }
      if (rank(r.protection) > rank(pk)) { skipped.push({ id: r.id, reason: `already ${labelOf(r.protection)}` }); continue }
      if (qty(pk) < 1) { outOfStock++; continue }
      consume(pk)
      if (r.protection) { refundStock(r.protection as SupplyKind); upgraded++ } // upgrade: reuse the old sleeve
      db.prepare('UPDATE inventory SET protection = ?, protected_at = ? WHERE id = ?').run(pk, nowIso(), r.id)
      done++
      bestValue = Math.max(bestValue, (latestMarket.get(r.card_id) as { market: number } | undefined)?.market ?? 0)
    }
  })
  tx()

  if (done > 0) {
    const valueNote = bestValue >= 100 ? ` — top pick at $${Math.round(bestValue).toLocaleString()}` : ''
    const upgradeNote = upgraded > 0 ? ` (${upgraded} upgraded${upgraded === 1 ? '' : 's'} from sleeves)` : ''
    logActivity('supplies', `Bulk-protected ${done} card${done === 1 ? '' : 's'} in ${labelOf(pk)}s${upgradeNote}${valueNote}.`)
  }
  if (outOfStock > 0 && done === 0) {
    return { ok: false, error: `Out of ${labelOf(pk)}s — ${outOfStock} card${outOfStock === 1 ? '' : 's'} still bare. Buy more from the Supplies tab.`, skipped }
  }
  return { ok: true, protected: done, skipped, outOfStock }
}

/** Pull the protection off a card and return it to stock (a conscious downgrade). */
export function unprotect(inventoryId: number): { ok: boolean; error?: string } {
  const row = db.prepare(`SELECT id, protection FROM inventory WHERE id = ?`).get(inventoryId) as
    | { id: number; protection: string | null }
    | undefined
  if (!row) return { ok: false, error: 'Card not found' }
  if (!row.protection || !isProtection(row.protection)) return { ok: false, error: 'Not protected' }
  refundStock(row.protection as SupplyKind)
  db.prepare('UPDATE inventory SET protection = NULL, protected_at = NULL WHERE id = ?').run(inventoryId)
  return { ok: true }
}

function labelOf(kind: string | null): string {
  const label = SUPPLIES.find((s) => s.kind === kind)?.label ?? kind ?? 'bare'
  return label === 'Penny sleeves' ? 'penny sleeve' : label.replace(/s$/, '')
}

/** Protection tier of a row, for UI badges and the wear engine. */
export function protectionOf(inventoryId: number): SupplyKind | null {
  const row = db.prepare('SELECT protection FROM inventory WHERE id = ?').get(inventoryId) as { protection: string | null } | undefined
  return isProtection(row?.protection ?? '') ? (row!.protection as SupplyKind) : null
}

// ---------------------------------------------------------------------------
// Auto-protection on acquisition — the world behaves like collectors do.
// Callsites (grading returns, shop buyer sourcing) pass inventory ids; if
// stock exists, high-value raw arrivals get sleeved automatically.
// ---------------------------------------------------------------------------

/** Threshold above which an unprotected arrival deserves a sleeve if you have them. */
const AUTO_SLEEVE_ABOVE = 25

export function autoProtectNewCards(inventoryIds: number[]) {
  if (inventoryIds.length === 0) return
  if (qty('sleeve') === 0) return
  const placeholders = inventoryIds.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT id, card_id, graded_grade, protection FROM inventory WHERE id IN (${placeholders}) AND graded_grade IS NULL AND protection IS NULL AND status IN ${RAW_STATUSES}`,
  ).all(...inventoryIds) as { id: number; card_id: string; graded_grade: null; protection: null }[]
  let used = 0
  for (const r of rows) {
    if (qty('sleeve') < 1) break
    const value = (db.prepare('SELECT market FROM price_records WHERE card_id = ? AND kind = ? AND market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1').get(r.card_id, 'tcgplayer') as { market: number } | undefined)?.market ?? 0
    if (value < AUTO_SLEEVE_ABOVE) continue
    consume('sleeve')
    db.prepare('UPDATE inventory SET protection = ?, protected_at = ? WHERE id = ?').run('sleeve', nowIso(), r.id)
    used++
  }
  if (used > 0) logActivity('supplies', `Auto-sleeved ${used} new arrival${used === 1 ? '' : 's'} worth $${AUTO_SLEEVE_ABOVE}+ — that's what the sleeve stock is for.`)
}

/** Graded cards come back sealed in a slab — no wear, no protection needed. */
export function markSlabbed(inventoryIds: number[]) {
  if (inventoryIds.length === 0) return
  const placeholders = inventoryIds.map(() => '?').join(',')
  db.prepare(`UPDATE inventory SET protection = NULL, protected_at = NULL, worn_at = NULL WHERE id IN (${placeholders}) AND graded_grade IS NOT NULL`).run(...inventoryIds)
}

// ---------------------------------------------------------------------------
// The wear engine — one pass per game day.
// ---------------------------------------------------------------------------

const WEAR_KEY = 'supplies:lastWearDay'

/** Base chance a bare card drops a condition step on a given game day. */
// Per game-day (12 real hours) — half the old 24h-day chance so real-day wear is unchanged.
const BASE_WEAR_CHANCE = 0.01

/** Below this market value a card is junk — dollar-bin stock doesn't track wear. */
const WEAR_IGNORE_BELOW = 0.5

export function suppliesTick(today: string) {
  const last = getMeta(WEAR_KEY)
  if (last === today) return { worn: 0 }
  setMeta(WEAR_KEY, today)

  // Candidates: raw, bare, collection-shelved cards worth tracking. Listed /
  // cased / at-table stock is out being handled by people who care; slabs
  // are sealed. Wear chance scales down with value — grails get respect.
  const rows = db.prepare(
    `SELECT i.id, i.card_id, c.name, i.condition, i.quantity
     FROM inventory i JOIN cards c ON c.id = i.card_id
     WHERE i.status = 'collection' AND i.graded_grade IS NULL AND i.protection IS NULL
       AND i.condition IN ('NM','LP','MP','HP')
       AND i.quantity > 0`,
  ).all() as { id: number; card_id: string; name: string; condition: Condition; quantity: number }[]

  const latestMarket = db.prepare(
    `SELECT market FROM price_records WHERE card_id = ? AND kind = 'tcgplayer' AND market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1`,
  )
  let worn = 0
  let worstLoss = 0
  const tx = db.transaction(() => {
    for (const r of rows) {
      const market = (latestMarket.get(r.card_id) as { market: number } | undefined)?.market ?? 0
      if (market < WEAR_IGNORE_BELOW) continue
      // Richer cards are treated better: the roll halves every ~10× of value.
      const chance = BASE_WEAR_CHANCE / Math.max(1, Math.log10(Math.max(1, market)))
      if (Math.random() >= chance) continue
      const next = CONDITIONS[Math.min(CONDITIONS.length - 1, CONDITIONS.indexOf(r.condition) + 1)]
      db.prepare('UPDATE inventory SET condition = ?, worn_at = ? WHERE id = ?').run(next, nowIso(), r.id)
      worn++
      worstLoss = Math.max(worstLoss, market * (1 - condMult(next)))
      if (worn <= 3) {
        logActivity('supplies', `Condition wear: ${r.name} slipped ${r.condition} → ${next} loose in the box. A penny sleeve would have stopped it.`, 0)
      }
    }
  })
  tx()
  if (worn > 3) {
    logActivity('supplies', `Condition wear: ${worn} bare cards slipped a grade overnight. Sleeves are five cents; regret isn't.`, 0)
  }
  if (worn > 0) console.log(`[supplies] daily wear: ${worn} card(s) degraded, worst single loss ≈ $${worstLoss.toFixed(2)}`)
  return { worn }
}

function condMult(c: Condition): number {
  return { NM: 1, LP: 0.8, MP: 0.65, HP: 0.5, DM: 0.35 }[c]
}

// ---------------------------------------------------------------------------
// Wear telemetry for the UI.
// ---------------------------------------------------------------------------

export function wearRisk() {
  // Bare raw cards and their combined market exposure, priced in JS per row
  // (a join against price history would multiply rows per card).
  const rows = db.prepare(
    `SELECT i.id, i.card_id, i.quantity FROM inventory i
     WHERE i.status = 'collection' AND i.graded_grade IS NULL AND i.protection IS NULL
       AND i.condition IN ('NM','LP','MP','HP') AND i.quantity > 0`,
  ).all() as { id: number; card_id: string; quantity: number }[]
  const latestMarket = db.prepare(
    `SELECT market FROM price_records WHERE card_id = ? AND kind = 'tcgplayer' AND market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1`,
  )
  let bareCards = 0
  let bareValue = 0
  for (const r of rows) {
    const m = (latestMarket.get(r.card_id) as { market: number } | undefined)?.market ?? 0
    bareCards += r.quantity
    bareValue += m * r.quantity
  }
  const protectedRows = db.prepare(
    `SELECT protection, COUNT(*) AS n FROM inventory WHERE protection IS NOT NULL AND status != 'sold' GROUP BY protection`,
  ).all() as { protection: string; n: number }[]
  const byProtection: Record<string, number> = {}
  for (const r of protectedRows) byProtection[r.protection] = r.n
  return {
    bareCards,
    bareValue: round2(bareValue),
    byProtection,
    lastWearDay: getMeta(WEAR_KEY),
  }
}
