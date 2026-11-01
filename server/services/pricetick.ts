import { db, getMeta, setMeta, logActivity, nowIso } from '../lib/db'
import { gameDayKey } from '../lib/gameday'
import * as market from './market'
import * as sync from './sync'

// ---------------------------------------------------------------------------
// Prices advance on the game clock, not the wall clock.
// ---------------------------------------------------------------------------
// Every price surface in the game — your portfolio, the market feed, the sim
// market that stands in when an upstream is dry — is quoted once per GAME DAY
// (12 real hours at the default pace, 24 at the slow one). The old jobs ran on
// 24-hour wall-clock gaps, so half the game days came and went without a
// single quote moving: an overnight portfolio, a 36-pack display you sat on,
// a card you were watching — all frozen for a day that didn't exist.
//
// The tick runs at most every 20s (see market.tick), so this is the natural
// place to notice a day has turned. Each job is guarded by its own game-day
// key, which makes it idempotent: the first tick after midnight does the work,
// every later tick that day is a couple of meta reads.

const K_SNAPSHOT = 'lastPriceSnapshotDay'
const K_SIM = 'lastSimMarketDay'
const K_OWNED = 'lastOwnedPriceRefreshDay'
const K_OWNED_FAIL = 'lastOwnedRefreshFailAt'
const OWNED_RETRY_MS = 30 * 60_000

let ownedRunning = false

/** History points for the charts: one per game day, plus days missed while out. */
function snapshotDay(today: string): void {
  try {
    const n = market.takeSnapshot()
    setMeta(K_SNAPSHOT, today)
    if (n > 0) console.log(`[snapshot] day ${today}: stored ${n} price points into history`)
  } catch (err) {
    console.warn('[snapshot] day snapshot failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * The simulated market (the honest fallback tier for cards with no live
 * quote) drifts once per game day too — otherwise a card with no external
 * price would sit at the same number for a whole day of play.
 */
function simMarketDay(today: string): void {
  try {
    const r = market.refreshSimulatedMarket()
    setMeta(K_SIM, today)
    if (r.cards > 0) console.log(`[sim] day ${today}: ${r.cards} simulated quote(s) re-rolled`)
  } catch (err) {
    console.warn('[sim] day drift failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Real quotes for what you own or want (TCGplayer + Cardmarket through the
 * ladder). Network-bound, so it runs in the background: the day key is only
 * stamped once it actually succeeded, and a failed pass retries no more often
 * than every half hour so an upstream outage doesn't turn into a hammer.
 */
async function ownedPricesDay(today: string): Promise<void> {
  if (ownedRunning) return
  const failAt = getMeta(K_OWNED_FAIL)
  if (failAt && Date.now() - new Date(failAt).getTime() < OWNED_RETRY_MS) return
  ownedRunning = true
  try {
    const r = await sync.refreshOwnedPrices()
    setMeta(K_OWNED, today)
    if (r.cards > 0) {
      logActivity('market', `💹 Day ${today}: re-priced ${r.cards} card${r.cards === 1 ? '' : 's'} you hold or watch${r.updated > 0 ? ` — ${r.updated} moved` : ''}`, 0)
    }
  } catch (err) {
    setMeta(K_OWNED_FAIL, nowIso())
    console.warn('[sync] owned price refresh failed (retry in 30 min):', err instanceof Error ? err.message : err)
  } finally {
    ownedRunning = false
  }
}

/** Called from market.tick(): at most one price pass per game day. */
export function priceDayTick(): void {
  let today: string
  try {
    today = gameDayKey()
  } catch {
    return
  }
  if (getMeta(K_SNAPSHOT) !== today) snapshotDay(today)
  if (getMeta(K_SIM) !== today) simMarketDay(today)
  if (getMeta(K_OWNED) !== today) void ownedPricesDay(today)
}

/** What the Settings/diagnostics surface can read back. */
export function priceTickStatus() {
  const today = gameDayKey()
  return {
    day: today,
    snapshotDay: getMeta(K_SNAPSHOT) ?? null,
    simDay: getMeta(K_SIM) ?? null,
    ownedDay: getMeta(K_OWNED) ?? null,
    lastFailureAt: getMeta(K_OWNED_FAIL) ?? null,
    current: getMeta(K_SNAPSHOT) === today && getMeta(K_SIM) === today && getMeta(K_OWNED) === today,
  }
}

export function priceTickMetaKeys(): string[] {
  return [K_SNAPSHOT, K_SIM, K_OWNED, K_OWNED_FAIL]
}
