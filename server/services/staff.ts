import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import * as pnl from './pnl'
import { round2 } from './market'
import * as grading from './grading'
import { getShop } from './shop'

// ---------------------------------------------------------------------------
// Shop staff — hire specialists, pay them every rent day, and let them work.
//   buyer   — sources underpriced raw cards from the market feed into stock
//   grader  — auto-submits high-EV collection candidates for grading
//   counter — friendly face at the register; lifts walk-in traffic
// Wages draft on rent day alongside rent. Miss payroll and staff walk out.
// ---------------------------------------------------------------------------

export type StaffRole = 'buyer' | 'grader' | 'counter'

const ROLE_META: Record<StaffRole, { label: string; blurb: string; max: number }> = {
  buyer: { label: 'Buyer', blurb: 'Hunts the market feed for underpriced cards and stocks the cases.', max: 1 },
  grader: { label: 'Grader', blurb: 'Watches your collection and submits high-EV candidates for grading.', max: 1 },
  counter: { label: 'Counter help', blurb: 'A friendly face at the register — walk-ins browse longer and buy more.', max: 2 },
}

const NAMES = ['Sam', 'Lena', 'Gus', 'Pilar', 'Devon', 'Yuki', 'Omar', 'Tess', 'Ravi', 'Nora', 'Gio', 'Wren']

type Employee = {
  id: number
  role: StaffRole
  name: string
  wage: number
  quality: number
  hired_at: string
  sourced_value: number
  sourced_cost: number
  submits: number
  sales_lift: number
}

function roster(): Employee[] {
  return db.prepare(`SELECT * FROM shop_employees ORDER BY id`).all() as Employee[]
}

export function payroll(): number {
  return round2(roster().reduce((a, e) => a + e.wage, 0))
}

/** Counter-staff traffic multiplier for the walk-in model (1.0 with no staff). */
export function counterBoost(): number {
  const counters = roster().filter((e) => e.role === 'counter')
  return Math.min(1.9, 1 + counters.reduce((a, e) => a + 0.12 + e.quality * 0.06, 0))
}

// ---------------------------------------------------------------------------
// Hiring — candidates are generated per role with quality-tiered wages
// ---------------------------------------------------------------------------

type Candidate = { role: StaffRole; roleLabel: string; blurb: string; name: string; quality: number; wage: number }

/** Applicants persist for the week — the same faces all week, new ones Monday. */
export function candidates(): Candidate[] {
  const week = new Date().toISOString().slice(0, 10)
  const metaKey = `staffCandidates:${week}`
  const cached = getMeta(metaKey)
  if (cached) return JSON.parse(cached) as Candidate[]
  const fresh = (Object.keys(ROLE_META) as StaffRole[]).map((role) => {
    const meta = ROLE_META[role]
    const tier = 1 + Math.floor(Math.random() * 5) // 1..5 stars
    const wage = Math.round((role === 'buyer' ? 9 : role === 'grader' ? 11 : 5) * (0.6 + tier * 0.5) * 4) / 4
    return {
      role,
      roleLabel: meta.label,
      blurb: meta.blurb,
      name: pick(NAMES),
      quality: tier,
      wage,
    }
  })
  setMeta(metaKey, JSON.stringify(fresh))
  // Prune old weeks.
  for (const k of (db.prepare(`SELECT key FROM meta WHERE key LIKE 'staffCandidates:%'`).all() as { key: string }[])) {
    if (k.key !== metaKey) db.prepare(`DELETE FROM meta WHERE key = ?`).run(k.key)
  }
  return fresh
}

export function hire(name: string, role: StaffRole, quality: number, wage: number) {
  const shop = getShop()
  if (!shop) return { ok: false as const, error: 'Lease a shop before hiring staff' }
  const meta = ROLE_META[role]
  if (!meta) return { ok: false as const, error: 'Unknown role' }
  const sameRole = roster().filter((e) => e.role === role)
  if (sameRole.length >= meta.max) return { ok: false as const, error: `You already employ the max ${meta.max} ${meta.label.toLowerCase()}${meta.max > 1 ? 's' : ''}` }
  if (!(wage > 0)) return { ok: false as const, error: 'Wage must be positive' }
  db.prepare(`INSERT INTO shop_employees (role, name, wage, quality, hired_at) VALUES (?, ?, ?, ?, ?)`)
    .run(role, name, round2(wage), quality, nowIso())
  logActivity('shop', `Hired ${name} as ${meta.label.toLowerCase()} — $${round2(wage).toFixed(2)}/day. Payroll is now $${payroll().toFixed(2)}.`)
  return { ok: true as const, name, role }
}

export function fire(id: number) {
  const e = db.prepare(`SELECT * FROM shop_employees WHERE id = ?`).get(id) as Employee | undefined
  if (!e) return { ok: false as const, error: 'No such employee' }
  db.prepare(`DELETE FROM shop_employees WHERE id = ?`).run(id)
  logActivity('shop', `${e.name} worked their last day. Payroll down to $${payroll().toFixed(2)}.`)
  return { ok: true as const }
}

// ---------------------------------------------------------------------------
// Payroll — drafted on rent day. If rent day can't cover rent + wages,
// staff walk (the shop survives; people don't work for free).
// ---------------------------------------------------------------------------

