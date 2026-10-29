import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayMs } from '../lib/gameday'
import { resolvePrice, round2, type Condition } from './market'
import * as pnl from './pnl'
import * as vault from './vault'

// ---------------------------------------------------------------------------
// FACEBOOK MARKETPLACE & CRAIGSLIST — the wild west. No storefront, no fees,
// no protection. NPC locals list whatever they've got at whatever number they
// woke up believing: some clueless, some scam-adjacent. Meet in a parking lot,
// cash in hand, no recourse.
//
//   • Listings spawn continuously from real synced cards, asks 0.15×–3× the
//     real market at condition — a wider spread than any regulated surface.
//   • The "too good to be true" tell: deep deals over 10% of market carry a
//     counterfeit chance that scales with the discount. Buy it cheap enough
//     and you might be the mark. Detected fakes are sellable ONLY to buylist
//     shops at $1 flat.
//   • Meetups: cash in hand. 1-in-8 no-shows (ghosted), ~1-in-25 "sorry, sold
//     locally already" (a real buyer took it between message and lot), and
//     grumpy-haggler NPCs counter once ~30% of the time.
//   • Your own listings: post any raw collection card (one sale path at a
//     time, enforced against BidBay/shop/auctions). Local buyers message you:
//     full-price takers, lowballs at midnight, and ghosts. A meeting pings
//     you — accept and they show (mostly). Your sale is cash, in person, off
//     the books (no platform fee; this is a personal sale, not shop revenue).
// ---------------------------------------------------------------------------


const FAKE_VALUE = 1 // detected counterfeit: buylist shops pay a flat dollar

export type LocalRow = {
  id: number
  card_id: string
  name: string
  image_small: string | null
  variant: string
  condition: Condition
  set_name: string | null
  ask: number
  anchor: number
  seller: string
  source: 'facebook' | 'craigslist' | 'mine'
  posted_at: string
  expires_at: string
  counter_offer: number | null
  counter_of: number | null
  ghosted: number
  sold: number
  inventory_id: number | null
  is_fake: number
}

export function ensureColumns() {
  const cols = (db.prepare(`PRAGMA table_info(local_listings)`).all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('counter_offer')) db.exec(`ALTER TABLE local_listings ADD COLUMN counter_offer REAL`)
  if (!cols.includes('counter_of')) db.exec(`ALTER TABLE local_listings ADD COLUMN counter_of REAL`)
  if (!cols.includes('ghosted')) db.exec(`ALTER TABLE local_listings ADD COLUMN ghosted INTEGER NOT NULL DEFAULT 0`)
}
ensureColumns()

// ---------------------------------------------------------------------------
// Spawning — the local feed.
// ---------------------------------------------------------------------------

const FB_NAMES = ['Mike (no scams)', 'Dave', 'Karen H.', 'Local Dad', 'HobbyHoarder88', 'Jess', 'Frank', 'TonyTwoSleeves', 'Craigslist Carl', 'anonymous user']
const MEET_SPOTS = ['the Walmart lot', 'the bank parking lot', 'the gas station on Route 9', 'the mall food court', 'the library steps']

function anchorOf(cardId: string, condition: Condition): number {
  return resolvePrice(cardId, 'normal', condition).usd ?? 0
}

