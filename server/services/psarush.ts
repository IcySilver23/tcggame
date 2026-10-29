import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayKey, gameDayMs } from '../lib/gameday'
import { round2 } from './market'

// ---------------------------------------------------------------------------
// GRADING PEDIMENT EVENTS — the roadmap's PSA rush. Occasionally the big lab
// runs a $10-per-card special: the lines go around the block, turnaround dies
// for the length of the rush (and a hangover after it), and the raw-to-slab
// spread briefly widens as collectors compete to slab before normal service
// resumes. Submissions DURING the rush inherit the delay penalty; the whole
// game is getting in early — or holding your cards and selling into the
// inflated slab market instead of grading into the backlog.
//
// Mechanics:
//   • Random spawn — a small chance per game-day when no rush is live
//     (independent of the seasonal calendar; the lab does what it wants).
//   • $10 PSA Special — a rush-only grading tier: dirt cheap, SLOW (the
//     backlog), open to nearly any raw value.
//   • Backlog — every submission during the rush adds to a queue counter that
//     multiplies ALL grading turnarounds (including the regular services),
//     and it drains slowly after the rush ends. Turnaround visibly dies.
//   • Quota — the special accepts a limited number of submissions per rush
//     ("the line got so long they cut it off"); when it's gone, the special
//     closes but the backlog hangover remains.
//   • Slab premium — while the rush (or its hangover) is live, graded cards
//     price at a premium (the market competes for fresh slabs).
// ---------------------------------------------------------------------------

const SPAWN_CHANCE = 0.06 // per game-day, when idle → roughly one rush every ~2.5 weeks
const MIN_DAYS = 4
const MAX_DAYS = 7
const QUOTA = 40
const SPECIAL_MIN_RAW = 8 // raw-value floor for the $10 special — "nearly any", not any
const BACKLOG_PER_SUBMISSION = 0.5 // extra game-days added to every grading ETA per queued submission
const BACKLOG_MAX = 20
const SLAB_PREMIUM_RUSH = 1.12
const SLAB_PREMIUM_HANGOVER = 1.06

type RushState = {
  active: boolean
  startedAt: string | null
  endsAt: string | null
  backlog: number // queued submissions still inflating turnarounds
  used: number // special submissions taken this rush
  npcUsed?: number // of those, how many went to NPC submissions (the horde)
}

