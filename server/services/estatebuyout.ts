// ---------------------------------------------------------------------------
// Estate & collection buyouts — the roadmap's sight-unseen whale. A whole
// collection surfaces as one listing: one photo, one number, NO card list.
// The photo is 2–3 glimpses of the top of a shuffled stack (real cards, real
// conditions), the ask anchors to what the glimpse cards are worth — so the
// reveal can be junk under a strong top or a grail buried in bulk — and the
// heirs (lawyer-precise or grieving-attached, per mood) haggle with counters
// and a floor: two rounds, then final. Cash closes the deal; the vault takes
// what fits and the rest stays with the estate. The inherited-binder reveal
// mirrors the estate-lot ceremony: pay first, see everything after.
//
// Condition-roll suspense: the photo shows real cards at REAL conditions (the
// glimpse rows are pinned at generation), but the cards behind them keep their
// condition face-down — /api/estate-sales and /reveal serve a '???' face and a
// per-archetype band — and only the buy() ceremony rolls each card's condition
// and re-prices it. Face-down rows are priced at the archetype's expected
// condition while hidden, so the roll is pure variance — the heirs price the
// dream, the binder delivers the truth. Legacy listings join the game via a
// one-time backfill that derives each row's NM anchor from its pinned price.
// Background life: 0–1 new listings per game day, NPC collectors take slow
// ones after ~2 game days, listings expire after ~6.
// ---------------------------------------------------------------------------

import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayKey, gameDayHours } from '../lib/gameday'
import { valueOf, CONDITIONS, CONDITION_MULT, round2, type Condition } from './market'
import * as vault from './vault'

// How many draws the photo pins (real cards, real conditions, real prices).
const COND_W = 3

// Face-down rows are priced, while hidden, at the archetype's EXPECTED
// condition — the average multiplier of that archetype's condition mix — so
// the listing's economics (estimate, ask, floor) stay exactly as fair as the
// old roll-everything-up-front system. The suspense is pure variance: the
// heirs price the dream, the binder delivers the truth.
const EXPECTED_MULT: Record<'junkdrawer' | 'mixedbox' | 'whale', number> = {
  junkdrawer: 3.8 / 6, // (MP HP HP DM LP NM) / 6
  mixedbox: 4.4 / 6, // (NM LP LP MP MP HP) / 6
  whale: 5.25 / 6, // (NM NM NM LP LP MP) / 6
}

// The per-archetype NM band, shown to the player so the face-down cards still
// mean money — just not which card is worth which.
const COND_BANDS = {
  junkdrawer: { lo: 0.05, hi: 2.5 },
  mixedbox: { lo: 0.1, hi: 25 },
  whale: { lo: 1, hi: 400 },
} as const

function anchorFor(arch: 'junkdrawer' | 'mixedbox' | 'whale', m: number | null): number {
  if (m != null && m > 0) return m
  return arch === 'whale' ? 400 : arch === 'mixedbox' ? 25 : 2.5
}

const HEIRS = [
  'the Delgado heirs', 'Marcus (the grandson)', 'Whitmore & Sons Estate Law',
  'the Okada family', 'Dale from Probate', 'the three nieces', 'the Ferreira Estate',
  'Aunt Bev\u2019s kids', 'the Hartmann brothers', 'a court-appointed liquidator',
]

// Listing voice — shown on the card, colors the negotiation.
const PERSONAS = [
  { id: 'overattached', label: 'Overattached', blurb: '\u201cDad always said these were worth a fortune.\u201d Prices from grief, not from comps.', rigidity: 0.85 },
  { id: 'fastcash', label: 'Fast Cash', blurb: '\u201cJust make it disappear by the weekend.\u201d Will move for a fair number.', rigidity: 0.65 },
  { id: 'precise', label: 'Precise', blurb: '\u201cWe had it appraised.\u201d The ask is the ask — until it isn\u2019t, once.', rigidity: 0.9 },
  { id: 'clueless', label: 'Clueless', blurb: '\u201cIt\u2019s all Pokémon, right?\u201d The number came from a Facebook post.', rigidity: 0.7 },
] as const

