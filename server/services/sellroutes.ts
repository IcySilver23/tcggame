import { db } from '../lib/db'
import { valueOfRow, round2, type Condition } from './market'
import { dealerMultiplier } from './resale'
import { fireSaleValue } from './pawn'

// ---------------------------------------------------------------------------
// Which door pays most?
//
// The game has four ways to turn a card into money and the player had to hold
// the fee tables in their head to pick between them: the instant dealer (70-92%
// of market, cash now), a market listing (full price minus a 10% commission,
// paid when a buyer bites), a buylist counter (55-75% of market, cash now, best
// rate from the least greedy shop) and the pawn shop (40% of an already
// fire-sale number, cash now). Each figure below is read from the same service
// that pays it — no second copy of the economics to drift out of date.
// ---------------------------------------------------------------------------

type Row = {
  id: number
  card_id: string
  variant: string
  condition: Condition
  quantity: number
  graded_grade: string | null
}

export type SellRoute = {
  id: 'market' | 'dealer' | 'buylist' | 'pawn'
  label: string
  /** What actually lands in your pocket. */
  net: number
  /** net / market, 0..1, for the comparison bars. */
  pct: number
  /** When the money arrives. */
  wait: string
  note: string
}

const MARKET_FEE = 0.1 // market.ts commissions every listing at 10%
const PAWN_QUOTE = 0.4 // pawn.ts pays this share of fire-sale value
const BEST_BUYLIST = 0.75 // 1 - greed for the friendliest shop on the list

export function forCard(inventoryId: number) {
  const row = db
    .prepare(`SELECT id, card_id, variant, condition, quantity, graded_grade FROM inventory WHERE id = ? AND status = 'collection'`)
    .get(inventoryId) as Row | undefined
  if (!row) return { ok: false as const, error: 'That card is not in your collection' }

  const market = round2(valueOfRow({
    card_id: row.card_id,
    variant: row.variant,
    condition: row.condition,
    graded_grade: row.graded_grade,
  }))
  if (!(market > 0)) return { ok: false as const, error: 'No market price for this card yet — sync the set first' }

  const dealerNet = round2(market * dealerMultiplier(row.id))
  const marketNet = round2(market * (1 - MARKET_FEE))
  const buylistNet = round2(market * BEST_BUYLIST)
  const pawnNet = round2(fireSaleValue(row.card_id, row.variant, row.condition, row.graded_grade) * PAWN_QUOTE)

  const routes: SellRoute[] = [
    {
      id: 'market',
      label: 'Market listing',
      net: marketNet,
      pct: marketNet / market,
      wait: 'when a buyer bites',
      note: `Full market minus a ${Math.round(MARKET_FEE * 100)}% commission — the best price if you can wait.`,
    },
    {
      id: 'buylist',
      label: 'Buylist counter',
      net: buylistNet,
      pct: buylistNet / market,
      wait: 'now',
      note: 'Best rate on the buylist, no fee — 55–75% of market depending on the shop.',
    },
    {
      id: 'dealer',
      label: 'Instant dealer',
      net: dealerNet,
      pct: dealerNet / market,
      wait: 'now',
      note: 'The resale desk dealer takes it off your hands at 70–92% of market.',
    },
    {
      id: 'pawn',
      label: 'Pawn counter',
      net: pawnNet,
      pct: pawnNet / market,
      wait: 'now',
      note: `The last resort — ${Math.round(PAWN_QUOTE * 100)}% of fire-sale value, and fire-sale value is already a discount.`,
    },
  ]

  const best = routes.reduce((a, b) => (b.net > a.net ? b : a))
  return {
    ok: true as const,
    inventoryId,
    cardId: row.card_id,
    condition: row.condition,
    graded: row.graded_grade,
    market,
    routes,
    bestId: best.id,
    /** The spread between the best and worst door — what knowing this is worth. */
    spread: round2(best.net - Math.min(...routes.map((r) => r.net))),
  }
}