export function payRollDay(availableAfterRent: boolean): boolean {
  const staff = roster()
  if (staff.length === 0) return true
  const owed = payroll()
  if (!availableAfterRent || owed <= 0) return false
  const cash = (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash
  if (cash < owed) {
    for (const e of staff) {
      db.prepare(`DELETE FROM shop_employees WHERE id = ?`).run(e.id)
      logActivity('shop', `${e.name} quit — payroll bounced.`, 0)
    }
    return false
  }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(owed)
  setMeta('payrollDrafted', String(owed))
  pnl.append('payroll', -owed, `${staff.length} employee${staff.length === 1 ? '' : 's'}`)
  logActivity('shop', `Payroll day: -$${owed.toFixed(2)} across ${staff.length} employee${staff.length === 1 ? '' : 's'}.`, -owed)
  return true
}

// ---------------------------------------------------------------------------
// The work — each effect runs on the game tick
// ---------------------------------------------------------------------------

/** Buyer: occasionally buys an underpriced card straight into a case with room. */
function buyerWork(e: Employee) {
  const shop = getShop()
  if (!shop) return
  // Cases with open slots, prefer emptier ones.
  const cases = db
    .prepare(
      `SELECT sc.id, sc.slots, (SELECT COUNT(*) FROM shop_case_cards x WHERE x.case_id = sc.id) AS used
       FROM shop_cases sc JOIN meta m ON m.key = 'shopCase:' || sc.id
       WHERE sc.slots > (SELECT COUNT(*) FROM shop_case_cards x WHERE x.case_id = sc.id)`,
    )
    .all() as { id: number; slots: number; used: number }[]
  if (cases.length === 0) return
  const chance = 0.012 * e.quality // per tick; a 3★ buyer sources roughly every ~45 min of ticks
  if (Math.random() >= chance) return
  // Underpriced live listings on the market feed (listings are priced off market,
  // so anything under ~85% is a real bargain the buyer can flip through the case).
  const pickRow = db
    .prepare(
      `SELECT id, card_id, variant, condition, price FROM listings
       WHERE expires_at > ? AND price > 0.5 ORDER BY RANDOM() LIMIT 40`,
    )
    .all(nowIso()) as { id: string; card_id: string; variant: string; condition: string; price: number }[]
  for (const l of pickRow) {
    const anchor = (db.prepare(`SELECT market FROM price_records WHERE card_id = ? AND kind = 'tcgplayer' AND market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1`).get(l.card_id) as { market: number } | undefined)?.market ?? 0
    if (anchor <= 0) continue
    const ratio = l.price / anchor
    if (ratio > 0.85 - e.quality * 0.03) continue // only genuine deals, tighter eye at higher quality
    const cost = round2(l.price * (1 + 0.05)) // shipping/handling
    const cash = (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash
    if (cash < cost) return
    const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(l.card_id) as { name: string }).name
    const c = pick(cases)
    const ask = round2(anchor * 0.95) // competitive case price
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM listings WHERE id = ?`).run(l.id)
      db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(cost)
      db.prepare(
        `INSERT INTO inventory (card_id, variant, condition, quantity, status, graded_grade, acquired_via, acquired_ref, cost_basis, acquired_at)
         VALUES (?, ?, ?, 1, 'in_case', NULL, 'staff', ?, ?, ?)`,
      ).run(l.card_id, l.variant, l.condition, `${e.role}:${e.name}`, cost, nowIso())
      const invId = (db.prepare(`SELECT id FROM inventory ORDER BY id DESC LIMIT 1`).get() as { id: number }).id
      db.prepare(`INSERT INTO shop_case_cards (case_id, inventory_id) VALUES (?, ?)`).run(c.id, invId)
      db.prepare(`UPDATE inventory SET listing_price = ?, listed_at = ? WHERE id = ?`).run(ask, nowIso(), invId)
      db.prepare(`UPDATE shop_employees SET sourced_value = sourced_value + ?, sourced_cost = sourced_cost + ? WHERE id = ?`)
        .run(anchor, cost, e.id)
    })
    tx()
    logActivity('shop', `${e.name} sourced ${name} off the market for $${cost.toFixed(2)} (worth ~$${anchor.toFixed(2)}) — in the case at $${ask.toFixed(2)}.`, -cost)
    return
  }
}

/** Grader: submits the single best high-EV raw candidate in the collection. */
function graderWork(e: Employee) {
  const pending = grading.pendingGrading().length
  if (pending >= 2 + e.quality) return // don't flood the queue
  const cands = grading.gradingCandidates(10).filter((c) => c.recommended && c.inventoryId > 0)
  if (cands.length === 0) return
  const best = cands.reduce((a, b) => (b.expectedProfit > a.expectedProfit ? b : a))
  const svc = grading.GRADING_SERVICES.find((s) => s.id === best.serviceId)!
  const cash = (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash
  if (cash < svc.cost) return
  try {
    grading.submitForGrading(best.inventoryId, svc.id)
    db.prepare(`UPDATE shop_employees SET submits = submits + 1 WHERE id = ?`).run(e.id)
    logActivity('shop', `${e.name} submitted ${best.name} to ${svc.name} (EV +$${best.expectedProfit.toFixed(2)}).`)
  } catch { /* ineligible by the time the grader got there — fine */ }
}

export function staffTick() {
  const shop = getShop()
  if (!shop) return
  for (const e of roster()) {
    if (e.role === 'buyer') buyerWork(e)
    else if (e.role === 'grader') graderWork(e)
    // counter help works through the shopTick traffic multiplier directly
  }
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export function status() {
  const shop = getShop()
  if (!shop) return { candidates: [], roster: [], payroll: 0, counterBoost: 1 }
  return {
    candidates: candidates(),
    roster: roster().map((e) => ({ ...e, roleLabel: ROLE_META[e.role].label })),
    payroll: payroll(),
    counterBoost: round2(counterBoost()),
    limits: Object.fromEntries((Object.keys(ROLE_META) as StaffRole[]).map((r) => [r, ROLE_META[r].max])),
  }
}
