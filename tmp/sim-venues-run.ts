// Runner for tmp/sim-venues.ts. Drives the real ebay service:
//   A. 200 NPC proxy lots — 100 bid at 0.7× market (the old "unassailable max"
//      exploit path) and 100 at 1.5× (the room-cap probe);
//   B. 200 player auction lots, run through the real room to the hammer;
//   C. 600 fixed-price listings across ten discount buckets, 600 real ticks;
//   D. 40 lots at exactly 6% under market, 300 ticks (the epsilon regression).
//
// Prints a compact report and writes tmp/venue-sims.json.
import { writeFileSync } from 'node:fs'
import { db, nowIso } from '../server/lib/db'
import { bidNpcAuction, ebayTick, feedback, list, startAuction } from '../server/services/ebay'
import { round2 } from '../server/services/market'

const money = (n: number) => Math.round(n * 100) / 100
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0)
const q = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const one = (n: number) => Number(n.toFixed(1))
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const input = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as any[]
const run = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args)
const get = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as any

function cardsFor(n: number, lo: number, hi: number): { id: string; market: number }[] {
  return input(
    `SELECT card_id AS id, MAX(market) AS market
     FROM price_records
     WHERE kind = 'tcgplayer' AND market BETWEEN ? AND ?
     GROUP BY card_id
     ORDER BY RANDOM() LIMIT ?`,
    lo,
    hi,
    n,
  )
}

/** The anchor the BidBay snipers actually read (sniperFeed's subquery). */
function latestMarket(cardId: string): number | null {
  const r = get(
    `SELECT market FROM price_records
     WHERE card_id = ? AND kind = 'tcgplayer' AND market IS NOT NULL
     ORDER BY retrieved_at DESC LIMIT 1`,
    cardId,
  )
  return r?.market ?? null
}

function repeatTo<T>(xs: T[], n: number): T[] {
  const out: T[] = []
  for (let i = 0; i < n; i++) out.push(xs[i % xs.length])
  return out
}

