// Hit odds: no rarity may ship on the generic 1-in-50 fallback.
//
// Run against a save (a copy of one):
//   TCGLIFE_HOME=$PWD/tmp/audit-home node ./node_modules/tsx/dist/cli.mjs tmp/check-hit-odds.ts
// or through the sealed suite, which resolves a save for you:
//   npm run check:sealed
//
// `buildPullTable` resolves a hit's weight through `tierOddsSource`, which tries
// the set's override, then its era profile, then the legacy table, and only then
// the generic 1-in-50 weight. That is how the Mega Hyper Rare tier sat at ten to
// thirty-six times its measured frequency across six sets before it was pinned,
// and how seven other tiers sat on the legacy table because their label never
// matched the researched one ("Rare Holo EX" against "Rare Holo ex",
// "MEGA_ATTACK_RARE" against "Mega Attack Rare").
//
// Every hit-slot rarity is classified by where its odds come from — `set` (a
// measured per-set row), `era` (the era profile), `table` (the legacy table, no
// era or set figure) or `generic` — and this fails on a generic weight, on any
// tier still resting on the legacy table, and on a stored pull table that
// disagrees with what the code resolves now, so neither an unresearched rate nor
// a stale save can pass silently.
//
// Writes reports/hit-odds-audit.{json,md} (or HIT_ODDS_REPORT_DIR). The report
// carries no timestamp, so re-running it on an unchanged save is byte-identical.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { db } from '../server/lib/db'
import { secondSlotUpgradeOdds } from '../server/services/packodds'
import { tierOddsSource, type TierOddsKind } from '../server/services/packs'

type SetRow = { id: string; name: string; release_date: string | null }
type Row = { slot: string; rarity: string | null; n: number; w: number }

type Kind = TierOddsKind
type AuditRow = {
  setId: string
  setName: string
  released: string
  slot: 'hit' | 'reverse2hit'
  rarity: string
  cards: number
  storedOdds: number
  codeOdds: number
  kind: Kind
  stale: boolean
}

const sets = db
  .prepare(
    `SELECT s.id, s.name, s.release_date FROM sets s
     WHERE EXISTS (SELECT 1 FROM pack_products p WHERE p.id = s.id || '-booster')
     ORDER BY s.release_date, s.id`,
  )
  .all() as SetRow[]

const rows: AuditRow[] = []

for (const s of sets) {
  const stored = db
    .prepare(
      `SELECT p.slot, c.rarity, COUNT(*) AS n, SUM(p.weight) AS w
       FROM pack_product_cards p JOIN cards c ON c.id = p.card_id
       WHERE p.pack_product_id = ? AND p.slot IN ('hit','reverse2hit')
       GROUP BY p.slot, c.rarity
       ORDER BY p.slot, w DESC, c.rarity`,
    )
    .all(`${s.id}-booster`) as Row[]
  if (stored.length === 0) continue

  const second = new Map(secondSlotUpgradeOdds(s.id).map((u) => [u.rarity.toLowerCase(), u.odds]))

  for (const r of stored) {
    const rarity = r.rarity ?? '(none)'
    const slot = r.slot as 'hit' | 'reverse2hit'
    // The shipped resolver, not a copy of it: this audit exists to catch a label
    // that stops matching its researched figure.
    const resolved = tierOddsSource(s.id, rarity)
    const codeOdds = slot === 'reverse2hit' ? (second.get(rarity.toLowerCase()) ?? 0) : resolved.odds
    const kind: Kind = slot === 'reverse2hit' ? (second.has(rarity.toLowerCase()) ? 'set' : 'generic') : resolved.kind
    rows.push({
      setId: s.id,
      setName: s.name,
      released: (s.release_date ?? '').slice(0, 10),
      slot,
      rarity,
      cards: r.n,
      storedOdds: Number(r.w.toFixed(4)),
      codeOdds: Number(codeOdds.toFixed(4)),
      kind,
      stale: Math.abs(r.w - codeOdds) > 1e-4,
    })
  }
}

const withRows = [...new Set(rows.map((r) => r.setId))]
if (withRows.length === 0) {
  console.log('hit odds: this save has no pull tables to audit; skipped')
  process.exit(0)
}

const generic = rows.filter((r) => r.kind === 'generic')
const fallback = rows.filter((r) => r.kind === 'table')
const stale = rows.filter((r) => r.stale)
const measuredSets = [...new Set(rows.filter((r) => r.kind === 'set').map((r) => r.setId))]
const fallbackSets = [...new Set(rows.filter((r) => r.kind === 'table').map((r) => r.setId))]

