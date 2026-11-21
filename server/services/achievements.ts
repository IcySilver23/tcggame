import { db, nowIso, logActivity, setMeta } from '../lib/db'
import { gameDayKey } from '../lib/gameday'
import { round2, valueOf, withTcgPriceCache } from './market'

// ---------------------------------------------------------------------------
// Achievements & milestones.
//
// Every badge is a pure read of the real tables — no parallel bookkeeping to
// drift out of sync. The evaluator runs once per game day: it computes each
// definition's progress, unlocks anything at 100%, and announces new badges
// in the feed ("🏆 …") exactly once. Unlocks are remembered in the
// achievements table; everything else is recomputed.
//
// Tiers: many badges come in ladders (first sale → $1k → $10k…). A ladder is
// one definition whose `tier` field names the rung; only the highest reached
// rung is displayed as "next up".
// ---------------------------------------------------------------------------

export type AchievementDef = {
  id: string
  icon: string
  title: string
  /** One-line description of what the badge celebrates. */
  desc: string
  group: 'collection' | 'business' | 'grading' | 'streaks' | 'empire'
  /** 0..1 progress right now, plus an optional human "x / y" label. */
  progress: () => { pct: number; label?: string }
  /** Ladder rung, for badges that come in families (lower = earlier). */
  tier?: number
}

const one = (sql: string): number => {
  try {
    return (db.prepare(sql).get() as { n: number }).n
  } catch {
    return 0
  }
}

// --- Collection -------------------------------------------------------------

// One pass to count owned cards per set, then join the catalogue totals. The
// old correlated subquery re-scanned every card in the set for each set, and
// the badge evaluator asked for it four times per request (~5s on a 20k-card
// catalogue). The result is now computed once per evaluation.
const COMPLETION_IDS = `
  WITH owned AS (
    SELECT c.set_id, COUNT(DISTINCT i.card_id) AS owned
    FROM inventory i JOIN cards c ON c.id = i.card_id
    WHERE i.status IN ('collection','grading')
    GROUP BY c.set_id
  )
  SELECT s.id, s.name, COUNT(c.id) AS total, COALESCE(o.owned, 0) AS owned
  FROM sets s
  JOIN cards c ON c.set_id = s.id
  LEFT JOIN owned o ON o.set_id = s.id
  GROUP BY s.id HAVING total >= 8 AND owned > 0`

type CompletionRow = { id: string; name: string; total: number; owned: number }
let completionRowsCache: CompletionRow[] | null = null

function completionRows(): CompletionRow[] {
  if (!completionRowsCache) completionRowsCache = db.prepare(COMPLETION_IDS).all() as CompletionRow[]
  return completionRowsCache
}

function bestSetCompletion(): { name: string; pct: number; owned: number; total: number } | null {
  try {
    const rows = completionRows()
    if (rows.length === 0) return null
    const best = rows.reduce((a, b) => (b.owned / b.total > a.owned / a.total ? b : a))
    return { name: best.name, pct: best.owned / best.total, owned: best.owned, total: best.total }
  } catch {
    return null
  }
}

function completedSetsCount(): number {
  try {
    return completionRows().filter((r) => r.owned >= r.total).length
  } catch {
    return 0
  }
}

// --- Business ---------------------------------------------------------------

const PROFIT_TIERS = [
  { id: 'profit_100', tier: 1, at: 100, label: '$100' },
  { id: 'profit_1k', tier: 2, at: 1000, label: '$1,000' },
  { id: 'profit_10k', tier: 3, at: 10000, label: '$10,000' },
  { id: 'profit_100k', tier: 4, at: 100000, label: '$100,000' },
]
const NW_TIERS = [
  { id: 'nw_5k', tier: 1, at: 5000, label: '$5,000' },
  { id: 'nw_25k', tier: 2, at: 25000, label: '$25,000' },
  { id: 'nw_100k', tier: 3, at: 100000, label: '$100,000' },
  { id: 'nw_1m', tier: 4, at: 1000000, label: '$1,000,000' },
]
const SALES_TIERS = [
  { id: 'sales_1', tier: 1, at: 1, label: 'first sale' },
  { id: 'sales_50', tier: 2, at: 50, label: '50 sales' },
  { id: 'sales_250', tier: 3, at: 250, label: '250 sales' },
]

function realizedProfit(): number {
  return one(`SELECT COALESCE(SUM(profit), 0) AS n FROM sale_history`)
}

