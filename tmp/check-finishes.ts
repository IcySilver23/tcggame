// Generic finishes — one vocabulary, one era table, and the finish a pull stores.
//
// Run against a copy of the save:
//   TCGLIFE_HOME=$PWD/tmp/audit-home node ./node_modules/tsx/dist/cli.mjs tmp/check-finishes.ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FINISHES, FINISH_IDS, finishForVariant, finishVariant, isFoilFinish } from '../src/foil/finishes'
import { PATTERNS } from '../src/foil/patterns'
import { finishOddsFor, planFor, profileFor } from '../server/services/packodds'
import { holoFinishFor, isFoilRare, rareFinishFor, rareVariantFor } from '../server/services/finish-odds'
import { rollPack } from '../server/services/packs'
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

// ---------------------------------------------------------------------------
// The registry is the vocabulary: every finish points at a real pattern, and a
// finish that claims a texture names a sheet that exists on disk.
// ---------------------------------------------------------------------------
ok(FINISH_IDS.length >= 10, `the generic vocabulary has ${FINISH_IDS.length} finishes`)
for (const id of FINISH_IDS) {
  const f = FINISHES[id]
  ok(f.id === id, `${id}: registry key matches its id`)
  ok(f.pattern === null || !!PATTERNS[f.pattern], `${id}: pattern '${f.pattern}' is registered`)
  ok(f.pattern === null || !f.sheet || existsSync(join(process.cwd(), 'public', f.sheet)), `${id}: sheet exists (${f.sheet ?? 'none'})`)
  const expectedKey = f.group === 'plain' ? 'normal' : f.group === 'reverse' ? 'reverseHolofoil' : 'holofoil'
  ok(finishVariant(id) === expectedKey, `${id}: prices as ${expectedKey}`)
}
ok(!isFoilFinish('plain') && isFoilFinish('holo') && isFoilFinish('reverse'), 'plain is not foil; holo and reverse are')

// Variant tokens map onto the vocabulary, and unknown tokens stay unknown.
ok(finishForVariant('normal') === 'plain', "'normal' resolves to plain")
ok(finishForVariant('holofoil') === 'holo', "'holofoil' resolves to holo")
ok(finishForVariant('reverseHolofoil') === 'reverse', "'reverseHolofoil' resolves to reverse")
ok(finishForVariant('reverseHolofoilMasterBall') === 'reverse', 'a stamped reverse is still a reverse finish')
ok(finishForVariant('sequinHolofoil') === 'sequin', 'the sequin variant is its own finish')
ok(finishForVariant('1stEditionHolofoil') === 'holo', 'a first-edition holo is a holo finish')
ok(finishForVariant('somethingElse') === null, 'an unknown token is not guessed')

// ---------------------------------------------------------------------------
// The era table. One row per era, sourced in server/services/finish-odds.ts.
// ---------------------------------------------------------------------------
const era: [string, string][] = [
  ['base1', 'starlight'],
  ['base2', 'starlight'], // Jungle
  ['base3', 'starlight'], // Fossil
  ['base4', 'cosmos'], // Base Set 2, 2000
  ['neo1', 'cosmos'],
  ['ecard2', 'cosmos'],
  ['ex11', 'cosmos'],
  ['dp1', 'cosmos'],
  ['hgss1', 'cosmos'],
  ['bw1', 'tinsel'],
  ['xy1', 'mirror'],
  ['sm1', 'waterweb'],
  ['swsh1', 'line'],
  ['sv1', 'mirage'],
  ['me55', 'mirage'],
]
for (const [setId, want] of era) ok(holoFinishFor(setId) === want, `${setId}: era holo paper is ${want} (${holoFinishFor(setId)})`)

// Foil rares: an older plain Rare is not foil, a holo rare is, and SV made all
// rares foil.
ok(!isFoilRare('base4', 'Rare') && isFoilRare('base4', 'Rare Holo'), 'Base Set 2: Rare is non-holo, Rare Holo is foil')
ok(isFoilRare('sv1', 'Rare') && isFoilRare('sv1', 'Double Rare'), 'Scarlet & Violet: every Rare or higher is foil')
ok(rareVariantFor('base4', 'Rare') === 'normal', 'a non-holo rare stores the plain price key')
ok(rareVariantFor('base4', 'Rare Holo') === 'holofoil', 'a holo rare stores the foil price key')
ok(rareFinishFor('sv1', 'Illustration Rare') === 'mirage', 'an SV illustration rare wears the era paper')

