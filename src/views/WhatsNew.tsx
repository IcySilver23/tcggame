import { useEffect, useState } from 'react'
import { api, type ChangelogEntry } from '../api'

/** Semver-ish compare: is version a strictly newer than b? */
function verNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0
  }
  return false
}

/**
 * Sidebar badge: how many changelog entries landed since this save last
 * caught up. 0 for brand-new saves (no baseline yet) and caught-up saves.
 * Returns [count, refresh] so the app can re-check after the modal closes.
 */
export function useWhatsNewBadge(): [number, () => void] {
  const [count, setCount] = useState(0)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    Promise.all([api.changelog(), api.changelogSeen()])
      .then(([log, seen]) => {
        if (!alive) return
        if (!seen.seen) {
          // Never opened the changelog: a fresh save stays quiet, but a save
          // with play history is a RETURNING player — badge the whole list.
          setCount(seen.veteran ? log.entries.length : 0)
          return
        }
        const unseen = log.entries.filter((e) => verNewer(e.version, seen.seen!)).length
        setCount(unseen)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [tick])
  return [count, () => setTick((t) => t + 1)]
}

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  const [log, setLog] = useState<{ current: string; entries: ChangelogEntry[] } | null>(null)
  const [unseenCount, setUnseenCount] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([api.changelog(), api.changelogSeen()])
      .then(([log, seen]) => {
        const unseen = seen.seen ? log.entries.filter((e) => verNewer(e.version, seen.seen!)) : []
        setLog(log)
        setUnseenCount(seen.seen ? unseen.length : (seen.veteran ? log.entries.length : 0))
        // Opening the panel IS catching up — mark the current version seen.
        if (seen.seen !== log.current) api.changelogMarkSeen(log.current).catch(() => {})
      })
      .catch(() => setLog({ current: '—', entries: [] }))
  }, [])

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(560px, 94vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <div>
            <h2 style={{ margin: 0 }}>✨ What's New</h2>
            <div className="faint small">
              {unseenCount === null ? '' : unseenCount > 0 ? `${unseenCount} update${unseenCount === 1 ? '' : 's'} since your last visit` : `You're all caught up — running v${log?.current ?? ''}`}
            </div>
          </div>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', paddingRight: 4 }}>
          {log?.entries.map((e) => (
            <div key={e.version} className="panel" style={{ marginBottom: 10, borderColor: e.version === log.current ? 'var(--yellow)' : undefined }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <b>v{e.version} — {e.title}{e.version === log.current ? ' ← you are here' : ''}</b>
                <span className="faint small">{e.date}</span>
              </div>
              <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.55 }}>
                {e.features.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          ))}
          {log && log.entries.length === 0 && <div className="faint">No changelog entries.</div>}
        </div>
        <button className="primary mt8" onClick={onClose}>Back to the game</button>
      </div>
    </div>
  )
}
