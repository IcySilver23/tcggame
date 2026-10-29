// ---------------------------------------------------------------------------
// The benchmark, with real history — the S&P what-if on the portfolio stops
// being a flat ~10%/yr line when a free source can say what the index
// actually did across the save's span. Yahoo Finance's public chart endpoint
// (^GSPC, no key, query1 → query2) is the source, cached into benchmark_cache
// like the price ladder caches card comps: real closes first, the long-run
// ~10%/yr model honestly labeled when the network is dry. The cache covers
// the whole save span (a week of buffer past today) and tops up on the same
// 6h cadence as the other syncs; a failed fetch leaves the old closes in
// place and the portfolio degrades to the model instead of lying.
// ---------------------------------------------------------------------------

import { db, getMeta, setMeta } from '../lib/db'

const MODEL_ANNUAL = 0.10 // the index's long-run average — the what-if, not advice
const DAY_MS = 86_400_000
const FETCH_COOLDOWN_MS = 6 * 3600_000 // covered spans re-check twice a day
const ATTEMPT_COOLDOWN_MS = 5 * 60_000 // failing endpoints get retried, not hammered

// One-time table for saves that predate it (schema.sql carries the same DDL
// for fresh saves). PK on day means upserts are idempotent across restarts.
try {
  db.exec(`CREATE TABLE IF NOT EXISTS benchmark_cache (
    day TEXT PRIMARY KEY,               -- close date, 'YYYY-MM-DD' UTC
    close REAL NOT NULL                 -- ^GSPC level at that close
  )`)
} catch (e) {
  console.log('[benchmark] cache table unavailable:', e instanceof Error ? e.message : e)
}

export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// The span real closes should cover: everything the portfolio can anchor to
// (save creation + every snapshot), a little before for the base-close lookup,
// and a week past today so weekend boots don't look stale.
function spanBounds(): { from: string; to: string } {
  const r = db
    .prepare(`SELECT MIN(t) AS t FROM (
                SELECT snapshotted_at AS t FROM networth_history
                UNION SELECT created_at FROM game_state
              )`)
    .get() as { t: string | null }
  const fromMs = r.t ? new Date(r.t).getTime() - 10 * DAY_MS : Date.now() - 30 * DAY_MS
  return { from: isoDay(fromMs), to: isoDay(Date.now() + 7 * DAY_MS) }
}

function cacheCovers(): boolean {
  const { from } = spanBounds()
  const g = db.prepare(`SELECT MIN(day) AS a, MAX(day) AS b FROM benchmark_cache`).get() as { a: string | null; b: string | null }
  // 'Covered' means the cache can answer the span's two needs: a base close
  // at/near the span start (the exact −10d bound may be a weekend, so a close
  // landing a few days later still serves as the anchor) and a close within
  // the last few days at the tail (weekends and holidays included — the tail
  // can never be a future date, so demanding one is a forever-refetch).
  const headOk = isoDay(new Date(`${from}T00:00:00Z`).getTime() + 5 * DAY_MS)
  const tailOk = isoDay(Date.now() - 5 * DAY_MS)
  return !!(g.a && g.b && g.a <= headOk && g.b >= tailOk)
}

type YahooChart = {
  chart?: {
    result?: {
      timestamp?: number[]
      indicators?: { quote?: { close?: (number | null)[] }[] }
    }[]
  }
}

async function fetchYahooCloses(host: 'query1' | 'query2', from: string, to: string): Promise<{ day: string; close: number }[] | null> {
  const p1 = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000)
  const p2 = Math.floor(new Date(`${to}T00:00:00Z`).getTime() / 1000) + DAY_MS / 1000
  const url = `https://${host}.finance.yahoo.com/v8/finance/chart/%5EGSPC?period1=${p1}&period2=${p2}&interval=1d`
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TCG-Life/1.0)', Accept: 'application/json' },
    })
    if (!res.ok) {
      console.log(`[benchmark] ${host} HTTP ${res.status}`)
      return null
    }
    const j = (await res.json()) as YahooChart
    const stamps = j.chart?.result?.[0]?.timestamp
    const closes = j.chart?.result?.[0]?.indicators?.quote?.[0]?.close
    if (!Array.isArray(stamps) || !Array.isArray(closes)) return null
    const out: { day: string; close: number }[] = []
    for (let i = 0; i < stamps.length; i++) {
      const c = closes[i]
      if (c == null || !Number.isFinite(c) || c <= 0) continue
      out.push({ day: isoDay(stamps[i] * 1000), close: c })
    }
    return out.length > 0 ? out : null
  } catch (e) {
    // Timeouts, 429s, JSON surprises — the model takes the shift. The reason
    // lands in the server log so a dry feed is diagnosable, not mysterious.
    console.log(`[benchmark] ${host} fetch failed:`, e instanceof Error ? e.message : e)
    return null
  }
}

