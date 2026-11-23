// Every set with a booster table, checked against the plan the roller deals.
//
// The ten-sample suite proves the eras; this sweeps the catalogue and names the
// sets that do not fit, so an outlier cannot hide behind a representative.
// Measured per set, over N packs:
//
//   size      cards/pack against the plan after empty-pool slots drop out
//   rare      the plan's rare slots, plus the one a subset miss deals when the
//             pack has no reverse printing to fall back to
//   hit       hit rate against the set's own summed hit weights, within 3σ
//   reverse   reverse printings against the era's reverse slots, or the host
//             subset's miss rate where the subset card sits on that position
//   energy    Basic Energy against the era profile, never two
//   order     each position sitting in the slot's own pool
//   variant   the finish a rare-slot card stores
//
// Writes reports/pack-structure.{json,md}. Run on a copy of the save:
//   TCGLIFE_HOME=$PWD/tmp/audit-home node ./node_modules/tsx/dist/cli.mjs tmp/check-pack-structure-all.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { rollPack, stadiumHalvesFor, stadiumPairOddsFor } from '../server/services/packs'
import { planFor, eraOf, profileFor, subsetChanceFor, subsetMissRule } from '../server/services/packodds'
import { rareVariantFor } from '../server/services/finish-odds'
import { isSpecialSet } from '../server/services/special-reverse'
import { sellsOwnPacks } from '../server/services/sealed'
import { db } from '../server/lib/db'

const N = Number(process.env.ALL_PACKS ?? 200)

type Issue = { kind: string; detail: string }
type Pools = { common: number; uncommon: number; holo: number; hit: number; energy: number; subset: number; phantom: number }
type Row = {
  setId: string
  name: string
  releaseDate: string
  era: string
  packs: number
  special: boolean
  msrp: number | null
  planTotal: number
  expectedTotal: number
  observedTotal: number
  pools: Pools
  hitExpected: number
  hitObserved: number
  hitSigma: number
  reverseSlots: number
  reverseObserved: number
  energySlots: number
  energyObserved: number
  energyMax: number
  rareMin: number
  rareMax: number
  notes: string[]
  issues: Issue[]
}

const allSets = db
  .prepare(
    `SELECT s.id, s.name, COALESCE(s.release_date, '') AS release_date
     FROM sets s
     WHERE EXISTS (SELECT 1 FROM pack_product_cards p WHERE p.pack_product_id = s.id || '-booster')
     ORDER BY s.release_date, s.id`,
  )
  .all() as { id: string; name: string; release_date: string }[]
// Subset-only sets have tables but no product of their own: they are not swept
// for pack shape because there is no wrapper to judge.
const unsold = allSets.filter((s) => !sellsOwnPacks(s.id)).map((s) => s.id)
const sets = allSets.filter((s) => sellsOwnPacks(s.id))

const rows: Row[] = []

