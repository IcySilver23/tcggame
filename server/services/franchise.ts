import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayKey } from '../lib/gameday'
import { valueOf, liquidityFactor, round2, type Condition } from './market'
import * as pnl from './pnl'
import * as salesTax from './salestax'
import { getShop } from './shop'
import { loyaltyTick, loyaltyFactor, managerLoyaltyDraw, loyaltyView, dmLoyaltyView, regionalLoyaltyView } from './loyalty'

// ---------------------------------------------------------------------------
// The Chain (Phase 5 — Empire): your storefronts beyond the flagship. Store 1
// is the first franchise; a second unlocks once a district manager (DM) runs
// the chain. The DM is a salary line — but a real one coaches your managers,
// chases shrink, and files a Sunday chain report.
//
// Shelf stock is one shared pool: cards ship FROM anywhere (collection,
// flagship cases, another satellite's shelf) TO any open satellite. A transfer
// takes the card off the road for a day (arrived_at) and can go missing —
// cheap managers see crates as inventory they'll never be blamed for.
//
// Everything books per-satellite via shop_ledger.location = 'satellite:N'.
// ---------------------------------------------------------------------------

export const STORE_IDS = [1, 2, 3] as const

export type FranchiseRow = {
  id: number
  name: string
  tier: 'hole-in-the-wall' | 'storefront' | 'flagship' | 'region'
  manager_name: string
  manager_quality: number
  manager_wage: number
  opened_at: string
  last_rent_day: string | null
  reputation: number
  lifetime_revenue: number
  lifetime_cost: number
  customer_count: number
  today_customers: number
  today_revenue: number
  no_sale_streak: number
  skim_streak: number
  promoted_from: number | null
  promoted_wage: number | null
  loyalty: number
  wage_start: number | null
  manager_since: string | null
  raise_demand: string | null
}

type Tier = { id: FranchiseRow['tier']; label: string; blurb: string; deposit: number; rent: number }

const TIERS: Tier[] = [
  { id: 'hole-in-the-wall', label: 'Hole-in-the-wall', blurb: 'Across town where rent is cheap and foot traffic is optimistic.', deposit: 250, rent: 6 },
  { id: 'storefront', label: 'Storefront', blurb: 'A real shop in a real neighborhood. Costs real money to keep dark.', deposit: 900, rent: 18 },
  { id: 'flagship', label: 'Flagship', blurb: 'You are becoming a chain. The scene has noticed.', deposit: 3000, rent: 70 },
  { id: 'region', label: 'Region flagship', blurb: 'Four doors under one name — the map finally has a region on it.', deposit: 6500, rent: 170 },
]

const MANAGER_NAMES = ['Marisol', 'Dell', 'Priya', 'Hank', 'Iris', 'Sol', 'Nadia', 'Bruno', 'Winnie', 'Otis']
const BUYER_NAMES = ['Kyle', 'Amara', 'Theo', 'Sofia', 'Dev', 'Nina', 'Marcus', 'Ellie', 'Raj', 'June', 'Wes', 'Cora']

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Local-calendar day key — matches what new Date().getDay() sees. The
 * weekly payroll guards (district/regional reports) must key on THIS, not
 * the UTC day: a local Sunday spans two UTC dates, and a UTC-keyed guard
 * lets the same local Sunday pay the office twice (invisible in live play
 * unless you run the till after midnight — the fullday sim hit it weekly). */
function localDayKey(at = Date.now()): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayKey(at = Date.now()): string {
  return gameDayKey(at) // store rent + reports are per game-day (12 real hours)
}

export function getFranchise(store = 1): FranchiseRow | undefined {
  return db.prepare(`SELECT * FROM franchise WHERE id = ?`).get(store) as FranchiseRow | undefined
}

export function allStores(): FranchiseRow[] {
  return db.prepare(`SELECT * FROM franchise ORDER BY id`).all() as FranchiseRow[]
}

function tierOf(id: FranchiseRow['tier']): Tier {
  return TIERS.find((t) => t.id === id)!
}

/** Where a store number actually exists. */
function storeExists(store: number): boolean {
  return STORE_IDS.includes(store as 1 | 2 | 3)
}

/** Store 2 needs a DM on payroll — the owner can't be two places at once. */
export function secondStoreUnlocked(): boolean {
  return !!districtRow()
}

/** Store 3 needs a regional manager above the DM — the chain needs a map, not a hero. */
export function thirdStoreUnlocked(): boolean {
  return !!regionalRow()
}

// ---------------------------------------------------------------------------
// District manager
// ---------------------------------------------------------------------------

export type DistrictRow = {
  meta_key: string
  value: string // JSON DistrictManager
}

export type DistrictManager = {
  name: string
  quality: number // 1..5
  wage: number // per day
  hired_at: string
  promoted_from: number | null // shop_employees.id, for internal hires
  promoted_wage: number | null // counter wage they left behind
  coach_streak: number // consecutive weeks with zero shrink found
  loyalty?: number // 0..100 — same trust game as store managers
  raise_demand?: { asked: number; filed: string } | null // an open ask, before you answer it
}

