import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { round2, gradedPriceOf, valueOf, type Condition } from './market'
import { priceOf, priceDetail } from './sealed'
import { conditionMultiplier as sealedConditionMult } from './sealedfutures'
import * as pnl from './pnl'
import * as vault from './vault'

// ---------------------------------------------------------------------------
// INSURANCE — the layer above sleeves. Wear is the everyday tax; a disaster
// is the one that ends collections. The shop sells three tiers of coverage:
//
//   • Starter policy   — 60% of appraised value, 15% deductible, claims capped
//                        at 25% of the appraised total
//   • Collector policy — 80% coverage, 10% deductible, 35% cap  (the workhorse)
//   • Museum rider     — 100% coverage, 5% deductible, 50% cap, for the vault
//
// How it stays honest:
//   • Premiums draft WEEKLY, sized to the live appraised value at draft time —
//     grow the collection, the premium grows with it. Premiums book as shop
//     overhead (deductible); claim payouts are recoveries, not income.
//   • NEW POLICIES HAVE A 7-DAY WAITING PERIOD. You cannot see the storm
//     coming and buy an umbrella the same afternoon — disasters during the
//     wait are yours to eat, exactly like real insurance.
//   • Miss a premium draft (cash can't cover it) and the policy lapses; you
//     get a 7-day grace to rebind without a new wait, then it's a fresh
//     policy with a fresh waiting period.
//   • Disasters hit the boxes at home (collection-status cards): roof leaks,
//     attic heat, and coffee don't care about penny sleeves, but slabs are
//     sealed against water and heat — only a break-in walks off with slabs.
//   • Damage is real: raw cards slip a condition step (NM→…→DM floored),
//     slabs drop a grade rung, and severe break-ins REMOVE cards — claimed
//     at covered value if you're insured, gone forever if you're not.
// ---------------------------------------------------------------------------

export type TierId = 'basic' | 'standard' | 'museum'

export type Tier = {
  id: TierId
  name: string
  icon: string
  coverage: number // fraction of appraised value paid on a claim
  premiumPerWeek: number // fraction of appraised value drafted weekly
  deductibleFrac: number // your share of any single loss
  capFrac: number // max single payout, as a fraction of appraised value
  blurb: string
}

export const TIERS: Tier[] = [
  { id: 'basic', name: 'Starter policy', icon: '🧢', coverage: 0.6, premiumPerWeek: 0.0009, deductibleFrac: 0.15, capFrac: 0.25, blurb: 'Cheap peace of mind. Covers 60% of value, you eat the first 15% of any claim.' },
  { id: 'standard', name: 'Collector policy', icon: '📘', coverage: 0.8, premiumPerWeek: 0.0014, deductibleFrac: 0.1, capFrac: 0.35, blurb: 'The workhorse. 80% coverage, 10% deductible, headroom for a real collection.' },
  { id: 'museum', name: 'Museum rider', icon: '🏛️', coverage: 1, premiumPerWeek: 0.002, deductibleFrac: 0.05, capFrac: 0.5, blurb: 'Full appraised value, 5% deductible, the highest claim cap. Vault-grade paperwork.' },
]

export const WAITING_DAYS = 7
export const GRACE_DAYS = 7

type ClaimItem = { name: string; from: string; to: string; loss: number }
type Claim = { at: string; kind: string; label: string; loss: number; payout: number; items: ClaimItem[] }

type Policy = {
  tier: TierId
  status: 'active' | 'lapsed'
  startedAt: string
  nextDraftAt: string
  waitingUntil: string | null
  graceUntil: string | null
  claims: Claim[]
  lifetimePremium: number
  lifetimeClaims: number
  lastDisasterDay: string | null
}

const KEY = 'insurance:policy'
const ROLL_KEY = 'insurance:lastRollDay' // the disaster roll fires once per game day, insured or not
const DAY = 86_400_000

function load(): Policy | null {
  const raw = getMeta(KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Policy
  } catch {
    return null
  }
}

function save(p: Policy | null) {
  if (p) setMeta(KEY, JSON.stringify(p))
  else db.prepare('DELETE FROM meta WHERE key = ?').run(KEY)
}

