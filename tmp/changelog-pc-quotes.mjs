import fs from 'node:fs'

const feature =
  "Every Pokémon Center Elite Trainer Box now sells at its own TCGplayer quote, not at a value guessed from the packs inside it. The twenty boxes that still used the pack model were the worst-priced items on the shelf: Paldea Evolved sat at $104 while the box trades near $590, 151 at $174 against $1,152, Destined Rivals at $84 against $403, and Ascended Heroes at $133 against $323. All 38 Pokémon Center boxes — Sword & Shield through 30th Celebration — now carry a marketplace number read on 8 November 2026, with the quote's listing photo used where a box had no art."

let text = fs.readFileSync('CHANGELOG.json', 'utf8')
const marker = '"features": ['
const at = text.indexOf(marker)
if (at < 0) throw new Error('features array not found')
const insertAt = at + marker.length
const indent = '\r\n        '
text =
  text.slice(0, insertAt) + indent + JSON.stringify(feature) + ',' + text.slice(insertAt)
fs.writeFileSync('CHANGELOG.json', text)
const parsed = JSON.parse(fs.readFileSync('CHANGELOG.json', 'utf8'))
console.log('version', parsed.entries[0].version, 'features', parsed.entries[0].features.length)
