import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { round2 } from './market'

// --- migrations for pre-strategy / pre-quarter databases ---
try { db.exec(`ALTER TABLE tax_filings ADD COLUMN strategy TEXT NOT NULL DEFAULT 'honest'`) } catch { /* exists */ }
try { db.exec(`ALTER TABLE tax_filings ADD COLUMN audited INTEGER NOT NULL DEFAULT 0`) } catch { /* exists */ }
try { db.exec(`ALTER TABLE tax_filings ADD COLUMN penalty REAL NOT NULL DEFAULT 0`) } catch { /* exists */ }
try { db.exec(`ALTER TABLE tax_filings ADD COLUMN fine REAL NOT NULL DEFAULT 0`) } catch { /* exists */ }
try { db.exec(`ALTER TABLE tax_filings RENAME TO tax_filings_old`) } catch { /* renamed */ }

// ---------------------------------------------------------------------------
// TAX STRATEGY — 'honest' claims what you're entitled to. 'aggressive' pads
// the return with phantom deductions (rounding errors, "home office", a
// binder that is definitely a business asset). It cuts the check today, but
// audits roll on the next year's first tick and a caught cheat costs the
// entire tax saved plus 50% — and the city watches you for two more filings.
// ---------------------------------------------------------------------------

export type TaxStrategy = 'honest' | 'aggressive'

// ---------------------------------------------------------------------------
// AUDIT FINDINGS & THE BRIBE — when an audit catches phantoms, the finding
// first lands as a PENDING case (and the 🧾 panel offers two doors):
//   • Pay the penalty — savings × 1.5, straight cash, a −40 credit hit, and
//     the embarrassment costs 10 shop reputation.
//   • Bribe the auditor — cash equal to 2× the penalty, scaled by the
//     auditor's mood (0.8×–1.6×); no credit hit, no reputation loss… but
//     auditors gossip. A refused-or-rejected bribe auto-escalates to the full
//     fine on the next filing cycle, and the next auditor arrives angry
//     (bribes cost 25% more for a while).
// ---------------------------------------------------------------------------

export type AuditFinding = {
  id: number
  month: string
  penalty: number
  phantom: number
  bribePrice: number
  mood: string
  foundAt: string
}

function auditorMood(): number {
  // 0.8 friendly .. 1.6 angry — recent briberies make the next auditor pricier.
  const bribes = Number(getMeta('auditBribeStreak') || 0)
  return round2(Math.min(1.6, 0.8 + bribes * 0.25))
}

function moodLabel(m: number): string {
  if (m <= 0.8) return 'fresh out of the academy'
  if (m <= 1.05) return 'professional but curious'
  if (m <= 1.3) return 'heard about you'
  return 'personally offended by your file'
}

function pushFinding(id: number, month: string, penalty: number, phantom: number) {
  const mood = auditorMood()
  const finding: AuditFinding = {
    id, month, penalty, phantom,
    bribePrice: round2(penalty * 2 * mood),
    mood: moodLabel(mood),
    foundAt: nowIso(),
  }
  const cur = JSON.parse(getMeta('auditFindings') || '[]') as AuditFinding[]
  cur.push(finding)
  setMeta('auditFindings', JSON.stringify(cur))
}

/** Open findings awaiting the pay-or-bribe decision. */
export function auditFindings(): AuditFinding[] {
  return JSON.parse(getMeta('auditFindings') || '[]') as AuditFinding[]
}

function settleFinding(id: number): AuditFinding | undefined {
  const cur = auditFindings()
  const f = cur.find((x) => x.id === id)
  if (!f) return undefined
  setMeta('auditFindings', JSON.stringify(cur.filter((x) => x.id !== id)))
  return f
}

/** Door one: pay the penalty like a citizen. Cash, credit −40, rep −10. */
export function payAuditPenalty(id: number): { ok: true; penalty: number } | { ok: false; error: string } {
  const f = auditFindings().find((x) => x.id === id)
  if (!f) return { ok: false, error: 'That finding has already been settled' }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < f.penalty) return { ok: false, error: `Penalty is $${f.penalty.toFixed(2)} — the register holds $${state.cash.toFixed(2)}` }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(f.penalty)
  try { db.exec(`UPDATE finance SET credit_score = MAX(300, credit_score - 40)`) } catch { /* no finance row */ }
  try { db.exec(`UPDATE shop SET reputation = reputation - 10`) } catch { /* no shop row */ }
  settleFinding(id)
  logActivity('tax', `🚨 Audit settled the honest way — paid $${f.penalty.toFixed(2)} for the ${f.month} finding, credit −40, and the neighborhood heard about it (reputation −10). Your preparer has been let go.`, -f.penalty)
  return { ok: true, penalty: f.penalty }
}

