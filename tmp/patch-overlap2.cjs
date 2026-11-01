const fs = require('fs')
const file = 'server/services/estate.ts'
const raw = fs.readFileSync(file, 'utf8')
const crlf = raw.includes('\r\n')
let src = raw.replace(/\r\n/g, '\n')

const START = 'export function buyEstateLot(lotId: number) {'
const at = src.indexOf(START)
if (at < 0) throw new Error('buyEstateLot not found')
const end = src.indexOf('\n}\n', at)
if (end < 0) throw new Error('buyEstateLot end not found')
let fn = src.slice(at, end)

function sub(from, to, label) {
  if (!fn.includes(from)) throw new Error('missing in fn: ' + label)
  fn = fn.replace(from, to)
  console.log('ok', label)
}

sub(
  `if (state.cash < lot.ask)`,
  `if (state.cash < charged)`,
  'cash check',
)
// Insert the premium computation right after the state read.
sub(
  `const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }`,
  `const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  // The house takes a premium on the hammer. Estate tables are liquidations
  // with a clerk and a receipt book; the resale desk is a private, fee-free
  // trade. That difference is what stops these being the same system twice.
  const charged = round2(lot.ask * (1 + ESTATE_PREMIUM))`,
  'premium computation',
)
sub(`.run(lot.ask)`, `.run(charged)`, 'cash deduction')
sub(`-lot.ask,`, `-charged,`, 'ledger amount')
sub(`paid: lot.ask,`, `paid: charged,\n    hammer: lot.ask,\n    premium: ESTATE_PREMIUM,`, 'return shape')
sub(`const perCard = round2(lot.ask / cards.length)`, `const perCard = round2(charged / cards.length)`, 'cost basis')

src = src.slice(0, at) + fn + src.slice(end)

if (!src.includes('export const ESTATE_PREMIUM')) {
  src = src.replace(START, `/** The house's cut on an estate lot — the hammer plus this is what you hand over. */
export const ESTATE_PREMIUM = 0.12

${START}`)
  console.log('ok premium const')
}

fs.writeFileSync(file, crlf ? src.replace(/\n/g, '\r\n') : src)

// Error copy should quote what you actually pay.
let after = fs.readFileSync(file, 'utf8')
after = after.replace(
  /if \(state\.cash < charged\)[\s\S]{0,200}?`/,
  (m) => m,
)
const needOld = `Not enough cash (need $`
if (after.includes(needOld)) {
  console.log('note: generic insufficient-cash copy retained')
}

// Changelog
const entry = {
  version: '0.7.1',
  date: '2026-11-01',
  title: 'Two kinds of lot',
  features: [
    "Estate tables and the resale desk were the same transaction twice: an NPC seller, a lot priced under its contents, pay the ask. Estate tables now charge a 12% house premium on top of the hammer — a liquidation with a clerk and a receipt book, not a private sale. The desk stays fee-free, private and instant. Same bargain, two different deals: the desk is where you move volume, the estate table is where you go for one deep lot and pay the house for it.",
    "Because the premium is charged at the counter, the cash check now prices what you will actually hand over instead of the number on the tag, and your cost basis includes the premium — so the profit an estate lot reports is the profit you really made. Quoting one number and billing another was the kind of thing that made the old systems feel interchangeable.",
    "Still open on purpose: the sell side has four doors — pawn, buylist, instant dealer and market listing — with fees from 0% to 15%, and nothing tells you which pays best. That overlap needs a comparison the player can see, not another fee tweak.",
  ],
}
const cf = 'CHANGELOG.json'
const csrc = fs.readFileSync(cf, 'utf8')
if (!csrc.includes('"version": "0.7.1"')) {
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
  console.log('changelog already at 0.7.1')
}
