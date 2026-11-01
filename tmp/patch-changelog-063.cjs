const fs = require('fs')

const entry = {
  version: '0.6.3',
  date: '2026-11-01',
  title: 'The zoom reaches the Trading Post',
  features: [
    "Every card on the Trading Post zooms now. The trader binder grid and the card chips in both sides of an offer were plain images — no preview on hover, and clicking them did nothing — while the same art zoomed and opened the full sheet everywhere else in the game. Both now use the standard card image, so hovering a trader's card pops the enlarged art with its name and clicking it opens the card detail. Verified on the live page: 8 of 8 binder cards and 6 of 6 offer chips armed, the hover preview naming Raikou and Xatu respectively.",
  ],
}

const file = 'CHANGELOG.json'
const src = fs.readFileSync(file, 'utf8')
if (src.includes('"version": "0.6.3"')) throw new Error('0.6.3 entry already present')
const anchor = '  "entries": [\n'
if (!src.includes(anchor)) throw new Error('entries anchor missing')
const block = '    ' + JSON.stringify(entry, null, 2).split('\n').join('\n    ') + ',\n'
fs.writeFileSync(file, src.replace(anchor, anchor + block))
const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
console.log('changelog ok — entries:', parsed.entries.length, '| newest:', parsed.entries[0].version)

for (const p of ['package.json', 'package-lock.json']) {
  if (!fs.existsSync(p)) continue
  const json = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (p === 'package-lock.json' && json.packages && json.packages['']) json.packages[''].version = '0.6.3'
  json.version = '0.6.3'
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n')
  console.log('bumped', p)
}
