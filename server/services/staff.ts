import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayKey, gameDayMs } from '../lib/gameday'
import * as pnl from './pnl'
import { round2 } from './market'
import * as grading from './grading'
import { getShop } from './shop'
import { rivalRow } from './rival'

// ---------------------------------------------------------------------------
// Shop staff — hire specialists, pay them every rent day, and let them work.
//   buyer   — sources underpriced raw cards from the market feed into stock
//   grader  — auto-submits high-EV collection candidates for grading
//   counter — friendly face at the register; lifts walk-in traffic
// Wages draft on rent day alongside rent. Miss payroll and staff walk out.
//
// They're also people: mood drifts with fair pay and honored requests, work
// events push xp that trains quality stars up (1→5), they ask for specific
// days off you can grant or grudge, the rival slips them 1.2× offers you can
// match, and a miserable one quits in a huff you get ONE conversation to
// defuse. See lifeTick() below for the daily pass.
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
  xp: number
  mood: number
  day_off: string | null
  day_off_ask: string | null
  poach: string | null
  huff: string | null
}

// ---------------------------------------------------------------------------
// Employees with lives — helpers shared by the daily pass and the read model
// ---------------------------------------------------------------------------

/** xp needed to REACH each star (1★ is free at hiring). */
const XP_STAR: Record<number, number> = { 2: 60, 3: 180, 4: 380, 5: 700 }
const HUFF_FUSE = 2 // game-days you have for the one conversation
const POACH_FUSE = 3 // game-days an open rival offer stays on the table
const OFF_ASK_CHANCE = 0.12 // per employee per game-day
const POACH_CHANCE = 0.15 // per game-day while the rival is open

type Poach = { offered: number; rival: string; filed: string }
type Huff = { kind: 'raise' | 'snub'; asked?: number; text: string; filed: string }

function roster(): Employee[] {
  return db.prepare(`SELECT * FROM shop_employees ORDER BY id`).all() as Employee[]
}

function row(id: number): Employee | undefined {
  return db.prepare(`SELECT * FROM shop_employees WHERE id = ?`).get(id) as Employee | undefined
}

function readJson<T>(json: string | null | undefined): T | null {
  if (!json) return null
  try { return JSON.parse(json) as T } catch { return null }
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / gameDayMs()))
}

function clampMood(v: number): number {
  return Math.max(0, Math.min(100, round2(v)))
}

function moodLabel(m: number): string {
  if (m >= 80) return 'thriving'
  if (m >= 60) return 'content'
  if (m >= 40) return 'settled'
  if (m >= 20) return 'restless'
  return 'miserable'
}

/** Per-day market wage for a role at these stars — how the applicants are priced. */
function marketWage(role: StaffRole, quality: number): number {
  const base = role === 'buyer' ? 4.5 : role === 'grader' ? 5.5 : 2.5
  return Math.round(base * (0.6 + quality * 0.5) * 4) / 4
}

/** Human label for a game-day key: 'Wed, Oct 8 · PM'. */
function offLabel(key: string): string {
  const d = new Date(key.slice(0, 10) + 'T12:00:00Z')
  const half = key.endsWith('-pm') ? ' · PM' : key.endsWith('-am') ? ' · AM' : ''
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) + half
}

function fmt(n: number): string {
  return `$${round2(n).toFixed(2)}`
}

export function payroll(): number {
  return round2(roster().reduce((a, e) => a + e.wage, 0))
}

/** Counter-staff traffic multiplier for the walk-in model (1.0 with no staff). */
export function counterBoost(): number {
  const key = gameDayKey()
  const counters = roster().filter((e) => e.role === 'counter' && e.day_off !== key) // off-duty help doesn't greet anyone
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
    // Wages are per game-day (12 real hours) — half the old 24h-day numbers.
    const wage = Math.round((role === 'buyer' ? 4.5 : role === 'grader' ? 5.5 : 2.5) * (0.6 + tier * 0.5) * 4) / 4
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
    grantXp(e, 6) // sourcing is the buyer's classroom
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
    grantXp(e, 8) // submissions teach the eye
    logActivity('shop', `${e.name} submitted ${best.name} to ${svc.name} (EV +$${best.expectedProfit.toFixed(2)}).`)
  } catch { /* ineligible by the time the grader got there — fine */ }
}

