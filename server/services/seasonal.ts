import { db, nowIso, logActivity } from '../lib/db'

// ---------------------------------------------------------------------------
// Seasonal events (Systems that touch everything): the hobby has a calendar.
// The weeks before the holidays are a feeding frenzy — gifts, disposable
// income, panic buying. January is a graveyard. Tax-refund April hums. Summer
// slumps while everyone's outside. Each event carries a bundle of multipliers
// that the rest of the economy reads every tick:
//
//   price   — every card's resolved market value (rides resolvePrice, so
//             listings, shop cases, vendor tables, auctions, net worth…)
//   walkIn  — shop + convention-table customer traffic
//   crowd   — hosted card show attendance
//   pack    — impulse-buy appetite: grab bags and gamble stock
//
// Windows are real-world month/day windows (the game clock is the wall
// clock), so the same save lives through the same seasons every year.
// ---------------------------------------------------------------------------

type Multipliers = { price: number; walkIn: number; crowd: number; pack: number }

type EventDef = {
  id: string
  name: string
  icon: string
  blurb: string
  /** Inclusive month/day window (1-indexed months). */
  start: { m: number; d: number }
  end: { m: number; d: number }
  mult: Multipliers
}

export const EVENTS: EventDef[] = [
  {
    id: 'holiday_rush', name: 'Holiday rush', icon: '🎄',
    blurb: 'Gift panic. Every kid wants cardboard, every adult has a budget, and sellers know it. Prices rip, stores are packed.',
    start: { m: 12, d: 10 }, end: { m: 12, d: 24 },
    mult: { price: 1.18, walkIn: 1.3, crowd: 1.2, pack: 1.35 },
  },
  {
    id: 'january_lull', name: 'Post-holiday lull', icon: '🥶',
    blurb: 'Wallets closed, hobby funds spent, returns hitting the market. The quietest weeks of the year — buy, don\'t sell.',
    start: { m: 1, d: 5 }, end: { m: 1, d: 25 },
    mult: { price: 0.88, walkIn: 0.7, crowd: 0.8, pack: 0.75 },
  },
  {
    id: 'valentines', name: 'Valentine\'s weekend', icon: '💝',
    blurb: 'Nothing says romance like a graded slab. A short, warm blip of impulse spending.',
    start: { m: 2, d: 7 }, end: { m: 2, d: 14 },
    mult: { price: 1.05, walkIn: 1.1, crowd: 1.05, pack: 1.15 },
  },
  {
    id: 'tax_refund', name: 'Tax-refund season', icon: '💸',
    blurb: 'Refunds landed and the collectors are out in force. Sellers get brave, buyers pay up.',
    start: { m: 4, d: 15 }, end: { m: 4, d: 30 },
    mult: { price: 1.08, walkIn: 1.15, crowd: 1.05, pack: 1.25 },
  },
  {
    id: 'summer_slump', name: 'Summer slump', icon: '🏖️',
    blurb: 'Vacations, yards, and kids out of school. The shop is quiet and the market coasts.',
    start: { m: 7, d: 20 }, end: { m: 8, d: 5 },
    mult: { price: 0.94, walkIn: 0.8, crowd: 0.85, pack: 0.85 },
  },
  {
    id: 'back_to_school', name: 'Back-to-school week', icon: '🎒',
    blurb: 'Parents restock backpacks and lunchboxes — and a surprising number of booster packs.',
    start: { m: 8, d: 25 }, end: { m: 9, d: 10 },
    mult: { price: 0.97, walkIn: 0.9, crowd: 0.9, pack: 1.1 },
  },
  {
    id: 'october_quiet', name: 'October lull', icon: '🍂',
    blurb: 'The dead zone before the holidays. Veterans stock their cases cheap and wait.',
    start: { m: 10, d: 1 }, end: { m: 10, d: 15 },
    mult: { price: 0.96, walkIn: 0.85, crowd: 0.85, pack: 0.9 },
  },
]

const NEUTRAL: Multipliers = { price: 1, walkIn: 1, crowd: 1, pack: 1 }

type ActiveState = { id: string; startedAt: string; endsAt: string } | null

function getActive(): ActiveState {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'seasonal:active'`).get() as { value: string } | undefined
  return row ? (JSON.parse(row.value) as ActiveState) : null
}

function setActive(s: ActiveState) {
  if (s) db.prepare(`INSERT INTO meta (key, value) VALUES ('seasonal:active', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(s))
  else db.prepare(`DELETE FROM meta WHERE key = 'seasonal:active'`).run()
}

function md(at: number): { m: number; d: number } {
  const dt = new Date(at)
  return { m: dt.getMonth() + 1, d: dt.getDate() }
}