export function spawnPass() {
  // Keep the feed stocked: ~6 rows, older ones culled on expiry.
  const live = (db.prepare('SELECT COUNT(*) n FROM local_listings WHERE sold = 0 AND expires_at > ?').get(nowIso()) as { n: number }).n
  if (live >= 6) return 0
  const want = 2
  const candidates = db
    .prepare(
      `WITH latest AS (
         SELECT card_id, market,
                ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY retrieved_at DESC) rn
         FROM price_records WHERE kind = 'tcgplayer' AND market IS NOT NULL
       )
       SELECT c.id, c.name, c.image_small, l.market, s.name AS set_name
       FROM latest l JOIN cards c ON c.id = l.card_id JOIN sets s ON s.id = c.set_id
       WHERE l.rn = 1 AND l.market BETWEEN 1 AND 300 ORDER BY RANDOM() LIMIT ?`,
    )
    .all(want * 4) as { id: string; name: string; image_small: string | null; market: number; set_name: string }[]
  if (candidates.length === 0) return 0
  const insert = db.prepare(
    `INSERT INTO local_listings (card_id, variant, condition, ask, anchor_at_spawn, seller, source, posted_at, expires_at, is_fake)
     VALUES (?, 'normal', ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  let made = 0
  for (let i = 0; i < want && candidates.length > 0; i++) {
    const c = candidates[Math.floor(Math.random() * candidates.length)]
    const condition = (['NM', 'LP', 'MP', 'HP'] as Condition[])[Math.floor(Math.random() * 4)]
    const anchor = anchorOf(c.id, condition)
    if (anchor < 0.5) continue
    // The wild-west spread: most asks wander around market, but the tails are
    // long — clueless (under) and dreamers (way over) both exist.
    const roll = Math.random()
    let mult: number
    if (roll < 0.22) mult = 0.15 + Math.random() * 0.35 // the too-good zone
    else if (roll < 0.7) mult = 0.55 + Math.random() * 0.7
    else mult = 1.3 + Math.random() * 1.7 // the "I know what I've got" zone
    const ask = Math.max(0.5, round2(anchor * mult))
    // Counterfeit risk: only the too-good zone is dangerous, scaling with depth.
    const fakeChance = mult < 0.5 ? Math.min(0.65, (0.5 - mult) * 1.4 + 0.05) : 0
    const source = Math.random() < 0.5 ? 'facebook' : 'craigslist'
    insert.run(
      c.id, condition, ask, anchor,
      FB_NAMES[Math.floor(Math.random() * FB_NAMES.length)], source, nowIso(),
      new Date(Date.now() + (1.5 + Math.random() * 2.5) * gameDayMs()).toISOString(),
      fakeChance > 0 && Math.random() < fakeChance ? 1 : 0,
    )
    made++
  }
  return made
}

/** The tell the UI is allowed to show: discount depth as an emoji risk hint. */
function tellFor(ask: number, anchor: number): '🐟' | '🤔' | null {
  if (anchor <= 0) return null
  const ratio = ask / anchor
  if (ratio < 0.25) return '🐟' // smells fishy
  if (ratio < 0.5) return '🤔' // suspicious
  return null
}

// ---------------------------------------------------------------------------
// Reading the feed.
// ---------------------------------------------------------------------------

export function feed() {
  spawnPass()
  const rows = db
    .prepare(
      `SELECT l.*, c.name, c.image_small, s.name AS set_name
       FROM local_listings l JOIN cards c ON c.id = l.card_id JOIN sets s ON s.id = c.set_id
       WHERE l.sold = 0 AND l.expires_at > ?
       ORDER BY l.posted_at DESC LIMIT 30`,
    )
    .all(nowIso()) as (LocalRow & { anchor_at_spawn: number })[]
  return rows.map((r) => {
    const anchor = r.anchor_at_spawn
    return {
      id: r.id,
      cardId: r.card_id,
      name: r.name,
      image: r.image_small,
      condition: r.condition,
      setName: r.set_name,
      ask: r.ask,
      anchor: round2(anchor),
      seller: r.seller,
      source: r.source,
      postedAt: r.posted_at,
      expiresAt: r.expires_at,
      delta: anchor > 0 ? round2(r.ask / anchor - 1) : 0,
      tell: tellFor(r.ask, anchor),
      counterOffer: r.counter_offer,
      counterOf: r.counter_of,
      ghosted: !!r.ghosted,
      set: r.set_name,
    }
  })
}

// ---------------------------------------------------------------------------
// Buying: message → meetup → cash.
// ---------------------------------------------------------------------------

export type MeetResult =
  | { ok: true; outcome: 'bought' | 'sold'; paid: number; card?: string; inspected?: 'genuine' | 'fake'; basis?: number; message?: string }
  | { ok: true; outcome: 'ghosted'; message: string }
  | { ok: true; outcome: 'sold_elsewhere'; message: string }
  | { ok: true; outcome: 'counter'; counter: number; card: string; message: string }
  | { ok: false; error: string }

export function meet(listingId: number, offered?: number): MeetResult {
  const r = db
    .prepare(
      `SELECT l.*, c.name FROM local_listings l JOIN cards c ON c.id = l.card_id WHERE l.id = ? AND l.sold = 0`,
    )
    .get(listingId) as (LocalRow & { name: string; anchor_at_spawn: number }) | undefined
  if (!r || r.expires_at <= nowIso()) return { ok: false, error: 'That listing is gone.' }
  const price = offered != null && offered > 0 ? round2(offered) : r.ask

  // A counter that's still open resolves on this meet.
  if (r.counter_offer != null && offered == null) return { ok: false, error: `They're holding at $${r.counter_offer.toFixed(2)} — pay it or move on.` }

  // The dice of the parking lot.
  const roll = Math.random()
  if (roll < 0.12) {
    db.prepare('UPDATE local_listings SET ghosted = ghosted + 1 WHERE id = ?').run(listingId)
    logActivity('local', `💬 ${r.seller} never showed at ${MEET_SPOTS[Math.floor(Math.random() * MEET_SPOTS.length)]}. Left you on read since.`)
    return { ok: true, outcome: 'ghosted', message: `${r.seller} never showed. Left on read.` }
  }
  if (roll < 0.16) {
    db.prepare('UPDATE local_listings SET sold = 1, sold_at = ? WHERE id = ?').run(nowIso(), listingId)
    logActivity('local', `💬 ${r.seller}: "sorry sold it locally already" — someone got there first.`)
    return { ok: true, outcome: 'sold_elsewhere', message: '"Sorry, sold it locally already." Someone got there first.' }
  }
  if (offered != null && offered < r.ask && r.counter_of == null && roll < 0.45) {
    const counter = round2((price + r.ask) / 2)
    db.prepare('UPDATE local_listings SET counter_offer = ?, counter_of = ? WHERE id = ?').run(counter, price, listingId)
    return { ok: true, outcome: 'counter', counter, card: r.name, message: `${r.seller}: "Meet me at $${counter.toFixed(2)} and it's yours."` }
  }

  // Sold — cash changes hands. Inspect before you pay…
  const isFake = !!r.is_fake
  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < price) return { ok: false, error: 'Not enough cash on you.' }
  // Storage & the vault: no trunk space, no deal (unless auto-scrap makes some).
  const admit = vault.admitRawFor(1, 'Parking-lot deal')
  if (!admit.ok) return { ok: false, error: admit.error }
  let newInvId = 0
  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(price)
    const ins = db.prepare(
      `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, acquired_ref, cost_basis, acquired_at, is_fake)
       VALUES (?, ?, ?, 1, 'collection', 'local_deal', ?, ?, ?, ?)`,
    ).run(r.card_id, r.variant, r.condition, String(r.id), price, nowIso(), isFake ? 1 : 0)
    newInvId = Number(ins.lastInsertRowid)
    db.prepare('UPDATE local_listings SET sold = 1, sold_at = ? WHERE id = ?').run(nowIso(), listingId)
  })
  tx()
  // Belt-and-suspenders: the meet reveals the pre-rolled fakes, and the
  // authentication meta can still stamp a hidden risk on the ones that passed
  // the corner test (high-value wide-buy chance, auth.ts).
  if (!isFake) import('./auth').then((a) => a.stampRisk(newInvId, r.card_id, r.variant, r.condition, 'local_deal')).catch(() => {})
  const basis = price
  if (isFake) {
    logActivity('local', `🃏 Paid ${r.seller} $${price.toFixed(2)} for "${r.name}" — and the second you held it, the corners told the truth: COUNTERFEIT. Real one sells for ${fmt(r.anchor_at_spawn)}. Buylist shops pay a flat $${FAKE_VALUE} for fake cardboard.`, -price)
  } else {
    const verdict = price < r.anchor_at_spawn * 0.75 ? 'The deal of the week.' : price > r.anchor_at_spawn * 1.3 ? 'Overpaid like a tourist.' : 'About right for a parking-lot deal.'
    logActivity('buy', `Met ${r.seller} (found via ${r.source}) and paid $${price.toFixed(2)} cash for ${r.name} (${r.condition}). ${verdict}`, -price)
  }
  return { ok: true, outcome: 'bought', paid: price, card: r.name, inspected: isFake ? 'fake' : 'genuine', basis }
}

