import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Portfolio, PortfolioSetRow, PortfolioPosition } from '../api'
import { CardImg, Delta, EmptyState, fmtUsd, fmtDate, LoadFailure } from '../components'

// ---------------------------------------------------------------------------
// Portfolio — the collection as an investment.
//
// What was wrong at this width: the screen had no page head (its title was a
// bare h1, so it was the one screen in the game without the yellow flag), the
// four headline numbers were four full-width panels stacked into about 700px of
// scrolling, and the two breakdowns were six-column tables — "By set" printed
// Set / Cards / Deployed / Now / P/L / ROI, of which roughly one and a half
// columns fit on screen.
//
// So: the standard page head, one hero carrying total return with the four
// figures as a compact grid, and the breakdowns as rows with the money and the
// ROI on the right where the eye already looks. Same endpoint, no new math.
// ---------------------------------------------------------------------------

const pct = (n: number | null | undefined, digits = 1) =>
  n == null || !isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`

const gainColor = (n: number | null | undefined) =>
  n == null ? 'var(--muted)' : n > 0.001 ? 'var(--green)' : n < -0.001 ? 'var(--red)' : 'var(--muted)'

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${fmtUsd(Math.abs(n))}`

/** Two normalized lines, 100 at the left edge — you vs the index. */
function BenchmarkChart({ chart, spLabel }: { chart: { week: string; collection: number; sp: number }[]; spLabel: string }) {
  if (chart.length < 2) {
    return (
      <div className="empty" style={{ padding: 22 }}>
        The benchmark builds from weekly save snapshots.<br />
        <span className="small">Two+ weeks in and this chart draws itself.</span>
      </div>
    )
  }
  const w = 640
  const h = 170
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
      <div className="pf-legend">
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
      <div style={{ width: 34, flex: 'none' }}><CardImg src={p.image} alt={p.name} cardId={p.cardId} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b className="small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.name}{p.quantity > 1 ? ` ×${p.quantity}` : ''}
        </b>
        <div className="faint small">{p.setName} · {p.gradedGrade ?? p.condition}</div>
      </div>
      <div style={{ textAlign: 'right', flex: 'none' }}>
        <span className="small" style={{ color: gainColor(p.gainPct), fontWeight: 700 }}>{pct(p.gainPct)}</span>
        <div className="faint small">{fmtUsd(p.invested)} → {fmtUsd(p.value)}</div>
      </div>
    </div>
  )
}

/** One breakdown row: name + what it holds on the left, money and ROI right. */
function BreakdownRow({ name, meta, gain, gainPct, value }: { name: string; meta: string; gain: number; gainPct: number | null; value: number }) {
  return (
    <div className="pf-row">
      <div className="pf-row-main">
        <b className="pf-row-name">{name}</b>
        <div className="faint small">{meta}</div>
      </div>
      <div className="pf-row-nums">
        <b className="small" style={{ color: gainColor(gain), fontVariantNumeric: 'tabular-nums' }}>{signed(gain)}</b>
        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <span className="faint small">{fmtUsd(value)}</span>
          <Delta pct={gainPct} />
        </div>
      </div>
    </div>
  )
}

