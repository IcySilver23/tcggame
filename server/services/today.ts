import { db, getMeta, setMeta } from '../lib/db'
import { gameDayKey, gameDayNumber, gameDayEnd } from '../lib/gameday'
import { round2 } from './market'
import * as shop from './shop'
import * as staff from './staff'
import * as insurance from './insurance'
import * as vault from './vault'
import * as savebackup from './savebackup'
import * as supplies from './supplies'

// ---------------------------------------------------------------------------
// TODAY — everything that rolls at the next 00:00/12:00 UTC game-day boundary, on one panel.
//
// Game days are UTC days: rent, payroll, interest, insurance premiums,
// locker/vault rent, condition wear, the disaster roll, and the save snapshot
// all gate on a UTC date key. This service projects the upcoming rolls so the
// dashboard can show what's coming, and flags each as FIRED once its system
// has stamped today's key (the same keys the systems themselves check).
// ---------------------------------------------------------------------------

export type TodayRoll = {
  kind: string
  label: string
  detail: string
  amount: number | null      // known cash out (null = variable/unknown)
  cadence: 'daily' | 'weekly'
  /** The meta key (or table check) whose today-stamp means "this rolled". */
  firedKey: string
}

function dayKeyNow(): string {
  return gameDayKey() // a game-day is 12 real hours — gates change at 00:00/12:00 UTC
}

