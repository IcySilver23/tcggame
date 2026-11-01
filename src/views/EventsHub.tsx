import type { ComponentType } from 'react'
import { CalendarView } from './Calendar'
import { ConventionView } from './Convention'
import { CardShowsView } from './CardShows'

/**
 * The EVENTS hub (roadmap item 10.0).
 *
 * Calendar, Conventions and Card Shows were three sidebar rows for one subject:
 * what's on this week and whether you're going. The calendar is the index the
 * other two hang off — it already lists convention weekends and show windows
 * with countdowns and jump links — so it leads the bar and the two things you
 * can actually attend follow it.
 *
 * Same shape as the DEALS, COLLECTION and MARKET hubs: param route
 * (#/events/conventions), fixed-order mode bar, and the three old hashes
 * (#/calendar, #/convention, #/shows) normalized into it by App instead of
 * bouncing home. Convention and show links still get written all over the
 * game — the calendar rows, the Home dashboard, server-side feed items — so the
 * legacy hashes have to keep working forever, not just for one release.
 *
 * Tab order is fixed. No gates here: the calendar is public information, the
 * convention floor and your own show hall have always been open.
 */
export type EventsModeId = 'calendar' | 'conventions' | 'shows'

export type EventsMode = {
  id: EventsModeId
  label: string
  icon: string
  /** What this mode is for. Hover-only: the tabs stay uncluttered. */
  verb: string
  Component: ComponentType
}

export const EVENTS_MODES: EventsMode[] = [
  { id: 'calendar', label: 'Calendar', icon: '📅', verb: 'The whole scene on one clock — conventions, tournament nights, sponsor drops, show windows', Component: CalendarView },
  { id: 'conventions', label: 'Conventions', icon: '🎪', verb: 'Walk the floor: vendor tables, deal bins, haggling across the aisle, the back-room buyouts', Component: ConventionView },
  { id: 'shows', label: 'Card Shows', icon: '🏟', verb: 'Run your own: book a hall, price the gate, sell dealer tables, work a booth of your stock', Component: CardShowsView },
]

export function eventsModeLabel(id?: string): string | undefined {
  return EVENTS_MODES.find((m) => m.id === id)?.label
}

export function isEventsMode(id?: string): id is EventsModeId {
  return !!id && EVENTS_MODES.some((m) => m.id === id)
}

/**
 * Old hashes → hub modes. The three routes were their own views for a long
 * time and the game still writes them: `#/convention` from calendar rows,
 * `#/calendar` from the Home dashboard, `#/shows` from the hosted-show
 * calendar slot. One map instead of three special cases in App.
 */
export const LEGACY_EVENT_ROUTES: Record<string, EventsModeId> = {
  calendar: 'calendar',
  convention: 'conventions',
  conventions: 'conventions',
  shows: 'shows',
}

const go = (id: EventsModeId) => {
  window.location.hash = `#/events/${id}`
}

export function EventsHubView({ mode }: { mode?: string }) {
  const active = EVENTS_MODES.find((m) => m.id === mode) ?? EVENTS_MODES[0]
  const Body = active.Component

  return (
    <div className="hub">
      <div className="hub-bar">
        <div className="tab-bar hub-tabs" role="tablist" aria-label="Events modes">
          {EVENTS_MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={m.id === active.id}
              className={`tab ${m.id === active.id ? 'on' : ''}`}
              title={`${m.label} — ${m.verb}`}
              onClick={() => go(m.id)}
            >
              <span aria-hidden>{m.icon}</span> {m.label}
            </button>
          ))}
        </div>
      </div>
      <Body />
    </div>
  )
}
