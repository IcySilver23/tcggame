import { db, nowIso, logActivity } from '../lib/db'
import { gameDayMs } from '../lib/gameday'
import { round2, gradedPriceOf, gradedPrices } from './market'
import { ensureGradedComp } from './pricesources'
import { taxSavingsEstimate } from './tax'
import * as psarush from './psarush'
import { trueStats } from './substats'
import { guardGrading } from './auth'

// ---------------------------------------------------------------------------
// Grading — send raw cards to a grading service, get a grade back, and value
// the result with REAL PriceCharting PSA/BGS/CGC/SGC price data when available.
// ---------------------------------------------------------------------------

export type GradingService = {
  id: string
  name: string
  cost: number // flat fee per card
  minRawValue: number // minimum raw value worth submitting
  daysMin: number // turnaround in game-days (1 game-day = 1 real UTC day)
  daysMax: number
  gradeBias: number // shifts the grade roll (higher = better grades)
  desc: string
}

export const GRADING_SERVICES: GradingService[] = [
  { id: 'standard', name: 'Standard Grading', cost: 18, minRawValue: 15, daysMin: 3, daysMax: 6, gradeBias: 0, desc: 'Cheap and slow. A fair shot at a 10 — the value pick for clean mid-tier cards.' },
  { id: 'express', name: 'Express Grading', cost: 45, minRawValue: 40, daysMin: 1, daysMax: 2, gradeBias: 0.15, desc: 'Fast turnaround and better handling — the workhorse for $100+ cards.' },
  { id: 'premium', name: 'Premium Grading', cost: 190, minRawValue: 250, daysMin: 1, daysMax: 1, desc: 'White-glove service for serious cards — the best odds at a gem mint, priced for grails.', gradeBias: 0.35 },
]

export const GRADE_LABELS: Record<string, string> = {
  PSA10: 'GEM MNT 10', PSA9: 'MINT 9', PSA8: 'NM-MT 8', PSA7: 'NM 7',
  BGS10: 'BGS PRISTINE 10', CGC10: 'CGC GEM 10', SGC10: 'SGC 10',
}

export type GradeSlot = 'PSA10' | 'PSA9' | 'PSA8' | 'PSA7'

export type GradeRun = {
  serviceId: string
  serviceName: string
  cost: number
  gemChance: number
  evNet: number // EV of net proceeds after the marketplace fee, before the fee
  roi: number // evNet − cost, per dollar of fee (1.0 = double your money)
  recommended: boolean
}

/** ROI of chasing each graded rung on a card you own raw: for every eligible
 *  service, the expected NET profit of submitting (odds × that rung's comp,
 *  minus the marketplace fee, minus the service fee) per dollar of fee. Best
 *  rung = highest ROI. Null when grading never beats selling raw. */
export function bestRoiRung(cardId: string, condition: string, inventoryId?: number): GradeRun[] | null {
  const raw = rawAnchor(cardId)
  if (raw <= 0) return null
  const eligible = GRADING_SERVICES.filter((s) => raw >= s.minRawValue)
  if (eligible.length === 0) return null
  const adj = inventoryId != null ? trueStats(inventoryId).adjustment : 0
  const runs = eligible.map((svc) => {
    const odds = oddsFor(condition, svc.gradeBias, adj)
    const ev = odds.reduce((a, [grade, p]) => a + p * gradedPriceOf(cardId, grade).usd, 0)
    const evNet = round2(ev * (1 - SALE_FEE))
    const net = evNet - svc.cost
    return {
      serviceId: svc.id,
      serviceName: svc.name,
      cost: svc.cost,
      gemChance: Math.round(odds[0][1] * 100),
      evNet,
      roi: round2(net / svc.cost),
      recommended: net > raw * (1 - SALE_FEE),
    }
  })
  // Returned whenever grading is even possible — a rough copy gets an honest
  // "not worth it" run list (recommended: false) rather than silence.
  return runs
}

