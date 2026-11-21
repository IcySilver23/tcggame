// Ascended Heroes' assigned reverse papers.
//
// Run: ./node_modules/.bin/tsx tmp/check-ascended-balls.ts
//
// The set does not roll a ball. Every regular Pokémon carries one specific paper
// — Poké Ball, Love Ball, Friend Ball, Quick Ball or Dusk Ball — and Team
// Rocket's Pokémon carry an R instead. This suite proves the assignment is
// complete and matches the published breakdown, that the renderer resolves a
// card to its own paper, that a wrong token cannot repaint it, and that the
// game-side table agrees with the renderer.
//
// Read-only: it never rolls a pack or writes a row.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { holoFor } from '../src/holo'
import { foilMaskFor } from '../src/foil/mask'
import { PATTERNS } from '../src/foil/patterns'
import {
  ASCENDED_ART_RECT,
  ASCENDED_BALL_GEOMETRY,
  ASCENDED_ASSIGNMENTS,
  ASCENDED_PUBLISHED_COUNTS,
  ASCENDED_SET_ID,
  BALL_STAMPS,
  STAMP_IDS,
  ascendedNumberFor,
  ascendedPatternFor,
  ascendedStampFor,
  ascendedVariantFor,
} from '../src/foil/ball-stamps'
import {
  SPECIAL_REVERSE_SETS,
  specialBallFor,
  specialReverseFor,
  specialReverseFieldFor,
} from '../src/foil/reverse-special'
import { SPECIAL_REVERSE_ASSETS } from '../src/foil/reverse-special-index'
import type { CosmosGrid } from '../src/foil/cosmos'
import {
  ASSIGNED_STAMP_PRINTINGS,
  ballEligible,
  specialBallFor as gameBallFor,
  specialSlotChancesFor,
} from '../server/services/special-reverse'

let pass = 0
let fail = 0
function ok(cond: boolean, msg: string, extra = '') {
  if (cond) {
    pass++
    console.log(`  ok   ${msg}`)
  } else {
    fail++
    console.log(`  FAIL ${msg}${extra ? ` — ${extra}` : ''}`)
  }
}

// ---------------------------------------------------------------------------
// The table is complete, and it is the published breakdown
// ---------------------------------------------------------------------------
const ASSIGNED: readonly string[] = ['pokeball', 'loveball', 'friendball', 'quickball', 'duskball', 'teamrocket']

ok(ASCENDED_ASSIGNMENTS.size === 140, `the table covers 140 regular Pokémon`, String(ASCENDED_ASSIGNMENTS.size))
ok(ASCENDED_ASSIGNMENTS.size === new Set(ASSIGNED_ASSIGNMENTS_NUMBERS()).size, 'no collector number is assigned twice')

function ASSIGNED_ASSIGNMENTS_NUMBERS(): number[] {
  return [...ASCENDED_ASSIGNMENTS.keys()]
}

for (const stamp of STAMP_IDS) {
  const numbers = [...ASCENDED_ASSIGNMENTS.entries()].filter(([, s]) => s === stamp).map(([n]) => n)
  const published = ASCENDED_PUBLISHED_COUNTS[stamp]
  ok(numbers.length === published, `${BALL_STAMPS[stamp].label}: ${numbers.length} cards against the published ${published}`, String(numbers.length))
  ok(numbers.every((n) => n >= 1 && n <= 179), `${BALL_STAMPS[stamp].label}: every number is in the main set`)
}

ok(ASCENDED_PUBLISHED_COUNTS.masterball === 0, 'Ascended Heroes prints no Master Ball paper')
ok([...ASCENDED_ASSIGNMENTS.values()].every((s) => s !== 'masterball'), 'and the table assigns none')

// ---------------------------------------------------------------------------
// The table agrees with the cards the save actually holds
// ---------------------------------------------------------------------------
type Row = { id: string; number: string; name: string; supertype: string | null; subtypes: string | null }
const db = new Database('data/tcglife.db', { readonly: true })
const rows = db
  .prepare('select id, number, name, supertype, subtypes from cards where set_id = ?')
  .all(ASCENDED_SET_ID) as Row[]
db.close()

const has = (subtypes: string | null, name: string): boolean => {
  try {
    const list = JSON.parse(subtypes ?? '[]') as string[]
    return Array.isArray(list) && list.includes(name)
  } catch {
    return false
  }
}

const regular = rows.filter((r) => Number(r.number) <= 179 && !has(r.subtypes, 'ex'))
ok(regular.length === 140, `the set holds 140 regular Pokémon`, String(regular.length))
ok(regular.every((r) => ascendedStampFor(r.id)), 'every regular Pokémon resolves to a stamp')
ok(regular.every((r) => r.supertype === 'Pokémon'), 'and all of them are Pokémon')

const exCards = rows.filter((r) => has(r.subtypes, 'ex'))
ok(exCards.length > 0 && exCards.every((r) => ascendedStampFor(r.id) === null), `no Pokémon ex carries a stamp (${exCards.length} checked)`)

const trainers = rows.filter((r) => r.supertype === 'Trainer')
ok(trainers.length > 0 && trainers.every((r) => ascendedStampFor(r.id) === null), `no Trainer carries a ball paper (${trainers.length} checked)`)

