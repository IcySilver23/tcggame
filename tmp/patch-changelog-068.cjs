const fs = require('fs')

const entry = {
  version: '0.6.8',
  date: '2026-11-01',
  title: 'One desk, everywhere',
  features: [
    "The screens that still wore the default header now wear the desk header: a mark in a rounded chip, the screen's name in title case, and one line saying what the screen is for. Inventory, the Card Shop (both the lease picker and a running shop) and Conventions — floor, booth and the dark-hall screen between shows — are converted. The all-caps titles with the yellow bar were the tell that a screen had no identity of its own.",
    "Tables got two fixes that were making real work harder: action buttons no longer wrap mid-word (\"Sell now\" was folding onto two lines in every narrow table), and a table's header row now stays pinned while you scroll it, so you no longer lose which column was the dealer offer.",
    "This is the shared shell, not a per-screen redesign — the deals, cards, prices and counters inside these screens behave exactly as before. Plenty of screens still carry the old header; they convert as they get their own pass rather than in one sweep, so nothing gets a new skin it has not earned.",
  ],
}

const file = 'CHANGELOG.json'
const src = fs.readFileSync(file, 'utf8')
if (src.includes('"version": "0.6.8"')) throw new Error('0.6.8 already present')
const anchor = '  "entries": [\n'
if (!src.includes(anchor)) throw new Error('entries anchor missing')
const block = '    ' + JSON.stringify(entry, null, 2).split('\n').join('\n    ') + ',\n'
fs.writeFileSync(file, src.replace(anchor, anchor + block))
console.log('changelog ok — newest:', JSON.parse(fs.readFileSync(file, 'utf8')).entries[0].version)

for (const p of ['package.json', 'package-lock.json']) {
  if (!fs.existsSync(p)) continue
  const json = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (p === 'package-lock.json' && json.packages && json.packages['']) json.packages[''].version = '0.6.8'
  json.version = '0.6.8'
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n')
  console.log('bumped', p)
}