export function districtRow(): DistrictManager | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'chain:districtManager'`).get() as { value: string } | undefined
  return row ? (JSON.parse(row.value) as DistrictManager) : null
}

const DM_NAMES = ['Renata', 'Okafor', 'Lindqvist', 'Beaumont', 'Tanaka']
const DM_BLURBS: Record<number, string> = {
  1: 'Reads one book about management, quotes it constantly. Cheap, and it shows.',
  2: 'Keeps a clipboard and an opinion. Mostly shows up.',
  3: 'Solid operator — walks each floor weekly and remembers the numbers.',
  4: 'Trains managers who go on to run tight counters. Worth the salary.',
  5: 'Could run the region. Chains fight over people like this.',
}
// Wages are per game-day (12 real hours) — half the old 24h-day numbers.
export const DM_BASE = { 1: 7.5, 2: 9.5, 3: 12.5, 4: 16, 5: 21 }

export type DmCandidate = { name: string; quality: number; wage: number; blurb: string }

/** Three DM applicants, refreshed weekly. */
export function dmCandidates(): DmCandidate[] {
  const week = dayKey()
  const key = `chain:dmCandidates:${week}`
  const cached = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined
  if (cached) return JSON.parse(cached.value) as DmCandidate[]
  const fresh: DmCandidate[] = [1, 3, 5].map((q) => ({
    name: pick(DM_NAMES),
    quality: q,
    wage: DM_BASE[q as 1 | 3 | 5],
    blurb: DM_BLURBS[q],
  }))
  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(fresh))
  return fresh
}

/** Flagship counter staff who could step up to district manager. */
function dmInternalCandidates(): InternalCandidate[] {
  return promotionCandidates().filter((c) => c.salesLift >= 20)
}

export function hireDm(payload: { name?: string; quality?: number; wage?: number } | { employeeId: number }) {
  if (districtRow()) return { ok: false as const, error: 'You already have a district manager' }
  const shop = getShop()
  if (!shop) return { ok: false as const, error: 'District managers run stores — lease the flagship first' }
  if ('employeeId' in payload) {
    const emp = db.prepare(`SELECT * FROM shop_employees WHERE id = ? AND role = 'counter'`).get(payload.employeeId) as
      | { id: number; name: string; quality: number; wage: number; sales_lift: number } | undefined
    if (!emp) return { ok: false as const, error: 'No such counter staff at the flagship' }
    if (emp.sales_lift < 20) return { ok: false as const, error: `They've only rung ${emp.sales_lift} sales — district material needs a real track record (20+)` }
    const wage = round2(Math.max(emp.wage + 6, Math.round((9 + emp.quality * 4) * 4) / 4))
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM shop_employees WHERE id = ?`).run(emp.id)
      const dm: DistrictManager = { name: emp.name, quality: emp.quality, wage, hired_at: nowIso(), promoted_from: emp.id, promoted_wage: round2(emp.wage), coach_streak: 0 }
      db.prepare(`INSERT INTO meta (key, value) VALUES ('chain:districtManager', ?)`).run(JSON.stringify(dm))
      logActivity('shop', `${emp.name} steps off the flagship counter and into the district office — ${fmt(wage)}/day, no signing fee. A second location is now within reach.`, 0)
    })
    tx()
    return { ok: true as const, name: emp.name, wage }
  }
  const quality = Number(payload.quality ?? 0)
  const wage = round2(Number(payload.wage ?? 0))
  const name = String(payload.name ?? '').trim()
  if (!DM_BLURBS[quality]) return { ok: false as const, error: 'Unknown candidate' }
  if (Math.abs(wage - DM_BASE[quality as 1 | 3 | 5]) > 0.01) return { ok: false as const, error: 'Wage does not match the candidate' }
  const signing = round2(wage * 7)
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < signing) return { ok: false as const, error: `${fmt(signing)} signing bonus (one week) — you have ${fmt(state.cash)}` }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(signing)
    const dm: DistrictManager = { name, quality, wage, hired_at: nowIso(), promoted_from: null, promoted_wage: null, coach_streak: 0 }
    db.prepare(`INSERT INTO meta (key, value) VALUES ('chain:districtManager', ?)`).run(JSON.stringify(dm))
    pnl.append('overhead', -signing, `District manager signing bonus — ${name}`)
    logActivity('shop', `${name} takes the district office at ${fmt(wage)}/day (${fmt(signing)} signing bonus). The chain can grow beyond one satellite.`, -signing)
  })
  tx()
  return { ok: true as const, name, wage }
}

/** A DM costs money even when the stores hum — but you can let them go. */
export function fireDm() {
  const dm = districtRow()
  if (!dm) return { ok: false as const, error: 'No district manager to let go' }
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM meta WHERE key = 'chain:districtManager'`).run()
    if (dm.promoted_from != null && dm.promoted_wage != null) {
      const slots = (db.prepare(`SELECT COUNT(*) AS n FROM shop_employees WHERE role = 'counter'`).get() as { n: number }).n
      if (slots < 2) db.prepare(`INSERT INTO shop_employees (role, name, wage, quality, hired_at, sales_lift) VALUES ('counter', ?, ?, ?, ?, 0)`).run(dm.name, dm.promoted_wage, dm.quality, nowIso())
    }
    logActivity('shop', `The district office is empty — ${dm.name} is out. Coaching ends, and the salary line with it.`, 0)
  })
  tx()
  return { ok: true as const }
}

// ---------------------------------------------------------------------------
// Opening — requires the main shop (the brand is the franchise)
// ---------------------------------------------------------------------------

export type ManagerCandidate = { name: string; quality: number; wage: number; blurb: string }

/** Five applicants, refreshed weekly — mirrors the staff candidate pattern. */
export function managerCandidates(): ManagerCandidate[] {
  const week = dayKey()
  const key = `franchiseManagers:${week}`
  const cached = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined
  if (cached) return JSON.parse(cached.value) as ManagerCandidate[]
  const fresh: ManagerCandidate[] = [1, 2, 3, 4, 5].map((q) => ({
    name: pick(MANAGER_NAMES),
    quality: q,
    wage: round2(Math.round((3 + q * 1.5) * 4) / 4),
    blurb: q <= 2
      ? 'Eager, cheap, and loose with the register. You get what you pay for.'
      : q === 3
        ? 'Solid, honest on most days, and knows the regulars by name.'
        : q === 4
          ? 'Runs a tight counter. Stock moves, money lands, paperwork clean.'
          : 'Could run the whole chain. Expensive, and worth every cent.',
  }))
  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(fresh))
  return fresh
}

function openChecks(name: string, tier: FranchiseRow['tier'], store: number) {
  const shop = getShop()
  if (!shop) return { ok: false as const, error: 'Lease and run your first shop before franchising — the brand is the business' } as const
  if (!storeExists(store)) return { ok: false as const, error: 'No such location slot' } as const
  if (getFranchise(store)) return { ok: false as const, error: 'That location is already open' } as const
  if (store === 2 && !secondStoreUnlocked()) return { ok: false as const, error: 'Hire a district manager before opening a third location' } as const
  if (store === 3 && !thirdStoreUnlocked()) return { ok: false as const, error: 'Store #3 needs a regional manager over the district — the chain needs a map, not a hero' } as const
  const t = TIERS.find((x) => x.id === tier)
  if (!t) return { ok: false as const, error: 'Unknown tier' } as const
  const clean = (name ?? '').trim().slice(0, 40)
  if (!clean) return { ok: false as const, error: 'Give the location a name' } as const
  const existing = allStores().map((f) => f.name.toLowerCase())
  if (existing.includes(clean.toLowerCase())) return { ok: false as const, error: 'You already run a store by that name' } as const
  return { ok: true as const, t, clean } as const
}

export function open(name: string, tier: FranchiseRow['tier'], managerQuality: number, managerWage: number, managerName: string, store = 1) {
  const chk = openChecks(name, tier, store)
  if (!chk.ok) return chk
  const { t, clean } = chk
  if (!(managerQuality >= 1 && managerQuality <= 5)) return { ok: false as const, error: 'Bad manager quality' }
  if (!(managerWage > 0)) return { ok: false as const, error: 'Wage must be positive' }
  // Hiring fee = one week of the manager's wage, due at signing.
  const signing = round2(t.deposit + managerWage * 7)
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < signing) return { ok: false as const, error: `You need $${signing.toFixed(2)} (deposit + manager signing fee) — you have $${state.cash.toFixed(2)}` }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(signing)
    pnl.appendSatellite('overhead', -round2(managerWage * 7), `Manager signing fee — ${managerName}`, store)
    db.prepare(`INSERT INTO franchise (id, name, tier, manager_name, manager_quality, manager_wage, opened_at, last_rent_day, loyalty, wage_start, manager_since) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 50, ?, ?)`)
      .run(store, clean, t.id, managerName, managerQuality, round2(managerWage), nowIso(), dayKey(), round2(managerWage), nowIso())
    const ordinal = store === 1 ? 'across town' : 'two towns over'
    logActivity('shop', `Franchised! "${clean}" (${t.label}) opens ${ordinal} with ${managerName} managing — $${t.deposit.toFixed(2)} deposit, $${t.rent.toFixed(2)}/day rent, $${round2(managerWage).toFixed(2)}/day wage. Stock the shelves to open the doors.`, -signing)
  })
  tx()
  return { ok: true as const }
}

// ---------------------------------------------------------------------------
// Promote from within — your best counter hand already knows the customers,
// the prices, and where the till is. That cuts both ways: an insider knows
// exactly how the skim works, so the audit signal matters more.
// ---------------------------------------------------------------------------