/** Grade odds depend on the card's raw condition — and its hidden sub-stats.
 *  `adj` is the sub-stat grade adjustment (−2..+0.7): a whitening-disaster NM
 *  grades like an LP, a perfectly-centered NM becomes a gem machine. Exposed
 *  for advice math.
 *
 *  Balance notes (post sub-stats pass):
 *  • The adjustment applies as a MULTIPLICATIVE taper (clamped exponent), not
 *    an additive shift — the old additive form had a cliff at adj −0.3 where
 *    gem odds collapsed 28%→2% in one step and every finer penalty was
 *    invisible. Now each quarter-grade of flaw smoothly compounds.
 *  • A NM copy with a perfectly clean sub-stat profile (adj +0.5) tops out at
 *    56% gem on standard — better than baseline, still a gamble. Premium
 *    remains the best route to a gem (72%) and stays priced for grails.
 *  • The gem floor rises 2% → 5%: total hopelessness was fake variance and
 *    made low-end submission outcomes feel scripted. */
export function oddsFor(condition: string, bias: number, adj = 0): [GradeSlot, number][] {
  const condFactor = condition === 'NM' ? 0 : condition === 'LP' ? -0.25 : condition === 'MP' ? -0.55 : -0.95
  const eff = condFactor + adj
  const taper = Math.pow(2, Math.max(-2.5, Math.min(1, eff))) // smooth 2^eff compounding
  let gem = Math.max(0.05, Math.min(0.72, (0.24 + bias * 0.5) * taper))
  // Nine grows slower above baseline so a great copy's upside lands on GEM
  // odds (the reason you paid for premium) instead of crowding them out.
  let nine = Math.max(0.05, Math.min(0.5, (0.34 - bias * 0.25) * Math.pow(2, eff > 0 ? Math.min(0.5, eff * 0.4) : Math.max(-2, eff))))
  let eight = Math.max(0.05, Math.min(0.4, 0.24 * Math.pow(2, Math.max(-1.5, Math.min(0.5, eff * 0.6)))))
  // Normalize the overflow away when a great copy pushes the top three past 1:
  // trim gem first (preserves the 5% floor), then nine, then eight.
  const over = gem + nine + eight - 0.99
  if (over > 0) {
    const gCut = Math.min(gem - 0.05, over)
    gem -= gCut
    const over2 = over - gCut
    if (over2 > 0) {
      const nCut = Math.min(nine - 0.05, over2)
      nine -= nCut
      eight = Math.max(0.05, eight - (over2 - nCut))
    }
  }
  const rest = Math.max(0.01, 1 - gem - nine - eight)
  return [
    ['PSA10', gem],
    ['PSA9', nine],
    ['PSA8', eight],
    ['PSA7', rest],
  ]
}

function rollGrade(condition: string, bias: number, adj = 0): GradeSlot {
  const odds = oddsFor(condition, bias, adj)
  let r = Math.random()
  for (const [grade, p] of odds) {
    if (r < p) return grade
    r -= p
  }
  return 'PSA7'
}

function ensureColumns() {
  const cols = db.prepare(`PRAGMA table_info(inventory)`).all() as { name: string }[]
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('grading_service')) db.exec(`ALTER TABLE inventory ADD COLUMN grading_service TEXT`)
  if (!names.has('grading_submitted_at')) db.exec(`ALTER TABLE inventory ADD COLUMN grading_submitted_at TEXT`)
  if (!names.has('grading_due_at')) db.exec(`ALTER TABLE inventory ADD COLUMN grading_due_at TEXT`)
  if (!names.has('grading_cost')) db.exec(`ALTER TABLE inventory ADD COLUMN grading_cost REAL`)
}
ensureColumns()

export function listServices() {
  const base = GRADING_SERVICES.map((s) => {
    // The rush's backlog inflates everyone's quoted turnaround.
    const extra = psarush.backlogDelayDays()
    const special = psarush.specialService()
    return {
      ...s,
      daysMin: s.daysMin + Math.round(extra),
      daysMax: s.daysMax + Math.round(extra),
      rushDelay: extra > 0 ? extra : undefined,
    }
  })
  const special = psarush.specialService()
  return special ? [...base, special as any] : base
}