// ---------------------------------------------------------------------------
// Slot odds: the rare split is the era's, the hit slot is foil, reverse is
// always reverse. Every slot's odds sum to 1.
// ---------------------------------------------------------------------------
for (const setId of ['base4', 'bw1', 'sm1', 'sv1']) {
  const rare = finishOddsFor(setId, 'rare')
  ok(Math.abs(rare.reduce((a, r) => a + r.odds, 0) - 1) < 1e-9, `${setId}: rare-slot finish odds sum to 1`)
  const plain = rare.find((r) => r.finish === 'plain')?.odds ?? 0
  const want = setId === 'sv1' ? 0 : Math.max(0, 1 - profileFor(setId).rare.holo)
  ok(Math.abs(plain - want) < 1e-9, `${setId}: plain-rare share ${(plain * 100).toFixed(1)}% matches the era split`)
  ok(finishOddsFor(setId, 'hit').length === 1 && finishOddsFor(setId, 'hit')[0].finish === holoFinishFor(setId), `${setId}: a hit is always the era foil`)
  ok(finishOddsFor(setId, 'reverse')[0].finish === 'reverse', `${setId}: the reverse slot is always a reverse finish`)
}

// ---------------------------------------------------------------------------
// What the roller stores. A holo rare must come out as a foil printing (and be
// priced as one), a plain rare as plain, and a reverse slot as reverse.
// ---------------------------------------------------------------------------
const meta = new Map(
  (db.prepare(`SELECT id, rarity, supertype FROM cards`).all() as { id: string; rarity: string | null; supertype: string }[]).map((r) => [r.id, r]),
)
function sample(setId: string, n = 200) {
  const out: { cardId: string; variant: string; isHit: boolean }[][] = []
  for (let i = 0; i < n; i++) {
    const cards = rollPack(setId, `finish-${setId}-${i}`, 'booster', 10)
    if (!cards) throw new Error(`no pull table for ${setId}`)
    out.push(cards)
  }
  db.prepare(`DELETE FROM pull_history WHERE session_id LIKE ?`).run(`finish-${setId}-%`)
  return out
}
const slotRows = (setId: string) =>
  db.prepare(`SELECT card_id, slot FROM pack_product_cards WHERE pack_product_id = ?`).all(`${setId}-booster`) as { card_id: string; slot: string }[]

for (const setId of ['base4', 'dp1', 'bw1', 'sm1', 'swsh1', 'sv1', 'me55']) {
  const pk = slotRows(setId)
  const r2 = new Set(pk.filter((r) => r.slot === 'reverse2hit').map((r) => r.card_id))
  const holoIds = new Set(pk.filter((r) => r.slot === 'holo').map((r) => r.card_id))
  const hitIds = new Set(pk.filter((r) => r.slot === 'hit').map((r) => r.card_id))
  const packs = sample(setId)
  const rareCards = packs.flatMap((p) => p.filter((c) => holoIds.has(c.cardId) || hitIds.has(c.cardId)))
  const foilWrong = rareCards.filter((c) => {
    const m = meta.get(c.cardId)
    const want = rareVariantFor(setId, m?.rarity ?? null)
    // WotC ghost stamps are a separate, explicit printing.
    return !/^1stEdition/.test(c.variant) && c.variant !== want
  })
  ok(rareCards.length > 0, `${setId}: rare-slot cards were drawn (${rareCards.length})`)
  ok(foilWrong.length === 0, `${setId}: every rare-slot card stores its finish (${rareCards.length - foilWrong.length}/${rareCards.length})`)
  const reverseCount = packs.map((p) => p.filter((c) => /^reverseHolofoil/.test(c.variant) || r2.has(c.cardId)).length)
  const plan = planFor(setId, 10)
  const reverseSlots = plan.filter((s) => s.slot === 'reverse' || s.slot === 'reverse2').reduce((a, s) => a + s.count, 0)
  ok(reverseCount.every((n) => n === reverseSlots), `${setId}: ${reverseSlots} reverse printing(s) per pack`)
}

console.log(failed === 0 ? `\nALL OK — ${passed} checks` : `\n${failed} FAILED of ${passed + failed}`)
process.exit(failed === 0 ? 0 : 1)
