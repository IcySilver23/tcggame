import fs from 'node:fs'

const path = 'CHANGELOG.json'
const j = JSON.parse(fs.readFileSync(path, 'utf8'))

const prev = j.entries[0]
if (prev.version !== '0.94.21') throw new Error(`expected 0.94.21 on top, found ${prev.version}`)
prev.highlights = [prev.highlights[0]]

j.entries.unshift({
  version: '0.94.22',
  date: '2026-11-24',
  title: 'A modelled box is sized like a box',
  highlights: [
    'Modelled boxes stopped being charged scarcity twice: Gym Challenge reads $26,910 instead of $51,158 against its $13,000 sold median, and Black & White’s boxes no longer sell at a fifth of theirs.',
    'A box now costs its pulls times a measured 6.3x premium — the median across the 25 boxes that have a real price — which keeps every modelled box with evidence within 3.2x of what it sold for.',
    'Black & White’s $187.99 pack is priced at its quote at last: the wrapper screen had refused it as a box-sized price against a box the old model made five times too cheap.',
  ],
  features: [
    'The old display formula was `min(pulls, 700 × curve) × curve`: the out-of-print curve was applied twice, and the 700 ceiling was invented rather than measured. Anything older than a decade therefore multiplied its card value by 12 twice over, with a hard ceiling of $100,800, which is why Gym Challenge read $51,158 against a $13,000 box and Spell of the Unown read $83,939 against $18,863. On the other side of the same bug a 2011 cut-off called every Black & White box "modern, so it trades at its contents", and those boxes are worth 2x to 5x their contents — Plasma Storm was modelled at $1,299 against a $6,000 sold median, Black & White at $316 against $2,500.',
    'The replacement is measured. 25 displays have a real price — the eighteen researched PriceCharting values, three TCGplayer markets, and the sold medians of four pages whose quotes were refused — and a box costs between 1.4x and 18.5x the card value of its thirty-six packs, median 6.28x. A grid over the ceiling and the ramp settles on 6.3x ramped in over 36 months of being out of print, applied once. Every box with evidence now lands within 3.2x of its real price (geometric 1.27x), where the old curve was off by as much as 8.7x.',
    'Two honest limits. The spread is real and no formula removes it: a box runs ahead of its pulls by however much its set is loved, so two sets both twelve years out of print read 1.4x and 7.3x, and a modelled box is good to a factor of two or three rather than to the dollar — the badge still says estimated, and any real quote wins over this. And the release audit used to forbid any modern modelled product from costing more than its contents; that bar now allows a display up to the measured premium, because the old bar was the assumption this release disproved. A runaway model still fails it.',
    'One price moves for a reason that is worth knowing: Black & White’s loose pack is $187.99 on TCGplayer (product 98553, box $3,569) and had been refused as a "box-sized" wrapper — the box it was measured against was the $656 that the twice-charged model produced. It now sells at its quote. Plasma Storm’s $651.13 wrapper is still refused: at 3.3x its box per pack it breaks the wrapper band, and that pack falls back to its model.',
  ],
})

fs.writeFileSync(path, JSON.stringify(j, null, 2) + '\n')

let pkg = fs.readFileSync('package.json', 'utf8')
pkg = pkg.replace('"version": "0.94.21"', '"version": "0.94.22"')
fs.writeFileSync('package.json', pkg)

console.log('newest', j.entries[0].version, j.entries[0].highlights.length + 'h/' + j.entries[0].features.length + 'f', '| 0.94.21', j.entries[1].highlights.length + 'h', '| pkg', JSON.parse(pkg).version)
j.entries[0].highlights.forEach((h) => console.log(h.length, h.slice(0, 58)))