function netWorth(): number {
  try {
    const row = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number } | undefined
    const cash = row?.cash ?? 0
    // Inventory at cost + cash — a honest, fast proxy the badge can read daily.
    const inv = one(`SELECT COALESCE(SUM(CASE WHEN status != 'sold' THEN quantity * cost_basis ELSE 0 END), 0) AS n FROM inventory`)
    return round2(cash + inv)
  } catch {
    return 0
  }
}

// --- Grading ----------------------------------------------------------------

function gemStats(): { gems: number; submitted: number; rate: number } {
  const gems = one(`SELECT COUNT(*) AS n FROM inventory WHERE graded_grade LIKE '%10%'`)
  const submitted = one(`SELECT COUNT(*) AS n FROM inventory WHERE graded_grade IS NOT NULL`)
  return { gems, submitted, rate: submitted > 0 ? gems / submitted : 0 }
}

// --- Empire -----------------------------------------------------------------

function chainSize(): number {
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM franchise`).get() as { n: number }).n
  } catch {
    return 0
  }
}

function hasDistrict(): boolean {
  try {
    return !!db.prepare(`SELECT 1 FROM meta WHERE key = 'chain:districtManager' LIMIT 1`).get()
  } catch {
    return false
  }
}

function hasRegional(): boolean {
  try {
    return !!db.prepare(`SELECT 1 FROM regional_managers WHERE id = 1 LIMIT 1`).get()
  } catch {
    return false
  }
}

function rivalBought(): boolean {
  try {
    return !!db.prepare(`SELECT 1 FROM meta WHERE key = 'rival:closed' LIMIT 1`).get()
  } catch {
    return false
  }
}

function shopRep(): number {
  try {
    return (db.prepare(`SELECT reputation FROM shop WHERE id = 1`).get() as { reputation: number } | undefined)?.reputation ?? 0
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// The wall
// ---------------------------------------------------------------------------

export const DEFS: AchievementDef[] = [
  // Collection
  { id: 'first_card', icon: '🃏', title: 'A Single Card', desc: 'Own your first card.', group: 'collection', progress: () => ({ pct: Math.min(1, one(`SELECT COALESCE(SUM(quantity),0) AS n FROM inventory WHERE status != 'sold'`) / 1) }) },
  { id: 'cards_100', icon: '📚', title: 'Shelf Respect', desc: 'Own 100 cards at once.', group: 'collection', progress: () => ({ pct: Math.min(1, one(`SELECT COALESCE(SUM(quantity),0) AS n FROM inventory WHERE status != 'sold'`) / 100), label: `${one(`SELECT COALESCE(SUM(quantity),0) AS n FROM inventory WHERE status != 'sold'`)} / 100` }) },
  { id: 'cards_1000', icon: '🏛', title: 'The Long Box Era', desc: 'Own 1,000 cards at once.', group: 'collection', tier: 2, progress: () => ({ pct: Math.min(1, one(`SELECT COALESCE(SUM(quantity),0) AS n FROM inventory WHERE status != 'sold'`) / 1000), label: `${one(`SELECT COALESCE(SUM(quantity),0) AS n FROM inventory WHERE status != 'sold'`)} / 1000` }) },
  { id: 'set_complete_1', icon: '🧩', title: 'The Completionist', desc: 'Complete every card in a set (8+ cards).', group: 'collection', progress: () => { const b = bestSetCompletion(); const done = completedSetsCount(); if (done >= 1) return { pct: 1, label: `${done} set${done === 1 ? '' : 's'} complete` }; return b ? { pct: b.pct, label: `${b.owned} / ${b.total} in ${b.name}` } : { pct: 0 } } },
  { id: 'set_complete_3', icon: '🎰', title: 'Serial Completionist', desc: 'Complete 3 sets.', group: 'collection', tier: 2, progress: () => ({ pct: Math.min(1, completedSetsCount() / 3), label: `${completedSetsCount()} / 3 sets` }) },
  { id: 'whale_set', icon: '🐋', title: 'Whale Set', desc: 'Hold a completed set worth $1,000+.', group: 'collection', progress: () => { const done = whaleSet(); return { pct: Math.min(1, done / 1000), label: done > 0 ? `$${Math.round(done).toLocaleString()} best set` : undefined } } },

  // Business
  ...PROFIT_TIERS.map((t) => ({
    id: t.id,
    icon: t.tier! >= 3 ? '💎' : '💵',
    title: t.tier! === 1 ? 'Pocket Money' : t.tier! === 2 ? 'Real Money' : t.tier! === 3 ? 'Serious Money' : 'Generational',
    desc: `Bank ${t.label} of realized profit across every sale.`,
    group: 'business' as const,
    tier: t.tier,
    progress: () => ({ pct: Math.min(1, realizedProfit() / t.at), label: `$${Math.max(0, Math.round(realizedProfit())).toLocaleString()} / ${t.label}` }),
  })),
  ...NW_TIERS.map((t) => ({
    id: t.id,
    icon: '📈',
    title: t.tier! === 1 ? 'On the Board' : t.tier! === 2 ? 'Room to Grow' : t.tier! === 3 ? 'Certified Player' : 'The Map Is You',
    desc: `Reach ${t.label} net worth.`,
    group: 'business' as const,
    tier: t.tier,
    progress: () => ({ pct: Math.min(1, netWorth() / t.at), label: `$${Math.round(netWorth()).toLocaleString()} / ${t.label}` }),
  })),
  ...SALES_TIERS.map((t) => ({
    id: t.id,
    icon: '🧾',
    title: t.tier! === 1 ? 'First Blood' : t.tier! === 2 ? 'The Habit' : 'The Machine',
    desc: t.tier! === 1 ? 'Ring your first sale.' : `Ring ${t.label}.`,
    group: 'business' as const,
    tier: t.tier,
    progress: () => ({ pct: Math.min(1, one(`SELECT COUNT(*) AS n FROM sale_history`) / t.at), label: `${one(`SELECT COUNT(*) AS n FROM sale_history`)} / ${t.at}` }),
  })),
  { id: 'rep_50', icon: '⭐', title: 'Known in Town', desc: 'Reach 50 shop reputation.', group: 'business', progress: () => ({ pct: Math.min(1, shopRep() / 50), label: `rep ${shopRep()} / 50` }) },
  { id: 'rep_85', icon: '🌟', title: 'Beloved', desc: 'Reach 85 shop reputation.', group: 'business', tier: 2, progress: () => ({ pct: Math.min(1, shopRep() / 85), label: `rep ${shopRep()} / 85` }) },
  { id: 'rival_buyout', icon: '🔑', title: 'Whole Block Owner', desc: 'Buy out the rival shop across the street.', group: 'business', progress: () => ({ pct: rivalBought() ? 1 : 0 }) },

  // Grading
  { id: 'first_gem', icon: '✨', title: 'First Gem', desc: 'Pull a GEM MINT 10 back from the graders.', group: 'grading', progress: () => ({ pct: gemStats().gems >= 1 ? 1 : 0 }) },
  { id: 'gems_10', icon: '💠', title: 'Gem Collector', desc: 'Hold 10 gem-graded cards.', group: 'grading', tier: 2, progress: () => ({ pct: Math.min(1, gemStats().gems / 10), label: `${gemStats().gems} / 10 gems` }) },
  { id: 'gem_rate_30', icon: '🎯', title: 'The Sharp Eye', desc: 'GEM rate of 30%+ across 20+ graded cards.', group: 'grading', progress: () => { const g = gemStats(); return { pct: g.submitted >= 20 ? Math.min(1, g.rate / 0.3) : g.submitted / 20 * (g.rate / 0.3), label: `${g.gems}/${g.submitted} gems` } } },

  // Streaks
  { id: 'streak_3', icon: '🔥', title: 'Warming Up', desc: 'Show up 3 days in a row.', group: 'streaks', progress: () => ({ pct: Math.min(1, activeStreak() / 3), label: `${activeStreak()} / 3 days` }) },
  { id: 'streak_7', icon: '⚡', title: 'The Weekly', desc: 'Show up 7 days in a row.', group: 'streaks', tier: 2, progress: () => ({ pct: Math.min(1, activeStreak() / 7), label: `${activeStreak()} / 7 days` }) },
  { id: 'streak_30', icon: '🌋', title: 'Unbroken', desc: 'Show up 30 days in a row.', group: 'streaks', tier: 3, progress: () => ({ pct: Math.min(1, activeStreak() / 30), label: `${activeStreak()} / 30 days` }) },

  // Empire
  { id: 'shop_open', icon: '🏪', title: 'Open for Business', desc: 'Lease your first storefront.', group: 'empire', progress: () => ({ pct: one(`SELECT COUNT(*) AS n FROM shop`) >= 1 ? 1 : 0 }) },
  { id: 'satellite_1', icon: '🛰', title: 'Two Doors', desc: 'Open your first satellite.', group: 'empire', progress: () => ({ pct: Math.min(1, chainSize() / 1) }) },
  { id: 'dm_hired', icon: '🧭', title: 'Middle Management', desc: 'Hire a district manager.', group: 'empire', progress: () => ({ pct: hasDistrict() ? 1 : 0 }) },
  { id: 'region', icon: '🌎', title: 'The Map Is Real', desc: 'Hire a regional manager and open store #3.', group: 'empire', tier: 2, progress: () => ({ pct: hasRegional() && chainSize() >= 3 ? 1 : hasRegional() ? 0.5 : 0, label: hasRegional() && chainSize() < 3 ? 'regional hired — open store #3' : undefined }) },
]

function whaleSet(): number {
  try {
    // One inventory join, then group in memory. The old loop queried every set
    // and priced each held card with its own TCGplayer lookup.
    const held = db
      .prepare(
        `SELECT i.card_id AS id, c.set_id
         FROM inventory i JOIN cards c ON c.id = i.card_id
         WHERE i.status IN ('collection','grading')`,
      )
      .all() as { id: string; set_id: string }[]
    if (held.length === 0) return 0
    const bySet = new Map<string, string[]>()
    for (const h of held) {
      const list = bySet.get(h.set_id)
      if (list) list.push(h.id)
      else bySet.set(h.set_id, [h.id])
    }
    return withTcgPriceCache(held.map((h) => h.id), () => {
      let best = 0
      for (const ids of bySet.values()) {
        const total = ids.reduce((a, id) => a + valueOf(id), 0)
        if (total > best) best = total
      }
      return best
    })
  } catch {
    return 0
  }
}

function activeStreak(): number {
  try {
    const days = db.prepare(`SELECT DISTINCT substr(created_at, 1, 10) AS d FROM activity_log ORDER BY d DESC LIMIT 60`).all() as { d: string }[]
    if (days.length === 0) return 0
    let streak = 0
    const cursor = new Date()
    for (;;) {
      const key = cursor.toISOString().slice(0, 10)
      if (days.some((x) => x.d === key)) {
        streak++
        cursor.setDate(cursor.getDate() - 1)
      } else break
    }
    return streak
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type AchievementRow = {
  id: string
  icon: string
  title: string
  desc: string
  group: string
  unlockedAt: string | null
  pct: number
  label?: string
  isNext: boolean
}

export function status() {
  completionRowsCache = null
  const unlocked = new Set(
    (db.prepare(`SELECT id FROM achievements`).all() as { id: string }[]).map((r) => r.id),
  )
  const rows: AchievementRow[] = DEFS.map((d) => {
    const p = d.progress()
    const at = unlocked.has(d.id)
    return { id: d.id, icon: d.icon, title: d.title, desc: d.desc, group: d.group, unlockedAt: at ? (db.prepare(`SELECT unlocked_at FROM achievements WHERE id = ?`).get(d.id) as { unlocked_at: string }).unlocked_at : null, pct: at ? 1 : Math.max(0, Math.min(1, p.pct || 0)), label: p.label, isNext: false }
  })
  // "Next up": the highest-progress locked badge per ladder tier ordering.
  const locked = rows.filter((r) => !r.unlockedAt).sort((a, b) => b.pct - a.pct)
  if (locked[0]) locked[0].isNext = true
  return {
    ok: true as const,
    unlockedCount: unlocked.size,
    total: DEFS.length,
    groups: ['collection', 'business', 'grading', 'streaks', 'empire'],
    rows,
    recent: rows.filter((r) => r.unlockedAt).sort((a, b) => (b.unlockedAt ?? '').localeCompare(a.unlockedAt ?? '')).slice(0, 6),
  }
}

export type AchievementsStatus = ReturnType<typeof status>

/** Once-per-game-day evaluation (12 real hours): unlock everything at 100%, announce new badges. */
export function achievementsTick(dayKey?: string) {
  const today = dayKey ?? gameDayKey()
  const key = `achievements:${today}`
  if (db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key)) return
  try {
    setMeta(key, '1')
    completionRowsCache = null
    const unlocked = new Set((db.prepare(`SELECT id FROM achievements`).all() as { id: string }[]).map((r) => r.id))
    const fresh: AchievementDef[] = []
    for (const d of DEFS) {
      if (unlocked.has(d.id)) continue
      let p = 0
      try { p = d.progress().pct } catch { continue }
      if (p >= 1) fresh.push(d)
    }
    for (const d of fresh) {
      db.prepare(`INSERT OR IGNORE INTO achievements (id, unlocked_at) VALUES (?, ?)`).run(d.id, nowIso())
      logActivity('shop', `🏆 Achievement: ${d.icon} ${d.title} — ${d.desc}`, 0)
    }
    if (fresh.length > 0) console.log(`[achievements] ${fresh.length} unlocked: ${fresh.map((d) => d.id).join(', ')}`)
  } catch (e) {
    console.log('[achievements] tick failed:', e instanceof Error ? e.message : e)
  }
}