// Keep the cache covering the save span. Upsert (Yahoo occasionally revises a
// close) and throttle: a covered cache re-checks twice a day, an uncovered or
// failing one gets one attempt per five minutes — enough to catch up after a
// boot-time outage without hammering on every /api/portfolio hit.
export async function refreshBenchmarkCache(): Promise<{ fetched: number; covered: boolean }> {
  const covered = cacheCovers()
  const last = getMeta('lastBenchFetchAt')
  const since = last ? Date.now() - new Date(last).getTime() : Infinity
  if (covered && since < FETCH_COOLDOWN_MS) return { fetched: 0, covered: true }
  if (since < ATTEMPT_COOLDOWN_MS) return { fetched: 0, covered }
  const { from, to } = spanBounds()
  for (const host of ['query1', 'query2'] as const) {
    const rows = await fetchYahooCloses(host, from, to)
    if (rows && rows.length) {
      const ins = db.prepare(`INSERT INTO benchmark_cache (day, close) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET close = excluded.close`)
      db.transaction((rs: { day: string; close: number }[]) => {
        for (const r of rs) ins.run(r.day, r.close)
      })(rows)
      setMeta('lastBenchFetchAt', new Date().toISOString())
      setMeta('lastBenchFetchOkAt', new Date().toISOString())
      setMeta('lastBenchHost', host)
      return { fetched: rows.length, covered: cacheCovers() }
    }
  }
  console.log('[benchmark] no closes fetched from either host — falling back to the model until the next attempt')
  return { fetched: 0, covered }
}

export type Benchmark = {
  mode: 'real' | 'model'
  // Index multiple vs the span start (1.0 at anchor) for any ISO timestamp
  // in the span — the portfolio chart and what-if panel both read this.
  multipleAt: (iso: string) => number
  spanReturnPct: number
  note: string
}

// Settings-panel status row: the feed's live state in one payload — rows
// cached and their window, the last ATTEMPT vs the last SUCCESS (a streak of
// failed attempts shows as stale), which host served last, and whether the
// portfolio is currently computing from real closes or the labeled model.
export function benchmarkStatus(): {
  rows: number
  oldestDay: string | null
  newestDay: string | null
  covered: boolean
  lastFetchAt: string | null
  lastSuccessAt: string | null
  lastHost: 'query1' | 'query2' | null
  mode: 'real' | 'model'
} {
  const g = db.prepare(`SELECT COUNT(*) AS n, MIN(day) AS a, MAX(day) AS b FROM benchmark_cache`).get() as { n: number; a: string | null; b: string | null }
  return {
    rows: g.n,
    oldestDay: g.a,
    newestDay: g.b,
    covered: g.n > 0 && cacheCovers(),
    lastFetchAt: getMeta('lastBenchFetchAt'),
    lastSuccessAt: getMeta('lastBenchFetchOkAt'),
    lastHost: (getMeta('lastBenchHost') as 'query1' | 'query2' | null) ?? null,
    mode: computeBenchmark(
      (db.prepare(`SELECT created_at FROM game_state WHERE id = 1`).get() as { created_at: string } | undefined)?.created_at ?? null,
      Date.now(),
    ).mode,
  }
}

function modelBenchmark(startMs: number, endMs: number): Benchmark {
  const spanDays = Math.max(0, (endMs - startMs) / DAY_MS)
  return {
    mode: 'model',
    multipleAt: (iso) => Math.pow(1 + MODEL_ANNUAL, Math.max(0, (new Date(iso).getTime() - startMs) / DAY_MS) / 365),
    spanReturnPct: Math.pow(1 + MODEL_ANNUAL, spanDays / 365) - 1,
    note: `No live index feed right now — modeled at the S&P 500's long-run ~10%/yr over the save's span. The what-if, not the history.`,
  }
}

// Real or modeled index performance from the save's anchor (created_at, or
// the first snapshot when that's missing) to now. Real mode anchors at the
// last close on or before the span start — money "in at the start" buys at
// that close — and requires a usable cache; anything less falls back to the
// honestly-labeled model.
export function computeBenchmark(startIso: string | null, endMs: number): Benchmark {
  // No anchor (no created_at row) — there is no span, so the what-if stays flat.
  if (!startIso) return modelBenchmark(endMs, endMs)
  const startMs = new Date(startIso).getTime()
  const startDay = isoDay(startMs)
  const dInt = Math.max(1, Math.round((endMs - startMs) / DAY_MS))
  const dayPl = dInt === 1 ? 'day' : 'days'

  const n = (db.prepare(`SELECT COUNT(*) AS n FROM benchmark_cache`).get() as { n: number }).n
  if (n < 2) return modelBenchmark(startMs, endMs)
  const baseRow = db
    .prepare(`SELECT day, close FROM benchmark_cache WHERE day <= ? ORDER BY day DESC LIMIT 1`)
    .get(startDay) as { day: string; close: number } | undefined
  if (!baseRow || baseRow.close <= 0) return modelBenchmark(startMs, endMs)

  const closeOnOrBefore = db.prepare(`SELECT close FROM benchmark_cache WHERE day <= ? ORDER BY day DESC LIMIT 1`)
  const lastClose = db.prepare(`SELECT close FROM benchmark_cache ORDER BY day DESC LIMIT 1`).get() as { close: number } | undefined

  return {
    mode: 'real',
    multipleAt: (iso) => {
      const day = isoDay(new Date(iso).getTime())
      if (day <= baseRow.day) return 1
      const r = closeOnOrBefore.get(day) as { close: number | null } | undefined
      const c = r?.close ?? lastClose?.close
      return c && c > 0 ? c / baseRow.close : 1
    },
    spanReturnPct: lastClose && lastClose.close > 0 ? lastClose.close / baseRow.close - 1 : 0,
    note: `Real S&P 500 closes (Yahoo Finance) — what the index actually did across your ${dInt} real ${dayPl}, anchored at the ${baseRow.day} close. The comparison, not the textbook average.`,
  }
}
