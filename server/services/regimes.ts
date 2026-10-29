import { db, nowIso, logActivity } from '../lib/db'
import { gameDayMs } from '../lib/gameday'
import { priceMultiplier as seasonalPriceMultiplier } from './seasonal'
import { sceneCardFactor } from './demographics'

const round2 = (n: number) => Math.round(n * 100) / 100 // local: importing market.ts from here would cycle

// ---------------------------------------------------------------------------
// Market regimes (Systems that touch everything): the whole board breathes.
// A slow phase machine rolls bull / bear / chop every few weeks; a drift
// factor wanders inside the phase; every card has a small stable wobble; and
// reprint announcements crater individual cards (with a slow recovery as the
// panic fades). resolvePrice() multiplies real market data by factor(cardId),
// so every system in the game — shops, vendor tables, auctions, trades,
// net worth — lives inside the same weather.
// ---------------------------------------------------------------------------

export type Phase = 'bull' | 'bear' | 'chop'

type PhaseState = { phase: Phase; since: string; drift: number; until: string }

const DRIFT_MIN = { bull: 0.92, bear: 0.88, chop: 0.94 } // drift clamps per phase
const DRIFT_MAX = { bull: 1.35, bear: 0.72, chop: 1.06 }
const STEP = 0.012 // max drift move per tick (slow)
const WOBBLE_MAX = 0.06 // per-card ±6% stable tilt

function getPhaseRow(): PhaseState {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'regime:phase'`).get() as { value: string } | undefined
  if (row) return JSON.parse(row.value) as PhaseState
  const fresh: PhaseState = { phase: 'chop', since: nowIso(), drift: 1, until: new Date(Date.now() + 5 * gameDayMs()).toISOString() }
  db.prepare(`INSERT INTO meta (key, value) VALUES ('regime:phase', ?)`).run(JSON.stringify(fresh))
  return fresh
}

function setPhaseRow(s: PhaseState) {
  db.prepare(`INSERT INTO meta (key, value) VALUES ('regime:phase', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(s))
}

/** The card's stable wobble seed: same card, same tilt, every read. */
function wobbleOf(cardId: string): number {
  let h = 2166136261
  for (let i = 0; i < cardId.length; i++) {
    h ^= cardId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 2000) / 1000 - 1 // -1..1
}

/** A card's current regime factor: drift × wobble × (1 − shock) × seasonal × scene. */
export function factor(cardId: string): number {
  const s = getPhaseRow()
  const base = s.drift
  const wobble = 1 + wobbleOf(cardId) * WOBBLE_MAX
  const shock = getShock(cardId)
  // The seasonal calendar rides the same weather channel — holiday spikes and
  // lulls compose with the phase drift so the whole board moves together.
  // Population & meta drift composes last: era taste, live celebrity booms,
  // and the set's chase-vs-bulk split (demographics.ts) — the scene's own
  // weather on top of the market's.
  return Math.max(0.3, base * wobble * (1 - shock) * seasonalPriceMultiplier() * sceneCardFactor(cardId))
}

/** Live reprint shock for a card, decaying over ~3 weeks. */
function getShock(cardId: string): number {
  const row = db.prepare(`SELECT severity, announced_at FROM reprint_shocks WHERE card_id = ?`).get(cardId) as { severity: number; announced_at: string } | undefined
  if (!row) return 0
  const ageDays = (Date.now() - new Date(row.announced_at).getTime()) / gameDayMs()
  if (ageDays >= 21) {
    db.prepare(`DELETE FROM reprint_shocks WHERE card_id = ?`).run(cardId)
    return 0
  }
  return row.severity * (1 - ageDays / 21)
}

/** Announce a reprint: crater the card, feed the news, let it recover slowly. */
export function announceReprint(cardId: string, severity?: number) {
  const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(cardId) as { name: string } | undefined)?.name ?? cardId
  const sev = severity ?? 0.3 + Math.random() * 0.35 // −30% to −65% at the low point
  db.prepare(`INSERT INTO reprint_shocks (card_id, severity, announced_at) VALUES (?, ?, ?)
              ON CONFLICT(card_id) DO UPDATE SET severity = MAX(severity, excluded.severity), announced_at = excluded.announced_at`)
    .run(cardId, round2(sev), nowIso())
  logActivity('market', `📰 Reprint announced: ${name} is getting reprinted — the market craters. Holders are dumping; the panic should fade over the next few weeks.`)
}

