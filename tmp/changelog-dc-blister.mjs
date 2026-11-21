import fs from 'node:fs'

const feature =
  "Double Crisis can be opened again. Instead of refusing the set's invented booster, display and ETB, the shelf now carries the product that actually existed: a four-pack blister of seven-card packs. Opening it deals 28 cards across four wrappers, and it sells for $1,715.52 — four times the single pack's $428.88 TCGplayer market, because no blister quote exists, so the price is derived rather than listed. The blister's pin and coin are accessories and are not modelled. While wiring the seven-card pack, special products now honour their own declared card count instead of assuming ten, which also corrects the 30th Celebration collections to their six-card packs."

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