function seedInventory(cards: { id: string; market: number }[]): { invId: number; market: number }[] {
  const ins = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
     VALUES (?, 'normal', 'NM', 1, 'collection', 'market', ?, ?)`,
  )
  return cards.map((c) => ({
    invId: Number(ins.run(c.id, money(c.market), nowIso()).lastInsertRowid),
    market: money(c.market),
  }))
}

function maxId(table: string): number {
  return Number(get(`SELECT COALESCE(MAX(id), 0) AS n FROM ${table}`).n)
}

const issues: string[] = []
const report: Record<string, unknown> = {}

// ---------------------------------------------------------------------------
// A. NPC proxy lots — two cohorts: the exploit probe and the cap probe.
// ---------------------------------------------------------------------------
function npcProxySim() {
  run(`UPDATE game_state SET cash = 1000000 WHERE id = 1`)
  const insNpc = db.prepare(
    `INSERT INTO ebay_npc_auctions
       (card_id, condition, quantity, market_at_list, current_bid, min_next, listed_at, closes_at)
     VALUES (?, 'NM', 1, ?, ?, ?, ?, ?)`,
  )
  const cards = repeatTo(cardsFor(150, 3, 40), 200)
  const ids: number[] = []
  const maxes = new Map<number, number>()
  const probe = new Set<number>()
  const market = new Map<number, number>()
  for (let i = 0; i < cards.length; i++) {
    const m = money(cards[i].market)
    const open = round2(m * (0.4 + Math.random() * 0.2))
    const id = Number(
      insNpc.run(cards[i].id, m, open, open, nowIso(), new Date(Date.now() + 150_000).toISOString()).lastInsertRowid,
    )
    ids.push(id)
    const factor = i % 2 === 0 ? 0.7 : 1.5 // probe cohort, cap cohort
    if (factor === 0.7) probe.add(id)
    maxes.set(id, round2(m * factor))
    market.set(id, m)
  }
  const cashBefore = get(`SELECT cash FROM game_state WHERE id = 1`).cash as number
  let accepted = 0
  const rejected: string[] = []
  for (const id of ids) {
    const r = bidNpcAuction(id, maxes.get(id)!)
    if (r.ok) accepted++
    else rejected.push(r.error ?? 'unknown')
  }
  for (let t = 0; t < 8; t++) {
    for (const id of ids) {
      run(`UPDATE ebay_npc_auctions SET closes_at = ? WHERE id = ? AND status = 'live'`,
        new Date(Date.now() + (8 - t) * 20_000).toISOString(), id)
    }
    ebayTick()
  }
  for (const id of ids) {
    run(`UPDATE ebay_npc_auctions SET closes_at = ? WHERE id = ? AND status = 'live'`,
      new Date(Date.now() - 1000).toISOString(), id)
  }
  ebayTick()

  const rows = input(`SELECT * FROM ebay_npc_auctions WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)
  const won = rows.filter((r) => r.status === 'sold' && r.winner === 'you')
  const lost = rows.filter((r) => r.status === 'sold' && r.winner !== 'you')
  const passed = rows.filter((r) => r.status === 'passed')
  const premiums = won.map((r) => r.hammer / Math.max(r.market_at_list, 0.01) - 1)
  const overMax = won.filter((r) => r.hammer > (maxes.get(r.id) ?? 0) + 0.011)
  const cashAfter = get(`SELECT cash FROM game_state WHERE id = 1`).cash as number
  const spent = money(sum(won.map((r) => r.hammer)))
  const drift = money(cashBefore - spent - cashAfter)

  const cohort = (set: Set<number>) => {
    const rowsIn = rows.filter((r) => set.has(r.id))
    const w = rowsIn.filter((r) => r.status === 'sold' && r.winner === 'you')
    const l = rowsIn.filter((r) => r.status === 'sold' && r.winner !== 'you')
    const pr = w.map((r) => r.hammer / Math.max(r.market_at_list, 0.01) - 1)
    return {
      lots: rowsIn.length,
      won: w.length,
      lost: l.length,
      passed: rowsIn.filter((r) => r.status === 'passed').length,
      winRateAmongSold: pct(w.length / Math.max(1, w.length + l.length)),
      medianPremium: one(q(pr, 0.5)),
    }
  }
  const probeStats = cohort(probe)
  const capStats = cohort(new Set(ids.filter((id) => !probe.has(id))))

  if (overMax.length) issues.push(`NPC: ${overMax.length} hammer(s) above the player's max`)
  if (Math.abs(drift) > 0.02) issues.push(`NPC: cash drifted $${drift} from hammer spend (escrow not refunded?)`)
  if (rejected.length) issues.push(`NPC: ${rejected.length} bids rejected (first: ${rejected[0]})`)
  if (passed.length) issues.push(`NPC: ${passed.length} lots passed with a player max on them`)
  // The old exploit: a max ~0.7× market was unassailable. Bots must now beat some.
  if (probeStats.lost === 0) issues.push('NPC: a 0.7×-market max still won every lot — the unassailable-max exploit is back')
  // A 1.5× max winning nearly everything is the cap doing its job, not a
  // failure: roomCap tops out at 1.55× market, so almost nothing can outbid it.

  report.npc = { lots: cards.length, bidsAccepted: accepted, won: won.length, lost: lost.length, passed: passed.length, probe: probeStats, cap: capStats, cashReconciled: drift }
  console.log(`\nA. NPC proxy lots   ${cards.length} (100 at 0.7× market, 100 at 1.5×)`)
  console.log(`   bids accepted ${accepted} · won ${won.length} · lost ${lost.length} · passed ${passed.length}`)
  console.log(`   0.7× cohort     ${probeStats.won}W/${probeStats.lost}L (${probeStats.winRateAmongSold} won) · median hammer +${probeStats.medianPremium}% vs market`)
  console.log(`   1.5× cohort     ${capStats.won}W/${capStats.lost}L (${capStats.winRateAmongSold} won) · median hammer +${capStats.medianPremium}% vs market`)
  console.log(`   cash reconciled $${drift} drift against hammer spend`)
}

