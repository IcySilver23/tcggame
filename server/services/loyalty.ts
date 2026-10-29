import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayMs, gameDayKey } from '../lib/gameday'
import { round2 } from './market'
import { allStores, districtRow, regionalRow, getFranchise, DM_BASE, REGIONAL_BASE, managerCandidates, type FranchiseRow, type DistrictManager } from './franchise'

// ---------------------------------------------------------------------------
// Manager loyalty & ambition.
//
// A manager is a person, not a stat line. Every day:
//   • pay below the star-rated market rate bleeds trust (up to −1.6/day),
//     fair pay drips it back, premium pay earns a little extra;
//   • tenure compounds — someone two years in gives you credit for the years;
//   • a clean-audit streak builds pride, a fresh bust burns it;
//   • an open ask that you keep ignoring rots what's left.
//
// Ambition is the other half: a store doing real monthly revenue makes a
// manager know exactly what they're worth. Past half of "busy", each day
// brings a chance they sit you down and name a number. Grant it and they're
// all-in; hold and the ask walks with them in seven days — the floor runs on
// interim cover (reduced draw, wage 0) until you hire someone real.
//
// The district manager plays the same game on chain money, on a slower fuse
// (14 days), with chain-wide revenue as their leverage.
// ---------------------------------------------------------------------------

/** Per-day market wage by star rating — mirrors managerCandidates pricing. */
export const MARKET_WAGE: Record<number, number> = { 1: 9, 2: 12, 3: 15, 4: 18, 5: 21 }

const WALK_DAYS = 7 // how long an ignored ask survives before the manager walks
const DM_WALK_DAYS = 14 // DMs give notice-like patience — they have options
const INTERIM = 'Interim cover'

export type Demand = { asked: number; filed: string }

function readDemand(json: string | null | undefined): Demand | null {
  if (!json) return null
  try { return JSON.parse(json) as Demand } catch { return null }
}

function tenureDays(since: string | null | undefined): number {
  if (!since) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / gameDayMs())) // tenure accrues per game-day (12 real hours)
}

function clampLoyalty(v: number): number {
  return Math.max(0, Math.min(100, round2(v)))
}

/**
 * Leak multiplier from loyalty: 1.3× at 0, 1.0× at 50, flat 0.8× from 70 up.
 * The two halves do different jobs — low loyalty leaks (a checked-out manager
 * doesn't watch their own till, and steals more when they do), while high
 * loyalty buys a floor of honesty rather than a shrinking multiplier (the old
 * 0.75× at 100 quietly REWARDED the owner for keeping managers underpaid,
 * since skimming only pays the owner back 50%).
 */
export function loyaltyFactor(loyalty: number | null | undefined): number {
  const l = Math.max(0, Math.min(100, loyalty ?? 50))
  if (l >= 70) return 0.8
  return round2(1.3 - (l / 70) * 0.5)
}

/** Walk-in draw bonus from loyalty: regulars follow people, up to +20%. */
export function managerLoyaltyDraw(loyalty: number | null | undefined): number {
  const l = Math.max(0, Math.min(100, loyalty ?? 50))
  return round2(1 + Math.max(0, l - 60) / 200)
}

/**
 * The raise a busy manager asks for is anchored to headroom, not appetite:
 * nobody prices themselves past 1.3× the market rate for their stars, and
 * the closer to that ceiling they already sit, the smaller the ask. Keeps
 * loyalty's wage ratchet from compounding into a drain (sim:empire measured
 * door wages climbing ~45% in two months of fair management).
 */
function raiseHeadroom(marketWage: number, currentWage: number): number {
  return Math.max(0, 1.3 * marketWage - currentWage)
}

function clampAsk(raw: number, marketWage: number, currentWage: number, minAsk: number, maxAsk: number): number {
  const headroom = raiseHeadroom(marketWage, currentWage)
  return Math.min(maxAsk, Math.max(minAsk, round2(Math.min(raw, headroom) * 4) / 4))
}