function fmt(n: number): string {
  return `$${round2(n).toFixed(2)}`
}

// ---------------------------------------------------------------------------
// Selling: your own listings + the messages that arrive.
// ---------------------------------------------------------------------------

export function listMine(inventoryId: number, ask: number): { ok: boolean; error?: string } {
  const row = db.prepare(`SELECT * FROM inventory WHERE id = ? AND status = 'collection'`).get(inventoryId) as
    | { id: number; card_id: string; variant: string; condition: string; quantity: number; graded_grade: string | null; is_fake: number; fake_revealed: number } | undefined
  if (!row) return { ok: false, error: 'Card is not in your collection' }
  if (row.graded_grade) return { ok: false, error: 'Graded slabs sell at the auction house — the locals want raw cardboard' }
  // AUTH META: known fakes (corner-test or USPA verdict) stay off the feed —
  // the buylist training wall is the only market that will touch them.
  if (row.is_fake || row.fake_revealed) return { ok: false, error: 'Known counterfeit — buylist shops pay $1 flat for it (Inventory → 🛡 Authentication)' }
  if (!(ask > 0)) return { ok: false, error: 'Set an ask first' }
  // One sale path at a time, same as BidBay.
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM local_listings WHERE inventory_id = ? AND sold = 0 AND expires_at > ?`).get(inventoryId, nowIso()) as { n: number }
  if (existing.n > 0) return { ok: false, error: 'That card is already posted locally' }
  db.prepare('UPDATE inventory SET status = ?, listing_price = ?, listed_at = ? WHERE id = ?').run('local_listed', round2(ask), nowIso(), row.id)
  db.prepare(
    `INSERT INTO local_listings (card_id, variant, condition, ask, anchor_at_spawn, seller, source, inventory_id, posted_at, expires_at, is_fake)
     VALUES (?, ?, ?, ?, ?, 'you', 'mine', ?, ?, ?, 0)`,
  ).run(row.card_id, row.variant, row.condition, round2(ask), anchorOf(row.card_id, row.condition as Condition), row.id, nowIso(), new Date(Date.now() + 3 * gameDayMs()).toISOString())
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(row.card_id) as { name: string }).name
  logActivity('local', `Posted ${name} on ${Math.random() < 0.5 ? 'Facebook Marketplace' : 'Craigslist'} at $${round2(ask).toFixed(2)} — cash only, no scams, meet at a public lot.`)
  return { ok: true }
}

export function myListings() {
  const rows = db
    .prepare(
      `SELECT l.*, c.name, c.image_small FROM local_listings l JOIN cards c ON c.id = l.card_id
       WHERE l.source = 'mine' AND l.sold = 0 AND l.expires_at > ?`,
    )
    .all(nowIso()) as (LocalRow & { name: string; image_small: string | null })[]
  const mine = db.prepare(`SELECT id, card_id, condition, listing_price FROM inventory WHERE status = 'local_listed'`).all() as { id: number; card_id: string; condition: string; listing_price: number }[]
  return rows.map((r) => {
    const inv = mine.find((m) => m.card_id === r.card_id)
    return {
      id: r.id,
      name: r.name,
      image: r.image_small,
      condition: r.condition,
      ask: r.ask,
      postedAt: r.posted_at,
      expiresAt: r.expires_at,
      inventoryId: inv?.id ?? r.inventory_id,
      messages: messagesFor(r.id),
    }
  })
}

type Msg = { kind: 'full' | 'lowball' | 'ghost' | 'meeting'; buyer: string; amount: number | null; note: string }

function messagesFor(listingId: number): Msg[] {
  return (JSON.parse(getMeta(`local:msg:${listingId}`) ?? '[]') as Msg[])
}

function pushMessage(listingId: number, m: Msg) {
  const all = messagesFor(listingId)
  all.unshift(m)
  setMeta(`local:msg:${listingId}`, JSON.stringify(all.slice(0, 6)))
}

export function cancelMine(listingId: number) {
  const r = db.prepare(`SELECT * FROM local_listings WHERE id = ? AND source = 'mine' AND sold = 0`).get(listingId) as LocalRow | undefined
  if (!r) return { ok: false as const, error: 'Listing not found.' }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE local_listings SET sold = 1, sold_at = ? WHERE id = ?`).run(nowIso(), listingId)
    db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL WHERE id = ? AND status = 'local_listed'`).run(r.inventory_id)
  })
  tx()
  return { ok: true as const }
}

/** Re-relist a local listing whose expiry came and went (frees the binder row). */
function expireMine() {
  const rows = db.prepare(`SELECT * FROM local_listings WHERE source = 'mine' AND sold = 0 AND expires_at <= ?`).all(nowIso()) as LocalRow[]
  for (const r of rows) {
    db.prepare(`UPDATE local_listings SET sold = 1, sold_at = ? WHERE id = ?`).run(nowIso(), r.id)
    db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL WHERE id = ? AND status = 'local_listed'`).run(r.inventory_id)
  }
}