const GLIMPSE_NOTES = [
  'The photo is blurry — but the top card is real.',
  'One photo, side angle, wrist watch for scale.',
  '\u201cThere\u2019s more where these came from. Probably.\u201d',
  'The binder behind the stack is thick. That\u2019s all you know.',
  'Someone\u2019s thumb is in the shot. The cards behind it are a mystery.',
  'A 1980s penny is taped to the reverse holographic. The heirs call it \u201cprotection.\u201d',
]

type PersonaId = (typeof PERSONAS)[number]['id']
function personaInfo(id: string) {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[1]
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}
function randInt(min: number, max: number) {
  return Math.floor(rand(min, max + 1))
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ---------------------------------------------------------------------------
// Schema (idempotent — schema.sql carries the same DDL for fresh saves)
// ---------------------------------------------------------------------------

try {
  db.exec(`CREATE TABLE IF NOT EXISTS estate_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_name TEXT NOT NULL,
    persona TEXT NOT NULL,
    mood INTEGER NOT NULL,               -- 0 grouchy..100 warm; shifts with respect shown
    card_count INTEGER NOT NULL,
    ask REAL NOT NULL,                   -- the number on the listing (moves with counters)
    opening_ask REAL NOT NULL,           -- what the heirs first wanted
    seller_estimate REAL NOT NULL,       -- their (noisy) opinion of the whole thing
    player_offered REAL,                 -- last offer on the table
    counters_used INTEGER NOT NULL DEFAULT 0,
    final_said INTEGER NOT NULL DEFAULT 0,   -- heirs said "final" — next lowball walks
    glimpse_note TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',     -- open | sold | taken | expired
    opened_day TEXT NOT NULL,
    closes_at TEXT NOT NULL,
    bought_at TEXT,
    sold_for REAL,
    deal_price REAL,                   -- sealed by an accepted offer; buy() honors it
    gen_anchor TEXT                    -- archetype at spawn (band lookup on read)
  )`)
  try { db.exec('ALTER TABLE estate_sales ADD COLUMN deal_price REAL') } catch { /* exists */ }
  try { db.exec('ALTER TABLE estate_sales ADD COLUMN gen_anchor TEXT') } catch { /* exists */ }
  db.exec(`CREATE TABLE IF NOT EXISTS estate_sale_cards (
    sale_id INTEGER NOT NULL REFERENCES estate_sales(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    condition TEXT,                       -- NULL = face-down until the binder opens
    price REAL NOT NULL,                  -- glimpse: real value; face-down: expected-value price
    anchor REAL,                          -- NM-anchored dream price; the buy() roll settles it
    gen_anchor TEXT                       -- archetype at spawn, so the band follows the listing
  )`)
  // Pre-0.5.69 tables carry condition TEXT NOT NULL — SQLite can't relax a
  // column in place, so rebuild the table when the constraint is still there.
  // The copy pass doubles as the legacy backfill: every old row was pinned,
  // so its anchor is its price ÷ the condition multiplier.
  const cols = db.prepare(`PRAGMA table_info(estate_sale_cards)`).all() as { name: string; notnull: number }[]
  if (cols.find((c) => c.name === 'condition')?.notnull) {
    db.exec(`CREATE TABLE estate_sale_cards_v2 (
      sale_id INTEGER NOT NULL REFERENCES estate_sales(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL,
      condition TEXT,
      price REAL NOT NULL,
      anchor REAL,
      gen_anchor TEXT
    )`)
    db.exec(`INSERT INTO estate_sale_cards_v2 (sale_id, card_id, condition, price, anchor, gen_anchor)
      SELECT sale_id, card_id, condition, price,
             ROUND(price / CASE condition WHEN 'NM' THEN 1 WHEN 'LP' THEN 0.8 WHEN 'MP' THEN 0.65
                                          WHEN 'HP' THEN 0.5 WHEN 'DM' THEN 0.35 ELSE 1 END, 2),
             COALESCE((SELECT es.gen_anchor FROM estate_sales es WHERE es.id = estate_sale_cards.sale_id), 'junkdrawer')
      FROM estate_sale_cards`)
    db.exec('DROP TABLE estate_sale_cards')
    db.exec('ALTER TABLE estate_sale_cards_v2 RENAME TO estate_sale_cards')
  }
  try { db.exec('ALTER TABLE estate_sale_cards ADD COLUMN anchor REAL') } catch { /* exists */ }
  try { db.exec('ALTER TABLE estate_sale_cards ADD COLUMN gen_anchor TEXT') } catch { /* exists */ }
  // One-time migration for saves that predate the condition-roll: stamp the
  // generation anchor and derive NM anchors for any pinned row still missing
  // one. New rows are stamped at insert.
  if (getMeta('estateCondRollMigrated') !== '1') {
    db.exec(`UPDATE estate_sale_cards SET gen_anchor = COALESCE((
      SELECT es.gen_anchor FROM estate_sales es WHERE es.id = estate_sale_cards.sale_id
    ), 'junkdrawer') WHERE gen_anchor IS NULL`)
    db.exec(`UPDATE estate_sales SET gen_anchor = 'junkdrawer' WHERE gen_anchor IS NULL`)
    db.exec(`UPDATE estate_sale_cards SET anchor = ROUND(price / CASE condition
      WHEN 'NM' THEN 1 WHEN 'LP' THEN 0.8 WHEN 'MP' THEN 0.65 WHEN 'HP' THEN 0.5 WHEN 'DM' THEN 0.35 ELSE 1 END, 2)
      WHERE anchor IS NULL AND condition IS NOT NULL`)
    setMeta('estateCondRollMigrated', '1')
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_estate_sales_status ON estate_sales (status)`)
} catch (e) {
  console.log('[estatebuyout] table setup skipped:', e instanceof Error ? e.message : e)
}

// ---------------------------------------------------------------------------
// Generation — a whole collection, one photo, one number
// ---------------------------------------------------------------------------

// Grade the stack: value is concentrated (top-heavy like real collections) —
// the top card of a strong estate can be most of the money, junk fills the rest.
function rollArchetype(): 'junkdrawer' | 'mixedbox' | 'whale' {
  const r = Math.random()
  if (r < 0.5) return 'junkdrawer'
  if (r < 0.87) return 'mixedbox'
  return 'whale'
}

const ARCHETYPES = {
  junkdrawer: { size: [60, 140] as [number, number], perCard: [0.05, 2.5] as [number, number], vintageBias: 0.1 },
  mixedbox: { size: [40, 90] as [number, number], perCard: [0.1, 25] as [number, number], vintageBias: 0.3 },
  whale: { size: [15, 45] as [number, number], perCard: [1, 400] as [number, number], vintageBias: 0.65 },
}

function setYear(setId: string): number {
  const row = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(setId) as { release_date: string } | undefined
  return row ? Number(row.release_date.slice(0, 4)) : 2025
}

function realPricedPool(minV: number, maxV: number, vintageBias: number): { id: string; set_id: string; m: number | null }[] {
  // Pull a random slice of the real-priced catalog, then keep cards in band.
  const pool = db
    .prepare(
      `SELECT c.id, c.set_id,
              (SELECT market FROM price_records pr WHERE pr.card_id = c.id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) AS m
       FROM cards c WHERE c.rarity IS NOT NULL AND c.rarity != ''
       ORDER BY RANDOM() LIMIT 700`,
    )
    .all() as { id: string; set_id: string; m: number | null }[]
  let valued = pool.filter((p) => p.m != null && p.m >= minV && p.m <= maxV)
  if (valued.length > 8 && vintageBias > 0 && Math.random() < vintageBias) {
    const wotc = valued.filter((p) => setYear(p.set_id) <= 2007)
    if (wotc.length >= 6) valued = wotc
  }
  return valued
}

function spawnSale(): boolean {
  const arch = rollArchetype()
  const prof = ARCHETYPES[arch]
  const pool = realPricedPool(prof.perCard[0], prof.perCard[1], prof.vintageBias)
  if (pool.length < 6) return false

  const n = randInt(prof.size[0], prof.size[1])
  const conds: Condition[] = arch === 'whale'
    ? ['NM', 'NM', 'NM', 'LP', 'LP', 'MP']
    : arch === 'mixedbox'
      ? ['NM', 'LP', 'LP', 'MP', 'MP', 'HP']
      : ['MP', 'HP', 'HP', 'DM', 'LP', 'NM']
  // The first COND_W draws are the photo: real cards at real, pinned
  // conditions. Everything behind them stays face-down (condition NULL) at its
  // expected-value price — the buy() roll settles what each card really is.
  const chosen: { card_id: string; condition: Condition | null; price: number; anchor: number }[] = []
  for (let i = 0; i < n; i++) {
    const c = pick(pool)
    const glimpse = i < COND_W
    const cond: Condition | null = glimpse ? conds[i % conds.length] : null
    const dream = round2(Math.max(0.03, anchorFor(arch, c.m ?? null)))
    const price = glimpse
      ? round2(Math.max(0.03, valueOf(c.id, 'normal', cond as Condition)))
      : round2(Math.max(0.03, dream * EXPECTED_MULT[arch]))
    chosen.push({ card_id: c.id, condition: cond, price, anchor: dream })
  }
  if (chosen.length < 6) return false

  const trueValue = round2(chosen.reduce((a, c) => a + c.price, 0))
  // The heirs' estimate is an opinion: sometimes the Facebook-post number.
  const persona = pick(PERSONAS)
  const estSwing = persona.id === 'clueless' ? rand(0.8, 3.2) : persona.id === 'overattached' ? rand(0.9, 2.6) : rand(0.55, 1.35)
  const estimate = Math.max(2, round2(trueValue * estSwing))
  // The ask opens above the estimate (heirs dream) — the haggle walks it down.
  const ask = Math.max(3, round2(estimate * rand(1.0, 1.35)))

  const ins = db.prepare(
    `INSERT INTO estate_sales (seller_name, persona, mood, card_count, ask, opening_ask, seller_estimate, glimpse_note, status, opened_day, closes_at, gen_anchor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
  )
  const insCard = db.prepare(`INSERT INTO estate_sale_cards (sale_id, card_id, condition, price, anchor, gen_anchor) VALUES (?, ?, ?, ?, ?, ?)`)
  const tx = db.transaction(() => {
    const res = ins.run(
      pick(HEIRS), persona.id, randInt(45, 75), chosen.length, ask, ask, estimate,
      pick(GLIMPSE_NOTES), gameDayKey(), new Date(Date.now() + randInt(4, 8) * 86_400_000).toISOString(),
      arch,
    )
    const id = Number(res.lastInsertRowid)
    for (const c of chosen) insCard.run(id, c.card_id, c.condition, c.price, c.anchor, arch)
  })
  tx()
  logActivity('estate', `New estate listing: ${personaInfo(persona.id).label.toLowerCase()} heirs with ${chosen.length} cards, sight unseen — asking $${ask.toFixed(2)}.`)
  return true
}

/** Debug/testing hook: force a listing right now. */
export function debugSpawnSale(): boolean {
  return spawnSale()
}

// ---------------------------------------------------------------------------
// Glimpses — the photo. Top 2–3 of a shuffled stack, nothing else.
// ---------------------------------------------------------------------------

function glimpsesFor(saleId: number): { card_id: string; name: string; image_small: string | null; set_name: string; condition: string; hidden: boolean }[] {
  // The photo is rows with a pinned condition — spawnSale pins the first
  // COND_W draws, legacy listings pinned all of theirs. Genuinely face-down
  // rows never appear here: the photo always shows what it claims to show.
  const rows = db
    .prepare(
      `SELECT esc.card_id, esc.condition, c.name, c.image_small, s.name AS set_name
       FROM estate_sale_cards esc JOIN cards c ON c.id = esc.card_id JOIN sets s ON s.id = c.set_id
       WHERE esc.sale_id = ? AND esc.condition IS NOT NULL ORDER BY RANDOM() LIMIT 3`,
    )
    .all(saleId) as { card_id: string; condition: string; name: string; image_small: string | null; set_name: string }[]
  return rows.map((r) => ({ card_id: r.card_id, name: r.name, image_small: r.image_small, set_name: r.set_name, condition: r.condition, hidden: false }))
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

type SaleRow = {
  id: number
  seller_name: string
  persona: string
  mood: number
  card_count: number
  ask: number
  opening_ask: number
  seller_estimate: number
  player_offered: number | null
  counters_used: number
  final_said: number
  glimpse_note: string
  status: string
  opened_day: string
  closes_at: string
  bought_at: string | null
  sold_for: number | null
  deal_price: number | null
  gen_anchor: string | null
}

function saleOut(r: SaleRow) {
  const p = personaInfo(r.persona)
  const hoursLeft = Math.max(0, (new Date(r.closes_at).getTime() - Date.now()) / 3_600_000)
  return {
    id: r.id,
    seller_name: r.seller_name,
    persona: r.persona,
    persona_label: p.label,
    persona_blurb: p.blurb,
    mood: r.mood,
    card_count: r.card_count,
    ask: r.ask,
    opening_ask: r.opening_ask,
    estimate: r.seller_estimate,
    yourOffer: r.player_offered,
    // Sealed by an accepted offer — buy() charges THIS, not the ask. Without
    // it on the wire the UI kept showing the sticker price after an heir
    // already shook on a lower number.
    dealPrice: r.deal_price,
    countersUsed: r.counters_used,
    finalSaid: !!r.final_said,
    glimpse_note: r.glimpse_note,
    refusal: refusalLive(r.id),
    glimpses: glimpsesFor(r.id),
    condBand: COND_BANDS[(r.gen_anchor ?? 'junkdrawer') as 'junkdrawer' | 'mixedbox' | 'whale'] ?? COND_BANDS.junkdrawer,
    condHidden: 1,
    hoursLeft: Math.round(hoursLeft),
    hoursPerGameDay: gameDayHours(),
  }
}

export function section() {
  const rows = db
    .prepare(`SELECT * FROM estate_sales WHERE status = 'open' ORDER BY ask ASC`)
    .all() as SaleRow[]
  const listings = rows.map((r) => saleOut(r))

  const agg = db
    .prepare(
      `SELECT COUNT(*) AS bought, SUM(sold_for) AS spent,
              (SELECT SUM(price) FROM estate_sale_cards esc JOIN estate_sales es ON es.id = esc.sale_id WHERE es.status = 'sold') AS realized
       FROM estate_sales WHERE status = 'sold'`,
    )
    .get() as { bought: number; spent: number | null; realized: number | null }
  const cardsBought = db
    .prepare(`SELECT COUNT(*) AS n FROM estate_sale_cards esc JOIN estate_sales es ON es.id = esc.sale_id WHERE es.status = 'sold'`)
    .get() as { n: number }

  return {
    listings,
    stats: {
      bought: agg.bought,
      cardsInherited: cardsBought.n,
      spent: round2(agg.spent ?? 0),
      realized: round2(agg.realized ?? 0),
      net: round2((agg.realized ?? 0) - (agg.spent ?? 0)),
    },
  }
}

// ---------------------------------------------------------------------------
// Haggling with the heirs — counters, a floor, and a walk-away
// ---------------------------------------------------------------------------

const NEG = { counterMax: 2 }

function moodTone(mood: number): string {
  if (mood >= 70) return '\u201cYou know, you seem like you\u2019ll actually take care of these.\u201d'
  if (mood >= 40) return '\u201cWe just want this handled properly.\u201d'
  return '\u201cDon\u2019t waste our time. There\u2019s a line of people who\u2019ll pay.\u201d'
}

/** Mirror of forum.refusalWindowFor — the forum owns the metas and a static
 * import would cycle (the tick hook already goes through dynamic import), so
 * this reads the same keys: rep ≥ 25, the DM targets this sale, window open. */
function refusalLive(saleId: number): boolean {
  if (Number(getMeta('forum:rep') ?? '0') < 25) return false
  if (getMeta('forum:refusalSale') !== String(saleId)) return false
  return Number(getMeta('forum:refusalUntil') ?? '0') > Date.now()
}

export function negotiate(
  saleId: number,
  offer: number,
): { ok: true; accepted: boolean; paid?: number; counter?: number | null; message: string; finalSaid?: boolean } | { ok: false; error: string } {
  const s = db.prepare(`SELECT * FROM estate_sales WHERE id = ? AND status = 'open'`).get(saleId) as SaleRow | undefined
  if (!s) return { ok: false, error: 'That listing is gone — the heirs found another buyer.' }
  if (getMeta('tut:estate') !== '1') setMeta('tut:estate', '1')
  if (!(offer > 0)) return { ok: false, error: 'Offer something.' }
  if (offer > s.ask) return { ok: false, error: `They\u2019re asking $${s.ask.toFixed(2)} — just pay it.` }

  const p = personaInfo(s.persona)
  // The heirs' floor: a fraction of the ask they'll actually sign at. Mood and
  // persona set it — grief holds high, fast-cash folds, precise barely bends.
  const moodSlack = (s.mood - 50) / 500 // -0.01..+0.01 — mood nudges, never rules
  // First refusal: the heirs held the lot for you and open up a little — the
  // DM's teeth, on top of the one-game-day head start the board already gives.
  const refusal = refusalLive(saleId)
  const floorFrac = Math.min(0.92, Math.max(0.45, p.rigidity - 0.12 + moodSlack + rand(-0.05, 0.05) - (refusal ? 0.04 : 0)))
  const floor = s.ask * floorFrac

  // At or above the ask — accepted (post to /buy to close at the ask).
  if (offer >= s.ask * 0.995) {
    return { ok: true, accepted: true, paid: s.ask, message: `${s.seller_name} accepts $${s.ask.toFixed(2)}.` }
  }

  // At or under the floor — signed. The deal price is stamped on the listing;
  // the buy endpoint honors it (an accepted handshake isn't re-opened).
  if (offer >= floor) {
    const respect = offer >= s.ask * 0.8 ? 4 : 0
    db.prepare(`UPDATE estate_sales SET mood = MIN(100, mood + ?), player_offered = ?, deal_price = ? WHERE id = ?`).run(respect, offer, round2(offer), saleId)
    return { ok: true, accepted: true, paid: round2(offer), message: `${s.seller_name} shakes on $${offer.toFixed(2)}.` }
  }

  // Under the floor: two counters, then final, then they walk.
  if (s.counters_used < NEG.counterMax) {
    // Counter = midpoint between their last position and the offer, never below
    // the floor — heirs negotiate down TO the floor, not through it.
    const anchor = s.player_offered ?? s.ask
    const counter = round2(Math.max(floor, (anchor + offer) / 2))
    db.prepare(`UPDATE estate_sales SET player_offered = ?, counters_used = counters_used + 1 WHERE id = ?`).run(offer, saleId)
    const saidFinal = s.counters_used + 1 >= NEG.counterMax
    return {
      ok: true,
      accepted: false,
      counter,
      message: `${s.seller_name}: \u201cBest we\u2019ll do is $${counter.toFixed(2)}.\u201d ${moodTone(s.mood)}`,
      finalSaid: saidFinal,
    }
  }

  // Post-final: a serious bid still closes; a lowball ends the conversation
  // for good (the listing stays — apologize and grovel your way back in).
  if (offer >= s.ask * 0.9) {
    db.prepare(`UPDATE estate_sales SET deal_price = ? WHERE id = ?`).run(round2(offer), saleId)
    return { ok: true, accepted: true, paid: round2(offer), message: `${s.seller_name}, out of patience but not out of cards: \u201cFine. $${offer.toFixed(2)}.\u201d` }
  }
  db.prepare(`UPDATE estate_sales SET final_said = 1 WHERE id = ?`).run(saleId)
  return {
    ok: true,
    accepted: false,
    counter: null,
    message: `${s.seller_name}: \u201cWe said $${s.ask.toFixed(2)} is the number. Come back when you\u2019re serious.\u201d`,
    finalSaid: true,
  }
}

/** Apologize: once per listing, resets the counters and softens the mood. */
export function apologize(saleId: number): { ok: boolean; message?: string; error?: string } {
  const s = db.prepare(`SELECT * FROM estate_sales WHERE id = ? AND status = 'open' AND final_said = 1`).get(saleId) as SaleRow | undefined
  if (!s) return { ok: false, error: 'Nothing to apologize for. Yet.' }
  db.prepare(`UPDATE estate_sales SET counters_used = 0, final_said = 0, mood = MAX(0, mood - 5), player_offered = NULL WHERE id = ?`).run(saleId)
  return { ok: true, message: `You grovel appropriately. ${s.seller_name} will hear another offer — with less patience.` }
}

// ---------------------------------------------------------------------------
// Buying + the inherited-binder reveal
// ---------------------------------------------------------------------------

export function buy(saleId: number): { ok: false; error: string } | {
  ok: true
  paid: number
  estimate: number
  realized: number
  profit: number
  pct: number
  admitted: number
  leftBehind: number
  verdict: string
  rolledCount: number
  condBand: { lo: number; hi: number }
  cards: { card_id: string; name: string; condition: string; set_name: string; image_small: string | null; price: number; rolled?: boolean }[]
} {
  const s = db.prepare(`SELECT * FROM estate_sales WHERE id = ? AND status = 'open'`).get(saleId) as SaleRow | undefined
  if (!s) return { ok: false, error: 'That listing is gone — the heirs found another buyer.' }
  if (getMeta('tut:estate') !== '1') setMeta('tut:estate', '1')
  // An accepted handshake sets the number — paying the sticker after the heirs
  // already shook on less would be estate-law malpractice.
  const due = round2(s.deal_price ?? s.ask)
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < due) return { ok: false, error: `Not enough cash (need $${due.toFixed(2)})` }

  const rows = db
    .prepare(
      `SELECT esc.rowid AS rid, esc.card_id, esc.condition, esc.price, esc.anchor, c.name, c.image_small, s.name AS set_name
       FROM estate_sale_cards esc JOIN cards c ON c.id = esc.card_id JOIN sets s ON s.id = c.set_id
       WHERE esc.sale_id = ?`,
    )
    .all(saleId) as { rid: number; card_id: string; condition: string | null; price: number; anchor: number | null; name: string; image_small: string | null; set_name: string }[]
  if (rows.length === 0) return { ok: false, error: 'The estate listing is empty — liquidator error.' }

  const archKey = ((s.gen_anchor ?? 'junkdrawer') as 'junkdrawer' | 'mixedbox' | 'whale')
  const mult = EXPECTED_MULT[archKey] ?? EXPECTED_MULT.junkdrawer

  // Room on the shelf is checked BEFORE any die is cast: a blocked buyout
  // leaves the binder exactly as closed as it was.
  const admitted = vault.makeRoomFor(rows.length, 'Estate buyout')
  if (admitted <= 0) {
    return { ok: false, error: 'No room on the shelf — sell, case, or scrap before inheriting a collection.' }
  }

  // The binder opens: every face-down card rolls its condition here — once,
  // permanently — and its price settles at anchor × the condition multiplier.
  // Glimpse cards already show what they are; the surprise lives behind them.
  let rolledCount = 0
  const upd = db.prepare(`UPDATE estate_sale_cards SET condition = ?, price = ? WHERE rowid = ?`)
  const cards = rows
    .map((r) => {
      if (r.condition != null) return { ...r, condition: r.condition }
      rolledCount++
      const cond = CONDITIONS[randInt(0, CONDITIONS.length - 1)]
      const settled = round2(Math.max(0.03, (r.anchor ?? r.price / mult) * CONDITION_MULT[cond]))
      upd.run(cond, settled, r.rid)
      return { ...r, condition: cond, price: settled, rolled: true }
    })
    .sort((a, b) => b.price - a.price)

  const realized = round2(cards.reduce((a, c) => a + c.price, 0))
  const perCard = round2(due / cards.length)

  const tx = db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(due)
    db.prepare(`UPDATE estate_sales SET status = 'sold', bought_at = ?, sold_for = ?, deal_price = NULL WHERE id = ?`).run(nowIso(), due, saleId)
    const insert = db.prepare(
      `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, acquired_ref, cost_basis, acquired_at)
       VALUES (?, 'normal', ?, 1, 'collection', 'estate_sale', ?, ?, ?)`,
    )
    for (const c of cards.slice(0, admitted)) insert.run(c.card_id, c.condition, String(s.id), perCard, nowIso())
    logActivity(
      'estate',
      `Bought out ${s.seller_name} — ${cards.length} cards for $${due.toFixed(2)}, appraised at $${realized.toFixed(2)} (${realized >= due ? '+' : '-'}$${Math.abs(round2(realized - due)).toFixed(2)}).`,
      -due,
    )
  })
  tx()

  const profit = round2(realized - due)
  const pct = due > 0 ? Math.round((profit / due) * 100) : 0
  const verdict =
    realized >= due * 2
      ? 'You robbed the heirs. They\u2019re still smiling.'
      : realized > s.seller_estimate
        ? 'Better than the heirs claimed — the photo undersold it.'
        : realized >= due * 0.9
          ? 'A fair inheritance. The pennies on the reverse holos throw off the count.'
          : 'The heirs won this one. Somewhere, a Facebook post is laughing.'

  return {
    ok: true,
    paid: due,
    estimate: s.seller_estimate,
    realized,
    profit,
    pct,
    admitted,
    leftBehind: cards.length - admitted,
    rolledCount,
    condBand: COND_BANDS[archKey] ?? COND_BANDS.junkdrawer,
    verdict,
    cards: cards.map((c) => ({ ...c, price: round2(c.price) })),
  }
}

