// Pack structure — what a real English booster holds, and in what order.
//
// Sources (server/services/packodds.ts carries the quotes):
//   Bulbapedia Booster pack (TCG): 11 cards Base–Neo Destiny; 9 e-Card/EX;
//   10 from Diamond & Pearl; a Basic Energy in addition to the 10 game cards
//   from Sun & Moon; two reverse holos and a rare in the ten from Scarlet &
//   Violet; one reverse holo from Legendary Collection (2002) on.
//   PokeBeach (2023): SV order is 4 common, 3 uncommon, 2 reverse holos, 1 holo.
//
// The game deals the ten GAME cards, so the modern extra Energy/code card is
// not one of them; the WotC eleven-card pack is dealt as ten with one of its
// two Energies dropped.
//
// Run against a copy of the save:
//   TCGLIFE_HOME=$PWD/tmp/audit-home node ./node_modules/tsx/dist/cli.mjs tmp/check-pack-structure.ts
import { rollPack } from '../server/services/packs'
import { planFor, packSlots, eraOf, reverseInPack } from '../server/services/packodds'
import { db } from '../server/lib/db'

let passed = 0
let failed = 0
const ok = (cond: boolean, msg: string) => {
  if (cond) {
    passed++
    console.log('  ok  ', msg)
  } else {
    failed++
    console.log('  FAIL', msg)
  }
}

function poolsFor(setId: string) {
  const rows = db
    .prepare(`SELECT card_id, slot, weight FROM pack_product_cards WHERE pack_product_id = ?`)
    .all(`${setId}-booster`) as { card_id: string; slot: string; weight: number }[]
  const by = (slot: string) => new Set(rows.filter((r) => r.slot === slot).map((r) => r.card_id))
  const weights = (slot: string) => rows.filter((r) => r.slot === slot).reduce((a, r) => a + Math.max(0, r.weight), 0)
  return {
    common: by('common'),
    uncommon: by('uncommon'),
    rare: by('holo'),
    hit: by('hit'),
    energy: by('energy'),
    subset: by('subset'),
    hitChance: Math.min(0.85, weights('hit')),
  }
}

function simulate(setId: string, n: number) {
  const packs: { cardId: string; variant?: string; isHit: boolean }[][] = []
  for (let i = 0; i < n; i++) {
    const cards = rollPack(setId, `pstruct-${setId}-${i}`, 'booster', 10)
    if (!cards) throw new Error(`no pull table for ${setId}`)
    packs.push(cards)
  }
  db.prepare(`DELETE FROM pull_history WHERE session_id LIKE ?`).run(`pstruct-${setId}-%`)
  return packs
}

const N = 300
const samples = ['base1', 'base6', 'ecard1', 'neo1', 'neo4', 'ecard2', 'ex11', 'dp1', 'bw1', 'sm1', 'swsh1', 'sv1', 'me55']