export type InternalCandidate = {
  employeeId: number
  name: string
  quality: number
  /** What they earn today on the flagship counter. */
  counterWage: number
  /** What they'd earn as manager — exactly what promoteOpen charges. */
  wage: number
  salesLift: number
  /** Honest-management multiplier: their counter track record follows them. */
  leakMult: number
  blurb: string
}

/**
 * Flagship counter staff eligible to run a satellite. Track record converts
 * to a leak multiplier (0.6–1.1×): someone who rang hundreds of fair sales is
 * better with a till than a fresh hire; a short, quiet record is a gamble.
 */
export function promotionCandidates(): InternalCandidate[] {
  const rows = db
    .prepare(`SELECT id, name, quality, wage, sales_lift FROM shop_employees WHERE role = 'counter' ORDER BY sales_lift DESC, quality DESC`)
    .all() as { id: number; name: string; quality: number; wage: number; sales_lift: number }[]
  return rows.map((e) => {
    const lift = e.sales_lift
    const leakMult = round2(Math.min(1.1, Math.max(0.6, 1 - lift * 0.01 + (5 - e.quality) * 0.05)))
    const blurb = lift >= 20
      ? `Rang ${lift} sales at the flagship counter — the regulars would follow them across town.`
      : lift >= 5
        ? `${lift} sales on the flagship counter. Known face, known quantity.`
        : `Barely rang a register (${lift} sales) — a promotion on potential, not proof.`
    return {
      employeeId: e.id,
      name: e.name,
      quality: e.quality,
      counterWage: round2(e.wage),
      wage: round2(Math.max(e.wage + 1, Math.round((2.5 + e.quality * 1.5) * 4) / 4)), // the exact raise promoteOpen grants
      salesLift: lift,
      leakMult,
      blurb,
    }
  })
}

/**
 * Open a satellite with someone already on your payroll: no signing fee,
 * wage stays close to their counter pay, and their track record shapes till
 * honesty. They leave a counter-shaped hole at the flagship.
 */
export function promoteOpen(employeeId: number, name: string, tier: FranchiseRow['tier'], store = 1) {
  const chk = openChecks(name, tier, store)
  if (!chk.ok) return chk
  const { t, clean } = chk
  const emp = db.prepare(`SELECT * FROM shop_employees WHERE id = ? AND role = 'counter'`).get(employeeId) as
    | { id: number; name: string; quality: number; wage: number; sales_lift: number } | undefined
  if (!emp) return { ok: false as const, error: 'No such counter staff at the flagship — hire internally first' }

  // The raise is real but modest: managers earn more than counter help.
  const wage = round2(Math.max(emp.wage + 1, Math.round((2.5 + emp.quality * 1.5) * 4) / 4))
  const signing = round2(t.deposit) // no external signing fee — they already work for you
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < signing) return { ok: false as const, error: `You need ${fmt(signing)} for the deposit — you have ${fmt(state.cash)}` }

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM shop_employees WHERE id = ?`).run(employeeId)
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(signing)
    db.prepare(
      `INSERT INTO franchise (id, name, tier, manager_name, manager_quality, manager_wage, opened_at, last_rent_day, skim_streak, promoted_from, promoted_wage, loyalty, wage_start, manager_since)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 55, ?, ?)`,
    ).run(store, clean, t.id, emp.name, emp.quality, wage, nowIso(), dayKey(), Math.round(emp.sales_lift / 10), employeeId, round2(emp.wage), wage, nowIso()) // proven hands start with a little banked trust (loyalty 55); promoted_wage is their ride home to the counter
    const ordinal = store === 1 ? 'across town' : 'two towns over'
    logActivity('shop', `${emp.name} got the keys to "${clean}" (${t.label}) ${ordinal} — promoted off the flagship counter (${emp.sales_lift} sales rung). No signing fee, ${fmt(wage)}/day wage, and a counter-shaped hole back at the flagship. Stock the shelves to open the doors.`, -signing)
  })
  tx()
  return { ok: true as const, managerName: emp.name, wage }
}

// ---------------------------------------------------------------------------
// The regional manager — hired above the DM once the chain earns a map.
// A DM coaches floors; the regional coaches coaches, plans truck routes, and
// files the Friday report. Unlocking them unlocks store #3.
// ---------------------------------------------------------------------------

export type RegionalManager = {
  name: string
  quality: number // 1..5
  wage: number // per day
  hired_at: string
  loyalty: number // 0..100
  raise_demand?: { asked: number; filed: string } | null
}

const REGIONAL_NAMES = ['Vasquez', 'Okonkwo', 'Petrakis', 'Marchetti', 'Devlin']
const REGIONAL_BLURBS: Record<number, string> = {
  1: 'Watches regional-manager videos at 1.5× speed. Cheap, and the org chart shows it.',
  2: 'Prints spreadsheets the night before. Mostly coherent.',
  3: 'Runs four doors on one page of notes. Solid week after solid week.',
  4: 'Coaches coaches. The district managers sharpen just from the monthly call.',
  5: 'Retail polymath — distributors return their calls before yours.',
}
export const REGIONAL_BASE = { 1: 12, 2: 16, 3: 21, 4: 26, 5: 32 }

export function regionalRow(): RegionalManager | null {
  const r = db.prepare(`SELECT name, quality, wage, hired_at, loyalty, raise_demand FROM regional_managers WHERE id = 1`).get() as
    | { name: string; quality: number; wage: number; hired_at: string; loyalty: number; raise_demand: string | null } | undefined
  if (!r) return null
  return { name: r.name, quality: r.quality, wage: r.wage, hired_at: r.hired_at, loyalty: r.loyalty, raise_demand: r.raise_demand ? JSON.parse(r.raise_demand) : null }
}

function saveRegional(r: RegionalManager) {
  db.prepare(`UPDATE regional_managers SET loyalty = ?, raise_demand = ?, wage = ? WHERE id = 1`).run(r.loyalty, r.raise_demand ? JSON.stringify(r.raise_demand) : null, r.wage)
}

export type RegionalCandidate = { name: string; quality: number; wage: number; blurb: string }

/** Three regional applicants, refreshed weekly. */
export function regionalCandidates(): RegionalCandidate[] {
  const week = dayKey()
  const key = `chain:regionalCandidates:${week}`
  const cached = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined
  if (cached) return JSON.parse(cached.value) as RegionalCandidate[]
  const fresh: RegionalCandidate[] = [1, 3, 5].map((q) => ({
    name: pick(REGIONAL_NAMES),
    quality: q,
    wage: REGIONAL_BASE[q as 1 | 3 | 5],
    blurb: REGIONAL_BLURBS[q],
  }))
  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(fresh))
  return fresh
}

export function hireRegional(name: string, quality: number, wage: number) {
  if (regionalRow()) return { ok: false as const, error: 'You already have a regional manager' }
  if (!districtRow()) return { ok: false as const, error: 'The district manager reports to someone — hire a DM first' }
  if (!REGIONAL_BLURBS[quality]) return { ok: false as const, error: 'Unknown candidate' }
  const clean = (name ?? '').trim().slice(0, 40)
  if (!clean) return { ok: false as const, error: 'Give the candidate a name' }
  if (Math.abs(wage - REGIONAL_BASE[quality as 1 | 3 | 5]) > 0.01) return { ok: false as const, error: 'Wage does not match the candidate' }
  const signing = round2(wage * 7)
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < signing) return { ok: false as const, error: `${fmt(signing)} signing bonus (one week) — you have ${fmt(state.cash)}` }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(signing)
    db.prepare(`INSERT INTO regional_managers (id, name, quality, wage, hired_at, loyalty) VALUES (1, ?, ?, ?, ?, 50)`).run(clean, quality, round2(wage), nowIso())
    pnl.append('overhead', -signing, `Regional manager signing bonus — ${clean}`)
    logActivity('shop', `${clean} takes the regional office at ${fmt(wage)}/day (${fmt(signing)} signing). Store #3 is now within reach — three satellites, four doors, one map.`, -signing)
  })
  tx()
  return { ok: true as const, name: clean, wage }
}