// ---------------------------------------------------------------------------
// Appraisal — the live insured value, built from the real tables.
// ---------------------------------------------------------------------------

function cardName(cardId: string): string {
  return (db.prepare('SELECT name FROM cards WHERE id = ?').get(cardId) as { name: string } | undefined)?.name ?? cardId
}

const COND_MULT: Record<Condition, number> = { NM: 1, LP: 0.8, MP: 0.65, HP: 0.5, DM: 0.35 }

const SLAB_MULT = 1.05 // graded slabs carry a small sealed-premium at appraisal

function slabDowngrade(grade: string): string | null {
  const map: Record<string, string> = { PSA10: 'PSA9', BGS10BL: 'BGS9', BGS10: 'PSA9', CGC10P: 'CGC10', CGC10: 'CGC9', CGC9: 'CGC8', SGC10: 'PSA9', PSA9: 'PSA8', BGS9: 'BGS8', SGC9: 'PSA8', PSA8: 'PSA7', BGS8: 'PSA7' }
  return map[grade] ?? null
}

function latestMarket(cardId: string): number {
  // Walk the FULL price ladder (TCGplayer → PriceCharting → eBay → Cardmarket
  // → simulated), not just TCGplayer: a collection priced by the simulated
  // market is still worth real money to insure, and appraising those rows at
  // $0 collapsed premiums to zero.
  return valueOf(cardId)
}

/** Appraised collection value, split raw/slab/sealed — recomputed live. */
export function appraisal() {
  const rawRows = db
    .prepare(`SELECT i.id, i.card_id, i.variant, i.condition, i.quantity, i.graded_grade FROM inventory i WHERE i.status = 'collection' AND i.quantity > 0`)
    .all() as { id: number; card_id: string; variant: string; condition: Condition; quantity: number; graded_grade: string | null }[]
  let raw = 0
  let slab = 0
  for (const r of rawRows) {
    if (r.graded_grade) {
      slab += gradedPriceOf(r.card_id, r.graded_grade).usd * SLAB_MULT * r.quantity
    } else {
      raw += latestMarket(r.card_id) * COND_MULT[r.condition] * r.quantity
    }
  }
  const sealedRows = db.prepare('SELECT product_id, quantity, cost, condition FROM sealed_inventory WHERE quantity > 0').all() as { product_id: string; quantity: number; cost: number; condition: string }[]
  let sealed = 0
  for (const s of sealedRows) {
    const condMult = sealedConditionMult(priceDetail(s.product_id).oopMonths, s.condition === 'worn' ? 'worn' : 'fresh')
    const unit = (priceOf(s.product_id).market || s.cost) * condMult // never appraise below what you paid
    sealed += unit * s.quantity
  }
  return { raw: round2(raw), slab: round2(slab), sealed: round2(sealed), total: round2(raw + slab + sealed) }
}

function tierOf(id: TierId): Tier {
  return TIERS.find((t) => t.id === id) ?? TIERS[1]
}

// ---------------------------------------------------------------------------
// Disasters — one roll per game day. The house is clumsy at about 3%/day.
// ---------------------------------------------------------------------------

type Disaster = {
  kind: string
  label: string
  icon: string
  desc: string
  hitSlabs: boolean // can it touch graded slabs?
  minItems: number
  maxItems: number
  steal: boolean // true = cards vanish entirely (claim = full value)
}

const DISASTERS: Disaster[] = [
  { kind: 'roof_leak', label: 'roof leak', icon: '💧', desc: 'A slow leak found the storage boxes overnight.', hitSlabs: false, minItems: 2, maxItems: 6, steal: false },
  { kind: 'coffee_spill', label: 'coffee spill', icon: '☕', desc: 'The travel mug tipped onto the trade pile.', hitSlabs: false, minItems: 1, maxItems: 3, steal: false },
  { kind: 'attic_heat', label: 'attic heat', icon: '🥵', desc: 'A heat wave curled everything stored up top.', hitSlabs: false, minItems: 2, maxItems: 5, steal: false },
  { kind: 'break_in', label: 'break-in', icon: '🦹', desc: 'Someone jimmied the back door and went straight for the good boxes.', hitSlabs: true, minItems: 1, maxItems: 3, steal: true },
]

