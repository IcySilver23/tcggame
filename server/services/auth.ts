import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayMs } from '../lib/gameday'
import { valueOf, round2, AUTH_THRESHOLD, SUSPICION_PCT, type Condition } from './market'
import * as pnl from './pnl'

// ---------------------------------------------------------------------------
// THE VINTAGE AUTHENTICATION META — the roadmap's "why everyone pays it."
//
// High-value buys (≈$75+ raw) can arrive counterfeit: every card carries a
// hidden fakeFlag rolled at acquisition (wide buys — the wild west, the flea
// bins, mystery boxes, parking-lot lots — roll far harder than storefronts),
// but the flag stays FACE-DOWN until the card faces a real authentication.
// The only tell the player gets up front is the 🐟 "too good to be true" tell
// that Local Deals already shows — and the market's own nervousness:
// unauthenticated cards trade at a 3–8% AUTH DISCOUNT on every selling
// surface (shop counter, buylist, dealer desk, BidBay) and grading labs
// refuse them entirely until they're authenticated.
//
// The United Slab Protectors of America (USPA) desk:
//   • Free eye-ball scan (the "smell test") — gives band hints, never a
//     verdict. The lab won't touch a suspect card sight unseen.
//   • $15 express jacket — 1 game day. 30% miss rate (real labs miss
//     sophisticated fakes too). Wrong verdict = certified fake walks.
//   • $45 advanced lab — 2 game days. ~8% miss.
//   • $75 full forensic panel — 3 game days. Never wrong.
//
// GETTING BURNED is the tuition: a counterfeit in the collection is worth $1
// to a buylist shop and exactly nothing anywhere else, can't be listed,
// flipped, pawned, auctioned, graded, or consigned. The card's cost basis is
// a lesson you paid for. After the first burn the tutorial tips flip (the
// player knows why everyone pays it), the eye trains (fakes started before
// the burn keep their flag), and the stat line remembers.
// ---------------------------------------------------------------------------

const FAKE_VALUE = 1 // a known counterfeit: buylist shops pay a flat dollar
// AUTH_THRESHOLD (the raw value where the dice start rolling) lives in
// market.ts next to the haircut that uses it; re-exported here for routes.
export { AUTH_THRESHOLD }
const HIGH = 250 // above this, fakes get more common and bolder

const NAMES = ['USPA', 'PSA', 'BGS']

export type RiskProfile = {
  base: number // counterfeit chance at the threshold
  deep: number // extra chance per dollar of depth beyond it
  high: number // chance for cards above HIGH
}

// Wide buys roll harder: nobody curated these cards. Storefronts and pack
// pulls are effectively vetted.
const RISK: Record<string, RiskProfile> = {
  local: { base: 0.07, deep: 0.0006, high: 0.3 },
  flea: { base: 0.09, deep: 0.0008, high: 0.35 },
  resale: { base: 0.06, deep: 0.0005, high: 0.22 },
  mystery: { base: 0.1, deep: 0.001, high: 0.4 },
  storage: { base: 0.08, deep: 0.0007, high: 0.3 },
  estate: { base: 0.1, deep: 0.0009, high: 0.45 },
  default: { base: 0.008, deep: 0.00006, high: 0.035 },
}

function profileFor(acquiredVia: string | null): RiskProfile {
  const via = (acquiredVia ?? '').toLowerCase()
  if (via.startsWith('local')) return RISK.local
  if (via.startsWith('flea')) return RISK.flea
  if (via.startsWith('resale') || via.startsWith('pawn')) return RISK.resale
  if (via.startsWith('mystery') || via.startsWith('yard') || via.startsWith('grabbag') || via.startsWith('box')) return RISK.mystery
  if (via.startsWith('storage') || via.startsWith('auction')) return RISK.storage
  if (via.startsWith('estate')) return RISK.estate
  return RISK.default
}

/** Counterfeit chance for a card of this value arriving through this channel. */
export function fakeChanceFor(raw: number, acquiredVia: string | null): number {
  if (raw < AUTH_THRESHOLD) return 0
  const p = profileFor(acquiredVia)
  if (raw >= HIGH) return p.high
  const depth = raw - AUTH_THRESHOLD
  return Math.min(0.6, p.base + depth * p.deep)
}

// ---------------------------------------------------------------------------
// Schema (idempotent — schema.sql carries the same DDL for fresh saves)
// ---------------------------------------------------------------------------

