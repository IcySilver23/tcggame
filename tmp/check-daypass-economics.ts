// What does one skipped day actually hand the player?
//
// The day pass (services/daypass.ts, $25) moves the clock one game-day, which
// rebuilds the Daily Deals board through services/dailydeals.ts: one pack, one
// box and one collection, each 10–30% off, each claimable once that day. This
// script replays the picker over thousands of day keys against a COPY of the
// save's catalogue and prices every board the way the shop does, so the fee can
// be judged against the money the board is worth rather than guessed at.
//
// A discount is only worth cash if it survives resale: selling sealed stock
// pays out at market minus a 10% fee (sealedfutures.sellSealed), so a 10% deal
// is worth nothing and a 30% deal is worth 20% of the price.
//
//   npx tsx tmp/check-daypass-economics.ts

import fs from 'node:fs'
import path from 'node:path'

const home = path.resolve('tmp/daypass-econ-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'server'), { recursive: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
fs.copyFileSync('server/schema.sql', path.join(home, 'server', 'schema.sql'))
for (const suffix of ['', '-wal', '-shm']) {
  const src = path.join('data', `tcglife.db${suffix}`)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(home, 'data', `tcglife.db${suffix}`))
}
process.env.TCGLIFE_HOME = home

const { db } = await import('../server/lib/db')
const sealed = await import('../server/services/sealed')

const RESALE_FEE = 0.1 // sealedfutures.sellSealed: market − 10%

type Product = { id: string; kind: string; lane: 'pack' | 'box' | 'collection'; price: number }

// Same lane rule as dailydeals.laneOf.
function laneOf(kind: string): 'pack' | 'box' | 'collection' {
  if (kind === 'booster') return 'pack'
  if (kind === 'bundle' || kind === 'etb' || kind === 'display') return 'box'
  return 'collection'
}

// Same FNV-1a as dailydeals.hash.
function hash(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const rows = db.prepare('SELECT id, set_id, kind FROM pack_products').all() as { id: string; set_id: string; kind: string }[]
const pool: Product[] = []
for (const r of rows) {
  if (!sealed.sellsProduct(r.id, r.set_id)) continue
  const price = sealed.priceOf(r.id).market
  if (!(price > 0)) continue
  pool.push({ id: r.id, kind: r.kind, lane: laneOf(r.kind), price })
}

const byLane = (lane: string) => pool.filter((p) => p.lane === lane)
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? 0
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  return { n: xs.length, mean, p50: q(0.5), p90: q(0.9), max: s[s.length - 1] ?? 0 }
}

// --- the shelf the deals are drawn from -----------------------------------
console.log(`pool: ${pool.length} sellable products`)
for (const lane of ['pack', 'box', 'collection'] as const) {
  const s = stats(byLane(lane).map((p) => p.price))
  console.log(
    `  ${lane.padEnd(10)} n=${String(s.n).padStart(4)}  mean $${s.mean.toFixed(2)}  median $${s.p50.toFixed(2)}  p90 $${s.p90.toFixed(2)}  max $${s.max.toFixed(2)}`,
  )
}

// --- replay the picker over real day keys ----------------------------------
// Two years of am/pm keys: the pick is a hash, so distinct keys sample the
// catalogue the way distinct days do.
const keys: string[] = []
for (let d = 0; d < 730; d++) {
  const day = new Date(Date.UTC(2025, 0, 1) + d * 86_400_000).toISOString().slice(0, 10)
  keys.push(`${day}-am`, `${day}-pm`)
}

const visible = (list: Product[], key: string, lane: string) =>
  [...list].sort((a, b) => hash(`${key}:${lane}:${b.id}`) - hash(`${key}:${lane}:${a.id}`) || a.id.localeCompare(b.id))[0]

const boardShelf: number[] = []      // shelf price of the three deals
const boardDiscount: number[] = []   // value of the discounts, at shelf price
const boardBankable: number[] = []   // value after the 10% resale fee
const boardOutlay: number[] = []     // cash needed to claim all three
const bestDealDiscount: number[] = [] // the single best discount on the board
const bestDealBankable: number[] = []
let boardsWithPacks = 0

