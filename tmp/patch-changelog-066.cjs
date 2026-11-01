const fs = require('fs')

const entry = {
  version: '0.6.6',
  date: '2026-11-01',
  title: 'A bell that actually rings',
  features: [
    "There is a 🔔 in the header now. Deliveries landing, trade offers arriving and other things that want an answer show up there with an unread count, instead of only scrolling past in the activity feed while you are three screens deep in a binder. Click a row to jump straight to the screen that can act on it — a parcel opens your collection, an offer opens the Trading Post — and it marks itself read as it goes.",
    "Deliveries were the worst offender: a parcel could land, get sorted into a binder page, and you would never know until you went looking. Every arrival now badges with the card, how many, who shipped it and how many game-days it spent on the road. Trade offers badge too, because an expired offer is a real loss rather than an inconvenience.",
    "The panel is short on purpose: forty most recent, newest first, 'Mark all read' to clear the badge in one click, and old entries pruned so it never turns into a second activity log. It only badges things that happened after this update — the offers and parcels already waiting in an older save will not appear retroactively.",
  ],
}

const file = 'CHANGELOG.json'
const src = fs.readFileSync(file, 'utf8')
if (src.includes('"version": "0.6.6"')) throw new Error('0.6.6 already present')
const anchor = '  "entries": [\n'
if (!src.includes(anchor)) throw new Error('entries anchor missing')
const block = '    ' + JSON.stringify(entry, null, 2).split('\n').join('\n    ') + ',\n'
fs.writeFileSync(file, src.replace(anchor, anchor + block))
console.log('changelog ok — newest:', JSON.parse(fs.readFileSync(file, 'utf8')).entries[0].version)

for (const p of ['package.json', 'package-lock.json']) {
  if (!fs.existsSync(p)) continue
  const json = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (p === 'package-lock.json' && json.packages && json.packages['']) json.packages[''].version = '0.6.6'
  json.version = '0.6.6'
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n')
  console.log('bumped', p)
}
