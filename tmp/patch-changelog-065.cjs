const fs = require('fs')

const entry = {
  version: '0.6.5',
  date: '2026-11-01',
  title: 'The peek becomes a card',
  features: [
    "Buying a pile at a yard sale now tells you what you bought. The card was already landing in your binder — that part worked — but the only feedback was a toast that scrolled past while the table re-rendered, so a purchase read like nothing happened. Every table buy opens a reveal instead: the card's real art, its name, condition and quantity, paid against what it is actually worth, and the difference. A 10¢ shoebox pile turned out to be a NM Sewaddle worth 29¢ the first time it ran.",
    "The driveway is the one venue where you buy blind, so the reveal is the receipt: it says the pile came off a table, whether you paid the sticker or talked them down, and that the card is in your binder now. Accepted offers open the same reveal as sticker buys — the peek you read on the table is the last thing you see before the card, and the seller's counter no longer ends in a line of text.",
  ],
}

const file = 'CHANGELOG.json'
const src = fs.readFileSync(file, 'utf8')
if (src.includes('"version": "0.6.5"')) throw new Error('0.6.5 already present')
const anchor = '  "entries": [\n'
if (!src.includes(anchor)) throw new Error('entries anchor missing')
const block = '    ' + JSON.stringify(entry, null, 2).split('\n').join('\n    ') + ',\n'
fs.writeFileSync(file, src.replace(anchor, anchor + block))
console.log('changelog ok — newest:', JSON.parse(fs.readFileSync(file, 'utf8')).entries[0].version)

for (const p of ['package.json', 'package-lock.json']) {
  if (!fs.existsSync(p)) continue
  const json = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (p === 'package-lock.json' && json.packages && json.packages['']) json.packages[''].version = '0.6.5'
  json.version = '0.6.5'
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n')
  console.log('bumped', p)
}
