import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { byNum, byStr, EmptyState, fmtUsd, matchesQuery, SearchInput, SortSelect, Chip, BestPullCard } from '../components'
import type { PullRow } from '../types'

export function PullHistoryView() {
  const [pulls, setPulls] = useState<PullRow[]>([])
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.pullsSummary>> | null>(null)
  const [best, setBest] = useState<Awaited<ReturnType<typeof api.pullsBest>> | null>(null)
  const { openCard } = useStore()
  const [q, setQ] = useState('')
  const [hitsOnly, setHitsOnly] = useState(false)
  const [sort, setSort] = useState('recent')

  useEffect(() => {
    api.pulls().then(setPulls).catch(() => {})
    api.pullsSummary().then(setSummary).catch(() => {})
    api.pullsBest().then(setBest).catch(() => {})
  }, [])

  const sessions = summary?.sessions ?? []
  const spentBySession = new Map<string, number>()

  const shownPulls = useMemo(() => {
    const out = pulls.filter((p) => {
      if (hitsOnly && !p.is_hit) return false
      if (!matchesQuery(p, q, (r) => [r.name, r.set_name, r.rarity])) return false
      return true
    })
    const sorters: Record<string, (a: PullRow, b: PullRow) => number> = {
      recent: byStr((p) => p.opened_at, 'desc'),
      oldest: byStr((p) => p.opened_at, 'asc'),
      value_desc: byNum((p) => p.value, 'desc'),
      value_asc: byNum((p) => p.value, 'asc'),
      name_asc: byStr((p) => p.name, 'asc'),
    }
    return [...out].sort(sorters[sort] ?? sorters.recent)
  }, [pulls, q, hitsOnly, sort])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Pull History</h1>
          <div className="sub">Every pack you've ripped — and whether luck was on your side.</div>
        </div>
      </div>

      {sessions.length === 0 ? (
        <EmptyState icon="📦" text="No packs opened yet" sub="Your sessions, pull values, and ROI will appear here." />
      ) : (
        <>
          {best && best.cardId && (
            <div className="panel mb14" style={{ borderColor: 'rgba(250,204,21,.4)', background: 'linear-gradient(160deg,rgba(250,204,21,.06),transparent 60%)' }}>
              <div className="faint small" style={{ marginBottom: 6, letterSpacing: '.08em' }}>👑 ALL-TIME BEST PULL</div>
              <BestPullCard best={best} onOpenCard={openCard} />
            </div>
          )}

          <div className="grid cols3 mb14">
            {sessions.slice(0, 6).map((s) => (
              <div key={s.session_id} className="kpi">
                <div className="lbl">{new Date(s.opened_at).toLocaleString()}</div>
                <div className="val" style={{ fontSize: 18 }}>{fmtUsd(s.total_value)}</div>
                <div className="note">{s.card_count} cards · {s.hits} hit{s.hits === 1 ? '' : 's'}</div>
              </div>
            ))}
          </div>

          <div className="panel">
            <h2>Recent pulls</h2>
            <div className="filter-row" style={{ marginBottom: 10 }}>
              <SearchInput value={q} onChange={setQ} placeholder="Search pulls by card, set, rarity…" />
              <SortSelect
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'recent', label: 'Sort: Most recent' },
                  { value: 'oldest', label: 'Sort: Oldest first' },
                  { value: 'value_desc', label: 'Sort: Biggest pulls' },
                  { value: 'value_asc', label: 'Sort: Smallest pulls' },
                  { value: 'name_asc', label: 'Sort: Name A→Z' },
                ]}
              />
              <Chip on={hitsOnly} onClick={() => setHitsOnly(!hitsOnly)}>⚡ Hits only</Chip>
              <span className="result-count faint small">{shownPulls.length} of {pulls.length} pulls</span>
            </div>
            <table className="table">
              <thead><tr><th>Card</th><th>Set</th><th>Rarity</th><th className="right">Value at pull</th><th className="right">When</th></tr></thead>
              <tbody>
                {shownPulls.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b className="small">{p.name}</b>
                      {p.is_hit ? <span className="badge hit" style={{ marginLeft: 6 }}>HIT</span> : null}
                    </td>
                    <td className="small muted">{p.set_name}</td>
                    <td className="small">{p.rarity ?? '—'}</td>
                    <td className="num">{fmtUsd(p.value)}</td>
                    <td className="num faint small">{new Date(p.opened_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