for (const key of keys) {
  const chosen: Product[] = []
  for (const lane of ['pack', 'box', 'collection'] as const) {
    const pick = visible(byLane(lane).filter((p) => !chosen.some((c) => c.id === p.id)), key, lane)
    if (pick) chosen.push(pick)
  }
  if (chosen.length === 0) continue
  boardsWithPacks++
  let shelf = 0
  let disc = 0
  let bank = 0
  let outlay = 0
  let best = 0
  let bestBank = 0
  for (const p of chosen) {
    const pct = 10 + (hash(`${key}:${p.id}:pct`) % 21)
    const d = (p.price * pct) / 100
    const b = (p.price * Math.max(0, pct - RESALE_FEE * 100)) / 100
    shelf += p.price
    disc += d
    bank += b
    outlay += p.price - d
    if (d > best) { best = d; bestBank = b }
  }
  boardShelf.push(shelf)
  boardDiscount.push(disc)
  boardBankable.push(bank)
  boardOutlay.push(outlay)
  bestDealDiscount.push(best)
  bestDealBankable.push(bestBank)
}

const show = (label: string, xs: number[]) => {
  const s = stats(xs)
  const pct = (v: number) => `${((xs.filter((x) => x >= v).length / xs.length) * 100).toFixed(1)}%`
  console.log(
    `${label.padEnd(26)} mean $${s.mean.toFixed(2).padStart(8)}  median $${s.p50.toFixed(2).padStart(8)}  p90 $${s.p90.toFixed(2).padStart(8)}  max $${s.max.toFixed(2)}`,
  )
  if (label.startsWith('board')) {
    const thresholds = [25, 100, 250, 500]
    console.log(`   boards at or above ${thresholds.map((t) => `$${t}: ${pct(t)}`).join(' · ')}`)
  }
}

console.log(`\n${boardsWithPacks} simulated boards (one per am/pm key)`)
show('board discount value', boardDiscount)
show('board resale margin', boardBankable)
show('best single discount', bestDealDiscount)
show('best single margin', bestDealBankable)
const outlay = stats(boardOutlay)
console.log(`cash to claim the whole board: median $${outlay.p50.toFixed(2)}  p90 $${outlay.p90.toFixed(2)}`)

// --- what each candidate fee does to the farm ------------------------------
// Two strategies: claim the whole board, or cherry-pick only the best deal.
// Net is what the skip leaves in the drawer after resale fees, before rent.
const pctPositive = (xs: number[]) => (xs.filter((x) => x > 0).length / xs.length) * 100
const netAll = (fee: (i: number) => number) => boardBankable.map((m, i) => m - fee(i))
const netBest = (fee: (i: number) => number) => bestDealBankable.map((m, i) => m - fee(i))

console.log('\nfee (whole board / best deal only): net per skip')
const flatFees = [25, 75, 150, 300, 600, 1200]
for (const f of flatFees) {
  const all = netAll(() => f)
  const best = netBest(() => f)
  const a = stats(all)
  const b = stats(best)
  console.log(
    `  flat $${String(f).padEnd(5)} board: mean $${a.mean.toFixed(0).padStart(6)} median $${a.p50.toFixed(0).padStart(6)}  ${pctPositive(all).toFixed(0)}% profitable` +
    `   | best: mean $${b.mean.toFixed(0).padStart(6)} median $${b.p50.toFixed(0).padStart(6)}  ${pctPositive(best).toFixed(0)}% profitable`,
  )
}

// Board-priced candidates.
const marginFee = (i: number) => Math.max(25, boardBankable[i])
const candidates: [string, (i: number) => number][] = [
  ...([0.1, 0.12, 0.15, 0.2, 0.25] as const).map((m) => [
    `${Math.round(m * 100)}% of board shelf`,
    (i: number) => Math.max(25, boardShelf[i] * m),
  ] as [string, (i: number) => number]),
  ["board's own margin", marginFee],
]
for (const [label, fee] of candidates) {
  const all = netAll(fee)
  const best = netBest(fee)
  const feeStats = stats(boardShelf.map((_, i) => fee(i)))
  console.log(
    `  ${label.padEnd(20)} fee median $${feeStats.p50.toFixed(0)} p90 $${feeStats.p90.toFixed(0)} |` +
    ` board: mean $${stats(all).mean.toFixed(0)} median $${stats(all).p50.toFixed(0)} ${pctPositive(all).toFixed(0)}% profitable` +
    ` | best: mean $${stats(best).mean.toFixed(0)} median $${stats(best).p50.toFixed(0)} ${pctPositive(best).toFixed(0)}% profitable`,
  )
}

// How much profit one capitalised farmer could extract per ten passes at $25.
const cheapNet = netAll(() => 25)
const tenPasses = cheapNet.reduce((a, b) => a + b, 0) / cheapNet.length * 10
console.log(`\nat $25 a skip, ten passes average $${tenPasses.toFixed(0)} of captured margin (claim-all strategy).`)
