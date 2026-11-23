// The stack pricing core: size bounds, the $2 card cap, escrow/grade refusals,
// duplicate collapse, the band never quoting the ceiling, and froth that only
// exists when a room is watching. Reads the save; writes nothing.
import { db } from '../server/lib/db'
import { valueOf } from '../server/services/market'
import { quoteStack, stackHeat, stackFroth, stackHeatRange, STACK_RULES } from '../server/services/stacks'

let fails = 0
const check = (name: string, ok: boolean, detail?: string) => {
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

type Row = { id: number; card_id: string; variant: string | null; condition: string | null }
const rows = db
  .prepare("SELECT id, card_id, variant, condition FROM inventory WHERE status='collection' AND graded_grade IS NULL AND quantity = 1")
  .all() as Row[]
const priced = rows
  .map((r) => ({ ...r, v: valueOf(r.card_id, r.variant || 'normal', (r.condition as never) || 'NM') }))
  .filter((r) => r.v > 0)
const cheap = priced.filter((r) => r.v <= STACK_RULES.cardCap)
const dear = priced.find((r) => r.v > STACK_RULES.cardCap)

const ids = cheap.slice(0, 24).map((r) => r.id)
const q = quoteStack(ids, 400) as Extract<ReturnType<typeof quoteStack>, { ok: true }>
check('24 cheap cards quote', !!q && q.ok, q.ok ? `${q.count} cards, market $${q.market}, ${q.distinctSets} sets` : '')
check('the band is a range, not the number', q.ok && q.band.high > q.band.low, q.ok ? `$${q.band.low}–$${q.band.high}` : '')
check('the buylist offer is 55–75% of market', q.ok && Math.abs(q.buylist.low - q.market * 0.55) < 0.02 && Math.abs(q.buylist.high - q.market * 0.75) < 0.02, q.ok ? `$${q.buylist.low}–$${q.buylist.high}` : '')
check('a real room clears a stack above the buylist', q.ok && q.band.high > q.buylist.low, q.ok ? `band top $${q.band.high} vs buylist $${q.buylist.low}` : '')

const small = quoteStack(cheap.slice(0, STACK_RULES.min - 1).map((r) => r.id), 400)
check('under the minimum is refused', !small.ok, small.ok ? '' : small.error)
const big = quoteStack(cheap.slice(0, STACK_RULES.max + 1).map((r) => r.id), 400)
check('over the maximum is refused', !big.ok, big.ok ? '' : big.error)
if (dear) {
  const withDear = quoteStack([...cheap.slice(0, 23).map((r) => r.id), dear.id], 400)
  check('a card over the $2 cap is refused', !withDear.ok, withDear.ok ? '' : withDear.error)
}
const dup = quoteStack([...ids, ...ids.slice(0, 5)], 400) as Extract<ReturnType<typeof quoteStack>, { ok: true }>
check('duplicate ids collapse instead of paying twice', dup.ok && dup.count === ids.length, dup.ok ? `${dup.count} cards` : '')
const empty = quoteStack([], 400)
check('an empty pick is refused', !empty.ok, empty.ok ? '' : empty.error)

// The rule itself: froth exists only with a room, and never exceeds its cap.
check('no viewers, no froth', stackFroth(0, 8) === 0, String(stackFroth(0, 8)))
check('a full room pays the capped froth', stackFroth(900, 40) === STACK_RULES.frothCap, String(stackFroth(900, 40)))
check('half a room pays half the froth', Math.abs(stackFroth(75, 8) - Math.min(STACK_RULES.frothCap, 0.06 * 8) * 0.5) < 1e-9, String(stackFroth(75, 8)))
const cold = quoteStack(ids, 0) as Extract<ReturnType<typeof quoteStack>, { ok: true }>
const warm = quoteStack(ids, 900) as Extract<ReturnType<typeof quoteStack>, { ok: true }>
check('the same stack quotes higher with a crowd', warm.band.high > cold.band.high, `cold $${cold.band.high} vs warm $${warm.band.high}`)
check('heat stays inside its drawn range', [0, 100, 9000].every((v) => {
  const r = stackHeatRange(v, 6)
  const h = stackHeat(v, 6)
  return h >= r.low - 1e-9 && h <= r.high + 1e-9
}), 'low..high holds for every draw')

// Nothing above market for free: an empty room's ceiling sits under market.
check('an empty room never pays market for a stack', cold.band.high <= cold.market, `band top $${cold.band.high} vs market $${cold.market}`)

console.log(fails === 0 ? '\nstacks ok' : `\n${fails} problem(s)`)
process.exit(fails === 0 ? 0 : 1)