/** On-the-job training: work events push xp; crossing a threshold trains a star. */
function grantXp(e: { id: number; name: string; quality: number; xp: number }, amount: number) {
  const xp = round2(e.xp + amount)
  let quality = e.quality
  while (quality < 5 && xp >= (XP_STAR[quality + 1] ?? Infinity)) quality++
  db.prepare(`UPDATE shop_employees SET xp = ?, quality = ? WHERE id = ?`).run(xp, quality, e.id)
  if (quality > e.quality) {
    logActivity('shop', `📈 ${e.name} trained up to ${quality}★ on the job — ${quality === 5 ? 'there is nothing left to teach them' : 'the floor is teaching them'}.`, 0)
  }
}

/** Register sales credited to the counter help on duty — plus their training. */
export function creditCounterSales(sales: number) {
  if (!(sales > 0)) return
  const key = gameDayKey()
  for (const e of roster().filter((x) => x.role === 'counter' && x.day_off !== key)) {
    db.prepare(`UPDATE shop_employees SET sales_lift = sales_lift + ? WHERE id = ?`).run(sales, e.id)
    grantXp(e, sales)
  }
}

export function staffTick() {
  const shop = getShop()
  if (!shop) return
  const key = gameDayKey()
  for (const e of roster()) {
    if (e.day_off === key) continue // granted days off — the shop runs without them
    if (e.role === 'buyer') buyerWork(e)
    else if (e.role === 'grader') graderWork(e)
    // counter help works through the shopTick traffic multiplier directly
  }
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ---------------------------------------------------------------------------
// Employees with lives — the daily pass (day-keyed like loyaltyTick). Once per
// game-day: stale state clears, mood drifts, and the rolls fire — a day-off
// ask, a huff — then after the roster pass, one rival offer at a time.
// ---------------------------------------------------------------------------

export function lifeTick() {
  const shop = getShop()
  if (!shop) return
  const day = gameDayKey()
  const key = `staffLife:${day}`
  if (getMeta(key)) return
  setMeta(key, '1')
  // Prune old gates (same pattern as candidates()).
  for (const k of db.prepare(`SELECT key FROM meta WHERE key LIKE 'staffLife:%'`).all() as { key: string }[]) {
    if (k.key !== key) db.prepare(`DELETE FROM meta WHERE key = ?`).run(k.key)
  }

  let huffOpen = roster().some((e) => readJson<Huff>(e.huff) != null)
  const poachOpen = roster().some((e) => readJson<Poach>(e.poach) != null)
  for (const e of roster()) {
    const huff = readJson<Huff>(e.huff)
    const poach = readJson<Poach>(e.poach)

    // 1. The fuses: an ignored conversation or an unanswered offer ends in a departure.
    if (huff && daysSince(huff.filed) >= HUFF_FUSE) {
      db.prepare(`DELETE FROM shop_employees WHERE id = ?`).run(e.id)
      logActivity('shop', `🚪 ${e.name} quit in a huff — the conversation never happened. Payroll down to ${fmt(payroll())}.`, 0)
      continue
    }
    if (poach && daysSince(poach.filed) >= POACH_FUSE) {
      db.prepare(`DELETE FROM shop_employees WHERE id = ?`).run(e.id)
      logActivity('shop', `⚖️ ${e.name} took ${poach.rival}'s offer unopposed — out the door at ${fmt(poach.offered)}/day. Payroll down to ${fmt(payroll())}.`, 0)
      continue
    }

    // 2. A day that's been and gone clears itself (the ask too — the grudge stays).
    if (e.day_off && e.day_off < day) {
      db.prepare(`UPDATE shop_employees SET day_off = NULL WHERE id = ?`).run(e.id)
      e.day_off = null
    }
    if (e.day_off_ask && e.day_off_ask < day) {
      db.prepare(`UPDATE shop_employees SET day_off_ask = NULL WHERE id = ?`).run(e.id)
      e.day_off_ask = null
    }

    // 3. Daily drift — underpaid bleeds, fair pay drips back, promises unkept rot.
    const market = marketWage(e.role, e.quality)
    const ratio = e.wage / market
    let mood = e.mood
    if (ratio < 1) mood -= (1 - ratio) * 2.2
    else if (ratio >= 1.45) mood += 0.5
    else mood += 0.3
    if (e.day_off === day) mood += 3 // a day off actually taken
    if (e.day_off_ask) mood -= 0.6 // the request still waiting on an answer
    if (poach) mood -= 0.5 // flattered by an offer they haven't mentioned
    mood = clampMood(mood)

    // 4. An open crisis holds — only the drift lands.
    if (huff || poach) {
      db.prepare(`UPDATE shop_employees SET mood = ? WHERE id = ?`).run(mood, e.id)
      continue
    }

    // 5. Quit in a huff — one conversation to defuse (or they're gone).
    if (!huffOpen && mood <= 20 && Math.random() < ((20 - mood) / 20) * 0.25) {
      const h = fileHuff(e, ratio, market, e.day_off_ask)
      db.prepare(`UPDATE shop_employees SET mood = ?, huff = ? WHERE id = ?`).run(mood, JSON.stringify(h), e.id)
      huffOpen = true
      continue
    }

    // 6. Ask for a specific day off — the next game-day.
    if (!e.day_off_ask && !e.day_off && Math.random() < OFF_ASK_CHANCE + (mood < 45 ? 0.05 : 0)) {
      const askedFor = gameDayKey(Date.now() + gameDayMs())
      db.prepare(`UPDATE shop_employees SET mood = ?, day_off_ask = ? WHERE id = ?`).run(mood, askedFor, e.id)
      logActivity('shop', `🌴 ${e.name} asks for ${offLabel(askedFor)} off — ${e.quality >= 4 ? 'plan the coverage now or hear about it later' : 'a specific date, not just "a break"'}.`, 0)
      continue
    }

    db.prepare(`UPDATE shop_employees SET mood = ? WHERE id = ?`).run(mood, e.id)
  }

  // 7. The rival doesn't post job ads — it slips offers, one at a time.
  if (!huffOpen && !poachOpen && Math.random() < POACH_CHANCE) {
    const rival = rivalRow()
    const staff = roster()
    if (rival && staff.length > 0) {
      const target = pick(staff)
      const offered = Math.round(target.wage * 1.2 * 4) / 4 // 1.2× wage, clean quarter
      const poach: Poach = { offered, rival: rival.name, filed: nowIso() }
      db.prepare(`UPDATE shop_employees SET poach = ? WHERE id = ?`).run(JSON.stringify(poach), target.id)
      logActivity('shop', `⚖️ ${rival.name} slipped ${target.name} an offer: ${fmt(offered)}/day — 1.2× your ${fmt(target.wage)}. Match it or they go in ${POACH_FUSE} game-days.`, 0)
    }
  }
}

/** The grievance itself: what they say, and what the one conversation costs. */
function fileHuff(e: Employee, ratio: number, market: number, pendingAsk: string | null): Huff {
  const filed = nowIso()
  if (ratio < 0.95) {
    const asked = Math.max(0.5, Math.round((market - e.wage) * 4) / 4)
    const text = e.quality >= 4
      ? `I'm ${e.quality}★ work you'd feel if I left, and I make ${fmt(e.wage)}/day. ${fmt(market)} is the floor for my stars — ${fmt(asked)} more or I'm gone.`
      : `${fmt(e.wage)}/day isn't worth this anymore. ${fmt(market)} is what my stars fetch across the street — ${fmt(asked)} more, or I walk.`
    logActivity('shop', `💢 ${e.name} is in a huff: ${e.quality}★ work at ${fmt(e.wage)}/day when ${fmt(market)} is the market. ${fmt(asked)}/day more or they walk — one conversation, ${HUFF_FUSE} game-days.`, 0)
    return { kind: 'raise', asked, text, filed }
  }
  const text = pendingAsk
    ? `I asked for ${offLabel(pendingAsk)} off and it's still sitting there unanswered. I'm not asking twice — give me that day, or I'm done.`
    : `Every day is the same floor, same shift, same nobody-notices. I need ${offLabel(gameDayKey(Date.now() + gameDayMs()))} off — actually granted this time — or I'm done.`
  logActivity('shop', `💢 ${e.name} is in a huff — ${pendingAsk ? `the ${offLabel(pendingAsk)} day-off ask went unanswered` : 'the requests keep going nowhere'}. One conversation, ${HUFF_FUSE} game-days.`, 0)
  return { kind: 'snub', text, filed }
}

// ---------------------------------------------------------------------------
// Resolutions — the three conversations
// ---------------------------------------------------------------------------

export function resolveDayOff(id: number, action: 'grant' | 'refuse') {
  const e = row(id)
  if (!e) return { ok: false as const, error: 'No such employee' }
  if (!e.day_off_ask) return { ok: false as const, error: 'No day off on the table' }
  if (action === 'grant') {
    db.prepare(`UPDATE shop_employees SET day_off = ?, day_off_ask = NULL, mood = MIN(100, mood + 6) WHERE id = ?`).run(e.day_off_ask, id)
    logActivity('shop', `🌴 ${e.name} has ${offLabel(e.day_off_ask)} off — granted, and they're off the clock when it comes.`, 0)
    return { ok: true as const, dayOff: e.day_off_ask, label: offLabel(e.day_off_ask) }
  }
  db.prepare(`UPDATE shop_employees SET day_off_ask = NULL, mood = MAX(0, mood - 10) WHERE id = ?`).run(id)
  logActivity('shop', `${e.name} takes the no on ${offLabel(e.day_off_ask)} — and notes it for the next ask.`, 0)
  return { ok: true as const, refused: true as const }
}

export function resolvePoach(id: number, action: 'match' | 'letgo') {
  const e = row(id)
  if (!e) return { ok: false as const, error: 'No such employee' }
  const poach = readJson<Poach>(e.poach)
  if (!poach) return { ok: false as const, error: 'No offer on the table' }
  if (action === 'match') {
    db.prepare(`UPDATE shop_employees SET wage = ?, poach = NULL, mood = MIN(100, mood + 8) WHERE id = ?`).run(round2(poach.offered), id)
    logActivity('shop', `🤝 You matched ${poach.rival}'s counter-offer — ${e.name} stays at ${fmt(poach.offered)}/day. Payroll now ${fmt(payroll())}.`, 0)
    return { ok: true as const, wage: round2(poach.offered) }
  }
  db.prepare(`DELETE FROM shop_employees WHERE id = ?`).run(id)
  logActivity('shop', `⚖️ ${e.name} walked to ${poach.rival} at ${fmt(poach.offered)}/day — you let the offer stand. Payroll down to ${fmt(payroll())}.`, 0)
  return { ok: true as const, left: true as const }
}

export function resolveHuff(id: number, action: 'grant' | 'refuse') {
  const e = row(id)
  if (!e) return { ok: false as const, error: 'No such employee' }
  const huff = readJson<Huff>(e.huff)
  if (!huff) return { ok: false as const, error: 'Nothing to defuse' }
  if (action === 'grant') {
    if (huff.kind === 'raise') {
      const wage = round2(e.wage + (huff.asked ?? 0))
      db.prepare(`UPDATE shop_employees SET wage = ?, huff = NULL, mood = 70 WHERE id = ?`).run(wage, id)
      logActivity('shop', `💬 You heard ${e.name} out and matched the number — ${fmt(wage)}/day, and they're back on the floor.`, 0)
      return { ok: true as const, wage }
    }
    const next = gameDayKey(Date.now() + gameDayMs())
    const dayOff = e.day_off_ask && e.day_off_ask >= next ? e.day_off_ask : next
    db.prepare(`UPDATE shop_employees SET huff = NULL, day_off = ?, day_off_ask = NULL, mood = 70 WHERE id = ?`).run(dayOff, id)
    logActivity('shop', `💬 You heard ${e.name} out — ${offLabel(dayOff)} is theirs. Back on the floor tomorrow.`, 0)
    return { ok: true as const, dayOff, label: offLabel(dayOff) }
  }
  db.prepare(`DELETE FROM shop_employees WHERE id = ?`).run(id)
  logActivity('shop', `🚪 ${e.name} quit in a huff — the one conversation didn't land. Payroll down to ${fmt(payroll())}.`, 0)
  return { ok: true as const, left: true as const }
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export function status() {
  const shop = getShop()
  if (!shop) return { candidates: [], roster: [], payroll: 0, counterBoost: 1 }
  const day = gameDayKey()
  return {
    candidates: candidates(),
    roster: roster().map((e) => {
      const poach = readJson<Poach>(e.poach)
      const huff = readJson<Huff>(e.huff)
      return {
        ...e,
        roleLabel: ROLE_META[e.role].label,
        xp: round2(e.xp),
        nextXp: XP_STAR[e.quality + 1] ?? null,
        floorXp: XP_STAR[e.quality] ?? 0,
        mood: round2(e.mood),
        moodLabel: moodLabel(e.mood),
        marketWage: marketWage(e.role, e.quality),
        offToday: e.day_off === day,
        dayOffLabel: e.day_off ? offLabel(e.day_off) : null,
        dayOffAskLabel: e.day_off_ask ? offLabel(e.day_off_ask) : null,
        poach: poach ? { offered: round2(poach.offered), rival: poach.rival, daysLeft: Math.max(0, POACH_FUSE - daysSince(poach.filed)) } : null,
        huff: huff ? { kind: huff.kind, asked: huff.asked ?? null, text: huff.text, daysLeft: Math.max(0, HUFF_FUSE - daysSince(huff.filed)) } : null,
      }
    }),
    payroll: payroll(),
    counterBoost: round2(counterBoost()),
    limits: Object.fromEntries((Object.keys(ROLE_META) as StaffRole[]).map((r) => [r, ROLE_META[r].max])),
  }
}