const teamRocket = regular.filter((r) => /^Team Rocket/i.test(r.name))
ok(teamRocket.length === 10, `the set prints ten Team Rocket Pokémon`, String(teamRocket.length))
ok(teamRocket.every((r) => ascendedStampFor(r.id) === 'teamrocket'), 'every Team Rocket Pokémon carries the R, never a ball')
const rCards = [...ASCENDED_ASSIGNMENTS.entries()].filter(([, s]) => s === 'teamrocket').map(([n]) => n).sort((a, b) => a - b)
ok(rCards.join(',') === '18,19,77,78,97,100,101,126,127,161', 'the R belongs to exactly the Team Rocket numbers', rCards.join(','))

// Every stamp is shared down an evolution line, which is why the table can be
// spot-checked: Wurmple's line is Love, Chikorita's is Friend, Grubbin's is Quick.
const byNumber = (n: number) => rows.find((r) => Number(r.number) === n)
for (const [label, numbers, stamp] of [
  ['Wurmple line', [11, 12, 13, 14, 15], 'loveball'],
  ['Chikorita line', [8, 9], 'friendball'],
  ['Grubbin', [17], 'quickball'],
  ['Sneasel line', [44, 45], 'duskball'],
  ['Erika’s line', [1, 2], 'pokeball'],
] as const) {
  ok(numbers.every((n) => ascendedStampFor(byNumber(n)?.id) === stamp), `${label} carries ${BALL_STAMPS[stamp].label}`)
}

// ---------------------------------------------------------------------------
// The renderer paints the card's own paper
// ---------------------------------------------------------------------------
ok(ascendedNumberFor('me2pt5-11') === 11, 'a card id resolves to its collector number')
ok(ascendedNumberFor('me2pt5-218') === null, 'a secret rare is outside the assigned main set')
ok(ascendedNumberFor('sv8pt5-11') === null, 'another set is not Ascended Heroes')
ok(ascendedNumberFor(null) === null, 'no card id makes no claim')

for (const stamp of ASSIGNED) {
  const id = `me2pt5-${[...ASCENDED_ASSIGNMENTS.entries()].find(([, s]) => s === stamp)![0]}`
  const pattern = ascendedPatternFor(id)
  ok(pattern === BALL_STAMPS[stamp].pattern, `${id} resolves to ${pattern}`)
  const art = holoFor({ cardId: id, rarity: 'Common', variant: ascendedVariantFor(id) })
  ok(art?.reverse === true && art.pattern === BALL_STAMPS[stamp].pattern, `${id} renders its assigned paper`)
  const asset = pattern ? SPECIAL_REVERSE_ASSETS[pattern] : undefined
  ok(!!asset && asset.ball === stamp, `${pattern} is registered as ${stamp}`)
  ok(!!asset && fs.existsSync('public' + asset.texture), `${pattern} texture ships`, asset?.texture)
  ok(!!PATTERNS[pattern!]?.implemented, `${pattern} is an implemented pattern row`)
  ok(Math.abs((asset?.largeDiameter ?? 0) - ASCENDED_BALL_GEOMETRY.diameter) < 0.005,
    `${pattern} draws the photographed 0.434-card-width ring`, String(asset?.largeDiameter))
  const row = specialReverseFor(ASCENDED_SET_ID, BALL_STAMPS[stamp].variant)
  ok(row?.pattern === BALL_STAMPS[stamp].pattern, `the printing table gives ${stamp} its own row`)
}

// A card's own paper wins over a token that names another ball: the printing
// decides, so a stale row cannot repaint a card that never wore that ball.
const loveCard = 'me2pt5-11'
const wrongToken = holoFor({ cardId: loveCard, rarity: 'Common', variant: 'reverseHolofoilQuickBall' })
ok(wrongToken?.pattern === BALL_STAMPS.loveball.pattern, 'a mismatched token still paints the card’s assigned paper')
const plain = holoFor({ cardId: loveCard, rarity: 'Common', variant: 'reverseHolofoil' })
ok(plain?.pattern !== BALL_STAMPS.loveball.pattern, 'a plain reverse does not become a ball paper')

// The measured geometry is the set's, not Prismatic's: the two share a design but
// not a sheet, so a correction to one cannot silently resize the other.
ok(Math.abs((SPECIAL_REVERSE_ASSETS['reverse-pokeball-assigned-large']?.largeDiameter ?? 0) - ASCENDED_BALL_GEOMETRY.diameter) < 0.005,
  'the Ascended Poké Ball sheet draws the photographed ring')
ok((SPECIAL_REVERSE_ASSETS['reverse-pokeball-large']?.largeDiameter ?? 0) < 0.42,
  'Prismatic keeps its own measured ball size',
  String(SPECIAL_REVERSE_ASSETS['reverse-pokeball-large']?.largeDiameter))
ok(SPECIAL_REVERSE_ASSETS['reverse-pokeball-large']?.evidence.label !== SPECIAL_REVERSE_ASSETS['reverse-pokeball-assigned-large']?.evidence.label,
  'and cites its own reference rather than the Ascended photograph')