function get(): RushState {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'psarush:state'`).get() as { value: string } | undefined
  const s: RushState | null = row ? JSON.parse(row.value) : null
  return s ?? { active: false, startedAt: null, endsAt: null, backlog: 0, used: 0, npcUsed: 0 }
}

function set(s: RushState) {
  db.prepare(`INSERT INTO meta (key, value) VALUES ('psarush:state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(s))
}

/** Backlog delay (game-days) added to every grading submission right now —
 * 0.5 per queued submission (a special counts whole, a regular half), capped. */
export function backlogDelayDays(): number {
  return Math.min(BACKLOG_MAX, Math.round(get().backlog * BACKLOG_PER_SUBMISSION * 10) / 10)
}

/** The slab-price premium (1 = none) — live during the rush and its hangover,
 * and genuinely dynamic: the market prices the incoming slab flood, so the
 * premium decays as the quota fills (the line IS the supply curve) and fades
 * to nothing as the post-rush backlog clears. */
export function slabPremium(): number {
  const s = get()
  const dec = (x: number) => Math.round(x * 1000) / 1000
  if (s.active) {
    const frac = Math.min(1, s.used / QUOTA)
    return dec(SLAB_PREMIUM_RUSH - (SLAB_PREMIUM_RUSH - SLAB_PREMIUM_HANGOVER) * frac)
  }
  if (s.backlog > 0) {
    // The hangover premium is grading-capacity scarcity: a fat backlog means
    // fresh slabs can't be made, so existing ones command the full +6%. It
    // fades to nothing as the queue drains (~10 submissions of grind left).
    const frac = Math.min(1, s.backlog / 10)
    return dec(1 + (SLAB_PREMIUM_HANGOVER - 1) * frac)
  }
  return 1
}

/** The rush-only special service, or null when the rush is off (or sold out). */
export function specialService(): { id: string; name: string; cost: number; minRawValue: number; daysMin: number; daysMax: number; gradeBias: number; desc: string; remaining: number } | null {
  const s = get()
  if (!s.active) return null
  const remaining = Math.max(0, QUOTA - s.used)
  if (remaining === 0) return null
  const base = backlogDelayDays()
  return {
    id: 'psa_special',
    name: '🏷️ PSA Special',
    cost: 10,
    minRawValue: SPECIAL_MIN_RAW,
    daysMin: 10 + Math.round(base),
    daysMax: 18 + Math.round(base),
    gradeBias: 0,
    desc: `The lab's $10 deal: the whole scene is in this line. Turnaround is dreadful (queue adds ~${Math.round(base * 10) / 10} game-days right now) but the fee is a steal — slab cheap cards while the spread is wide.`,
    remaining,
  }
}

/** Daily tick: spawn, run, and drain. */
export function psaRushTick(): void {
  const today = new Date().toISOString().slice(0, 10)
  const s = get()

  if (s.active) {
    // Rush over?
    if (s.endsAt && s.endsAt <= nowIso()) {
      set({ ...s, active: false, startedAt: null, endsAt: null, npcUsed: 0 })
      logActivity('grading', `🏷️ The PSA special is over — the trucks left with the queue. Backlog hangover: ~${backlogDelayDays()} game-days of extra turnaround while they grind through it.`)
      return
    }
    // NPC wave: once per game-day, the rest of the scene floods the line. The
    // horde grows daily (word spreads) and eats REAL quota, so the premium
    // decays and the queue the player waits in is everyone's queue. Wave sizes
    // rise 4 → 8 → 12…, capped at what's left of the quota.
    if (getMeta('psarush:npcWave') !== today) {
      setMeta('psarush:npcWave', today)
      const st = get()
      if (st.active && st.used < QUOTA) {
        const day = Math.max(1, Math.ceil((Date.now() - new Date(st.startedAt ?? nowIso()).getTime()) / gameDayMs()))
        const wave = Math.min(QUOTA - st.used, 3 * day + Math.floor(Math.random() * 3))
        if (wave > 0) {
          const grewBacklog = Math.min(BACKLOG_MAX, st.backlog + wave)
          set({ ...st, used: st.used + wave, backlog: grewBacklog, npcUsed: (st.npcUsed ?? 0) + wave })
          const names = ['Marcus', 'Buylist Betty', 'Parking-lot Paul', 'Denise', 'the Discord mod', 'a convention regular', 'someone from the live shows', 'an estate flipper', 'a pawn-shop scout', 'the flea-market picker']
          const who = Array.from({ length: Math.min(3, wave) }, () => names[Math.floor(Math.random() * names.length)]).join(', ')
          const left = QUOTA - st.used - wave
          const queueDays = Math.round(grewBacklog * BACKLOG_PER_SUBMISSION * 10) / 10
          const chatter = left <= 0
            ? `🏷️ They cut the line — ${who} got the last slots. The special is GONE (${QUOTA}/${QUOTA}). The backlog hangover is now everyone's problem (~${queueDays}d added to every turnaround).`
            : left <= 10
              ? `🏷️ ${who} and ${wave - 1} others just joined the line — ${left} slots left, queue ~${queueDays}d. Word is spreading fast.`
              : `🏷️ ${who} and ${wave - 1} others joined the PSA line overnight — ${left} slots left, queue ~${queueDays}d and growing.`
          logActivity('grading', chatter)
        }
      }
    }
    return
  }

  // Hangover drain: the queue grinds down on the GAME clock — 2 submissions
  // per game-day, not per tick (a once-per-day guard; a save resuming after
  // weeks away still sees the hangover end on time, not instantly).
  if (s.backlog > 0) {
    if (getMeta('psarush:drainDay') !== today) {
      setMeta('psarush:drainDay', today)
      set({ ...s, backlog: Math.max(0, s.backlog - 2) })
    }
    return
  }

  // Idle: roll for a spawn (once per game-day via the meta guard).
  if (getMeta('psarush:rolled') === today) return
  setMeta('psarush:rolled', today)
  if (Math.random() >= SPAWN_CHANCE) return
  const ends = new Date(Date.now() + (MIN_DAYS + Math.floor(Math.random() * (MAX_DAYS - MIN_DAYS + 1))) * gameDayMs()).toISOString()
  set({ active: true, startedAt: nowIso(), endsAt: ends, backlog: 0, used: 0, npcUsed: 0 })
  logActivity('grading', `🏷️ PSA SPECIAL WEEKEND: $10-per-card grading, doors open now. The lines are around the block — every card in the scene is heading for a slab, and the queue is only getting longer. (⚖ Grading — get in early, the quota is ${QUOTA} slots.)`)
}

/** Called by grading.submitForGrading: applies the rush's effects to a submission. */
export function onSubmission(serviceId: string, inventoryId: number): void {
  const s = get()
  if (serviceId !== 'psa_special') {
    // Regular submissions during the rush inherit the backlog delay.
    if (s.active && s.backlog < BACKLOG_MAX) {
      set({ ...s, backlog: Math.min(BACKLOG_MAX, s.backlog + 0.5) })
    }
    return
  }
  // Special submission: quota + backlog accounting.
  if (!s.active) return
  if (s.used >= QUOTA) return
  set({ ...s, used: s.used + 1, backlog: Math.min(BACKLOG_MAX, s.backlog + 1) })
  const remaining = QUOTA - s.used
  if (remaining === 0) {
    logActivity('grading', `🏷️ The PSA special quota is GONE — they cut the line. The backlog hangover remains (~${backlogDelayDays()} game-days added to every turnaround).`)
  } else if (remaining <= 10) {
    logActivity('grading', `🏷️ PSA special: only ${remaining} quota slots left — the line is being cut off soon.`)
  }
  void inventoryId
}

/** Does the rush currently accept special submissions? */
export function specialOpen(): boolean {
  const s = get()
  return s.active && s.used < QUOTA
}

/** Read model for the Grading view banner + the Home digest. */
export function section() {
  const s = get()
  return {
    active: s.active,
    startedAt: s.startedAt,
    endsAt: s.endsAt,
    backlogDays: backlogDelayDays(),
    quotaUsed: s.used,
    quotaTotal: QUOTA,
    specialOpen: specialOpen(),
    slabPremium: slabPremium(),
    minRawValue: SPECIAL_MIN_RAW,
    spawnChancePerDay: SPAWN_CHANCE,
    /** How much of the quota the NPC horde has eaten — the race telemetry. */
    npcUsed: s.npcUsed ?? 0,
  }
}
