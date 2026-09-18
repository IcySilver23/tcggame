import { db, nowIso, logActivity } from '../lib/db'
import * as conventions from './conventions'
import * as sponsors from './sponsors'

// ---------------------------------------------------------------------------
// Event calendar — the collector scene runs on a weekly rhythm. Conventions
// land on weekends, the Pack Battle scene runs midweek, and sponsor drops hit
// Friday when everyone's watching. The calendar replaces the old always-on
// spawners with scheduled windows so the world has a pulse you can plan around.
// ---------------------------------------------------------------------------

export type EventKind = 'convention' | 'tournament' | 'sponsor'

export type CalendarEvent = {
  id: string
  kind: EventKind
  title: string
  blurb: string
  /** ISO instant this occurrence opens. */
  start: string
  /** ISO instant this occurrence ends (null for instant drops like sponsor offers). */
  end: string | null
  /** True when the event is live right now. */
  now: boolean
}

type WeeklySlot = {
  id: string
  kind: EventKind
  /** 0 = Sunday … 6 = Saturday (matches Date.getUTCDay). */
  day: number
  /** Hour the window opens, UTC. */
  hour: number
  /** Window length in hours (null = instant drop, fires once during its hour). */
  durationHours: number | null
  title: string
  blurb: string
}

// The weekly rhythm — anchored to UTC so server restarts never drift the scene.
export const WEEKLY_SLOTS: WeeklySlot[] = [
  { id: 'flea', kind: 'convention', day: 6, hour: 15, durationHours: 4, title: 'Weekend Flea Market', blurb: 'Vendor tables, estate lots, and a deal if you dig.' },
  { id: 'mega', kind: 'convention', day: 0, hour: 17, durationHours: 5, title: 'Mega Collectors Show', blurb: 'The big one — slab dealers, trap tables, deep pockets everywhere.' },
  { id: 'mini', kind: 'tournament', day: 3, hour: 19, durationHours: 6, title: 'Mini Invitational Night', blurb: '4-player bracket night — booster rip into a bundle final.' },
  { id: 'grand', kind: 'tournament', day: 5, hour: 19, durationHours: 8, title: 'Grand Slam Weekend Opener', blurb: '8 players, three rounds, an ETB championship on the line.' },
  { id: 'sponsor', kind: 'sponsor', day: 5, hour: 16, durationHours: 2, title: 'Sponsor Drop', blurb: 'Brands finalize weekly budgets — offers slide in for channels they like.' },
]

const SLOT_MS = (h: number) => h * 3600_000

// Dev/verification clock offset — shifts the whole scene forward or back.
// In-memory only: a restart snaps back to real time by design.
let clockOffsetMs = 0

export function nowMs(): number {
  return Date.now() + clockOffsetMs
}

export function setClockOffset(ms: number): void {
  clockOffsetMs = ms
  lastSpawnCheck = 0
}

export function clockOffset(): number {
  return clockOffsetMs
}

/** The Monday 00:00 UTC that starts the week containing `at`. */
function weekStartOf(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  const dow = d.getUTCDay()
  const back = (dow + 6) % 7 // Monday = 0
  d.setUTCDate(d.getUTCDate() - back)
  return d
}

/** Concrete start/end instants for a slot within the week starting `weekStart` (a Monday). */
function slotWindow(slot: WeeklySlot, weekStart: Date): { start: Date; end: Date } {
  const start = new Date(weekStart)
  // slot.day is getUTCDay-style (0 = Sunday); convert to days since Monday.
  start.setUTCDate(start.getUTCDate() + ((slot.day + 6) % 7))
  start.setUTCHours(slot.hour, 0, 0, 0)
  const end = new Date(start.getTime() + SLOT_MS(slot.durationHours ?? 1))
  return { start, end }
}

/** Expand the calendar across `weeks` weeks centered on this one. */
export function upcoming(weeks = 3): CalendarEvent[] {
  const now = nowMs()
  const thisWeek = weekStartOf(new Date(now))
  const out: CalendarEvent[] = []
  for (let w = -1; w < weeks; w++) {
    const weekStart = new Date(thisWeek.getTime() + w * 7 * 24 * 3600_000)
    for (const slot of WEEKLY_SLOTS) {
      const { start, end } = slotWindow(slot, weekStart)
      out.push({
        id: `${slot.id}@${start.toISOString()}`,
        kind: slot.kind,
        title: slot.title,
        blurb: slot.blurb,
        start: start.toISOString(),
        end: slot.durationHours == null ? null : end.toISOString(),
        now: now >= start.getTime() && now < end.getTime(),
      })
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start))
}

/** The live window right now, if any. */
export function liveEvent(): CalendarEvent | null {
  return upcoming(1).find((e) => e.now) ?? null
}

/** The next event strictly after now. */
export function nextEvent(): CalendarEvent | null {
  const now = nowMs()
  return upcoming(2).find((e) => new Date(e.start).getTime() > now) ?? null
}

function isOpen(slotId: string): boolean {
  const live = liveEvent()
  return live?.id.startsWith(slotId + '@') ?? false
}

// ---------------------------------------------------------------------------
// Gating hooks the other services call before spawning anything.
// ---------------------------------------------------------------------------

/** True when a convention window is open (or was open within its grace). */
export function conventionAllowed(): boolean {
  return isOpen('flea') || isOpen('mega')
}

/** Which tournament window is open right now, if either. */
export function tournamentAllowed(): 'mini' | 'grand' | null {
  if (isOpen('mini')) return 'mini'
  if (isOpen('grand')) return 'grand'
  return null
}

/** True during the Friday sponsor-drop window. */
export function sponsorDropLive(): boolean {
  return isOpen('sponsor')
}

// ---------------------------------------------------------------------------
// Scheduled spawning — called from the market tick every few minutes.
// ---------------------------------------------------------------------------

let lastSpawnCheck = 0

export function calendarTick(): void {
  const now = nowMs()
  if (now - lastSpawnCheck < 60_000) return // check at most once a minute
  lastSpawnCheck = now
  void nowIso // (imported for future scheduled logging paths)

  // Conventions: inside a window, open a show if none is running. Outside a
  // window, closeExpiredShow (already ticked by conventions) empties the hall.
  if (conventionAllowed()) conventions.ensureShow()

  // Sponsor drop: brands release offers on the schedule, not on dice rolls.
  // Existing random offers (stream-end generation) still work — this just
  // guarantees the Friday window produces a drop for eligible channels.
  if (sponsorDropLive() && !sponsorDropFiredThisWeek()) {
    db.prepare(
      `INSERT INTO meta (key, value) VALUES ('sponsorDropWeek', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(weekKey())
    const offerId = sponsors.maybeGenerateOffer()
    logActivity('stream', offerId != null
      ? `📅 Sponsor Drop: brands are reviewing this week's numbers — new offers just landed.`
      : `📅 Sponsor Drop window is open — no brand bit this week (channel growth matters).`)
  }
}

function weekKey(): string {
  return weekStartOf(new Date()).toISOString().slice(0, 10)
}

function sponsorDropFiredThisWeek(): boolean {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'sponsorDropWeek'`).get() as { value: string } | undefined
  return row?.value === weekKey()
}

/** Force the world to a known point in the weekly rhythm (dev/tests). */
export function debugSetClock(iso: string): void {
  setClockOffset(new Date(iso).getTime() - Date.now())
  logActivity('system', `📅 Calendar clock shifted — the scene now thinks it's ${iso}.`)
}

export function debugResetClock(): void {
  setClockOffset(0)
}
