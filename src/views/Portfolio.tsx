import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Portfolio, PortfolioSetRow, PortfolioPosition } from '../api'
import { CardImg, Delta, EmptyState, fmtUsd, fmtDate } from '../components'

const pct = (n: number | null | undefined, digits = 1) =>
  n == null || !isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`

const gainColor = (n: number | null | undefined) =>
  n == null ? 'var(--muted)' : n > 0.001 ? 'var(--green)' : n < -0.001 ? 'var(--red)' : 'var(--muted)'

/** Two normalized lines, 100 at the left edge — you vs the index. */
function BenchmarkChart({ chart, spLabel }: { chart: { week: string; collection: number; sp: number }[]; spLabel: string }) {
  if (chart.length < 2) {
    return (
      <div className="empty" style={{ padding: 26 }}>
        The benchmark builds from weekly save snapshots.<br />
        <span className="small">Two+ weeks in and this chart draws itself.</span>
      </div>
    )
  }
  const w = 640
  const h = 200
  const all = chart.flatMap((p) => [p.collection, p.sp])
  const min = Math.min(90, ...all)
  const max = Math.max(...all)
  const span = max - min || 1
  const xy = (v: number, i: number): [number, number] => [
    (i / (chart.length - 1)) * (w - 8) + 4,
    h - 12 - ((v - min) / span) * (h - 28),
  ]
  const line = (key: 'collection' | 'sp') =>
    chart.map((p, i) => `${i === 0 ? 'M' : 'L'}${xy(p[key], i)[0].toFixed(1)},${xy(p[key], i)[1].toFixed(1)}`).join(' ')
  const colStroke = chart[chart.length - 1].collection >= 100 ? '#2ee6a8' : '#ff5d5d'
  const base = xy(100, 0)[1]
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }} preserveAspectRatio="none">
        <line x1={4} y1={base} x2={w - 4} y2={base} stroke="var(--muted)" strokeDasharray="3 5" strokeWidth="1" />
        <path d={line('sp')} fill="none" stroke="#c9a227" strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" />
        <path d={line('collection')} fill="none" stroke={colStroke} strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small" style={{ color: colStroke, fontWeight: 650 }}>▬ Your cardboard</span>
        <span className="small" style={{ color: '#c9a227', fontWeight: 650 }}>{spLabel}</span>
        <span className="faint small">100 = first snapshot</span>
      </div>
    </div>
  )
}

function PositionLine({ p }: { p: PortfolioPosition }) {
  return (
    <div className="row" style={{ alignItems: 'center', gap: 10 }}>
      <div style={{ width: 34 }}><CardImg src={p.image} alt={p.name} cardId={p.cardId} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b className="small">{p.name}{p.quantity > 1 ? ` ×${p.quantity}` : ''}</b>
        <div className="faint small">{p.setName} · {p.gradedGrade ?? p.condition}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <span className="small" style={{ color: gainColor(p.gainPct), fontWeight: 700 }}>{pct(p.gainPct)}</span>
        <div className="faint small">{fmtUsd(p.invested)} → {fmtUsd(p.value)}</div>
      </div>
    </div>
  )
}

export function PortfolioView() {
  const [pf, setPf] = useState<Portfolio | null>(null)
  const [setSort, setSetSort] = useState<'roi' | 'gain' | 'value'>('roi')

  useEffect(() => {
    api.portfolio().then(setPf).catch(() => {})
  }, [])

  if (!pf) return <EmptyState icon="📈" text="Crunching the books…" sub="Cost bases, sale history, and snapshots." />

  const empty = pf.deployedTotal === 0 && pf.salesCount === 0
  if (empty) {
    return <EmptyState icon="📈" text="No positions yet" sub="Buy a card — anywhere — and the portfolio starts keeping score." />
  }

  const setsSorted: PortfolioSetRow[] =
    setSort === 'roi' ? [...pf.sets].sort((a, b) => (b.gainPct ?? -9) - (a.gainPct ?? -9))
      : setSort === 'gain' ? [...pf.sets].sort((a, b) => b.gain - a.gain)
      : [...pf.sets].sort((a, b) => b.value - a.value)

  const beating = pf.totalReturnPct != null && pf.spReturnPct != null && pf.totalReturnPct >= pf.spReturnPct
  const realIdx = pf.spSource === 'real'
  const spLabel = realIdx ? '▬ S&P 500 (real closes)' : '▬ S&P what-if (~10%/yr)'

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1>Portfolio</h1>
          <div className="sub">The collection as an investment: what went in, what it's worth, and what the index would have done.</div>
        </div>
      </div>

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', margin: '14px 0' }}>
        <div className="panel" style={{ flex: '1 1 150px', padding: '12px 16px' }}>
          <div className="faint small">DEPLOYED</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtUsd(pf.deployedTotal)}</div>
          <div className="faint small">{fmtUsd(pf.invested)} still held</div>
        </div>
        <div className="panel" style={{ flex: '1 1 150px', padding: '12px 16px' }}>
          <div className="faint small">PAPER VALUE</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtUsd(pf.value)}</div>
          <div className="small" style={{ color: gainColor(pf.unrealizedPct) }}>{pct(pf.unrealizedPct)} unrealized</div>
        </div>
        <div className="panel" style={{ flex: '1 1 150px', padding: '12px 16px' }}>
          <div className="faint small">REALIZED</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: gainColor(pf.realized) }}>{fmtUsd(pf.realized)}</div>
          <div className="faint small">{pf.salesCount} sale{pf.salesCount === 1 ? '' : 's'} · {pct(pf.realizedPct)} on {fmtUsd(pf.realizedCost)} cost</div>
        </div>
        <div className="panel" style={{ flex: '1 1 150px', padding: '12px 16px' }}>
          <div className="faint small">TOTAL RETURN</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: gainColor(pf.totalReturnPct) }}>{pct(pf.totalReturnPct)}</div>
          <div className="faint small" title={pf.mwrNote}>{pf.moneyWeightedReturnPct != null ? 'money-weighted' : 'vs deployed capital'}</div>
        </div>
      </div>

      <div className="panel" style={{ padding: '14px 16px', marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <b>Cardboard vs the index</b>
          <span className="faint small" title={pf.benchmarkNote}>weekly snapshots, normalized to 100</span>
        </div>
        <BenchmarkChart chart={pf.chart} spLabel={spLabel} />
      </div>

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="panel" style={{ flex: '1 1 300px', padding: '12px 16px' }}>
          <b className="small">If it had been the S&P</b>
          <div className="small muted" style={{ margin: '6px 0' }}>{pf.benchmarkNote}</div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small">Same {fmtUsd(pf.deployedTotal)}, in the index</span>
            <b style={{ color: '#c9a227' }}>{fmtUsd(pf.spSameMoney)}</b>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small">Index return over your span</span>
            <b style={{ color: '#c9a227' }}>{pct(pf.spReturnPct)}</b>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small">Your total return</span>
            <b style={{ color: gainColor(pf.totalReturnPct) }}>{pct(pf.totalReturnPct)}</b>
          </div>
          <div className="small" style={{ marginTop: 8, color: beating ? 'var(--green)' : 'var(--muted)', fontWeight: beating ? 700 : 400 }}>
            {beating
              ? '🥇 You are beating the market. The accountant is suspicious.'
              : '📉 The index is ahead. Cardboard is a hobby first, portfolio second.'}
          </div>
        </div>
        <div className="panel" style={{ flex: '1 1 300px', padding: '12px 16px' }}>
          <b className="small">Income while holding</b>
          {pf.income.length === 0 ? (
            <div className="muted small" style={{ margin: '6px 0' }}>No business income yet — the collection just sits there, earning looks.</div>
          ) : (
            <div style={{ margin: '6px 0' }}>
              {pf.income.map((r) => (
                <div className="row" key={r.line} style={{ justifyContent: 'space-between' }}>
                  <span className="small">{r.line}</span>
                  <b className="small" style={{ color: r.total >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtUsd(r.total)}</b>
                </div>
              ))}
            </div>
          )}
          <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
            <span className="small">Total income</span>
            <b className="small" style={{ color: pf.incomeTotal >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtUsd(pf.incomeTotal)}</b>
          </div>
          <div className="faint small" style={{ marginTop: 6 }}>
            Best position {pf.best ? `${pf.best.name} ${pct(pf.best.gainPct)}` : '—'} · worst {pf.worst ? `${pf.worst.name} ${pct(pf.worst.gainPct)}` : '—'}
          </div>
        </div>
      </div>

      {pf.best || pf.worst ? (
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          {pf.best && (
            <div className="panel" style={{ flex: '1 1 300px', padding: '10px 14px' }}>
              <div className="faint small" style={{ marginBottom: 4 }}>⬆ BEST PERFORMER</div>
              <PositionLine p={pf.best} />
            </div>
          )}
          {pf.worst && (
            <div className="panel" style={{ flex: '1 1 300px', padding: '10px 14px' }}>
              <div className="faint small" style={{ marginBottom: 4 }}>⬇ WORST PERFORMER</div>
              <PositionLine p={pf.worst} />
            </div>
          )}
        </div>
      ) : null}

      <div className="panel" style={{ padding: '12px 16px', marginBottom: 14 }}>
        <b className="small">By era</b>
        <table className="table" style={{ marginTop: 8 }}>
          <thead><tr><th>Era (series)</th><th className="right">Sets</th><th className="right">Deployed</th><th className="right">Now</th><th className="right">P/L</th><th className="right">ROI</th></tr></thead>
          <tbody>
            {pf.eras.map((e) => (
              <tr key={e.series}>
                <td><b className="small">{e.series}</b></td>
                <td className="num small">{e.sets}</td>
                <td className="num small">{fmtUsd(e.invested)}</td>
                <td className="num small">{fmtUsd(e.value)}</td>
                <td className="num small" style={{ color: gainColor(e.gain) }}>{fmtUsd(e.gain)}</td>
                <td className="num"><Delta pct={e.gainPct} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ padding: '12px 16px' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b className="small">By set</b>
          <span className="chip-row">
            <span className={`chip ${setSort === 'roi' ? 'on' : ''}`} onClick={() => setSetSort('roi')}>Sort: ROI</span>
            <span className={`chip ${setSort === 'gain' ? 'on' : ''}`} onClick={() => setSetSort('gain')}>Sort: $ P/L</span>
            <span className={`chip ${setSort === 'value' ? 'on' : ''}`} onClick={() => setSetSort('value')}>Sort: value</span>
          </span>
        </div>
        {pf.sets.length === 0 ? (
          <div className="muted small" style={{ marginTop: 8 }}>Nothing held yet.</div>
        ) : (
          <table className="table" style={{ marginTop: 8 }}>
            <thead><tr><th>Set</th><th className="right">Cards</th><th className="right">Deployed</th><th className="right">Now</th><th className="right">P/L</th><th className="right">ROI</th></tr></thead>
            <tbody>
              {setsSorted.map((s) => (
                <tr key={s.setId} title={`Released ${s.releaseDate ? fmtDate(s.releaseDate) : 'unknown'} · ${s.series}`}>
                  <td>
                    <b className="small">{s.setName}</b>
                    <div className="faint small">{s.series}</div>
                  </td>
                  <td className="num small">{s.cardsHeld}</td>
                  <td className="num small">{fmtUsd(s.invested)}</td>
                  <td className="num small">{fmtUsd(s.value)}</td>
                  <td className="num small" style={{ color: gainColor(s.gain) }}>{fmtUsd(s.gain)}</td>
                  <td className="num"><Delta pct={s.gainPct} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