// ---------------------------------------------------------------------------
// The tick — spawns, expiries, and buyer messages on my listings.
// ---------------------------------------------------------------------------

const LOWBALL_NOTES = ['cash today, no questions', 'best I can do', 'taking a risk here at this price', "it's been listed for hours, brother"]
const FULL_NOTES = ["I'll take it, don't sell it to anyone else", 'can meet in 20', 'deal — where do I meet you?']

export function localTick() {
  expireMine()
  db.prepare(`UPDATE local_listings SET sold = 1, sold_at = ? WHERE source != 'mine' AND sold = 0 AND expires_at <= ?`).run(nowIso(), nowIso())
  spawnPass()

  // Buyer messages on my live listings — a couple per tick at most.
  const mine = db.prepare(`SELECT * FROM local_listings WHERE source = 'mine' AND sold = 0 AND expires_at > ?`).all(nowIso()) as LocalRow[]
  for (const l of mine) {
    if (Math.random() > 0.25) continue
    const anchor = anchorOf(l.card_id, l.condition)
    const buyer = FB_NAMES[Math.floor(Math.random() * FB_NAMES.length)]
    const roll = Math.random()
    if (roll < 0.3 && anchor > 0) {
      // Midnight lowball: half price or less.
      const low = round2(Math.max(0.5, anchor * (0.2 + Math.random() * 0.3)))
      pushMessage(l.id, { kind: 'lowball', buyer, amount: low, note: LOWBALL_NOTES[Math.floor(Math.random() * LOWBALL_NOTES.length)] })
    } else if (roll < 0.5) {
      pushMessage(l.id, { kind: 'full', buyer, amount: l.ask, note: FULL_NOTES[Math.floor(Math.random() * FULL_NOTES.length)] })
    } else {
      pushMessage(l.id, { kind: 'ghost', buyer, amount: null, note: 'is this still available? is this still available?' })
    }
  }
}

