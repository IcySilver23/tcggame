import { db, nowIso, logActivity, getMeta } from '../lib/db'
import { round2 } from './market'
import { append as pnlAppend } from './pnl'
import { showCrowdMultiplier } from './seasonal'
import * as vendor from './vendor'

// ---------------------------------------------------------------------------
// Host your own card show (Phase 5 — Empire)
//
// The player flips from attendee to organizer: book a venue, price the gate,
// sell vendor tables to NPC dealers priced off the same real market anchors
// the convention floor uses. Show day resolves on the game clock — gate
// revenue lands, dealers' tables sell, and the hall's reputation drives
// (or starves) the next show's demand.
//
// The loop:
//   book venue → set gate + table price → dealers sign up (or don't)
//   → show day: walkins × gate + tables_sold × table_price − deposit
//   → rep up if dealers turned a profit, rep down if the hall was dead
//   → rep raises the dealer ceiling for the next show
//
// Design anchors shared with conventions.ts: every price is a real-market
// opinion, and shows live on the weekly calendar (hosting is NOT gated to
// convention windows — you're the organizer, you pick the date).
// ---------------------------------------------------------------------------

export type Venue = {
  id: string
  name: string
  blurb: string
  /** Hall rent, due at booking. */
  cost: number
  /** Refunded when the show draws at least the promised dealer count. */
  deposit: number
  /** Base walk-in crowd per game-day hour at a $5 gate. */
  crowd: number
  /** Dealer tables the hall physically holds. */
  capacity: number
}

export const VENUES: Venue[] = [
  {
    id: 'rec_center',
    name: 'Community Rec Center',
    blurb: 'Fold-out tables, fluorescent lights, a vending machine that only takes exact change. Where every scene starts.',
    cost: 150,
    deposit: 75,
    crowd: 3.2,
    capacity: 24,
  },
  {
    id: 'hotel_hall',
    name: 'Airport Hotel Ballroom',
    blurb: 'Chandelier-adjacent cardboard. Free parking pulls a real crowd, and dealers take a ballroom seriously.',
    cost: 450,
    deposit: 200,
    crowd: 5.5,
    capacity: 55,
  },
  {
    id: 'convention_hall',
    name: 'Metro Convention Hall',
    blurb: 'Loading docks, press loft, twenty thousand square feet. The big leagues — and big-league rent.',
    cost: 1200,
    deposit: 500,
    crowd: 9,
    capacity: 130,
  },
]

export function venueById(id: string): Venue | undefined {
  return VENUES.find((v) => v.id === id)
}

// ---------------------------------------------------------------------------
// Special guests — headliners you pay for. Each pulls a different crowd and
// leaves a different reputation signature. Fees are due at booking (they book
// travel too) and are gone if the show is cancelled — the signer doesn't
// refund airfare. Effects stack on walk-ins and reputation at resolution.
// ---------------------------------------------------------------------------

export type Guest = {
  id: string
  name: string
  blurb: string
  /** Appearance fee, due at booking. Non-refundable on cancellation. */
  fee: number
  /** Multiplier on the day's walk-in crowd. */
  crowdMult: number
  /** Flat reputation shift applied on show day (before the ±4 clamp). */
  repBonus: number
  /** Minimum scene reputation before this guest will say yes. */
  repRequired: number
}

export const GUESTS: Guest[] = [
  {
    id: 'signer',
    name: 'Mitsuhiro Arita-style signer',
    blurb: 'An illustrator whose art defined a generation of childhoods. The signing line is the show.',
    fee: 250,
    crowdMult: 1.6,
    repBonus: 2,
    repRequired: 30,
  },
  {
    id: 'sealed_vendor',
    name: 'Sealed-product vendor',
    blurb: 'Pallets of current booster boxes at honest prices. Collectors plan their whole weekend around a vendor like this.',
    fee: 120,
    crowdMult: 1.35,
    repBonus: 1,
    repRequired: 0,
  },
  {
    id: 'graded_live',
    name: 'Live grading booth',
    blurb: 'A slab service taking submissions on-site. Serious collectors bring the grails out of the closet for this.',
    fee: 180,
    crowdMult: 1.2,
    repBonus: 2,
    repRequired: 40,
  },
  {
    id: 'celebrity',
    name: 'Voice-actor guest',
    blurb: '“Ash, I choose you!” Hashtag queues, cosplay photo ops, and a thousand new faces in the hall.',
    fee: 400,
    crowdMult: 1.8,
    repBonus: 1,
    repRequired: 50,
  },
]

