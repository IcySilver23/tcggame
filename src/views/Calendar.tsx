import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { api, type CalendarEvent, type CalendarResponse } from '../api'
import { EmptyState, LoadFailure } from '../components'

// ---------------------------------------------------------------------------
// 📅 Calendar — a real month grid, because "what's on" is a question about days.
//
// The old screen was a list of the next eight things, sorted by start time: you
// could not see that Saturday is stacked four deep while Tuesday is empty, and
// "when is the next convention" meant reading every row. A month grid answers
// both at a glance — Friday and Saturday columns fill up, midweek stays quiet,
// and the weekday rhythm the scene runs on becomes visible instead of implied.
//
// Cells carry only what fits (time + a clipped title, two per day, then "+N
// more"); the day panel on the right is where the full blurb, live countdown and
// jump link live. Clicking any day — including one in the next month's lead-in
// row — selects it, and the grid follows if it has to.
// ---------------------------------------------------------------------------

/** Weeks of schedule the server is asked to expand. The scene runs weekly, so
 *  one month of grid needs occurrences either side of it. */
const PUBLISHED_WEEKS = 9

const KIND_META: Record<
  CalendarEvent['kind'],
  { icon: string; color: string; go: string; goLabel: string; label: string }
> = {
  // Point at the hub modes directly — App still normalizes the old hashes for
  // every link the server writes, but new links shouldn't rely on that.
  convention: { icon: '🎪', color: 'var(--accent, #ff7a18)', go: '#/events/conventions', goLabel: 'Open floor →', label: 'Conventions' },
  tournament: { icon: '⚔️', color: 'var(--gold, #e8b73a)', go: '#/battles', goLabel: 'To the bracket →', label: 'Tournament nights' },
  sponsor: { icon: '📩', color: 'var(--green)', go: '#/stream', goLabel: 'Check offers →', label: 'Sponsor drops' },
  'hosted-show': { icon: '🏟', color: 'var(--green, var(--green))', go: '#/events/shows', goLabel: 'Run your show →', label: 'Your shows' },
  'live-shopping': { icon: '📺', color: 'var(--red, #e0644d)', go: '#/live', goLabel: 'Camp the stream →', label: 'Live rips' },
}

const KINDS = Object.keys(KIND_META) as CalendarEvent['kind'][]

/** Monday-first, matching the server's weekly slots. */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ------------------------------------------------------------------ date math

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}
/** Months between two dates, as an integer difference of their year/month pair. */
function monthIndex(d: Date): number {
  return d.getFullYear() * 12 + d.getMonth()
}

/**
 * The cells for a month view: whole weeks, Monday-first, trimmed to the rows
 * the month actually spans (5 rows for most months, 6 when a 31-day month
 * starts on a Saturday or Sunday). Leading and trailing days belong to the
 * neighbouring months — they are dimmed but still clickable.
 */
function monthCells(month: Date): Date[] {
  const first = firstOfMonth(month)
  const lead = (first.getDay() + 6) % 7
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const rows = Math.ceil((lead + daysInMonth) / 7)
  const start = addDays(first, -lead)
  return Array.from({ length: rows * 7 }, (_, i) => addDays(start, i))
}

// ------------------------------------------------------------------ formatting

function countdown(target: string, nowMs: number): string {
  const ms = new Date(target).getTime() - nowMs
  if (ms <= 0) return 'now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return `${h}h ${m}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
/** Where an occurrence sits relative to now — "in 3h", "ends in 40m", "wrapped up". */
function whenLabel(ev: CalendarEvent, nowMs: number): string {
  if (ev.now) return ev.end ? `ends in ${countdown(ev.end, nowMs)}` : 'live now'
  const end = new Date(ev.end ?? ev.start).getTime()
  if (end <= nowMs) return 'wrapped up'
  return `in ${countdown(ev.start, nowMs)}`
}
function compactTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric' })
}

// ------------------------------------------------------------------- the view