/** Door two: bribe the auditor. Costs 2× the penalty × mood; no record, no credit hit. */
export function bribeAuditor(id: number): { ok: true; amount: number } | { ok: false; error: string } {
  const f = auditFindings().find((x) => x.id === id)
  if (!f) return { ok: false, error: 'That finding has already been settled' }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < f.bribePrice) return { ok: false, error: `The auditor wants $${f.bribePrice.toFixed(2)} — the register holds $${state.cash.toFixed(2)}` }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(f.bribePrice)
  const bribes = Number(getMeta('auditBribeStreak') || 0)
  setMeta('auditBribeStreak', String(Math.min(4, bribes + 1))) // auditors gossip — future bribes cost more
  settleFinding(id)
  logActivity('tax', `🤝 The ${f.month} audit finding… resolved. An envelope changed hands ($${f.bribePrice.toFixed(2)}); the auditor's report will describe the books as "technically confusing but ultimately compliant." No credit hit. No reputation loss. Auditors gossip, though — the next one will cost more.`, -f.bribePrice)
  return { ok: true, amount: f.bribePrice }
}

/** Ignored findings escalate to the full fine on the next filing cycle. */
function escalateFindings() {
  for (const f of auditFindings()) {
    const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
    const charged = Math.min(f.penalty, state.cash) // the city takes what exists
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(charged)
    try { db.exec(`UPDATE finance SET credit_score = MAX(300, credit_score - 40)`) } catch { /* no finance row */ }
    try { db.exec(`UPDATE shop SET reputation = reputation - 10`) } catch { /* no shop row */ }
    logActivity('tax', `🚨 The ${f.month} audit finding ESCALATED — ignored too long, so the city collected the full $${f.penalty.toFixed(2)}${charged < f.penalty ? ` (all the cash it could find: $${charged.toFixed(2)})` : ''}, credit −40, reputation −10. The auditor you didn't bribe remembers.`, -charged)
  }
  if (auditFindings().length > 0) setMeta('auditFindings', '[]')
}
const AUDIT_LOOKBACK_TICKS = 3       // aggressive returns stay auditable for this many filings
const AUDIT_CHANCE = 0.45            // per aggressive return on each audit roll
export const PHANTOM_RATE = 0.35     // fraction of deductions claimed as phantoms
export const AUDIT_PENALTY_MULT = 1.5 // repay the savings + 50%

// ---------------------------------------------------------------------------
// TAX SEASON — the least fun part of any collector business, faithfully
// simulated, now with a BUSINESS LICENSE. Trade without a license and every
// register sale risks a code-enforcement visit; hold one and you pay like a
// real shop: FOUR QUARTERLY ESTIMATED PAYMENTS, then a true-up return after
// each quarter closes:
//   • tax base — quarterly product revenue minus deductible overhead and
//     grading costs, with the small-collector allowance and loss carryforward
//   • estimates — pay any amount any time (the UI suggests 25% of the
//     quarter-to-date estimate); overpayments become a credit against the
//     true-up
//   • true-up — the actual quarterly return: tax owed minus estimate credits;
//     underpaid by more than the safe harbor (80% of the true bill or 100%
//     of last quarter's) and a fine lands on top
// Brackets are progressive; audits roll exactly as before.
// ---------------------------------------------------------------------------

export const LICENSE_FEE = 150                 // annual business license
export const LICENSE_RENEWAL_FEE = 25          // quarterly renewal the city charges to keep it active
export const ESTIMATE_TARGET_RATIO = 0.25      // suggested split of the projected bill
export const SAFE_HARBOR_RATIO = 0.8           // pay 80% of the true bill → no fine
export const LICENSE_FINE = 60                 // caught trading unlicensed
export const LICENSE_GRACE_DAYS = 21           // grace window after renewal lapses

export type LicenseStatus = { licensed: boolean; expiresAt: string | null; daysLeft: number | null; graceUsed: boolean; renewalDue: boolean; renewalFee: number }

// ---------------------------------------------------------------------------
// NONPROFIT CHARTER — register the shop as a 501(c)(3)-style charity and the
// income tax goes away entirely… but so does the hustle. A nonprofit runs on
// mission and margins: walk-in traffic and spending both thin out (customers
// browse, they don't binge), and the register stops collecting sales tax too
// — the mission is exempt, not just the profit. Revoke the charter anytime.
// ---------------------------------------------------------------------------