type Candidate = { id: number; card_id: string; name: string; quantity: number; condition: Condition; graded_grade: string | null; value: number }

function candidates(allowSlabs: boolean): Candidate[] {
  // The vault rider stores slabs off-site, under camera and glass — a leak in
  // your roof can't find them and neither can a crowbar. Slots are limited:
  // the MOST VALUABLE slabs go in the vault first (you'd never leave the PSA
  // 10 on the dresser while a common rides the glass), and the overflow —
  // plus every slab when there's no rider — still sleeps at home.
  const vaultSlots = vault.vaultProtectedSlots()
  const rows = db
    .prepare(`SELECT i.id, i.card_id, i.quantity, i.condition, i.graded_grade, c.name FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.status = 'collection' AND i.quantity > 0`)
    .all() as { id: number; card_id: string; quantity: number; condition: Condition; graded_grade: string | null; name: string }[]
  const out: Candidate[] = []
  // Rank slabs by value; the top `vaultSlots` are immune, the rest are exposed.
  const slabRows = rows
    .filter((r) => r.graded_grade)
    .map((r) => ({ r, value: gradedPriceOf(r.card_id, r.graded_grade!).usd * SLAB_MULT }))
    .sort((a, b) => b.value - a.value)
  const protectedSlabIds = new Set(slabRows.slice(0, vaultSlots).map((s) => s.r.id))
  for (const r of rows) {
    const isSlab = !!r.graded_grade
    if (isSlab) {
      if (!allowSlabs) continue
      if (protectedSlabIds.has(r.id)) continue // sleeping in the vault
    }
    const value = isSlab
      ? gradedPriceOf(r.card_id, r.graded_grade!).usd * SLAB_MULT
      : latestMarket(r.card_id) * COND_MULT[r.condition]
    if (value < 0.5) continue // junk isn't worth a claim line
    out.push({ ...r, value: round2(value) })
  }
  return out
}

const nextCondition: Record<Condition, Condition> = { NM: 'LP', LP: 'MP', MP: 'HP', HP: 'DM', DM: 'DM' }

/** Roll one game day: premium drafts, waiting-period expiry, and disasters. */
export function insuranceTick(today: string) {
  const p = load()

  // The disaster roll happens once per game day for everyone — the world
  // doesn't get more dangerous just because you're uninsured.
  if (getMeta(ROLL_KEY) !== today) {
    setMeta(ROLL_KEY, today)
    rollDisaster(today, p)
  }

  if (!p) return

  // Premium draft day — sized to the CURRENT appraisal, like a real renewal.
  if (today >= p.nextDraftAt.slice(0, 10)) {
    const tier = tierOf(p.tier)
    // Storage surcharge: every locker is another door to watch, so the shop
    // tacks a small per-locker fee onto the weekly draft.
    const surcharge = vault.lockerSurchargeWeekly()
    const premium = round2(appraisal().total * tier.premiumPerWeek + surcharge)
    const cash = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
    if (cash >= premium) {
      db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(premium)
      pnl.append('overhead', -premium, '🛡 insurance premium')
      p.lifetimePremium = round2(p.lifetimePremium + premium)
      p.nextDraftAt = new Date(Date.now() + 7 * DAY).toISOString()
      // Paying after a lapse (within grace) reinstates the policy — a renewal
      // is a renewal, even if the check bounced last week.
      if (p.status === 'lapsed') {
        p.status = 'active'
        p.graceUntil = null
        logActivity('insurance', '🛡 Premium paid — the policy is REINSTATED. Coverage is live again.')
      } else {
        logActivity('insurance', `🛡 ${tier.name} drafted ${fmtUsd(premium)} for the week — collection appraised at ${fmtUsd(appraisal().total)}${surcharge > 0 ? ` (incl. ${fmtUsd(surcharge)} storage surcharge)` : ''}.`)
      }
    } else {
      p.status = 'lapsed'
      p.graceUntil = new Date(Date.now() + GRACE_DAYS * DAY).toISOString()
      logActivity('insurance', `⚠️ Premium draft bounced — the policy LAPSED. ${GRACE_DAYS} days of grace to rebind without a new waiting period, then disasters are fully yours.`)
    }
    save(p)
  }

  // Waiting period over?
  if (p.waitingUntil && today >= p.waitingUntil.slice(0, 10)) {
    p.waitingUntil = null
    save(p)
    logActivity('insurance', '🛡 Waiting period over — coverage is live. Sleep better.')
  }
}