/** Let the regional go. Coaching ends; store #3's slot locks until you rehire. */
export function fireRegional() {
  const r = regionalRow()
  if (!r) return { ok: false as const, error: 'No regional manager to let go' }
  db.prepare(`DELETE FROM regional_managers WHERE id = 1`).run()
  logActivity('shop', `The regional office is empty — ${r.name} is out. Store #3 stays open, but the slot locks shut until someone is hired to run the region again.`, 0)
  return { ok: true as const }
}

/** How much a regional manager sharpens the whole chain, 0..1. */
export function regionalSuppression(): number {
  const r = regionalRow()
  if (!r) return 0
  return Math.min(0.25, r.quality * 0.05)
}

/** The Friday report — the DM's Sunday report, one level up and one week smarter. */
function regionalTick() {
  const r = regionalRow()
  if (!r) return
  const day = new Date().getDay() // 5 = Friday
  const key = `chain:regionalReport:${localDayKey()}`
  if (day !== 5) return
  if (getMeta(key)) return
  const stores = allStores()
  const weekWage = round2(r.wage * 7)
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < weekWage) {
    db.prepare(`DELETE FROM regional_managers WHERE id = 1`).run()
    logActivity('shop', `You couldn't make regional payroll (${fmt(weekWage)}) — ${r.name} cleared the office. Store #3's slot locks until the region is run again.`, 0)
    return
  }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(weekWage)
  pnl.append('payroll', -weekWage, `Regional manager — ${r.name}`)

  const notes: string[] = []
  const revenues = stores.map((f) => ({ f, rev: f.lifetime_revenue }))
  const best = revenues.reduce((a, b) => (b.rev > a.rev ? b : a))
  if (stores.length >= 3) {
    const total = round2(revenues.reduce((a, x) => a + x.rev, 0))
    notes.push(`the ${stores.length}-door map books ${fmt(total)} lifetime`)
  }
  if (best.f) notes.push(`${best.f.name} anchors the region at ${fmt(best.rev)} lifetime`)
  const dm = districtRow()
  if (dm) {
    if (dm.quality >= 4) notes.push(`${dm.name} needs no coaching — ${r.name} spends Fridays on distributor calls instead`)
    else notes.push(`${r.name} coached ${dm.name} on store walks (${dm.quality}★ district is sharpening)`)
    if (dm.quality < 4 && Math.random() < 0.25 + (5 - dm.quality) * 0.12) {
      // A sharp regional lifts the district one notch over time — coaching
      // coaches is the actual job.
      const better = { ...dm, quality: Math.min(5, dm.quality + 1) }
      db.prepare(`UPDATE meta SET value = ? WHERE key = 'chain:districtManager'`).run(JSON.stringify(better))
      notes.push(`${r.name} coached ${dm.name} up to ${better.quality}★`)
    }
  }
  if (stores.length === 0) notes.push('no doors to tour — the office files paperwork and bills you anyway')
  setMeta(key, '1')
  logActivity('shop', `🌎 Regional report: ${stores.length} door${stores.length === 1 ? '' : 's'}. ${notes.join(' · ')}. Salary ${fmt(weekWage)}.`, -weekWage)
}

/** Close one satellite. Promoted managers ride home if the counter has room. */
export function close(store = 1) {
  const f = getFranchise(store)
  if (!f) return { ok: false as const, error: 'No such location to close' }
  const shelfCount = (db.prepare(`SELECT COUNT(*) AS n FROM franchise_shelf_cards WHERE store = ?`).get(store) as { n: number }).n
  // A promoted manager has their old job waiting — unless you filled the
  // counter since. External hires were never yours to begin with.
  const counterSlots = (db.prepare(`SELECT COUNT(*) AS n FROM shop_employees WHERE role = 'counter'`).get() as { n: number }).n
  const canRehire = f.promoted_from != null && f.promoted_wage != null && counterSlots < 2
  const tx = db.transaction(() => {
    if (canRehire) {
      db.prepare(`INSERT INTO shop_employees (role, name, wage, quality, hired_at, sales_lift) VALUES ('counter', ?, ?, ?, ?, 0)`)
        .run(f.manager_name, f.promoted_wage, f.manager_quality, nowIso())
    }
    db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL WHERE status = 'on_shelf' AND id IN (SELECT inventory_id FROM franchise_shelf_cards WHERE store = ?)`).run(store)
    db.prepare(`DELETE FROM franchise_shelf_cards WHERE store = ?`).run(store)
    db.prepare(`DELETE FROM franchise WHERE id = ?`).run(store)
  })
  tx()
  const profit = round2(f.lifetime_revenue - f.lifetime_cost)
  const farewell = canRehire
    ? `${f.manager_name} is back on the flagship counter at ${fmt(f.promoted_wage!)}/day`
    : f.promoted_from != null
      ? `${f.manager_name} wanted their old counter back, but you filled it — they move on`
      : `${f.manager_name} moves on`
  logActivity('shop', `Closed ${f.name}. ${farewell}; ${shelfCount} card${shelfCount === 1 ? '' : 's'} came home. Lifetime: $${f.lifetime_revenue.toFixed(2)} revenue over ${f.customer_count} sales (${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} net of goods).`)
  return { ok: true as const }
}

// ---------------------------------------------------------------------------
// Shelves — one shared pool, shipped anywhere; transfers take a day on the road
// ---------------------------------------------------------------------------

export function shelfMax(store: number): number {
  return store === 2 ? 60 : store === 3 ? 80 : 40 // the region flagship is the biggest box in the chain
}

function shelfUsed(store: number): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM franchise_shelf_cards WHERE store = ?`).get(store) as { n: number }).n
}

/** A card already in the pool (any shelf, any box, or on the road). */
function poolRow(inventoryId: number) {
  return db
    .prepare(`SELECT fsc.inventory_id, fsc.store, fsc.arrived_at, i.status, i.listing_price, i.graded_grade
              FROM franchise_shelf_cards fsc JOIN inventory i ON i.id = fsc.inventory_id
              WHERE fsc.inventory_id = ?`)
    .get(inventoryId) as { inventory_id: number; store: number; arrived_at: string | null; status: string; listing_price: number | null; graded_grade: string | null } | undefined
}

function caseOwner(inventoryId: number): boolean {
  // The flagship's cased stock lives in inventory with status 'in_case'.
  return !!db.prepare(`SELECT 1 FROM shop_case_cards WHERE inventory_id = ?`).get(inventoryId)
}