// ---------------------------------------------------------------------------
// Tick — new listings, NPC takeaways, expiry
// ---------------------------------------------------------------------------

export function estateBuyoutTick() {
  const today = gameDayKey()
  if (getMeta('estateSpawnDay') !== today) {
    setMeta('estateSpawnDay', today)
    if (Math.random() < 0.65 && (db.prepare(`SELECT COUNT(*) AS n FROM estate_sales WHERE status = 'open'`).get() as { n: number }).n < 3) {
      spawnSale()
      // The forum's first-refusal perk: a high-standing collector gets the DM
      // before the lot goes public (a 1-game-day head start to move).
      import('./forum').then((f) => {
        const latest = db.prepare(`SELECT id, seller_name, ask, card_count FROM estate_sales WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get() as { id: number; seller_name: string; ask: number; card_count: number } | undefined
        if (latest) f.offerFirstRefusal(latest.id, latest.seller_name, latest.ask, latest.card_count)
      }).catch(() => {})
    }
  }
  const now = nowIso()
  // NPC collectors take slow listings (2+ game days old) at a rolling chance.
  const stale = db
    .prepare(`SELECT id, seller_name, ask FROM estate_sales WHERE status = 'open' AND opened_day <= ?`)
    .all(new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)) as { id: number; seller_name: string; ask: number }[]
  for (const s of stale) {
    if (Math.random() < 0.08) {
      db.prepare(`UPDATE estate_sales SET status = 'taken' WHERE id = ?`).run(s.id)
      logActivity('estate', `Another collector got to ${s.seller_name} first — the listing at $${s.ask.toFixed(2)} is gone.`)
    }
  }
  db.prepare(`UPDATE estate_sales SET status = 'expired' WHERE status = 'open' AND closes_at <= ?`).run(now)

  // A refusal DM dies with its lot: once the sale it points at is no longer
  // open (bought, taken, expired), drop the metas so the board badge and the
  // heirs' softness don't outlive the listing.
  const rs = getMeta('forum:refusalSale')
  if (rs && !db.prepare(`SELECT id FROM estate_sales WHERE id = ? AND status = 'open'`).get(Number(rs))) {
    db.prepare(`DELETE FROM meta WHERE key IN ('forum:refusalSale', 'forum:refusalUntil')`).run()
  }
}