try {
  db.exec(`CREATE TABLE IF NOT EXISTS auth_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
    service_id TEXT NOT NULL,
    fee REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_lab',   -- in_lab | arrived | expired
    created_at TEXT NOT NULL,
    due_at TEXT NOT NULL,
    arrived_at TEXT
  )`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_tickets_status ON auth_tickets (status)`)
  // The counterfeit economy's social layer (roadmap: scam accusation events).
  db.exec(`CREATE TABLE IF NOT EXISTS auth_accusations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    accuser TEXT NOT NULL,
    persona TEXT NOT NULL,
    card_name TEXT,                        -- null = no named burned card on the ledger
    basis REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',   -- open | cleared | mistrial | convicted
    evidence INTEGER NOT NULL,
    needs INTEGER NOT NULL,
    verdict TEXT,                          -- flavor line shown on resolve
    created_at TEXT NOT NULL,
    resolved_at TEXT
  )`)
  // Pre-0.5.77 installs carry the NOT NULL form — relax it in place.
  const accCols = (db.prepare(`PRAGMA table_info(auth_accusations)`).all() as { name: string; notnull: number }[])
  if (accCols.some((c) => c.name === 'card_name' && c.notnull === 1)) {
    db.exec(`CREATE TABLE auth_accusations_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      accuser TEXT NOT NULL,
      persona TEXT NOT NULL,
      card_name TEXT,
      basis REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      evidence INTEGER NOT NULL,
      needs INTEGER NOT NULL,
      verdict TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    )`)
    db.exec(`INSERT INTO auth_accusations_v2 SELECT * FROM auth_accusations`)
    db.exec(`DROP TABLE auth_accusations`)
    db.exec(`ALTER TABLE auth_accusations_v2 RENAME TO auth_accusations`)
    console.log('[auth] auth_accusations.card_name relaxed to nullable (rebuild)')
  }
} catch (e) {
  console.log('[auth] table setup skipped:', e instanceof Error ? e.message : e)
}

function ensureColumns() {
  const cols = (db.prepare(`PRAGMA table_info(inventory)`).all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('fake_flag')) db.exec(`ALTER TABLE inventory ADD COLUMN fake_flag INTEGER NOT NULL DEFAULT 0`)
  if (!cols.includes('auth_status')) db.exec(`ALTER TABLE inventory ADD COLUMN auth_status TEXT`)
  if (!cols.includes('fake_revealed')) db.exec(`ALTER TABLE inventory ADD COLUMN fake_revealed INTEGER NOT NULL DEFAULT 0`)
}
ensureColumns()

// ---------------------------------------------------------------------------
// Rolling the risk — called by every acquisition path that can carry a fake.
// ---------------------------------------------------------------------------

/**
 * Roll counterfeit risk for a freshly inserted inventory row and stamp the
 * (hidden) flag. Returns the stamp applied. Cheap no-op below the threshold.
 * Call AFTER the inventory row exists — needs the card's id and value.
 */
export function stampRisk(inventoryId: number, cardId: string, variant: string, condition: string, acquiredVia: string | null): void {
  try {
    const row = db.prepare('SELECT id FROM inventory WHERE id = ?').get(inventoryId)
    if (!row) return
    const raw = valueOf(cardId, variant || 'normal', (condition as Condition) || 'NM')
    const chance = fakeChanceFor(raw, acquiredVia)
    if (chance <= 0) return
    if (Math.random() < chance) {
      db.prepare('UPDATE inventory SET fake_flag = 1 WHERE id = ?').run(inventoryId)
    }
  } catch (e) {
    console.log('[auth] stampRisk failed:', e instanceof Error ? e.message : e)
  }
}

/** Same roll for a batch of (inventoryId, card) rows — one statement set. */
export function stampRiskBatch(rows: { inventoryId: number; cardId: string; variant?: string; condition?: string }[], acquiredVia: string | null): void {
  for (const r of rows) stampRisk(r.inventoryId, r.cardId, r.variant ?? 'normal', r.condition ?? 'NM', acquiredVia)
}

/**
 * THE ECONOMY: unauthenticated (and suspected-fake) cards sell at a discount
 * everywhere except the buylist desk, which can vet them in person. Set the
 * metas to wire it into the pricing paths — setMeta so Settings can tune it.
 */
export function authDiscountFor(status: string | null): number {
  if (status === 'authenticated') return 0
  // The street's suspicion after a conviction: raws read as risk while it's hot.
  // SUSPICION_PCT lives in market.ts next to AUTH_THRESHOLD (no import cycle).
  const suspicion = streetSuspicionActive() ? SUSPICION_PCT / 100 : 0
  return Number(getMeta('authDiscountPct') ?? 5) / 100 + suspicion // 5% standard uncertainty haircut (+ conviction tail)
}

/** The sell-path helper: what this row's market value becomes after the auth haircut. */
export function haircutValue(marketUsd: number, row: { auth_status: string | null; fake_revealed: number }): number {
  if (row.fake_revealed) return FAKE_VALUE
  if (row.auth_status === 'authenticated') return marketUsd
  return round2(marketUsd * (1 - authDiscountFor(row.auth_status)))
}

// ---------------------------------------------------------------------------
// The desk — the free eyeball scan, and the paid verdicts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The toolkit — one-time gear that gives the free scan real instrument
// readings. Each reading is correlated with the hidden flag at the tool's
// reliability (instruments mislead too: UV lights get wrongly confident about
// reprints, scales get misread) and is rolled ONCE per card, then remembered —
// an instrument reading doesn't change because you walk it back to the desk.
// Persisting the roll also closes the spam hole: re-running a free scan a
// hundred times must not average its way into a free verdict. The lab decides.
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    id: 'blacklight',
    name: 'UV blacklight',
    icon: '🔦',
    cost: 40,
    blurb: 'Period card stock fluoresces a specific way under UV. Forged coating is the tell forgers miss most.',
    hitIfFake: 0.75, // P(reading flags it | card is fake)
    hitIfReal: 0.92, // P(reading reads clean | card is genuine)
  },
  {
    id: 'scale',
    name: 'Precision scale',
    icon: '⚖️',
    cost: 60,
    blurb: 'Authentic stock sits on its weight spec to the hundredth of a gram. Cheap counterfeits run light.',
    hitIfFake: 0.7,
    hitIfReal: 0.88,
  },
] as const

export type AuthToolOut = { id: string; name: string; icon: string; cost: number; blurb: string; owned: boolean }

export function listTools(): AuthToolOut[] {
  return TOOLS.map((t) => ({ id: t.id, name: t.name, icon: t.icon, cost: t.cost, blurb: t.blurb, owned: getMeta(`auth:tool:${t.id}`) === '1' }))
}

export function buyTool(toolId: string): { ok: true; toolId: string; name: string; cost: number } | { ok: false; error: string } {
  const t = TOOLS.find((x) => x.id === toolId)
  if (!t) return { ok: false, error: 'Unknown toolkit item' }
  if (getMeta(`auth:tool:${t.id}`) === '1') return { ok: false, error: `The ${t.name} is already on the bench` }
  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < t.cost) return { ok: false, error: `Not enough cash — the ${t.name} costs $${t.cost}` }
  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(t.cost)
    setMeta(`auth:tool:${t.id}`, '1')
  })
  tx()
  logActivity('auth', `${t.icon} Bought the ${t.name} ($${t.cost}) — the eye-ball scan now carries an instrument reading. Instruments hint; the lab decides.`)
  return { ok: true, toolId: t.id, name: t.name, cost: t.cost }
}

const TOOL_READINGS: Record<string, { bad: string[]; good: string[] }> = {
  blacklight: {
    bad: [
      '🔦 under UV the coating fluoresces the wrong shade — modern fake coating glows dull violet where period stock stays calm',
      '🔦 the blacklight catches it at arm\u2019s length: the stock glows hot white, and period stock never does',
      '🔦 under UV the holo layer fluoresces unevenly — genuine coating lays down flat',
    ],
    good: [
      '🔦 under UV the stock fluoresces exactly the way genuine print runs do',
      '🔦 the blacklight says nothing — the coating glow is period-correct',
    ],
  },
  scale: {
    bad: [
      '⚖️ the scale reads light — missing grams of the real coating layer',
      '⚖️ weight comes in under spec, the way cheap stock always does',
      '⚖️ two reads on the scale disagree with each other — sloppy card stock disagrees with itself',
    ],
    good: [
      '⚖️ the card sits dead on its weight spec',
      '⚖️ the scale is boring: exactly spec weight, to the hundredth',
    ],
  },
}

export type SurveyToolReading = { id: string; name: string; icon: string; reading: string; suspicious: boolean }

/** Roll (or recall) the instrument reading one owned tool produces for a card.
 * Persisted in meta space so the scan can't be re-rolled for a free verdict. */
function toolReading(toolId: string, inventoryId: number, actuallyFake: boolean): SurveyToolReading | null {
  const t = TOOLS.find((x) => x.id === toolId)
  if (!t) return null
  const key = `auth:read:${inventoryId}:${toolId}`
  const stored = getMeta(key)
  let suspicious: 'bad' | 'good'
  if (stored === 'bad' || stored === 'good') {
    suspicious = stored
  } else {
    suspicious = Math.random() < (actuallyFake ? t.hitIfFake : 1 - t.hitIfReal) ? 'bad' : 'good'
    setMeta(key, suspicious)
  }
  const pool = TOOL_READINGS[t.id][suspicious]
  return { id: t.id, name: t.name, icon: t.icon, reading: pool[Math.floor(Math.random() * pool.length)], suspicious: suspicious === 'bad' }
}

const BAND_TIPS: Record<string, string[]> = {
  high: [
    'the holo layer under raking light looks… fine, actually. Fine is not a verdict.',
    'the card stock feels right. Your fingers are not an instrument.',
    'the print dots look period-correct under the loupe. So did the last famous fake.',
  ],
  clean: [
    'nothing about it screams. Most genuine cards don\u2019t.',
    'the texture, the font, the weight — nothing sets the eye off.',
  ],
  suspect: [
    'the corners feel slightly waxy under the loupe. Or your hands are just dry.',
    'the holo pattern repeats a hair too regularly. Or that\u2019s the print line.',
    'something about the ink smell is… off. Or is that the sleeve?',
  ],
}

type SurveyResult = { ok: true; found: boolean; inventoryId?: number; name?: string; band?: string; chance?: number; note?: string; tools?: SurveyToolReading[]; message?: string }

/** Band + one persisted instrument reading per owned tool, for one card. */
function readCard(card: { id: number; card_id: string; variant: string; condition: string; name: string; raw: number }): SurveyResult {
  const flagRow = db.prepare('SELECT fake_flag, is_fake FROM inventory WHERE id = ?').get(card.id) as { fake_flag: number; is_fake: number } | undefined
  const actuallyFake = !!flagRow?.fake_flag || !!flagRow?.is_fake
  const tools: SurveyToolReading[] = []
  for (const t of TOOLS) {
    if (getMeta(`auth:tool:${t.id}`) !== '1') continue
    const r = toolReading(t.id, card.id, actuallyFake)
    if (r) tools.push(r)
  }
  const chance = fakeChanceFor(card.raw, (db.prepare('SELECT acquired_via FROM inventory WHERE id = ?').get(card.id) as { acquired_via: string | null }).acquired_via)
  const band = chance >= 0.25 ? 'hot' : chance >= 0.12 ? 'warm' : 'cool'
  const tips = BAND_TIPS[band === 'hot' ? 'high' : band === 'cool' ? 'clean' : 'suspect']
  return {
    ok: true,
    found: true,
    inventoryId: card.id,
    name: card.name,
    band,
    chance: Math.round(chance * 100),
    note: tips[Math.floor(Math.random() * tips.length)],
    tools: tools.length > 0 ? tools : undefined,
  }
}

const NOT_IN_LAB = `AND i.id NOT IN (SELECT inventory_id FROM auth_tickets WHERE status IN ('in_lab','arrived'))`

/** The free "smell test": band hints plus an instrument reading per toolkit
 * item owned — still never a verdict. Untargeted it sweeps the binder for the
 * most valuable unvetted card that isn't already in the lab (a card waiting
 * on its verdict no longer blocks the scan — paperwork walks down the binder
 * while the lab works). Targeted — the AuthPicker passes its own card — it
 * files paperwork for exactly that card, so multi-card binders don't
 * serialize behind a single scan slot. */
export function survey(inventoryId?: number): SurveyResult {
  if (inventoryId != null) {
    const row = db
      .prepare(`SELECT i.id, i.card_id, i.variant, i.condition, c.name, i.graded_grade, i.fake_revealed, i.is_fake, i.auth_status FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ?`)
      .get(inventoryId) as { id: number; card_id: string; variant: string; condition: string; name: string; graded_grade: string | null; fake_revealed: number; is_fake: number; auth_status: string | null } | undefined
    if (!row) return { ok: true, found: false, message: 'That card is gone from the binder.' }
    if (row.graded_grade) return { ok: true, found: false, message: `${row.name} is in a slab — the label is the verdict, the eye is not needed.` }
    if (row.fake_revealed || row.is_fake) return { ok: true, found: false, message: `${row.name} is a known counterfeit — the eye has nothing kind to say about it.` }
    if (row.auth_status === 'authenticated') return { ok: true, found: false, message: `${row.name} already wears the jacket — the eye agrees.` }
    const inLab = db.prepare(`SELECT id FROM auth_tickets WHERE inventory_id = ? AND status IN ('in_lab','arrived')`).get(inventoryId)
    if (inLab) return { ok: true, found: false, message: `${row.name} is at the lab right now — its verdict is the paperwork.` }
    const raw = round2(valueOf(row.card_id, row.variant, row.condition as Condition))
    if (raw < AUTH_THRESHOLD) return { ok: true, found: false, message: `${row.name} is under the $${AUTH_THRESHOLD} fake line — fakes don't bother with cheap cardboard, and the market doesn't haircut it. Nothing here for the instruments to read.` }
    return readCard({ id: row.id, card_id: row.card_id, variant: row.variant, condition: row.condition, name: row.name, raw })
  }
  const rows = db
    .prepare(
      `SELECT i.id, i.card_id, i.variant, i.condition, c.name FROM inventory i JOIN cards c ON c.id = i.card_id
       WHERE i.status = 'collection' AND i.graded_grade IS NULL AND i.fake_revealed = 0 AND i.is_fake = 0 AND i.auth_status IS NULL
       ${NOT_IN_LAB}`,
    )
    .all() as { id: number; card_id: string; variant: string; condition: string; name: string }[]
  let best: { id: number; card_id: string; variant: string; condition: string; name: string; raw: number } | null = null
  for (const r of rows) {
    const raw = valueOf(r.card_id, r.variant, r.condition as Condition)
    if (raw >= AUTH_THRESHOLD && (!best || raw > best.raw)) best = { ...r, raw }
  }
  if (!best) {
    return { ok: true, found: false, message: 'Nothing in the binder walks into fake territory — every card the eye can reach is under $' + AUTH_THRESHOLD + ', already vetted, or waiting on a lab verdict. The risk, if any, is buried in the bulk.' }
  }
  return readCard(best)
}

const SERVICES = [
  { id: 'express', name: 'USPA Express Jacket', cost: 15, days: [1, 1], miss: 0.3, blurb: 'Quick look through the jacket machine. Fast, cheap, wrong about a third of the clever fakes.' },
  { id: 'advanced', name: 'USPA Advanced Lab', cost: 45, days: [2, 2], miss: 0.08, blurb: 'Texture, print-dot and ink-density analysis. Misses about one fake in twelve.' },
  { id: 'forensic', name: 'USPA Forensic Panel', cost: 75, days: [3, 3], miss: 0, blurb: 'Full forensic workup — stock paper, holo layer spectrometry, the works. Never wrong. Costs like it.' },
  {
    id: 'desk',
    name: 'USPA Desk Review',
    cost: 8,
    days: [1, 1],
    miss: 0.55,
    blurb: 'The desk reads the complete kit\u2019s paperwork and gives the card a quick light-box pass. Cheap — you did the vetting. Skims over half the clever fakes your instruments already missed.',
    requiresVouched: true,
  },
] as const

export type AuthService = (typeof SERVICES)[number]

export function listServices() {
  return { services: SERVICES.map((s) => ({ ...s, daysMin: s.days[0], daysMax: s.days[1] })), threshold: AUTH_THRESHOLD }
}

/** Client-facing desk-review state for one row — reads only the paperwork
 * metas (which the player paid kit money to earn), never the hidden flag.
 * 'partial' covers both unfinished setups: an incomplete kit on the bench, or
 * a reading an owned instrument hasn't filed yet. */
export function deskReadingFor(inventoryId: number): 'vouched' | 'flagged' | 'partial' | null {
  const owned = TOOLS.filter((t) => getMeta(`auth:tool:${t.id}`) === '1')
  if (owned.length === 0) return null
  let flagged = false
  let missing = false
  for (const t of owned) {
    const r = getMeta(`auth:read:${inventoryId}:${t.id}`)
    if (r === 'bad') flagged = true
    else if (r !== 'good') missing = true
  }
  if (flagged) return 'flagged'
  if (missing || owned.length < TOOLS.length) return 'partial'
  return 'vouched'
}

/**
 * Desk-review eligibility: the COMPLETE kit must be on the bench (half a kit
 * is half a vetting, and half a vetting fast-tracks exactly the wrong cards),
 * every instrument must have read this card, and every reading must vouch.
 * The desk fast-tracks paperwork it agrees with — it never fast-tracks a card
 * its own instruments dispute.
 */
export function deskReviewEligibility(inventoryId: number): { eligible: boolean; reason?: string } {
  const owned = TOOLS.filter((t) => getMeta(`auth:tool:${t.id}`) === '1')
  if (owned.length === 0) return { eligible: false, reason: 'The desk review needs instrument paperwork — buy the toolkit (🔦 $40 / ⚖️ $60) and run the free scan on this card first' }
  if (owned.length < TOOLS.length) {
    const absent = TOOLS.filter((t) => getMeta(`auth:tool:${t.id}`) !== '1').map((t) => `${t.icon} ${t.name}`).join(' and ')
    return { eligible: false, reason: `The desk fast-tracks the complete kit only — ${absent} is missing from the bench. Half a kit is half a vetting.` }
  }
  const flagged: string[] = []
  const missing: string[] = []
  for (const t of owned) {
    const r = getMeta(`auth:read:${inventoryId}:${t.id}`)
    if (r === 'bad') flagged.push(`${t.icon} ${t.name}`)
    else if (r !== 'good') missing.push(`${t.icon} ${t.name}`)
  }
  if (flagged.length > 0) return { eligible: false, reason: `${flagged.join(' and ')} flagged this card — the desk won't fast-track paperwork its own readings dispute. Take it to the advanced lab or forensic panel.` }
  if (missing.length > 0) return { eligible: false, reason: `No reading on file from ${missing.join(' and ')} — run the free eye-ball scan on this card first, then the desk will look at it.` }
  return { eligible: true }
}