for (const set of sets) {
  const setId = set.id
  const era = eraOf(setId)
  const profile = profileFor(setId)
  const special = isSpecialSet(setId)
  const poolRows = db
    .prepare(`SELECT card_id, slot, weight FROM pack_product_cards WHERE pack_product_id = ?`)
    .all(`${setId}-booster`) as { card_id: string; slot: string; weight: number }[]
  const by = (slot: string) => poolRows.filter((r) => r.slot === slot)
  const list = {
    common: by('common'),
    uncommon: by('uncommon'),
    holo: by('holo'),
    hit: by('hit'),
    energy: by('energy'),
    subset: by('subset'),
    phantom: by('phantom'),
  }
  const pools: Pools = {
    common: list.common.length,
    uncommon: list.uncommon.length,
    holo: list.holo.length,
    hit: list.hit.length,
    energy: list.energy.length,
    subset: list.subset.length,
    phantom: list.phantom.length,
  }
  const reversePoolSize = pools.common + pools.uncommon + (special ? pools.holo : 0)
  const hitChance = Math.min(0.85, list.hit.reduce((a, r) => a + Math.max(0, r.weight), 0))

  // Mirror rollPack's slot filtering: a slot with no pool drops out.
  const slots = planFor(setId, 10).filter((s) => {
    if (s.slot === 'holo') return pools.holo > 0
    if (s.slot === 'uncommon') return pools.uncommon > 0
    if (s.slot === 'reverse' || s.slot === 'reverse2') return reversePoolSize > 0
    if (s.slot === 'energy') return pools.energy > 0
    return true
  })
  if (pools.subset > 0 && !slots.some((s) => s.slot === 'subset')) slots.push({ slot: 'subset', count: 1 })

  const countOf = (slot: string) => slots.filter((s) => s.slot === slot).reduce((a, s) => a + s.count, 0)
  /** How many cards can fill this slot (0 means the slot deals nothing). */
  const sourceSize = (slot: string): number => {
    if (slot === 'common') return pools.common
    if (slot === 'uncommon') return pools.uncommon
    if (slot === 'reverse' || slot === 'reverse2') return reversePoolSize
    if (slot === 'energy') return pools.energy
    if (slot === 'subset') return pools.subset
    if (slot === 'phantom') return pools.phantom
    if (slot === 'holo') return pools.holo
    // The rare-or-hit slot falls back to an Energy, then to a reverse card.
    return pools.hit + pools.holo + pools.energy + reversePoolSize
  }
  // A table that holds nothing but hits (a Shiny Vault or Trainer Gallery) deals
  // a hit every time: the summed weights describe a rare slot, not a whole pack.
  // Slots whose pool is empty stay in the plan but deal nothing, so they do not
  // count towards the shape.
  const dealable = slots.filter((s) => sourceSize(s.slot) > 0)
  const soleHitSlot = dealable.length === 1 && dealable[0].slot === 'hit'
  // A table whose rare slot has no other pool to fall back to (a Shiny Vault or
  // Trainer Gallery) deals a hit every time, whatever the weights say; a table
  // with no hits at all can never deal one.
  const hitOnlyTable = pools.hit > 0 && pools.hit + pools.holo + pools.energy + reversePoolSize === pools.hit
  const expectedHitRate = hitOnlyTable ? 1 : hitChance
  const rareAvailable = pools.holo + pools.hit
  const expectedTotal = slots.reduce((a, s) => a + (sourceSize(s.slot) > 0 ? s.count : 0), 0)
  // A blueprint may ask for more than one rare card (Celebrations' four-card
  // pack is three rares plus a hit), so count every slot that draws from the
  // rare pools rather than assuming the standard single rare slot.
  const rareSlots = rareAvailable > 0 ? countOf('hit') + countOf('holo') : 0
  const reverseSlots = countOf('reverse') + countOf('reverse2')
  const energySlots = profile.energyInPack && pools.energy > 0 ? countOf('energy') : 0
  // The subset rule the roller deals, judged here as it ships: a host set's
  // missed reprint is a reverse printing (the slot it sits on), while a pack
  // with no reverse printing at all (Celebrations) deals a plain foil rare
  // instead — one more rare card than the plan's rare slots.
  const subsetSlots = countOf('subset')
  const subsetMiss = subsetMissRule(reversePoolSize > 0)
  const subsetMissRate = subsetSlots > 0 ? 1 - subsetChanceFor(setId) : 0
  const rareCeiling = rareSlots + (subsetMiss.pool === 'holo' ? subsetSlots : 0)
  // A Legendary Stadium half is dealt outside the pools and can stand in for any
  // non-hit card, the rare slot included, so it can cost the pack its rare and
  // can sit anywhere in the order.
  const stadiumIds = new Set(stadiumHalvesFor(setId))
  const rareFloor = rareSlots - (stadiumIds.size > 0 ? 1 : 0)
  // A pair is dealt after the pools and its halves are then swapped apart, so a
  // stadium pack can hold a pool's card out of position and can lose a reverse
  // slot's card to a half. A pair lands on a reverse slot in about half the
  // packs it appears in (two halves among the pack's non-hit positions).
  const stadiumPairOdds = stadiumPairOddsFor(setId)
  const reverseBySlots = 1 - stadiumPairOdds / 2

  const msrp = (db.prepare('SELECT msrp FROM pack_products WHERE id = ?').get(`${setId}-booster`) as { msrp: number | null } | undefined)?.msrp ?? null
  const rareIds = new Set([...list.holo, ...list.hit].map((r) => r.card_id))
  const r2Ids = new Set(by('reverse2hit').map((r) => r.card_id))
  const hitIds = new Set(list.hit.map((r) => r.card_id))
  const energyIds = new Set(list.energy.map((r) => r.card_id))
  const commonIds = new Set(list.common.map((r) => r.card_id))
  const uncommonIds = new Set(list.uncommon.map((r) => r.card_id))
  const subsetIds = new Set(list.subset.map((r) => r.card_id))
  const phantomIds = new Set(list.phantom.map((r) => r.card_id))
  /** Every card this set's pack may hold, Stadium halves included. */
  const memberIds = new Set([...commonIds, ...uncommonIds, ...rareIds, ...energyIds, ...subsetIds, ...r2Ids, ...stadiumIds])
  const rarityOf = new Map(
    (db.prepare(`SELECT id, rarity FROM cards WHERE set_id = ?`).all(setId) as { id: string; rarity: string | null }[]).map((r) => [r.id, r.rarity]),
  )

  let observedTotal = 0
  let hitPacks = 0
  let reversePacks = 0
  let energyPacks = 0
  let energyMax = 0
  let rareMin = Number.POSITIVE_INFINITY
  let rareMax = 0
  let orderFail = ''
  let variantFail = ''

  for (let i = 0; i < N; i++) {
    const cards = rollPack(setId, `allstruct-${setId}-${i}`, 'booster', 10)
    if (!cards) throw new Error(`no pull table for ${setId}`)
    const extra = cards.filter((c) => phantomIds.has(c.cardId)).length
    const pack = extra > 0 ? cards.slice(0, cards.length - extra) : cards
    observedTotal += pack.length

    const rareCount = pack.filter((c) => rareIds.has(c.cardId)).length
    rareMin = Math.min(rareMin, rareCount)
    rareMax = Math.max(rareMax, rareCount)
    if (pack.some((c) => hitIds.has(c.cardId))) hitPacks++
    const reverseCount = pack.filter((c) => /^reverseHolofoil/.test(c.variant ?? '')).length
    if (reverseCount > 0) reversePacks++
    const energies = pack.filter((c) => energyIds.has(c.cardId)).length
    if (energies > 0) energyPacks++
    energyMax = Math.max(energyMax, energies)

    // Order. A stadium set is judged on membership alone: its halves are dealt
    // after the pools and then swapped apart, so position no longer names a slot
    // (a former half's place can hold any card). Every other set walks the plan
    // in card order, because every position belongs to the slot it deals for.
    if (stadiumIds.size > 0) {
      const stranger = pack.find((c) => !memberIds.has(c.cardId))
      if (stranger) orderFail ||= `${stranger.cardId} is not in any of ${setId}'s pools`
    } else {
      let at = 0
      for (const s of slots) {
        if (sourceSize(s.slot) === 0) continue
        for (let k = 0; k < s.count; k++, at++) {
          const card = pack[at]
          if (!card) {
            orderFail ||= `pack ended before slot ${s.slot}`
            break
          }
          const ok =
            s.slot === 'common' ? commonIds.has(card.cardId)
              : s.slot === 'uncommon' ? uncommonIds.has(card.cardId)
                : s.slot === 'reverse' || s.slot === 'reverse2' ? special || /^reverseHolofoil/.test(card.variant ?? '') || (s.slot === 'reverse2' && r2Ids.has(card.cardId))
                  : s.slot === 'hit' ? rareAvailable === 0 || rareIds.has(card.cardId)
                    : s.slot === 'energy' ? energyIds.has(card.cardId)
                      : s.slot === 'subset' ? subsetIds.has(card.cardId) || (subsetMiss.pool === 'reverse' ? special || /^reverseHolofoil/.test(card.variant ?? '') : rareIds.has(card.cardId))
                        : true
          if (!ok) orderFail ||= `slot ${s.slot} position ${at} held ${card.cardId} (${card.variant})`
        }
      }
    }

    // The finish a rare-slot card stores. A special set's reverse upgrade is a
    // different slot's card, so it is not counted here.
    if (!special) {
      for (const card of pack) {
        if (!rareIds.has(card.cardId) || stadiumIds.has(card.cardId)) continue
        if (/^1stEdition/.test(card.variant ?? '')) continue
        const want = rareVariantFor(setId, rarityOf.get(card.cardId) ?? null)
        if (card.variant !== want) variantFail ||= `${card.cardId} stored ${card.variant}, expected ${want}`
      }
    }
  }
  db.prepare(`DELETE FROM pull_history WHERE session_id LIKE ?`).run(`allstruct-${setId}-%`)

  const observedTotalAvg = observedTotal / N
  const hitObserved = hitPacks / N
  const hitSigma = Math.sqrt((expectedHitRate * (1 - expectedHitRate)) / N)
  const issues: Issue[] = []
  if (Math.abs(observedTotalAvg - expectedTotal) > 0.001) issues.push({ kind: 'size', detail: `${observedTotalAvg.toFixed(2)} cards/pack against the plan's ${expectedTotal}` })
  if (rareSlots > 0 && !special && (rareMin < rareFloor || rareMax > rareCeiling)) issues.push({ kind: 'rare', detail: `rare-or-hit per pack ${rareMin}–${rareMax}, expected ${rareFloor === rareCeiling ? rareCeiling : `${rareFloor}–${rareCeiling}`}` })
  if (rareSlots === 0 && rareMax > 0) issues.push({ kind: 'rare', detail: `no rare slot, but ${rareMax} rare-or-hit per pack` })
  if (Math.abs(hitObserved - expectedHitRate) > 3 * hitSigma + 1e-9) issues.push({ kind: 'hit', detail: `${(hitObserved * 100).toFixed(1)}% against ${(expectedHitRate * 100).toFixed(1)}% (3σ ${(3 * hitSigma * 100).toFixed(1)}%)` })
  // A subset miss sits on the reverse position, so packs with no reverse slot
  // still carry one at exactly the miss rate — the roller's own rule, not a bug.
  const reverseExpected = reverseSlots > 0 ? reverseBySlots : subsetMiss.pool === 'reverse' ? subsetMissRate * subsetSlots : 0
  if (reverseSlots === 0 || (!special && reversePacks !== N)) {
    const reverseSigma = Math.sqrt((reverseExpected * (1 - reverseExpected)) / N)
    if (Math.abs(reversePacks / N - reverseExpected) > 3 * reverseSigma + 1e-9) {
      issues.push({ kind: 'reverse', detail: `${reversePacks}/${N} packs held a reverse, expected ${(reverseExpected * 100).toFixed(1)}%` })
    }
  }
  if (rareAvailable > 0 && energySlots === 0 && energyPacks > 0) issues.push({ kind: 'energy', detail: `${energyPacks}/${N} packs held a Basic Energy, expected none` })
  if (energySlots > 0 && energyPacks !== N) issues.push({ kind: 'energy', detail: `${energyPacks}/${N} packs held a Basic Energy` })
  if (energyMax > 1) issues.push({ kind: 'energy', detail: `${energyMax} Basic Energies in one pack` })
  if (orderFail) issues.push({ kind: 'order', detail: orderFail })
  if (variantFail) issues.push({ kind: 'variant', detail: variantFail })
  const notes: string[] = []
  if (rareAvailable === 0 && energyPacks > 0) notes.push('No rare printing in this table: the rare slot fills with a Basic Energy.')
  if (hitOnlyTable) notes.push('The rare slot has no non-hit pool to fall back to, so every card in the pack is a hit (the weights describe a rare slot, not the pack).')
  if (stadiumIds.size > 0) notes.push('Legendary Stadium halves are dealt after the pools and swapped apart, so this set is checked for pool membership rather than slot order, and its reverse count allows for the pair landing on a reverse slot.')

  rows.push({
    setId,
    name: set.name,
    releaseDate: set.release_date,
    era,
    packs: N,
    special,
    msrp,
    planTotal: slots.reduce((a, s) => a + s.count, 0),
    expectedTotal,
    observedTotal: Number(observedTotalAvg.toFixed(2)),
    pools,
    hitExpected: expectedHitRate,
    hitObserved,
    hitSigma,
    reverseSlots,
    reverseObserved: reversePacks / N,
    energySlots,
    energyObserved: energyPacks / N,
    energyMax,
    rareMin: rareMin === Number.POSITIVE_INFINITY ? 0 : rareMin,
    rareMax,
    notes,
    issues,
  })
}