export function hasOpenDemand(f: FranchiseRow): boolean {
  return readDemand(f.raise_demand) != null
}

function moodLabel(l: number): string {
  if (l >= 85) return 'all-in'
  if (l >= 65) return 'loyal'
  if (l >= 45) return 'settled'
  if (l >= 25) return 'restless'
  return 'checked out'
}

/** Rolling 30-day booked revenue for a satellite (their leverage number). */
function revenue30(store: number): number {
  const t = db
    .prepare(`SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0) AS s
              FROM shop_ledger WHERE location = ? AND line = 'cases' AND created_at >= ?`)
    .get(`satellite:${store}`, new Date(Date.now() - 30 * 86400000).toISOString()) as { s: number }
  return round2(t.s)
}

function chainRevenue30(): number {
  const t = db
    .prepare(`SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0) AS s
              FROM shop_ledger WHERE location LIKE 'satellite:%' AND line = 'cases' AND created_at >= ?`)
    .get(new Date(Date.now() - 30 * 86400000).toISOString()) as { s: number }
  return round2(t.s)
}

/** What this manager would ask for, given their store's momentum. */
function demandedRaise(f: FranchiseRow, pressure: number): number {
  const market = MARKET_WAGE[f.manager_quality]
  const base = market * 0.3
  const momentum = pressure * market * 0.45
  const service = Math.min(tenureDays(f.manager_since || f.opened_at) / 30, 6) * 0.25
  const roll = 0.85 + Math.random() * 0.3
  return clampAsk((base + momentum + service) * roll, market, f.manager_wage, 1, 14)
}

/** Daily loyalty drift for one satellite manager. */
export function loyaltyDrift(f: FranchiseRow): number {
  const market = MARKET_WAGE[f.manager_quality] ?? 15
  const ratio = f.manager_wage / market
  let drift = 0
  if (ratio < 1) drift -= (1 - ratio) * 1.6 // underpaid bleeds fastest
  else if (ratio >= 1.45) drift += 0.15 // premium pay is remembered
  else drift += 0.05 // fair pay drips trust back
  if (tenureDays(f.manager_since || f.opened_at) >= 60 && ratio >= 1) drift += 0.05 // long service
  if (f.skim_streak >= 3) drift += 0.2 // proven honesty builds pride
  if (f.skim_streak === 0 && f.loyalty > 55) drift -= 0.4 // just caught skimming
  if (readDemand(f.raise_demand)) drift -= 0.5 // an ignored ask rots
  return round2(drift)
}

function fileDemand(f: FranchiseRow, pressure: number) {
  const asked = demandedRaise(f, pressure)
  const demand: Demand = { asked, filed: nowIso() }
  db.prepare(`UPDATE franchise SET raise_demand = ? WHERE id = ?`).run(JSON.stringify(demand), f.id)
  const flavor =
    f.manager_quality >= 4
      ? `${f.manager_name} lays out the numbers you both know: the regulars ask for them by name, and ${f.name} can afford ${fmt(asked)}/day more.`
      : f.manager_quality <= 2
        ? `${f.manager_name} shuffles in after close — the store's moving real volume now, and ${fmt(asked)}/day more would be appreciated.`
        : `${f.manager_name} sits you down: ${f.name} is busy, they're doing the work, and ${fmt(asked)}/day is the number.`
  logActivity('shop', `📣 ${flavor} (${f.manager_quality}★ at ${fmt(f.manager_wage)}/day · ${fmt(revenue30(f.id))} booked last 30 days)`, 0)
}