export function todayRolls(): { rolls: TodayRoll[]; resetsAt: string; dayNumber: number } {
  const today = dayKeyNow()
  const rolls: TodayRoll[] = []

  // Shop rent — due only when stocked (the waiver is part of the roll).
  // Owners skip it entirely: the deed's mortgage draft rolls below instead.
  const shopRow = shop.getShop()
  if (shopRow) {
    const owned = shopRow.bought_at != null
    const base = shop.tierBaseRent(shopRow.tier)
    const stocked = (db.prepare(`SELECT COALESCE(SUM(i.quantity),0) AS n FROM shop_case_cards scc JOIN inventory i ON i.id = scc.inventory_id`).get() as { n: number }).n
    if (!owned) {
      const rent = shop.currentRent(shopRow)
      rolls.push({
        kind: 'rent',
        label: 'Shop rent',
        detail: stocked > 0
          ? `${shopRow.name} — ${stocked} cards on display${rent > base ? ` · crept up from $${base.toFixed(2)}` : ''}`
          : `${shopRow.name} — cases empty, landlord waives it`,
        amount: stocked > 0 ? rent : 0,
        cadence: 'daily',
        firedKey: shopRow.last_rent_day === today ? '1' : '',
      })
    }
    // The mortgage drafts on the same gate as rent — you own it, the bank doesn't.
    const m = shop.activeMortgage()
    if (m) {
      rolls.push({
        kind: 'mortgage',
        label: 'Mortgage draft',
        detail: `${shopRow.name} — ${round2(m.balance).toFixed(2)} left on the deed`,
        amount: shop.mortgagePayment(m),
        cadence: 'daily',
        firedKey: shopRow.last_rent_day === today ? '1' : '',
      })
    }
    // Payroll drafts alongside shop rent.
    const wages = staff.payroll()
    if (wages > 0) {
      rolls.push({
        kind: 'payroll',
        label: 'Payroll',
        detail: `${(db.prepare('SELECT COUNT(*) AS n FROM shop_employees').get() as { n: number }).n} staff on the roster`,
        amount: wages,
        cadence: 'daily',
        firedKey: getMeta('payrollDrafted') ? '1' : '',
      })
    }
  }

  // Franchise satellites: rent + manager wage per store (waived when dark).
  const stores = db.prepare(`SELECT * FROM franchise`).all() as { id: number; name: string; tier: string; manager_wage: number; last_rent_day: string | null }[]
  const FR_RENT: Record<string, number> = { 'hole-in-the-wall': 6, storefront: 18, flagship: 70, region: 170 } // per game-day (12h)
  for (const f of stores) {
    const total = round2((FR_RENT[f.tier] ?? 0) + (f.manager_wage || 0))
    rolls.push({
      kind: `franchise:${f.id}`,
      label: `${f.name} rent + manager`,
      detail: 'rent and your manager\'s day rate draft together',
      amount: total,
      cadence: 'daily',
      firedKey: f.last_rent_day === today ? '1' : '',
    })
  }

  // Insurance premium — weekly, on its own nextDraftAt clock (not midnight-gated,
  // but it lands within a day either way and the panel is the right place).
  try {
    const p = insurance.status()
    const pol = p.policy as { nextDraftAt: string; status: string; weeklyPremium: number; tier: string } | null
    if (pol) {
      const due = new Date(pol.nextDraftAt).getTime() - Date.now() < 86_400_000
      rolls.push({
        kind: 'insurance',
        label: 'Insurance premium',
        detail: pol.status === 'active'
          ? `weekly draft sized to the live appraisal (${due ? 'due within a day' : 'not due yet'})`
          : 'policy lapsed — no draft while lapsed',
        amount: pol.status === 'active' && due ? pol.weeklyPremium : null,
        cadence: 'weekly',
        firedKey: '',
      })
    }
  } catch { /* insurance tables missing — skip */ }

  // Storage lockers + vault rider — weekly, due when next_bill_at has passed.
  const lockers = db.prepare(`SELECT COALESCE(SUM(monthly),0) AS owed, MIN(next_bill_at) AS next FROM storage_rentals WHERE kind = 'locker'`).get() as { owed: number; next: string | null }
  if (lockers.owed > 0) {
    const due = lockers.next ? new Date(lockers.next).getTime() <= Date.now() : false
    rolls.push({
      kind: 'lockers',
      label: 'Locker rent',
      detail: due ? 'weekly bill is due' : `weekly — next bill ${new Date(lockers.next as string).toLocaleDateString()}`,
      amount: due ? round2(lockers.owed) : null,
      cadence: 'weekly',
      firedKey: '',
    })
  }
  const pol = db.prepare(`SELECT monthly, next_bill_at FROM vault_policy WHERE id = 1`).get() as { monthly: number; next_bill_at: string } | undefined
  if (pol) {
    const due = new Date(pol.next_bill_at).getTime() <= Date.now()
    rolls.push({
      kind: 'vault',
      label: 'Vault rider',
      detail: due ? 'weekly bill is due' : `weekly — next bill ${new Date(pol.next_bill_at).toLocaleDateString()}`,
      amount: due ? round2(pol.monthly) : null,
      cadence: 'weekly',
      firedKey: '',
    })
  }

  // Loan interest — daily accrual, amount = today's projected interest.
  // (The property mortgage is excluded: it drafts as one principal+interest
  // payment in the roll above, not as accruing interest.)
  const loans = db.prepare(`SELECT balance, rate_daily FROM loans WHERE status = 'active' AND kind != 'mortgage'`).all() as { balance: number; rate_daily: number }[]
  if (loans.length > 0) {
    const interest = round2(loans.reduce((a, l) => a + l.balance * l.rate_daily, 0))
    rolls.push({
      kind: 'interest',
      label: 'Loan interest',
      detail: `${loans.length} active loan${loans.length === 1 ? '' : 's'} — balance grows daily`,
      amount: interest,
      cadence: 'daily',
      firedKey: '',
    })
  }

  // Save snapshot — the day key IS the fired flag.
  rolls.push({
    kind: 'snapshot',
    label: '💾 Save snapshot',
    detail: 'the whole save photographs itself — the last 3 live in Settings',
    amount: null,
    cadence: 'daily',
    firedKey: getMeta('saves:lastBackupDay') === today ? '1' : '',
  })

  // Condition wear — a chance, not a bill.
  const bare = (db.prepare(`SELECT COUNT(*) AS n FROM inventory WHERE status = 'collection' AND graded_grade IS NULL AND protection IS NULL AND condition IN ('NM','LP','MP','HP') AND quantity > 0`).get() as { n: number }).n
  if (bare > 0) {
    rolls.push({
      kind: 'wear',
      label: 'Condition wear roll',
      detail: `${bare} bare card${bare === 1 ? '' : 's'} at risk — a penny sleeve stops it`,
      amount: null,
      cadence: 'daily',
      firedKey: getMeta('supplies:lastWearDay') === today ? '1' : '',
    })
  }

  // Disaster roll — ~3% of days something breaks.
  rolls.push({
    kind: 'disaster',
    label: 'Disaster roll',
    detail: '~3% of days the house breaks something — insurance turns it into a claim',
    amount: null,
    cadence: 'daily',
    firedKey: getMeta('insurance:lastRollDay') === today ? '1' : '',
  })

  // The next 00:00/12:00 UTC boundary is the roll; day math comes from lib/gameday.
  const now = new Date()
  const saveCreated = db.prepare(`SELECT created_at FROM game_state WHERE id = 1`).get() as { created_at: string } | undefined
  const dayNumber = gameDayNumber(saveCreated?.created_at ?? now, now)

  return { rolls, resetsAt: gameDayEnd(now).toISOString(), dayNumber }
}
