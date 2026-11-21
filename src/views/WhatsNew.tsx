import { useEffect, useState } from 'react'
import { api, type ChangelogEntry } from '../api'
import { verNewer } from '../changelog-badge'

export { useWhatsNewBadge } from '../changelog-badge'
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