/** The daily loyalty pass — once per store per day, from the chain tick. */
export function loyaltyTick() {
  const day = dayKey()
  regionalLoyaltyTick(day)
  for (const f of allStores()) {
    if (f.manager_wage <= 0) continue // interim cover isn't a person; skip until a real hire
    const key = `loyalty:${f.id}:${day}`
    if (getMeta(key)) continue
    setMeta(key, '1')

    // 1. Demand countdown: an ask held too long ends with a resignation.
    const demand = readDemand(f.raise_demand)
    if (demand && tenureDays(demand.filed) >= WALK_DAYS) {
      walkOut(f, demand)
      continue
    }

    // 2. Daily drift.
    db.prepare(`UPDATE franchise SET loyalty = ? WHERE id = ?`).run(clampLoyalty(f.loyalty + loyaltyDrift(f)), f.id)

    // 3. Ambition: busy stores make managers brave.
    const rev30 = revenue30(f.id)
    const pressure = Math.max(0, Math.min(1, rev30 / 1400))
    if (!demand && tenureDays(f.manager_since || f.opened_at) >= 21 && pressure >= 0.5) {
      const chance = (pressure - 0.5) * 0.16 * (0.75 + f.manager_quality * 0.1) // stars know their worth
      if (Math.random() < chance) fileDemand(f, pressure)
    }
  }
  dmLoyaltyTick(day)
}

// ---------------------------------------------------------------------------
// District manager — same game, chain-scale leverage, slower fuse
// ---------------------------------------------------------------------------

function dmReadDemand(dm: DistrictManager): Demand | null {
  return dm.raise_demand ?? null
}

// ---------------------------------------------------------------------------
// Regional manager — same trust game, biggest leverage, most patience
// ---------------------------------------------------------------------------

const REGIONAL_WALK_DAYS = 21 // a regional gives a month-ish of notice — they're a professional

function regionalLoyaltyTick(day: string) {
  const r = regionalRow()
  if (!r) return
  const key = `loyalty:regional:${day}`
  if (getMeta(key)) return
  setMeta(key, '1')

  const market = REGIONAL_BASE[r.quality as 1 | 2 | 3 | 4 | 5] ?? 52
  const ratio = r.wage / market
  let drift = 0
  if (ratio < 1) drift -= (1 - ratio) * 1.2
  else if (ratio >= 1.4) drift += 0.1
  else drift += 0.04
  if (tenureDays(r.hired_at) >= 60 && ratio >= 1) drift += 0.04
  if (r.raise_demand) drift -= 0.35

  const loyalty = clampLoyalty((r.loyalty ?? 50) + drift)
  let next = { ...r, loyalty }

  const demand = r.raise_demand ?? null
  if (demand && tenureDays(demand.filed) >= REGIONAL_WALK_DAYS) {
    db.prepare(`DELETE FROM regional_managers WHERE id = 1`).run()
    logActivity('shop', `🚪 ${r.name} resigned by email — ${fmt(demand.asked)}/day was the number and you held. The regional office is empty and store #3's slot locks until the region is run again.`, 0)
    return
  }

  const rev30 = chainRevenue30()
  const pressure = Math.max(0, Math.min(1, rev30 / 4000))
  if (!demand && tenureDays(r.hired_at) >= 21 && pressure >= 0.5) {
    const chance = (pressure - 0.5) * 0.12 * (0.75 + r.quality * 0.1)
    if (Math.random() < chance) {
      const service = Math.min(tenureDays(r.hired_at) / 30, 6) * 0.25
      const asked = clampAsk((market * 0.3 + pressure * market * 0.45 + service) * (0.85 + Math.random() * 0.3), market, r.wage, 3, 24)
      next.raise_demand = { asked, filed: nowIso() }
      logActivity('shop', `📣 ${r.name} closes the regional office door: ${fmt(rev30)} moved through the chain last month. ${fmt(asked)}/day more keeps the map running.`, 0)
    }
  }
  saveRegional(next)
}

function saveRegional(r: { name: string; quality: number; wage: number; hired_at: string; loyalty: number; raise_demand?: { asked: number; filed: string } | null }) {
  db.prepare(`UPDATE regional_managers SET loyalty = ?, raise_demand = ?, wage = ? WHERE id = 1`).run(r.loyalty, r.raise_demand ? JSON.stringify(r.raise_demand) : null, r.wage)
}

