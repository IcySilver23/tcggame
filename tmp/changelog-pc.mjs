import fs from 'node:fs'

const features = [
  "The two-art Pokémon Center boxes are separate products now. Chilling Reign, Evolving Skies, Scarlet & Violet, Paradox Rift, Temporal Forces and Mega Evolution each shipped their Pokémon Center Elite Trainer Box in two arts, and the catalogue carried one row with one quote and a note naming the other version's price. Each art is its own box on the shelf, with its own photo and its own TCGplayer quote read on 8 November 2026: Chilling Reign $209.63 Ice Rider and $191.93 Shadow Rider, Evolving Skies $1,087.99 Jolteon art and $1,127.56 Glaceon art, Scarlet & Violet $286.56 Koraidon and $316.89 Miraidon, Paradox Rift $188.73 Iron Valiant and $205.75 Roaring Moon, Temporal Forces $197.48 Iron Leaves and $212.81 Walking Wake, and Mega Evolution $177.19 Mega Gardevoir and $194.26 Mega Lucario. The original row keeps the first art, so any stock already in a save stays where it was.",
  "Each split box now carries the promo printed on its own art instead of a one-of draw between the pair. The Koraidon box seals Koraidon and the Miraidon box Miraidon; Iron Valiant seals Iron Bundle while Roaring Moon seals Scream Tail; Iron Leaves seals Iron Thorns while Walking Wake seals Flutter Mane; Mega Gardevoir seals Alakazam and Mega Lucario seals Riolu. Every one of those boxes holds the card twice, plain and with the Pokémon Center logo, and the stamp is still not modelled as a separate paper, so the box hands the card over once.",
]

let text = fs.readFileSync('CHANGELOG.json', 'utf8')
const marker = '"features": ['
const at = text.indexOf(marker)
if (at < 0) throw new Error('features array not found')
const insertAt = at + marker.length
const indent = '\r\n        '
text =
  text.slice(0, insertAt) + indent + features.map((f) => JSON.stringify(f)).join(',' + indent) + ',' + text.slice(insertAt)
fs.writeFileSync('CHANGELOG.json', text)
const parsed = JSON.parse(fs.readFileSync('CHANGELOG.json', 'utf8'))
console.log('version', parsed.entries[0].version, 'features', parsed.entries[0].features.length)
