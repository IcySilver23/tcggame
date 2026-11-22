import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayMs } from '../lib/gameday'
import { round2, gradedPriceOf, valueOf, type Condition } from './market'
import { GRADING_SERVICES } from './grading'
import { presentationFactor } from './supplies'
import * as pnl from './pnl'

// ---------------------------------------------------------------------------
// THE FLOOR — card shows as an attendee. You already rent booths at these
// shows (conventions.ts); this is the other side of the table:
//
//   • Every NPC dealer has a hidden MOOD — 0..100, half talent, half how the
//     day is going. Mood drives three doors: the haggle (rigidity = how low
//     they'll go before they even counter), the patience (two rounds max,
//     lowballs sour the table), and their OFFERS on your binder cards.
//   • Buying: walk a table, then offer what you think it's worth. Meet their
//     rigidity floor and it's yours; get close and they counter with the
//     midpoint; push past their patience and the table goes cold (and stays
//     cold all day — remember who not to talk to).
//   • Selling: open your binder across the table. Their offer anchors to real
//     market MINUS a dealer margin, scaled by mood (sweet-talk a happy dealer
//     and the margin shrinks). Sell, decline, or haggle ONE round; the table
//     also buys for store credit at +8% — real shows do.
//   • Grade-and-go boxes at the door: a flat fee to submit raw cards to PSA
//     right on the floor (the standard service's price, +$2 handling). Cards
//     enter the normal grading queue; PSA mails them home.
//
// No schema changes: moods and per-show sell state live on the booths row
// (lazily initialized) and in per-show meta keys, so old DBs upgrade in place.
// ---------------------------------------------------------------------------


type Booth = {
  id: number
  convention_id: number
  vendor_name: string
  avatar: string
  specialty: string
  blurb: string
  mood: number | null
  player_offered: number | null
  seller_counters: number
  sour: number // 0 = friendly, 1 = done with you
}

function booth(boothId: number): Booth | undefined {
  return db
    .prepare(`SELECT * FROM convention_booths WHERE id = ?`)
    .get(boothId) as Booth | undefined
}

/** Moods roll the first time anyone walks a floor — half talent, half day. */
function ensureMood(b: Booth): number {
  if (b.mood != null) return b.mood
  const mood = round2(28 + Math.random() * 64) // 28..92
  db.prepare(`UPDATE convention_booths SET mood = ? WHERE id = ?`).run(mood, b.id)
  return mood
}

function ensureColumns() {
  const cols = (db.prepare(`PRAGMA table_info(convention_booths)`).all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('mood')) db.exec(`ALTER TABLE convention_booths ADD COLUMN mood REAL`)
  if (!cols.includes('player_offered')) db.exec(`ALTER TABLE convention_booths ADD COLUMN player_offered REAL`)
  if (!cols.includes('seller_counters')) db.exec(`ALTER TABLE convention_booths ADD COLUMN seller_counters INTEGER NOT NULL DEFAULT 0`)
  if (!cols.includes('sour')) db.exec(`ALTER TABLE convention_booths ADD COLUMN sour REAL NOT NULL DEFAULT 0`)
}
ensureColumns()

function activeShow() {
  return db
    .prepare(`SELECT * FROM conventions WHERE closes_at > ? ORDER BY id DESC LIMIT 1`)
    .get(nowIso()) as { id: number; name: string; entry_fee: number; closes_at: string; opened_at: string } | undefined
}

function entered(showId: number): boolean {
  return Boolean(getMeta(`conventionEntry:${showId}`))
}

// ---------------------------------------------------------------------------
// Read model — the floor at a glance.
// ---------------------------------------------------------------------------

export function floorStatus() {
  const show = activeShow()
  if (!show) return { open: false as const, nextShowHint: 'The hall is empty — shows run on the event calendar.' }
  if (!entered(show.id)) {
    return { open: true as const, entered: false as const, show: { id: show.id, name: show.name, entryFee: show.entry_fee }, tables: [] }
  }
  const booths = db
    .prepare(
      `SELECT b.id, b.vendor_name, b.avatar, b.specialty, b.blurb, b.mood, b.player_offered, b.seller_counters, b.sour,
              (SELECT COUNT(*) FROM convention_items ci WHERE ci.booth_id = b.id AND ci.status = 'available') AS stock
       FROM convention_booths b WHERE b.convention_id = ? ORDER BY b.id`,
    )
    .all(show.id) as (Record<string, unknown> & { mood: number | null; seller_counters: number; sour: number })[]
  const tables = booths.map((b) => {
    const mood = b.mood != null ? Number(b.mood) : null
    return {
      ...b,
      moodSeen: mood != null ? (mood >= 75 ? 'cheerful' : mood >= 50 ? 'fair' : mood >= 35 ? 'grumpy' : 'miserable') : 'unknown',
      haggleTries: Number(b.seller_counters ?? 0),
      soured: Number(b.sour ?? 0) >= 1,
      boxesPending: boxesPendingFor(Number(b.id)),
    }
  })
  return {
    open: true as const,
    entered: true as const,
    show: { id: show.id, name: show.name, entryFee: show.entry_fee },
    tables,
    minutesLeft: Math.max(0, Math.round((new Date(show.closes_at).getTime() - Date.now()) / 60_000)),
  }
}