export function guestById(id: string): Guest | undefined {
  return GUESTS.find((g) => g.id === id)
}

function parseGuests(json: string | null): string[] {
  try {
    const arr = JSON.parse(json ?? '[]')
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Guests actually available to a show — rep-gated headliners decline quietly. */
export function availableGuests(): { guest: Guest; declined: boolean }[] {
  const rep = currentRep()
  return GUESTS.map((g) => ({ guest: g, declined: rep < g.repRequired }))
}

export function guestFees(guestIds: string[]): number {
  return round2(guestIds.reduce((a, id) => a + (guestById(id)?.fee ?? 0), 0))
}

/** Walk-in multiplier and rep bonus for a booked guest lineup. */
function guestEffects(guestIds: string[]): { crowdMult: number; repBonus: number } {
  let crowdMult = 1
  let repBonus = 0
  for (const id of guestIds) {
    const g = guestById(id)
    if (!g) continue
    crowdMult *= g.crowdMult
    repBonus += g.repBonus
  }
  return { crowdMult, repBonus }
}

// The same dealer personas the convention floor uses — hosting pulls from the
// same scene, so the fiction stays coherent. (Labels only; their willingness
// to sign up is this file's own math.)
const DEALER_PERSONAS: { specialty: string; avatar: string; names: string[] }[] = [
  { specialty: 'deals', avatar: '🎯', names: ['Bargain Ben', 'Clearout Carrie', 'Dollar-Box Dave'] },
  { specialty: 'bulk', avatar: '🗃️', names: ['Bulk Bob', 'Quarter-Bin Quinn', 'Two-Buck Tessa'] },
  { specialty: 'vintage', avatar: '🕰️', names: ['WotC Wanda', 'Base Set Bruno', 'Old-School Oswald'] },
  { specialty: 'modern', avatar: '🔥', names: ['Chase-Card Chad', 'Prismatic Priya', 'Current-Set Cynthia'] },
  { specialty: 'graded', avatar: '🛡️', names: ['PSA Peggy', 'Ten-Grade Todd', 'Slab Sergeant Sutter'] },
  { specialty: 'trap', avatar: '🎡', names: ['Shiny Steve', 'Markup Marge', 'Giftshop Garry'] },
]

const SHOW_TITLES = [
  'Card & Collectibles Show',
  'Cardboard Bazaar',
  'Hobby Trade Day',
  'The Collector\'s Exchange',
  'Weekend Card Fest',
]

const HOURS = 4 // show length in game-day hours of active play
const HOUR_MS = 8 * 60_000 // one show-hour ≈ 8 real minutes (~32 min per show)
const MAX_AHEAD = 2 // one upcoming show at a time; book the next after resolution

/** Shop reputation (0–100) bleeds into the scene: the hall IS the shop. */
function shopRep(): number {
  const row = db.prepare('SELECT reputation FROM shop WHERE id = 1').get() as { reputation: number } | undefined
  if (row) return row.reputation
  // No shop lease yet — the scene keeps its own file on the organizer.
  const meta = getMeta('shows:rep')
  return meta != null && Number.isFinite(Number(meta)) ? Number(meta) : 50
}

/** Persist a rep change wherever the source of truth lives. */
function addRep(delta: number): void {
  const row = db.prepare('SELECT reputation FROM shop WHERE id = 1').get() as { reputation: number } | undefined
  if (row) {
    db.prepare('UPDATE shop SET reputation = MAX(0, MIN(100, reputation + ?)) WHERE id = 1').run(delta)
    return
  }
  const next = Math.max(0, Math.min(100, shopRep() + delta))
  db.prepare(`INSERT INTO meta (key, value) VALUES ('shows:rep', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(next))
}

export function currentRep(): number {
  return Math.max(0, Math.min(100, Math.round(shopRep())))
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export type ShowRow = {
  id: number; venue: string; gate: number; table_price: number; tables_total: number;
  booked_at: string; opens_at: string; closes_at: string; resolved: number; guests: string;
  walkins: number | null; gate_revenue: number | null; tables_sold: number | null;
  table_revenue: number | null; refund: number | null; rep_delta: number | null; notes: string | null
}

export function upcomingShow(): ShowRow | undefined {
  return db.prepare(`SELECT * FROM card_shows WHERE resolved = 0 ORDER BY id DESC LIMIT 1`).get() as ShowRow | undefined
}

export function recentShows(limit = 6): ShowRow[] {
  return db.prepare(`SELECT * FROM card_shows WHERE resolved = 1 ORDER BY id DESC LIMIT ?`).all(limit) as ShowRow[]
}

export function dealersFor(showId: number) {
  return db.prepare(`SELECT * FROM card_show_dealers WHERE show_id = ? ORDER BY paid DESC`).all(showId) as
    { id: number; name: string; specialty: string; avatar: string; paid: number; reliable: number }[]
}

export type DealerInterest = { name: string; avatar: string; specialty: string; committed: boolean; reason: string }

/**
 * Fresh dealer roster each poll: every persona in the scene rolls against the
 * ask. Committed dealers pay when the roster is "locked" at show time; this
 * read model is what the UI shows while you tune the price.
 */
export function dealerRoster(show: ShowRow): DealerInterest[] {
  const marketHeat = marketHeatIndex()
  const rep = currentRep()
  const out: DealerInterest[] = []
  for (const persona of DEALER_PERSONAS) {
    // Two dealers per specialty scene, with a stable seed so the roster
    // doesn't flicker between polls. The second name is a bit pickier.
    for (let i = 0; i < 2; i++) {
      const score = dealerScore(show.table_price, marketHeat, rep, persona.specialty) * (i === 0 ? 1 : 0.85)
      const anchorCap = tableAnchor(marketHeat, persona.specialty) * 1.4
      const committed = score >= 1 && show.table_price <= anchorCap // nobody pays 1.4× what a table's worth
      const name = persona.names[(show.id + i) % persona.names.length]
      out.push({
        name: `${persona.avatar} ${name}${i === 1 ? ' Jr.' : ''}`,
        avatar: persona.avatar,
        specialty: persona.specialty,
        committed,
        reason: !committed
          ? score >= 0.7 ? 'on the fence' : 'prices it too rich'
          : score >= 1.3 ? 'first in line' : 'in',
      })
    }
  }
  return out
}

/**
 * A dealer's willingness = (anchor price ÷ your ask) shaped by scene heat and
 * hall reputation. Anchored to what an average table grosses at a real show:
 * roughly 6 market-anchored sales a day, so table price sanity-checks against
 * the same real card values the rest of the sim prices from.
 */
function dealerScore(ask: number, heat: number, rep: number, specialty: string): number {
  const anchor = tableAnchor(heat, specialty)
  if (anchor <= 0) return 0
  const ratio = anchor / Math.max(1, ask)
  const repMult = 0.6 + (rep / 100) * 0.8 // 0.6× at rep 0 → 1.4× at rep 100
  return round2(ratio * heat * repMult)
}

/** What a table is "worth" to a dealer, in the sim's own currency of expected profit. */
function tableAnchor(heat: number, specialty: string): number {
  // Average lot value a dealer moves per show, by specialty, from the real
  // market: bulk dealers work cheap cardboard; slab dealers trade grails.
  const baseBySpecialty: Record<string, number> = {
    bulk: 18, deals: 30, modern: 42, vintage: 55, graded: 80, trap: 70,
  }
  const base = baseBySpecialty[specialty] ?? 35
  // Expected gross ≈ 8 sales × average margin — priced like everything else
  // in the sim: off real market anchors, not vibes.
  return round2(base * 6 * Math.max(0.5, Math.min(1.6, heat)))
}

/**
 * Market heat: are cards moving right now? Anchored to the real market via
 * recent listing activity in the player's own shop — a busy shop means a hot
 * scene. Falls back to neutral.
 */
export function marketHeatIndex(): number {
  const week = weekKeyNow()
  const revenue = (db.prepare(`SELECT COALESCE(SUM(amount), 0) AS t FROM shop_ledger WHERE week = ? AND line IN ('cases','bulk','bags')`).get(week) as { t: number }).t
  const heat = 0.7 + Math.min(0.9, revenue / 400) // $0/wk → 0.7, $360+/wk → 1.6
  return round2(heat)
}

function weekKeyNow(): string {
  const d = new Date()
  const day = (d.getUTCDay() + 6) % 7
  const w = new Date(d)
  w.setUTCDate(d.getUTCDate() - day)
  return w.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export function bookShow(venueId: string, gate: number, tablePrice: number, guestIds: string[] = []): { ok: boolean; error?: string; show?: ShowRow } {
  const venue = venueById(venueId)
  if (!venue) return { ok: false, error: 'Unknown venue' }
  if (upcomingShow()) return { ok: false, error: 'You already have a show on the calendar — run it first' }
  if (!Number.isFinite(gate) || gate < 0 || gate > 40) return { ok: false, error: 'Gate must be $0–$40' }
  if (!Number.isFinite(tablePrice) || tablePrice < 0 || tablePrice > 500) return { ok: false, error: 'Table price must be $0–$500' }

  // The host booth needs a free slot at door-open; a full floor at booking
  // could leave their own booth homeless once dealers lock.
  const dealerCap = Math.max(0, venue.capacity - 1)
  if (tablePrice <= 0) {
    const probe = { id: 0, venue: venue.id, gate, table_price: tablePrice, tables_total: dealerCap, booked_at: '', opens_at: '', closes_at: '', resolved: 0, guests: '[]', walkins: null, gate_revenue: null, tables_sold: null, table_revenue: null, refund: null, rep_delta: null, notes: null } as ShowRow
    const wouldCommit = dealerRoster(probe).filter((d) => d.committed).length
    if (wouldCommit >= dealerCap) {
      return { ok: false, error: `Free tables pack the floor (${wouldCommit} dealers would take one) — leave yourself a slot or charge for tables` }
    }
  }

  // Guests: dedupe, validate, and enforce rep gates — a headliner above your
  // reputation tier turns you down at booking, not on show day.
  const wanted = [...new Set(guestIds.filter((x) => typeof x === 'string'))]
  for (const id of wanted) {
    const g = guestById(id)
    if (!g) return { ok: false, error: `Unknown guest: ${id}` }
    if (currentRep() < g.repRequired) return { ok: false, error: `${g.name} won't commit — your scene reputation is below ${g.repRequired}` }
  }
  const fees = guestFees(wanted)

  const total = round2(venue.cost + venue.deposit + fees)
  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < total) {
    const feeNote = fees > 0 ? ` + ${fmtUsdStr(fees)} guest fees` : ''
    return { ok: false, error: `Booking ${venue.name} costs ${fmtUsdStr(venue.cost + venue.deposit)} (hall rent + refundable deposit)${feeNote} — you have ${fmtUsdStr(state.cash)}` }
  }

  const opensAt = new Date(Date.now() + HOUR_MS).toISOString()
  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(total)
    // Only the rent is an expense at signing. The deposit is escrow — it
    // leaves cash but only hits the books if it's later forfeited. Guest
    // fees are upfront appearances money — expensed as overhead.
    pnlAppend('overhead', -venue.cost, `Venue rent — ${venue.name}`)
    if (fees > 0) {
      const names = wanted.map((id) => guestById(id)!.name).join(', ')
      pnlAppend('overhead', -fees, `Guest appearances — ${names}`)
    }
    const info = db.prepare(
      `INSERT INTO card_shows (venue, gate, table_price, tables_total, booked_at, opens_at, closes_at, guests)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(venue.id, round2(gate), round2(tablePrice), venue.capacity, nowIso(), opensAt, new Date(Date.now() + HOUR_MS + HOURS * HOUR_MS).toISOString(), JSON.stringify(wanted))
    const title = SHOW_TITLES[(Number(info.lastInsertRowid) % SHOW_TITLES.length + SHOW_TITLES.length) % SHOW_TITLES.length]
    const guestNote = wanted.length > 0 ? ` Headliners: ${wanted.map((id) => guestById(id)!.name).join(', ')}.` : ''
    logActivity('show', `Booked ${venue.name} — "${title}". Hall rent ${fmtUsdStr(venue.cost)} down, ${fmtUsdStr(venue.deposit)} deposit held.${guestNote} Doors open soon.`, -total)
  })
  tx()
  return { ok: true, show: upcomingShow() }
}

export function setPricing(showId: number, gate: number, tablePrice: number): { ok: boolean; error?: string } {
  const show = db.prepare('SELECT id, resolved, opens_at FROM card_shows WHERE id = ?').get(showId) as { id: number; resolved: number; opens_at: string } | undefined
  if (!show || show.resolved) return { ok: false, error: 'Show not found' }
  if (new Date(show.opens_at).getTime() <= Date.now()) return { ok: false, error: 'Doors are open — pricing is locked' }
  if (!Number.isFinite(gate) || gate < 0 || gate > 40) return { ok: false, error: 'Gate must be $0–$40' }
  if (!Number.isFinite(tablePrice) || tablePrice < 0 || tablePrice > 500) return { ok: false, error: 'Table price must be $0–$500' }
  db.prepare('UPDATE card_shows SET gate = ?, table_price = ? WHERE id = ?').run(round2(gate), round2(tablePrice), showId)
  return { ok: true }
}

/**
 * Swap the guest lineup before doors open. Adding a guest charges the fee
 * immediately; removing one refunds nothing — the signer booked travel.
 */
export function setGuests(showId: number, guestIds: string[]): { ok: boolean; error?: string; spent?: number } {
  const show = db.prepare('SELECT id, venue, resolved, opens_at, guests FROM card_shows WHERE id = ?').get(showId) as
    | { id: number; venue: string; resolved: number; opens_at: string; guests: string } | undefined
  if (!show || show.resolved) return { ok: false, error: 'Show not found' }
  if (new Date(show.opens_at).getTime() <= Date.now()) return { ok: false, error: 'Doors are open — the lineup is locked' }

  const wanted = [...new Set(guestIds.filter((x) => typeof x === 'string'))]
  for (const id of wanted) {
    const g = guestById(id)
    if (!g) return { ok: false, error: `Unknown guest: ${id}` }
    if (currentRep() < g.repRequired) return { ok: false, error: `${g.name} won't commit — your scene reputation is below ${g.repRequired}` }
  }
  const current = parseGuests(show.guests)
  const added = wanted.filter((id) => !current.includes(id))
  const spend = guestFees(added)
  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < spend) {
    const names = added.map((id) => guestById(id)!.name).join(', ')
    return { ok: false, error: `${names} cost${added.length === 1 ? 's' : ''} ${fmtUsdStr(spend)} to book — you have ${fmtUsdStr(state.cash)}` }
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE card_shows SET guests = ? WHERE id = ?').run(JSON.stringify(wanted), showId)
    if (spend > 0) {
      db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(spend)
      pnlAppend('overhead', -spend, `Guest appearances — ${added.map((id) => guestById(id)!.name).join(', ')}`)
    }
    if (added.length > 0) {
      logActivity('show', `Signed ${added.map((id) => guestById(id)!.name).join(' and ')} for the show — travel's non-refundable, so they're locked in.`, -spend)
    }
  })
  tx()
  return { ok: true, spent: spend }
}

