// ---------------------------------------------------------------------------
// SKIPPED DAYS — the game-days a paid day pass opened.
//
// The pass itself is flat and cheap (services/daypass.ts), because its job is
// to skip the WAIT. What it opens, though, is a fresh Daily Deals board, and a
// board is worth money: one pack, one box and one collection, 10–30% off. So
// the board is paid for when it is USED, not when it is opened. A board you
// never touch costs the ticket and nothing else.
//
// The share is whatever makes the round trip through the resale desk exactly
// break-even: the desk's ACTUAL payout for a case-fresh unit minus the deal's
// discounted price. That payout is not "shelf minus 10%" — sealedfutures prices
// a fresh unit at shelf × a case-fresh premium (1.10 in print, fading to 1.02 by
// two years out of print) and then takes RESALE_FEE_PCT, so it lands at 0.918–0.99
// of shelf. Pricing the share off a flat 0.9 left a 1.8–9% gap on every claim,
// which is why this formula takes the payout as an argument instead of assuming
// one. Callers pass in what the desk would actually pay.
//
// The marker is a bounded list of recent day keys, not a row per skip: a player
// who buys fifty passes in an afternoon must not leave fifty permanent keys in
// the save. Sixty game-days is far more than any live claim needs (a deal dies
// with its day), and the oldest keys fall off the front.
// ---------------------------------------------------------------------------

import { getMeta, setMeta } from './db'

/** The resale desk's cut of a sale (sealedfutures.sellSealed). */
export const RESALE_FEE_PCT = 0.1

/**
 * What a claim on a skipped day pays on top of its discounted price. Given the
 * discounted price and what the resale desk would actually pay for the unit, the
 * share is the gap between them — so buying and immediately reselling nets zero.
 * A deal that would already lose money on resale adds nothing.
 */
export function skippedClaimShare(discounted: number, resaleProceeds: number): number {
  const margin = resaleProceeds - discounted
  return margin > 0 ? Math.round(margin * 100) / 100 : 0
}

const KEY = 'daypass:days'
const MAX_DAYS = 60

// The list is read on every shelf build (each row asks "is today skipped?"), so
// the parsed array is cached against the raw meta string: the only writer is a
// day pass, which changes that string.
let cache: { raw: string; days: string[] } | null = null

function days(): string[] {
  const raw = getMeta(KEY) ?? ''
  if (cache?.raw === raw) return cache.days
  let parsed: string[] = []
  try {
    const value = raw ? JSON.parse(raw) : []
    if (Array.isArray(value)) parsed = value.filter((x): x is string => typeof x === 'string')
  } catch {
    // A corrupt list means no skipped days, not a crashed shop: the pass can be
    // bought again and the marker rebuilt.
  }
  cache = { raw, days: parsed }
  return parsed
}

/** Record that a pass opened this game-day. Idempotent. */
export function markSkippedDay(dayKey: string): void {
  const list = days()
  if (list.includes(dayKey)) return
  const next = [...list, dayKey].slice(-MAX_DAYS)
  setMeta(KEY, JSON.stringify(next))
  cache = null
}

/** Was this game-day opened by a paid day pass? */
export function isSkippedDay(dayKey: string): boolean {
  return days().includes(dayKey)
}