export function resolveRegionalDemand(action: 'grant' | 'refuse') {
  const r = regionalRow()
  if (!r) return { ok: false as const, error: 'No regional manager' }
  const demand = r.raise_demand
  if (!demand) return { ok: false as const, error: 'No raise on the table' }
  if (action === 'grant') {
    saveRegional({ ...r, wage: round2(r.wage + demand.asked), loyalty: Math.min(100, (r.loyalty ?? 50) + 14), raise_demand: null })
    logActivity('shop', `🤝 ${r.name} stays on at ${fmt(r.wage + demand.asked)}/day — the truck routes got smarter the same week.`, 0)
    return { ok: true as const, granted: demand.asked, wage: round2(r.wage + demand.asked) }
  }
  const sting = round2(14 + r.quality * 2)
  saveRegional({ ...r, loyalty: Math.max(0, (r.loyalty ?? 50) - sting), raise_demand: null })
  logActivity('shop', `${r.name} takes the "not right now" with a nod — and updates their résumé during lunch.`, 0)
  return { ok: true as const, refused: true as const, loyaltyHit: sting }
}

function dmLoyaltyTick(day: string) {
  const dm = districtRow()
  if (!dm) return
  const key = `loyalty:dm:${day}`
  if (getMeta(key)) return
  setMeta(key, '1')

  const demand = dmReadDemand(dm)
  if (demand && tenureDays(demand.filed) >= DM_WALK_DAYS) {
    dmWalks(dm, demand)
    return
  }

  const market = DM_BASE[dm.quality as 1 | 2 | 3 | 4 | 5] ?? 32
  const ratio = dm.wage / market
  let drift = 0
  if (ratio < 1) drift -= (1 - ratio) * 1.4
  else if (ratio >= 1.4) drift += 0.12
  else drift += 0.04
  if (tenureDays(dm.hired_at) >= 60 && ratio >= 1) drift += 0.05
  if (dm.coach_streak >= 3) drift += 0.15
  if (readDemand(JSON.stringify(dm.raise_demand ?? null))) drift -= 0.4

  const loyalty = clampLoyalty((dm.loyalty ?? 50) + drift)

  const rev30 = chainRevenue30()
  const pressure = Math.max(0, Math.min(1, rev30 / 2400))
  let next: DistrictManager = { ...dm, loyalty }
  if (!demand && tenureDays(dm.hired_at) >= 21 && pressure >= 0.5) {
    const chance = (pressure - 0.5) * 0.14 * (0.75 + dm.quality * 0.1)
    if (Math.random() < chance) {
      const service = Math.min(tenureDays(dm.hired_at) / 30, 6) * 0.25
      const asked = clampAsk((market * 0.3 + pressure * market * 0.45 + service) * (0.85 + Math.random() * 0.3), market, dm.wage, 2, 18)
      next = { ...next, raise_demand: { asked, filed: nowIso() } }
      logActivity('shop', `📣 ${dm.name} closes the district office door: the chain is growing, the salary isn't. ${fmt(asked)}/day more keeps them coaching.`, 0)
    }
  }
  saveDm(next)
}

function saveDm(dm: DistrictManager) {
  db.prepare(`UPDATE meta SET value = ? WHERE key = 'chain:districtManager'`).run(JSON.stringify(dm))
}

// ---------------------------------------------------------------------------
// Resolution — grant, refuse, or wait until they walk
// ---------------------------------------------------------------------------

export function resolveDemand(store: number, action: 'grant' | 'refuse') {
  const f = getFranchise(store)
  if (!f) return { ok: false as const, error: 'No such location' }
  if (f.manager_wage <= 0) return { ok: false as const, error: 'Interim cover has no demands — hire a real manager' }
  const demand = readDemand(f.raise_demand)
  if (!demand) return { ok: false as const, error: 'No raise on the table' }
  if (action === 'grant') {
    db.prepare(`UPDATE franchise SET manager_wage = manager_wage + ?, loyalty = MIN(100, loyalty + 14), raise_demand = NULL WHERE id = ?`).run(demand.asked, f.id)
    logActivity('shop', `🤝 ${f.manager_name} stays — ${fmt(demand.asked)}/day well spent. They tell the floor the owner takes care of people, and the floor believes it.`, 0)
    return { ok: true as const, granted: demand.asked, wage: round2(f.manager_wage + demand.asked) }
  }
  const sting = round2(18 + f.manager_quality * 2)
  db.prepare(`UPDATE franchise SET loyalty = MAX(0, loyalty - ?), raise_demand = NULL WHERE id = ?`).run(sting, f.id)
  logActivity('shop', `${f.manager_name} nods at your "not right now" — and stops going the extra mile for regulars.`, 0)
  return { ok: true as const, refused: true as const, loyaltyHit: sting }
}