export function submitForAuth(inventoryId: number, serviceId: string): { ok: true; fee: number; serviceName: string; dueDays: number } | { ok: false; error: string } {
  const svc = SERVICES.find((s) => s.id === serviceId)
  if (!svc) return { ok: false, error: 'Unknown authentication service' }
  const row = db
    .prepare(`SELECT i.*, c.name FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ? AND i.status = 'collection'`)
    .get(inventoryId) as { id: number; card_id: string; variant: string; condition: string; graded_grade: string | null; is_fake: number; fake_revealed: number; auth_status: string | null; name: string; quantity: number } | undefined
  if (!row) return { ok: false, error: 'Card not in your collection (raw, unlisted copies only)' }
  if (row.graded_grade) return { ok: false, error: 'That card is already in a slab — the label is the verdict' }
  if (row.quantity > 1) return { ok: false, error: 'Authenticating a playset? Submit single copies' }
  if (row.is_fake || row.fake_revealed) return { ok: false, error: 'That card is a known counterfeit — the lab has a wall of those already' }
  if (row.auth_status === 'authenticated') return { ok: false, error: 'Already wearing an authentication jacket' }
  if (getMeta('tut:auth') !== '1') setMeta('tut:auth', '1')
  const dup = db.prepare(`SELECT id FROM auth_tickets WHERE inventory_id = ? AND status IN ('in_lab','arrived')`).get(inventoryId)
  if (dup) return { ok: false, error: 'That card is already in the lab' }
  if ('requiresVouched' in svc && svc.requiresVouched) {
    const v = deskReviewEligibility(inventoryId)
    if (!v.eligible) return { ok: false, error: v.reason ?? 'The desk declines this paperwork' }
  }
  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < svc.cost) return { ok: false, error: `Not enough cash — ${svc.name} costs $${svc.cost}` }
  const days = svc.days[0] + Math.floor(Math.random() * (svc.days[1] - svc.days[0] + 1))
  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(svc.cost)
    db.prepare(`INSERT INTO auth_tickets (inventory_id, service_id, fee, status, created_at, due_at) VALUES (?, ?, ?, 'in_lab', ?, ?)`).run(
      inventoryId, svc.id, svc.cost, nowIso(), new Date(Date.now() + days * gameDayMs()).toISOString(),
    )
  })
  tx()
  logActivity('auth', `Submitted ${row.name} to ${svc.name} ($${svc.cost}) — verdict in ${days} game-day${days === 1 ? '' : 's'}.`, -svc.cost)
  return { ok: true, fee: svc.cost, serviceName: svc.name, dueDays: days }
}