export function cancelShow(showId: number): { ok: boolean; error?: string } {
  const show = db.prepare('SELECT * FROM card_shows WHERE id = ? AND resolved = 0').get(showId) as ShowRow | undefined
  if (!show) return { ok: false, error: 'No upcoming show to cancel' }
  const venue = venueById(show.venue)
  if (!venue) return { ok: false, error: 'Venue missing' }
  if (db.prepare(`SELECT id FROM vendor_tables WHERE host_show_id = ? AND settled = 0`).get(showId)) {
    return { ok: false, error: "Your booth is set up and the doors are open — let the show resolve, the hall keeps nothing extra" }
  }
  const refund = round2(venue.deposit * 0.5) // walk away: the hall keeps half the deposit
  const tx = db.transaction(() => {
    db.prepare('UPDATE card_shows SET resolved = 1, walkins = 0, gate_revenue = 0, tables_sold = 0, table_revenue = 0, refund = ?, rep_delta = 0, notes = ? WHERE id = ?')
      .run(refund, 'Cancelled — the hall kept half the deposit.', showId)
    db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(refund)
    // The forfeited half is the loss; the returned half just leaves escrow.
    pnlAppend('shows', -(venue.deposit - refund), 'Deposit forfeited — cancelled show')
    const booked = parseGuests(show.guests)
    const guestNote = booked.length > 0 ? ` Guest fees are gone too — ${fmtUsdStr(guestFees(booked))} in non-refundable appearances.` : ''
    logActivity('show', `Cancelled the ${venue.name} booking. The hall kept ${fmtUsdStr(venue.deposit - refund)} of the deposit.${guestNote}`, refund)
  })
  tx()
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Show day — the tick resolves the event once, when the doors close.
// ---------------------------------------------------------------------------

export function showsTick(): void {
  const show = upcomingShow()
  if (!show) return
  if (new Date(show.closes_at).getTime() > Date.now()) return

  const venue = venueById(show.venue)
  if (!venue) return

  // Roster locks at door-open: who actually set up paid then. The host's own
  // booth (if claimed) IS one of these tables — free in dollars, but it takes
  // a table a dealer would have rented, so the least eager committed dealer
  // walks and the hall runs one short. That lost table_price is the rent.
  const hostTable = db.prepare(`SELECT id, revenue, cost_out, buyer_count FROM vendor_tables WHERE host_show_id = ? AND settled = 0`).get(show.id) as
    | { id: number; revenue: number; cost_out: number; buyer_count: number } | undefined
  const roster = dealerRoster(show)
  const committed = roster.filter((d) => d.committed)
  if (hostTable && committed.length > 0) {
    const bumpIdx = committed.findIndex((d) => d.reason === 'in') // 'first in line' dealers keep their spot
    committed.splice(bumpIdx >= 0 ? bumpIdx : committed.length - 1, 1)
  }
  const tablesSold = Math.min(committed.length, show.tables_total)
  const tableRevenue = round2(tablesSold * show.table_price)

  // Gate: crowd scales with venue, price sensitivity, reputation, heat —
  // and whoever you put on the marquee. Guests compound.
  const heat = marketHeatIndex()
  const rep = currentRep()
  const bookedGuests = parseGuests(show.guests)
  const { crowdMult, repBonus } = guestEffects(bookedGuests)
  // Price elasticity: free/unpriced gates draw everyone; $20 kills the walk-ins.
  const gateDraw = Math.max(0.15, 1 - show.gate / 22)
  const repDraw = 0.55 + (rep / 100) * 0.9
  const baseCrowd = venue.crowd * HOURS
  // Seasonal weather: a holiday-weekend show draws the crowd that's off work.
  const seasonalCrowd = showCrowdMultiplier()
  const walkins = Math.max(0, Math.round(baseCrowd * crowdMult * gateDraw * repDraw * heat * seasonalCrowd * (0.85 + Math.random() * 0.3)))
  const gateRevenue = round2(walkins * show.gate)

  // Did the dealers make money? Their floor depends on foot traffic you drew.
  // A packed hall moves tables; an empty one doesn't.
  const crowdQuality = walkins / Math.max(1, baseCrowd * repDraw) // vs rep-adjusted expectation
  const dealerProfitPer = round2(show.table_price * -0.25 + 40 * crowdQuality * heat) // cheap asks + busy hall → profit
  const happyDealers = dealerProfitPer > 0

  // Reputation: dealers talk. A profitable show echoes; a dead hall stings.
  // Guests leave their own signature — a signing line is a reputation event
  // even when the dealer floor is quiet. A booked-but-dud hall hurts more:
  // you paid to draw a crowd and didn't.
  let repDelta = repBonus
  if (tablesSold >= 3) repDelta += happyDealers ? 2 : 0
  if (walkins >= baseCrowd * crowdMult * 0.8) repDelta += 1
  if (tablesSold >= 5 && happyDealers) repDelta += 1
  if (tablesSold === 0) repDelta -= 2
  if (walkins < baseCrowd * crowdMult * 0.3) repDelta -= 1
  repDelta = Math.max(-4, Math.min(4 + repBonus, repDelta))
  if (repDelta !== 0) addRep(repDelta)

  // Deposit: refunded when you delivered the hall you promised. Your own
  // booth occupies a table but doesn't help fill the dealer floor.
  const promised = Math.min(3, Math.floor(venue.capacity / 8))
  const delivered = tablesSold >= promised
  const refund = delivered ? round2(venue.deposit) : 0

  const notes = buildNotes({ walkins, tablesSold, tableRevenue, gateRevenue, venue, promised, delivered, happyDealers, dealerProfitPer, guests: bookedGuests, hostBooth: hostTable != null })
  const guestSpend = guestFees(bookedGuests)
  const gateProfit = round2(gateRevenue + tableRevenue + refund - venue.cost - venue.deposit - guestSpend)

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE card_shows SET resolved = 1, walkins = ?, gate_revenue = ?, tables_sold = ?, table_revenue = ?, refund = ?, rep_delta = ?, notes = ? WHERE id = ?`,
    ).run(walkins, gateRevenue, tablesSold, tableRevenue, refund, repDelta, notes, show.id)

    // Money: gate + table rent come in; the deposit returns only if delivered.
    let cash = gateRevenue + tableRevenue
    if (refund > 0) cash += venue.deposit
    if (cash > 0) db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(round2(cash))

    // The host's own booth settles with the hall: gross stays the booth's,
    // stock returns to the collection, and the missed table_price is booked
    // as the booth's rent (the dealer who would have paid it never came).
    if (hostTable) {
      vendor.settleHostTable(hostTable, show.table_price)
    }

    // Books: gate + table rent land in the `shows` line. The venue rent was
    // already expensed at booking; the deposit only appears here if forfeited.
    pnlAppend('shows', gateRevenue, `Gate — ${walkins} walk-ins`)
    if (tableRevenue > 0) pnlAppend('shows', tableRevenue, `Table rent — ${tablesSold} dealer${tablesSold === 1 ? '' : 's'}`)
    if (refund === 0) pnlAppend('shows', -venue.deposit, 'Deposit forfeited — hall not delivered')

    // Roster: persist the committed dealers as the show's public face.
    const insert = db.prepare(
      `INSERT INTO card_show_dealers (show_id, name, specialty, avatar, paid, reliable) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    for (const d of committed.slice(0, show.tables_total)) {
      insert.run(show.id, d.name, d.specialty, d.avatar, round2(show.table_price), dealerProfitPer > 0 ? 1 : 0)
    }
  })
  tx()

  const verdict = gateProfit > 0 ? `Cleared ${fmtUsdStr(gateProfit)}.` : gateProfit === 0 ? 'Broke even.' : `Lost ${fmtUsdStr(-gateProfit)}.`
  logActivity('show', `${venue.name}: ${walkins} through the door, ${tablesSold}/${show.tables_total} tables sold. ${verdict} ${notes}`, gateProfit)
  console.log(`[shows] resolved show #${show.id}: walkins=${walkins} (guests ×${crowdMult.toFixed(2)}) tables=${tablesSold} net=${gateProfit} rep=${repDelta >= 0 ? '+' : ''}${repDelta}`)
}