/** The disaster roll itself — exported (with an optional kind hint) so diagnostics and tests can force a specific event. */
export function rollDisaster(today: string, p: Policy | null, kindHint?: string) {
  // Quiet ~97% of days. Never two disasters in one day.
  if (p?.lastDisasterDay === today) return
  const r = Math.random()
  // ~3% per REAL day was the tuned disaster pressure; game-days are 12h now,
  // so the per-roll chance halves and the real-day odds carry over.
  if (r >= 0.015) return
  const pool = DISASTERS
  const d = (kindHint && DISASTERS.find((x) => x.kind === kindHint)) || pool[Math.floor(Math.random() * pool.length)]
  const cands = candidates(d.hitSlabs)
  if (cands.length === 0) {
    // Nothing exposed to this disaster — but the day still counts as one
    // roll (and, with a hint, as the day's disaster) so the caller can't
    // spin the dice again looking for a juicier target pool.
    if (kindHint && p) {
      p.lastDisasterDay = today
      save(p)
    }
    return
  }
  if (p) {
    p.lastDisasterDay = today
    save(p)
  }
  // A break-in that finds vault slots occupied says so — the rider's whole pitch.
  const vaultSaved = d.hitSlabs && vault.vaultProtectedSlots() > 0
  const vaultExposed = vault.homeSlabs()

  // Severity: mostly small, rarely catastrophic. Break-ins are always serious.
  const sev = d.steal ? Math.random() < 0.35 ? 2 : 1 : Math.random() < 0.05 ? 3 : Math.random() < 0.3 ? 2 : 1
  const count = Math.min(cands.length, d.minItems + Math.floor(Math.random() * (d.maxItems - d.minItems + 1)) * (sev === 3 ? 3 : sev === 2 ? 2 : 1))
  // Thieves take the good stuff; water and coffee land wherever.
  const hits = (d.steal ? cands.sort((a, b) => b.value - a.value) : cands.sort(() => Math.random() - 0.5)).slice(0, count)

  const items: ClaimItem[] = []
  for (const h of hits) {
    if (d.steal) {
      // Thieves take the card, whatever the holder — slabs included.
      db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(h.id)
      db.prepare('DELETE FROM inventory WHERE id = ? AND quantity <= 0').run(h.id)
      items.push({ name: h.name, from: h.graded_grade ?? h.condition, to: 'stolen', loss: h.value })
    } else if (h.graded_grade) {
      const to = slabDowngrade(h.graded_grade)
      if (!to) continue
      const before = h.value
      db.prepare('UPDATE inventory SET graded_grade = ? WHERE id = ?').run(to, h.id)
      items.push({ name: h.name, from: h.graded_grade, to, loss: round2(before - gradedPriceOf(h.card_id, to).usd * SLAB_MULT) })
    } else {
      const to = nextCondition[h.condition]
      if (to === h.condition) continue
      const before = h.value
      db.prepare('UPDATE inventory SET condition = ?, worn_at = ? WHERE id = ?').run(to, nowIso(), h.id)
      items.push({ name: h.name, from: h.condition, to, loss: round2(before - latestMarket(h.card_id) * COND_MULT[to]) })
    }
  }
  if (items.length === 0) return

  const loss = round2(items.reduce((a, i) => a + i.loss, 0))
  const appraisalNow = appraisal()

  let payout = 0
  let covered = false
  if (p && coverageLive(p)) {
    covered = true
    const tier = tierOf(p.tier)
    const cap = appraisalNow.total * tier.capFrac
    // Covered loss = loss × coverage, minus the deductible share, capped at
    // the policy's single-claim limit.
    payout = round2(Math.min(Math.max(0, loss * (tier.coverage - tier.deductibleFrac)), cap))
    if (payout > 0) {
      db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(payout)
      p.lifetimeClaims = round2(p.lifetimeClaims + payout)
    }
  }
  const claim: Claim = { at: nowIso(), kind: d.kind, label: d.label, loss, payout, items }
  if (p) {
    p.claims = [claim, ...p.claims].slice(0, 10)
    save(p)
  }

  // The feed line — the whole event in one entry, itemized in the panel.
  const itemList = items.slice(0, 3).map((i) => `${i.name} (${i.from} → ${i.to})`).join(', ')
  const more = items.length > 3 ? ` +${items.length - 3} more` : ''
  const vaultNote = vaultSaved
    ? ` The vault kept its ${vault.vaultProtectedSlots()} shielded slab${vault.vaultProtectedSlots() === 1 ? '' : 's'} out of reach.${vaultExposed > 0 ? ` ${vaultExposed} overflow slab${vaultExposed === 1 ? '' : 's'} still sleep${vaultExposed === 1 ? 's' : ''} at home.` : ''}`
    : ''
  if (covered) {
    logActivity('insurance', `${d.icon} ${d.label[0].toUpperCase() + d.label.slice(1)}: ${itemList}${more}. Loss ${fmtUsd(loss)} — the policy paid ${fmtUsd(payout)} after the deductible.${vaultNote}`, payout - loss)
  } else if (p && p.status === 'lapsed') {
    logActivity('insurance', `${d.icon} ${d.label[0].toUpperCase() + d.label.slice(1)} with a LAPSED policy: ${itemList}${more}. Loss ${fmtUsd(loss)} — pay the premium to reinstate.${vaultNote}`, -loss)
  } else if (p && p.waitingUntil) {
    logActivity('insurance', `${d.icon} ${d.label[0].toUpperCase() + d.label.slice(1)} during the WAITING PERIOD: ${itemList}${more}. Loss ${fmtUsd(loss)} — coverage wasn't live yet. This is why you bind before the storm.${vaultNote}`, -loss)
  } else {
    logActivity('insurance', `${d.icon} ${d.label[0].toUpperCase() + d.label.slice(1)}: ${itemList}${more}. Loss ${fmtUsd(loss)} — no policy, no check. The shop sells coverage.${vaultNote}`, -loss)
  }
  console.log(`[insurance] ${d.kind}: ${items.length} item(s), loss $${loss.toFixed(2)}, payout $${payout.toFixed(2)}`)
}