/** Accept a buyer message: full price or lowball. Meeting risk applies. */
export function acceptOffer(listingId: number, buyer: string, amount: number | null): MeetResult {
  const l = db.prepare(`SELECT * FROM local_listings WHERE id = ? AND source = 'mine' AND sold = 0`).get(listingId) as LocalRow | undefined
  if (!l) return { ok: false, error: 'That listing is gone.' }
  const msg = messagesFor(listingId).find((m) => m.buyer === buyer && (amount == null || m.amount === amount))
  if (!msg) return { ok: false, error: 'That message expired.' }

  // The meeting dice: buyers ghost too, and sometimes the card is "already gone".
  const roll = Math.random()
  if (roll < 0.1) {
    pushMessage(listingId, { kind: 'ghost', buyer, amount, note: 'sorry something came up' })
    logActivity('local', `💬 Your buyer never showed at ${MEET_SPOTS[Math.floor(Math.random() * MEET_SPOTS.length)]}. The card is still yours.`)
    return { ok: true, outcome: 'ghosted', message: 'They never showed. Card stays yours.' }
  }

  const paid = amount ?? l.ask
  const inv = db.prepare(`SELECT * FROM inventory WHERE id = ? AND status = 'local_listed'`).get(l.inventory_id) as { id: number; card_id: string; name?: string; cost_basis: number } | undefined
  if (!inv) return { ok: false, error: 'The card already moved.' }
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(inv.card_id) as { name: string }).name
  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(paid)
    db.prepare(`UPDATE local_listings SET sold = 1, sold_at = ? WHERE id = ?`).run(nowIso(), listingId)
    db.prepare(`UPDATE inventory SET quantity = quantity - 1 WHERE id = ?`).run(inv.id)
    db.prepare('DELETE FROM inventory WHERE id = ? AND quantity <= 0').run(inv.id)
  })
  tx()
  logActivity('sale', `Parking-lot sale: ${name} to ${buyer} for ${fmt(paid)} cash. No fees, no paper trail.`, paid)
  return { ok: true, outcome: 'sold', paid, message: `Sold ${name} to ${buyer} for ${fmt(paid)} cash — no fees, no receipts, no paper trail.` }
}

