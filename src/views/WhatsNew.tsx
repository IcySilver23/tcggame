import { useEffect, useState } from 'react'
import { api, type ChangelogEntry } from '../api'
import { verNewer } from '../changelog-badge'

export { useWhatsNewBadge } from '../changelog-badge'

/** One version's card. `items` is either the highlights or the full list. */
function EntryBlock({ entry, items, current, dense = false }: { entry: ChangelogEntry; items: string[]; current: boolean; dense?: boolean }) {
  return (
    <div className="panel" style={{ marginBottom: dense ? 8 : 10, borderColor: current ? 'var(--yellow)' : undefined }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <b>v{entry.version} — {entry.title}{current ? ' ← you are here' : ''}</b>
        <span className="faint small">{entry.date}</span>
      </div>
      <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.55 }}>
        {items.map((f, i) => <li key={i}>{f}</li>)}
      </ul>
    </div>
  )
}

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  const [log, setLog] = useState<{ current: string; entries: ChangelogEntry[] } | null>(null)
  const [unseenCount, setUnseenCount] = useState<number | null>(null)
  const [full, setFull] = useState(false)

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

  // The panel leads with the newest version's headline items only; everything
  // ever shipped is one click away in the full changelog, in full detail.
  const newest = log?.entries[0]
  const earlier = log?.entries.slice(1, 7) ?? []
  const rest = Math.max(0, (log?.entries.length ?? 0) - 7)

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(560px, 94vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <div>
            <h2 style={{ margin: 0 }}>{full ? '✨ Full changelog' : "✨ What's New"}</h2>
            <div className="faint small">
              {full
                ? `${log?.entries.length ?? 0} updates, every item — running v${log?.current ?? ''}`
                : unseenCount === null ? '' : unseenCount > 0 ? `${unseenCount} update${unseenCount === 1 ? '' : 's'} since your last visit` : `You're all caught up — running v${log?.current ?? ''}`}
            </div>
          </div>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', paddingRight: 4 }}>
          {!log && <div className="faint small">Loading…</div>}

          {log && !full && (
            <>
              {newest && <EntryBlock entry={newest} items={newest.highlights ?? newest.features} current={newest.version === log.current} />}

              {earlier.length > 0 && (
                <div style={{ marginTop: 2 }}>
                  <div className="faint small" style={{ marginBottom: 2 }}>Earlier updates</div>
                  {earlier.map((e) => (
                    <div
                      key={e.version}
                      className="row"
                      style={{ justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid var(--line, #2a2a2a)' }}
                    >
                      <span className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <b>v{e.version}</b> — {e.title}
                      </span>
                      <span className="faint small">{e.date}</span>
                    </div>
                  ))}
                  {rest > 0 && <div className="faint small" style={{ paddingTop: 4 }}>+ {rest} older update{rest === 1 ? '' : 's'}</div>}
                </div>
              )}

              <button className="ghost small mt8" onClick={() => setFull(true)}>View full changelog →</button>
            </>
          )}

          {log && full && (
            <>
              <button className="ghost small" style={{ marginBottom: 8 }} onClick={() => setFull(false)}>← Back to highlights</button>
              {log.entries.map((e) => <EntryBlock key={e.version} entry={e} items={e.features} current={e.version === log.current} dense />)}
              <button className="ghost small mt8" onClick={() => setFull(false)}>← Back to highlights</button>
            </>
          )}
        </div>
        <button className="primary mt8" onClick={onClose}>Back to the game</button>
      </div>
    </div>
  )
}
