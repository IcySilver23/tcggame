// Phase 10 product wiring: ball reverses in pulls, inventory and pricing.
//
// Checks the game-side table against the renderer registry, the researched
// eligibility rule, the sampled per-pack odds, the labelled premium, and a real
// roll of Prismatic Evolutions packs. Pull rows written by the roll are removed
// again in a finally block, so the save is restored.

import { db } from '../server/lib/db'
import {
  ASSIGNED_STAMP_PRINTINGS,
  BALL_PRINTINGS,
  BALL_VARIANTS,
  BALL_VALUE_MULT,
  ENERGY_REVERSE_SET_IDS,
  ENERGY_REVERSE_VARIANT,
  ballEligible,
  ballLabelFor,
  ballVariantFor,
  energyReverseEligible,
  hasEnergyReverse,
  isEnergyReverseVariant,
  specialBallFor,
  specialSlotChancesFor,
  specialSlotFor,
} from '../server/services/special-reverse'
import { ENERGY_REVERSE_PRINTINGS } from '../src/foil/reverse-energy-large-db'
import { SPECIAL_REVERSE_SETS } from '../src/foil/reverse-special'
import { ascendedVariantFor } from '../src/foil/ball-stamps'
import { VARIANT_LABELS, priceHistory, resolvePrice, round2, valueOf } from '../server/services/market'
import { rareVariantFor } from '../server/services/finish-odds'
import { estimatePackValue, rollPack } from '../server/services/packs'
import { expectedPackValue, planFor, profileFor, weightedAvg } from '../server/services/packodds'

let pass = 0
let fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) {
    pass++
    console.log(`  ok   ${msg}`)
  } else {
    fail++
    console.log(`  FAIL ${msg}`)
  }
}