/** Tickets whose lab time is up — flips status='arrived'; the client fetches the reveal. */
export function authTick(): number[] {
  const due = db
    .prepare(`SELECT id, inventory_id FROM auth_tickets WHERE status = 'in_lab' AND due_at <= ?`)
    .all(nowIso()) as { id: number; inventory_id: number }[]
  for (const t of due) {
    db.prepare(`UPDATE auth_tickets SET status = 'arrived', arrived_at = ? WHERE id = ?`).run(nowIso(), t.id)
  }
  return due.map((t) => t.inventory_id)
}

/** THE REVEAL. Applies the verdict: authentication jacket — or the burn. */
export function authReveal(inventoryId: number): {
  ok: true
  verdict: 'genuine' | 'fake'
  inventoryId: number
  cardId: string
  name: string
  image: string | null
  rawValue: number
  fee: number
  message: string
} | { ok: false; error: string } {
  const ticket = db
    .prepare(`SELECT * FROM auth_tickets WHERE inventory_id = ? AND status = 'arrived' ORDER BY id DESC LIMIT 1`)
    .get(inventoryId) as { id: number; service_id: string; fee: number } | undefined
  if (!ticket) return { ok: false, error: 'No verdict waiting on that card.' }
  const svc = SERVICES.find((s) => s.id === ticket.service_id) ?? SERVICES[0]
  const row = db
    .prepare(`SELECT i.*, c.name, c.image_small FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ?`)
    .get(inventoryId) as { id: number; card_id: string; name: string; image_small: string | null; variant: string; condition: string; fake_flag: number; fake_revealed: number; is_fake: number; acquired_via: string | null; cost_basis: number; quantity: number } | undefined
  if (!row) return { ok: false, error: 'The card vanished while the lab had it.' }
  const actuallyFake = !!row.fake_flag || !!row.is_fake
  const missed = actuallyFake && Math.random() < svc.miss
  const rawValue = round2(valueOf(row.card_id, row.variant, row.condition as Condition))

  const tx = db.transaction(() => {
    setMeta('auth:spentOnAuth', String(round2(Number(getMeta('auth:spentOnAuth') ?? '0') + ticket.fee)))
    db.prepare(`UPDATE auth_tickets SET status = 'expired' WHERE id = ?`).run(ticket.id)
    // The desk has spoken — any instrument readings for this card are spent.
    db.prepare(`DELETE FROM meta WHERE key LIKE ?`).run(`auth:read:${row.id}:%`)
  if (missed) {
    // WRONG VERDICT: the lab certifies a fake. That's a certified-fake walk.
    db.prepare(`UPDATE inventory SET auth_status = 'authenticated' WHERE id = ?`).run(row.id)
  } else if (actuallyFake) {
    db.prepare(`UPDATE inventory SET fake_revealed = 1, is_fake = 1, auth_status = NULL WHERE id = ?`).run(row.id)
  } else {
    db.prepare(`UPDATE inventory SET auth_status = 'authenticated' WHERE id = ?`).run(row.id)
  }
  })
  tx()

  if (missed) {
    logActivity('auth', `🎭 ${svc.name} cleared ${row.name} — AUTHENTICATED. The jacket is on the card. (Somewhere, the forger is celebrating; the market will find out eventually.)`)
    return {
      ok: true, verdict: 'genuine', inventoryId: row.id, cardId: row.card_id, name: row.name, image: row.image_small,
      rawValue, fee: ticket.fee,
      message: `The ${svc.name} jacket slides on: AUTHENTIC. ${rawValue >= 100 ? 'The market accepts the paper.' : 'Cheap insurance, correctly spent.'}`,
    }
  }
  if (actuallyFake) {
    const firstBurn = getMeta('auth:burned') !== '1'
    setMeta('auth:burned', '1')
    // A caught fake in the binder puts your name in the fake-trade gossip.
    notorietyFromFakeSale()
    setMeta('tut:auth', '1')
    // Lifetime burn ledger — survives the card being sold off the wall.
    setMeta('auth:fakesCaught', String(Number(getMeta('auth:fakesCaught') ?? '0') + 1))
    setMeta('auth:fakesBasisLost', String(round2(Number(getMeta('auth:fakesBasisLost') ?? '0') + row.cost_basis * row.quantity)))
    const basis = round2(row.cost_basis * row.quantity)
    if (firstBurn) {
      logActivity('auth', `🃏 THE BURN: the ${svc.name} verdict on ${row.name} is COUNTERFEIT. You paid $${basis.toFixed(2)} for cardboard worth $${FAKE_VALUE.toFixed(2)} — a buylist shop will take it off your hands for a dollar and keep it as a training aid. THIS is why everyone pays for authentication.`, -basis)
    } else {
      logActivity('auth', `🃏 Counterfeit confirmed: ${row.name}. $${basis.toFixed(2)} of basis, $${FAKE_VALUE.toFixed(2)} of value. The wall of fakes at the buylist shop gains one more.`, -basis)
    }
    return {
      ok: true, verdict: 'fake', inventoryId: row.id, cardId: row.card_id, name: row.name, image: row.image_small,
      rawValue: FAKE_VALUE, fee: ticket.fee,
      message: firstBurn
        ? `COUNTERFEIT. Wrong texture, wrong font, wrong weight — the ${row.name} is fake, and your $${basis.toFixed(2)} basis is now tuition. Buylist pays $${FAKE_VALUE}. THIS is why everyone pays for authentication.`
        : `COUNTERFEIT. The ${row.name} fails the panel — $${basis.toFixed(2)} of basis reduced to $${FAKE_VALUE} of buylist cardboard.`,
    }
  }
  logActivity('auth', `✅ ${svc.name} verdict on ${row.name}: GENUINE — correct texture, print lines, and weight. The jacket goes on and the AUTH haircut comes off the sell price.`)
  noteJacket()
  return {
    ok: true, verdict: 'genuine', inventoryId: row.id, cardId: row.card_id, name: row.name, image: row.image_small,
    rawValue, fee: ticket.fee,
    message: `GENUINE. The ${row.name} passes the ${svc.name}: texture, print dots, ink density all correct. The jacket goes on — buyers stop discounting it.`,
  }
}

