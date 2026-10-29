import { useEffect, useState } from 'react'
import { api, type AchievementsStatus } from '../api'
import { fmtDate } from '../components'

const GROUP_LABEL: Record<string, string> = {
  collection: '📚 Collection',
  business: '💼 Business',
  grading: '⚖ Grading',
  streaks: '🔥 Streaks',
  empire: '🌎 Empire',
}

export function AchievementsView() {
  const [data, setData] = useState<AchievementsStatus | null>(null)
  useEffect(() => { api.achievements().then(setData).catch(() => {}) }, [])
  if (!data) return <div className="faint small mt14">Polishing the trophy case…</div>

  const pct = Math.round((data.unlockedCount / data.total) * 100)
  return (
    <div className="mt14">
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 style={{ margin: 0 }}>🏆 Achievements</h2>
            <div className="faint small">{data.unlockedCount} of {data.total} unlocked ({pct}%)</div>
          </div>
          {data.recent.length > 0 && (
            <div className="faint small right">
              Latest: {data.recent.slice(0, 3).map((r) => `${r.icon} ${r.title}`).join(' · ')}
            </div>
          )}
        </div>
        <div style={{ height: 10, background: 'rgba(18,39,95,.12)', borderRadius: 5, overflow: 'hidden', marginTop: 10 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--yellow)', transition: 'width .4s' }} />
        </div>
      </div>

      {data.groups.map((g) => {
        const rows = data.rows.filter((r) => r.group === g)
        const done = rows.filter((r) => r.unlockedAt).length
        if (rows.length === 0) return null
        return (
          <div key={g} className="panel mt14">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b className="small">{GROUP_LABEL[g] ?? g}</b>
              <span className="faint small">{done}/{rows.length}</span>
            </div>
            <div className="grid cols3 mt8" style={{ gap: 10 }}>
              {rows.map((r) => {
                const doneNow = !!r.unlockedAt
                return (
                  <div key={r.id} className="conv-booth" style={{ opacity: doneNow ? 1 : r.isNext ? 0.95 : 0.55, borderColor: r.isNext && !doneNow ? 'rgba(245,197,24,.45)' : undefined }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 20 }}>{doneNow ? r.icon : '🔒'}</span>
                      {doneNow && <span className="faint small">{fmtDate(r.unlockedAt)}</span>}
                      {!doneNow && r.isNext && <span className="badge" style={{ fontSize: 9, borderColor: 'var(--yellow)', color: 'var(--gold)' }}>next up</span>}
                    </div>
                    <b className="small" style={{ display: 'block', marginTop: 4 }}>{r.title}</b>
                    <div className="faint small" style={{ minHeight: 30 }}>{r.desc}</div>
                    {!doneNow && r.pct > 0 && (
                      <div className="mt8">
                        <div style={{ height: 6, background: 'rgba(18,39,95,.12)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.round(r.pct * 100)}%`, background: 'var(--yellow)' }} />
                        </div>
                        <div className="faint small mt4">{r.label ?? `${Math.round(r.pct * 100)}%`}</div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
