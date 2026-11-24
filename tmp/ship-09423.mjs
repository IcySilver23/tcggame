import fs from 'node:fs'

const path = 'CHANGELOG.json'
const j = JSON.parse(fs.readFileSync(path, 'utf8'))

const prev = j.entries[0]
if (prev.version !== '0.94.22') throw new Error(`expected 0.94.22 on top, found ${prev.version}`)
prev.highlights = [prev.highlights[0]]

j.entries.unshift({
  version: '0.94.23',
  date: '2026-11-24',
  title: 'The rare slot knows how often it is holo',
  highlights: [
    'Every Wizards-to-HGSS pack prices its rare at the era’s holo rate — 1 in 3 packs — from the profile itself instead of trusting a pool average that only agreed by coincidence.',
    'The rate was already in the numbers: Base Set’s rare slot is $69 at 1 in 3 and $97 as one flat pool of the same 32 cards. It can no longer be normalised away by an edit.',
    'Nothing moves on the shelf: every modelled box with a sold median is still inside 3.2x, and a new check fails if the rate ever stops reaching the price.',
  ],
  features: [
    'The pull table was storing the split and the pack value was throwing it away. Each plain rare is filed at 0.66 divided by the number of plain rares and each holo rare at 0.34 divided by the holos — the era\'s rare split, 1 in 3 for the Wizards and EX years from pokegym\'s box study — but the rare slot then took a NORMALISED average of that pool, which divides by the summed weights. Those weights happen to sum to exactly 1, so the answer was right; one set that prints only one kind of rare, or one edited profile number, and the slot silently becomes a flat pool again with nothing to signal it. That is now impossible: `rareSlotValue` reads the era\'s rate from the profile and applies it to the two averages, and a set that prints no plain rare gets a rate of 1 because its rare cannot be anything else.',
    'The same function prices the sealed pack EV and the Pack Shop\'s own estimate, so the two cannot disagree about the rate the way an earlier pair disagreed about a wrapper. The change is invisible at the shelf because the numbers were already the rate model: the measured gap between this and a flat pool runs from 1% to 55% across the 46 pre-2011 sets that print both kinds of rare — Base Set $69 against $97, Gym Challenge $82 against $104, Neo Genesis $57 against $87, Aquapolis $154 against $180 — and four of those sets print holo rares cheaper than their plain ones, so there the rate lowers the slot rather than raising it.',
    'The modelled boxes do not move, which is the point of checking: the rare slot still feeds the same pack EV, so the box premium is still the measured 6.3x and every box with a sold median sits inside 3.2x of it. Where the rate itself comes from is unchanged and still uneven: 1 in 3 is counted for the Wizards and EX years, while Diamond & Pearl, HGSS and Black & White carry the era estimate the code has always labelled as an estimate.',
    'A new check re-derives the slot from the database without the helper, asserts the era figure, and re-checks the boxes against their sold medians — 97 assertions over the 46 sets — so a normalised pool cannot creep back in unnoticed.',
  ],
})

fs.writeFileSync(path, JSON.stringify(j, null, 2) + '\n')

let pkg = fs.readFileSync('package.json', 'utf8')
pkg = pkg.replace('"version": "0.94.22"', '"version": "0.94.23"')
fs.writeFileSync('package.json', pkg)

console.log('newest', j.entries[0].version, j.entries[0].highlights.length + 'h/' + j.entries[0].features.length + 'f', '| 0.94.22', j.entries[1].highlights.length + 'h', '| pkg', JSON.parse(pkg).version)
j.entries[0].highlights.forEach((h) => console.log(h.length, h.slice(0, 58)))