function setShelfPrice(inventoryId: number, ask: number) {
  db.prepare(`UPDATE inventory SET status = 'on_shelf', listing_price = ?, listed_at = ? WHERE id = ?`).run(round2(ask), nowIso(), inventoryId)
}

function insertShelf(store: number, inventoryId: number, inTransit = false) {
  db.prepare(`INSERT INTO franchise_shelf_cards (store, inventory_id, arrived_at) VALUES (?, ?, ?)`)
    .run(store, inventoryId, inTransit ? nowIso() : null)
}

/**
 * Ship stock into a satellite from anywhere in the pool: your collection,
 * the flagship's cases, or another satellite's shelf. Same-slot shipments
 * go straight up; cross-store moves ride a truck for a day.
 */
export function stock(inventoryId: number, ask: number, store = 1) {
  const f = getFranchise(store)
  if (!f) return { ok: false as const, error: 'Open the location first' }
  if (!ask || ask <= 0) return { ok: false as const, error: 'Set a real price' }
  if (!storeExists(store)) return { ok: false as const, error: 'No such location' }
  const existing = poolRow(inventoryId)
  const row = db.prepare(`SELECT id, card_id, status, graded_grade FROM inventory WHERE id = ?`).get(inventoryId) as
    | { id: number; card_id: string; status: string; graded_grade: string | null } | undefined
  if (!row) return { ok: false as const, error: 'Card not found' }
  if (row.graded_grade) return { ok: false as const, error: 'Slabs stay at the flagship — the vault light is better there' }

  if (existing) {
    // --- Transfer within the pool -------------------------------------------
    if (existing.status !== 'on_shelf') return { ok: false as const, error: 'That card is mid-sale or unavailable' }
    if (existing.store === store) return { ok: false as const, error: 'Already on that shelf — reprice it instead' }
    const from = getFranchise(existing.store)
    if (from) {
      const dmFactor = dmSuppression(existing.store)
      const lossChance = Math.min(0.1, 0.02 * (1.15 - from.manager_quality * 0.18) * (1 - 0.65 * dmFactor))
      if (Math.random() < lossChance) {
        const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(row.card_id) as { name: string }).name
        const tx = db.transaction(() => {
          db.prepare(`DELETE FROM franchise_shelf_cards WHERE inventory_id = ?`).run(inventoryId)
          db.prepare(`UPDATE inventory SET status = 'lost' WHERE id = ?`).run(inventoryId)
          pnl.appendSatellite('overhead', -round2(valueOf(row.card_id, 'normal', 'NM') * 0.1), `Shrink write-off — transfer loss`, store)
          logActivity('shop', `A crate went missing on the road between ${from.name} and ${f.name} — ${name} written off. ${from.manager_name} says drivers shake boxes.`, 0)
        })
        tx()
        return { ok: true as const, transferred: true, lost: true as const }
      }
    }
    const cap = shelfMax(store)
    if (shelfUsed(store) >= cap) return { ok: false as const, error: `${f.name}'s shelves are full (${cap} rows)` }
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM franchise_shelf_cards WHERE inventory_id = ?`).run(inventoryId)
      setShelfPrice(inventoryId, ask)
      insertShelf(store, inventoryId, true) // a day in the truck
    })
    tx()
    const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(row.card_id) as { name: string }).name
    const fromName = from?.name ?? 'the pool'
    logActivity('shop', `Transferred ${name} from ${fromName} to ${f.name} — ask $${round2(ask).toFixed(2)}. On the road until tomorrow.`)
    return { ok: true as const, transferred: true, lost: false as const }
  }

  // --- Fresh shipment from the collection or the flagship ------------------
  if (row.status === 'collection') {
    const onBlock = db.prepare(`SELECT COUNT(*) AS n FROM ebay_auctions WHERE inventory_id = ? AND status = 'live'`).get(inventoryId) as { n: number }
    if (onBlock.n > 0) return { ok: false as const, error: 'That card is on the BidBay auction block — pull the lot or wait for the hammer' }
  } else if (row.status === 'in_case') {
    if (!caseOwner(inventoryId)) return { ok: false as const, error: 'That card is not in your collection or the flagship cases' }
  } else {
    return { ok: false as const, error: 'Only cards in your collection or the flagship cases can go on a shelf' }
  }
  const cap = shelfMax(store)
  if (shelfUsed(store) >= cap) return { ok: false as const, error: `${f.name}'s shelves are full (${cap} rows) — the manager refuses to dust more` }
  import('./binders').then((b) => b.cleanupSlotsForInventory([inventoryId])).catch(() => {})
  const leavingCase = row.status === 'in_case'
  const tx = db.transaction(() => {
    // One card, one listing: shipping a cased card to a satellite empties
    // its flagship case, or the card would sell twice from two rooms.
    if (leavingCase) db.prepare(`DELETE FROM shop_case_cards WHERE inventory_id = ?`).run(inventoryId)
    setShelfPrice(inventoryId, ask)
    insertShelf(store, inventoryId)
  })
  tx()
  const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(row.card_id) as { name: string }).name
  logActivity('shop', leavingCase
    ? `Shipped ${name} to ${f.name} from the flagship cases — shelf ask $${round2(ask).toFixed(2)}`
    : `Shipped ${name} to ${f.name} — shelf ask $${round2(ask).toFixed(2)}`)
  return { ok: true as const, transferred: false, lost: false as const }
}

/** Pull any shelf row back to the collection (free, instant). */
export function unstock(inventoryId: number) {
  const row = db.prepare(`SELECT store FROM franchise_shelf_cards WHERE inventory_id = ?`).get(inventoryId) as { store: number } | undefined
  if (!row) return { ok: false as const, error: 'That card is not on a shelf' }
  db.prepare(`DELETE FROM franchise_shelf_cards WHERE inventory_id = ?`).run(inventoryId)
  db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL WHERE id = ?`).run(inventoryId)
  const f = getFranchise(row.store)
  return { ok: true as const, from: f?.name ?? 'the chain' }
}

/** Collection rows eligible for the shelves (mirrors shop.stockableInventory). */
export function stockableInventory() {
  const rows = db
    .prepare(
      `SELECT i.id, i.card_id, i.variant, i.condition, i.quantity, i.cost_basis,
              c.name, c.image_small, c.rarity, c.number, s.name AS set_name
       FROM inventory i JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
       WHERE i.status = 'collection' AND i.graded_grade IS NULL
       ORDER BY i.favorite DESC, i.acquired_at DESC LIMIT 200`,
    )
    .all() as { id: number; card_id: string; variant: string; condition: string; quantity: number; cost_basis: number; name: string; image_small: string | null; rarity: string | null; number: string; set_name: string }[]
  const out = rows.map((r) => {
    const anchor = valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
    return { ...r, anchor, suggestedAsk: round2(anchor * r.quantity) }
  })
  return { ok: true as const, rows: out }
}

// ---------------------------------------------------------------------------
// Rent day — per satellite, mirrors shop.settleRent
// ---------------------------------------------------------------------------

function settleRent(f: FranchiseRow) {
  const today = dayKey()
  if (f.last_rent_day === today) return
  const stocked = shelfUsed(f.id)
  const tier = tierOf(f.tier)
  db.prepare(`UPDATE franchise SET today_customers = 0, today_revenue = 0, last_rent_day = ? WHERE id = ?`).run(today, f.id)
  if (stocked === 0) {
    const streak = f.no_sale_streak + 1
    db.prepare(`UPDATE franchise SET no_sale_streak = ? WHERE id = ?`).run(streak, f.id)
    logActivity('shop', `${f.name} sat dark again (day ${streak}) — empty shelves, waived rent. ${f.manager_name} swept a lot.`, 0)
    return
  }
  db.prepare(`UPDATE franchise SET no_sale_streak = 0 WHERE id = ?`).run(f.id)
  const rent = tier.rent
  const wages = round2(f.manager_wage)
  const total = round2(rent + wages)
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < total) {
    // Can't carry the store: the manager locks up and finds other work.
    // Shelves come home; the slot survives for you to restaff.
    db.prepare(`DELETE FROM franchise WHERE id = ?`).run(f.id)
    db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL WHERE status = 'on_shelf' AND id IN (SELECT inventory_id FROM franchise_shelf_cards WHERE store = ?)`).run(f.id)
    db.prepare(`DELETE FROM franchise_shelf_cards WHERE store = ?`).run(f.id)
    logActivity('shop', `You couldn't cover ${f.name}'s day (${fmt(total)}) — ${f.manager_name} locked up and quit. ${stocked} row${stocked === 1 ? '' : 's'} of stock came home. The location is closed.`, -0)
    return
  }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(total)
  pnl.appendSatellite('rent', -rent, `${f.name} — ${stocked} rows stocked`, f.id)
  pnl.appendSatellite('payroll', -wages, `${f.manager_name} (manager)`, f.id)
  logActivity('shop', `${f.name}: rent + ${f.manager_name}'s wage — ${fmt(total)} (${stocked} rows stocked)`, -total)
}