function boxesPendingFor(boothId: number): number {
  const show = activeShow()
  if (!show) return 0
  return (db
    .prepare(`SELECT COUNT(*) AS n FROM inventory WHERE acquired_via = 'floor_box' AND acquired_ref = ? AND status = 'grading'`)
    .get(`${show.id}:${boothId}`) as { n: number }).n
}

// ---------------------------------------------------------------------------
// Buying: table stock + the haggle.
// ---------------------------------------------------------------------------

export function tableStock(boothId: number) {
  const show = activeShow()
  if (!show) return { ok: false as const, error: 'No show running' }
  if (!entered(show.id)) return { ok: false as const, error: 'Pay entry at the door first' }
  const b = booth(boothId)
  if (!b || b.convention_id !== show.id) return { ok: false as const, error: 'That table packed up.' }
  const mood = ensureMood(b)

  const rows = db
    .prepare(
      `SELECT ci.id, ci.card_id, ci.condition, ci.graded_grade, ci.ask, c.name, c.image_small, c.rarity, s.name AS set_name
       FROM convention_items ci JOIN cards c ON c.id = ci.card_id JOIN sets s ON s.id = c.set_id
       WHERE ci.booth_id = ? AND ci.status = 'available'
       ORDER BY ci.ask ASC`,
    )
    .all(boothId) as { id: number; card_id: string; condition: Condition; graded_grade: string | null; ask: number; name: string; image_small: string | null; rarity: string | null; set_name: string }[]
  const items = rows.map((r) => {
    const anchor = r.graded_grade ? gradedPriceOf(r.card_id, r.graded_grade).usd : valueOf(r.card_id, 'normal', r.condition)
    return { ...r, anchor, delta: anchor > 0 ? round2(r.ask / anchor - 1) : 0 }
  })
  return {
    ok: true as const,
    booth: { id: b.id, vendorName: b.vendor_name, avatar: b.avatar, specialty: b.specialty, blurb: b.blurb },
    mood,
    moodSeen: mood >= 75 ? 'cheerful' : mood >= 50 ? 'fair' : mood >= 35 ? 'grumpy' : 'miserable',
    soured: (b.sour ?? 0) >= 1,
    haggleTries: b.seller_counters ?? 0,
    playerOffered: b.player_offered ?? 0,
    items,
  }
}

/** Rigidity: the fraction of ask a dealer privately accepts. Mood moves it. */
function rigidity(mood: number, specialty: string): number {
  const base: Record<string, [number, number]> = {
    deals: [0.55, 0.7], bulk: [0.5, 0.68], vintage: [0.72, 0.86],
    modern: [0.7, 0.85], graded: [0.78, 0.92], trap: [0.82, 0.95],
  }
  const [lo, hi] = base[specialty] ?? [0.65, 0.85]
  // Grumpy dealers hold the line; cheerful ones have room.
  const moodSlack = (mood - 50) / 100 // ±0.21 at the extremes
  return Math.max(0.4, Math.min(0.98, (lo + (hi - lo) * Math.random()) * (1 - moodSlack)))
}

const HAGGLE_ROUNDS = 2