export function PortfolioView() {
  const [pf, setPf] = useState<Portfolio | null>(null)
  const [setSort, setSetSort] = useState<'roi' | 'gain' | 'value'>('roi')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = () => {
    setStatus('loading')
    api.portfolio()
      .then((d) => { setPf(d); setStatus('ready') })
      .catch(() => setStatus('error'))
  }
  useEffect(() => { load() }, [])

  if (status === 'error') return <LoadFailure what="your portfolio" onRetry={load} />
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
  const unheld = pf.deployedTotal - pf.invested

  return (
    <div>
      <div className="page-head desk">
        <div className="ph-id">
          <span className="ph-mark" aria-hidden>📈</span>
          <div style={{ minWidth: 0 }}>
            <h1>Portfolio</h1>
            <div className="sub">The collection as an investment: what went in, what it's worth, and what the index would have done with the same money.</div>
          </div>
        </div>
      </div>

      <div className="panel pf-hero">
        <div className="pf-kicker">Total return</div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <div className="pf-big" style={{ color: gainColor(pf.totalReturnPct) }}>{pct(pf.totalReturnPct)}</div>
          <div className="right">
            <div className="small" title={pf.mwrNote}>
              {pf.moneyWeightedReturnPct != null ? 'money-weighted' : 'vs deployed capital'}
            </div>
            <div className={`pf-verdict ${beating ? 'up' : 'down'}`}>
              {beating ? '🥇 ahead of the index' : '📉 behind the index'}
            </div>
          </div>
        </div>

        <div className="pf-stats">
          <div className="pf-stat">
            <div className="lbl">Deployed</div>
            <div className="val">{fmtUsd(pf.deployedTotal)}</div>
            <div className="note">{fmtUsd(pf.invested)} still held{unheld > 0.005 ? ` · ${fmtUsd(unheld)} sold` : ''}</div>
          </div>
          <div className="pf-stat">
            <div className="lbl">Paper value</div>
            <div className="val">{fmtUsd(pf.value)}</div>
            <div className="note" style={{ color: gainColor(pf.unrealizedPct) }}>{pct(pf.unrealizedPct)} unrealized</div>
          </div>
          <div className="pf-stat">
            <div className="lbl">Realized</div>
            <div className="val" style={{ color: gainColor(pf.realized) }}>{fmtUsd(pf.realized)}</div>
            <div className="note">{pf.salesCount} sale{pf.salesCount === 1 ? '' : 's'} · {pct(pf.realizedPct)} on {fmtUsd(pf.realizedCost)}</div>
          </div>
          <div className="pf-stat">
            <div className="lbl">Unrealized</div>
            <div className="val" style={{ color: gainColor(pf.unrealized) }}>{signed(pf.unrealized)}</div>
            <div className="note">on {fmtUsd(pf.invested)} held</div>
          </div>
        </div>
      </div>

      <div className="panel mt14">
        <div className="home-sec-head">
          <b className="small">📈 Cardboard vs the index</b>
          <span className="faint small" title={pf.benchmarkNote}>weekly snapshots, normalised to 100</span>
        </div>
        <BenchmarkChart chart={pf.chart} spLabel={spLabel} />
        <div className="pf-index">
          <div>
            <span className="faint small">Same {fmtUsd(pf.deployedTotal)}, in the index</span>
            <b style={{ color: '#c9a227' }}>{fmtUsd(pf.spSameMoney)}</b>
          </div>
          <div>
            <span className="faint small">Index return over your span</span>
            <b style={{ color: '#c9a227' }}>{pct(pf.spReturnPct)}</b>
          </div>
          <div>
            <span className="faint small">Your total return</span>
            <b style={{ color: gainColor(pf.totalReturnPct) }}>{pct(pf.totalReturnPct)}</b>
          </div>
        </div>
        <div className="home-mini" style={{ marginTop: 8, fontWeight: beating ? 700 : 400 }}>
          {beating
            ? '🥇 You are beating the market. The accountant is suspicious.'
            : '📉 The index is ahead. Cardboard is a hobby first, portfolio second.'}
        </div>
        <div className="faint small" style={{ marginTop: 4 }}>{pf.benchmarkNote}</div>
      </div>

      {(pf.best || pf.worst) && (
        <div className="panel mt14">
          <div className="home-sec-head">
            <b className="small">🏅 Best & worst</b>
            <span className="faint small">by return on cost</span>
          </div>
          <div className="pf-positions">
            {pf.best && (
              <div>
                <div className="faint small">⬆ BEST PERFORMER</div>
                <PositionLine p={pf.best} />
              </div>
            )}
            {pf.worst && (
              <div>
                <div className="faint small">⬇ WORST PERFORMER</div>
                <PositionLine p={pf.worst} />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="panel mt14">
        <div className="home-sec-head">
          <b className="small">💵 Income while holding</b>
          <b className="small" style={{ color: pf.incomeTotal >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtUsd(pf.incomeTotal)}</b>
        </div>
        {pf.income.length === 0 ? (
          <div className="home-mini">No business income yet — the collection just sits there, earning looks.</div>
        ) : (
          <div className="pf-rows">
            {pf.income.map((r) => (
              <div className="pf-row" key={r.line}>
                <div className="pf-row-main"><b className="pf-row-name">{r.line}</b></div>
                <div className="pf-row-nums">
                  <b className="small" style={{ color: r.total >= 0 ? 'var(--green)' : 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(r.total)}</b>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel mt14">
        <div className="home-sec-head">
          <b className="small">🗂 By era</b>
          <span className="faint small">{pf.eras.length} series</span>
        </div>
        <div className="pf-rows">
          {pf.eras.map((e) => (
            <BreakdownRow
              key={e.series}
              name={e.series}
              meta={`${e.sets} set${e.sets === 1 ? '' : 's'} · ${fmtUsd(e.invested)} in → ${fmtUsd(e.value)} now`}
              gain={e.gain}
              gainPct={e.gainPct}
              value={e.value}
            />
          ))}
        </div>
      </div>

      <div className="panel mt14">
        <div className="seg-bar" role="tablist" aria-label="Sort sets">
          {([
            { id: 'roi', label: 'ROI' },
            { id: 'gain', label: '$ P/L' },
            { id: 'value', label: 'Value' },
          ] as const).map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={setSort === s.id}
              className={`seg-item${setSort === s.id ? ' on' : ''}`}
              title={`Sort sets by ${s.label}`}
              onClick={() => setSetSort(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        {pf.sets.length === 0 ? (
          <div className="home-mini" style={{ marginTop: 8 }}>Nothing held yet.</div>
        ) : (
          <div className="pf-rows" style={{ marginTop: 10 }}>
            {setsSorted.map((s) => (
              <BreakdownRow
                key={s.setId}
                name={s.setName}
                meta={`${s.cardsHeld} card${s.cardsHeld === 1 ? '' : 's'} · ${s.series}${s.releaseDate ? ` · ${fmtDate(s.releaseDate)}` : ''} · ${fmtUsd(s.invested)} in`}
                gain={s.gain}
                gainPct={s.gainPct}
                value={s.value}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