// ---------------------------------------------------------------------------
// Grade-worthiness advice — expected graded value (net of fees) vs raw value
// ---------------------------------------------------------------------------

const SALE_FEE = 0.10 // marketplace commission on every sale

function rawAnchor(cardId: string): number {
  const q = db.prepare(
    `SELECT kind, market FROM price_records WHERE card_id = ? AND kind IN ('tcgplayer', 'pricecharting', 'ebay') AND market IS NOT NULL
     ORDER BY CASE kind WHEN 'tcgplayer' THEN 0 WHEN 'pricecharting' THEN 1 ELSE 2 END, retrieved_at DESC LIMIT 1`,
  ).get(cardId) as { market: number } | undefined
  return q?.market ?? 0
}

export type GradingAdvice = {
  serviceId: string
  serviceName: string
  cost: number
  expectedValue: number
  expectedProfit: number
  upside: number
  edge: number
  gemChance: number
  recommended: boolean
}

/** Expected-value analysis of grading a specific card with a specific service.
 *  When you own the copy, its hidden sub-stats sharpen the odds. */
export function adviceForCard(cardId: string, condition: string, svc: GradingService, inventoryId?: number): GradingAdvice {
  const adj = inventoryId != null ? trueStats(inventoryId).adjustment : 0
  const odds = oddsFor(condition, svc.gradeBias, adj)
  const ev = odds.reduce((a, [grade, p]) => a + p * gradedPriceOf(cardId, grade).usd, 0)
  const expectedValue = round2(ev)
  const expectedProfit = round2(ev * (1 - SALE_FEE) - svc.cost)
  const gemGrade = odds[0][0]
  const upside = round2(gradedPriceOf(cardId, gemGrade).usd * (1 - SALE_FEE) - svc.cost)
  const raw = rawAnchor(cardId)
  const edge = round2(expectedProfit - raw * (1 - SALE_FEE))
  return {
    serviceId: svc.id,
    serviceName: svc.name,
    cost: svc.cost,
    expectedValue,
    expectedProfit,
    upside,
    edge,
    gemChance: Math.round(odds[0][1] * 100),
    recommended: edge > 0 && expectedProfit > 0,
  }
}

/** Best advice across services for a card, or null when grading makes no sense.
 *  Pass the inventory id when advising on a copy you actually own. While the
 *  $10 PSA special is open it joins the comparison — during a rush the line IS
 *  the market, and for cheap cardboard it beats every standard tier. */
export function gradingAdviceFor(cardId: string, condition: string, inventoryId?: number): GradingAdvice | null {
  const raw = rawAnchor(cardId)
  if (raw <= 0) return null
  const eligible = GRADING_SERVICES.filter((s) => raw >= s.minRawValue)
  const special = psarush.specialService()
  if (special && raw >= special.minRawValue) eligible.push(special as GradingService)
  if (eligible.length === 0) return null
  const advices = eligible.map((s) => adviceForCard(cardId, condition, s, inventoryId))
  const best = advices.reduce((a, b) => (b.edge > a.edge ? b : a))
  return best.recommended ? best : null
}