function buildNotes(x: {
  walkins: number; tablesSold: number; tableRevenue: number; gateRevenue: number
  venue: Venue; promised: number; delivered: boolean; happyDealers: boolean; dealerProfitPer: number
  guests: string[]; hostBooth: boolean
}): string {
  const bits: string[] = []
  if (x.tablesSold === 0) bits.push('Not one dealer bit — the ask scared the scene off.')
  else if (!x.delivered) bits.push(`Dealers wanted at least ${x.promised} tables filled before the hall refunds anything.`)
  else bits.push('Promised floor delivered — deposit returned.')
  if (x.tablesSold >= 3 && x.happyDealers) bits.push(`Dealers averaged +${fmtUsdStr(x.dealerProfitPer)} on the day; the scene is buzzing.`)
  if (x.tablesSold >= 3 && !x.happyDealers) bits.push('Dealers moved product but the hall felt thin — word gets around.')
  if (x.hostBooth && x.walkins > 0) bits.push('Your own booth worked the same crowd — the floor was one dealer short, but every sale was yours.')
  if (x.guests.length > 0 && x.walkins > 0) {
    const names = x.guests.map((id) => guestById(id)?.name ?? id).join(' and ')
    bits.push(`${names} drew a line around the block.`)
  }
  if (x.guests.length > 0 && x.walkins === 0) bits.push('Even the headliners couldn\'t fill the hall.')
  if (x.walkins === 0) bits.push('Zero walk-ins. The gate pricing did the damage.')
  return bits.join(' ')
}