/** The one honest exit for a known fake: the buylist shop's training wall. */
export function sellFakeToBuylist(inventoryId: number): { ok: true; paid: number; name: string } | { ok: false; error: string } {
  const inv = db
    .prepare(`SELECT i.*, c.name FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ? AND (i.fake_revealed = 1 OR i.is_fake = 1) AND i.status = 'collection'`)
    .get(inventoryId) as { id: number; quantity: number; name: string; cost_basis: number } | undefined
  if (!inv) return { ok: false, error: 'Not a revealed counterfeit in your collection.' }
  const basis = round2(inv.cost_basis * inv.quantity)
  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(FAKE_VALUE)
    db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(inv.id)
    db.prepare('DELETE FROM inventory WHERE id = ? AND quantity <= 0').run(inv.id)
    db.prepare('DELETE FROM meta WHERE key LIKE ?').run(`auth:read:${inv.id}:%`)
    pnl.append('overhead', FAKE_VALUE, `🃏 sold a detected counterfeit to a buylist shop — ${inv.name}`)
  })
  tx()
  // Moving a known fake off your hands is exactly what makes the street talk.
  notorietyFromFakeSale()
  logActivity('sale', `A buylist shop paid $${FAKE_VALUE.toFixed(2)} for the ${inv.name} fake. It joins the training wall — basis $${basis.toFixed(2)}, recovered $${FAKE_VALUE.toFixed(2)}. Notoriety in the fake trade +1.`, FAKE_VALUE)
  return { ok: true, paid: FAKE_VALUE, name: inv.name }
}