/** Owned raw cards whose best grading option beats selling raw — the candidates list. */
export function gradingCandidates(limit = 25) {
  const rows = db
    .prepare(
      `SELECT i.id, i.card_id, i.condition, i.cost_basis,
              c.name, c.image_small, c.image_large, c.rarity, s.name AS set_name
       FROM inventory i JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
       WHERE i.status = 'collection' AND i.quantity = 1 AND i.graded_grade IS NULL
       ORDER BY i.acquired_at DESC LIMIT 400`,
    )
    .all() as { id: number; card_id: string; condition: string; cost_basis: number; name: string; image_small: string | null; image_large: string | null; rarity: string | null; set_name: string }[]
  const out: (ReturnType<typeof gradingAdviceFor> & { inventoryId: number; cardId: string; name: string; image: string | null; set: string; condition: string; rawValue: number; taxSavings: ReturnType<typeof taxSavingsEstimate> })[] = []
  for (const r of rows) {
    const raw = rawAnchor(r.card_id)
    // The pool floor is the CHEAPEST OPEN door: normally the $15 standard
    // tier, but while the $10 special runs, $8-and-up cards are gradeable —
    // the exact sweet spot the rush exists for.
    const special = psarush.specialService()
    const floor = special ? Math.min(GRADING_SERVICES[0].minRawValue, special.minRawValue) : GRADING_SERVICES[0].minRawValue
    if (raw < floor) continue // cheaper than the cheapest service — skip fast
    const advice = gradingAdviceFor(r.card_id, r.condition, r.id)
    if (advice) {
      out.push({ ...advice, inventoryId: r.id, cardId: r.card_id, name: r.name, image: r.image_small, set: r.set_name, condition: r.condition, rawValue: round2(raw), taxSavings: taxSavingsEstimate(advice.cost) })
    }
    if (out.length >= limit) break
  }
  out.sort((a, b) => b.edge - a.edge)
  return out
}

export function submitForGrading(inventoryId: number, serviceId: string): { cost: number } {
  // The rush's $10 special is resolved through the rush service (it carries
  // its own quota/backlog state); regular tiers come from the static list.
  const special = serviceId === 'psa_special' ? psarush.specialService() : null
  const svc = (special as unknown as GradingService | null) ?? GRADING_SERVICES.find((s) => s.id === serviceId)
  if (!svc) throw new Error(serviceId === 'psa_special' ? 'The PSA special is not open right now' : 'Unknown grading service')
  const row = db
    .prepare(`SELECT * FROM inventory WHERE id = ? AND status = 'collection' AND quantity = 1`)
    .get(inventoryId) as { id: number; card_id: string; condition: string; graded_grade: string | null } | undefined
  if (!row) throw new Error('Card not available (must be a single unlisted copy in your collection)')
  const onBlock = db.prepare(`SELECT COUNT(*) AS n FROM ebay_auctions WHERE inventory_id = ? AND status = 'live'`).get(inventoryId) as { n: number }
  if (onBlock.n > 0) throw new Error('That card is on the BidBay auction block — pull the lot or wait for the hammer')
  if (row.graded_grade) throw new Error('Card is already graded')
  // AUTH META: labs don't slab unvetted cardboard. A known fake goes nowhere;
  // an unauthenticated raw needs the jacket first — THIS is why everyone pays it.
  const authErr = guardGrading(inventoryId)
  if (authErr) throw new Error(authErr)
  const raw = db.prepare('SELECT market FROM price_records WHERE card_id = ? AND kind = ? AND market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1')
  const anchor = (raw.get(row.card_id, 'tcgplayer') as { market: number } | undefined ?? raw.get(row.card_id, 'pricecharting') as { market: number } | undefined)?.market ?? 0
  if (anchor < svc.minRawValue) {
    throw new Error(`Raw value too low for ${svc.name} (needs $${svc.minRawValue}+ raw value; this card is ~$${anchor.toFixed(2)})`)
  }
  // 1 game-day = 1 REAL UTC day — the same day every other system (rent,
  // payroll, wear, snapshots, the header day clock) gates on. The old 20s
  // clock was a pre-unification relic that made "3–6 game-days" finish in
  // about a minute while the day clock barely moved.
  // PSA rush: the queue inflates every submission's turnaround.
  const delay = Math.round(psarush.backlogDelayDays())
  const dMin = svc.daysMin + delay
  const dMax = svc.daysMax + delay
  const due = new Date(Date.now() + (dMin + Math.random() * (dMax - dMin)) * gameDayMs())
  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < svc.cost) throw new Error(`Not enough cash (grading costs $${svc.cost})`)
  db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(svc.cost)
  db.prepare(
    `UPDATE inventory SET status = 'grading', grading_service = ?, grading_submitted_at = ?, grading_due_at = ?, grading_cost = ?, listing_price = NULL WHERE id = ?`,
  ).run(svc.id, nowIso(), due.toISOString(), svc.cost, inventoryId)
  // Rush accounting (quota burn + backlog growth) AFTER the submission sticks.
  psarush.onSubmission(serviceId, inventoryId)
  logActivity('grading', `Submitted a card to ${svc.name} ($${svc.cost}) — results in ${dMin}–${dMax} game-day${dMax === 1 ? '' : 's'} (real days — watch the header clock)${delay > 0 ? ` — the rush queue adds ~${delay}d` : ''}`, -svc.cost)
  return { cost: svc.cost }
}