const fmtUsd = (n: number): string => `$${round2(n).toFixed(2)}`

/**
 * What safety costs this week, in one place: insurance premium (live estimate),
 * storage locker rent, and the vault rider. All three book through the shop
 * ledger, so the number is real money out the door.
 */
export function protectionCosts() {
  const a = appraisal()
  const p = load()
  const tier = p ? tierOf(p.tier) : null
  const insurance = p && p.status !== 'lapsed' ? round2(a.total * tier!.premiumPerWeek) : 0
  const lockerRent = round2((db.prepare(`SELECT COALESCE(SUM(monthly),0) AS n FROM storage_rentals WHERE kind = 'locker'`).get() as { n: number }).n / 4) // weekly share of the monthly rate
  const pol = db.prepare(`SELECT COALESCE(monthly,0) AS m FROM vault_policy WHERE id = 1 AND active = 1`).get() as { m: number } | undefined
  const vaultRider = round2((pol?.m ?? 0) / 4)
  const total = round2(insurance + lockerRent + vaultRider)
  return {
    insurance,
    lockerRent,
    vaultRider,
    total,
    active: total > 0,
    policyTier: tier?.name ?? null,
    policyActive: !!p && p.status === 'active',
    lockers: (db.prepare(`SELECT COUNT(*) AS n FROM storage_rentals WHERE kind = 'locker'`).get() as { n: number }).n,
    vaultActive: !!pol,
  }
}

/** Coverage is live when active and any waiting period has actually passed. */
function coverageLive(p: Policy): boolean {
  if (p.status !== 'active') return false
  if (!p.waitingUntil) return true
  return Date.now() >= new Date(p.waitingUntil).getTime()
}

// ---------------------------------------------------------------------------
// Player actions + status.
// ---------------------------------------------------------------------------

