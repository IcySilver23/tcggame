import fs from 'node:fs'

const features = [
  "The Sword & Shield Elite Trainer Box Plus is on the shelf, in both arts: Zacian at $235.67 and Zamazenta at $240.64, the TCGplayer market for each box on 8 November 2026. These were the international half of the 2020 Ultra-Premium Collection — North America got the combined box instead — and each holds twelve packs, three each from Sword & Shield, Rebel Clash, Darkness Ablaze and Vivid Voltage, plus a gold full-art Zacian V or Zamazenta V. The metal dice, coin and condition markers are accessories and are not modelled.",
  "That box needed something no other product did: its twelve packs come from four different expansions. The opener now follows the real composition — three packs of each set, in that order — instead of dealing twelve packs of its host set, and every way of ripping it (whole box, one wrapper at a time, pack battles and tournaments) deals the mix. The product page says so plainly rather than implying a single-set box.",
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