export function haggle(itemId: number, offer: number) {
  const show = activeShow()
  if (!show) return { ok: false as const, error: 'No show running' }
  if (!entered(show.id)) return { ok: false as const, error: 'Pay entry at the door first' }
  const item = db
    .prepare(
      `SELECT ci.*, cb.vendor_name, cb.specialty, cb.mood, cb.player_offered, cb.seller_counters, cb.sour, cb.id AS booth_id
       FROM convention_items ci JOIN convention_booths cb ON cb.id = ci.booth_id
       WHERE ci.id = ? AND ci.status = 'available'`,
    )
    .get(itemId) as
    | { id: number; booth_id: number; card_id: string; variant: string; condition: Condition; graded_grade: string | null; ask: number; vendor_name: string; specialty: string; mood: number | null; player_offered: number | null; seller_counters: number; sour: number }
    | undefined
  if (!item) return { ok: false as const, error: 'Someone else grabbed it.' }
  if ((item.sour ?? 0) >= 1) return { ok: false as const, error: `${item.vendor_name} is done talking to you today.` }

  const mood = ensureMood({ ...item, id: item.booth_id, convention_id: show.id, avatar: '', blurb: '' } as Booth)
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(item.card_id) as { name: string }).name
  const bid = round2(Math.max(0.05, offer || 0))
  const rig = rigidity(mood, item.specialty)
  const patience = mood >= 70 ? HAGGLE_ROUNDS : mood >= 45 ? 1 : 0
  const tries = item.seller_counters ?? 0

  const accept = () => {
    const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
    if (state.cash < bid) return { ok: true as const, accepted: false, counter: null, message: `Deal's on — but your wallet isn't. You need $${bid.toFixed(2)}.` }
    const tx = db.transaction(() => {
      db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(bid)
      db.prepare(
        `INSERT INTO inventory (card_id, variant, condition, quantity, status, graded_grade, acquired_via, acquired_ref, cost_basis, acquired_at)
         VALUES (?, ?, ?, 1, 'collection', ?, 'floor', ?, ?, ?)`,
      ).run(item.card_id, item.variant, item.condition, item.graded_grade, `show:${show.id}`, bid, nowIso())
      db.prepare(`UPDATE convention_items SET status = 'sold', sold_at = ? WHERE id = ?`).run(nowIso(), item.id)
      db.prepare(`UPDATE convention_booths SET player_offered = ? WHERE id = ?`).run(bid, item.booth_id)
    })
    tx()
    logActivity('buy', `Floor deal: ${name} off ${item.vendor_name}'s table for $${bid.toFixed(2)} (asked $${item.ask.toFixed(2)}).`, -bid)
    return { ok: true as const, accepted: true, paid: bid, card: name, message: `Handshake. ${name} is yours for $${bid.toFixed(2)}.` }
  }

  if (bid >= item.ask * rig) return accept()

  const triesLeft = patience - tries

  // Close enough — they counter with the midpoint while patience holds.
  if (bid >= item.ask * (rig - 0.12)) {
    if (triesLeft > 0) {
      const counter = round2((bid + item.ask) / 2)
      db.prepare(`UPDATE convention_booths SET player_offered = ?, seller_counters = seller_counters + 1 WHERE id = ?`).run(bid, item.booth_id)
      return { ok: true as const, accepted: false, counter, card: name, message: `${item.vendor_name}: "Best I'll do is $${counter.toFixed(2)}."` }
    }
    return { ok: true as const, accepted: false, counter: null, card: name, message: `${item.vendor_name}: "The ask is the ask: $${item.ask.toFixed(2)}."` }
  }

  // Far off. While patience holds they dismiss you; after that, only a true
  // insult (under rig − 0.35 of the ask) gets the table pulled. Rude-but-
  // plausible numbers just draw a final "no" — the table stays open.
  if (triesLeft > 0) {
    db.prepare(`UPDATE convention_booths SET player_offered = ?, seller_counters = seller_counters + 1 WHERE id = ?`).run(bid, item.booth_id)
    return { ok: true as const, accepted: false, counter: null, card: name, message: `${item.vendor_name}: "Not even close."` }
  }
  if (bid < item.ask * (rig - 0.35)) {
    db.prepare(`UPDATE convention_booths SET player_offered = ?, sour = 1 WHERE id = ?`).run(bid, item.booth_id)
    return { ok: true as const, accepted: false, counter: null, card: name, message: `${item.vendor_name}: "We're done here." (The table has gone cold.)`, souredNow: true }
  }
  return { ok: true as const, accepted: false, counter: null, card: name, message: `${item.vendor_name}: "Final answer's no. Ask is $${item.ask.toFixed(2)}."` }
}