export const NONPROFIT_CHARTER_FEE = 75       // one-time filing with the city
export const NONPROFIT_TRAFFIC_FACTOR = 0.8   // 20% fewer walk-ins buy
export const NONPROFIT_SPEND_FACTOR = 0.85    // and they spend 15% less per visit

export function isNonprofit(): boolean {
  return getMeta('shopNonprofit') === '1'
}

export function adoptNonprofit(): { ok: true; fee: number } | { ok: false; error: string } {
  if (isNonprofit()) return { ok: false, error: 'The shop is already a registered nonprofit' }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < NONPROFIT_CHARTER_FEE) return { ok: false, error: `Charter filing costs $${NONPROFIT_CHARTER_FEE.toFixed(2)} — you have $${state.cash.toFixed(2)}` }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(NONPROFIT_CHARTER_FEE)
  setMeta('shopNonprofit', '1')
  logActivity('tax', `🕊️ The shop filed for nonprofit status — $${NONPROFIT_CHARTER_FEE.toFixed(2)} charter fee. No more income tax, no more sales tax at the register… and customers feel free to browse without buying. Margin is a four-letter word now.`, -NONPROFIT_CHARTER_FEE)
  return { ok: true, fee: NONPROFIT_CHARTER_FEE }
}

export function revokeNonprofit(): { ok: true } | { ok: false; error: string } {
  if (!isNonprofit()) return { ok: false, error: 'The shop is not a nonprofit' }
  setMeta('shopNonprofit', '0')
  logActivity('tax', `🕊️ Nonprofit charter revoked — welcome back to capitalism. Income tax and sales tax resume next sale; so do the margins.`, 0)
  return { ok: true }
}

const TAX_BRACKETS: { upTo: number; rate: number }[] = [
  { upTo: 1000, rate: 0.0 },   // small-collector allowance — hobby money is yours
  { upTo: 5000, rate: 0.10 },
  { upTo: 15000, rate: 0.18 },
  { upTo: 40000, rate: 0.25 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.32 },
]

/** Progressive rate on taxable profit after deductions and carryforward. */
export function taxDue(taxable: number): { tax: number; rate: number } {
  if (taxable <= 0) return { tax: 0, rate: 0 }
  let remaining = taxable
  let last = 0
  let tax = 0
  for (const b of TAX_BRACKETS) {
    const slice = Math.min(remaining, b.upTo - last)
    if (slice > 0) {
      tax += slice * b.rate
      remaining -= slice
    }
    last = b.upTo
    if (remaining <= 0) break
  }
  return { tax: round2(tax), rate: round2(tax / taxable) }
}

function monthKey(at: number | string = Date.now()): string {
  return new Date(at).toISOString().slice(0, 7)
}