function fmt(n: number): string {
  return `$${round2(n).toFixed(2)}`
}

// ---------------------------------------------------------------------------
// The till — walk-in sales with a manager-shaped leak
// ---------------------------------------------------------------------------

function hourCurve(): number {
  const h = new Date().getHours()
  // The night isn't empty — one closer rings stragglers and the last customer
  // always hits the door at 21:55. Without a floor, dead-hour mechanics (the
  // skim among them) could only ever fire at 0.02× traffic — which is never.
  if (h >= 0 && h < 6) return 0.06
  if (h < 8) return 0.08
  if (h < 11) return 0.35
  if (h < 14) return 0.75
  if (h < 16) return 0.55
  if (h < 20) return 1.0
  if (h < 22) return 0.5
  return 0.12
}

function repMultiplier(rep: number): number {
  return Math.max(0.55, 1 + rep / 100)
}

/**
 * How much a district manager suppresses shrink at a given store, 0..1.
 * A great DM scares straight managers a full 65%; a 1★ "leader" barely dents it.
 */
export function dmSuppression(_store: number): number {
  const dm = districtRow()
  if (!dm) return 0
  // A regional manager sharpens every district walk — the whole chain leaks less.
  return Math.min(0.72, dm.quality * 0.13 + regionalSuppression())
}

/**
 * Till honesty. The manager skims only when a sale would be invisible:
 * nobody watches the register at dead hours, and a sale nobody knows about
 * is a sale the books never see. A visited audit resets the skim streak —
 * managed well, honesty compounds. A district manager suppresses it weekly.
 */
/**
 * How unwatched is the till right now? Keyed to the wall-clock NIGHT band,
 * not to the traffic curve: the owner goes home after close, and the later
 * it gets the fewer eyes are on the register. 0 through the whole staffed
 * day, ramping from ~21:00 to the deep-night 0.55 max. (The old math read
 * the traffic curve as "supervision" — which made 2am the only "unwatched"
 * hour and left the skim a mechanic that never fired.)
 */
function unseenFactor(): number {
  const h = new Date().getHours() + new Date().getMinutes() / 60
  if (h >= 21 && h < 24) return round2((h - 21) * 0.18) // ramps 0 → 0.55 across the close
  if (h >= 0 && h < 6) return 0.55 // deep night: nobody's watching
  if (h >= 6 && h < 8) return round2((8 - h) * 0.275) // dawn handover tail
  return 0 // staffed hours: the owner or the flow of customers is watching
}

function managerHonesty(f: FranchiseRow, _hour: number): { leakChance: number; skimRate: number } {
  const q = f.manager_quality
  const unseen = unseenFactor() // late hours are unwatched hours
  const leakChance = Math.min(0.5, unseen * (0.9 - q * 0.16)) // 5★ ≈ 0.10, 1★ ≈ 0.42 at dead hours
  const streakDiscount = Math.min(0.5, f.skim_streak * 0.05) // trust builds, temptation fades
  const dmFactor = dmSuppression(f.id)
  // Loyalty is the difference between skimming because it's easy and
  // protecting the owner who takes care of you: ±25% at the extremes.
  const loyalFactor = loyaltyFactor(f.loyalty)
  return { leakChance: leakChance * (1 - streakDiscount) * (1 - dmFactor) * loyalFactor, skimRate: Math.max(0.08, 0.45 - q * 0.07) }
}

/** Weekly chain beats: DM coaching, reports, and a DM's honest mistakes. */
function districtTick() {
  const dm = districtRow()
  if (!dm) return
  const day = new Date().getDay() // 0 = Sunday
  const key = `chain:dmReport:${localDayKey()}`
  if (day !== 0) return
  if (getMeta(key)) return
  const stores = allStores()
  // Weekly salary — the DM gets paid whether the stores hum or not.
  const weekWage = round2(dm.wage * 7)
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < weekWage) {
    db.prepare(`DELETE FROM meta WHERE key = 'chain:districtManager'`).run()
    if (dm.promoted_from != null && dm.promoted_wage != null) {
      const slots = (db.prepare(`SELECT COUNT(*) AS n FROM shop_employees WHERE role = 'counter'`).get() as { n: number }).n
      if (slots < 2) db.prepare(`INSERT INTO shop_employees (role, name, wage, quality, hired_at, sales_lift) VALUES ('counter', ?, ?, ?, ?, 0)`).run(dm.name, dm.promoted_wage, dm.quality, nowIso())
    }
    logActivity('shop', `You couldn't make district payroll (${fmt(weekWage)}) — ${dm.name} cleared the desk. Coaching ends.`, 0)
    return
  }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(weekWage)
  pnl.append('payroll', -weekWage, `District manager — ${dm.name}`)

  if (stores.length === 0) {
    setMeta(key, '1')
    logActivity('shop', `District report: no stores to run. ${dm.name} reorganizes the file cabinet and bills you anyway.`, -weekWage)
    return
  }
  // Coaching: shrinks the gap between your best and worst store.
  const revenues = stores.map((f) => ({ f, rev: f.lifetime_revenue }))
  const total = revenues.reduce((a, r) => a + r.rev, 0)
  const avg = total / stores.length
  const laggards = revenues.filter((r) => r.rev < avg * 0.75)
  for (const l of laggards) {
    db.prepare(`UPDATE franchise SET reputation = reputation + 1 WHERE id = ?`).run(l.f.id)
  }
  const best = revenues.reduce((a, b) => (b.rev > a.rev ? b : a))
  const worst = revenues.reduce((a, b) => (b.rev < a.rev ? b : a))
  const net = round2(total)
  const notes: string[] = []
  if (laggards.length > 0) {
    notes.push(`${dm.name} spent Tuesday at ${worst.f.name} coaching ${worst.f.manager_name} (+1 rep, floor traffic up)`)
  } else {
    notes.push(`${dm.name} reports the floor teams are humming`)
  }
  if (stores.length >= 2 && best.f.id !== worst.f.id) {
    notes.push(`${best.f.name} is the anchor store at ${fmt(best.rev)} lifetime vs ${fmt(worst.rev)} at ${worst.f.name}`)
  }
  const shrink = round2((db.prepare(`SELECT COALESCE(SUM(skimmed),0) AS t FROM franchise_sales WHERE sold_at > ?`).get(dm.hired_at) as { t: number }).t)
  if (shrink > 0) {
    notes.push(`${fmt(shrink)} of shrink chased since ${dm.name} took the office`)
  }
  setMeta(key, '1')
  logActivity('shop', `📋 District report: ${stores.length} store${stores.length === 1 ? '' : 's'}, ${fmt(total)} lifetime revenue. ${notes.join(' · ')}. Salary ${fmt(weekWage)}.`, -weekWage)
}