// ---------------------------------------------------------------------------
// Read model for the UI
// ---------------------------------------------------------------------------

export function status() {
  const show = upcomingShow()
  const rep = currentRep()
  const guestMenu = availableGuests()
  if (!show) {
    return {
      hasShow: false as const,
      rep,
      nextRepTier: repTier(rep),
      venues: VENUES.map((v) => ({ ...v, total: round2(v.cost + v.deposit) })),
      guests: guestMenu,
      tableAnchorHint: tableAnchor(marketHeatIndex(), 'deals'),
      recent: recentShows().map((r) => ({ ...r, profit: showProfit(r) })),
    }
  }
  const venue = venueById(show.venue)!
  const roster = dealerRoster(show)
  const committed = roster.filter((d) => d.committed)
  const bookedGuests = parseGuests(show.guests)
  const { crowdMult } = guestEffects(bookedGuests)
  const hostBooth = Boolean(db.prepare(`SELECT id FROM vendor_tables WHERE host_show_id = ? AND settled = 0`).get(show.id))
  return {
    hasShow: true as const,
    show,
    venue,
    rep,
    nextRepTier: repTier(rep),
    opensInMin: Math.max(0, Math.round((new Date(show.opens_at).getTime() - Date.now()) / 60_000)),
    closesInMin: Math.max(0, Math.round((new Date(show.closes_at).getTime() - Date.now()) / 60_000)),
    roster,
    committed: committed.length,
    hostBooth,
    guests: guestMenu,
    bookedGuests: bookedGuests.map((id) => guestById(id)).filter((g): g is Guest => Boolean(g)),
    projectedWalkins: Math.max(0, Math.round(venue.crowd * HOURS * crowdMult * Math.max(0.15, 1 - show.gate / 22) * (0.55 + (rep / 100) * 0.9) * marketHeatIndex())),
    tableAnchorHint: tableAnchor(marketHeatIndex(), 'deals'),
    expectedGate: round2(Math.max(0, Math.round(venue.crowd * HOURS * crowdMult * Math.max(0.15, 1 - show.gate / 22) * (0.55 + (rep / 100) * 0.9) * marketHeatIndex() * show.gate))),
    recent: recentShows().map((r) => ({ ...r, profit: showProfit(r) })),
  }
}

/** True show-day net: gate + table rent + deposit back − rent − deposit − guest fees. */
function showProfit(r: ShowRow): number {
  return round2((r.gate_revenue ?? 0) + (r.table_revenue ?? 0) + (r.refund ?? 0) - venueCost(r.venue) - (r.refund ? 0 : (venueById(r.venue)?.deposit ?? 0)) - guestFees(parseGuests(r.guests)))
}

function venueCost(venueId: string): number {
  return venueById(venueId)?.cost ?? 0
}

export function repTier(rep: number): { label: string; blurb: string; next: number | null } {
  if (rep < 25) return { label: 'Unknown', blurb: 'The scene has heard of you, barely. Dealers assume the worst.', next: 25 }
  if (rep < 50) return { label: 'Getting Known', blurb: 'A few dealers would take your call.', next: 50 }
  if (rep < 75) return { label: 'Respected', blurb: 'Tables sell themselves here — the scene shows up for your name.', next: 75 }
  return { label: 'Institution', blurb: 'Your show IS the scene. Dealers plan their quarter around it.', next: null }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function fmtUsdStr(n: number): string {
  return `$${round2(n).toFixed(2)}`
}
