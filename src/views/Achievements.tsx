import { useEffect, useState } from 'react'
import { api, type AchievementRow, type AchievementsStatus } from '../api'
import { fmtDate } from '../components'

// ---------------------------------------------------------------------------
// Achievements — the trophy shelf.
//
// This was a grid of cards with a 🔒 where the trophy should be: the wall of
// thirty looked like thirty locks and told you nothing about what you were
// chasing. A trophy case should read as furniture — rows of objects on planks,
// the earned ones lit, the rest sitting there greyed out under a thin coat of
// dust so you can see the shape of what's missing.
//
// So: one shelf per group, trophies standing on a plank, greyed until earned,
// with the closest one to firing breathing gently. Tapping any trophy opens its
// plate — description, progress, when it landed.
// ---------------------------------------------------------------------------

const GROUP_LABEL: Record<string, string> = {
  collection: '📚 Collection',
  business: '💼 Business',
  grading: '⚖ Grading',
  streaks: '🔥 Streaks',
  empire: '🌎 Empire',
}

/** Screens are narrow here; three trophies per plank keeps the names legible. */
const PER_SHELF = 3

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

function Trophy({ row, onOpen }: { row: AchievementRow; onOpen: () => void }) {
  const done = !!row.unlockedAt
  const cls = `trophy${done ? ' is-done' : ' is-locked'}${!done && row.isNext ? ' is-next' : ''}`
  return (
    <button
      className={cls}
      onClick={onOpen}
      title={done ? `${row.title} — ${row.desc} (${fmtDate(row.unlockedAt)})` : `${row.title} — ${row.desc}`}
      aria-label={`${row.title}${done ? ', unlocked' : ', locked'}`}
    >
      {/* The plinth lives on the icon's own box, not the tile — a two-line
          title used to shift the icon out of a disc pinned to the tile top. */}
      <span className="trophy-spot">
        <span className="trophy-icon" aria-hidden>{row.icon}</span>
      </span>
      <span className="trophy-name">{row.title}</span>
      {/* Meter under the label, not between the icon and it — as a bar in the
          middle it read as a strikethrough on the trophy. */}
      {!done && row.pct > 0 && (
        <span className="trophy-bar" aria-hidden>
          <span style={{ width: `${Math.max(3, Math.round(row.pct * 100))}%` }} />
        </span>
      )}
    </button>
  )
}

function TrophyPlate({ row, onClose }: { row: AchievementRow; onClose: () => void }) {
  const done = !!row.unlockedAt
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(440px, 96vw)' }}>
        <div className="modal-head">
          <h2>🏆 {done ? 'On the shelf' : row.isNext ? 'Closest to the shelf' : 'Not yet earned'}</h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <div className={`trophy-plate${done ? ' is-done' : ''}`}>
          <div className={`trophy-plate-icon${done ? '' : ' is-locked'}`} aria-hidden>{row.icon}</div>
          <b className="trophy-plate-title">{row.title}</b>
          <div className="home-mini" style={{ textAlign: 'center' }}>{row.desc}</div>
          {done ? (
            <div className="small" style={{ color: 'var(--green)', fontWeight: 700, marginTop: 8 }}>
              ✓ Earned {fmtDate(row.unlockedAt)}
            </div>
          ) : (
            <>
              <div className="trophy-bar" style={{ width: '80%', height: 8, marginTop: 10 }}>
                <span style={{ width: `${Math.max(2, Math.round(row.pct * 100))}%` }} />
              </div>
              <div className="faint small" style={{ marginTop: 6 }}>
                {row.label ?? `${Math.round(row.pct * 100)}% of the way there`}
              </div>
              {row.isNext && <div className="badge" style={{ marginTop: 8, borderColor: 'var(--yellow)', color: 'var(--gold)' }}>next up</div>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function AchievementsView() {
  const [data, setData] = useState<AchievementsStatus | null>(null)
  const [picked, setPicked] = useState<AchievementRow | null>(null)
  useEffect(() => { api.achievements().then(setData).catch(() => {}) }, [])
  if (!data) return <div className="faint small mt14">Polishing the trophy case…</div>

  const pct = Math.round((data.unlockedCount / data.total) * 100)
  const nextUp = data.rows.find((r) => r.isNext && !r.unlockedAt)

  return (
    <div>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>Achievements</h1>
          <div className="sub">Thirty trophies on five shelves. Every one you own is lit; the rest are the shape of what's missing.</div>
        </div>
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div className="home-kicker">On the shelf</div>
            <div className="pf-big" style={{ color: 'var(--gold)' }}>{data.unlockedCount}<span className="faint" style={{ fontSize: 18, fontWeight: 700 }}> / {data.total}</span></div>
          </div>
          <div className="right">
            <div className="small">{pct}% of the case</div>
            {nextUp && <div className="faint small">next: {nextUp.icon} {nextUp.title}</div>}
          </div>
        </div>
        <div className="bar" style={{ height: 10, marginTop: 10 }}>
          <div className="fill" style={{ width: `${pct}%`, background: 'var(--yellow)' }} />
        </div>
        {data.recent.length > 0 && (
          <div className="home-mini" style={{ marginTop: 8 }}>
            Recently shelved: {data.recent.slice(0, 3).map((r) => `${r.icon} ${r.title}`).join(' · ')}
          </div>
        )}
      </div>

      {data.groups.map((g) => {
        const rows = data.rows.filter((r) => r.group === g)
        if (rows.length === 0) return null
        const done = rows.filter((r) => r.unlockedAt).length
        return (
          <section key={g} className="trophies-sec">
            <div className="trophy-sec-head">
              <b className="small">{GROUP_LABEL[g] ?? g}</b>
              <span className="faint small">{done}/{rows.length} shelved</span>
            </div>
            {/* One carcass per group: the shelves share the case's sides, so it
                reads as furniture rather than a stack of floating rules. */}
            <div className="trophy-case">
              {chunk(rows, PER_SHELF).map((group, i) => (
                <div className="trophy-shelf" key={i}>
                  <div className="trophy-row">
                    {group.map((r) => <Trophy key={r.id} row={r} onOpen={() => setPicked(r)} />)}
                  </div>
                  <div className="trophy-plank" aria-hidden />
                </div>
              ))}
            </div>
          </section>
        )
      })}

      {picked && <TrophyPlate row={picked} onClose={() => setPicked(null)} />}
    </div>
  )
}
