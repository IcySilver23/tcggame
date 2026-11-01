const fs = require('fs')
const eol = (s) => (s.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s)

function patch(file, from, to) {
  let src = fs.readFileSync(file, 'utf8')
  if (!src.includes(eol(from))) throw new Error('anchor missing in ' + file + ': ' + from.slice(0, 70))
  src = src.replace(eol(from), eol(to))
  fs.writeFileSync(file, src)
  console.log('ok', file)
}

function patchRe(file, re, to, label) {
  let src = fs.readFileSync(file, 'utf8')
  if (!re.test(src)) throw new Error('regex missed in ' + file + ': ' + label)
  src = src.replace(re, eol(to))
  fs.writeFileSync(file, src)
  console.log('ok(re) ' + label)
}

/* market.tick → one price pass per game day */
patch(
  'server/services/market.ts',
  `  // Local deals — Marketplace/Craigslist spawns, expiries, and buyer messages
  import('./local').then((l) => l.localTick()).catch(() => {})
}`,
  `  // Local deals — Marketplace/Craigslist spawns, expiries, and buyer messages
  import('./local').then((l) => l.localTick()).catch(() => {})
  // Prices ride the game clock: quotes for what you own or watch, the price
  // history point, and the simulated market all advance once per game day
  // (each guarded by its own day key, so repeat ticks that day are free).
  import('./pricetick').then((p) => p.priceDayTick()).catch(() => {})
}`,
)

/* index.ts — the price history + simulated market wall-clock jobs go away */
patch(
  'server/index.ts',
  `// Daily price snapshot: when the server starts, copy the latest real prices into
// the history log if we haven't snapshotted in the last 24h.
function maybeDailySnapshot() {
  const last = getMeta('lastSnapshotAt')
  if (last && Date.now() - new Date(last).getTime() < 24 * 3600_000) return
  const n = market.takeSnapshot()
  if (n > 0) console.log(\`[snapshot] stored \${n} price points into history\`)
}
setTimeout(maybeDailySnapshot, 5000)
setInterval(maybeDailySnapshot, 6 * 3600_000)`,
  `// Price history, real quotes and the simulated market all advance once per
// GAME DAY now, driven by market.tick → services/pricetick.ts. The old jobs
// here ran on 24-hour wall-clock gaps, so a 12-hour game day could turn twice
// with no quote moving at all. This boot kick just seeds the first day.
setTimeout(() => market.tick(), 4_000)`,
)

patchRe(
  'server/index.ts',
  /\/\/ Daily owned\/wishlist price refresh:[\s\S]*?setInterval\(maybeDailyPriceRefresh, 6 \* 3600_000\)\r?\n/,
  `// Owned/wishlist re-pricing lives in services/pricetick.ts now: it runs on
// the first tick of each game day (and retries after 30 minutes if the
// upstream is down), so your portfolio is never a day stale.
`,
  'owned refresh block',
)

patch(
  'server/index.ts',
  `// Keep the simulated market fresh: regenerate 'simulated' rows for cards with
// no real price at boot and daily, so the market never goes blank between
// quota windows. Real rows always outrank simulated ones in resolvePrice.
setTimeout(() => market.refreshSimulatedMarket(), 8_000)
setInterval(() => market.refreshSimulatedMarket(), 24 * 3600_000)`,
  `// The simulated market (the fallback tier for cards with no live quote) drifts
// once per game day from services/pricetick.ts — real rows always outrank
// simulated ones in resolvePrice, so a fresh day never blanks the market.`,
)

/* a reset must re-arm the new day keys */
patch(
  'server/services/savereset.ts',
  `  'lastTickAt', 'listingsGeneratedAt', 'eurUsdRate',`,
  `  'lastTickAt', 'listingsGeneratedAt', 'eurUsdRate',
  'lastPriceSnapshotDay', 'lastSimMarketDay', 'lastOwnedPriceRefreshDay', 'lastOwnedRefreshFailAt',`,
)