export function resolveDmDemand(action: 'grant' | 'refuse') {
  const dm = districtRow()
  if (!dm) return { ok: false as const, error: 'No district manager' }
  const demand = dmReadDemand(dm)
  if (!demand) return { ok: false as const, error: 'No raise on the table' }
  if (action === 'grant') {
    const next: DistrictManager = { ...dm, wage: round2(dm.wage + demand.asked), loyalty: Math.min(100, (dm.loyalty ?? 50) + 14), raise_demand: undefined }
    saveDm(next)
    logActivity('shop', `🤝 ${dm.name} stays on at ${fmt(next.wage)}/day — and the coaching gets sharper the same week.`, 0)
    return { ok: true as const, granted: demand.asked, wage: next.wage }
  }
  const sting = round2(16 + dm.quality * 2)
  const next: DistrictManager = { ...dm, loyalty: Math.max(0, (dm.loyalty ?? 50) - sting), raise_demand: undefined }
  saveDm(next)
  logActivity('shop', `${dm.name} takes the "not right now" professionally — and starts taking calls from recruiters.`, 0)
  return { ok: true as const, refused: true as const, loyaltyHit: sting }
}

// ---------------------------------------------------------------------------
// The walk — an ignored ask becomes a resignation
// ---------------------------------------------------------------------------

function walkOut(f: FranchiseRow, demand: Demand) {
  const promotedHome = f.promoted_from != null && f.promoted_wage != null
    ? (db.prepare(`SELECT COUNT(*) AS n FROM shop_employees WHERE role = 'counter'`).get() as { n: number }).n < 2
    : false
  db.prepare(
    `UPDATE franchise SET manager_name = ?, manager_quality = 1, manager_wage = 0, loyalty = 50, wage_start = NULL, raise_demand = NULL, promoted_from = NULL, promoted_wage = NULL WHERE id = ?`,
  ).run(INTERIM, f.id)
  if (promotedHome) {
    db.prepare(`INSERT INTO shop_employees (role, name, wage, quality, hired_at, sales_lift) VALUES ('counter', ?, ?, ?, ?, 0)`).run(f.manager_name, f.promoted_wage, f.manager_quality, nowIso())
  }
  const flavor = promotedHome
    ? `${f.manager_name} cleaned out the desk overnight — ${fmt(demand.asked)}/day was the number and you held. They're back on the flagship counter at their old rate; the store runs on interim cover.`
    : `${f.manager_name} cleaned out the desk overnight — ${fmt(demand.asked)}/day was the number and you held. ${f.name} runs on interim cover until you hire someone real.`
  logActivity('shop', `🚪 ${flavor}`, 0)
}

function dmWalks(dm: DistrictManager, demand: Demand) {
  db.prepare(`DELETE FROM meta WHERE key = 'chain:districtManager'`).run()
  if (dm.promoted_from != null && dm.promoted_wage != null) {
    const slots = (db.prepare(`SELECT COUNT(*) AS n FROM shop_employees WHERE role = 'counter'`).get() as { n: number }).n
    if (slots < 2) db.prepare(`INSERT INTO shop_employees (role, name, wage, quality, hired_at, sales_lift) VALUES ('counter', ?, ?, ?, ?, 0)`).run(dm.name, dm.promoted_wage, dm.quality, nowIso())
  }
  logActivity('shop', `🚪 ${dm.name} resigned by email — ${fmt(demand.asked)}/day was the number and you held. The district office is empty; store #2 stays open on interim cover but no one is coaching the floors.`, 0)
}

