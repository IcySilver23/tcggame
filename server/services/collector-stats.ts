import { db } from '../lib/db'
import { valueOf, gradedPriceOf, round2, type Condition } from './market'

// ---------------------------------------------------------------------------
// All-time collector record for the Home dashboard: totals from inventory,
// gains from real market anchors vs real cost bases, and the calendar
// footprint from the activity log.
// ---------------------------------------------------------------------------

export type GainerRow = {
  cardId: string
  name: string
  image: string | null
  setName: string
  condition: string
  gradedGrade: string | null
  quantity: number
  costBasis: number
  value: number
  gain: number
  gainPct: number | null
}

export type CollectorStats = {
  cardsOwned: number
  uniqueCards: number
  gradedCount: number
  totalInvested: number
  collectionValue: number
  unrealized: number
  lifetimeSpent: number
  lifetimeEarned: number
  realizedProfit: number
  salesCount: number
  bestFlip: {
    cardId: string
    name: string
    image: string | null
    setName: string
    bought: number
    sold: number
    profit: number
    roi: number | null
    soldAt: string
  } | null
  gainers: GainerRow[]
  daysPlayed: number
  firstPlayed: string | null
  activeStreak: number
}

export function collectorStats(): CollectorStats {
  const rows = db
    .prepare(
      `SELECT i.card_id, i.variant, i.condition, i.quantity, i.graded_grade, i.status, i.cost_basis,
              c.name, c.image_small, s.name AS set_name
       FROM inventory i JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id`,
    )
    .all() as {
      card_id: string; variant: string; condition: string; quantity: number
      graded_grade: string | null; status: string; cost_basis: number
      name: string; image_small: string | null; set_name: string
    }[]

  let cardsOwned = 0
  let unique = 0
  let gradedCount = 0
  let totalInvested = 0
  let collectionValue = 0
  const seen = new Set<string>()
  const held: GainerRow[] = []

  for (const r of rows) {
    const q = r.quantity
    if (q <= 0) continue
    cardsOwned += q
    const key = r.card_id
    if (!seen.has(key)) { seen.add(key); unique++ }
    if (r.graded_grade) gradedCount += q
    totalInvested += q * r.cost_basis

    const v = r.graded_grade
      ? gradedPriceOf(r.card_id, r.graded_grade).usd ?? r.cost_basis
      : valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
    if (r.status !== 'sold') collectionValue += v * q

    if (r.status !== 'sold' && r.cost_basis > 0) {
      const gain = (v - r.cost_basis) * q
      held.push({
        cardId: r.card_id,
        name: r.name,
        image: r.image_small,
        setName: r.set_name,
        condition: r.condition,
        gradedGrade: r.graded_grade,
        quantity: q,
        costBasis: round2(r.cost_basis * q),
        value: round2(v * q),
        gain: round2(gain),
        gainPct: r.cost_basis > 0 ? v / r.cost_basis - 1 : null,
      })
    }
  }

  // Biggest gainers: only meaningful profit, ranked by percentage moved.
  const gainers = held
    .filter((g) => g.gain > 0.5 && (g.gainPct ?? 0) > 0.05)
    .sort((a, b) => (b.gainPct ?? 0) - (a.gainPct ?? 0))
    .slice(0, 5)

  // Sales ledger.
  const sales = db
    .prepare(
      `SELECT sh.sale_price, sh.cost_basis, sh.profit, sh.quantity, sh.sold_at, sh.card_id,
              c.name, c.image_small, s.name AS set_name
       FROM sale_history sh JOIN cards c ON c.id = sh.card_id JOIN sets s ON s.id = c.set_id
       ORDER BY sh.profit DESC`,
    )
    .all() as { sale_price: number; cost_basis: number; profit: number; quantity: number; sold_at: string; card_id: string; name: string; image_small: string | null; set_name: string }[]

  let lifetimeEarned = 0
  for (const s of sales) lifetimeEarned += s.sale_price
  const lifetimeSpentRow = db
    .prepare(`SELECT COALESCE(SUM(ABS(amount)), 0) AS n FROM activity_log WHERE kind = 'buy' AND amount < 0`)
    .get() as { n: number }
  const realizedProfitRow = db
    .prepare(`SELECT COALESCE(SUM(profit), 0) AS n FROM sale_history`)
    .get() as { n: number }

  const best = sales[0]
  const bestFlip = best
    ? {
        cardId: best.card_id,
        name: best.name,
        image: best.image_small,
        setName: best.set_name,
        bought: round2(best.cost_basis),
        sold: round2(best.sale_price),
        profit: round2(best.profit),
        roi: best.cost_basis > 0 ? best.sale_price / best.cost_basis - 1 : null,
        soldAt: best.sold_at,
      }
    : null

  // Days played: distinct UTC days with any logged activity + an active streak.
  const days = db
    .prepare(`SELECT DISTINCT SUBSTR(created_at, 1, 10) AS d FROM activity_log ORDER BY d DESC`)
    .all() as { d: string }[]
  const daySet = new Set(days.map((x) => x.d))
  let streak = 0
  {
    const cursor = new Date()
    for (;;) {
      const key = cursor.toISOString().slice(0, 10)
      if (daySet.has(key)) {
        streak++
        cursor.setUTCDate(cursor.getUTCDate() - 1)
      } else break
    }
  }

  return {
    cardsOwned,
    uniqueCards: unique,
    gradedCount,
    totalInvested: round2(totalInvested),
    collectionValue: round2(collectionValue),
    unrealized: round2(collectionValue - totalInvested),
    lifetimeSpent: round2(lifetimeSpentRow.n),
    lifetimeEarned: round2(lifetimeEarned),
    realizedProfit: round2(realizedProfitRow.n),
    salesCount: sales.length,
    bestFlip,
    gainers,
    daysPlayed: daySet.size,
    firstPlayed: days.length > 0 ? days[days.length - 1].d : null,
    activeStreak: streak,
  }
}