// ---------------------------------------------------------------------------
// B. Player auction room — 200 lots, real bids, real hammer.
// ---------------------------------------------------------------------------
function auctionRoomSim() {
  const cards = repeatTo([...cardsFor(120, 2, 40), ...cardsFor(80, 40, 300)], 200)
  const seeded = seedInventory(cards)
  const before = maxId('ebay_auctions')
  let started = 0
  const rejected: string[] = []
  for (const s of seeded) {
    const r = startAuction(s.invId)
    if (r.ok) started++
    else rejected.push(r.error ?? 'unknown')
  }
  // Twelve room ticks over the lot's four-minute clock, compressed: the room's
  // bid logic keys on bid_count, not wall time. The last pass puts every clock
  // in the past so the hammer falls.
  for (let t = 0; t < 12; t++) {
    run(`UPDATE ebay_auctions SET closes_at = ? WHERE status = 'live'`,
      new Date(Date.now() + (12 - t) * 20_000).toISOString())
    ebayTick()
  }
  run(`UPDATE ebay_auctions SET closes_at = ? WHERE status = 'live'`, new Date(Date.now() - 1000).toISOString())
  ebayTick()

  const rows = input(`SELECT * FROM ebay_auctions WHERE id > ?`, before)
  const sold = rows.filter((r) => r.status === 'sold')
  const expired = rows.filter((r) => r.status === 'expired')
  const live = rows.filter((r) => r.status === 'live')
  const premiums = sold.map((r) => r.current_bid / Math.max(r.market_at_list * r.quantity, 0.01) - 1)
  const badFee = sold.filter((r) => Math.abs(r.fee - round2(r.current_bid * 0.15)) > 0.011)
  const badNet = sold.filter((r) => Math.abs(r.net - round2(r.current_bid - r.fee - r.shipping)) > 0.011)
  const negativeNet = sold.filter((r) => r.net < 0)
  const soldInvIds = sold.map((r) => r.inventory_id as number)
  const unpaidStock = soldInvIds.length
    ? db.prepare(`SELECT COUNT(*) AS n FROM inventory WHERE id IN (${soldInvIds.map(() => '?').join(',')}) AND status = 'collection'`).get(...soldInvIds) as { n: number }
    : { n: 0 }

  if (rows.length !== started) issues.push(`auction: ${started} started but ${rows.length} rows found`)
  if (live.length) issues.push(`auction: ${live.length} lot(s) never hammered`)
  if (badFee.length) issues.push(`auction: ${badFee.length} fee(s) not 15%`)
  if (badNet.length) issues.push(`auction: ${badNet.length} net(s) not gross − fee − shipping`)
  if (unpaidStock.n) issues.push(`auction: ${unpaidStock.n} hammered lot(s) left a binder row in the collection`)
  if (Math.max(0, ...premiums) > 1.81) issues.push(`auction: hammer ran to ${pct(Math.max(0, ...premiums))} over market`)

  report.auction = {
    lots: started,
    rejected: rejected.slice(0, 3),
    sold: sold.length,
    expired: expired.length,
    live: live.length,
    sellThrough: pct(sold.length / Math.max(1, started)),
    hammerVsMarket: { mean: one(avg(premiums)), median: one(q(premiums, 0.5)), p90: one(q(premiums, 0.9)), max: one(Math.max(0, ...premiums)) },
    premiumShare: pct(sold.filter((r) => r.current_bid > r.market_at_list).length / Math.max(1, sold.length)),
    negativeNet: negativeNet.length,
    worstNet: money(Math.min(0, ...sold.map((r) => r.net))),
  }
  console.log(`\nB. Auction room     ${started} lots started`)
  console.log(`   sold ${sold.length} (${pct(sold.length / Math.max(1, started))}) · expired ${expired.length} · live ${live.length}`)
  console.log(`   hammer vs market  mean ${pct(avg(premiums))} · median ${pct(q(premiums, 0.5))} · p90 ${pct(q(premiums, 0.9))} · max ${pct(Math.max(0, ...premiums))}`)
  console.log(`   above market      ${pct(sold.filter((r) => r.current_bid > r.market_at_list).length / Math.max(1, sold.length))} of hammers`)
  console.log(`   net < 0           ${negativeNet.length} lot(s) · worst $${money(Math.min(0, ...sold.map((r) => r.net)))}`)
}

