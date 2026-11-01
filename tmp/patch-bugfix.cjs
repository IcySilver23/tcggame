const fs = require('fs')

function patch(file, from, to, label) {
  const raw = fs.readFileSync(file, 'utf8')
  const crlf = raw.includes('\r\n')
  const src = raw.replace(/\r\n/g, '\n')
  const find = from.replace(/\r\n/g, '\n')
  const repl = to.replace(/\r\n/g, '\n')
  if (!src.includes(find)) throw new Error('anchor missing (' + label + ') in ' + file + ': ' + find.slice(0, 70))
  fs.writeFileSync(file, crlf ? src.replace(find, repl).replace(/\n/g, '\r\n') : src.replace(find, repl))
  console.log('ok', file, '-', label)
}

/* BUG 1 — the dealer's quote re-rolled on every read AND rolled again on sale,
   so the number on the shelf was decorative and a refresh shopped for price.
   One deterministic rate per inventory row fixes both halves. */
patch(
  'server/services/resale.ts',
  `const DEALER_NAMES = ['QuickFlip Quinns', 'CaseFresh Cards', 'The Buylist Bin', 'WallStreet Slabs', 'Corner Shop Cards']`,
  `const DEALER_NAMES = ['QuickFlip Quinns', 'CaseFresh Cards', 'The Buylist Bin', 'WallStreet Slabs', 'Corner Shop Cards']

/**
 * The dealer's rate for one specific card, stable for as long as the card sits
 * on your shelf. 0.70–0.92 of market, scrambled off the row id.
 *
 * It used to be \`0.70 + Math.random() * 0.22\` — rolled on every read of the
 * shelf AND rolled again inside the sale — so the displayed offer was not the
 * offer you got, and reloading was a way to reroll your own quote.
 */
function dealerMultiplier(inventoryId: number): number {
  const x = Math.sin(inventoryId * 12.9898) * 43758.5453
  const frac = x - Math.floor(x)
  return 0.7 + frac * 0.22
}`,
  'dealer rate helper',
)

patch(
  'server/services/resale.ts',
  `    const basis = round2(r.cost_basis * r.quantity)
    const mult = 0.7 + Math.random() * 0.22
    const offer = round2(market * mult)`,
  `    const basis = round2(r.cost_basis * r.quantity)
    const mult = dealerMultiplier(r.id)
    const offer = round2(market * mult)`,
  'flipStock uses stable rate',
)

patch(
  'server/services/resale.ts',
  `  const market = round2(valueOfRow({ card_id: r.card_id, variant: r.variant, condition: r.condition, graded_grade: r.graded_grade }))
  const mult = 0.7 + Math.random() * 0.22
  const offer = round2(market * mult)
  const fee = 0`,
  `  const market = round2(valueOfRow({ card_id: r.card_id, variant: r.variant, condition: r.condition, graded_grade: r.graded_grade }))
  // Same rate the shelf quoted — this is the half that made the quote a lie.
  const mult = dealerMultiplier(r.id)
  const offer = round2(market * mult)
  const fee = 0`,
  'instantSell uses stable rate',
)

/* BUG 2 — a lot was charged at full ask even when storage only admitted part of
   it, so you paid for cardboard that stayed with the seller. */
patch(
  'server/services/resale.ts',
  `  // Storage & the vault: make room per the overflow policy — whatever still
  // doesn't fit stays with the seller (full ask is still the price of the deal).
  const rawCount = cards.length
  const admitted = vault.makeRoomFor(rawCount, 'Resale lot')
  if (admitted <= 0) {
    return { ok: false as const, error: 'Resale lot: no room on the shelf — sell or scrap before buying another lot.' }
  }
  const perCard = round2(d.ask / rawCount)`,
  `  // Storage & the vault: make room per the overflow policy. Whatever still
  // doesn't fit stays with the seller, and you are charged only for what you
  // actually carry home — the old code billed the full ask for a partial lot.
  const rawCount = cards.length
  const admitted = vault.makeRoomFor(rawCount, 'Resale lot')
  if (admitted <= 0) {
    return { ok: false as const, error: 'Resale lot: no room on the shelf — sell or scrap before buying another lot.' }
  }
  const perCard = round2(d.ask / rawCount)
  const charged = round2(perCard * admitted)`,
  'prorate the lot',
)

patch(
  'server/services/resale.ts',
  `  logActivity('resale', \`Bought \${cards.length} cards from \${d.seller} for $\${d.ask.toFixed(2)} (est. $\${d.true_value.toFixed(2)} value).\`, -d.ask)

  return { ok: true as const, bought: cards.length, spent: d.ask, estValue: d.true_value }`,
  `  const short = rawCount - admitted
  logActivity(
    'resale',
    short > 0
      ? \`Bought \${admitted} of \${rawCount} cards from \${d.seller} for $\${charged.toFixed(2)} — \${short} stayed with the seller, no shelf room.\`
      : \`Bought \${admitted} cards from \${d.seller} for $\${charged.toFixed(2)} (est. $\${d.true_value.toFixed(2)} value).\`,
    -charged,
  )

  return { ok: true as const, bought: admitted, spent: charged, estValue: round2(d.true_value * (admitted / rawCount)), short }`,
  'charge only what lands',
)

/* BUGS 3/4 — money labels. The shelf percentage is a return on cost, not the
   inbox's "edge over ask"; the statement mixed proceeds with profit. */
patch(
  'src/views/Resale.tsx',
  `                        <span className="faint small">dealer</span>`,
  `                        <span className="faint small">vs cost</span>`,
  'shelf label',
)

patch(
  'src/views/Resale.tsx',
  `                    { value: 'edge_desc', label: 'Best edge first' },
                    { value: 'edge_asc', label: 'Worst edge first' },`,
  `                    { value: 'edge_desc', label: 'Best return first' },
                    { value: 'edge_asc', label: 'Worst return first' },`,
  'sort labels',
)

patch(
  'src/views/Resale.tsx',
  `            <span>Dealer sales ({ledger.instantSales})</span>`,
  `            <span>Dealer sales — proceeds ({ledger.instantSales})</span>`,
  'statement dealer label',
)

patch(
  'src/views/Resale.tsx',
  `            <span>Market sales ({ledger.marketSales})</span>`,
  `            <span>Market sales — profit ({ledger.marketSales})</span>`,
  'statement market label',
)

/* The API type gains the shortfall so the client could report it. */
patch(
  'src/api.ts',
  `export type ResaleBuy = { ok: boolean; bought?: number; spent?: number; estValue?: number; error?: string }`,
  `export type ResaleBuy = { ok: boolean; bought?: number; spent?: number; estValue?: number; short?: number; error?: string }`,
  'ResaleBuy type',
)
console.log('done')