function priorMonth(key = monthKey()): string {
  const d = new Date(key + '-01T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d.toISOString().slice(0, 7)
}

/** Calendar quarter key of a moment: 'YYYY-QN'. */
export function quarterKey(at: number | string = Date.now()): string {
  const d = new Date(at)
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`
}

function priorQuarter(key = quarterKey()): string {
  const [y, q] = key.split('-Q').map(Number) as [number, number]
  return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`
}

function quarterBounds(key: string): { start: string; end: string } {
  const [y, q] = key.split('-Q').map(Number) as [number, number]
  const start = new Date(Date.UTC(y, (q - 1) * 3, 1))
  const end = new Date(Date.UTC(y, q * 3, 1))
  return { start: start.toISOString(), end: end.toISOString() }
}

/** Shop-ledger totals for a period (quarter or month bounds), using exact timestamps. */
function ledgerTotalsBetween(start: string, end: string): { revenue: number; deductions: number; byLine: Record<string, number> } {
  const exact = db
    .prepare(
      `SELECT line, SUM(amount) AS total FROM shop_ledger
       WHERE created_at IS NOT NULL AND created_at >= ? AND created_at < ? GROUP BY line`,
    )
    .all(start, end) as { line: string; total: number }[]
  const byLine: Record<string, number> = {}
  let revenue = 0
  let deductions = 0
  for (const r of exact) {
    byLine[r.line] = round2(r.total)
    if (['cases', 'bulk', 'bags'].includes(r.line)) revenue += r.total
    else if (r.line !== 'sales_tax') deductions += -r.total // sales tax is trust money, never a business expense
  }
  return { revenue: round2(revenue), deductions: round2(deductions), byLine }
}

/** Grading spend in a period, from inventory submission stamps. */
function gradingSpendBetween(start: string, end: string): { total: number; cards: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(grading_cost), 0) AS total, COUNT(*) AS cards
       FROM inventory WHERE grading_cost IS NOT NULL AND grading_submitted_at >= ? AND grading_submitted_at < ?`,
    )
    .get(start, end) as { total: number; cards: number }
  return { total: round2(row.total), cards: row.cards }
}

/** Current loss carryforward from previously filed losing periods. */
function carryforward(): number {
  const row = db
    .prepare(`SELECT COALESCE(taxable, 0) AS t FROM tax_filings ORDER BY id DESC LIMIT 1`)
    .get() as { t: number } | undefined
  return row && row.t < 0 ? -row.t : 0
}

// ---------------------------------------------------------------------------
// BUSINESS LICENSE — trading without one is asking for a code-enforcement
// visit. $150/year; the shopTick nags at 14 days out, auto-renews while cash
// holds (credit +5 for staying registered), and one enforcement visit after
// the 21-day grace costs $60 plus a slap on the feed.
// ---------------------------------------------------------------------------

export function license(): LicenseStatus {
  const expires = getMeta('businessLicenseExpires')
  const renewalDue = getMeta('licenseRenewalDue') === '1'
  if (!expires) return { licensed: false, expiresAt: null, daysLeft: null, graceUsed: false, renewalDue, renewalFee: LICENSE_RENEWAL_FEE }
  const daysLeft = Math.ceil((new Date(expires).getTime() - Date.now()) / 86_400_000)
  return { licensed: true, expiresAt: expires, daysLeft, graceUsed: daysLeft < 0, renewalDue, renewalFee: LICENSE_RENEWAL_FEE }
}

export function renewLicense(): { ok: true; expiresAt: string } | { ok: false; error: string } {
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < LICENSE_FEE + LICENSE_RENEWAL_FEE) return { ok: false, error: `License costs $${(LICENSE_FEE + LICENSE_RENEWAL_FEE).toFixed(2)} with the first quarterly renewal — you have $${state.cash.toFixed(2)}` }
  const from = license()
  // Renewal extends from expiry when early, from now when lapsed.
  const base = from.expiresAt && from.daysLeft !== null && from.daysLeft > 0 ? new Date(from.expiresAt) : new Date()
  base.setUTCFullYear(base.getUTCFullYear() + 1)
  const expiresAt = base.toISOString()
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(LICENSE_FEE + LICENSE_RENEWAL_FEE)
  setMeta('businessLicenseExpires', expiresAt)
  setMeta('licenseRenewalDue', '0')
  setMeta('licenseQuarterCharged', quarterKey())
  db.prepare(`DELETE FROM meta WHERE key = 'licenseRenewalDueSince'`).run()
  logActivity('tax', `🪪 Business license ${from.licensed ? 'renewed' : 'issued'} — $${LICENSE_FEE.toFixed(2)}, valid through ${expiresAt.slice(0, 10)}. The shop is officially a business.`, -LICENSE_FEE)
  return { ok: true, expiresAt }
}

/** Manual back-pay of a stalled quarterly renewal (the 🪪 Pay button). */
export function payQuarterlyRenewal(): { ok: true; amount: number } | { ok: false; error: string } {
  const l = license()
  if (!l.licensed) return { ok: false, error: 'No active license to renew' }
  if (!l.renewalDue) return { ok: false, error: 'Quarterly renewal is already current' }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < LICENSE_RENEWAL_FEE) return { ok: false, error: `You need $${LICENSE_RENEWAL_FEE.toFixed(2)} — the register holds $${state.cash.toFixed(2)}` }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(LICENSE_RENEWAL_FEE)
  setMeta('licenseQuarterCharged', quarterKey())
  setMeta('licenseRenewalDue', '0')
  db.prepare(`DELETE FROM meta WHERE key = 'licenseRenewalDueSince'`).run()
  logActivity('tax', `🪪 Quarterly license renewal paid in person — $${LICENSE_RENEWAL_FEE.toFixed(2)}. Enforcement stands down.`, -LICENSE_RENEWAL_FEE)
  return { ok: true, amount: LICENSE_RENEWAL_FEE }
}

/** Called on the shop tick: the quarterly renewal fee, nag, auto-renew, enforce. */
export function licenseTick() {
  const l = license()
  if (!l.licensed) {
    // Enforcement sweeps rarely — but they do sweep.
    const key = `licenseEnforce:${new Date().toISOString().slice(0, 10)}`
    if (getMeta(key)) return
    if (Math.random() >= 0.06) return
    setMeta(key, nowIso())
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(LICENSE_FINE)
    logActivity('tax', `🪪 Code enforcement fined the shop $${LICENSE_FINE.toFixed(2)} for trading without a business license. Register at city hall — the 🧾 Tax panel takes two clicks.`, -LICENSE_FINE)
    return
  }

  // The city's quarterly renewal fee: charged once per quarter while licensed.
  // Short on cash? It stays due, and 21 days of stalling kills the license.
  const q = quarterKey()
  if (getMeta('licenseQuarterCharged') !== q) {
    const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
    if (state.cash >= LICENSE_RENEWAL_FEE) {
      db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(LICENSE_RENEWAL_FEE)
      setMeta('licenseQuarterCharged', q)
      setMeta('licenseRenewalDue', '0')
      logActivity('tax', `🪪 Quarterly license renewal charged to the city — $${LICENSE_RENEWAL_FEE.toFixed(2)} for ${q}. The paperwork stays current.`, -LICENSE_RENEWAL_FEE)
    } else {
      setMeta('licenseRenewalDue', '1')
    }
  } else if (l.renewalDue) {
    // Still due from earlier this quarter — retry now that cash may exist.
    const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
    if (state.cash >= LICENSE_RENEWAL_FEE) {
      db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(LICENSE_RENEWAL_FEE)
      setMeta('licenseRenewalDue', '0')
      logActivity('tax', `🪪 Back-paid the quarterly license renewal — $${LICENSE_RENEWAL_FEE.toFixed(2)}. Enforcement stands down.`, -LICENSE_RENEWAL_FEE)
    }
  }

  if (l.daysLeft !== null && l.daysLeft <= 14 && l.daysLeft >= 0) {
    const key = `licenseNag:${l.expiresAt!.slice(0, 10)}`
    if (!getMeta(key)) {
      setMeta(key, nowIso())
      logActivity('tax', `🪪 Business license expires in ${l.daysLeft} day${l.daysLeft === 1 ? '' : 's'} — renew for $${LICENSE_FEE.toFixed(2)} from the 🧾 Tax panel before code enforcement notices.`, 0)
    }
    return
  }

  // Lapsed annual term past grace: auto-renew if cash allows, else lapse loudly.
  if (l.daysLeft !== null && l.daysLeft < -LICENSE_GRACE_DAYS) {
    const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
    if (state.cash >= LICENSE_FEE) {
      renewLicense()
      try { db.exec(`UPDATE finance SET credit_score = MIN(850, credit_score + 5)`) } catch { /* no finance row */ }
      logActivity('tax', '🪪 License auto-renewed after the grace window — credit +5 for staying registered.', 0)
    } else {
      setMeta('businessLicenseExpires', '')
      logActivity('tax', `🪪 Business license LAPSED — cash was short for the $${LICENSE_FEE.toFixed(2)} renewal. Trading unlicensed until you renew.`, 0)
    }
    return
  }

  // Quarterly renewal stalled too long: the license dies even mid-term.
  if (l.renewalDue) {
    const issued = getMeta('licenseRenewalDueSince')
    if (!issued) setMeta('licenseRenewalDueSince', nowIso())
    else if (Date.now() - new Date(issued).getTime() > LICENSE_GRACE_DAYS * 86_400_000) {
      setMeta('businessLicenseExpires', '')
      setMeta('licenseRenewalDue', '0')
      db.prepare(`DELETE FROM meta WHERE key = 'licenseRenewalDueSince'`).run()
      logActivity('tax', `🪪 Business license SUSPENDED — the quarterly renewal went unpaid for ${LICENSE_GRACE_DAYS} days. Pay the $${LICENSE_FEE.toFixed(2)} reissuance to trade legally again.`, 0)
    }
  } else {
    db.prepare(`DELETE FROM meta WHERE key = 'licenseRenewalDueSince'`).run()
  }
}

/** True-up preview of a closed quarter (post-filing numbers come from tax_filings). */
export type TaxPreview = {
  quarter: string
  revenue: number
  deductions: number
  grading: { total: number; cards: number }
  profit: number
  carryforwardApplied: number
  carryforwardRemaining: number
  taxable: number
  tax: number
  effectiveRate: number
  filed: boolean
  strategy: TaxStrategy
  phantomDeductions: number
  auditChance: number
  taxSavedIfPhantomsHold: number
  penaltyIfCaught: number
}

/** Preview the true-up for a closed quarter (defaults to the last one). */
export function preview(q = priorQuarter()): TaxPreview {
  const { start, end } = quarterBounds(q)
  const a = assessWindow(start, end)
  const filed = !!db.prepare(`SELECT 1 FROM tax_filings WHERE month = ?`).get(q)
  return {
    quarter: a_relabel(q),
    revenue: a.revenue,
    deductions: a.deductions,
    grading: a.grading,
    profit: a.profit,
    carryforwardApplied: a.applied,
    carryforwardRemaining: a.carryforwardRemaining,
    taxable: a.taxable,
    tax: a.tax,
    effectiveRate: a.rate,
    filed,
    strategy: a.strategy,
    phantomDeductions: a.pm.phantom,
    auditChance: AUDIT_CHANCE,
    taxSavedIfPhantomsHold: a.pm.saved,
    penaltyIfCaught: a.pm.penalty,
  }
}

function a_relabel(q: string): string { return q }

export function currentStrategy(): TaxStrategy {
  return getMeta('taxStrategy') === 'aggressive' ? 'aggressive' : 'honest'
}

/** Switch strategy (honest → aggressive anytime; back to honest clears the watch). */
export function setStrategy(s: TaxStrategy) {
  if (s !== 'honest' && s !== 'aggressive') return { ok: false as const, error: 'Unknown strategy' }
  const prev = currentStrategy()
  setMeta('taxStrategy', s)
  if (prev !== s) {
    logActivity(
      'tax',
      s === 'aggressive'
        ? `🧾 Tax strategy switched to AGGRESSIVE — phantom deductions will pad future returns. Audits roll when those filings come due; a caught cheat repays the savings plus 50%.`
        : `🧾 Tax strategy back to honest books. Whatever the last preparer was doing with that shoebox, it stops today.`,
      0,
    )
  }
  return { ok: true as const, strategy: s }
}

/** How many filed-but-unaudited aggressive returns are still in the window? */
export function pendingAuditCount(): number {
  return pendingAudits()
}

function pendingAudits(): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM tax_filings WHERE strategy = 'aggressive' AND audited = 0 AND tax > 0`)
    .get() as { n: number }
  return row.n
}

