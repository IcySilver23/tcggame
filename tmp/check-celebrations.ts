// Celebrations (cel25) is the set whose pull rates this fixes. Its real wrapper
// holds four foil cards in a fixed order: two main-set cards, a third that is a
// Classic Collection reprint in two packs of five (else another main-set card),
// and a fourth that is a main-set card or the set's upgrade — a V in 1 in 2.8
// packs, a VMAX in 1 in 13, the one full art in 1 in 25, the gold secret Mew in
// 1 in 150. Sources: Bleeding Cool's launch opening (the four slots, in order),
// thepricedex's aggregate pull rates, DigitalTQ's 541-pack tally.
//
// Runs against a COPY of the save (tmp/cel-home), so the real one is untouched:
//   node ./node_modules/tsx/dist/cli.mjs tmp/check-celebrations.ts
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const home = path.join(process.cwd(), 'tmp', 'cel-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
{
  const src = new Database(path.join(process.cwd(), 'data', 'tcglife.db'), { readonly: true })
  await src.backup(path.join(home, 'data', 'tcglife.db'))
  src.close()
}
process.env.TCGLIFE_HOME = home

const { db } = await import('../server/lib/db')
const sealed = await import('../server/services/sealed')
const packs = await import('../server/services/packs')
const odds = await import('../server/services/packodds')
const { repairCelebrationsSecrets } = await import('../server/catalog/rarity-repairs')

let checks = 0
function check(ok: boolean, message: string): void {
  checks++
  if (!ok) throw new Error(message)
}

sealed.ensureFullCatalog()
// Boot order: the rarity repair runs before the tables are built.
const repair = repairCelebrationsSecrets()
packs.buildPullTable('cel25', 4)
console.log(`rarity repair: ${repair.repaired} row(s) relabelled`)

// ---- 1. the catalogue row and the pack's shape ----------------------------
const mew = db.prepare('SELECT rarity FROM cards WHERE id = ?').get('cel25-25') as { rarity: string } | undefined
check(mew?.rarity === 'Secret Rare', `cel25-25 is labelled ${mew?.rarity ?? 'missing'}, not Secret Rare`)

const plan = odds.planFor('cel25', 4)
check(plan.reduce((a, s) => a + s.count, 0) === 4, `a Celebrations pack plans ${JSON.stringify(plan)}, not four cards`)
check(plan[0]?.slot === 'holo' && plan[0]?.count === 2, 'the first two cards are not main-set foils')
check(plan[1]?.slot === 'subset' && plan[1]?.count === 1, 'the third card is not the Classic Collection slot')
check(plan[2]?.slot === 'hit' && plan[2]?.count === 1, 'the fourth card is not the rare-or-hit slot')
check(!plan.some((s) => s.slot.startsWith('reverse')), 'the plan prints a reverse holo the set never had')

const slots = odds.packSlots('cel25', 4)
check(slots.length === 3 && slots.reduce((a, s) => a + s.count, 0) === 4, 'the shelf does not print the same four cards')
const classicSlot = slots.find((s) => s.slot === 'subset')
check(classicSlot?.label === 'Classic Collection', `the shelf calls the subset slot "${classicSlot?.label}"`)
check(/40%/.test(classicSlot?.detail ?? ''), `the shelf does not state the 40% reprint rate: "${classicSlot?.detail}"`)
check(/main-set foil rare/.test(classicSlot?.detail ?? ''), `the shelf claims a reverse-holo fallback: "${classicSlot?.detail}"`)

// ---- 2. the table the roller draws ---------------------------------------
const pools = db
  .prepare(`SELECT p.slot, COUNT(*) n, SUM(p.weight) w FROM pack_product_cards p
            WHERE p.pack_product_id = 'cel25-booster' GROUP BY p.slot`)
  .all() as { slot: string; n: number; w: number }[]
const pool = (slot: string) => pools.find((p) => p.slot === slot)
check(pool('subset')?.n === 25, `the Classic Collection pool holds ${pool('subset')?.n ?? 0} cards, not 25`)
check(Math.abs((pool('subset')?.w ?? 0) - 1) < 1e-9, 'the Classic Collection pool is not a flat 1-in-25 draw')
check(pool('holo')?.n === 17, `the main-set foil pool holds ${pool('holo')?.n ?? 0} cards, not 17`)
check(pool('hit')?.n === 8, `the hit pool holds ${pool('hit')?.n ?? 0} cards, not 8`)
const hitWeights = db
  .prepare(`SELECT c.rarity, SUM(p.weight) w FROM pack_product_cards p JOIN cards c ON c.id = p.card_id
            WHERE p.pack_product_id = 'cel25-booster' AND p.slot = 'hit' GROUP BY c.rarity`)
  .all() as { rarity: string; w: number }[]
const tier = (name: string) => hitWeights.find((h) => h.rarity === name)?.w ?? 0
check(Math.abs(tier('Rare Holo V') - 1 / 2.8) < 1e-6, `the V tier sums to ${tier('Rare Holo V')}, not 1 in 2.8`)
check(Math.abs(tier('Rare Holo VMAX') - 1 / 13) < 1e-6, `the VMAX tier sums to ${tier('Rare Holo VMAX')}, not 1 in 13`)
check(Math.abs(tier('Rare Ultra') - 1 / 25) < 1e-6, `the full-art tier sums to ${tier('Rare Ultra')}, not 1 in 25`)
check(Math.abs(tier('Secret Rare') - 1 / 150) < 1e-6, `the secret tier sums to ${tier('Secret Rare')}, not 1 in 150`)

// ---- 3. what the roller actually deals -----------------------------------
const N = Number(process.env.CELEBRATION_PACKS ?? 6000)
const own = new Set((db.prepare('SELECT id FROM cards WHERE set_id = ?').all('cel25') as { id: string }[]).map((r) => r.id))
const classic = new Set((db.prepare('SELECT id FROM cards WHERE set_id = ?').all('cel25c') as { id: string }[]).map((r) => r.id))
const tierOf = new Map(
  (db.prepare(`SELECT id, rarity FROM cards WHERE set_id = 'cel25'`).all() as { id: string; rarity: string }[]).map((r) => [r.id, r.rarity]),
)
let wrongSize = 0
let classicPacks = 0
let classicWrongSlot = 0
let foreign = 0
let reverseVariant = 0
let hostCards = 0
let plainFoils = 0
const hits = new Map<string, number>()
for (let i = 0; i < N; i++) {
  const pack = packs.rollPack('cel25', `celcheck-${i}`, 'booster', 4) ?? []
  if (pack.length !== 4) wrongSize++
  let sawClassic = false
  pack.forEach((card, at) => {
    if (/reverse/i.test(card.variant ?? '')) reverseVariant++
    if (classic.has(card.cardId)) {
      sawClassic = true
      if (at !== 2) classicWrongSlot++
    } else if (own.has(card.cardId)) {
      hostCards++
      const r = tierOf.get(card.cardId)
      if (r === 'Rare' || r === 'Rare Holo') plainFoils++
    } else foreign++
  })
  if (sawClassic) classicPacks++
  const last = pack[3]
  const r = last ? tierOf.get(last.cardId) : null
  if (r === 'Rare Holo V' || r === 'Rare Holo VMAX' || r === 'Rare Ultra' || r === 'Secret Rare') {
    hits.set(r, (hits.get(r) ?? 0) + 1)
  }
}
db.prepare('DELETE FROM pull_history WHERE session_id LIKE ?').run('celcheck-%')
const share = (n: number) => n / N
const near = (got: number, want: number, tol: number) => Math.abs(got - want) <= tol

check(wrongSize === 0, `${wrongSize} of ${N} packs did not hold four cards`)
check(foreign === 0, `${foreign} card(s) came from outside the set and its subset`)
check(reverseVariant === 0, `${reverseVariant} card(s) were dealt as a reverse printing`)
check(classicWrongSlot === 0, `${classicWrongSlot} Classic Collection card(s) landed outside the third slot`)
check(near(share(classicPacks), 0.4, 0.03), `a Classic Collection card lands in ${(share(classicPacks) * 100).toFixed(1)}% of packs, not 40%`)
check(near(hostCards / N, 3.6, 0.05), `main-set cards per pack read ${(hostCards / N).toFixed(2)}, not 3.6`)
// thepricedex counts 3.1 plain Rare Holo cards per pack, the upgrade tiers aside.
check(near(plainFoils / N, 3.12, 0.06), `plain main-set foils per pack read ${(plainFoils / N).toFixed(2)}, not 3.12`)
check(near(share(hits.get('Rare Holo V') ?? 0), 1 / 2.8, 0.04), `V in ${((hits.get('Rare Holo V') ?? 0) / N * 100).toFixed(1)}% of packs, not 1 in 2.8`)
check(near(share(hits.get('Rare Holo VMAX') ?? 0), 1 / 13, 0.025), `VMAX in ${((hits.get('Rare Holo VMAX') ?? 0) / N * 100).toFixed(1)}% of packs, not 1 in 13`)
check(near(share(hits.get('Rare Ultra') ?? 0), 1 / 25, 0.015), `full art in ${((hits.get('Rare Ultra') ?? 0) / N * 100).toFixed(1)}% of packs, not 1 in 25`)
check(near(share(hits.get('Secret Rare') ?? 0), 1 / 150, 0.008), `the gold Mew is in ${((hits.get('Secret Rare') ?? 0) / N * 100).toFixed(1)}% of packs, not 1 in 150`)

const ev = odds.expectedPackValue('cel25', 4)
const est = packs.estimatePackValue('cel25')
check(ev > 1, `expected pack value is $${ev.toFixed(2)}`)
check(est.avg > 1 && est.avg < 200, `the shop's estimate reads $${est.avg.toFixed(2)}`)

console.log(
  `PASS — ${checks} checks\n  ${N} packs: CC ${(share(classicPacks) * 100).toFixed(1)}% · ` +
  `V ${((hits.get('Rare Holo V') ?? 0) / N * 100).toFixed(1)}% · VMAX ${((hits.get('Rare Holo VMAX') ?? 0) / N * 100).toFixed(1)}% · ` +
  `UR ${((hits.get('Rare Ultra') ?? 0) / N * 100).toFixed(1)}% · secret ${((hits.get('Secret Rare') ?? 0) / N * 100).toFixed(2)}%` +
  `\n  EV $${ev.toFixed(2)} · shelf ${slots.map((s) => `${s.count} ${s.label}`).join(' + ')}`,
)
