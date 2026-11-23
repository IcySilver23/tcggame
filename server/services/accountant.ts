import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { round2 } from './market'
import * as pnl from './pnl'
import * as tax from './tax'
import * as insurance from './insurance'

// ---------------------------------------------------------------------------
// THE ACCOUNTANT — a retained bookkeeper for the whole operation. P&L-obsessed,
// mildly judgey, and worth every dollar of the weekly retainer:
//
//   • Monday report — the week's revenue → net, then a list of WASTE FLAGS
//     computed from the real books: dead inventory, bare high-value cards,
//     idle supplies, sub-breakeven weeks, idle staff, quarterly-estimate
//     delinquency. Every flag names the dollar amount at stake.
//   • Auto-estimated taxes — pays the suggested 25% quarterly estimate the
//     moment it's affordable, so safe-harbor fines never bite.
//   • Talks you out of cooking the books — files honest even if the strategy
//     is set to aggressive, with a firm note about it.
//   • Filing bonus — with the accountant on retainer, the quarterly return's
//     legitimate deductions earn an extra 5% (found money in the shoebox).
//
// The retainer is $45/week, drafted Monday with the report. Fire anytime.
// ---------------------------------------------------------------------------

export const ACCOUNTANT_WEEKLY_FEE = 45
const DEDUCTION_BONUS = 0.05

type AccountantRow = { name: string; quality: number; hired_at: string }

const NAMES = ['Marge Ledger', 'Vik Numbers', 'Priya Counts', 'Sol Balance', 'Dot Figures', 'Art Writeoff']
const QUIPS = [
  'I have seen the books. We need to talk.',
  'Your P&L is a diary, not a document. Working on it.',
  'Every dollar has a name. Some of yours are missing.',
  'I found money in the shoebox. This is why you pay me.',
  'Margins are a lifestyle, not a mood.',
]

function meta(): AccountantRow | null {
  const raw = getMeta('accountant')
  if (!raw) return null
  try { return JSON.parse(raw) as AccountantRow } catch { return null }
}

export function hired(): boolean { return !!meta() }

/** Extra deductions the accountant finds at filing time (5% of legit deductions). */
export function deductionBonus(deductions: number): number {
  return hired() ? round2(Math.max(0, deductions) * DEDUCTION_BONUS) : 0
}

// ---------------------------------------------------------------------------
// Hiring — a small applicant pool, star-rated like the shop staff.
// ---------------------------------------------------------------------------

type Applicant = { name: string; quality: number; blurb: string }

export function applicants(): Applicant[] {
  const week = new Date().toISOString().slice(0, 10)
  const key = `accountantApplicants:${week}`
  const cached = getMeta(key)
  if (cached) return JSON.parse(cached) as Applicant[]
  const blurbs = [
    'Reconciles receipts for fun. Genuinely concerning at parties.',
    'Ex-IRS. Knows exactly which shoeboxes get opened.',
    'Believes every expense is deductible until proven emotional.',
    'Speaks fluent spreadsheet. Blinks in cash flow.',
    'Finds a missing $12 like it owes them money. It usually does.',
  ]
  const fresh: Applicant[] = [0, 1, 2].map((i) => ({
    name: NAMES[(Math.floor(Math.random() * NAMES.length) + i) % NAMES.length],
    quality: 1 + Math.floor(Math.random() * 5),
    blurb: blurbs[Math.floor(Math.random() * blurbs.length)],
  }))
  setMeta(key, JSON.stringify(fresh))
  for (const k of (db.prepare(`SELECT key FROM meta WHERE key LIKE 'accountantApplicants:%'`).all() as { key: string }[])) {
    if (k.key !== key) db.prepare(`DELETE FROM meta WHERE key = ?`).run(k.key)
  }
  return fresh
}

export function hire(name: string, quality: number): { ok: true; name: string } {
  setMeta('accountant', JSON.stringify({ name, quality, hired_at: nowIso() }))
  logActivity('tax', `🧮 ${name} hired as accountant — $${ACCOUNTANT_WEEKLY_FEE}/week retainer, Mondays. Auto-estimated taxes on, aggressive books discouraged, and the shoebox will finally make sense.`, 0)
  return { ok: true, name }
}

