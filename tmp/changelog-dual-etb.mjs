import fs from 'node:fs'

const feature =
  "Eight regular Elite Trainer Boxes that shipped in two arts are now two SKUs each, so the box you buy is the box you see: Sun & Moon (Solgaleo / Lunala), Ultra Prism (Dawn Wings / Dusk Mane Necrozma), Sword & Shield (Zacian / Zamazenta), Battle Styles (Single Strike / Rapid Strike Urshifu), Chilling Reign (Ice Rider / Shadow Rider Calyrex), Evolving Skies (the two Eeveelution four-packs), Paradox Rift (Iron Valiant / Roaring Moon) and Temporal Forces (Walking Wake / Iron Leaves). Each art carries its own TCGplayer quote read on 8 November 2026 — Sun & Moon is $248.05 / $246.84, Ultra Prism $780.99 / $760.77, Evolving Skies $546.57 / $456.06 — and its own box photo, instead of one row priced from the pack model. The original id keeps the first art, so existing stock stays on it. Paradox Rift and Temporal Forces also pin each art's promo (Iron Bundle with Iron Valiant, Scream Tail with Roaring Moon, Flutter Mane with Walking Wake, Iron Thorns with Iron Leaves), matching the Pokémon Center boxes."

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
