const fs = require('fs')
const file = 'server/services/estate.ts'
const raw = fs.readFileSync(file, 'utf8')
const crlf = raw.includes('\r\n')
let src = raw.replace(/\r\n/g, '\n')

const START = 'export function buyEstateLot(lotId: number) {'
const at = src.indexOf(START)
const end = src.indexOf('\n}\n', at)
if (at < 0 || end < 0) throw new Error('buyEstateLot not found')
let fn = src.slice(at, end)

function sub(from, to, label, optional) {
  if (!fn.includes(from)) {
    if (optional) { console.log('skip', label); return }
    throw new Error('missing: ' + label)
  }
  fn = fn.split(from).join(to)
  console.log('ok', label)
}

// 1. cash check now compares against what is actually handed over
sub('state.cash < lot.ask', 'state.cash < charged', 'cash check')
// 2. insert the premium computation immediately before that check
sub(
  'if (state.cash < charged)',
  `// The house takes a premium on the hammer — estate tables are liquidations,\n  // the resale desk is a private fee-free trade. That is the difference.\n  const charged = round2(lot.ask * (1 + ESTATE_PREMIUM))\n  if (state.cash < charged)`,
  'premium computation',
)
sub('.run(lot.ask)', '.run(charged)', 'cash deduction')
sub('-lot.ask,', '-charged,', 'ledger amount')
sub('paid: lot.ask,', 'paid: charged,\n    hammer: lot.ask,\n    premium: ESTATE_PREMIUM,', 'return shape')
sub('const perCard = round2(lot.ask / cards.length)', 'const perCard = round2(charged / cards.length)', 'cost basis')

src = src.slice(0, at) + fn + src.slice(end)

if (!src.includes('export const ESTATE_PREMIUM')) {
  src = src.replace(START, `/** The house's cut on an estate lot — hammer plus this is what you hand over. */\nexport const ESTATE_PREMIUM = 0.12\n\n${START}`)
  console.log('ok premium const')
}

fs.writeFileSync(file, crlf ? src.replace(/\n/g, '\r\n') : src)
console.log('written', file)

const cf = 'CHANGELOG.json'
const csrc = fs.readFileSync(cf, 'utf8')
if (!csrc.includes('"version": "0.7.1"')) {
  const entry = {
    version: '0.7.1',
    date: '2026-11-01',
    title: 'Two kinds of lot',
    features: [
      "Estate tables and the resale desk were the same transaction twice: an NPC seller, a lot priced under its contents, pay the ask. Estate tables now charge a 12% house premium on top of the hammer — a liquidation with a clerk and a receipt book, not a private sale. The desk stays fee-free, private and instant. Same bargain, two different deals: the desk is where you move volume, the estate table is where you go for one deep lot and pay the house for it.",
      "The premium is charged at the counter, so the cash check now prices what you actually hand over instead of the number on the tag, and your cost basis includes it — the profit an estate lot reports is the profit you really made. Quoting one number and billing another is what made the old systems feel interchangeable.",
      "Still open on purpose: the sell side has four doors — pawn, buylist, instant dealer and market listing — with fees from 0% to 15%, and nothing tells you which pays best. That overlap needs a comparison the player can see, not another fee tweak.",
    ],
  }
  const anchor = '  "entries": [\n'
  fs.writeFileSync(cf, csrc.replace(anchor, anchor + '    ' + JSON.stringify(entry, null, 2).split('\n').join('\n    ') + ',\n'))
  for (const p of ['package.json', 'package-lock.json']) {
    const json = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (p === 'package-lock.json' && json.packages && json.packages['']) json.packages[''].version = '0.7.1'
    json.version = '0.7.1'
    fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n')
  }
  console.log('changelog + 0.7.1')
} else {
  console.log('changelog already 0.7.1')
}