const md: string[] = []
md.push('# Hit-odds audit', '')
md.push(
  `${withRows.length} sets carry a hit pool; ${rows.length} rarity rows sit in a hit slot. ` +
    'Every one is classified by where its odds come from: **set** (a measured row for that set), ' +
    '**era** (the era profile) or **table** (the legacy fallback table, which is real but not this set\'s own figure).',
  '',
)
if (generic.length === 0) {
  md.push(
    '**No rarity falls through to the generic 1-in-50 weight**, which is the defect this check exists to catch: ' +
      'the Mega Hyper Rare tier had no row anywhere, so six sets dealt their gold cards at a flat 1 in 50 — ' +
      '11x too often at Ascended Heroes, about 20-25x at the one-in-a-thousand sets, and 36x at Perfect Order.',
    '',
  )
} else {
  md.push(`**${generic.length} rarity row(s) fall through to the generic 1-in-50 weight:**`, '')
  for (const r of generic) md.push(`- ${r.setId} ${r.rarity} (${r.slot})`)
  md.push('')
}
if (fallback.length === 0) {
  md.push(
    '**No hit tier rests on the legacy table either**: every rarity is dealt at a figure counted for its set ' +
      'or named for its era, so no set is running on a value someone picked for a different era.',
    '',
  )
} else {
  md.push(`**${fallback.length} rarity row(s) still rest on the legacy table:**`, '')
  for (const r of fallback) md.push(`- ${r.setId} ${r.rarity} (${r.slot}) at ${r.codeOdds}`)
  md.push('')
}
md.push(
  `- Sets with a measured per-set row: ${measuredSets.length}`,
  `- Sets relying on a fallback table row: ${fallbackSets.length}`,
  `- Stored weights that disagree with the current code: ${stale.length}`,
  '',
)
md.push('## What this found', '')
md.push(
  'The Mega Evolution line never had a Mega Hyper Rare tier in the era profile, and the legacy table did not carry ' +
    'one either, so me1 through me6 all dealt it at the 1-in-50 fallback. Each set now uses the TCGplayer ' +
    'Authentication Centre count for it: me1 1 in 1,260, me2 1 in 1,260, me2pt5 1 in 540, me3 1 in 1,786, ' +
    'me4 1 in 956, me5 1 in 1,081 and me6 1 in 1,000. Ascended Heroes also needed its own Mega Attack Rare ' +
    '(1 in 29) and the Ultra Rare rate that tier displaces (1 in 21).',
  '',
)
md.push(
  'Two older fallbacks were measured too and are pinned: Paldean Fates prints a Shiny Ultra Rare 1 in 13 packs ' +
    '(the 1-in-50 table value was 3.9x too rare) and a Shiny Rare 1 in 4, and Crown Zenith prints its secret ' +
    'rares 1 in 133 rather than 1 in 50.',
  '',
)
md.push(
  'The last sweep of every set pinned the tiers that were resting on the legacy table because no row had ever been ' +
    'researched for them, or because the catalogue spelled the tier differently from the row that existed. ' +
    'Seven were dealt at a figure 1.5x to 6x off the counted rate: EX-era ex cards 1 in 17 on the table (1 in 18 by ' +
    "the era's own figure, and Power Keepers was filed under Diamond & Pearl because the era rule read only the " +
    'release year), ACE SPEC 1 in 50 (1 in 18 at Boundaries Crossed, 1 in 24 at Plasma Storm), BREAK 1 in 33 ' +
    '(1 in 9 by PackRip, 1 in 12 by Flipside, 2-3 a box by owners), Shining Legends’ Shining cards 1 in 33 (1 in ' +
    '11.3), Shining Fates’ whole rare slot (its Pokémon V 1 in 9.2 against the era\'s 1 in 5.3, VMAX 1 in 18.4, full art 1 in 30.8, rainbow 1 in 84), Amazing Rare 5% (Vivid Voltage 1 in 17.5 and Shining Fates 1 in 17.4, each its own count), Radiant Rare 5% (1 in 20-22, unchanged in value but now ' +
    'named by its era), and Crown Zenith’s whole rare-slot ladder — V at half its counted rate (12.35% against 6%), ' +
    'full art at nearly double (1 in 35 against 1 in 20). Ascended Heroes’ Mega Attack Rare was researched but ' +
    'arrived in the catalogue labelled MEGA_ATTACK_RARE, so the 1-in-29 row never matched and it dealt at 1 in 50; ' +
    'label matching is now case- and separator-insensitive, which also fixes the EX-era spelling.',
  '',
)
md.push('## Every hit row', '')
md.push('| Set | Released | Slot | Rarity | Cards | Stored | Code | Source |')
md.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const r of rows) {
  md.push(
    `| ${r.setName} (${r.setId}) | ${r.released} | ${r.slot} | ${r.rarity} | ${r.cards} | ${r.storedOdds} | ${r.codeOdds} | ${r.kind} |`,
  )
}
md.push('')

const reportDir = resolve(process.env.HIT_ODDS_REPORT_DIR ?? 'reports')
mkdirSync(reportDir, { recursive: true })
writeFileSync(
  resolve(reportDir, 'hit-odds-audit.json'),
  JSON.stringify(
    {
      sets: withRows.length,
      rows: rows.length,
      generic: generic.length,
      stale: stale.length,
      setsWithMeasuredOdds: measuredSets,
      setsWithFallbackRows: fallbackSets,
      audit: rows,
    },
    null,
    2,
  ) + '\n',
)
writeFileSync(resolve(reportDir, 'hit-odds-audit.md'), md.join('\n'))

console.log(`hit odds: ${withRows.length} sets, ${rows.length} rows`)
console.log(`  generic 1-in-50 fallbacks: ${generic.length}`)
console.log(`  legacy-table rows: ${rows.filter((r) => r.kind === 'table').length}`)
console.log(`  stale stored weights: ${stale.length}`)
console.log(`  report: ${resolve(reportDir, 'hit-odds-audit.md')}`)
if (generic.length > 0 || fallback.length > 0 || stale.length > 0) {
  for (const r of rows.filter((r) => r.kind === 'generic' || r.kind === 'table' || r.stale)) {
    const flag = r.kind === 'generic' ? 'GENERIC' : r.kind === 'table' ? 'FALLBACK' : 'STALE'
    console.log(`  ${flag} ${r.setId} ${r.rarity} stored=${r.storedOdds} code=${r.codeOdds}`)
  }
  console.error('hit odds FAILED: a rarity is unresearched, still on the legacy table, or its pull table is stale')
  process.exit(1)
}
console.log('hit odds passed')