/** Pay the sticker ask — always available, never sours anyone. */
export function buyAtAsk(itemId: number) {
  const show = activeShow()
  if (!show) return { ok: false as const, error: 'No show running' }
  if (!entered(show.id)) return { ok: false as const, error: 'Pay entry at the door first' }
  const item = db
    .prepare(
      `SELECT ci.*, cb.vendor_name FROM convention_items ci JOIN convention_booths cb ON cb.id = ci.booth_id
       WHERE ci.id = ? AND ci.status = 'available'`,
    )
    .get(itemId) as { id: number; card_id: string; variant: string; condition: Condition; graded_grade: string | null; ask: number; vendor_name: string } | undefined
  if (!item) return { ok: false as const, error: 'Someone else grabbed it.' }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < item.ask) return { ok: false as const, error: 'Not enough cash' }
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(item.card_id) as { name: string }).name
  const tx = db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(round2(item.ask))
    db.prepare(
      `INSERT INTO inventory (card_id, variant, condition, quantity, status, graded_grade, acquired_via, acquired_ref, cost_basis, acquired_at)
       VALUES (?, ?, ?, 1, 'collection', ?, 'floor', ?, ?, ?)`,
    ).run(item.card_id, item.variant, item.condition, item.graded_grade, `show:${show.id}`, item.ask, nowIso())
    db.prepare(`UPDATE convention_items SET status = 'sold', sold_at = ? WHERE id = ?`).run(nowIso(), item.id)
  })
  tx()
  logActivity('buy', `Floor buy: paid ${item.vendor_name}'s sticker, $${item.ask.toFixed(2)}, for ${name}.`, -item.ask)
  return { ok: true as const, paid: item.ask, card: name }
}

// ---------------------------------------------------------------------------
// Selling: binder offers across the table.
// ---------------------------------------------------------------------------

/** Dealer margin over market — lower mood means worse offers for you. */
function dealerMargin(mood: number, specialty: string): number {
  const base: Record<string, number> = {
    deals: 0.22, bulk: 0.3, vintage: 0.16, modern: 0.18, graded: 0.14, trap: 0.34,
  }
  const b = base[specialty] ?? 0.22
  // Mood 92 → −10pts off margin; mood 28 → +11pts. Happy dealers pay more.
  return Math.max(0.05, b - (mood - 50) * 0.0022)
}

export type SellCandidate = { id: number; name: string; condition: Condition; gradedGrade: string | null; anchor: number; bare: boolean }

export function sellOffers(boothId: number, limit = 8) {
  const show = activeShow()
  if (!show) return { ok: false as const, error: 'No show running' }
  if (!entered(show.id)) return { ok: false as const, error: 'Pay entry at the door first' }
  const b = booth(boothId)
  if (!b || b.convention_id !== show.id) return { ok: false as const, error: 'That table packed up.' }
  if ((b.sour ?? 0) >= 1) return { ok: false as const, error: `${b.vendor_name} is done talking to you today.` }
  const mood = ensureMood(b)
  const margin = dealerMargin(mood, b.specialty)

  // Raw collection cards (this save keeps raw selling simple; slabs too).
  const rows = db
    .prepare(
      `SELECT i.id, i.card_id, i.condition, i.graded_grade, i.protection, c.name FROM inventory i JOIN cards c ON c.id = i.card_id
       WHERE i.status = 'collection' AND i.quantity > 0 ORDER BY RANDOM() LIMIT 200`,
    )
    .all() as { id: number; card_id: string; condition: Condition; graded_grade: string | null; protection: string | null; name: string }[]
  const seen = new Set<string>()
  const candidates: SellCandidate[] = []
  for (const r of rows) {
    const key = r.graded_grade ? `${r.card_id}:${r.graded_grade}` : `${r.card_id}:${r.condition}`
    if (seen.has(key)) continue
    seen.add(key)
    const anchor = r.graded_grade ? gradedPriceOf(r.card_id, r.graded_grade).usd : valueOf(r.card_id, 'normal', r.condition)
    if (anchor < 0.5) continue
    candidates.push({ id: r.id, name: r.name, condition: r.condition, gradedGrade: r.graded_grade, anchor: round2(anchor), bare: presentationFactor(r.protection, r.graded_grade != null) < 1 })
  }
  candidates.sort((a, b2) => b2.anchor - a.anchor)
  // A bare card is offered under a sleeved copy — the same rule as the buylist
  // and the pawn counter, so no table quietly pays full price for loose stock.
  const top = candidates.slice(0, limit).map((c) => {
    const factor = c.bare ? presentationFactor(null) : 1
    return {
      ...c,
      offer: round2(Math.max(0.1, c.anchor * (1 - margin) * factor)),
      creditOffer: round2(Math.max(0.12, c.anchor * (1 - margin) * 1.08 * factor)),
    }
  })
  return { ok: true as const, booth: { id: b.id, vendorName: b.vendor_name, avatar: b.avatar }, mood, credit: creditBalance(b.id).credit, offers: top }
}

