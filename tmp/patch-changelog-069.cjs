const fs = require('fs')

const entry = {
  version: '0.6.9',
  date: '2026-11-01',
  title: 'Quotes you can trust',
  features: [
    "The dealer's offer on each card is now the offer you actually get. It used to re-roll every time the shelf was read, then roll again when you pressed Sell now, so the number on screen was decoration and reloading was a way to shop for a better price. Each card now keeps one rate for as long as it sits on your shelf — 70–92% of market, fixed until it sells.",
    "Buying a lot you have no room for no longer charges for cards that never arrive. You pay only the prorated ask for the cards that fit on the shelf; the rest stay with the seller and the activity line tells you exactly how many did. Before, a full shelf billed you the whole ask for a partial lot.",
    "Money labels match their arithmetic. The shelf percentage now reads \"vs cost\" because it is a return on what you paid, not the inbox's edge over an ask; the statement separates dealer proceeds from market profit instead of putting both in a column that looks the same.",
  ],
}

const file = 'CHANGELOG.json'
const src = fs.readFileSync(file, 'utf8')
if (src.includes('"version": "0.6.9"')) throw new Error('0.6.9 already present')
const anchor = '  "entries": [\n'
if (!src.includes(anchor)) throw new Error('entries anchor missing')
const block = '    ' + JSON.stringify(entry, null, 2).split('\n').join('\n    ') + ',\n'
fs.writeFileSync(file, src.replace(anchor, anchor + block))
console.log('changelog ok — newest:', JSON.parse(fs.readFileSync(file, 'utf8')).entries[0].version)

for (const p of ['package.json', 'package-lock.json']) {
  if (!fs.existsSync(p)) continue
  const json = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (p === 'package-lock.json' && json.packages && json.packages['']) json.packages[''].version = '0.6.9'
  json.version = '0.6.9'
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n')
  console.log('bumped', p)
}
