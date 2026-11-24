import { db } from '../lib/db'
import { valueOf, round2, type Condition } from './market'

// ---------------------------------------------------------------------------
// Stacks — one lot, many cheap cards.
//
// 86% of a binder is worth under a dollar, and a single lot cannot move it: the
// block floors at $0.99 and its ceiling is a fraction of market, so a $0.45
// common is over-ask before it opens. A stack sells 10–40 of those copies as
// one item to one buyer.
//
// The settled rule (measured in tmp/stack-econ.mts, 2026-11-23): the ceiling is
// the usual room heat PLUS a froth term that grows with how many different sets
// the stack spans and only pays when a room actually turned up. Without the
// froth, a 24-card stack nets $5.91–$9.51 depending on the ask — at or under the
// buylist's $6.34–$8.65, for far more work — so the feature would be dead code.
// With it, a real room clears the same stack for ~$9.6–$13 and a 30-viewer room
// still gets $0–$5, less than the buylist. Above market by design, never
// above the cards' own market value by much, and only on camera.
// ---------------------------------------------------------------------------

export const STACK_RULES = {
  min: 10,
  max: 40,
  /** No single card worth more than this may ride in a stack. */
  cardCap: 2,
  /** Variety is the dig: each distinct set adds a little, capped. */
  frothPerSet: 0.06,
  frothCap: 0.3,
  /** A room under this many viewers gets a proportional slice of the froth. */
  frothViewerFloor: 150,
} as const

/** The crowd term a single lot already uses, so a stack reads the same room. */
function crowdTerm(viewers: number): number {
  return Math.min(0.35, viewers / 900)
}

/** Extra interest a mixed pile draws, scaled by how many people are watching. */
export function stackFroth(viewers: number, distinctSets: number): number {
  const variety = Math.min(STACK_RULES.frothCap, STACK_RULES.frothPerSet * distinctSets)
  return variety * Math.min(1, viewers / STACK_RULES.frothViewerFloor)
}

/** The full spread of heat a stack could draw: the roll is 0.35..0.95. */
export function stackHeatRange(viewers: number, distinctSets: number): { low: number; high: number } {
  const crowd = crowdTerm(viewers)
  const froth = stackFroth(viewers, distinctSets)
  return { low: 0.35 + crowd + froth, high: 0.95 + crowd + froth }
}

/** One draw, made when the stack goes on the block — never shown, only banded. */
export function stackHeat(viewers: number, distinctSets: number): number {
  return 0.35 + Math.random() * 0.6 + crowdTerm(viewers) + stackFroth(viewers, distinctSets)
}

/**
 * Heat at a given point of the roll. The quote covers the realistic middle
 * (a fifth to four fifths of it) rather than the whole spread: "$12–$25" tells a
 * host nothing they can price with, and the tails are exactly the gamble the
 * pass mechanic exists to teach.
 */
function heatAt(viewers: number, distinctSets: number, q: number): number {
  return 0.35 + q * 0.6 + crowdTerm(viewers) + stackFroth(viewers, distinctSets)
}

/** The ladder a quote snaps to: dollars up to $50, then fives, then tens. */
function quoteStep(v: number): number {
  return v < 50 ? 1 : v < 200 ? 5 : 10
}

export type StackCopy = {
  id: number
  cardId: string
  variant: string
  condition: string
  set: string
  value: number
  costBasis: number
}

export type StackResolved = { ok: true; copies: StackCopy[]; market: number; distinctSets: number }

/**
 * Everything a stack needs before it can be priced or escrowed: 10–40 raw
 * copies of the same binder, none of them over the junk cap, none of them
 * already committed elsewhere. A copy on a live BidBay auction is committed —
 * escrowing it here would sell the same card twice.
 */
export function resolveStack(inventoryIds: number[]): StackResolved | { ok: false; error: string } {
  const ids = [...new Set((inventoryIds ?? []).map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n) && n > 0))]
  if (ids.length === 0) return { ok: false as const, error: 'Pick cards for the stack' }
  if (ids.length < STACK_RULES.min) {
    return { ok: false as const, error: `A stack is at least ${STACK_RULES.min} cards — this one has ${ids.length}.` }
  }
  if (ids.length > STACK_RULES.max) {
    return { ok: false as const, error: `A stack is at most ${STACK_RULES.max} cards — this one has ${ids.length}.` }
  }

  const copies: StackCopy[] = []
  let market = 0
  const sets = new Set<string>()
  for (const id of ids) {
    const r = db
      .prepare(`SELECT id, card_id, variant, condition, status, graded_grade, cost_basis FROM inventory WHERE id = ?`)
      .get(id) as { id: number; card_id: string; variant: string | null; condition: string | null; status: string; graded_grade: string | null; cost_basis: number } | undefined
    if (!r) return { ok: false as const, error: 'One of those cards is gone' }
    if (r.status !== 'collection') return { ok: false as const, error: 'One of those cards is already on the block or in a display' }
    if (r.graded_grade) return { ok: false as const, error: 'Stacks are raw cards — a slab belongs in its own lot' }
    const onAuction = (db.prepare(`SELECT COUNT(*) AS n FROM ebay_auctions WHERE inventory_id = ? AND status = 'live'`).get(id) as { n: number }).n
    if (onAuction > 0) {
      return { ok: false as const, error: 'One of those copies is in a live BidBay auction — pull it off the auction before it goes on the block.' }
    }
    const value = valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
    if (!(value > 0)) return { ok: false as const, error: 'One of those cards has no market price to anchor a stack on' }
    if (value > STACK_RULES.cardCap) {
      return {
        ok: false as const,
        error: `A stack is for junk — $${value.toFixed(2)} is over the $${STACK_RULES.cardCap.toFixed(2)} a-card cap. Sell it on its own.`,
      }
    }
    const set = (db.prepare(`SELECT set_id FROM cards WHERE id = ?`).get(r.card_id) as { set_id: string } | undefined)?.set_id ?? ''
    if (set) sets.add(set)
    market += value
    copies.push({
      id: r.id,
      cardId: r.card_id,
      variant: r.variant || 'normal',
      condition: r.condition || 'NM',
      set,
      value,
      costBasis: r.cost_basis,
    })
  }

  return { ok: true as const, copies, market: round2(market), distinctSets: sets.size }
}

export type StackQuote = {
  ok: true
  count: number
  market: number
  distinctSets: number
  /** How many are watching right now — zero means the froth is gone. */
  viewers: number
  /** What the room might pay, snapped to the money ladder — never the ceiling. */
  band: { low: number; high: number }
  /** The instant alternative, for comparison: 55–75% at a buylist counter. */
  buylist: { low: number; high: number }
}

export function quoteStack(inventoryIds: number[], viewers: number): StackQuote | { ok: false; error: string } {
  const resolved = resolveStack(inventoryIds)
  if (!resolved.ok) return resolved
  const { copies, market, distinctSets } = resolved
  const step = quoteStep(market)
  const low = Math.floor((market * heatAt(viewers, distinctSets, 0.2)) / step) * step
  const high = Math.ceil((market * heatAt(viewers, distinctSets, 0.8)) / step) * step
  return {
    ok: true,
    count: copies.length,
    market,
    distinctSets,
    viewers,
    band: { low: round2(low), high: round2(Math.max(low + step, high)) },
    buylist: { low: round2(market * 0.55), high: round2(market * 0.75) },
  }
}
