// The bonus subsets now ride inside their host set's booster: one subset card in
// the reverse-holo position, five commons, the rare-or-hit, three uncommons.
// The subset sets themselves stay unsold (no wrapper existed on a real shelf).
//
// Pins, per host: ten cards, exactly one subset card, at position 5, all nine
// others from the host set, no reverse printing in that slot, and the till
// showing a "Bonus subset" line. Also pins the eight unsold sets and
// Celebrations' real four-card pack.
//   TCGLIFE_HOME=$PWD/tmp/audit-home node ./node_modules/tsx/dist/cli.mjs tmp/check-subset-packs.ts
import { productsForSet, sellsOwnPacks } from '../server/services/sealed'
import { rollPack, estimatePackValue } from '../server/services/packs'
import { packSlots, HOST_SUBSETS } from '../server/services/packodds'
import { db } from '../server/lib/db'

const N = Number(process.env.SUBSET_PACKS ?? 200)
let fails = 0
const fail = (msg: string) => {
  fails++
  console.log('FAIL', msg)
}

const unsold = ['sma', 'swsh45sv', 'swsh9tg', 'swsh10tg', 'swsh11tg', 'swsh12tg', 'swsh12pt5gg', 'sve']
for (const setId of unsold) {
  const row = db.prepare('SELECT name, series, release_date FROM sets WHERE id = ?').get(setId) as
    | { name: string; series: string; release_date: string }
    | undefined
  const kinds = row ? productsForSet(setId, row.name, row.series, row.release_date) : []
  const ok = !!row && !sellsOwnPacks(setId) && kinds.length === 0
  if (!ok) fail(`${setId}: expected no sealed product, got ${kinds.length}`)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${setId}: ${kinds.length} product kind(s), sellsOwnPacks ${sellsOwnPacks(setId)}`)
}

const idsOf = (setId: string) =>
  new Set((db.prepare('SELECT id FROM cards WHERE set_id = ?').all(setId) as { id: string }[]).map((r) => r.id))

for (const [host, subset] of Object.entries(HOST_SUBSETS)) {
  const hostIds = idsOf(host)
  const subsetIds = idsOf(subset)
  const slots = packSlots(host, 10)
  const bonusSlot = slots.find((s) => s.slot === 'subset')
  const shape = slots.reduce((a, s) => a + s.count, 0)
  const counts = new Map<number, number>()
  let wrongPosition = 0
  let foreign = 0
  let reverseInSlot = 0
  let hostCards = 0
  let subsetCards = 0
  for (let i = 0; i < N; i++) {
    const pack = rollPack(host, `hostsub-${host}-${i}`, 'booster', 10) ?? []
    counts.set(pack.length, (counts.get(pack.length) ?? 0) + 1)
    const at = pack[5]
    if (!at || !subsetIds.has(at.cardId)) wrongPosition++
    if (at && hostIds.has(at.cardId)) foreign++
    if (at && /reverse/i.test(at.variant ?? '')) reverseInSlot++
    for (const c of pack) {
      if (hostIds.has(c.cardId)) hostCards++
      else if (subsetIds.has(c.cardId)) subsetCards++
      else foreign++
    }
  }
  db.prepare('DELETE FROM pull_history WHERE session_id LIKE ?').run(`hostsub-${host}-%`)
  const ten = counts.size === 1 && counts.has(10)
  const oneSubset = subsetCards === N && hostCards === 9 * N && foreign === 0
  const tillOk = !!bonusSlot && bonusSlot.count === 1 && bonusSlot.label === 'Bonus subset' && shape === 10
  const est = estimatePackValue(host)
  const ok = ten && oneSubset && wrongPosition === 0 && reverseInSlot === 0 && tillOk && est.avg > 0
  if (!ok) fail(`${host}: ten ${ten}, oneSubset ${oneSubset}, wrongPosition ${wrongPosition}, reverseInSlot ${reverseInSlot}, till ${tillOk}`)
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${host} <- ${subset}: ${[...counts.entries()].map(([n, c]) => `${n}×${c}`).join(', ')}`,
    `| subset ${subsetCards}/${N} at index 5 ${wrongPosition === 0 ? 'ok' : `${wrongPosition} miss`}`,
    `| host ${hostCards}/${9 * N} | foreign ${foreign} | reverse ${reverseInSlot}`,
    `| till ${slots.map((s) => `${s.count} ${s.label}`).join(' + ')} | est $${est.avg.toFixed(2)}`,
  )
}

// Celebrations: real four-card pack, unchanged.
{
  const setId = 'cel25'
  const want = 4
  const own = idsOf(setId)
  const slots = packSlots(setId, 10)
  const shape = slots.reduce((a, s) => a + s.count, 0)
  const counts = new Map<number, number>()
  let foreign = 0
  for (let i = 0; i < N; i++) {
    const pack = rollPack(setId, `subsetcheck-${setId}-${i}`, 'booster', 10)
    counts.set(pack?.length ?? 0, (counts.get(pack?.length ?? 0) ?? 0) + 1)
    for (const c of pack ?? []) if (!own.has(c.cardId)) foreign++
  }
  db.prepare('DELETE FROM pull_history WHERE session_id LIKE ?').run(`subsetcheck-${setId}-%`)
  const ok = counts.size === 1 && counts.has(want) && foreign === 0 && shape === want
  if (!ok) fail(`cel25: dealt ${[...counts.keys()].join('/')} want ${want}, foreign ${foreign}`)
  console.log(`${ok ? 'ok  ' : 'FAIL'} cel25: dealt ${[...counts.entries()].map(([n, c]) => `${n}×${c}`).join(', ')} | till ${slots.map((s) => `${s.count} ${s.slot}`).join(' + ')}`)
}

console.log(fails === 0 ? `all ${unsold.length + Object.keys(HOST_SUBSETS).length + 1} subset checks OK` : `${fails} failing`)
process.exit(fails === 0 ? 0 : 1)