/** Sell (cash or credit) or haggle one round on a binder card. */
export function sellToDealer(
  boothId: number,
  inventoryId: number,
  mode: 'cash' | 'credit' | 'haggle',
) {
  const show = activeShow()
  if (!show) return { ok: false as const, error: 'No show running' }
  if (!entered(show.id)) return { ok: false as const, error: 'Pay entry at the door first' }
  const b = booth(boothId)
  if (!b || b.convention_id !== show.id) return { ok: false as const, error: 'That table packed up.' }
  if ((b.sour ?? 0) >= 1) return { ok: false as const, error: `${b.vendor_name} is done talking to you today.` }
  const mood = ensureMood(b)
  const inv = db
    .prepare(
      `SELECT i.*, c.name FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ? AND i.status = 'collection'`,
    )
    .get(inventoryId) as { id: number; card_id: string; condition: Condition; graded_grade: string | null; cost_basis: number; name: string; protection: string | null; fake_revealed: number } | undefined
  if (!inv) return { ok: false as const, error: 'That card is not in your binder.' }

  // AUTH META: the training wall pays a flat dollar for a known fake — the
  // dealer's loupe catches what the player's paid verdict already did.
  if (inv.fake_revealed) {
    const tx = db.transaction(() => {
      db.prepare('UPDATE game_state SET cash = cash + 1').run()
      db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(inv.id)
      db.prepare('DELETE FROM inventory WHERE id = ? AND quantity <= 0').run(inv.id)
    })
    tx()
    logActivity('floor', `${b.vendor_name} spot-checked the ${inv.name} — counterfeit. Paid the training-wall dollar and kept it for the display case.`)
    return { ok: true as const, sold: true as const, paid: 1, credit: 0, card: inv.name, message: `The loupe didn't lie: counterfeit. $1, training wall.` }
  }

  const anchor = inv.graded_grade ? gradedPriceOf(inv.card_id, inv.graded_grade).usd : valueOf(inv.card_id, 'normal', inv.condition)
  const margin = dealerMargin(mood, b.specialty)
  // Bare, raw stock: the dealer offers under a sleeved copy (same as the sheet).
  const offer = round2(Math.max(0.1, anchor * (1 - margin) * presentationFactor(inv.protection, inv.graded_grade != null)))
  const key = `floor:sell:${show.id}:${b.id}`

  const doSell = (amount: number, credit: boolean) => {
    const tx = db.transaction(() => {
      db.prepare(`UPDATE inventory SET quantity = quantity - 1 WHERE id = ?`).run(inv.id)
      db.prepare('DELETE FROM inventory WHERE id = ? AND quantity <= 0').run(inv.id)
      if (credit) {
        setMeta(`${key}:credit`, String(round2(Number(getMeta(`${key}:credit`) ?? 0) + amount)))
      } else {
        db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(amount)
        pnl.append('overhead', amount, `🤝 floor sale to ${b.vendor_name} — ${inv.name}`)
      }
    })
    tx()
    logActivity(
      'sale',
      credit
        ? `Sold ${inv.name} to ${b.vendor_name} for $${amount.toFixed(2)} in store credit (spendable at their table).`
        : `Sold ${inv.name} across the table to ${b.vendor_name} for $${amount.toFixed(2)}. Basis $${inv.cost_basis.toFixed(2)}.`,
      amount,
    )
    return { ok: true as const, sold: true as const, paid: amount, credit, card: inv.name }
  }

  if (mode === 'cash') return doSell(offer, false)
  if (mode === 'credit') return doSell(round2(offer * 1.08), true)

  // Haggle: ONE push. Mood decides whether the dealer moves, holds, or walks.
  const ask = round2(offer * 1.25)
  if (mood >= 65 && Math.random() < 0.6) {
    const bumped = round2(Math.min(anchor * 0.98, offer * 1.18))
    return doSell(bumped, false)
  }
  if (mood < 40 || Math.random() < 0.35) {
    db.prepare(`UPDATE convention_booths SET sour = 1 WHERE id = ?`).run(b.id)
    return { ok: true as const, sold: false as const, souredNow: true, card: inv.name, message: `${b.vendor_name}: "Take it or leave it." (The table has gone cold.)` }
  }
  return { ok: true as const, sold: false as const, card: inv.name, message: `${b.vendor_name}: "${ask.toFixed(2)}? I'll stand by my ${offer.toFixed(2)}."` }
}