// ---------------------------------------------------------------------------
// Replacement — hire a real manager into a store running on interim cover
// ---------------------------------------------------------------------------

export function replaceManager(store: number, candidateName: string, quality: number, wage: number) {
  const f = getFranchise(store)
  if (!f) return { ok: false as const, error: 'No such location' }
  if (f.manager_wage > 0) return { ok: false as const, error: `${f.manager_name} still runs that floor — close the store to part ways` }
  const cand = managerCandidates().find((c) => c.name === candidateName && c.quality === quality && Math.abs(c.wage - wage) < 0.01)
  if (!cand) return { ok: false as const, error: 'That candidate is not on this week\'s list' }
  db.prepare(
    `UPDATE franchise SET manager_name = ?, manager_quality = ?, manager_wage = ?, manager_since = ?, loyalty = 50, wage_start = ?, raise_demand = NULL WHERE id = ?`,
  ).run(cand.name, cand.quality, cand.wage, nowIso(), cand.wage, store)
  logActivity('shop', `${cand.name} takes the keys to ${f.name} — ${cand.quality}★ at ${fmt(cand.wage)}/day. Fresh start, fresh trust.`, 0)
  return { ok: true as const, name: cand.name, wage: cand.wage }
}

// ---------------------------------------------------------------------------
// Read model fragments for the chain status
// ---------------------------------------------------------------------------

export function loyaltyView(f: FranchiseRow) {
  const demand = readDemand(f.raise_demand)
  const market = MARKET_WAGE[f.manager_quality] ?? 15
  const interim = f.manager_wage <= 0
  return {
    loyalty: round2(f.loyalty ?? 50),
    mood: interim ? 'interim' : moodLabel(f.loyalty ?? 50),
    marketWage: market,
    fairRatio: round2((f.manager_wage / market) * 100) / 100,
    tenureDays: interim ? 0 : tenureDays(f.manager_since || f.opened_at),
    interim,
    demand: demand && !interim ? { asked: demand.asked, daysHeld: tenureDays(demand.filed), walksInDays: Math.max(0, WALK_DAYS - tenureDays(demand.filed)) } : null,
    drawBonus: round2((managerLoyaltyDraw(f.loyalty) - 1) * 100),
  }
}

export function dmLoyaltyView(dm: DistrictManager) {
  const demand = dmReadDemand(dm)
  const market = DM_BASE[dm.quality as 1 | 2 | 3 | 4 | 5] ?? 32
  return {
    loyalty: round2(dm.loyalty ?? 50),
    mood: moodLabel(dm.loyalty ?? 50),
    marketWage: market,
    fairRatio: round2((dm.wage / market) * 100) / 100,
    tenureDays: tenureDays(dm.hired_at),
    demand: demand ? { asked: demand.asked, daysHeld: tenureDays(demand.filed), walksInDays: Math.max(0, DM_WALK_DAYS - tenureDays(demand.filed)) } : null,
  }
}

export function regionalLoyaltyView(r: { name: string; quality: number; wage: number; hired_at: string; loyalty: number; raise_demand?: { asked: number; filed: string } | null }) {
  const market = REGIONAL_BASE[r.quality as 1 | 2 | 3 | 4 | 5] ?? 52
  return {
    loyalty: round2(r.loyalty ?? 50),
    mood: moodLabel(r.loyalty ?? 50),
    marketWage: market,
    fairRatio: round2((r.wage / market) * 100) / 100,
    tenureDays: tenureDays(r.hired_at),
    demand: r.raise_demand ? { asked: r.raise_demand.asked, daysHeld: tenureDays(r.raise_demand.filed), walksInDays: Math.max(0, REGIONAL_WALK_DAYS - tenureDays(r.raise_demand.filed)) } : null,
  }
}

function fmt(n: number): string {
  return `$${round2(n).toFixed(2)}`
}

function dayKey(at = Date.now()): string {
  return gameDayKey(at) // loyalty passes once per game-day
}
