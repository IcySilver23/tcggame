const fs = require('fs')

const entry = {
  version: '0.6.4',
  date: '2026-11-01',
  title: 'The parking lot',
  features: [
    "Buying on Local Deals is a meetup now, not a popup. The old flow ended in a one-line dialog — 'X is yours for $20 cash' — which is a receipt, not a transaction with a stranger. It is a scene instead: you pull into the agreed lot under one streetlight, the seller's car already there with the hazards blinking, and the deal plays out in beats — ARRIVE, SMALL TALK, CASH, THE CHECK, DONE. Their line changes with what you bought (a card, a sealed box, a lot), and the narration is yours: counting the money out, taking the item, walking back to the car before the light clicks off.",
    "The corner check is the beat that matters. Cash moves first, exactly like the real thing — then you turn the item over and the verdict lands: genuine, with clean corners and a holo that lines up under the streetlight, or the corner lifting under your thumbnail to reveal wrong stock and wrong gloss. A counterfeit ends the scene standing in the lot holding a fake you already paid for, with the paid-vs-market tally underneath so the damage is in numbers.",
    "The other three outcomes are staged too, because they are the reason a parking lot is a risk. A ghost is an empty lot, one shopping cart, and a message that stays on Read. A card sold out from under you is a buyer already walking away with it and a shrug — 'sorry, sold it locally already.' A counter-offer happens face to face at the car, with Pay or Walk away in front of you instead of a text bubble. Selling your own post still uses the plain receipt, because there is no lot when you are the one being met.",
  ],
}

const file = 'CHANGELOG.json'
const src = fs.readFileSync(file, 'utf8')
if (src.includes('"version": "0.6.4"')) throw new Error('0.6.4 already present')
const anchor = '  "entries": [\n'
if (!src.includes(anchor)) throw new Error('entries anchor missing')
const block = '    ' + JSON.stringify(entry, null, 2).split('\n').join('\n    ') + ',\n'
fs.writeFileSync(file, src.replace(anchor, anchor + block))
console.log('changelog ok — newest:', JSON.parse(fs.readFileSync(file, 'utf8')).entries[0].version)

for (const p of ['package.json', 'package-lock.json']) {
  if (!fs.existsSync(p)) continue
  const json = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (p === 'package-lock.json' && json.packages && json.packages['']) json.packages[''].version = '0.6.4'
  json.version = '0.6.4'
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n')
  console.log('bumped', p)
}
