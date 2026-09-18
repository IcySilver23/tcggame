import { useEffect, useState } from 'react'
import { api, type CalendarEvent, type CalendarResponse } from '../api'
import { EmptyState } from '../components'

// ---------------------------------------------------------------------------
// 📅 Calendar — the collector scene's weekly rhythm. Conventions on weekends,
// tournament nights midweek, sponsor drops Friday. Countdowns tick in real
// time against the server's clock.
// ---------------------------------------------------------------------------

const KIND_META: Record<CalendarEvent['kind'], { icon: string; color: string; go: string; goLabel: string }> = {
  convention: { icon: '🎪', color: 'var(--accent)', go: '#/convention', goLabel: 'Open floor →' },
  tournament: { icon: '⚔️', color: 'var(--yellow, #e8b73a)', go: '#/battles', goLabel: 'To the bracket →' },
  sponsor: { icon: '📩', color: 'var(--green)', go: '#/stream', goLabel: 'Check offers →' },
}

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
function localDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'short' })
}

function EventRow({ ev, serverNow, onJump }: { ev: CalendarEvent; serverNow: number; onJump: () => void }) {
  const meta = KIND_META[ev.kind]
  const [, startIso] = ev.id.split('@')
  const live = ev.now
  const isNext = !live && new Date(ev.start).getTime() > serverNow && new Date(ev.start).getTime() - serverNow < 36 * 3600_000
  return (
    <div className={`cal-row ${live ? 'live' : ''}`}>
      <div className="cal-when">
        <div className="cal-day">{localDay(ev.start)}</div>
        <div className="cal-time">{localTime(ev.start)}</div>
      </div>
      <div className="cal-icon" style={{ color: meta.color }}>{meta.icon}</div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="small" style={{ fontWeight: 650 }}>
          {ev.title}
          {live && <span className="badge hit" style={{ marginLeft: 8 }}>LIVE</span>}
          {isNext && <span className="faint small" style={{ marginLeft: 8 }}>next up</span>}
        </div>
        <div className="faint" style={{ fontSize: 11 }}>{ev.blurb}</div>
      </div>
      <div className="right" style={{ textAlign: 'right' }}>
        {live ? (
          <div className="price" style={{ color: meta.color }}>
            {ev.end ? `ends in ${countdown(ev.end, serverNow)}` : 'live now'}
          </div>
        ) : (
          <div className="small price">in {countdown(ev.start, serverNow)}</div>
        )}
        {live && (
          <button className="ghost small mt8" onClick={onJump}>{meta.goLabel}</button>
        )}
      </div>
    </div>
  )
}

export function CalendarView() {
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    api.calendar().then(setData).catch(() => {})
    const fetchT = setInterval(() => api.calendar().then(setData).catch(() => {}), 30_000)
    const tickT = setInterval(() => setTick((t) => t + 1), 1000) // re-render countdowns every second
    return () => { clearInterval(fetchT); clearInterval(tickT) }
  }, [])

  if (!data) return <EmptyState icon="📅" text="Loading the scene calendar…" />

  const serverNow = new Date(data.serverNow).getTime()
  // One row per weekly slot: this week's occurrence (or the live one).
  const bySlot = new Map<string, CalendarEvent>()
  for (const ev of data.events) {
    const slot = ev.id.split('@')[0]
    const prev = bySlot.get(slot)
    if (!prev || ev.now || (!prev.now && new Date(ev.start).getTime() > serverNow && new Date(prev.start).getTime() < serverNow)) {
      bySlot.set(slot, ev)
    }
  }
  const rows = [...bySlot.values()].sort((a, b) => {
    // live first, then by start time
    if (a.now !== b.now) return a.now ? -1 : 1
    return a.start.localeCompare(b.start)
  })

  return (
    <div className="grid cols2 mt14">
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>📅 This week's scene</h2>
          <span className="faint small">{data.clockShifted ? 'dev clock' : 'server time'}</span>
        </div>
        <div className="mt14" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.length === 0 && <EmptyState icon="📅" text="No events on the calendar." />}
          {rows.map((ev) => (
            <EventRow key={ev.id} ev={ev} serverNow={serverNow} onJump={() => { window.location.hash = KIND_META[ev.kind].go }} />
          ))}
        </div>
        <div className="faint small mt14">
          The scene runs on a weekly rhythm — plan your rips around it. Show windows open the hall; tournament
          nights take bracket entries; Friday's sponsor drop brings offers to growing channels.
        </div>
      </div>

      <div className="panel">
        <h2 style={{ margin: 0 }}>🗓 Coming up</h2>
        <div className="mt14" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.events
            .filter((e) => new Date(e.start).getTime() > serverNow)
            .slice(0, 8)
            .map((ev) => {
              const meta = KIND_META[ev.kind]
              return (
                <div key={ev.id} className="row" style={{ gap: 10 }}>
                  <div style={{ width: 20, textAlign: 'center' }}>{meta.icon}</div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="small" style={{ fontWeight: 600 }}>{ev.title}</div>
                    <div className="faint" style={{ fontSize: 11 }}>
                      {new Date(ev.start).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className="small price">in {countdown(ev.start, serverNow)}</div>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}