export function CalendarView() {
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [, setTick] = useState(0)
  // Null until the player acts: the grid then follows the server's clock, so a
  // dev-shifted scene lands on the right month instead of the machine's date.
  const [viewMonth, setViewMonth] = useState<Date | null>(null)
  const [selectedKey, setSelectedKey] = useState<number | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = (initial = false) => {
    if (initial) setStatus('loading')
    api.calendar(PUBLISHED_WEEKS)
      .then((d) => { setData(d); setStatus('ready') })
      .catch(() => { if (initial) setStatus('error') })
  }
  useEffect(() => {
    load(true)
    const fetchT = setInterval(load, 30_000)
    const tickT = setInterval(() => setTick((t) => t + 1), 1000) // countdowns tick every second
    return () => { clearInterval(fetchT); clearInterval(tickT) }
  }, [])

  const events = data?.events ?? []
  const serverNowMs = data ? new Date(data.serverNow).getTime() : Date.now()
  const today = midnight(new Date(serverNowMs))

  // Every occurrence bucketed onto the local day it starts, in start order.
  const byDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>()
    for (const ev of events) {
      const key = midnight(new Date(ev.start)).getTime()
      const list = map.get(key)
      if (list) list.push(ev)
      else map.set(key, [ev])
    }
    for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start))
    return map
  }, [events])

  // The months the schedule actually covers — navigation stops at the edges
  // rather than paging into months the scene has not published yet.
  const monthBounds = useMemo(() => {
    if (events.length === 0) return null
    const idx = events.map((ev) => monthIndex(new Date(ev.start)))
    return { min: Math.min(...idx), max: Math.max(...idx) }
  }, [events])

  if (status === 'error') return <LoadFailure what="the scene calendar" onRetry={() => load(true)} />
  if (!data) return <EmptyState icon="📅" text="Loading the scene calendar…" sub="Pulling the next few weeks of shows, tournaments and drops." />

  if (events.length === 0) {
    return (
      <EmptyState
        icon="📅"
        text="Nothing on the calendar yet"
        sub="The scene publishes shows and streams on a weekly rhythm. The convention floor has what is coming next."
        action={{ label: 'Open the convention floor', onClick: () => { window.location.hash = '#/events/conventions' } }}
      />
    )
  }
  const month = firstOfMonth(viewMonth ?? today)
  const selected = midnight(new Date(selectedKey ?? today.getTime()))
  const cells = monthCells(month)
  const todayKey = today.getTime()
  const selectedDayKey = selected.getTime()
  const dayEvents = byDay.get(selectedDayKey) ?? []
  const live = data.live
  const currentIndex = monthIndex(month)
  const canPrev = !monthBounds || currentIndex > monthBounds.min
  const canNext = !monthBounds || currentIndex < monthBounds.max
  const isAwayFromToday = currentIndex !== monthIndex(today) || selectedDayKey !== todayKey
  const nextUp = events.filter((ev) => new Date(ev.start).getTime() > serverNowMs).slice(0, 4)

  const focusDay = (d: Date) => {
    setSelectedKey(midnight(d).getTime())
    setViewMonth(firstOfMonth(d))
  }
  const goToday = () => {
    setViewMonth(firstOfMonth(today))
    setSelectedKey(todayKey)
  }

  return (
    <div className="cal-layout mt14">
      <div className="panel cal-month">
        <div className="cal-head">
          <h2 className="cal-month-name">
            {month.toLocaleDateString([], { month: 'long' })}
            <span className="cal-year">{month.getFullYear()}</span>
          </h2>
          {live && (
            <span className="cal-live-chip" style={{ '--chip': KIND_META[live.kind].color } as CSSProperties}>
              <span className="cal-dot" /> live · {live.title}
            </span>
          )}
          <div className="cal-nav">
            <button
              className="ghost small"
              onClick={() => setViewMonth(addMonths(month, -1))}
              disabled={!canPrev}
              aria-label="Previous month"
            >
              ‹
            </button>
            <button className="ghost small" onClick={goToday} disabled={!isAwayFromToday}>
              Today
            </button>
            <button
              className="ghost small"
              onClick={() => setViewMonth(addMonths(month, 1))}
              disabled={!canNext}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
        </div>

        <div className="cal-weekdays">
          {WEEKDAYS.map((d, i) => (
            <span key={d} className={i > 4 ? 'wk' : ''}>{d}</span>
          ))}
        </div>

        <div className="cal-grid" role="grid" aria-label={`${month.toLocaleDateString([], { month: 'long', year: 'numeric' })} scene calendar`}>
          {cells.map((d) => {
            const key = d.getTime()
            const dayList = byDay.get(key) ?? []
            const outside = d.getMonth() !== month.getMonth()
            const isToday = key === todayKey
            const isSelected = key === selectedDayKey
            return (
              <button
                key={key}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                aria-label={`${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}${
                  dayList.length ? ` — ${dayList.length} on the scene` : ' — nothing scheduled'
                }`}
                className={`cal-cell${outside ? ' out' : ''}${isToday ? ' today' : ''}${isSelected ? ' sel' : ''}`}
                onClick={() => focusDay(d)}
              >
                <div className="cal-date">
                  {d.getDate()}
                  {isToday && <span className="cal-today-tag">today</span>}
                </div>
                <div className="cal-chips">
                  {[...dayList]
                    // Live windows ride to the front: a Saturday can stack five deep,
                    // and the one that's open right now should never be the "+N more".
                    .sort((a, b) => Number(b.now) - Number(a.now))
                    .slice(0, 2)
                    .map((ev) => {
                    const meta = KIND_META[ev.kind]
                    return (
                      <div
                        key={ev.id}
                        className={`cal-chip${ev.now ? ' live' : ''}`}
                        style={{ '--chip': meta.color } as CSSProperties}
                        title={`${ev.title} · ${localTime(ev.start)}`}
                      >
                        <span className="cal-chip-ic">{meta.icon}</span>
                        <span className="cal-chip-t">{compactTime(ev.start)}</span>
                        <span className="cal-chip-n">{ev.title}</span>
                      </div>
                    )
                  })}
                  {dayList.length > 2 && (
                    <div className="cal-more" title={`${dayList.length - 2} more windows`}>
                      +{dayList.length - 2}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <div className="cal-legend">
          {KINDS.map((kind) => (
            <span key={kind} className="cal-key" style={{ '--chip': KIND_META[kind].color } as CSSProperties}>
              <span className="cal-dot" /> {KIND_META[kind].label}
            </span>
          ))}
          <span className="cal-clock">{data.clockShifted ? 'dev clock' : 'server time'}</span>
        </div>
      </div>

      <div className="panel cal-side">
        <div className="cal-day-head">
          <h2>{selected.toLocaleDateString([], { weekday: 'long' })}</h2>
          <span className="cal-day-date">
            {selected.toLocaleDateString([], { month: 'short', day: 'numeric' })}
            {selectedDayKey === todayKey && ' · today'}
          </span>
        </div>
        <div className="faint small cal-day-count">
          {dayEvents.length === 0
            ? 'Quiet night — nothing on the scene.'
            : `${dayEvents.length} ${dayEvents.length === 1 ? 'window' : 'windows'} on the scene`}
        </div>

        <div className="cal-day-list">
          {dayEvents.length === 0 && (
            <div className="cal-empty">
              No venues open. The rhythm runs weekends — clear a night and plan a rip around the next window.
            </div>
          )}
          {dayEvents.map((ev) => {
            const meta = KIND_META[ev.kind]
            return (
              <div
                key={ev.id}
                className={`cal-item${ev.now ? ' live' : ''}`}
                style={{ '--chip': meta.color } as CSSProperties}
              >
                <div className="cal-item-top">
                  <span className="cal-item-time">{localTime(ev.start)}</span>
                  <span className="cal-item-title">
                    {meta.icon} {ev.title}
                    {ev.now && <span className="badge hit" style={{ marginLeft: 6 }}>LIVE</span>}
                  </span>
                </div>
                <div className="cal-item-blurb">{ev.blurb}</div>
                <div className="cal-item-foot">
                  <span className={`cal-item-when${ev.now ? ' live' : ''}`}>{whenLabel(ev, serverNowMs)}</span>
                  <button
                    className="ghost small"
                    onClick={() => { window.location.hash = meta.go }}
                  >
                    {meta.goLabel}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="cal-next">
          <div className="cal-next-head">Coming up</div>
          {nextUp.length === 0 && <div className="faint small">Nothing left on the published schedule.</div>}
          {nextUp.map((ev) => {
            const meta = KIND_META[ev.kind]
            const when = new Date(ev.start)
            return (
              <button key={ev.id} type="button" className="cal-next-row" onClick={() => focusDay(when)}>
                <span className="cal-next-ic" style={{ color: meta.color }}>{meta.icon}</span>
                <span className="cal-next-body">
                  <span className="cal-next-title">{ev.title}</span>
                  <span className="faint cal-next-when">
                    {when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · {localTime(ev.start)}
                  </span>
                </span>
                <span className="cal-next-in">in {countdown(ev.start, serverNowMs)}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