function onOrAfter(a: { m: number; d: number }, b: { m: number; d: number }): boolean {
  return a.m > b.m || (a.m === b.m && a.d >= b.d)
}

/** The event covering right now, or undefined between events. */
export function eventFor(at = Date.now()): (EventDef & { endsAt: string }) | undefined {
  const today = md(at)
  for (const ev of EVENTS) {
    // All our windows are intra-year (start month ≤ end month).
    // start ≤ today ≤ end, day-inclusive on both edges.
    if (onOrAfter(today, ev.start) && !onOrAfter(today, { m: ev.end.m, d: ev.end.d + 1 })) {
      const end = new Date(at)
      end.setMonth(ev.end.m - 1, ev.end.d + 1)
      end.setHours(0, 0, 0, 0)
      return { ...ev, endsAt: end.toISOString() }
    }
  }
  return undefined
}

/** Next event on the calendar from `at`, with days until it starts. */
export function nextEvent(at = Date.now()): (EventDef & { startsInDays: number }) | undefined {
  const year = new Date(at).getFullYear()
  const score = (ev: EventDef): number => new Date(year, ev.start.m - 1, ev.start.d).getTime()
  const today = at
  const upcoming = EVENTS
    .map((ev) => ({ ev, at0: score(ev) <= today ? score(ev) + 365 * 86_400_000 : score(ev) }))
    .sort((a, b) => a.at0 - b.at0)
  const hit = upcoming[0]
  if (!hit) return undefined
  return { ...hit.ev, startsInDays: Math.max(0, Math.ceil((hit.at0 - today) / 86_400_000)) }
}

function eventById(id: string): EventDef | undefined {
  return EVENTS.find((e) => e.id === id)
}

// ---------------------------------------------------------------------------
// The multipliers every other service reads. No active event → all neutral.
// ---------------------------------------------------------------------------

function currentMult(key: keyof Multipliers): number {
  // Calendar-direct, not tick-persisted: a save resuming after weeks away is
  // instantly in-season, and no consumer cares about tick ordering.
  const ev = eventFor()
  return ev ? ev.mult[key] : 1
}

/** Card-price weather. Composes with the regime factor in resolvePrice(). */
export function priceMultiplier(): number {
  return currentMult('price')
}

/** Walk-in customer traffic (shop floor + convention vendor tables). */
export function walkInMultiplier(): number {
  return currentMult('walkIn')
}

/** Hosted card show attendance. */
export function showCrowdMultiplier(): number {
  return currentMult('crowd')
}

/** Impulse-buy appetite: grab bags, gamble stock. */
export function packAppetiteMultiplier(): number {
  return currentMult('pack')
}

// ---------------------------------------------------------------------------
// Tick: one transition check per pass (the tick runs every ~20s; the calendar
// moves once a day, so this is plenty and stays idempotent by event id).
// ---------------------------------------------------------------------------

export function seasonalTick() {
  const ev = eventFor()
  const cur = getActive()
  if (!ev) {
    if (cur) {
      const def = eventById(cur.id)
      if (def) logActivity('market', `${def.icon} ${def.name} is over — the surge drains out of the market and the shelves go quiet.`)
    }
    setActive(null)
    return
  }
  if (!cur || cur.id !== ev.id) {
    setActive({ id: ev.id, startedAt: nowIso(), endsAt: ev.endsAt })
    const through = new Date(new Date(ev.endsAt).getTime() - 86_400_000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    logActivity('market', `${ev.icon} ${ev.name} is here — ${ev.blurb} (through ~${through})`)
  }
}

// ---------------------------------------------------------------------------
// Read model for the Market view strip.
// ---------------------------------------------------------------------------

export function status() {
  // Derived straight from the calendar (not the persisted active row) so the
  // banner is correct the instant the server boots, before any tick.
  const ev = eventFor()
  const next = nextEvent()
  return {
    event: ev
      ? {
          id: ev.id, name: ev.name, icon: ev.icon, blurb: ev.blurb, mult: ev.mult,
          endsAt: ev.endsAt,
          daysLeft: Math.max(1, Math.ceil((new Date(ev.endsAt).getTime() - Date.now()) / 86_400_000)),
        }
      : null,
    next: next ? { id: next.id, name: next.name, icon: next.icon, startsInDays: next.startsInDays } : null,
    multipliers: {
      price: round2x(priceMultiplier()),
      walkIn: round2x(walkInMultiplier()),
      crowd: round2x(showCrowdMultiplier()),
      pack: round2x(packAppetiteMultiplier()),
    },
  }
}

function round2x(n: number): number {
  return Math.round(n * 100) / 100
}
