const fs = require('fs')

const entry = {
  version: '0.6.7',
  date: '2026-11-01',
  title: 'The desk gets a statement',
  features: [
    "The Resale Desk is rebuilt around one standing ledger. A tape across the top — capital out, realized, unrealized, ROI — stays put no matter which lane you are in, because \"am I actually up?\" was the one question the old screen made you open a tab to answer. Lanes are now Inbox, Shelf and Statement, each with its own count.",
    "Seller notes read like notes. Every offer shows a fan of the actual cards, ask against estimated value with an edge bar (the tick in the middle is break-even), and a countdown that turns red inside the last half hour. Looking through the lot is one tap; buying drops you straight onto the shelf with the lot already counted.",
    "The flip table is gone — it was folding \"Sell now\" onto two lines. The shelf is cards now: real art and names, condition and days held, dealer offer next to its edge, and a banner that tells you what the dealer would pay for the whole shelf today. Stock names and art come with the shelf data itself, so it no longer fires one card lookup per row to print a label.",
    "The Statement lays the money out as labelled rows instead of floating numbers, ending on total ROI with a line explaining what is counted. Honest caveat: the dealer's rate re-rolls every time you load the shelf, so treat the offer as today's quote rather than a price already struck.",
  ],
}

const file = 'CHANGELOG.json'
const src = fs.readFileSync(file, 'utf8')
if (src.includes('"version": "0.6.7"')) throw new Error('0.6.7 already present')
const anchor = '  "entries": [\n'
if (!src.includes(anchor)) throw new Error('entries anchor missing')
const block = '    ' + JSON.stringify(entry, null, 2).split('\n').join('\n    ') + ',\n'
fs.writeFileSync(file, src.replace(anchor, anchor + block))
console.log('changelog ok — newest:', JSON.parse(fs.readFileSync(file, 'utf8')).entries[0].version)

for (const p of ['package.json', 'package-lock.json']) {
  if (!fs.existsSync(p)) continue
  const json = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (p === 'package-lock.json' && json.packages && json.packages['']) json.packages[''].version = '0.6.7'
  json.version = '0.6.7'
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n')
  console.log('bumped', p)
}
