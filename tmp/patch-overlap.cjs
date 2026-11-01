const fs = require('fs')
function patch(file, from, to, label) {
  const raw = fs.readFileSync(file, 'utf8')
  const crlf = raw.includes('\r\n')
  const src = raw.replace(/\r\n/g, '\n')
  if (!src.includes(from)) throw new Error('anchor missing: ' + label)
  fs.writeFileSync(file, crlf ? src.replace(from, to).replace(/\n/g, '\r\n') : src.replace(from, to))
  console.log('ok', label)
}

// Estate tables charge a house premium, the resale desk charges nothing.
// That is now the mechanical difference between the two lot systems: the desk
// is a private, instant, fee-free trade; an estate table is an in-person
// liquidation where the sticker is the hammer and the house takes its cut.
// Previously both were "NPC seller, lot below value, pay the ask".
patch('server/services/estate.ts',
  `  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < lot.ask) return { ok: false as const, error: \`Not enough cash (need $\${lot.ask.toFixed(2)})\` }`,
  `  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  // The house takes 12% on top of the hammer. Estate tables are liquidations
  // with a clerk and a receipt book, not a private sale — this is what keeps
  // them from being a second copy of the resale desk.
  const charged = round2(lot.ask * (1 + ESTATE_PREMIUM))
  if (state.cash < charged) {
    return { ok: false as const, error: \`Hammer $\${lot.ask.toFixed(2)} plus \${Math.round(ESTATE_PREMIUM * 100)}% house premium — need $\${charged.toFixed(2)}\` }
  }`, 'estate cash check')

patch('server/services/estate.ts',
  `    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(lot.ask)`,
  `    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(charged)`, 'estate deduction')

patch('server/services/estate.ts',
  `      -lot.ask,`,
  `      -charged,`, 'estate ledger amount')

patch('server/services/estate.ts',
  `    paid: lot.ask,`,
  `    paid: charged,
    hammer: lot.ask,
    premium: ESTATE_PREMIUM,`, 'estate paid + hammer')

patch('server/services/estate.ts',
  `  const perCard = round2(lot.ask / cards.length)`,
  `  const perCard = round2(charged / cards.length)`, 'estate cost basis')

patch('server/services/estate.ts',
  `export function buyEstateLot(lotId: number) {`,
  `/** The house's cut on an estate lot — hammer plus this is what you hand over. */
export const ESTATE_PREMIUM = 0.12

export function buyEstateLot(lotId: number) {`, 'premium const')

// Changelog
const entry = {
  version: '0.7.1',
  date: '2026-11-01',
  title: 'Two kinds of lot',
  features: [
    "Estate tables and the resale desk were the same transaction twice: an NPC seller, a lot priced under its contents, pay the ask. Estate tables now charge a 12% house premium on top of the hammer — it is a liquidation with a clerk and a receipt book. The desk stays fee-free, private and instant. Same bargain, two different deals: the desk is where you move volume, the estate table is where you go for one deep lot and pay the house for the privilege.",
    "The estate table now quotes honestly: it shows the hammer and tells you the premium before you commit, and the cash check prices what you will actually hand over, not the number on the tag. Your cost basis includes the premium, so the real profit on an estate lot is the real profit.",
    "Still open, deliberately: the sell side has four doors — pawn, buylist, instant dealer and market listing — with fees from 0% to 15%, and nothing in the game tells you which pays best. That is the next overlap worth fixing, and it needs a comparison, not another fee tweak.",
  ],
}
const file = 'CHANGELOG.json'
const src = fs.readFileSync(file, 'utf8')
if (src.includes('"version": "0.7.1"')) throw new Error('exists')
const anchor = '  "entries": [\n'
fs.writeFileSync(file, src.replace(anchor, anchor + '    ' + JSON.stringify(entry, null, 2).split('\n').join('\n    ') + ',\n'))
for (const p of ['package.json', 'package-lock.json']) {
  const json = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (p === 'package-lock.json' && json.packages && json.packages['']) json.packages[''].version = '0.7.1'
  json.version = '0.7.1'
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n')
}
console.log('changelog + 0.7.1')