for (const setId of samples) {
  const era = eraOf(setId)
  const plan = planFor(setId, 10)
  const pk = poolsFor(setId)
  const r2hit = new Set(
    (db.prepare(`SELECT card_id FROM pack_product_cards WHERE pack_product_id = ? AND slot = 'reverse2hit'`).all(`${setId}-booster`) as { card_id: string }[]).map((r) => r.card_id),
  )
  const packs = simulate(setId, N)
  const label = `${setId} (${era})`
  const shape = plan.map((s) => `${s.count}×${s.slot}`).join(' + ')
  const uncommonTotal = plan.reduce((a, s) => a + (s.slot === 'uncommon' ? s.count : 0), 0)
  const reverseTotal = plan.reduce((a, s) => a + (s.slot === 'reverse' || s.slot === 'reverse2' ? s.count : 0), 0)
  const hitTotal = plan.reduce((a, s) => a + (s.slot === 'hit' ? s.count : 0), 0)
  const commonTotal = plan.reduce((a, s) => a + (s.slot === 'common' ? s.count : 0), 0)

  // ---- structure -----------------------------------------------------------
  ok(plan.reduce((a, s) => a + s.count, 0) === 10, `${label}: plan is the ten game cards (${shape})`)
  // The shelf prints this breakdown, so it has to be the plan the roller deals.
  const slots = packSlots(setId, 10)
  ok(slots.reduce((a, s) => a + s.count, 0) === 10, `${label}: the shelf's slot breakdown adds up to ten cards`)
  ok(
    slots.length === plan.length && slots.every((s, i) => s.slot === plan[i].slot && s.count === plan[i].count),
    `${label}: the shelf's breakdown matches the dealt plan`,
  )
  ok(slots.every((s) => s.label.length > 0 && s.detail.length > 0), `${label}: every slot has a label and a sentence`)
  ok(packs.every((p) => p.length === 10), `${label}: every rolled pack holds ten cards`)
  const rareCounts = packs.map((p) => p.filter((c) => pk.rare.has(c.cardId) || pk.hit.has(c.cardId)).length)
  ok(
    rareCounts.every((n) => n === hitTotal),
    `${label}: ${hitTotal} rare-or-hit per pack, not a rare plus a hit (min ${Math.min(...rareCounts)}, max ${Math.max(...rareCounts)})`,
  )
  ok(uncommonTotal === 3 || setId === 'me55', `${label}: three uncommons (${uncommonTotal})`)

  // ---- hit rate ------------------------------------------------------------
  const hitRate = packs.filter((p) => p.some((c) => pk.hit.has(c.cardId))).length / N
  const sigma = Math.sqrt((pk.hitChance * (1 - pk.hitChance)) / N)
  ok(
    Math.abs(hitRate - pk.hitChance) <= 3 * sigma,
    `${label}: hit rate ${(hitRate * 100).toFixed(1)}% against the pool's ${(pk.hitChance * 100).toFixed(1)}% (±${(3 * sigma * 100).toFixed(1)})`,
  )

  // ---- reverse holos -------------------------------------------------------
  const reversesPerPack = packs.map((p) => p.filter((c) => /reverse/i.test(c.variant ?? '') || r2hit.has(c.cardId)).length)
  const reverseExpect = reverseInPack(setId) ? reverseTotal : 0
  ok(
    reversesPerPack.every((n) => n === reverseExpect),
    `${label}: ${reverseExpect} reverse holo printing(s) per pack (saw ${Math.min(...reversesPerPack)}–${Math.max(...reversesPerPack)})`,
  )
  ok(reverseInPack('base1') === false && reverseInPack('neo4') === false, 'Base through Neo Destiny predate reverse holos')
  ok(reverseInPack('base6') === true && reverseInPack('ecard1') === true, 'Legendary Collection and Expedition carry reverse holos')

  // ---- Basic Energy --------------------------------------------------------
  const energyPerPack = packs.map((p) => p.filter((c) => pk.energy.has(c.cardId)).length)
  const energyExpect = plan.reduce((a, s) => a + (s.slot === 'energy' ? s.count : 0), 0)
  ok(
    energyPerPack.every((n) => n === energyExpect),
    energyExpect === 1
      ? `${label}: one Basic Energy in the ten (WotC's eleven-card pack, one Energy dropped)`
      : `${label}: no Basic Energy among the ten game cards (${pk.energy.size} in the set's pool)`,
  )

  // ---- order ---------------------------------------------------------------
  // Walk the plan in card order and check every card sits in the slot's pool.
  const first = packs[0]
  let at = 0
  let orderOk = true
  for (const slot of plan) {
    for (let i = 0; i < slot.count; i++, at++) {
      const card = first[at]
      const good =
        slot.slot === 'common'
          ? pk.common.has(card.cardId)
          : slot.slot === 'uncommon'
            ? pk.uncommon.has(card.cardId)
            : slot.slot === 'reverse' || slot.slot === 'reverse2'
              ? /reverse/i.test(card.variant ?? '') || (slot.slot === 'reverse2' && r2hit.has(card.cardId))
              : slot.slot === 'hit'
                ? pk.rare.has(card.cardId) || pk.hit.has(card.cardId)
                : slot.slot === 'energy'
                  ? pk.energy.has(card.cardId)
                  : slot.slot === 'subset'
                    ? pk.subset.has(card.cardId)
                    : true
      if (!good) {
        orderOk = false
        console.log(`       slot ${slot.slot} card ${at} was ${card.cardId} (${card.variant})`)
      }
    }
  }
  ok(orderOk, `${label}: card order matches the physical pack (${shape})`)
  ok(at === 10, `${label}: the plan fills every position`)

  // Era-specific landmarks, stated the way an opener would see them.
  if (era === 'wotc') {
    const energyIndex = commonTotal + reverseTotal
    const rareIndex = energyIndex + energyExpect
    ok(energyExpect === 0 || (at > 0 && pk.energy.has(first[energyIndex].cardId)), `${label}: Energy comes right after the commons`)
    ok(pk.rare.has(first[rareIndex].cardId) || pk.hit.has(first[rareIndex].cardId), `${label}: the rare sits behind the reverse/Energy, before the uncommons`)
    if (reverseTotal > 0) ok(/reverse/i.test(first[commonTotal].variant ?? ''), `${label}: the reverse holo sits right after the commons`)
  }
  if (era === 'sv' && pk.subset.size === 0) {
    ok(reverseTotal === 2, `${label}: two reverse holo slots`)
    ok(pk.rare.has(first[9].cardId) || pk.hit.has(first[9].cardId), `${label}: the rarest card is last`)
    ok(
      /reverse/i.test(first[7].variant ?? '') && (/reverse/i.test(first[8].variant ?? '') || r2hit.has(first[8].cardId)),
      `${label}: both parallels sit in front of it (the second may be the IR/SIR upgrade)`,
    )
  }
  if (era !== 'wotc' && era !== 'sv') {
    ok(/reverse/i.test(first[commonTotal].variant ?? ''), `${label}: reverse holo follows the commons`)
    ok(pk.rare.has(first[commonTotal + 1].cardId) || pk.hit.has(first[commonTotal + 1].cardId), `${label}: the rare follows the reverse`)
  }
  if (setId === 'me55') {
    ok(packs.every((p) => p.filter((c) => pk.subset.has(c.cardId)).length === 1), `${label}: one guaranteed 30C Pikachu per pack`)
  }
}

console.log(failed === 0 ? `\nALL OK — ${passed} checks` : `\n${failed} FAILED of ${passed + failed}`)
process.exit(failed === 0 ? 0 : 1)
