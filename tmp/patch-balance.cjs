const fs = require('fs')

function patch(file, from, to, label) {
  const raw = fs.readFileSync(file, 'utf8')
  const crlf = raw.includes('\r\n')
  const src = raw.replace(/\r\n/g, '\n')
  const find = from.replace(/\r\n/g, '\n')
  const repl = to.replace(/\r\n/g, '\n')
  if (!src.includes(find)) throw new Error('anchor missing (' + label + ') in ' + file)
  fs.writeFileSync(file, crlf ? src.replace(find, repl).replace(/\n/g, '\r\n') : src.replace(find, repl))
  console.log('ok', label)
}

/* BALANCE 1 — satellites could not cover their own rent. The 30-day sim had
   rent+wage over gross in every run, because flagship rent alone ($70/day) is
   about what a satellite grosses per day. Rent is the dominant cost line, so
   rent is the honest lever: price each tier at roughly a third of what its
   door can plausibly turn over, not at the whole take. */
patch('server/services/franchise.ts',
  `deposit: 250, rent: 6`,
  `deposit: 250, rent: 4`, 'hole-in-the-wall rent')
patch('server/services/franchise.ts',
  `deposit: 900, rent: 18`,
  `deposit: 900, rent: 11`, 'storefront rent')
patch('server/services/franchise.ts',
  `deposit: 3000, rent: 70`,
  `deposit: 3000, rent: 36`, 'flagship rent')
patch('server/services/franchise.ts',
  `deposit: 6500, rent: 170`,
  `deposit: 6500, rent: 82`, 'region rent')

/* BALANCE 2 — the resale desk was the dominant loop at +26% per flip cycle,
   twice on the shelf and again on the way out. Two changes, both inside the
   existing formulas: sellers want more (asa % of value), and the dealer pays
   less (a tighter 0.62–0.80 of market instead of 0.70–0.92). */
patch('server/services/resale.ts',
  `return 0.7 + frac * 0.22`,
  `return 0.62 + frac * 0.18`, 'dealer rate range')

patch('server/services/resale.ts',
  `askLow: 0.45, askHigh: 0.85`,
  `askLow: 0.52, askHigh: 0.95`, 'collection asks')
patch('server/services/resale.ts',
  `askLow: 0.3, askHigh: 0.7`,
  `askLow: 0.42, askHigh: 0.78`, 'bulk dupes asks')
patch('server/services/resale.ts',
  `askLow: 0.65, askHigh: 1.1`,
  `askLow: 0.72, askHigh: 1.12`, 'chase chaser asks')
patch('server/services/resale.ts',
  `askLow: 0.25, askHigh: 0.6`,
  `askLow: 0.36, askHigh: 0.7`, 'storage unit asks')
console.log('done')