/** Estimated savings if the phantoms hold, and the damage if they don't. */
function phantomMath(revenue: number, deductions: number, gradingTotal: number): { phantom: number; saved: number; penalty: number } {
  const phantom = round2((deductions + gradingTotal) * PHANTOM_RATE)
  const honestTax = taxDue(Math.max(0, round2(revenue - deductions - gradingTotal)))
  const aggressiveTax = taxDue(Math.max(0, round2(revenue - deductions - gradingTotal - phantom)))
  const saved = round2(Math.max(0, honestTax.tax - aggressiveTax.tax))
  return { phantom, saved, penalty: round2(saved * AUDIT_PENALTY_MULT) }
}

/** Core assessment math over any window (shared by preview + true-up). */
function assessWindow(start: string, end: string) {
  const { revenue, deductions } = ledgerTotalsBetween(start, end)
  const grading = gradingSpendBetween(start, end)
  const profit = round2(revenue - deductions)
  const cf = carryforward()
  const net = round2(profit - grading.total)
  const applied = net <= 0 ? 0 : Math.min(cf, net)
  const taxable = net <= 0 ? 0 : round2(net - applied)
  const { tax, rate } = taxDue(taxable)
  const strategy = currentStrategy()
  const pm = phantomMath(revenue, deductions, grading.total)
  return { revenue, deductions, grading, profit, cf, applied, taxable, tax, rate, strategy, pm,
    carryforwardRemaining: net < 0 ? round2(cf + -net) : round2(cf - applied) }
}

