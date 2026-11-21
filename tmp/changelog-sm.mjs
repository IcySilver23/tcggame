import fs from 'node:fs'

const features = [
  "Sun & Moon Elite Trainer Boxes hold eight packs, not nine. The whole era from Sun & Moon base through Cosmic Eclipse was seeded with the later nine-pack format, so every box was opening a pack it never held. The three special sets are the exception at ten, and each now hands over the promo that was sealed inside: Shining Legends a Shining Ho-Oh, Dragon Majesty a Naganadel-GX and Hidden Fates a Moltres & Zapdos & Articuno-GX. Dragon Majesty's row opens ten packs because Bulbapedia's contents table and the published box copy both say ten; TCGplayer's own metadata says nine, and the note records the disagreement rather than hiding it.",
  "The Sun & Moon shelf had products that never existed. No six-pack Booster Bundle shipped anywhere in the era, so the bundles listed for all twelve main sets and the three special sets are gone from sale. Shining Legends, Dragon Majesty and Hidden Fates never had a 36-pack Booster Display either, and Detective Pikachu had no Elite Trainer Box, bundle or display at all — its four-card packs only ever came inside the Case Files and collections, so its booster row now deals four cards instead of ten. The rows stay in the save so existing stock is untouched, but the shop will not sell them.",
  "Hidden Fates' Shiny Vault is no longer sold as sealed product. The 94-card subset only ever existed inside Hidden Fates packs, and the catalogue had generated a booster, bundle, display and Elite Trainer Box for it out of the set's shape. Those four rows are now refused for sale, so the only way to a Shiny Vault card is a Hidden Fates pack, which is how the real product worked.",
  "Sun & Moon boxes now sell at what they actually trade for. A 2017–2019 sticker is not today's price: the base set's Elite Trainer Box now lists at its $248.05 market instead of $39.99, Lost Thunder's at $729.80, Cosmic Eclipse's at $1,874.50 and Team Up's at $4,000, with every quote read from TCGplayer for the exact box on 8 November 2026. Where a box shipped in two art versions the row carries one quote and names the other version's price — Sun & Moon's Lunala box at $246.84 beside Solgaleo's $248.05, and Ultra Prism's Dusk Mane box at $760.77 beside Dawn Wings' $780.99.",
]

let text = fs.readFileSync('CHANGELOG.json', 'utf8')
const marker = '"features": ['
const at = text.indexOf(marker)
if (at < 0) throw new Error('features array not found')
const insertAt = at + marker.length
const indent = '\r\n        '
text = text.slice(0, insertAt) + indent + features.map((f) => JSON.stringify(f)).join(',' + indent) + ',' + text.slice(insertAt)
fs.writeFileSync('CHANGELOG.json', text)
const parsed = JSON.parse(fs.readFileSync('CHANGELOG.json', 'utf8'))
console.log('version', parsed.entries[0].version, 'features', parsed.entries[0].features.length)