// ---------------------------------------------------------------------------
// Read model — the AuthDesk tab, and everything the sell paths must guard.
// ---------------------------------------------------------------------------

export function section() {
  authTick()
  // The street votes on the game clock, but the desk's read keeps the case
  // fresh on every view — resolution and new accusations don't wait for a
  // background tick to feel the moment.
  accusationResolveTick()
  accusationTick()
  const tickets = db
    .prepare(
      `SELECT t.*, i.card_id, c.name, c.image_small, s.name AS set_name, i.condition, i.variant
       FROM auth_tickets t JOIN inventory i ON i.id = t.inventory_id JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
       WHERE t.status IN ('in_lab','arrived') ORDER BY t.created_at DESC LIMIT 20`,
    )
    .all() as { id: number; inventory_id: number; service_id: string; fee: number; status: string; created_at: string; due_at: string; card_id: string; name: string; image_small: string | null; set_name: string; condition: string; variant: string }[]
  const now = Date.now()
  const ticketsOut = tickets.map((t) => {
    const raw = round2(valueOf(t.card_id, t.variant, t.condition as Condition))
    return {
      id: t.id,
      inventoryId: t.inventory_id,
      cardId: t.card_id,
      name: t.name,
      image: t.image_small,
      setName: t.set_name,
      condition: t.condition,
      serviceId: t.service_id,
      serviceName: (SERVICES.find((s) => s.id === t.service_id) ?? SERVICES[0]).name,
      fee: t.fee,
      status: t.status as 'in_lab' | 'arrived',
      hoursLeft: Math.max(0, Math.round((new Date(t.due_at).getTime() - now) / 3_600_000)),
      rawValue: raw,
    }
  })

  const atRisk = db
    .prepare(
      `SELECT i.id, i.card_id, i.variant, i.condition, c.name, c.image_small, s.name AS set_name, i.acquired_via, i.cost_basis
       FROM inventory i JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
       WHERE i.status = 'collection' AND i.graded_grade IS NULL AND i.auth_status IS NULL AND i.fake_revealed = 0 AND i.is_fake = 0 AND i.quantity = 1`,
    )
    .all() as { id: number; card_id: string; variant: string; condition: string; name: string; image_small: string | null; set_name: string; acquired_via: string | null; cost_basis: number }[]
  const atRiskOut = atRisk
    .map((r) => {
      const raw = round2(valueOf(r.card_id, r.variant, r.condition as Condition))
      const chance = fakeChanceFor(raw, r.acquired_via)
      return {
        inventoryId: r.id,
        cardId: r.card_id,
        name: r.name,
        image: r.image_small,
        setName: r.set_name,
        condition: r.condition,
        rawValue: raw,
        riskPct: Math.round(chance * 100),
        channel: r.acquired_via ?? 'unknown',
        costBasis: round2(r.cost_basis),
        serviceId: raw >= 100 ? 'forensic' : raw >= 40 ? 'advanced' : 'express',
      }
    })
    .filter((r) => r.riskPct > 0)
    .sort((a, b) => b.riskPct * b.rawValue - a.riskPct * a.rawValue)
    .slice(0, 30)

  const fakes = db
    .prepare(
      `SELECT i.id, c.name, c.image_small, s.name AS set_name, i.cost_basis, i.quantity
       FROM inventory i JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
       WHERE (i.fake_revealed = 1 OR i.is_fake = 1) AND i.status = 'collection'`,
    )
    .all() as { id: number; name: string; image_small: string | null; set_name: string; cost_basis: number; quantity: number }[]

  const agg = db
    .prepare(
      `SELECT COUNT(*) AS cards FROM auth_tickets t JOIN inventory i ON i.id = t.inventory_id
       WHERE i.auth_status = 'authenticated'`,
    )
    .get() as { cards: number }
  const spentOnAuth = Number(getMeta('auth:spentOnAuth') ?? '0')
  // Lifetime burn ledger (metas — the wall is always selling cards off).
  const revealed = { n: Number(getMeta('auth:fakesCaught') ?? '0'), basis: Number(getMeta('auth:fakesBasisLost') ?? '0') }

  return {
    services: listServices().services,
    tools: listTools(),
    tickets: ticketsOut,
    atRisk: atRiskOut,
    fakes: fakes.map((f) => ({ inventoryId: f.id, name: f.name, image: f.image_small, setName: f.set_name, costBasis: round2(f.cost_basis * f.quantity), sellValue: FAKE_VALUE })),
    stats: {
      authenticatedCards: agg.cards,
      spentOnAuth: round2(spentOnAuth),
      fakesCaught: revealed.n,
      fakeBasisLost: round2(revealed.basis),
      burned: getMeta('auth:burned') === '1',
    },
  }
}