export type EstimateStatus = {
  quarter: string
  windowStart: string
  windowEnd: string
  running: ReturnType<typeof assessWindow>
  projectedTax: number
  suggestedPayment: number
  paidSoFar: number
  creditFromPrior: number
}

/** Quarter-to-date estimate: what the quarter looks like so far and what to mail in. */
export function estimate(q = quarterKey()): EstimateStatus {
  const { start, end } = quarterBounds(q)
  const running = assessWindow(start, end)
  const paidSoFar = round2(paymentsIn(q))
  const projectedTax = running.tax
  const creditFromPrior = creditCarry()
  const suggested = Math.max(0, round2(projectedTax * ESTIMATE_TARGET_RATIO - creditFromPrior))
  return {
    quarter: q,
    windowStart: start,
    windowEnd: end,
    running: { ...running, cf: undefined } as unknown as ReturnType<typeof assessWindow>,
    projectedTax,
    suggestedPayment: suggested,
    paidSoFar,
    creditFromPrior,
  }
}

/** Payments credited to a quarter so far. */
function paymentsIn(q: string): number {
  const row = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM tax_payments WHERE quarter = ?`).get(q) as { t: number }
  return row.t
}

/** Unused estimate credits rolling forward from the last filed quarter. */
function creditCarry(): number {
  const raw = Number(getMeta('taxCreditCarry') || 0)
  return raw > 0 ? round2(raw) : 0
}

/** Make an estimated payment against the current quarter. */
export function payEstimate(amount: number): { ok: true; amount: number; paidSoFar: number } | { ok: false; error: string } {
  if (!(amount > 0)) return { ok: false, error: 'Payment must be positive' }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < amount) return { ok: false, error: `Only $${state.cash.toFixed(2)} in the register` }
  const q = quarterKey()
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(round2(amount))
  db.prepare(`INSERT INTO tax_payments (quarter, amount, paid_at) VALUES (?, ?, ?)`).run(q, round2(amount), nowIso())
  logActivity('tax', `🧾 Estimated tax payment: $${amount.toFixed(2)} toward ${q}. The city says thanks, probably.`, -round2(amount))
  return { ok: true, amount: round2(amount), paidSoFar: round2(paymentsIn(q)) }
}

/** The tick — escalates stale findings, files the last quarter's true-up once, runs the license clock. */
export function taxTick() {
  import('./shop').then((s) => { const g = s.getShop(); if (g) licenseTick() }).catch(() => {})
  const key = `taxFiled:${quarterKey()}`
  if (getMeta(key)) {
    escalateFindings() // findings always age, even between filings
    return
  }
  setMeta(key, nowIso())
  escalateFindings()
  fileQuarter(priorQuarter())
}

/**
 * The quarterly true-up: the real return after a quarter closes. Estimated
 * payments (plus any credit carried from prior quarters) are applied first;
 * the remainder — or the refund — settles today. Underpaid beyond the safe
 * harbor (80% of the true bill) draws an underpayment fine on the spot.
 * A registered nonprofit files but owes nothing — exempt status on record.
 */
export function fileQuarter(q = priorQuarter()) {
  const existing = db.prepare(`SELECT id FROM tax_filings WHERE month = ?`).get(q)
  if (existing) return { ok: false as const, error: `Tax for ${q} already filed` }

  // Nonprofit: exempt from income tax. Still file (the city loves paperwork).
  if (isNonprofit()) {
    setMeta('taxCreditCarry', '0')
    db.prepare(
      `INSERT OR IGNORE INTO tax_filings (month, revenue, deductions, taxable, carryforward, tax, rate, strategy, audited, penalty, fine, filed_at)
       VALUES (?, 0, 0, 0, 0, 0, 0, 'honest', 1, 0, 0, ?)`,
    ).run(q, nowIso())
    logActivity('tax', `🕊️ Quarterly return for ${q} filed as a nonprofit — exempt. The city stamped it and filed it away.`, 0)
    return { ok: true as const, quarter: q, trueBill: 0, paid: 0, credit: 0, balance: 0, fine: 0, exempt: true }
  }

  const { start, end } = quarterBounds(q)
  const a = assessWindow(start, end)
  const phantom = a.strategy === 'aggressive' ? a.pm.phantom : 0
  const taxableFiled = Math.max(0, round2(a.taxable - phantom))
  const { tax: trueBill, rate: rateFiled } = taxDue(taxableFiled)

  const paid = round2(paymentsIn(q))
  const credit = creditCarry()
  const safeHarbor = round2(trueBill * SAFE_HARBOR_RATIO)
  const fine = paid + credit < safeHarbor && trueBill > 0 ? round2((safeHarbor - paid - credit) * 0.1) : 0
  const balance = round2(trueBill - paid - credit)

  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  const shortfall = Math.max(0, balance - state.cash)

  db.prepare(
    `INSERT INTO tax_filings (month, revenue, deductions, taxable, carryforward, tax, rate, strategy, audited, penalty, fine, filed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
  ).run(
    q,
    a.revenue,
    a.deductions + a.grading.total + phantom,
    round2(a.profit - a.grading.total - phantom - a.applied),
    a.applied,
    trueBill,
    rateFiled,
    a.strategy,
    fine,
    nowIso(),
  )

  const bits: string[] = []
  if (balance > 0) {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(balance)
    bits.push(`balance $${balance.toFixed(2)} due` + (shortfall > 0 ? ` (cash short — IOUs accepted)` : ''))
  } else if (balance < 0) {
    db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(-balance)
    bits.push(`overpayment refund $${(-balance).toFixed(2)} returned`)
  } else {
    bits.push('estimates covered it exactly')
  }
  if (fine > 0) {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(fine)
    bits.push(`underpayment fine $${fine.toFixed(2)} (safe harbor: $${safeHarbor.toFixed(2)}, paid $${round2(paid + credit).toFixed(2)})`)
  }

  // Whatever the estimates + credit didn't consume rolls into next quarter.
  setMeta('taxCreditCarry', String(Math.max(0, round2(paid + credit - trueBill - fine))))

  logActivity(
    'tax',
    `🧾 Quarterly true-up for ${q}: revenue $${a.revenue.toFixed(2)}, deductions $${(a.deductions + a.grading.total + phantom).toFixed(2)}${phantom > 0 ? ' (padded)' : ''}, taxable $${taxableFiled.toFixed(2)} @ ${Math.round(rateFiled * 100)}% → true bill $${trueBill.toFixed(2)}; estimates paid $${paid.toFixed(2)}${credit > 0 ? ` + $${credit.toFixed(2)} prior credit` : ''} → ${bits.join(' · ')}.`,
    -(Math.max(0, balance) + fine),
  )

  rollAudits()
  return { ok: true as const, quarter: q, trueBill, paid, credit, balance, fine }
}

