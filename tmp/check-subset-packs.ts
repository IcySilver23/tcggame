// The bonus subsets ride inside their host set's booster. Pins, per host: the
// wrapper's real card count, a subset card only in the subset slot, the subset
// rate the code claims, and the till printing that slot.
//
// The subset sets themselves stay unsold (no wrapper existed on a real shelf).
// Celebrations is the odd one: its subset shares a four-card foil wrapper with
// the main set and prints no reverse holo at all.
//   TCGLIFE_HOME=$PWD/tmp/audit-home node ./node_modules/tsx/dist/cli.mjs tmp/check-subset-packs.ts
import { productsForSet, sellsOwnPacks } from '../server/services/sealed'
import { rollPack, estimatePackValue, buildPullTable } from '../server/services/packs'
import { packSlots, planFor, subsetChanceFor, HOST_SUBSETS } from '../server/services/packodds'
import { db } from '../server/lib/db'

const N = Number(process.env.SUBSET_PACKS ?? 400)
let fails = 0
const fail = (msg: string) => {
  fails++
  console.log('FAIL', msg)
}

const unsold = ['sma', 'swsh45sv', 'swsh9tg', 'swsh10tg', 'swsh11tg', 'swsh12tg', 'swsh12pt5gg', 'sve', 'cel25c']
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

/** Where the subset slot sits in the wrapper, counting the cards before it. */
function subsetIndex(setId: string, cardsPerPack: number): number {
  let at = 0
  for (const slot of planFor(setId, cardsPerPack)) {
    if (slot.slot === 'subset') return at
    at += slot.count
  }
  return -1
}

// Rebuild each host's table first: this runs on a save copy, and a table built
// by an older build would test the old shape rather than the shipped one.
buildPullTable('cel25', 4)

for (const [host, subset] of Object.entries(HOST_SUBSETS)) {
  const cardsPerPack = host === 'cel25' ? 4 : 10
  buildPullTable(host, cardsPerPack)
  const hostIds = idsOf(host)
  const subsetIds = idsOf(subset)
  const slots = packSlots(host, cardsPerPack)
  const shape = slots.reduce((a, s) => a + s.count, 0)
  const bonusAt = subsetIndex(host, cardsPerPack)
  const chance = subsetChanceFor(host)
  const counts = new Map<number, number>()
  let wrongPosition = 0
  let foreign = 0
  let subsetCards = 0
  let reverseSubset = 0
  for (let i = 0; i < N; i++) {
    const pack = rollPack(host, `hostsub-${host}-${i}`, 'booster', cardsPerPack) ?? []
    counts.set(pack.length, (counts.get(pack.length) ?? 0) + 1)
    pack.forEach((card, at) => {
      const isSubset = subsetIds.has(card.cardId)
      if (isSubset) {
        subsetCards++
        if (at !== bonusAt) wrongPosition++
        if (/reverse/i.test(card.variant ?? '')) reverseSubset++
      } else if (!hostIds.has(card.cardId)) foreign++
    })
  }
  db.prepare('DELETE FROM pull_history WHERE session_id LIKE ?').run(`hostsub-${host}-%`)
  const sizeOk = counts.size === 1 && counts.has(cardsPerPack) && shape === cardsPerPack
  const rate = subsetCards / N
  const rateOk = chance >= 1 ? Math.abs(rate - 1) < 1e-9 : Math.abs(rate - chance) <= 0.09
  const bonusSlot = slots.find((s) => s.slot === 'subset')
  const tillOk = !!bonusSlot && bonusSlot.count === 1
  const est = estimatePackValue(host)
  const ok = sizeOk && rateOk && wrongPosition === 0 && reverseSubset === 0 && foreign === 0 && tillOk && est.avg > 0
  if (!ok) {
    fail(`${host}: size ${sizeOk} (${[...counts.entries()].map(([n, c]) => `${n}×${c}`).join(', ')}), subset ${rate.toFixed(2)} vs ${chance}, off-slot ${wrongPosition}, reverse ${reverseSubset}, foreign ${foreign}, till ${tillOk}`)
  }
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${host} <- ${subset}: ${cardsPerPack} cards, subset ${(rate * 100).toFixed(1)}% (want ${(chance * 100).toFixed(1)}%) at card ${bonusAt + 1}`,
    `| foreign ${foreign} | till ${slots.map((s) => `${s.count} ${s.label}`).join(' + ')} | est $${est.avg.toFixed(2)}`,
  )
}

// Celebrations: four cards, a Classic Collection reprint in the third slot of
// about two packs in five, and every card a foil main-set or reprint card.
{
  const hostIds = idsOf('cel25')
  const classic = idsOf('cel25c')
  const counts = new Map<number, number>()
  let foreign = 0
  let reverse = 0
  let wrongSlot = 0
  let classicCards = 0
  for (let i = 0; i < N; i++) {
    const pack = rollPack('cel25', `subsetcheck-cel25-${i}`, 'booster', 4) ?? []
    counts.set(pack.length, (counts.get(pack.length) ?? 0) + 1)
    pack.forEach((c, at) => {
      if (/reverse/i.test(c.variant ?? '')) reverse++
      if (classic.has(c.cardId)) {
        classicCards++
        if (at !== 2) wrongSlot++
      } else if (!hostIds.has(c.cardId)) foreign++
    })
  }
  db.prepare('DELETE FROM pull_history WHERE session_id LIKE ?').run('subsetcheck-cel25-%')
  const rate = classicCards / N
  const ok = counts.size === 1 && counts.has(4) && foreign === 0 && wrongSlot === 0 && reverse === 0 && rate > 0.34 && rate < 0.46
  if (!ok) fail(`cel25: dealt ${[...counts.keys()].join('/')} cards, foreign ${foreign}, classic ${rate.toFixed(2)} at ${wrongSlot} off-slot, reverse ${reverse}`)
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} cel25: four cards, Classic Collection ${(rate * 100).toFixed(1)}% in the third slot | till ${packSlots('cel25', 4).map((s) => `${s.count} ${s.label}`).join(' + ')}`,
  )
}

console.log(fails === 0 ? `all ${unsold.length + Object.keys(HOST_SUBSETS).length + 1} subset checks OK` : `${fails} failing`)
process.exit(fails === 0 ? 0 : 1)