// ---------------------------------------------------------------------------
// The counterfeit economy — once you've been burned, the street assumes you
// pass fakes on. Every buylist sale or $1 dumping of a counterfeit raises the
// player's fake-trade notoriety (auth:rep), and once it's hot the accusations
// start: an NPC claims a card YOU sold them came back counterfeit and demands
// their money back. Evidence is the player's real paper trail: the toolkit,
// the USPA jackets on the binder, and lifetime documented fakes-caught. The
// case resolves itself after a day — evidence wins the room, a hung jury is a
// coin-flip, and a conviction means the street discounts your raws and the
// shop's walk-ins get harder to please for three days. The kit and the lab
// fees are your reputation's receipts.
// ---------------------------------------------------------------------------

const NOTORIETY_CAP = 3 // sales-of-fakes tracked at once; higher does nothing
const ACCUSER_POOL: { name: string; persona: string }[] = [
  { name: 'Marcus', persona: 'worst day of his life voice' },
  { name: 'the D Discord mod', persona: 'screenshots ready' },
  { name: 'a Buylist Betty follower', persona: 'has already posted about you' },
  { name: 'Parking-lot Paul', persona: 'brings a bank deposit slip' },
  { name: 'Denise from Marketplace', persona: 'looped in her cousin who "knows cards"' },
]

export function fakeNotoriety(): number {
  return Math.min(NOTORIETY_CAP, Number(getMeta('auth:rep') ?? '0'))
}

/** Called wherever a counterfeit leaves the player's hands — the buylist wall
 * ($1 training-aid sales) or any other path that moves a known fake. */
export function notorietyFromFakeSale(): void {
  const next = Math.min(NOTORIETY_CAP, fakeNotoriety() + 1)
  setMeta('auth:rep', String(next))
}

/** Evidence score the trial reads: kit (2), jackets (1 per 3, cap 4),
 * documented lifetime fakes-caught (1 per 2, cap 4). Needs 5 to clear. */
function evidenceScore(): number {
  let e = 0
  const ownedTools = TOOLS.filter((t) => getMeta(`auth:tool:${t.id}`) === '1').length
  if (ownedTools === TOOLS.length) e += 2
  else if (ownedTools > 0) e += 1
  const jackets = Number(getMeta('auth:jackets') ?? '0')
  e += Math.min(4, Math.floor(jackets / 3))
  const caught = Number(getMeta('auth:fakesCaught') ?? '0')
  e += Math.min(4, Math.floor(caught / 2))
  return e
}

/** A conviction puts the street's suspicion on your raws for 3 game days. */
export function streetSuspicionActive(): boolean {
  const until = getMeta('auth:suspicionUntil')
  if (!until) return false
  if (new Date(until).getTime() <= Date.now()) {
    db.prepare(`DELETE FROM meta WHERE key = 'auth:suspicionUntil'`).run()
    return false
  }
  return true
}

/** The daily roll: one accusation can surface while your name is hot. */
export function accusationTick(): void {
  if (fakeNotoriety() < 1) return
  if (db.prepare(`SELECT id FROM auth_accusations WHERE status = 'open'`).get()) return
  if (Math.random() >= 0.25) return
  const accuser = ACCUSER_POOL[Math.floor(Math.random() * ACCUSER_POOL.length)]
  // The card they cry about: any burned-over card name from the ledger's era.
  const burnedName = (db.prepare(`SELECT c.name FROM auth_tickets t JOIN inventory i ON i.id = t.inventory_id JOIN cards c ON c.id = i.card_id WHERE t.service_id != '' ORDER BY t.id DESC LIMIT 1`).get() as { name: string } | undefined)?.name
  // "The X you sold me" / "The a card you sold me" — articles matter on the street.
  const subject = burnedName ? `the ${burnedName}` : 'that card'
  const subjectThe = burnedName ? 'the' : 'that'
  const evidence = evidenceScore()
  db.prepare(`INSERT INTO auth_accusations (accuser, persona, card_name, basis, status, evidence, needs, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`).run(
    accuser.name,
    accuser.persona,
    burnedName,
    round2(Number(getMeta('auth:fakesBasisLost') ?? '0')),
    evidence,
    5,
    nowIso(),
  )
  logActivity('auth', `⚖️ ${accuser.name} is accusing you of passing counterfeits — "${subject} you sold me came back fake." Your paper trail says ${evidence}/5. The trade groups vote by tomorrow. (🛡 Authentication → The street)`)
}

/** Called on every genuine verdict — the paper trail grows. */
function noteJacket(): void {
  setMeta('auth:jackets', String(Number(getMeta('auth:jackets') ?? '0') + 1))
}