export function bind(tierId: TierId): { ok: true; waitingDays: number } | { ok: false; error: string } {
  const tier = TIERS.find((t) => t.id === tierId)
  if (!tier) return { ok: false, error: 'Unknown policy tier.' }
  const existing = load()
  if (existing && existing.status === 'active') return { ok: false, error: 'You already hold a policy — cancel it first.' }
  const firstTime = !existing || !existing.graceUntil || Date.now() > new Date(existing.graceUntil).getTime()
  const p: Policy = {
    tier: tierId,
    status: 'active',
    startedAt: nowIso(),
    nextDraftAt: new Date(Date.now() + 7 * DAY).toISOString(),
    waitingUntil: firstTime ? new Date(Date.now() + WAITING_DAYS * DAY).toISOString() : null, // grace rebinds skip the wait
    graceUntil: null,
    claims: existing?.claims ?? [],
    lifetimePremium: existing?.lifetimePremium ?? 0,
    lifetimeClaims: existing?.lifetimeClaims ?? 0,
    lastDisasterDay: existing?.lastDisasterDay ?? null,
  }
  save(p)
  logActivity('insurance', `🛡 Bound the ${tier.name} — ${Math.round(tier.coverage * 100)}% coverage, ${Math.round(tier.deductibleFrac * 100)}% deductible.${p.waitingUntil ? ` ${WAITING_DAYS}-day waiting period before claims are honored.` : ' Grace rebind: coverage is live immediately.'}`)
  return { ok: true, waitingDays: p.waitingUntil ? WAITING_DAYS : 0 }
}

export function cancel(): { ok: true } | { ok: false; error: string } {
  const p = load()
  if (!p || p.status !== 'active') return { ok: false, error: 'No active policy.' }
  save(null)
  logActivity('insurance', '🛡 Policy cancelled. The boxes are on their own — sleeves stop wear, nothing stops a roof leak.')
  return { ok: true }
}

export function status() {
  const p = load()
  const a = appraisal()
  const bare = db
    .prepare(`SELECT COUNT(*) n, COALESCE(SUM(1), 0) FROM inventory WHERE status = 'collection' AND graded_grade IS NULL AND protection IS NULL AND quantity > 0`)
    .get() as { n: number }
  const totalCards = db.prepare(`SELECT COALESCE(SUM(quantity), 0) n FROM inventory WHERE status = 'collection'`).get() as { n: number }
  if (!p) {
    return {
      policy: null,
      tiers: TIERS,
      appraisal: a,
      bareCards: bare.n,
      cards: totalCards.n,
      weeklyPremiums: Object.fromEntries(TIERS.map((t) => [t.id, round2(a.total * t.premiumPerWeek + vault.lockerSurchargeWeekly())])),
      storageSurcharge: vault.lockerSurchargeWeekly(),
      vaultImmuneSlabs: vault.vaultActive() && vault.homeSlabs() === 0,
      vaultProtected: vault.vaultProtectedSlots(),
      vaultExposed: vault.homeSlabs(),
    }
  }
  const tier = tierOf(p.tier)
  return {
    policy: {
      ...p,
      tierName: tier.name,
      tierIcon: tier.icon,
      coverage: tier.coverage,
      deductibleFrac: tier.deductibleFrac,
      capFrac: tier.capFrac,
      weeklyPremium: round2(a.total * tier.premiumPerWeek + vault.lockerSurchargeWeekly()),
      storageSurcharge: vault.lockerSurchargeWeekly(),
      vaultImmuneSlabs: vault.vaultActive() && vault.homeSlabs() === 0,
      vaultProtected: vault.vaultProtectedSlots(),
      vaultExposed: vault.homeSlabs(),
      claimCap: round2(a.total * tier.capFrac),
      waitingDaysLeft: p.waitingUntil ? Math.max(0, Math.ceil((new Date(p.waitingUntil).getTime() - Date.now()) / DAY)) : 0,
      graceDaysLeft: p.graceUntil && p.status === 'lapsed' ? Math.max(0, Math.ceil((new Date(p.graceUntil).getTime() - Date.now()) / DAY)) : 0,
    },
    tiers: TIERS,
    appraisal: a,
    bareCards: bare.n,
    cards: totalCards.n,
    weeklyPremiums: Object.fromEntries(TIERS.map((t) => [t.id, round2(a.total * t.premiumPerWeek)])),
  }
}