// ---------------------------------------------------------------------------
// Retry a lone hit-rate flag at a larger sample before believing it. A 120-pack
// sweep is narrow enough that one unlucky draw can clear 3σ; the comment on the
// method promises this re-draw, and Neo Destiny is the case that needed it.
// ---------------------------------------------------------------------------
const RETRY_N = Number(process.env.RETRY_PACKS ?? 2000)
for (const row of rows) {
  if (row.issues.length !== 1 || row.issues[0].kind !== 'hit') continue
  const hitIds = new Set(
    (db.prepare(`SELECT card_id FROM pack_product_cards WHERE pack_product_id = ? AND slot = 'hit'`).all(`${row.setId}-booster`) as { card_id: string }[]).map((r) => r.card_id),
  )
  let hits = 0
  for (let i = 0; i < RETRY_N; i++) {
    const cards = rollPack(row.setId, `allstruct-retry-${row.setId}-${i}`, 'booster', 10)
    if (!cards) break
    if (cards.some((c) => hitIds.has(c.cardId))) hits++
  }
  db.prepare(`DELETE FROM pull_history WHERE session_id LIKE ?`).run(`allstruct-retry-${row.setId}-%`)
  const rate = hits / RETRY_N
  const sigma = Math.sqrt((row.hitExpected * (1 - row.hitExpected)) / RETRY_N)
  if (Math.abs(rate - row.hitExpected) <= 3 * sigma + 1e-9) {
    row.hitObserved = rate
    row.hitSigma = sigma
    row.issues = []
    row.notes.push(`The ${N}-pack hit count was a 3σ draw; a ${RETRY_N}-pack retry measured ${(rate * 100).toFixed(1)}%.`)
  } else {
    row.issues[0] = { kind: 'hit', detail: `${(rate * 100).toFixed(1)}% over ${RETRY_N} packs against ${(row.hitExpected * 100).toFixed(1)}% (3σ ${(3 * sigma * 100).toFixed(1)}%)` }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const eras = ['wotc', 'ex', 'dp', 'bw', 'sm', 'swsh', 'sv']
const eraSummary = eras.map((era) => {
  const list = rows.filter((r) => r.era === era)
  const packs = list.reduce((a, r) => a + r.packs, 0)
  const expected = list.reduce((a, r) => a + r.hitExpected * r.packs, 0)
  const observed = list.reduce((a, r) => a + r.hitObserved * r.packs, 0)
  return {
    era,
    sets: list.length,
    packs,
    hitExpected: packs ? expected / packs : 0,
    hitObserved: packs ? observed / packs : 0,
    setsWithIssues: list.filter((r) => r.issues.length > 0).length,
  }
})
const outliers = rows.filter((r) => r.issues.length > 0)
const gaps = rows.filter((r) => r.expectedTotal < r.planTotal)
const declared = rows.filter((r) => r.planTotal !== 10)

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const md: string[] = []
md.push('# Pack structure, every set')
md.push('')
md.push(`Swept ${rows.length} sets with a booster table, ${N} packs each (${rows.length * N} packs), against the plan the roller deals.`)
md.push('')
md.push('## By era')
md.push('')
md.push('| Era | Sets | Packs | Hit rate observed | Hit rate expected | Sets with issues |')
md.push('|---|---:|---:|---:|---:|---:|')
for (const e of eraSummary) md.push(`| ${e.era} | ${e.sets} | ${e.packs} | ${pct(e.hitObserved)} | ${pct(e.hitExpected)} | ${e.setsWithIssues} |`)
md.push('')
md.push('## Outliers')
md.push('')
if (outliers.length === 0) md.push('None: every set matched its plan, its hit weights and its era rule.')
else {
  md.push('| Set | Era | Issue | Detail |')
  md.push('|---|---|---|---|')
  for (const r of outliers) md.push(`| ${r.setId} | ${r.era} | ${r.issues.map((i) => i.kind).join(', ')} | ${r.issues.map((i) => i.detail).join('; ')} |`)
}
md.push('')
md.push('## Sets the pull table cannot fill')
md.push('')
md.push(`A blueprint that asks for fewer or more than ten cards is the era's shape, not a gap (${declared.length} sets here). These are the sets whose table is too thin to deal the shape it declares.`)
md.push('')
if (gaps.length === 0) md.push('None.')
else {
  md.push('| Set | Era | Sells for | Cards dealt | Declared shape | Empty pools |')
  md.push('|---|---|---:|---:|---:|---|')
  for (const r of gaps) {
    const empty = Object.entries(r.pools).filter(([, n]) => n === 0).map(([k]) => k).join(', ')
    md.push(`| ${r.setId} | ${r.era} | ${r.msrp == null ? '—' : `$${r.msrp.toFixed(2)}`} | ${r.expectedTotal} | ${r.planTotal} | ${empty || '—'} |`)
  }
}
md.push('')
md.push('## Notes')
md.push('')
const noted = rows.filter((r) => r.notes.length > 0)
if (noted.length === 0) md.push('None.')
else for (const r of noted) md.push(`- **${r.setId}** (${r.era}): ${r.notes.join(' ')}`)
md.push('')
md.push('## Not swept')
md.push('')
md.push(`Subset-only sets make no sealed product of their own, so their leftover tables are not judged as packs: ${unsold.join(', ') || 'none'}. Their cards stay in the catalogue; the shelf and the pack-battle picker do not offer them.`)
md.push('')
md.push('## Method')
md.push('')
md.push(`Each set is dealt ${N} packs. A wrong card count, a rare-or-hit count outside the plan's slots (plus the foil rare a subset miss deals where the pack prints no reverse), a hit rate outside 3σ, a reverse or Basic Energy that should not be there, a card out of its slot or a wrong finish is an outlier. A host subset's miss rate is measured where the subset card sits on the reverse position, and a Legendary Stadium half is allowed in any non-hit position because it is dealt outside the pools. With ${rows.length} sets, about ${(rows.length * 0.0027).toFixed(1)} three-sigma flags per sweep are expected from chance alone, so a flagged set is re-drawn at a larger N before it is believed.`)
md.push('')
md.push('## Per-set numbers')
md.push('')
md.push('| Set | Era | Hit observed | Hit expected | Reverse slots | Energy slots | Rare/pack |')
md.push('|---|---|---:|---:|---:|---:|---|')
for (const r of rows) md.push(`| ${r.setId} | ${r.era} | ${pct(r.hitObserved)} | ${pct(r.hitExpected)} | ${r.reverseSlots} | ${r.energySlots} | ${r.rareMin}–${r.rareMax} |`)

mkdirSync('reports', { recursive: true })
writeFileSync('reports/pack-structure.json', JSON.stringify({ n: N, eraSummary, rows }, null, 2))
writeFileSync('reports/pack-structure.md', md.join('\n') + '\n')

console.log(`sets: ${rows.length}  packs: ${rows.length * N}  sets with issues: ${outliers.length}`)
for (const e of eraSummary) console.log(`  ${e.era.padEnd(5)} sets ${String(e.sets).padStart(3)}  hit ${pct(e.hitObserved)} vs ${pct(e.hitExpected)}  issues ${e.setsWithIssues}`)
for (const r of outliers.slice(0, 40)) console.log(`  OUTLIER ${r.setId} (${r.era}) ${r.issues.map((i) => `${i.kind}: ${i.detail}`).join(' | ')}`)
console.log('shortfalls (table cannot fill its shape):', gaps.length)
for (const r of gaps) console.log(`  SHORT ${r.setId} deals ${r.expectedTotal} of ${r.planTotal} pools ${JSON.stringify(r.pools)}`)
console.log('notes:', rows.filter((r) => r.notes.length > 0).map((r) => r.setId).join(' '))
console.log('report: reports/pack-structure.{json,md}')
process.exit(outliers.length === 0 ? 0 : 1)