export function accusationSection(): { accusation: null | { id: number; accuser: string; persona: string; cardName: string; basis: number; evidence: number; needs: number }, notoriety: number, suspicion: boolean, history: { id: number; accuser: string; cardName: string; status: string; verdict: string | null }[] } {
  const open = db.prepare(`SELECT * FROM auth_accusations WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get() as { id: number; accuser: string; persona: string; card_name: string; basis: number; evidence: number; needs: number } | undefined
  const history = db.prepare(`SELECT id, accuser, card_name, status, verdict FROM auth_accusations WHERE status != 'open' ORDER BY id DESC LIMIT 8`).all() as { id: number; accuser: string; card_name: string; status: string; verdict: string | null }[]
  return {
    accusation: open ? { id: open.id, accuser: open.accuser, persona: open.persona, cardName: open.card_name, basis: open.basis, evidence: evidenceScore(), needs: open.needs } : null,
    notoriety: fakeNotoriety(),
    suspicion: streetSuspicionActive(),
    history: history.map((h) => ({ id: h.id, accuser: h.accuser, cardName: h.card_name, status: h.status, verdict: h.verdict })),
  }
}

/** Resolves yesterday's open case: evidence clears, coin-flip mistrial,
 * otherwise convicted — the street remembers for 3 days. */
export function accusationResolveTick(): void {
  const open = db.prepare(`SELECT * FROM auth_accusations WHERE status = 'open' ORDER BY id ASC LIMIT 1`).get() as { id: number; accuser: string; persona: string; card_name: string; basis: number; evidence: number; needs: number; created_at: string } | undefined
  if (!open) return
  if (new Date(open.created_at).getTime() > Date.now() - gameDayMs()) return // the groups vote by tomorrow
  // The vote reads the paper trail as it stands WHEN THEY VOTE — authenticate
  // cards and catch fakes during the open window and the case can still clear.
  const evidence = evidenceScore()
  let status: 'cleared' | 'mistrial' | 'convicted'
  let verdict: string
  if (evidence >= open.needs) {
    status = 'cleared'
    verdict = `${open.accuser} had nothing when the paper came out — the kit, the jackets, the documented fakes. The thread locks, an admin adds a warning to THEIR account, and two collectors DMed you asking if you buy lots.`
    logActivity('auth', `⚖️ CLEARED: the accusation from ${open.accuser} fell apart under your paper trail (${evidence}/${open.needs}). Reputation +1.`)
    db.prepare('UPDATE shop SET reputation = reputation + 1 WHERE id = 1').run()
  } else if (Math.random() < 0.5) {
    status = 'mistrial'
    verdict = `The thread went 50/50, someone posted a 40-minute video essay, and everyone got tired. ${open.accuser} still tells people you passed a fake. No consequences either way — this time.`
    logActivity('auth', `⚖️ MISTRIAL: ${open.accuser}'s accusation went nowhere — but it's still out there. Your paper trail was ${evidence}/${open.needs}.`)
  } else {
    status = 'convicted'
    verdict = open.card_name
      ? `Enough people believed ${open.accuser} that it stopped mattering whether the ${open.card_name} was real. The street discounts your raws, the shop's walk-ins are harder to please, and the buylist desk pays you like a risk, for three days.`
      : `Enough people believed ${open.accuser} that it stopped mattering what was real. The street discounts your raws, the shop's walk-ins are harder to please, and the buylist desk pays you like a risk, for three days.`
    logActivity('auth', `⚖️ CONVICTED: the street believes ${open.accuser}. Raw sells take a 10% suspicion haircut and shop reputation takes a knock for 3 game days. Paper trail was ${evidence}/${open.needs} — build it before the next one lands.`)
    db.prepare('UPDATE shop SET reputation = reputation - 3 WHERE id = 1').run()
    db.prepare(`INSERT INTO meta (key, value) VALUES ('auth:suspicionUntil', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(new Date(Date.now() + 3 * gameDayMs()).toISOString())
  }
  db.prepare(`UPDATE auth_accusations SET status = ?, verdict = ?, resolved_at = ? WHERE id = ?`).run(status, verdict, nowIso(), open.id)
}

// ---------------------------------------------------------------------------
// Guards for the other sell paths — cheap, single-purpose.
// ---------------------------------------------------------------------------

/** Sell/stock/consign guard: known fakes (either flag system) trade nowhere
 * but the buylist wall. */
export function guardSell(inventoryId: number): string | null {
  const r = db.prepare('SELECT fake_revealed, is_fake FROM inventory WHERE id = ?').get(inventoryId) as { fake_revealed: number; is_fake: number } | undefined
  if (!r) return null
  return r.fake_revealed || r.is_fake ? 'Known counterfeit — buylist shops pay $1 flat for it (Inventory → 🛡 Authentication)' : null
}

/** Grading guard: the labs won't slab a suspect card — authenticate first.
 * Only the risk band (AUTH_THRESHOLD+, where counterfeit flags actually roll)
 * needs the jacket — commons grade as they always did. This seal also closes
 * the laundering hole: a hidden fake can never ride the grading reveal into
 * a slab, because every card it could hide on must be authenticated first. */
export function guardGrading(inventoryId: number): string | null {
  const r = db.prepare('SELECT card_id, variant, condition, fake_revealed, auth_status FROM inventory WHERE id = ?').get(inventoryId) as { card_id: string; variant: string; condition: string; fake_revealed: number; auth_status: string | null } | undefined
  if (!r) return null
  if (r.fake_revealed) return 'No lab will slab a known counterfeit — sell it to the buylist and move on'
  if (r.auth_status === 'authenticated') return null
  const raw = valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
  if (raw < AUTH_THRESHOLD) return null
  return `Worth ~$${raw.toFixed(2)} unvetted — the lab refuses high-value raws without authentication (Inventory → 🛡 Authentication, $15–75)`
}

/** The lab's mailroom can lose things — expired tickets refund the fee. */
function expireStaleTickets() {
  const stale = db
    .prepare(`SELECT id, fee FROM auth_tickets WHERE status = 'in_lab' AND due_at < ?`)
    .all(new Date(Date.now() - 7 * gameDayMs()).toISOString()) as { id: number; fee: number }[]
  for (const t of stale) {
    const tx = db.transaction(() => {
      db.prepare(`UPDATE auth_tickets SET status = 'expired' WHERE id = ?`).run(t.id)
      db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(t.fee)
    })
    tx()
    logActivity('auth', `The lab lost a submission — full $${t.fee.toFixed(2)} refund. Even the pros lose one occasionally.`)
  }
}

export function authDailyTick() {
  expireStaleTickets()
}
