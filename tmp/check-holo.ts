import { holoFor } from '../src/holo'

const cases: [string, string | null, string | null, string | null][] = [
  ['base1-4', null, 'Rare Holo', 'starfoil:false'],
  ['base2-1', null, 'Rare Holo', 'starfoil:false'],
  ['base4-4', null, 'Rare Holo', 'cosmos:false'],
  ['neo1-1', null, 'Rare Holo', 'cosmos:false'],
  ['bw1-1', 'holofoil', 'Rare Holo', 'tinsel:false'],
  ['xy1-1', null, 'Rare Holo', 'sheen:false'],
  ['g1-RC6', null, 'Common', null],
  ['bw11-RC1', null, 'Rare Ultra', 'radiant:false'],
  ['sm1-1', 'holofoil', 'Common', 'waterweb:false'],
  ['swsh1-1', 'holofoil', 'Rare Holo', 'line:false'],
  ['sv1-1', null, 'Rare', 'mirage:false'],
  ['sv8-25', null, 'Double Rare', 'etched:false'],
  ['sv3pt5-199', null, 'Special Illustration Rare', 'starlight:false'],
  ['mcd21-1', null, 'Common', 'confetti:false'],
  ['cel25-4', null, 'Rare Holo', 'confetti:false'],
  ['cel25c-4', null, 'Rare', 'confetti:false'],
  // EX Trainer Kits (2004-05) predate Cracked Ice: a prefix rule used to paint
  // them, and the researched answer is no claim at all.
  ['tk1a-1', null, 'Common', null],
  ['me55-100', null, 'Pikachu Rare', 'anniversary:false'],
  ['me55-12', null, 'Common', null],
  ['me55c-3', null, 'Pikachu Rare', 'confetti:false'],
  ['swsh4-50', 'reverseHolofoil', 'Rare', 'line:true'],
  ['sm12-1', 'reverseHolofoil', 'Common', 'waterweb:true'],
  ['sv8-2', 'reverseHolofoil', 'Common', 'mirage:true'],
  // Base, Jungle and Fossil predate reverse holos (Legendary Collection is the
  // first), so a marketplace flag cannot invent a reverse printing on them.
  ['base1-4', 'reverseHolofoil', 'Rare Holo', null],
]

let bad = 0
for (const [id, variant, rarity, want] of cases) {
  const art = holoFor({ cardId: id, variant, rarity })
  const got = art ? art.style + ':' + art.reverse : null
  const ok = got === want
  if (!ok) bad++
  console.log((id + '             ').slice(0, 17) + (String(variant ?? '-') + '               ').slice(0, 16) + (String(rarity) + '                            ').slice(0, 28) + ' -> ' + String(got) + (ok ? '' : '   EXPECTED ' + String(want)))
}
console.log(bad === 0 ? 'ALL OK (' + cases.length + ' cases)' : 'MISMATCHES: ' + bad)
process.exit(bad === 0 ? 0 : 1)