/** Store credit balance with a dealer this show — spendable on their stock. */
export function creditBalance(boothId: number) {
  const show = activeShow()
  if (!show) return { credit: 0 }
  return { credit: round2(Number(getMeta(`floor:sell:${show.id}:${boothId}:credit`) ?? 0)) }
}

/** Spend store credit on a table item (credit first, cash tops up the rest). */
export function buyWithCredit(boothId: number, itemId: number) {
  const show = activeShow()
  if (!show) return { ok: false as const, error: 'No show running' }
  if (!entered(show.id)) return { ok: false as const, error: 'Pay entry at the door first' }
  const item = db
    .prepare(
      `SELECT ci.*, cb.vendor_name FROM convention_items ci JOIN convention_booths cb ON cb.id = ci.booth_id
       WHERE ci.id = ? AND ci.status = 'available' AND cb.id = ?`,
    )
    .get(itemId, boothId) as { id: number; card_id: string; variant: string; condition: Condition; graded_grade: string | null; ask: number; vendor_name: string } | undefined
  if (!item) return { ok: false as const, error: 'Someone else grabbed it.' }
  const credit = round2(Number(getMeta(`floor:sell:${show.id}:${boothId}:credit`) ?? 0))
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  const fromCredit = Math.min(credit, item.ask)
  const fromCash = round2(item.ask - fromCredit)
  if (fromCash > state.cash) return { ok: false as const, error: 'Not enough cash to cover what credit doesn’t.' }
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(item.card_id) as { name: string }).name
  const tx = db.transaction(() => {
    setMeta(`floor:sell:${show.id}:${boothId}:credit`, String(round2(credit - fromCredit)))
    if (fromCash > 0) db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(fromCash)
    db.prepare(
      `INSERT INTO inventory (card_id, variant, condition, quantity, status, graded_grade, acquired_via, acquired_ref, cost_basis, acquired_at)
       VALUES (?, ?, ?, 1, 'collection', ?, 'floor', ?, ?, ?)`,
    ).run(item.card_id, item.variant, item.condition, item.graded_grade, `show:${show.id}`, round2(item.ask), nowIso())
    db.prepare(`UPDATE convention_items SET status = 'sold', sold_at = ? WHERE id = ?`).run(nowIso(), item.id)
  })
  tx()
  logActivity('buy', `Credit + cash at ${item.vendor_name}'s table: ${name} for $${item.ask.toFixed(2)} ($${fromCredit.toFixed(2)} credit, $${fromCash.toFixed(2)} cash).`, -fromCash)
  return { ok: true as const, paid: item.ask, creditUsed: fromCredit, cashUsed: fromCash, card: name }
}

// ---------------------------------------------------------------------------
// Grade-and-go boxes — PSA submissions right on the floor.
// ---------------------------------------------------------------------------

export function gradeAndGo(boothId: number, inventoryId: number) {
  const show = activeShow()
  if (!show) return { ok: false as const, error: 'No show running' }
  if (!entered(show.id)) return { ok: false as const, error: 'Pay entry at the door first' }
  const b = booth(boothId)
  if (!b) return { ok: false as const, error: 'Table not found.' }
  const inv = db
    .prepare(`SELECT i.*, c.name FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ? AND i.status = 'collection'`)
    .get(inventoryId) as { id: number; card_id: string; condition: Condition; graded_grade: string | null; name: string } | undefined
  if (!inv || inv.graded_grade) return { ok: false as const, error: 'Raw cards only — slabs are already graded.' }
  // The standard service's fee, +$2 handling for the on-floor drop.
  const svc = GRADING_SERVICES.find((s) => s.id === 'standard') ?? GRADING_SERVICES[0]
  const fee = round2(svc.cost + 2)
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < fee) return { ok: false as const, error: `The box costs $${fee.toFixed(2)} per card.` }
  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(fee)
    db.prepare(
      `UPDATE inventory SET status = 'grading', grading_service = ?, grading_submitted_at = ?, grading_due_at = ? WHERE id = ?`,
    ).run(svc.id, nowIso(), new Date(Date.now() + (3 + Math.floor(Math.random() * 4)) * gameDayMs()).toISOString(), inv.id)
    pnl.append('overhead', -fee, `📦 grade-and-go box fee — ${inv.name}`)
  })
  tx()
  logActivity('grading', `Grade-and-go: ${inv.name} dropped in the PSA box at ${b.vendor_name}'s table — $${fee.toFixed(2)}, results by mail.`, -fee)
  return { ok: true as const, fee, card: inv.name }
}