ok(specialReverseFor(ASCENDED_SET_ID, 'reverseHolofoilMasterBall') === null, 'Ascended Heroes invents no Master Ball printing')
ok(specialBallFor('reverseHolofoilTeamRocket') === 'teamrocket', 'the R token is recognised as its own stamp')
ok(specialBallFor('reverseHolofoilLoveBall') === 'loveball', 'a Love Ball token parses back to the ball')
ok(gameBallFor('reverseHolofoilTeamRocket') === 'teamrocket', 'the game parses the R token too')

// ---------------------------------------------------------------------------
// Coverage: the body, around the set's own measured window
// ---------------------------------------------------------------------------
const loveMask = foilMaskFor({ cardId: loveCard, rarity: 'Common', variant: 'reverseHolofoilLoveBall' })
ok(loveMask?.kind === 'outsideArt', 'a ball paper foils the body, not the illustration')
ok(loveMask?.rect.x === ASCENDED_ART_RECT.x && loveMask?.rect.h === ASCENDED_ART_RECT.h,
  'it uses the Ascended Heroes window, not the shared base-set one',
  JSON.stringify(loveMask?.rect))
ok(specialReverseFor(ASCENDED_SET_ID, BALL_STAMPS.loveball.variant)?.artRect?.h === ASCENDED_ART_RECT.h,
  'the printing row carries the same window')

// A tiny synthetic disc proves where the sampler puts the stamp. The sheet's own
// ball sits at (centerU, centerV) = (0.5, 0.675), so a disc there must reach the
// card at v = 0.675 and must not bleed to the card's upper half.
const SIZE = 128
const mark = new Float32Array(SIZE * SIZE)
const opacity = new Float32Array(SIZE * SIZE)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = (x + 0.5) / SIZE - 0.5
    const dy = (y + 0.5) / SIZE - 0.675
    if (Math.hypot(dx, dy) <= 0.05) {
      mark[y * SIZE + x] = 1
      opacity[y * SIZE + x] = 1
    }
  }
}
const grid: CosmosGrid = { size: SIZE, mark, opacity, peak: 1, coverage: 0.01 }
const field = specialReverseFieldFor(loveCard, SPECIAL_REVERSE_ASSETS[BALL_STAMPS.loveball.pattern]!, grid)
ok(field.label.includes('Love Ball'), `the field names the paper (${field.label})`)
ok(field.mark(0.5, 0.675) > 0.5, 'the stamp lands about 0.675 down the card')
for (const v of [0.5, 0.58, 0.78, 0.86]) ok(field.mark(0.5, v) < 0.1, `no ink at v=${v} away from the stamp`)
ok(field.meta.ball === 'loveball' && field.meta.reproduction === 'procedural reconstruction',
  'the field is honest about being a drawing')

// ---------------------------------------------------------------------------
// The game-side table mirrors the renderer
// ---------------------------------------------------------------------------
const assigned = ASSIGNED_STAMP_PRINTINGS[0]
ok(!!assigned && assigned.setId === ASCENDED_SET_ID, 'the game knows the set assigns stamps')
ok(assigned.stamps.length === 6, 'it mirrors six papers', String(assigned.stamps.length))
for (const s of assigned.stamps) {
  ok(s.pattern === BALL_STAMPS[s.stamp].pattern, `${s.stamp} pattern agrees with the renderer`)
  ok(s.variant === BALL_STAMPS[s.stamp].variant, `${s.stamp} variant agrees with the renderer`)
  ok(s.printed === ASCENDED_PUBLISHED_COUNTS[s.stamp], `${s.stamp} published count is carried through`)
}
ok(SPECIAL_REVERSE_SETS.filter((s) => s.setId === ASCENDED_SET_ID).length === 6,
  'the renderer has one row per paper, and no Master Ball row')

const chances = specialSlotChancesFor(ASCENDED_SET_ID, 'second')
ok(chances?.balls.length === 0 && Math.abs((chances?.assigned ?? 0) - 0.8731) < 1e-9,
  'the slot carries an assigned paper at 87.31%, not a rolled ball')
ok(specialSlotChancesFor(ASCENDED_SET_ID, 'first')?.assigned === 0, 'the first slot never carries a stamp')

const trCard = 'me2pt5-18'
ok(ballEligible('teamrocket', { supertype: 'Pokémon', subtypes: '["Basic"]' }, trCard), 'the R fits a Team Rocket Pokémon')
ok(!ballEligible('pokeball', { supertype: 'Pokémon', subtypes: '["Basic"]' }, trCard), 'a Poké Ball does not fit a Team Rocket card')
ok(!ballEligible('loveball', { supertype: 'Pokémon', subtypes: '["Basic"]' }, 'me2pt5-1'), 'a Love Ball does not fit a Poké Ball card')
ok(ballEligible('loveball', { supertype: 'Pokémon', subtypes: '["Basic"]' }, loveCard), 'a Love Ball fits its own card')
ok(!ballEligible('duskball', { supertype: 'Pokémon', subtypes: '["ex"]' }, 'me2pt5-44'), 'no stamp fits a Pokémon ex')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
