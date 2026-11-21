import fs from 'node:fs'

const feature =
  "XY packs and displays now sell at what the marketplace charges for that exact wrapper or box, not at a value modelled from the cards inside. All twelve main-set booster packs carry a TCGplayer market read on 8 November 2026 — $33.65 for Steam Siege up to $229.72 for Phantom Forces — and seven of the twelve displays do too: Furious Fists $4,717.50, Roaring Skies $4,768.42, Ancient Origins $9,807.99, BREAKthrough $3,265.81, Fates Collide $2,754.99, Steam Siege $1,436.99 and Evolutions $2,707.61. The five displays whose TCGplayer listings publish no market — XY base, Flashfire, Phantom Forces, Primal Clash and BREAKpoint — deliberately stay on the model rather than borrowing another box's price. These are collector-market quotes for out-of-print sealed product, so a single XY pack now costs far more than its $3.99 sticker did."

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