const card = (supertype: string, subtypes: string[] = []) => ({ supertype, subtypes: JSON.stringify(subtypes) })
const lcg = (seed: number) => {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

// ---------------------------------------------------------------------------
// The game table mirrors the renderer registry
// ---------------------------------------------------------------------------
// The fixed-stamp sets roll one ball; Ascended Heroes assigns a stamp per card,
// so it is mirrored by ASSIGNED_STAMP_PRINTINGS and checked separately.
const FIXED_SET_IDS = ['sv8pt5', 'zsv10pt5', 'rsv10pt5']
const registry = new Map(
  SPECIAL_REVERSE_SETS.filter((s) => FIXED_SET_IDS.includes(s.setId)).map((s) => [`${s.setId}:${s.ball}`, s]),
)
ok(BALL_PRINTINGS.length === registry.size, `game table and renderer registry hold the same ${registry.size} fixed-stamp printings`)
for (const p of BALL_PRINTINGS) {
  const r = registry.get(`${p.setId}:${p.ball}`)
  ok(!!r, `${p.setId} ${p.ball} is a registered renderer printing`)
  ok(r?.pattern === p.pattern, `${p.setId} ${p.ball} routes to ${p.pattern}`)
}
ok(BALL_PRINTINGS.every((p) => p.oddsBasis === 'measured'), 'every fixed-stamp rate is directly measured')
ok(ASSIGNED_STAMP_PRINTINGS.length === 1 && ASSIGNED_STAMP_PRINTINGS.every((p) => p.oddsBasis === 'derived'), 'the Ascended Heroes rate is derived and no rate is left modelled')
ok(Math.abs((ASSIGNED_STAMP_PRINTINGS[0]?.packOdds ?? 0) - 0.8731) < 0.0001, 'Ascended Heroes carries the 87.31% measured-slot derivation')
ok(BALL_PRINTINGS.every((p) => p.packOdds > 0 && p.packOdds < 1), 'every rate is a real chance between 0 and 1')
ok(BALL_PRINTINGS.filter((p) => p.setId === 'sv8pt5').every((p) => p.reverseSlots === 2), 'Prismatic Evolutions models two reverse slots')
ok(ASSIGNED_STAMP_PRINTINGS.every((p) => p.reverseSlots === 2), 'Ascended Heroes models two reverse slots')
ok(BALL_PRINTINGS.filter((p) => p.setId !== 'sv8pt5' && p.setId !== 'me2pt5').every((p) => p.reverseSlots === 1), 'Black Bolt and White Flare keep one reverse slot')
ok(BALL_PRINTINGS.find((p) => p.setId === 'sv8pt5' && p.ball === 'pokeball')?.slot === 'first', 'Poké Ball is the first Prismatic slot')
ok(BALL_PRINTINGS.find((p) => p.setId === 'sv8pt5' && p.ball === 'masterball')?.slot === 'second', 'Master Ball is the second Prismatic slot')
ok(ASSIGNED_STAMP_PRINTINGS[0]?.slot === 'second', 'the assigned stamp is the second Ascended Heroes slot')
ok(ASSIGNED_STAMP_PRINTINGS[0].stamps.every((s) => s.stamp !== 'masterball'), 'Ascended Heroes makes no Master Ball claim in its stamp table')
const ascendedPlan = planFor('me2pt5', 10)
ok(ascendedPlan.filter((s) => s.slot === 'common')[0]?.count === 4, 'Ascended Heroes has four commons')
ok(ascendedPlan.filter((s) => s.slot === 'uncommon')[0]?.count === 3, 'Ascended Heroes has three uncommons')
ok(ascendedPlan.filter((s) => s.slot === 'reverse').length === 1 && ascendedPlan.filter((s) => s.slot === 'reverse2').length === 1, 'Ascended Heroes has two reverse slots in its plan')
ok(ascendedPlan.filter((s) => s.slot === 'hit')[0]?.count === 1, 'Ascended Heroes keeps one rare-or-hit slot')

// ---------------------------------------------------------------------------
// Pack estimates price the second slot and the ball premium
// ---------------------------------------------------------------------------
type EvRow = { card_id: string; weight: number; slot: string; rarity: string | null; supertype: string | null; subtypes: string | null }
const ascendedRows = db
  .prepare(
    `SELECT p.card_id, p.weight, p.slot, c.rarity, c.supertype, c.subtypes
     FROM pack_product_cards p JOIN cards c ON c.id = p.card_id
     WHERE p.pack_product_id = ?`,
  )
  .all('me2pt5-booster') as EvRow[]
const reverseRows = ascendedRows.filter((r) => r.slot === 'common' || r.slot === 'uncommon' || r.slot === 'holo')
const reverseValue = weightedAvg(reverseRows.map((r) => ({ weight: r.weight, v: valueOf(r.card_id, 'reverseHolofoil') })))
const ballValue = (ball: 'pokeball' | 'masterball') =>
  weightedAvg(reverseRows.filter((r) => ballEligible(ball, r)).map((r) => ({ weight: r.weight, v: valueOf(r.card_id, BALL_VARIANTS[ball]) })))
// The rare slot prices each card at the finish it pulls as, so the mirror here
// has to price the same way or the EV comparison is measuring two models.
const finishValue = (r: { card_id: string; rarity: string | null }) =>
  valueOf(r.card_id, rareVariantFor('me2pt5', r.rarity))
const upgradeValue = (rarity: string) =>
  weightedAvg(
    ascendedRows
      .filter((r) => (r.slot === 'hit' || r.slot === 'reverse2hit') && (r.rarity ?? '').toLowerCase() === rarity.toLowerCase())
      .map((r) => ({ weight: r.weight, v: finishValue(r) })),
  )
const chances = specialSlotChancesFor('me2pt5', 'second')
ok(!!chances, 'the Ascended Heroes second-slot probabilities are exposed without randomness')
if (chances) {
  const assignedOdds = chances.assigned
  const ir = chances.upgrades.find((u) => u.rarity === 'Illustration Rare')?.odds ?? 0
  const sir = chances.upgrades.find((u) => u.rarity === 'Special Illustration Rare')?.odds ?? 0
  ok(chances.balls.length === 0, 'the Ascended Heroes slot rolls no ball: the drawn card decides its paper')
  ok(Math.abs(assignedOdds - 0.8731) < 0.0001, `the estimate sees the 87.31% assigned-paper chance (${(assignedOdds * 100).toFixed(2)}%)`)
  ok(Math.abs(ir - 0.1125) < 0.0001 && Math.abs(sir - 0.0144) < 0.0001, 'the estimate sees both measured IR/SIR replacements')
  ok(Math.abs(chances.reverse - 0) < 0.0001, 'the measured outcomes fill the Ascended Heroes second slot')
  const assignedValue = weightedAvg(
    reverseRows
      .filter((r) => ascendedVariantFor(r.card_id))
      .map((r) => ({ weight: r.weight, v: valueOf(r.card_id, ascendedVariantFor(r.card_id)!) })),
  )
  const second = chances.reverse * reverseValue + assignedOdds * assignedValue + ir * upgradeValue('Illustration Rare') + sir * upgradeValue('Special Illustration Rare')
  const noPaper = chances.reverse * reverseValue + assignedOdds * reverseValue + ir * upgradeValue('Illustration Rare') + sir * upgradeValue('Special Illustration Rare')
  ok(assignedValue > reverseValue, `an assigned paper is worth $${assignedValue.toFixed(2)} against the $${reverseValue.toFixed(2)} ordinary reverse`)
  ok(second > noPaper, `the assigned-paper premium raises the second slot from $${noPaper.toFixed(2)} to $${second.toFixed(2)}`)

  const plan = planFor('me2pt5', 10)
  const count = (slot: string) => plan.filter((s) => s.slot === slot).reduce((n, s) => n + s.count, 0)
  const hitRows = ascendedRows.filter((r) => r.slot === 'hit')
  const normalValue = (slot: string) => weightedAvg(ascendedRows.filter((r) => r.slot === slot).map((r) => ({ weight: r.weight, v: valueOf(r.card_id) })))
  const hitChance = Math.min(0.85, hitRows.reduce((n, r) => n + Math.max(0, r.weight), 0))
  // A rare-slot miss draws the plain Rare from the holo pool, not an Energy.
  const fallback = ascendedRows.filter((r) => r.slot === 'holo').map((r) => ({ weight: r.weight, v: finishValue(r) }))
  const finalValue = hitChance * weightedAvg(hitRows.map((r) => ({ weight: r.weight, v: finishValue(r) }))) + (1 - hitChance) * weightedAvg(fallback)
  const manual = count('common') * normalValue('common') + count('uncommon') * normalValue('uncommon') + count('reverse') * reverseValue + count('reverse2') * second + count('hit') * finalValue
  const oldModel = count('common') * normalValue('common') + count('uncommon') * normalValue('uncommon') + (count('reverse') + count('reverse2')) * reverseValue + count('hit') * finalValue
  const ascendedEv = expectedPackValue('me2pt5')
  ok(round2(manual) === ascendedEv, `the sealed EV matches the modelled second slot ($${ascendedEv})`)
  ok(ascendedEv > round2(oldModel) + 3, `the estimate adds $${(ascendedEv - round2(oldModel)).toFixed(2)} over the old ordinary-reverse model`)
  ok(estimatePackValue('me2pt5').avg === ascendedEv, 'the shop estimate and the sealed anchor use the same second-slot value')
}

// ---------------------------------------------------------------------------
// Eligibility matches the report's researched rule
// ---------------------------------------------------------------------------
ok(ballEligible('pokeball', card('Trainer', ['Item'])), 'Poké Ball allows a Trainer')
ok(ballEligible('pokeball', card('Pokémon', ['Stage 1'])), 'Poké Ball allows a regular Pokémon')
ok(!ballEligible('pokeball', card('Pokémon', ['ex'])), 'Poké Ball refuses a Pokémon ex')
ok(!ballEligible('pokeball', card('Trainer', ['ACE SPEC'])), 'Poké Ball refuses ACE SPEC')
ok(!ballEligible('pokeball', card('Energy')), 'Poké Ball refuses Energy')
ok(ballEligible('masterball', card('Pokémon', ['Stage 1'])), 'Master Ball allows a regular Pokémon')
ok(!ballEligible('masterball', card('Trainer', ['Item'])), 'Master Ball refuses a Trainer')
ok(!ballEligible('masterball', card('Pokémon', ['ex'])), 'Master Ball refuses a Pokémon ex')
ok(!ballEligible('masterball', card('Energy')), 'Master Ball refuses Energy')
ok(energyReverseEligible(card('Pokémon', ['Stage 1'])), 'the Energy paper allows a regular Pokémon')
ok(!energyReverseEligible(card('Pokémon', ['ex'])), 'the Energy paper refuses a Pokémon ex')
ok(!energyReverseEligible(card('Trainer', ['Item'])), 'the Energy paper refuses a Trainer')
ok(!energyReverseEligible(card('Energy')), 'the Energy paper refuses an Energy card')
ok(ENERGY_REVERSE_SET_IDS.join(',') === ENERGY_REVERSE_PRINTINGS.map((p) => p.setId).join(','), 'the game and renderer agree on the Energy-paper set')
ok(hasEnergyReverse('me2pt5') && !hasEnergyReverse('sv8pt5'), 'only Ascended Heroes has the Energy paper')
ok(isEnergyReverseVariant(ENERGY_REVERSE_VARIANT), 'the game recognises the Energy reverse token')

// ---------------------------------------------------------------------------
// Sampled odds: Master Ball rolls first, then Poké Ball, on eligible cards only
// ---------------------------------------------------------------------------
const N = 120_000
const rngFirst = lcg(20251105)
let pbFirst = 0
let mbFirst = 0
let ordinaryFirst = 0
for (let i = 0; i < N; i++) {
  const v = ballVariantFor('sv8pt5', 'first', rngFirst)
  if (v === BALL_VARIANTS.pokeball) pbFirst++
  else if (v === BALL_VARIANTS.masterball) mbFirst++
  else if (v === 'reverseHolofoil') ordinaryFirst++
}
ok(Math.abs(pbFirst / N - 0.331) < 0.006, `Prismatic slot one sampled Poké Ball at ${((pbFirst / N) * 100).toFixed(2)}% against 1 in 3`)
ok(mbFirst === 0, 'Prismatic slot one never rolls a Master Ball')
ok(ordinaryFirst > 0, 'a non-ball reverse slot still yields the ordinary reverse paper')

const rngSecond = lcg(20251106)
let mbSecond = 0
let pbSecond = 0
for (let i = 0; i < N; i++) {
  const v = ballVariantFor('sv8pt5', 'second', rngSecond)
  if (v === BALL_VARIANTS.masterball) mbSecond++
  else if (v === BALL_VARIANTS.pokeball) pbSecond++
}
ok(Math.abs(mbSecond / N - 0.05) < 0.004, `Prismatic slot two sampled Master Ball at ${((mbSecond / N) * 100).toFixed(2)}% against 5%`)
ok(pbSecond === 0, 'Prismatic slot two never rolls a Poké Ball')

const rngSingle = lcg(20251107)
let pbSingle = 0
let mbSingle = 0
for (let i = 0; i < N; i++) {
  const v = ballVariantFor('zsv10pt5', 'first', rngSingle)
  if (v === BALL_VARIANTS.pokeball) pbSingle++
  else if (v === BALL_VARIANTS.masterball) mbSingle++
}
ok(Math.abs(mbSingle / N - 0.0514) < 0.004, `Black Bolt sampled Master Ball at ${((mbSingle / N) * 100).toFixed(2)}% against 5.14%`)
ok(Math.abs(pbSingle / N - 0.9486 * 0.3056) < 0.006, 'Black Bolt rolls Poké Ball after the Master Ball roll')

// The stamp roll is per pack and card-independent; the pack swaps in an
// eligible card when it lands. End-to-end eligibility is checked below.

let ascendedAssigned = 0
let ascendedFirstBall = 0
let ascendedN = 60_000
const ascendedRng = lcg(11)
for (let i = 0; i < ascendedN; i++) {
  const first = specialSlotFor('me2pt5', 'first', ascendedRng)
  if (first?.kind === 'ball' || first?.kind === 'assigned') ascendedFirstBall++
  const second = specialSlotFor('me2pt5', 'second', ascendedRng)
  if (second?.kind === 'assigned') ascendedAssigned++
}
ok(ascendedFirstBall === 0, 'Ascended Heroes never puts a stamp in its Energy slot')
ok(Math.abs(ascendedAssigned / ascendedN - 0.8731) < 0.006, `Ascended Heroes slot two sampled an assigned paper at ${((ascendedAssigned / ascendedN) * 100).toFixed(2)}% against 87.31%`)

let ascendedIr = 0
let ascendedSir = 0
const upgradeRng = lcg(12)
for (let i = 0; i < ascendedN; i++) {
  const outcome = specialSlotFor('me2pt5', 'second', upgradeRng)
  if (outcome?.kind === 'upgrade' && outcome.rarity === 'Illustration Rare') ascendedIr++
  else if (outcome?.kind === 'upgrade' && outcome.rarity === 'Special Illustration Rare') ascendedSir++
}
ok(Math.abs(ascendedIr / ascendedN - 0.1125) < 0.008, `Ascended Heroes slot two sampled Illustration Rare at ${((ascendedIr / ascendedN) * 100).toFixed(2)}% against 11.25%`)
ok(Math.abs(ascendedSir / ascendedN - 0.0144) < 0.004, `Ascended Heroes slot two sampled Special Illustration Rare at ${((ascendedSir / ascendedN) * 100).toFixed(2)}% against 1.44%`)

// ---------------------------------------------------------------------------
// Labels and the labelled premium
// ---------------------------------------------------------------------------
ok(VARIANT_LABELS[BALL_VARIANTS.pokeball]?.includes('Poké Ball') === true, 'the server names the Poké Ball variant')
ok(VARIANT_LABELS[BALL_VARIANTS.masterball]?.includes('Master Ball') === true, 'the server names the Master Ball variant')
ok(VARIANT_LABELS[ENERGY_REVERSE_VARIANT]?.includes('Energy') === true, 'the server names the Energy reverse variant')
ok(ballLabelFor(BALL_VARIANTS.masterball) === 'Master Ball', 'the client label helper names the Master Ball')
ok(specialBallFor(BALL_VARIANTS.pokeball) === 'pokeball', 'the variant token parses back to the ball')
ok(specialBallFor(ENERGY_REVERSE_VARIANT) === null, 'the Energy reverse is not mistaken for a ball')

const reversePrice = resolvePrice('sv8pt5-1', 'reverseHolofoil')
const pokePrice = resolvePrice('sv8pt5-1', BALL_VARIANTS.pokeball)
const masterPrice = resolvePrice('sv8pt5-1', BALL_VARIANTS.masterball)
const energyPrice = resolvePrice('sv8pt5-1', ENERGY_REVERSE_VARIANT)
ok(reversePrice.usd != null && reversePrice.usd > 0, `the reverse anchor has a real price ($${reversePrice.usd})`)
ok(pokePrice.usd === round2((reversePrice.usd ?? 0) * BALL_VALUE_MULT.pokeball), 'Poké Ball prices at its 1.5x premium')
ok(masterPrice.usd === round2((reversePrice.usd ?? 0) * BALL_VALUE_MULT.masterball), 'Master Ball prices at its 8x premium')
ok(pokePrice.source === 'estimated' && pokePrice.kind === 'model', 'the premium is labelled estimated, not live')
ok(pokePrice.variant === BALL_VARIANTS.pokeball, 'the price keeps the requested ball token')
ok(energyPrice.usd === reversePrice.usd && energyPrice.variant === ENERGY_REVERSE_VARIANT, 'the Energy reverse uses the reverse anchor and keeps its token')
const historyReverse = priceHistory('sv8pt5-1', 'reverseHolofoil')
const historyPoke = priceHistory('sv8pt5-1', BALL_VARIANTS.pokeball)
const historyEnergy = priceHistory('sv8pt5-1', ENERGY_REVERSE_VARIANT)
ok(historyReverse.length > 0 && historyPoke.length === historyReverse.length, 'a ball chart reads the ordinary reverse history')
ok(historyEnergy.length === historyReverse.length, 'an Energy chart reads the ordinary reverse history')

// ---------------------------------------------------------------------------
// A real roll: one reverse slot, at most one ball, eligible cards only
// ---------------------------------------------------------------------------
const session = `test_special_${Date.now()}`
const controlSession = `test_control_${Date.now()}`
let rows: { card_id: string; variant: string }[] = []
let ballRows: { variant: string; supertype: string; subtypes: string }[] = []
let controlRows: { card_id: string; variant: string }[] = []
let packs = 0
let pbPacks = 0
let mbPacks = 0
let bothPacks = 0
let maxBalls = 0
try {
  for (let i = 0; i < 600; i++) {
    const cards = rollPack('sv8pt5', session)
    if (!cards) break
    packs++
    const balls = cards.filter((c) => specialBallFor(c.variant))
    maxBalls = Math.max(maxBalls, balls.length)
    const hasPb = balls.some((c) => c.variant === BALL_VARIANTS.pokeball)
    const hasMb = balls.some((c) => c.variant === BALL_VARIANTS.masterball)
    if (hasPb) pbPacks++
    if (hasMb) mbPacks++
    if (hasPb && hasMb) bothPacks++
  }
  rows = db.prepare('SELECT card_id, variant FROM pull_history WHERE session_id = ?').all(session) as { card_id: string; variant: string }[]
  ballRows = db
    .prepare(
      `SELECT ph.variant, c.supertype, c.subtypes FROM pull_history ph
       JOIN cards c ON c.id = ph.card_id
       WHERE ph.session_id = ? AND ph.variant IN (?, ?)`,
    )
    .all(session, BALL_VARIANTS.pokeball, BALL_VARIANTS.masterball) as { variant: string; supertype: string; subtypes: string }[]

  const control = db
    .prepare(
      `SELECT s.id FROM sets s
       WHERE EXISTS (SELECT 1 FROM pack_product_cards p WHERE p.pack_product_id = s.id || '-booster')
         AND s.id NOT IN ('sv8pt5', 'zsv10pt5', 'rsv10pt5', 'me2pt5')
       LIMIT 1`,
    )
    .get() as { id: string } | undefined
  if (control) {
    for (let i = 0; i < 3; i++) rollPack(control.id, controlSession)
    controlRows = db.prepare('SELECT card_id, variant FROM pull_history WHERE session_id = ?').all(controlSession) as { card_id: string; variant: string }[]
  }
} finally {
  db.prepare('DELETE FROM pull_history WHERE session_id IN (?, ?)').run(session, controlSession)
}

ok(packs === 600, 'rolled 600 Prismatic Evolutions packs')
ok(maxBalls <= 2, 'a pack holds at most two balls, one per reverse slot')
ok(bothPacks > 0, `a pack held both balls in ${bothPacks}/${packs} packs`)
ok(pbPacks / packs > 0.24 && pbPacks / packs < 0.38, `Poké Ball appeared in ${pbPacks}/${packs} packs`)
// A 600-pack sample of a 5% event has σ = sqrt(p(1-p)/n) ≈ 0.9pp, so a fixed
// "> 3%" bound sat only 2.25σ below the mean and failed about one run in a
// hundred. This is a 3σ band on the published rate instead: it cannot flake on
// an ordinary low roll, and it still fails a roller that has drifted (2% or 8%
// are both well outside it).
const MB_RATE = 0.05
const mbSigma = Math.sqrt((MB_RATE * (1 - MB_RATE)) / packs)
const mbLow = MB_RATE - 3 * mbSigma
const mbHigh = MB_RATE + 3 * mbSigma
ok(
  mbPacks / packs >= mbLow && mbPacks / packs <= mbHigh,
  `Master Ball appeared in ${mbPacks}/${packs} packs — inside 3σ of the published 5% (${(mbLow * 100).toFixed(1)}–${(mbHigh * 100).toFixed(1)}%)`,
)
ok(rows.some((r) => r.variant === 'reverseHolofoil'), 'the reverse slot still produces plain reverse printings')
ok(rows.some((r) => r.variant === BALL_VARIANTS.pokeball), 'the pull history stores the Poké Ball token')
ok(rows.some((r) => r.variant === BALL_VARIANTS.masterball), 'the pull history stores the Master Ball token')

const ineligible = ballRows.filter((r) => {
  const ball = specialBallFor(r.variant)
  return !ball || !ballEligible(ball, r)
})
ok(ballRows.length > 0 && ineligible.length === 0, `all ${ballRows.length} ball pulls satisfy the researched eligibility`)

ok(controlRows.length > 0, 'control set rolled')
ok(!controlRows.some((r) => specialBallFor(r.variant)), 'an ordinary set still yields no ball variants')

// Ascended Heroes is a two-reverse pack: the first reverse is the Energy slot
// and the second is the assigned Poké Ball slot. Roll it for real so the
// blueprint, not just the variant helper, is exercised.
const ascendedSession = `test_ascended_${Date.now()}`
let ascendedPacks = 0
let ascendedTwoSlots = 0
let ascendedBallPacks = 0
let ascendedUpgradePacks = 0
let ascendedBadUpgrade = 0
let ascendedEnergyFirst = 0
let ascendedBadEnergy = 0
let ascendedWrongPaper = 0
const ascendedMeta = db.prepare('SELECT rarity, supertype, subtypes FROM cards WHERE id = ?')
try {
  for (let i = 0; i < 300; i++) {
    const cards = rollPack('me2pt5', ascendedSession)
    if (!cards) break
    ascendedPacks++
    const firstSlot = cards[7]
    const secondSlot = cards[8]
    const secondMeta = secondSlot
      ? ascendedMeta.get(secondSlot.cardId) as { rarity: string | null } | undefined
      : undefined
    const secondIsUpgrade = secondMeta?.rarity === 'Illustration Rare' || secondMeta?.rarity === 'Special Illustration Rare'
    const firstMeta = firstSlot
      ? ascendedMeta.get(firstSlot.cardId) as { supertype: string | null; subtypes: string | null } | undefined
      : undefined
    if (firstSlot?.variant === ENERGY_REVERSE_VARIANT) {
      ascendedEnergyFirst++
      if (!firstMeta || !energyReverseEligible(firstMeta)) ascendedBadEnergy++
    }
    const firstFilled = firstSlot?.variant === ENERGY_REVERSE_VARIANT || firstSlot?.variant === 'reverseHolofoil' || !!specialBallFor(firstSlot?.variant)
    const secondFilled = secondSlot?.variant === 'reverseHolofoil' || !!specialBallFor(secondSlot?.variant) || secondIsUpgrade
    if (firstFilled && secondFilled) ascendedTwoSlots++
    if (!!specialBallFor(secondSlot?.variant)) {
      ascendedBallPacks++
      if (secondSlot.variant !== ascendedVariantFor(secondSlot.cardId)) ascendedWrongPaper++
    }
    if (secondIsUpgrade) {
      ascendedUpgradePacks++
      if (secondSlot.variant !== 'normal' || !secondSlot.isHit) ascendedBadUpgrade++
    }
  }
} finally {
  db.prepare('DELETE FROM pull_history WHERE session_id = ?').run(ascendedSession)
}
ok(ascendedPacks === 300, 'rolled 300 Ascended Heroes packs')
ok(ascendedEnergyFirst === ascendedPacks, 'every Ascended Heroes first reverse slot uses the Energy paper')
ok(ascendedBadEnergy === 0, 'every Energy reverse went to a regular Pokémon')
ok(ascendedTwoSlots === ascendedPacks, 'every Ascended Heroes pack fills both reverse slots')
ok(ascendedBallPacks / ascendedPacks > 0.80 && ascendedBallPacks / ascendedPacks < 0.94, `Ascended Heroes put a ball in the second slot in ${ascendedBallPacks}/${ascendedPacks} packs`)
ok(ascendedUpgradePacks > 0 && ascendedUpgradePacks / ascendedPacks > 0.07 && ascendedUpgradePacks / ascendedPacks < 0.20, `Ascended Heroes upgraded its second slot in ${ascendedUpgradePacks}/${ascendedPacks} packs`)
ok(ascendedBadUpgrade === 0, 'every Ascended Heroes second-slot upgrade is a normal hit card')
ok(ascendedWrongPaper === 0, 'every Ascended Heroes stamp is the exact paper assigned to that card')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