/**
 * Audit season — every filed-but-unaudited AGGRESSIVE return rolls each filing
 * cycle. Caught cheats repay every dollar the phantoms saved plus 50%, take a
 * credit hit, and burn the watch flag. Honest books always pass.
 */
function rollAudits() {
  const pending = db
    .prepare(`SELECT id, month, revenue, deductions, tax, rate FROM tax_filings WHERE strategy = 'aggressive' AND audited = 0 AND tax > 0 ORDER BY month`)
    .all() as { id: number; month: string; revenue: number; deductions: number; tax: number; rate: number }[]
  for (const f of pending) {
    if (Math.random() >= AUDIT_CHANCE) continue
    // Reconstruct what the phantoms saved on this return. The filing stored
    // claimed = real × (1 + PHANTOM_RATE), so invert that — no re-deriving
    // from history, the audited numbers must match what was filed.
    const claimed = f.deductions
    const honestDeductions = round2(claimed / (1 + PHANTOM_RATE))
    const phantom = round2(claimed - honestDeductions)
    const honestTax = taxDue(Math.max(0, round2(f.revenue - honestDeductions))).tax
    const saved = round2(Math.max(0, honestTax - f.tax))
    const penalty = round2(saved * AUDIT_PENALTY_MULT)

    if (penalty > 0) {
      // The finding goes on the desk, not straight to collections — the 🧾 panel
      // offers the two doors. It auto-escalates on the next filing if ignored.
      db.prepare(`UPDATE tax_filings SET audited = 1, penalty = ? WHERE id = ?`).run(penalty, f.id)
      pushFinding(f.id, f.month, penalty, phantom)
      logActivity(
        'tax',
        `🚨 AUDIT FINDING: the ${f.month} return didn't survive the city's shoebox review — $${phantom.toFixed(2)} of phantom deductions disallowed. Penalty: $${penalty.toFixed(2)} (repaid savings + 50%). Settle it from the 🧾 panel… one way or another.`,
        0,
      )
    } else {
      db.prepare(`UPDATE tax_filings SET audited = 1, penalty = 0 WHERE id = ?`).run(f.id)
      logActivity('tax', `🚨 AUDITED: the ${f.month} return got a full review — nothing found. Honest-looking bookkeeping, this time.`, 0)
    }
  }
}