export function fire(): { ok: true } | { ok: false; error: string } {
  const a = meta()
  if (!a) return { ok: false, error: 'There is no accountant to fire' }
  db.prepare(`DELETE FROM meta WHERE key = 'accountant'`).run()
  logActivity('tax', `🧮 ${a.name} collected their last retainer and left with the good pen. Estimates are yours to remember now.`, 0)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// The waste flags — each reads the real tables and returns null when clean.
// ---------------------------------------------------------------------------

export type WasteFlag = { icon: string; title: string; detail: string; atStake: number }

type LedgerTotals = { revenue: number; costs: number; net: number }

function weekTotals(week: string): LedgerTotals {
  const rows = db
    .prepare(`SELECT line, SUM(amount) AS total FROM shop_ledger WHERE week = ? GROUP BY line`)
    .all(week) as { line: pnl.LedgerLine; total: number }[]
  const revenue = round2(rows.filter((r) => ['cases', 'bulk', 'bags', 'repacks', 'consignment', 'shows'].includes(r.line)).reduce((a, r) => a + r.total, 0))
  const costs = round2(Math.abs(rows.filter((r) => ['rent', 'mortgage', 'payroll', 'interest', 'overhead', 'sales_tax'].includes(r.line)).reduce((a, r) => a + r.total, 0)))
  return { revenue, costs, net: round2(revenue - costs) }
}

function flags(week: string, totals: LedgerTotals): WasteFlag[] {
  const out: WasteFlag[] = []
  const usd = (n: number) => `$${round2(Math.abs(n)).toFixed(2)}`

  // 1. Dead inventory — collection cards with zero sales chance because they're
  //    graded slabs (sellable) excluded; here: listed cards that haven't moved
  //    in a week. They're cash doing nothing but gathering listing dust.
  const stale = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(i.listing_price * i.quantity), 0) AS value
       FROM inventory i WHERE i.status = 'listed' AND i.listed_at <= datetime('now', '-7 days')`,
    )
    .get() as { n: number; value: number }
  if (stale.n >= 3) {
    out.push({
      icon: '🕸',
      title: 'Stale listings',
      detail: `${stale.n} listing${stale.n === 1 ? ' has' : 's have'} sat over a week (${usd(stale.value)} at ask). Cut the ask 10% or pull them — dead listings are dead cash.`,
      atStake: round2(stale.value),
    })
  }

  // 2. Bare high-value cards — wear risk is uninsured value walking around.
  const bare = db
    .prepare(
      `SELECT COUNT(*) AS n FROM inventory i
       WHERE i.status = 'collection' AND i.graded_grade IS NULL AND i.protection IS NULL
         AND i.condition = 'NM' AND i.cost_basis >= 5`,
    )
    .get() as { n: number }
  if (bare.n >= 3) {
    out.push({
      icon: '🩹',
      title: 'Bare cardboard',
      detail: `${bare.n} NM cards worth $5+ are sleeveless. Wear is a one-way door — five cents of penny sleeve protects real basis.`,
      atStake: bare.n * 0.05,
    })
  }

  // 2b. Uninsured collection — sleeves stop wear, nothing stops a roof leak.
  const ins = insurance.status() as { policy: unknown; appraisal: { total: number }; weeklyPremiums: Record<string, number> }
  if (!ins.policy && ins.appraisal.total >= 100) {
    out.push({
      icon: '🛡',
      title: 'Uninsured collection',
      detail: `${usd(ins.appraisal.total)} of cardboard with no policy. A leak or a break-in is unrecoverable — the Starter policy runs about ${usd(ins.weeklyPremiums.basic ?? 0)}/week.`,
      atStake: ins.appraisal.total,
    })
  }

  // 3. Supply gluttony — one-touches (the $1 holders) on cards worth under $20
  //    is spending a dollar to protect a dime.
  const gluttony = db
    .prepare(
      `SELECT COUNT(*) AS n FROM inventory i
       WHERE i.protection = 'one_touch' AND i.status != 'sold' AND i.graded_grade IS NULL
         AND i.cost_basis < 20`,
    )
    .get() as { n: number }
  if (gluttony.n >= 2) {
    out.push({
      icon: '💎',
      title: 'Museum housing for pocket change',
      detail: `${gluttony.n} sub-$20 card${gluttony.n === 1 ? ' sits' : 's sit'} in $1 one-touches. That's a dollar of protection per dime of basis — downshift to sleeves.`,
      atStake: gluttony.n,
    })
  }

  // 4. Quarterly estimates falling behind the suggested pace.
  const est = tax.estimate()
  if (est.suggestedPayment > 0 && est.paidSoFar < est.suggestedPayment * 0.5) {
    out.push({
      icon: '🧾',
      title: 'Estimate arrears',
      detail: `Quarter-to-date suggests ${usd(est.suggestedPayment)} set aside; you've paid ${usd(est.paidSoFar)}. Safe harbor is 80% of the true bill — fall short and the fine finds you.`,
      atStake: round2(est.suggestedPayment - est.paidSoFar),
    })
  }

  // 5. Sub-breakeven week — the business itself is the leak.
  if (totals.revenue > 0 && totals.net < 0) {
    out.push({
      icon: '📉',
      title: 'Operating at a loss',
      detail: `Revenue ${usd(totals.revenue)} vs ${usd(totals.costs)} in costs — you paid ${usd(-totals.net)} for the privilege of working. Rent, payroll, or prices: something moves this week.`,
      atStake: round2(-totals.net),
    })
  }

  // 6. Idle staff — payroll with nothing attributed.
  const idle = db
    .prepare(
      `SELECT name, role, wage FROM shop_employees
       WHERE hired_at <= datetime('now', '-3 days')
         AND (CASE role WHEN 'buyer' THEN sourced_value WHEN 'grader' THEN submits ELSE sales_lift END) = 0`,
    )
    .all() as { name: string; role: string; wage: number }[]
  if (idle.length > 0) {
    const burned = round2(idle.reduce((a, e) => a + e.wage * 7, 0))
    out.push({
      icon: '🪑',
      title: 'Idle payroll',
      detail: `${idle.map((e) => `${e.name} (${e.role})`).join(', ')} — three days, nothing attributed. That's ${usd(burned)}/week for furniture with opinions. Coach or cut.`,
      atStake: burned,
    })
  }

  // 7. Aggressive books — the accountant's professional opinion.
  if (tax.currentStrategy() === 'aggressive') {
    out.push({
      icon: '📕',
      title: 'Aggressive books',
      detail: 'You are padding returns with phantom deductions while paying me to keep you out of exactly this. Come clean before the city does it for you.',
      atStake: 0,
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// The Monday report.
// ---------------------------------------------------------------------------

function quip(name: string, quality: number): string {
  if (quality >= 5) return `${name} notes: ${QUIPS[3]}`
  if (quality >= 4) return `${name} adds: "${QUIPS[0]}"`
  if (quality <= 2) return `${name} shrugs. The filing was on time, at least.`
  return `${name} signs off: "${QUIPS[2]}"`
}

export function accountantTick() {
  const a = meta()
  if (!a) return
  const day = new Date().getDay() // 1 = Monday
  const key = `accountantReport:${dayKey()}`
  if (day !== 1) return
  if (getMeta(key)) return

  // Retainer — drafted with the report. Miss a payment and they resign, professionally.
  const shop = db.prepare(`SELECT name FROM shop WHERE id = 1`).get() as { name: string } | undefined
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  const anyBusiness = shop || getMeta('chain:districtManager')
  if (!anyBusiness) {
    // Nothing to keep books for — the retainer pauses, the hire doesn't.
    setMeta(key, nowIso())
    return
  }
  if (state.cash < ACCOUNTANT_WEEKLY_FEE) {
    db.prepare(`DELETE FROM meta WHERE key = 'accountant'`).run()
    logActivity('tax', `🧮 ${a.name} resigned — the retainer bounced and bookkeepers keep receipts.`, 0)
    return
  }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(ACCOUNTANT_WEEKLY_FEE)
  pnl.append('overhead', -ACCOUNTANT_WEEKLY_FEE, `Accountant retainer — ${a.name}`)

  const lastWeek = weekKey(Date.now() - 7 * 86_400_000)
  const totals = weekTotals(lastWeek)
  const allFlags = flags(lastWeek, totals)
  const usd = (n: number) => (n < 0 ? '−' : '+') + `$${Math.abs(n).toFixed(2)}`

  const parts: string[] = []
  if (totals.revenue > 0 || totals.costs > 0) {
    parts.push(`last week: ${usd(totals.revenue)} revenue → ${usd(totals.net)} net after ${usd(totals.costs)} costs`)
  }
  for (const f of allFlags.slice(0, 3)) parts.push(`${f.icon} ${f.title.toLowerCase()}`)
  const head = parts.length > 0 ? `🧮 ${a.name}'s Monday report — ${parts.join(' · ')}.` : `🧮 ${a.name}'s Monday report: a clean week on paper, which is the most expensive kind of quiet.`
  const detail = allFlags.length > 0 ? ` ${allFlags[0].detail}` : ''
  logActivity('tax', `${head}${detail}`, -ACCOUNTANT_WEEKLY_FEE)

  // Auto-estimated taxes: pay the suggested amount when the books can afford it.
  try {
    const est = tax.estimate()
    if (est.suggestedPayment > 0 && state.cash - ACCOUNTANT_WEEKLY_FEE >= est.suggestedPayment) {
      const r = tax.payEstimate(est.suggestedPayment)
      if (r.ok) logActivity('tax', `🧮 ${a.name} paid the suggested estimate — ${usd(-r.amount)} toward ${est.quarter}. Safe harbor stays in reach.`, -r.amount)
    }
  } catch { /* estimates need a business; fine to skip */ }

  setMeta(key, nowIso())
}

function dayKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10)
}

function weekKey(at: number | string = Date.now()): string {
  const d = new Date(at)
  const day = (d.getUTCDay() + 6) % 7
  const w = new Date(d)
  w.setUTCDate(d.getUTCDate() - day)
  return w.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Read model — the Money tab panel.
// ---------------------------------------------------------------------------

export function status() {
  const a = meta()
  if (!a) return { hired: false as const, applicants: applicants(), weeklyFee: ACCOUNTANT_WEEKLY_FEE }
  const thisWeek = weekKey()
  const lastWeek = weekKey(Date.now() - 7 * 86_400_000)
  const totals = weekTotals(thisWeek)
  return {
    hired: true as const,
    name: a.name,
    quality: a.quality,
    hiredAt: a.hired_at,
    weeklyFee: ACCOUNTANT_WEEKLY_FEE,
    deductionBonusPct: DEDUCTION_BONUS,
    thisWeek: totals,
    flags: flags(thisWeek, totals),
    lastWeekSummary: weekTotals(lastWeek),
  }
}