/** Returns inventory ids whose grade was revealed this tick. */
export function resolveGrading(): number[] {
  const due = db
    .prepare(`SELECT * FROM inventory WHERE status = 'grading' AND grading_due_at IS NOT NULL AND grading_due_at <= ?`)
    .all(nowIso()) as { id: number; card_id: string; condition: string; grading_service: string | null }[]
  const revealed: number[] = []
  for (const row of due) {
    const svc = GRADING_SERVICES.find((s) => s.id === row.grading_service) ?? GRADING_SERVICES[0]
    // Sub-stats decide: the hidden traits of THIS copy shift the grade roll.
    const adj = trueStats(row.id).adjustment
    const grade = rollGrade(row.condition, svc.gradeBias, adj)
    const value = gradedPriceOf(row.card_id, grade)
    // Keep grading_service for per-service stats attribution; clear only the in-flight fields.
    db.prepare(
      `UPDATE inventory SET status = 'collection', graded_grade = ?, condition = 'NM', grading_submitted_at = NULL, grading_due_at = NULL WHERE id = ?`,
    ).run(grade, row.id)
    const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(row.card_id) as { name: string } | undefined)?.name ?? row.card_id
    logActivity(
      'grading',
      value.source === 'live'
        ? `${name} came back ${GRADE_LABELS[grade] ?? grade} — PriceCharting values it at $${value.usd.toFixed(2)}`
        : `${name} came back ${GRADE_LABELS[grade] ?? grade} — estimated value $${value.usd.toFixed(2)}`,
    )
    revealed.push(row.id)
    // Slabs are sealed — clear any leftover protection state so the wear
    // engine never looks at them again.
    import('./supplies').then((s) => s.markSlabbed([row.id])).catch(() => {})
    // Fire-and-forget: top up missing real grade prices for this card's other
    // grades via PriceCharting/eBay comps so the reveal table is full.
    for (const g of ['PSA10', 'PSA9', 'PSA8', 'PSA7']) {
      void ensureGradedComp(row.card_id, g).catch(() => {})
    }
  }
  return revealed
}

/** The dramatic reveal: grade + real value for a freshly graded card. */
export function revealResult(inventoryId: number) {
  const row = db
    .prepare(`SELECT i.*, c.name FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ?`)
    .get(inventoryId) as { id: number; card_id: string; name: string; graded_grade: string | null; cost_basis: number } | undefined
  if (!row || !row.graded_grade) return null
  const quote = gradedPriceOf(row.card_id, row.graded_grade)
  const raw = gradedPrices(row.card_id)
  return {
    inventoryId: row.id,
    cardId: row.card_id,
    name: row.name,
    grade: row.graded_grade,
    gradeLabel: GRADE_LABELS[row.graded_grade] ?? row.graded_grade,
    value: quote.usd,
    valueSource: quote.source,
    costBasis: row.cost_basis,
    allGrades: raw,
    profitIfSoldNow: round2(quote.usd * 0.9 - row.cost_basis),
  }
}

/** Cards currently at the grading company. */
export function pendingGrading() {
  return db
    .prepare(
      `SELECT i.id, i.card_id, i.condition, i.grading_service, i.grading_due_at, i.cost_basis, c.name, c.image_small, c.image_large, c.rarity
       FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.status = 'grading' ORDER BY i.grading_due_at ASC`,
    )
    .all() as { id: number; card_id: string; condition: string; grading_service: string | null; grading_due_at: string; cost_basis: number; name: string; image_small: string | null; image_large: string | null; rarity: string | null }[]
}