/**
 * What a grading fee saves you on the next month's return, given the current
 * strategy. Honest books: the marginal bracket rate × fee. Aggressive books:
 * the fee also inflates the phantom pool, so 35% more on top.
 */
export function taxSavingsEstimate(fee: number): { honest: number; aggressive: number; bracketRate: number; deductible: boolean } {
  if (!(fee > 0)) return { honest: 0, aggressive: 0, bracketRate: 0, deductible: false }
  const honest = round2(marginalRate() * fee)
  return { honest, aggressive: round2(honest * (1 + PHANTOM_RATE)), bracketRate: marginalRate(), deductible: true }
}

/** The rate your NEXT dollar of deduction removes — the bracket holding this quarter's running profit. */
function marginalRate(): number {
  const { start, end } = quarterBounds(quarterKey())
  const a = assessWindow(start, end)
  const taxable = Math.max(0, a.profit - a.grading.total)
  for (let i = TAX_BRACKETS.length - 1; i >= 0; i--) {
    const lower = i === 0 ? 0 : TAX_BRACKETS[i - 1].upTo
    if (taxable > lower) return TAX_BRACKETS[i].rate
  }
  return 0
}

/** Filing history for the UI. */
export function filings(limit = 12) {
  return db
    .prepare(`SELECT * FROM tax_filings ORDER BY month DESC LIMIT ?`)
    .all(limit) as unknown[]
}
