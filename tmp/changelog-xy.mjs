import fs from 'node:fs'

const feature =
  "The XY line's sealed shelf has been rebuilt against the era's own product copy. Every main XY Elite Trainer Box now opens eight packs instead of nine — Pokémon.com's box copy and Bulbapedia's composition table both say eight — and the boxes are split by art where two shipped: Xerneas / Yveltal, Primal Groudon / Primal Kyogre, Mewtwo X / Mewtwo Y and Mega Charizard Y / Mega Blastoise. Roaring Skies, BREAKpoint and Steam Siege ETBs now sell at their TCGplayer quotes ($7,899.99, $1,099.99 and $1,800), while the two-art boxes whose listings carry no market price stay on the modelled price and say so. Three products that never existed are gone: no XY expansion shipped a six-pack Booster Bundle, the Kalos Starter Set was three 39-card decks, and Generations packs came only inside Mythical and Red & Blue collections. Generations' one real box is corrected to ten packs with the Shaymin-EX promo, Double Crisis's invented booster, display and ETB are refused (its seven-card packs came only in four-pack blisters), and the Evolutions display is back on the shelf where it belongs."

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