/** Sometimes the market wants blood. Called from the tick. */
function maybeShockCard() {
  // Pick a notable card: something expensive enough to be news.
  const row = db
    .prepare(
      `SELECT p.card_id, p.market FROM price_records p
       WHERE p.kind = 'tcgplayer' AND p.variant = 'normal' AND p.market > 40 AND p.retrieved_at > ?
         AND p.card_id NOT IN (SELECT card_id FROM reprint_shocks)
       ORDER BY RANDOM() LIMIT 1`,
    )
    .get(new Date(Date.now() - 7 * 86_400_000).toISOString()) as { card_id: string; market: number } | undefined
  if (row) announceReprint(row.card_id)
}

/**
 * Phase machine + drift, run from the market tick (throttled to ~1/10 min).
 * Phases last 10–24 days; drift walks toward the phase's band edges at a
 * glacial pace so the board moves like weather, not like a coin flip.
 */
export function regimeTick() {
  const s = getPhaseRow()
  const now = Date.now()
  // Phase transition?
  if (now >= new Date(s.until).getTime()) {
    const roll = Math.random()
    const next: Phase = s.phase === 'bull' ? (roll < 0.45 ? 'chop' : 'bear') : s.phase === 'bear' ? (roll < 0.45 ? 'chop' : 'bull') : roll < 0.4 ? 'bull' : roll < 0.8 ? 'bear' : 'chop'
    const days = 10 + Math.floor(Math.random() * 15)
    const nextDrift = next === 'bull' ? 1.02 : next === 'bear' ? 0.98 : 1
    setPhaseRow({ phase: next, since: nowIso(), drift: nextDrift, until: new Date(now + days * gameDayMs()).toISOString() })
    const daysLabel = `${days}d`
    const flavor = next === 'bull' ? 'Everything is ripping. Sellers are emboldened.' : next === 'bear' ? 'Wallets are closed. Sellers are negotiating.' : 'No direction — pickers are out hunting misprices.'
    logActivity('market', `📈 Market regime shift: the scene has gone ${next.toUpperCase()} (expected to hold ~${daysLabel}). ${flavor}`)
    return
  }
  // Drift walk.
  const dir = s.phase === 'bull' ? 1 : s.phase === 'bear' ? -1 : Math.random() < 0.5 ? 1 : -1
  const step = (Math.random() * 2 - 0.4) * STEP * dir // biased walk, sometimes stalls
  const drift = Math.min(DRIFT_MAX[s.phase], Math.max(DRIFT_MIN[s.phase], s.drift + step))
  if (drift !== s.drift) setPhaseRow({ ...s, drift: round2(drift * 1000) / 1000 })
  // Reprint news: rare, at most one card per ~2 hours of play.
  if (Math.random() < 0.008) maybeShockCard()
}

/** Read model for the Market view banner and the settings debug strip. */
export function status() {
  const s = getPhaseRow()
  const shocks = db
    .prepare(
      `SELECT r.card_id, r.severity, r.announced_at, c.name
       FROM reprint_shocks r JOIN cards c ON c.id = r.card_id
       ORDER BY r.announced_at DESC LIMIT 5`,
    )
    .all() as { card_id: string; severity: number; announced_at: string; name: string }[]
  return {
    phase: s.phase,
    since: s.since,
    until: s.until,
    drift: s.drift,
    daysLeft: Math.max(0, Math.ceil((new Date(s.until).getTime() - Date.now()) / gameDayMs())),
    globalFactor: round2(s.drift),
    shocks: shocks.map((r) => ({ ...r, severity: round2(r.severity), ageDays: Math.floor((Date.now() - new Date(r.announced_at).getTime()) / 86_400_000) })),
  }
}
