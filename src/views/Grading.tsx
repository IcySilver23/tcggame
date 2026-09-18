import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { GradingService, GradingStats } from '../api'
import { useStore } from '../store'
import { byNum, byStr, CardImg, EmptyState, fmtUsd, matchesQuery, SearchInput, SortSelect } from '../components'

const GRADE_BADGE: Record<string, string> = {
  PSA10: 'GEM MNT 10', PSA9: 'MINT 9', PSA8: 'NM-MT 8', PSA7: 'NM 7',
  BGS10: 'BGS 10', CGC10: 'CGC 10', SGC10: 'SGC 10',
}

const SERVICE_NAME: Record<string, string> = {
  standard: 'Standard Grading',
  express: 'Express Grading',
  premium: 'Premium Grading',
}

export function GradingView() {
  const { toast, refreshState, openCard } = useStore()
  const [stats, setStats] = useState<GradingStats | null>(null)
  const [services, setServices] = useState<GradingService[]>([])
  const [pending, setPending] = useState<{ id: number; name: string; image_small: string | null; card_id: string; grading_service: string | null; grading_due_at: string; condition: string }[]>([])
  const [submitting, setSubmitting] = useState<number | null>(null)
  const [candQ, setCandQ] = useState('')
  const [candSort, setCandSort] = useState('edge_desc')

  const load = useCallback(async () => {
    try {
      setStats(await api.gradingStats())
      setServices(await api.gradingServices())
      const g = await api.gradingPending()
      setPending(g.pending)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 20000) // grades resolve on the game tick — poll for reveals
    return () => clearInterval(t)
  }, [load])

  const roiClass = (roi: number | null) => (roi == null ? 'faint' : roi >= 0 ? 'delta-up' : 'delta-down')

  const shownCandidates = useMemo(() => {
    const all = stats?.candidates ?? []
    const out = all.filter((c) => matchesQuery(c, candQ, (x) => [x.name, x.set, x.condition, x.serviceName]))
    const sorters: Record<string, (a: typeof all[number], b: typeof all[number]) => number> = {
      edge_desc: byNum((c) => c.edge, 'desc'),
      profit_desc: byNum((c) => c.expectedProfit, 'desc'),
      gem_desc: byNum((c) => c.gemChance, 'desc'),
      raw_asc: byNum((c) => c.rawValue, 'asc'),
      raw_desc: byNum((c) => c.rawValue, 'desc'),
      name_asc: byStr((c) => c.name, 'asc'),
    }
    return [...out].sort(sorters[candSort] ?? sorters.edge_desc)
  }, [stats, candQ, candSort])

  const totalGemRate = stats?.totals.gemRate
  const maxDist = Math.max(1, ...(stats?.distribution ?? []).map((d) => d.n))

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Grading</h1>
          <div className="sub">Your grading operation — submissions, grade outcomes, and ROI per service.</div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid cols4 mb14">
        <div className="panel" style={{ margin: 0 }}>
          <div className="faint small">SPENT ON GRADING</div>
          <div className="po-value">{fmtUsd(stats?.totals.spent)}</div>
          <div className="small faint">{stats?.totals.submitted ?? 0} cards submitted</div>
        </div>
        <div className="panel" style={{ margin: 0 }}>
          <div className="faint small">REALIZED PROFIT</div>
          <div className={`po-value ${roiClass(stats && stats.totals.profit ? stats.totals.profit : null)}`}>{fmtUsd(stats?.totals.profit)}</div>
          <div className="small faint">{stats?.totals.soldCount ?? 0} graded slabs sold</div>
        </div>
        <div className="panel" style={{ margin: 0 }}>
          <div className="faint small">UNREALIZED VALUE</div>
          <div className="po-value">{fmtUsd(stats?.totals.unrealized)}</div>
          <div className="small faint">{(stats?.totals.returned ?? 0) - (stats?.totals.soldCount ?? 0)} slabs still held</div>
        </div>
        <div className="panel" style={{ margin: 0 }}>
          <div className="faint small">NET (PROFIT + HELD − SPENT)</div>
          <div className={`po-value ${roiClass(stats ? stats.totals.net : null)}`}>{fmtUsd(stats?.totals.net)}</div>
          <div className="small faint">
            {totalGemRate != null ? <>gem rate <b>{totalGemRate}%</b></> : 'no results yet'}
          </div>
        </div>
      </div>

      {/* Worth grading now */}
      {(stats?.candidates ?? []).length > 0 && (
        <div className="panel mb14">
          <h2>⚖ Worth grading now</h2>
          <p className="small muted mb8">
            Expected graded value uses your actual grade odds per condition and real graded prices
            (PriceCharting / eBay comps), minus the 10% sale fee and grading fee — compared with selling the card raw.
          </p>
          <div className="filter-row" style={{ marginBottom: 10 }}>
            <SearchInput value={candQ} onChange={setCandQ} placeholder="Search gradeable cards…" />
            <SortSelect
              value={candSort}
              onChange={setCandSort}
              options={[
                { value: 'edge_desc', label: 'Sort: Best grading edge' },
                { value: 'profit_desc', label: 'Sort: Expected profit' },
                { value: 'gem_desc', label: 'Sort: Gem chance' },
                { value: 'raw_desc', label: 'Sort: Priciest raw cards' },
                { value: 'raw_asc', label: 'Sort: Cheapest raw cards' },
                { value: 'name_asc', label: 'Sort: Name A→Z' },
              ]}
            />
            <span className="result-count faint small">{shownCandidates.length} of {(stats?.candidates ?? []).length} candidates</span>
          </div>
          <table className="table">
            <thead>
              <tr><th>Card</th><th className="right">Raw</th><th>Best service</th><th className="right">Gem chance</th>
                  <th className="right">Expected profit</th><th className="right">If gem</th><th className="right">Edge</th><th></th></tr>
            </thead>
            <tbody>
              {shownCandidates.map((c) => (
                <tr key={c.inventoryId}>
                  <td>
                    <div className="row" style={{ cursor: 'pointer' }} onClick={() => openCard(c.cardId)}>
                      <div style={{ width: 32 }}><CardImg src={c.image} alt={c.name} /></div>
                      <div>
                        <b className="small">{c.name}</b>
                        <div className="faint small">{c.set} · {c.condition}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num">{fmtUsd(c.rawValue)}</td>
                  <td className="small">{c.serviceName} <span className="faint small">(${c.cost})</span></td>
                  <td className="num">{c.gemChance}%</td>
                  <td className="num delta-up">{fmtUsd(c.expectedProfit)}</td>
                  <td className="num faint">{fmtUsd(c.upside)}</td>
                  <td className="num delta-up" style={{ fontWeight: 700 }}>+{fmtUsd(c.edge)}</td>
                  <td className="right">
                    <div className="faint small" style={{ marginBottom: 4 }} title={`Grading fees are deductible business expenses: ${c.taxSavings.honest > 0 ? `saves ~${fmtUsd(c.taxSavings.honest)} at your ${Math.round(c.taxSavings.bracketRate * 100)}% marginal bracket` : 'no tax benefit while profits are below the small-collector allowance'}${c.taxSavings.aggressive > c.taxSavings.honest ? ` · ${fmtUsd(c.taxSavings.aggressive)} on aggressive books` : ''}`}>
                      {c.taxSavings.honest > 0 ? (
                        <>🧾 −{fmtUsd(c.taxSavings.honest)} tax</>
                      ) : (
                        <>🧾 no tax benefit</>
                      )}
                    </div>
                    <button
                      className="small primary"
                      disabled={submitting === c.inventoryId}
                      onClick={async () => {
                        setSubmitting(c.inventoryId)
                        try {
                          const res = await api.gradingSubmit(c.inventoryId, c.serviceId)
                          toast(`Submitted to ${c.serviceName} ($${res.cost.toFixed(2)}) — deductible next filing${c.taxSavings.honest > 0 ? `, saves ~${fmtUsd(c.taxSavings.honest)} in tax` : ''}`, 'good')
                          await load()
                          refreshState()
                        } catch (e) {
                          toast(e instanceof Error ? e.message : 'Submit failed', 'bad')
                        } finally {
                          setSubmitting(null)
                        }
                      }}
                    >
                      GRADE
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ROI per service */}
      <div className="panel">
        <h2>ROI by grading service</h2>
        {(stats?.services ?? []).length === 0 ? (
          <EmptyState icon="⚖" text="No grading history yet" sub="Submit cards from Inventory → Raw cards → ⚖ Grade." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Service</th><th className="right">Submitted</th><th className="right">Spent</th>
                <th className="right">Gem rate</th><th className="right">Sold</th>
                <th className="right">Revenue</th><th className="right">Profit</th>
                <th className="right">Held value</th><th className="right">ROI</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.services ?? []).map((s) => (
                <tr key={s.service ?? 'unknown'}>
                  <td><b>{SERVICE_NAME[s.service ?? ''] ?? s.service ?? 'Unknown'}</b></td>
                  <td className="num">{s.submitted}</td>
                  <td className="num faint">{fmtUsd(s.spent)}</td>
                  <td className="num">{s.gemRate != null ? `${s.gemRate}%` : '—'} <span className="faint small">({s.gems}/{s.returned})</span></td>
                  <td className="num">{s.soldCount}</td>
                  <td className="num">{fmtUsd(s.revenue)}</td>
                  <td className={`num ${s.profit >= 0 ? 'delta-up' : 'delta-down'}`}>{fmtUsd(s.profit)}</td>
                  <td className="num faint">{fmtUsd(s.unrealized)}</td>
                  <td className={`num ${roiClass(s.roi)}`} style={{ fontWeight: 700 }}>
                    {s.roi != null ? `${s.roi > 0 ? '+' : ''}${s.roi}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small muted mt8">
          ROI = (realized profit + current market value of slabs still held − fees paid) ÷ fees paid.
          Slab values use real PriceCharting grade prices, falling back to live eBay graded comps.
        </p>
      </div>

      <div className="grid cols2 mt14">
        {/* Grade distribution */}
        <div className="panel" style={{ margin: 0 }}>
          <h2>Grade distribution</h2>
          {(stats?.distribution ?? []).length === 0 ? (
            <EmptyState icon="📊" text="No graded cards yet" />
          ) : (
            <div className="stack">
              {(stats?.distribution ?? []).map((d) => (
                <div key={d.grade}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="badge hit">{GRADE_BADGE[d.grade] ?? d.grade}</span>
                    <span className="small">{d.n}</span>
                  </div>
                  <div className="bar mt4" style={{ height: 8 }}>
                    <div className="fill" style={{ width: `${(d.n / maxDist) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt14">
            <h2 style={{ fontSize: 15 }}>Services</h2>
            {services.map((s) => (
              <div key={s.id} className="row small" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
                <span><b>{s.name}</b> <span className="faint">· {s.desc}</span></span>
                <span className="faint">${s.cost} · {s.daysMin}–{s.daysMax}d</span>
              </div>
            ))}
          </div>
        </div>

        {/* Pending */}
        <div className="panel" style={{ margin: 0 }}>
          <h2>At the grading company ({pending.length})</h2>
          {pending.length === 0 ? (
            <EmptyState icon="⏳" text="Nothing in transit" sub="Results appear here — and pop a reveal — when they come back." />
          ) : (
            <table className="table">
              <thead><tr><th>Card</th><th>Service</th><th className="right">Back in</th></tr></thead>
              <tbody>
                {pending.map((p) => {
                  const msLeft = new Date(p.grading_due_at).getTime() - Date.now()
                  const days = Math.max(0, Math.ceil(msLeft / 20000))
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="row" style={{ cursor: 'pointer' }} onClick={() => openCard(p.card_id)}>
                          <div style={{ width: 32 }}><CardImg src={p.image_small} alt={p.name} /></div>
                          <b className="small">{p.name}</b>
                        </div>
                      </td>
                      <td className="small">{SERVICE_NAME[p.grading_service ?? ''] ?? p.grading_service}</td>
                      <td className="num">~{days} game-day{days === 1 ? '' : 's'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Submission history */}
      <div className="panel mt14">
        <h2>Graded sales history</h2>
        {(stats?.history ?? []).length === 0 ? (
          <EmptyState icon="📜" text="No graded sales yet" sub="List a graded slab from Inventory and it will appear here with full ROI." />
        ) : (
          <table className="table">
            <thead>
              <tr><th>Card</th><th>Grade</th><th>Service</th><th className="right">Grading cost</th>
                  <th className="right">Received</th><th className="right">Total cost</th><th className="right">Profit</th><th className="right">ROI</th><th className="right">When</th></tr>
            </thead>
            <tbody>
              {(stats?.history ?? []).map((h) => {
                // Profit here already has the grading fee deducted server-side.
                const totalCost = (h.grading_cost ?? 0) + (h.sale_price - h.fee - h.profit)
                const roi = totalCost > 0 ? Math.round((h.profit / totalCost) * 100) : null
                return (
                  <tr key={h.id}>
                    <td>
                      <div className="row" style={{ cursor: 'pointer' }} onClick={() => openCard(h.card_id)}>
                        <div style={{ width: 32 }}><CardImg src={h.image_small} alt={h.name} /></div>
                        <b className="small">{h.name}</b>
                      </div>
                    </td>
                    <td><span className="badge hit">{GRADE_BADGE[h.grade] ?? h.grade}</span></td>
                    <td className="small">{SERVICE_NAME[h.service ?? ''] ?? h.service ?? '—'}</td>
                    <td className="num faint">{fmtUsd(h.grading_cost)}</td>
                    <td className="num">{fmtUsd(h.sale_price)}</td>
                    <td className="num faint small">{fmtUsd(totalCost)}</td>
                    <td className={`num ${h.profit >= 0 ? 'delta-up' : 'delta-down'}`}>{fmtUsd(h.profit)}</td>
                    <td className={`num ${roiClass(roi)}`}>{roi != null ? `${roi > 0 ? '+' : ''}${roi}%` : '—'}</td>
                    <td className="num faint small">{new Date(h.sold_at).toLocaleDateString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
