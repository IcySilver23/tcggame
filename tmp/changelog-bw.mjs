import fs from 'node:fs'

const feature =
  "The Black & White shelf was rebuilt against the era's own products. Elite Trainer Boxes did not exist for every set: the line began with Plasma Storm, which held seven packs, and Plasma Blast added the eighth — the other ten BW boxes in the catalogue are gone. No Black & White expansion shipped a six-pack Booster Bundle either, so all of those rows are refused. Dragon Vault was never a normal set: its 21 cards came in five-card packs sold only inside three-pack blisters, so the standalone booster and the 36-pack display are refused and the blister is now its own openable product at three packs of five, priced at the exact blister's $1,995.90 TCGplayer market. Nine BW packs carry their own TCGplayer quotes too — $110 for Emerging Powers up to $651.13 for Plasma Storm — while the 36-pack displays have no published market and stay on the model. The blister's one-of-five Mirror Holofoil variant cards are a random accessory, not a fixed promo, so they are not handed over."

let text = fs.readFileSync('CHANGELOG.json', 'utf8')
const marker = '"features": ['
const at = text.indexOf(marker)
if (at < 0) throw new Error('features array not found')
const insertAt = at + marker.length
const indent = '\r\n        '
text = text.slice(0, insertAt) + indent + JSON.stringify(feature) + ',' + text.slice(insertAt)
fs.writeFileSync('CHANGELOG.json', text)
const parsed = JSON.parse(fs.readFileSync('CHANGELOG.json', 'utf8'))
console.log('version', parsed.entries[0].version, 'features', parsed.entries[0].features.length)