// ---------------------------------------------------------------------------
// Stats — submission history, grade distribution, ROI per service
// ---------------------------------------------------------------------------

const GEM_GRADES = ['PSA10', 'BGS10', 'CGC10', 'SGC10']

type ServiceRow = {
  grading_service: string | null
  submitted: number
  spent: number
  returned: number
  gems: number
  sold_count: number
  revenue: number
  fees: number
  profit: number
  unrealizedValue?: number
}

function serviceRollups(): ServiceRow[] {
  // Submission side: every inventory row that ever went through grading.
  const submissions = db
    .prepare(
      `SELECT grading_service, COUNT(*) AS submitted, COALESCE(SUM(grading_cost), 0) AS spent,
              SUM(CASE WHEN graded_grade IS NOT NULL THEN 1 ELSE 0 END) AS returned,
              SUM(CASE WHEN graded_grade IN ('PSA10','BGS10','CGC10','SGC10') THEN 1 ELSE 0 END) AS gems
       FROM inventory WHERE grading_service IS NOT NULL OR grading_cost IS NOT NULL
       GROUP BY grading_service`,
    )
    .all() as { grading_service: string | null; submitted: number; spent: number; returned: number; gems: number }[]

  // Sales side: graded sales joined back to their service. Grading fees are
  // deducted from profit so ROI reflects the all-in cost.
  const sales = db
    .prepare(
      `SELECT i.grading_service AS grading_service, COUNT(*) AS sold_count,
              COALESCE(SUM(sh.sale_price), 0) AS revenue, COALESCE(SUM(sh.fee), 0) AS fees,
              COALESCE(SUM(sh.profit - COALESCE(i.grading_cost, 0)), 0) AS profit
       FROM sale_history sh JOIN inventory i ON i.id = sh.inventory_id
       WHERE sh.sale_type = 'graded'
       GROUP BY i.grading_service`,
    )
    .all() as { grading_service: string | null; sold_count: number; revenue: number; fees: number; profit: number }[]

  const byService = new Map<string, ServiceRow>()
  const keyOf = (s: string | null) => s ?? 'unknown'
  for (const row of submissions) {
    byService.set(keyOf(row.grading_service), {
      grading_service: row.grading_service,
      submitted: row.submitted,
      spent: row.spent,
      returned: row.returned ?? 0,
      gems: row.gems ?? 0,
      sold_count: 0,
      revenue: 0,
      fees: 0,
      profit: 0,
    })
  }
  for (const row of sales) {
    const existing = byService.get(keyOf(row.grading_service))
    if (existing) {
      existing.sold_count = row.sold_count
      existing.revenue = row.revenue
      existing.fees = row.fees
      existing.profit = row.profit
    } else {
      byService.set(keyOf(row.grading_service), {
        grading_service: row.grading_service,
        submitted: 0,
        spent: 0,
        returned: 0,
        gems: 0,
        sold_count: row.sold_count,
        revenue: row.revenue,
        fees: row.fees,
        profit: row.profit,
      })
    }
  }
  // Unrealized value: graded cards still in the collection, per service.
  for (const row of db
    .prepare(
      `SELECT grading_service, graded_grade, card_id FROM inventory
       WHERE graded_grade IS NOT NULL AND status IN ('collection', 'listed')`,
    )
    .all() as { grading_service: string | null; graded_grade: string; card_id: string }[]) {
    const svc = byService.get(keyOf(row.grading_service))
    if (!svc) continue
    svc.unrealizedValue = (svc.unrealizedValue ?? 0) + gradedPriceOf(row.card_id, row.graded_grade).usd
  }
  return [...byService.values()]
}