export function chainTick() {
  loyaltyTick() // demands, drift, and resignations — before anyone sells anything
  regionalTick() // Friday: the region's report, above the DM's Sunday one
  districtTick()
  for (const f of allStores()) {
    franchiseTickStore(f)
  }
}

export function franchiseTick() {
  // Back-compat name: the market loop calls chainTick now.
  chainTick()
}

function franchiseTickStore(f: FranchiseRow) {
  settleRent(f)
  const store = f.id
  const displayed = db
    .prepare(
      `SELECT i.id, i.card_id, i.variant, i.condition, i.quantity, i.listing_price, i.cost_basis, fsc.arrived_at
       FROM franchise_shelf_cards fsc JOIN inventory i ON i.id = fsc.inventory_id
       WHERE fsc.store = ?`,
    )
    .all(store) as { id: number; card_id: string; variant: string; condition: string; quantity: number; listing_price: number | null; cost_basis: number; arrived_at: string | null }[]
  if (displayed.length === 0) return

  // Transfers land a game-day after they ship (12h at the 12h clock).
  const today = dayKey()
  for (const r of displayed) {
    if (r.arrived_at && gameDayKey(Date.parse(r.arrived_at)) !== today) {
      db.prepare(`UPDATE franchise_shelf_cards SET arrived_at = NULL WHERE inventory_id = ? AND store = ?`).run(r.id, store)
    }
  }
  const live = displayed.filter((r) => !r.arrived_at || gameDayKey(Date.parse(r.arrived_at)) === today)
  if (live.length === 0) return

  const hour = hourCurve()
  const rep = repMultiplier(f.reputation)
  // A good manager is itself a draw — regulars come to see a pro at work.
  // Loyal managers keep those regulars; a checked-out one loses them. Tuned
  // so quality actually pays: ±25% traffic across the 1★–5★ band (the wage
  // ladder costs ~+$16/day from 1★ to 5★, so a well-run store must out-gross
  // a cheap one by more than its raise — sim:franchise measures it).
  const managerDraw = (1 + (f.manager_quality - 3) * 0.125) * managerLoyaltyDraw(f.loyalty)
  const insertSale = db.prepare(
    `INSERT INTO franchise_sales (store, inventory_id, card_id, quantity, price, cost_basis, buyer, skimmed, sold_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  let cashIn = 0
  let costOut = 0
  let sales = 0
  let skimmed = 0

  for (const r of live) {
    const ask = r.listing_price ?? 0
    if (ask <= 0) continue
    const anchor = valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
    if (anchor <= 0) continue
    const unitAsk = ask / Math.max(1, r.quantity)
    const ratio = unitAsk / anchor
    const priceFactor = Math.min(1.5, Math.max(0.02, 1.45 - ratio))
    const liq = 1 / liquidityFactor(anchor)
    const chance = Math.min(0.28, 0.08 * hour * rep * managerDraw * priceFactor * liq)
    if (Math.random() >= chance) continue

    const buyer = pick(BUYER_NAMES)
    const cost = round2(r.cost_basis * r.quantity)
    const proceeds = round2(ask * r.quantity)

    // The till decision happens before anything is recorded.
    const { leakChance, skimRate } = managerHonesty(f, hour)
    const leaks = Math.random() < leakChance
    const skim = leaks ? round2(proceeds * skimRate) : 0
    const booked = round2(proceeds - skim)

    const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(r.card_id) as { name: string }).name
    insertSale.run(store, r.id, r.card_id, r.quantity, booked, r.cost_basis, buyer, skim, nowIso())
    db.prepare(`UPDATE inventory SET status = 'sold', quantity = 0 WHERE id = ?`).run(r.id)
    db.prepare(`DELETE FROM franchise_shelf_cards WHERE inventory_id = ? AND store = ?`).run(r.id, store)
    db.prepare(
      `INSERT INTO sale_history (inventory_id, card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'shop', ?)`,
    ).run(r.id, r.card_id, r.variant, r.condition, r.quantity, booked, cost, round2(booked - cost), buyer, nowIso())
    cashIn += booked
    costOut += cost
    skimmed += skim
    sales++
    if (skim > 0) {
      logActivity('shop', `${f.name} sold ${r.quantity > 1 ? `${r.quantity}× ` : ''}${name} → ${buyer}. ${f.manager_name} rang ${fmt(booked)}; ${fmt(skim)} never touched the books.`, booked)
    } else {
      logActivity('shop', `${f.name} sale: ${r.quantity > 1 ? `${r.quantity}× ` : ''}${name} → ${buyer} for ${fmt(booked)} (${round2(booked - cost) >= 0 ? '+' : ''}${fmt(round2(booked - cost))} vs cost)`, booked)
    }
    const repDelta = ratio < 0.9 ? 1 : ratio > 1.2 ? -1 : 0
    if (repDelta !== 0) db.prepare(`UPDATE franchise SET reputation = reputation + ? WHERE id = ?`).run(repDelta, store)
  }

  if (cashIn > 0) {
    db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(round2(cashIn))
    db.prepare(
      `UPDATE franchise SET lifetime_revenue = lifetime_revenue + ?, lifetime_cost = lifetime_cost + ?, customer_count = customer_count + ?, today_customers = today_customers + ?, today_revenue = today_revenue + ? WHERE id = ?`,
    ).run(round2(cashIn), round2(costOut), sales, sales, round2(cashIn), store)
    // Sales book under 'cases' at this satellite; the skim just
    // never arrives — the ledger only knows what the till reported.
    pnl.appendSatellite('cases', round2(cashIn), `${sales} shelf sale${sales === 1 ? '' : 's'} via ${f.manager_name}`, store)
    salesTax.collectAt('cases', cashIn, store, `${sales} sale${sales === 1 ? '' : 's'} at ${f.name}`)
  }
  if (skimmed > 0) {
  }
}

/** Audit one satellite: today's real sales vs the books. Resets skim streak when clean. */
export function audit(store = 1) {
  const f = getFranchise(store)
  if (!f) return { ok: false as const, error: 'No such location to audit' }
  const lastAudit = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(`franchise:lastAudit:${store}`) as { value: string } | undefined
  const since = lastAudit?.value ?? f.opened_at
  void since // booked totals include main-shop sales; the useful signal is below

  // Count what the satellite's own ledger reports since the last audit.
  const locationRevenue = (db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM shop_ledger WHERE location = ? AND line = 'cases'`).get(`satellite:${store}`) as { t: number }).t
  const expected = Math.max(0, round2(locationRevenue))
  void expected
  const actualSold = (db.prepare(`SELECT COUNT(*) AS n FROM franchise_sales WHERE store = ? AND skimmed > 0 AND sold_at > ?`).get(store, since) as { n: number }).n
  const skimmedFound = round2((db.prepare(`SELECT COALESCE(SUM(skimmed),0) AS t FROM franchise_sales WHERE store = ? AND skimmed > 0 AND sold_at > ?`).get(store, since) as { t: number }).t)

  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(`franchise:lastAudit:${store}`, nowIso())
  if (skimmedFound > 0) {
    db.prepare(`UPDATE franchise SET skim_streak = 0, loyalty = MAX(0, loyalty - 8) WHERE id = ?`).run(store)
    // Catching it once changes behavior for a while: the manager gets careful.
    logActivity('shop', `Audit at ${f.name}: ${actualSold} unbooked sale${actualSold === 1 ? '' : 's'}, ${fmt(skimmedFound)} missing from the till. ${f.manager_name} suddenly remembers every receipt. The books stay the books — money already gone.`, 0)
    return { ok: true as const, found: skimmedFound, unbooked: actualSold, clean: false, message: `${fmt(skimmedFound)} was skimmed across ${actualSold} sale${actualSold === 1 ? '' : 's'}. You can't un-lose it — but ${f.manager_name} knows that you know.` }
  }
  db.prepare(`UPDATE franchise SET skim_streak = skim_streak + 1 WHERE id = ?`).run(store)
  logActivity('shop', `Audit at ${f.name}: till clean. ${f.manager_name} runs an honest counter (streak ${f.skim_streak + 1}).`, 0)
  return { ok: true as const, found: 0, unbooked: 0, clean: true, message: `Till's clean. ${f.manager_name} runs an honest counter.` }
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export function status() {
  const shop = getShop()
  if (!shop) return { canOpen: false as const, reason: 'Lease your first shop before franchising' }
  const dm = districtRow()
  const stores = allStores()
  const regional = regionalRow()
  const slots = STORE_IDS.filter((id) => !stores.some((f) => f.id === id)).map((id) => ({
    id,
    locked: (id === 2 && !dm) || (id === 3 && !regional),
    lockReason: id === 2 && !dm ? 'Hire a district manager — you can\'t run two satellites alone' : id === 3 && !regional ? 'Hire a regional manager — the map comes before the third door' : null,
    tiers: id === 3 ? TIERS : TIERS.filter((t) => t.id !== 'region'), // the region flagship is store #3's shape
    candidates: managerCandidates(),
    internal: promotionCandidates(),
  }))
  const dmPanel = dm
    ? {
        name: dm.name,
        quality: dm.quality,
        wage: dm.wage,
        coachStreak: dm.coach_streak,
        promoted: dm.promoted_from != null,
        weeklyCost: round2(dm.wage * 7),
        loyalty: dmLoyaltyView(dm),
      }
    : null
  const storePanels = stores.map((f) => {
    const tier = tierOf(f.tier)
    const shelves = db
      .prepare(
        `SELECT i.id, i.card_id, i.variant, i.condition, i.quantity, i.listing_price, i.cost_basis,
                c.name, c.image_small, s.name AS set_name
         FROM franchise_shelf_cards fsc JOIN inventory i ON i.id = fsc.inventory_id
         JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
         WHERE fsc.store = ?`,
      )
      .all(f.id) as { id: number; card_id: string; variant: string; condition: string; quantity: number; listing_price: number | null; cost_basis: number; name: string; image_small: string | null; set_name: string }[]
    const shelfRows = shelves.map((r) => {
      const ask = r.listing_price ?? 0
      const anchor = valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
      const unitAsk = ask / Math.max(1, r.quantity)
      return { ...r, ask, anchor, delta: anchor > 0 ? unitAsk / anchor - 1 : null }
    })
    const recent = db
      .prepare(`SELECT fs.*, c.name FROM franchise_sales fs JOIN cards c ON c.id = fs.card_id WHERE fs.store = ? ORDER BY fs.id DESC LIMIT 12`)
      .all(f.id) as { id: number; name: string; quantity: number; price: number; buyer: string; skimmed: number; sold_at: string }[]
    const lastAudit = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(`franchise:lastAudit:${f.id}`) as { value: string } | undefined
    // Show the risk, not the moment: skimming happens in the unwatched dead
    // hours, so the panel prices the worst case (midnight), not 3pm.
    const honesty = managerHonesty(f, 0)
    return {
      id: f.id,
      name: f.name,
      tier: f.tier,
      tierLabel: tier.label,
      rent: tier.rent,
      managerName: f.manager_name,
      managerQuality: f.manager_quality,
      managerWage: f.manager_wage,
      promoted: f.promoted_from != null,
      reputation: f.reputation,
      lifetimeRevenue: round2(f.lifetime_revenue),
      lifetimeCost: round2(f.lifetime_cost),
      customerCount: f.customer_count,
      todayCustomers: f.today_customers,
      todayRevenue: round2(f.today_revenue),
      shelfUnits: shelfRows.reduce((a, r) => a + r.quantity, 0),
      shelfRows: shelfRows.length,
      shelfCap: shelfMax(f.id),
      darkDays: f.no_sale_streak,
      skimStreak: f.skim_streak,
      loyalty: loyaltyView(f),
      interimCandidates: f.manager_wage <= 0 ? managerCandidates() : [],
      leakChance: round2(honesty.leakChance),
      inTransit: shelfRows.length > 0 ? (db.prepare(`SELECT COUNT(*) AS n FROM franchise_shelf_cards WHERE store = ? AND arrived_at IS NOT NULL`).get(f.id) as { n: number }).n : 0,
      shelves: shelfRows,
      recent,
      pnl: pnl.locationStatement(undefined, f.id),
      lastAudit: lastAudit?.value ?? null,
    }
  })
  const regionalPanel = regional
    ? {
        name: regional.name,
        quality: regional.quality,
        wage: regional.wage,
        weeklyCost: round2(regional.wage * 7),
        reportDay: 'Friday',
        unlocks: 'Store #3',
        loyalty: regionalLoyaltyView(regional),
      }
    : null
  return {
    canOpen: true as const,
    dm: dmPanel,
    regional: regionalPanel,
    regionalCandidates: regional ? [] : districtRow() ? regionalCandidates() : [],
    regionalInternal: [], // the DM's job is a different craft — the region hires from outside
    dmCandidates: dm ? [] : dmCandidates(),
    dmInternal: dm ? [] : dmInternalCandidates(),
    stores: storePanels,
    slots,
    chainPnl: pnl.chainStatement(),
    sharedPool: {
      used: (db.prepare(`SELECT COUNT(*) AS n FROM franchise_shelf_cards`).get() as { n: number }).n,
      cap: shelfMax(1) + shelfMax(2) + shelfMax(3),
    },
  }
}
