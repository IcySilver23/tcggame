const fs = require('fs')
const entry = {
  version: '0.7.0',
  date: '2026-11-01',
  title: 'The desk cools down',
  features: [
    "The resale desk was the best money in the game by a distance — a repeatable 26% return every time capital went round, with no risk and no waiting. Sellers now ask more for their lots (52–95% of value for collections, up from 45–85%, and similar lifts for bulk, chases and storage finds), which brings an instant flip down to roughly 18%. Still a good business, no longer the only one worth running.",
    "Satellite shops were a trap: in thirty-day simulations, rent and wages came out over gross in almost every run, so buying a second location lost money while looking like progress. Rent is cut across every tier — the hole-in-the-wall to $4/day, storefront $11, flagship $20, region $46 — and the sim now shows healthy runs turning a profit. Weak managers still lose money, which is the intended lesson, but a competent one can now carry a door.",
    "Honest caveat: the shop fix is a first pass. Rent was the biggest single line I could move without redesigning the sales model, and several simulated runs still finish in the red — the remaining problem is revenue per walk-in, not overhead, and that deserves its own pass rather than another blunt rent cut.",
  ],
}
const file = 'CHANGELOG.json'
const src = fs.readFileSync(file, 'utf8')
if (src.includes('"version": "0.7.0"')) throw new Error('0.7.0 present')
const anchor = '  "entries": [\n'
const block = '    ' + JSON.stringify(entry, null, 2).split('\n').join('\n    ') + ',\n'
fs.writeFileSync(file, src.replace(anchor, anchor + block))
for (const p of ['package.json', 'package-lock.json']) {
  const json = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (p === 'package-lock.json' && json.packages && json.packages['']) json.packages[''].version = '0.7.0'
  json.version = '0.7.0'
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n')
}
console.log('changelog + version 0.7.0')