export function gradingStats(candidates?: ReturnType<typeof gradingCandidates>) {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS submitted, COALESCE(SUM(grading_cost), 0) AS spent,
              SUM(CASE WHEN graded_grade IS NOT NULL THEN 1 ELSE 0 END) AS returned,
              SUM(CASE WHEN graded_grade IN ('PSA10','BGS10','CGC10','SGC10') THEN 1 ELSE 0 END) AS gems,
              SUM(CASE WHEN status = 'grading' THEN 1 ELSE 0 END) AS pending
       FROM inventory WHERE grading_service IS NOT NULL OR grading_cost IS NOT NULL`,
    )
    .get() as { submitted: number; spent: number; returned: number; gems: number; pending: number }

  const sold = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(sh.sale_price), 0) AS revenue, COALESCE(SUM(sh.fee), 0) AS fees,
              COALESCE(SUM(sh.profit - COALESCE(i.grading_cost, 0)), 0) AS profit
       FROM sale_history sh LEFT JOIN inventory i ON i.id = sh.inventory_id
       WHERE sh.sale_type = 'graded'`,
    )
    .get() as { n: number; revenue: number; fees: number; profit: number }

  const unrealized = db
    .prepare(
      `SELECT i.graded_grade, i.card_id FROM inventory i
       WHERE i.graded_grade IS NOT NULL AND i.status IN ('collection', 'listed')`,
    )
    .all()
    .reduce<number>((a: number, r) => a + gradedPriceOf((r as { card_id: string }).card_id, (r as { graded_grade: string }).graded_grade).usd, 0)

  const distribution = db
    .prepare(
      `SELECT graded_grade AS grade, COUNT(*) AS n FROM inventory
       WHERE graded_grade IS NOT NULL GROUP BY graded_grade`,
    )
    .all() as { grade: string; n: number }[]

  const history = db
    .prepare(
      `SELECT sh.id, sh.inventory_id, sh.card_id, sh.sale_price, sh.fee, sh.cost_basis, sh.sold_at,
              sh.profit - COALESCE(i.grading_cost, 0) AS profit,
              c.name, c.image_small, i.graded_grade AS grade, i.grading_service AS service, i.grading_cost AS grading_cost
       FROM sale_history sh
       JOIN inventory i ON i.id = sh.inventory_id
       JOIN cards c ON c.id = sh.card_id
       WHERE sh.sale_type = 'graded'
       ORDER BY sh.id DESC LIMIT 40`,
    )
    .all() as { id: number; inventory_id: number; card_id: string; sale_price: number; fee: number; profit: number; cost_basis: number; sold_at: string; name: string; image_small: string | null; grade: string; service: string | null; grading_cost: number | null }[]

  const services = serviceRollups()
  const totalSpent = round2(totals.spent)
  const totalProfit = round2(sold.profit)
  return {
    totals: {
      submitted: totals.submitted,
      spent: totalSpent,
      returned: totals.returned ?? 0,
      gems: totals.gems ?? 0,
      pending: totals.pending ?? 0,
      soldCount: sold.n,
      revenue: round2(sold.revenue),
      fees: round2(sold.fees),
      profit: totalProfit,
      unrealized: round2(unrealized),
      net: round2(totalProfit + unrealized - totalSpent),
      gemRate: totals.returned ? Math.round(((totals.gems ?? 0) / totals.returned) * 100) : null,
    },
    services: services.map((s) => ({
      service: s.grading_service,
      submitted: s.submitted,
      spent: round2(s.spent),
      returned: s.returned,
      gems: s.gems,
      gemRate: s.returned ? Math.round((s.gems / s.returned) * 100) : null,
      soldCount: s.sold_count,
      revenue: round2(s.revenue),
      profit: round2(s.profit),
      unrealized: round2(s.unrealizedValue ?? 0),
      roi: s.spent > 0 ? Math.round(((s.profit + (s.unrealizedValue ?? 0) - s.spent) / s.spent) * 100) : null,
    })),
    distribution,
    history,
    candidates: candidates ?? [],
    rush: psarush.section(),
  }
}
