import { useCallback, useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// 🔔 Notifications — the header bell.
//
// Polls the server's short list (deliveries, trade offers, sales) and badges the
// unread count. Clicking a row marks it read and jumps to the screen that can
// act on it; "Mark all read" clears the badge without hunting each one.
// ---------------------------------------------------------------------------

type Notify = {
  id: number
  kind: string
  title: string
  body: string | null
  href: string | null
  read_at: string | null
  created_at: string
}

const ICON: Record<string, string> = { delivery: '📦', trade: '🤝', sale: '💵', system: '🔔' }

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function NotificationBell() {
  const [rows, setRows] = useState<Notify[]>([])
  const [open, setOpen] = useState(false)
  // "Nothing yet" and "the server never answered" are different sentences, so
  // the panel says which one it means.
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const wrap = useRef<HTMLDivElement | null>(null)

  const load = useCallback(() => {
    fetch('/api/notifications')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((r) => { setRows(r); setStatus('ready') })
      // A failed poll keeps the last list; only a failure with nothing to show
      // is an error — the 20s poll must not blank the bell.
      .catch(() => setStatus((s) => (s === 'ready' ? s : 'error')))
  }, [])

  useEffect(() => {
    load()
    const t = window.setInterval(load, 20_000)
    return () => window.clearInterval(t)
  }, [load])

  // Click-away closes the panel; the bell itself is inside the wrapper.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const unread = rows.filter((r) => !r.read_at).length

  const markAll = () => {
    fetch('/api/notifications/read-all', { method: 'POST' }).then(load).catch(() => {})
  }

  const openOne = (n: Notify) => {
    if (!n.read_at) {
      fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: n.id }),
      }).then(load).catch(() => {})
    }
    if (n.href) window.location.hash = n.href
    setOpen(false)
  }

  return (
    <div className="notif-wrap" ref={wrap}>
      <button
        className={`notif-bell nav-item ${unread > 0 ? 'live' : ''} ${open ? 'active' : ''}`}
        onClick={() => { setOpen((o) => !o); load() }}
        title={unread > 0 ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'Notifications'}
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
      >
        <span className="ico">🔔</span>
        <span className="nav-label">Notifications</span>
        {unread > 0 && <span className="nav-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <b>Notifications</b>
            {unread > 0 && <button className="notif-all" onClick={markAll}>Mark all read</button>}
          </div>
          {status === 'error' && rows.length === 0 ? (
            <div className="notif-empty">
              Couldn't load notifications — the server did not answer. Nothing was changed.{' '}
              <button className="notif-all" onClick={load}>Try again</button>
            </div>
          ) : status === 'loading' && rows.length === 0 ? (
            <div className="notif-empty">Checking for new notifications…</div>
          ) : rows.length === 0 ? (
            <div className="notif-empty">Nothing yet — deliveries, trade offers and sales land here.</div>
          ) : (
            <div className="notif-list">
              {rows.map((n) => (
                <button key={n.id} className={`notif-row ${n.read_at ? 'read' : ''}`} onClick={() => openOne(n)}>
                  <span className="notif-ico" aria-hidden>{ICON[n.kind] ?? '🔔'}</span>
                  <span className="notif-txt">
                    <b>{n.title}</b>
                    {n.body && <em>{n.body}</em>}
                    <i>{ago(n.created_at)}</i>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