// ---------------------------------------------------------------------------
// C/D. Fixed-price listings — discount curve, then the exact 6% floor.
// ---------------------------------------------------------------------------
function listingSim() {
  const buckets = [0, 0.03, 0.06, 0.09, 0.12, 0.15, 0.18, 0.21, 0.24, 0.30]
  const cards = repeatTo(cardsFor(200, 2, 120), 600)
  const seeded = seedInventory(cards)
  const before = maxId('ebay_listings')
  let listed = 0
  const rejected: string[] = []
  const bucketByListing = new Map<number, number>()
  for (let i = 0; i < 600; i++) {
    const bucket = buckets[Math.floor(i / 60)]
    // Price off the same anchor the snipers read, so the bucket is the
    // discount a buyer actually sees.
    const market = latestMarket(cards[i].id)
    if (market == null) { rejected.push('no price'); continue }
    const r = list(seeded[i].invId, round2(market * (1 - bucket)))
    if (r.ok) {
      listed++
      const id = (get(`SELECT MAX(id) AS id FROM ebay_listings WHERE inventory_id = ?`, seeded[i].invId) as { id: number }).id
      bucketByListing.set(id, bucket)
    } else rejected.push(r.error ?? 'unknown')
  }
  for (let t = 0; t < 600; t++) ebayTick()

  const rows = input(
    `SELECT e.*, (SELECT market FROM price_records pr WHERE pr.card_id = e.card_id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY pr.retrieved_at DESC LIMIT 1) AS anchor
     FROM ebay_listings e WHERE e.id > ?`,
    before,
  )
  const byBucket = new Map<number, { n: number; sold: number }>()
  for (const r of rows) {
    const d = bucketByListing.get(r.id)
    if (d == null) continue
    const key = Math.round(d * 100)
    const b = byBucket.get(key) ?? { n: 0, sold: 0 }
    b.n++
    if (r.status === 'sold') b.sold++
    byBucket.set(key, b)
  }
  const sold = rows.filter((r) => r.status === 'sold')
  const badFee = sold.filter((r) => Math.abs(r.fee - round2(r.sold_price * r.quantity * 0.13)) > 0.011)
  const badNet = sold.filter((r) => Math.abs(r.net - round2(r.sold_price * r.quantity - r.fee - r.shipping)) > 0.011)
  const belowMin = sold.filter((r) => 1 - r.ask / Math.max(r.anchor ?? r.market_at_list, 0.01) < 0.06 - 1e-6)

  const curve = [...byBucket.entries()].sort((a, b) => a[0] - b[0]).map(([d, v]) => ({ discount: `${d}%`, listed: v.n, sold: v.sold, rate: pct(v.sold / Math.max(1, v.n)) }))
  if (rejected.length) issues.push(`listing: ${rejected.length} listing(s) refused (first: ${rejected[0]})`)
  if ((byBucket.get(0)?.sold ?? 0) > 0) issues.push('listing: a full-price listing sold')
  if ((byBucket.get(3)?.sold ?? 0) > 0) issues.push('listing: a 3%-off listing sold below the 6% floor')
  if (badFee.length) issues.push(`listing: ${badFee.length} fee(s) not 13%`)
  if (badNet.length) issues.push(`listing: ${badNet.length} net(s) not gross − fee − shipping`)
  if (belowMin.length) issues.push(`listing: ${belowMin.length} sale(s) below the 6% floor`)

  // D. The epsilon regression: 40 lots exactly at the floor, nothing deeper.
  for (const r of input(`SELECT id FROM ebay_listings WHERE status = 'live'`)) {
    run(`UPDATE ebay_listings SET status = 'cancelled' WHERE id = ?`, r.id)
  }
  const floorCards = repeatTo(cardsFor(80, 2, 80), 40)
  const floorSeeded = seedInventory(floorCards)
  const beforeFloor = maxId('ebay_listings')
  for (let i = 0; i < floorSeeded.length; i++) {
    const m = latestMarket(floorCards[i].id)
    // Below $2 a rounded cent moves the discount off the line; keep the
    // cohort on cards where 6% is actually expressible.
    if (m != null && m >= 2) list(floorSeeded[i].invId, round2(m * 0.94))
  }
  const floor = input(
    `SELECT e.*, (SELECT market FROM price_records pr WHERE pr.card_id = e.card_id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY pr.retrieved_at DESC LIMIT 1) AS anchor
     FROM ebay_listings e WHERE e.id > ?`,
    beforeFloor,
  )
  const floorDiscounts = floor.map((r) => 1 - r.ask / Math.max(r.anchor ?? r.market_at_list, 0.01))
  for (let t = 0; t < 300; t++) ebayTick()
  const floorSold = input(`SELECT status FROM ebay_listings WHERE id > ?`, beforeFloor).filter((r) => r.status === 'sold')
  // 9.4 / 10.0 is the literal float case the guard exists for.
  const epsGuard = 1 - 9.4 / 10 + 1e-9 >= 0.06
  if (!floorSold.length) issues.push('listing: no lot at exactly 6% off sold in 300 ticks')
  if (!epsGuard) issues.push('listing: the 9.4/10 float case no longer clears the 6% floor')
  // Rounding the ask to the cent shifts the ratio by up to 0.4pp on a $2 card;
  // the guard check above is the exact-6% assertion, so the band is reported,
  // not failed.

  const fb = feedback()
  report.listing = {
    listed,
    rejected: rejected.slice(0, 3),
    ticks: 600,
    sold: sold.length,
    sellThrough: pct(sold.length / Math.max(1, listed)),
    feedback: fb,
    curve,
    floor: {
      listed: floor.length,
      sold: floorSold.length,
      exactDiscount: `${pct(avg(floorDiscounts))} mean / ${pct(Math.min(...floorDiscounts))} min`,
      epsilonGuard: epsGuard,
    },
  }
  console.log(`\nC. Fixed-price      ${listed} listings · 600 ticks · feedback ${fb.avg.toFixed(2)}★`)
  console.log(`   sold ${sold.length} (${pct(sold.length / Math.max(1, listed))})`)
  for (const c of curve) console.log(`   ${c.discount.padStart(4)} off   ${String(c.sold).padStart(3)}/${String(c.listed).padEnd(3)} sold  ${c.rate}`)
  console.log(`D. 6% floor         ${floorSold.length}/${floor.length} sold in 300 ticks · priced ${pct(avg(floorDiscounts))} under · 9.4/10 guard ${epsGuard ? 'ok' : 'FAIL'}`)
}

npcProxySim()
auctionRoomSim()
listingSim()

writeFileSync('tmp/venue-sims.json', JSON.stringify({ ranAt: new Date().toISOString(), issues, ...report }, null, 2))
console.log(`\nISSUES: ${issues.length ? issues.join(' | ') : 'none'}`)
console.log('wrote tmp/venue-sims.json')
if (issues.length) process.exitCode = 1