// ---------------------------------------------------------------------------
// Counterfeit economy — fakes circulate, get caught, and re-enter the market.
// ---------------------------------------------------------------------------

/** Fake cards re-surface on the local feed from sellers who "have no idea". */
function seedFakes() {
  const fakes = db.prepare(`SELECT id, card_id FROM inventory WHERE is_fake = 1 AND status != 'sold' AND quantity > 0 LIMIT 1`).all() as { id: number; card_id: string }[]
  // Fakes don't jump back to market on their own — the *player* usually resells
  // them. Kept as a hook for future NPC-to-NPC churn.
}

/** The buylist route for a burned buyer: shops pay a flat $1. */
export function sellFakeToBuylist(inventoryId: number) {
  const inv = db.prepare(`SELECT i.*, c.name FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ? AND i.is_fake = 1 AND i.status = 'collection'`).get(inventoryId) as { id: number; name: string } | undefined
  if (!inv) return { ok: false as const, error: 'Not a known fake in your collection.' }
  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(FAKE_VALUE)
    db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(inv.id)
    db.prepare('DELETE FROM inventory WHERE id = ? AND quantity <= 0').run(inv.id)
    pnl.append('overhead', FAKE_VALUE, `🃏 sold a detected counterfeit to a buylist shop — ${inv.name}`)
  })
  tx()
  logActivity('sale', `A buylist shop paid $${FAKE_VALUE.toFixed(2)} for the ${inv.name} fake. They keep a wall of them as training aids.`, FAKE_VALUE)
  return { ok: true as const, paid: FAKE_VALUE }
}

/** Inspect a copy you already own — catches fakes you were shipped or bought blind. */
export function inspectForFake(inventoryId: number): { ok: true; fake: boolean; message: string } | { ok: false; error: string } {
  const inv = db.prepare(`SELECT i.*, c.name FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ? AND i.status = 'collection' AND i.graded_grade IS NULL`).get(inventoryId) as { id: number; is_fake: number; name: string } | undefined
  if (!inv) return { ok: false, error: 'Card not found in your collection (raw cards only).' }
  return {
    ok: true,
    fake: !!inv.is_fake,
    message: inv.is_fake
      ? `The ${inv.name} fails every test — wrong texture, wrong font, wrong weight. It's counterfeit: sellable only to buylist shops for $${FAKE_VALUE}.`
      : `The ${inv.name} passes: correct texture, print lines, and weight. Genuine.`,
  }
}
