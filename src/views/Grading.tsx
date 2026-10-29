import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { gameDayEtaFor } from '../lib/gameday'
import type { GradingReveal, GradingService, GradingStats } from '../api'
import { useStore } from '../store'
import { byNum, byStr, CardImg, DensityToggle, EmptyState, fmtUsd, GRADE_BADGE, GradeRevealModal, matchesQuery, SearchInput, SlabCard, SortSelect } from '../components'

const SERVICE_NAME: Record<string, string> = {
  standard: 'Standard Grading',
  express: 'Express Grading',
  premium: 'Premium Grading',
  psa_special: '🏷️ PSA Special',
}

export function GradingView() {
  const { toast, refreshState, openCard, density, state, rushShortcut, setRushShortcut } = useStore()
  const [stats, setStats] = useState<GradingStats | null>(null)
  const [services, setServices] = useState<GradingService[]>([])
  const [pending, setPending] = useState<{ id: number; name: string; image_small: string | null; card_id: string; grading_service: string | null; grading_due_at: string; condition: string }[]>([])
  const [submitting, setSubmitting] = useState<number | null>(null)
  const [candQ, setCandQ] = useState('')
  const [candSort, setCandSort] = useState('edge_desc')
  const [rushOnly, setRushOnly] = useState(false)
  // Reveal ceremony: /api/grading/pending resolves due grades server-side and
  // hands each verdict back EXACTLY ONCE — a load() that takes g.pending and
  // drops g.revealed destroys the ceremony for good. Queue every fresh verdict
  // (toasting each) and walk through them one at a time; the seen-set keeps a
  // 20s re-poll from ever re-opening a closed reveal.
  const [revealQueue, setRevealQueue] = useState<GradingReveal[]>([])
  const revealedIds = useRef(new Set<number>())
  const reveal = revealQueue[0] ?? null
  const closeReveal = () => setRevealQueue((q) => q.slice(1))

  const load = useCallback(async () => {
    try {
      // Ask the lab FIRST — before stats/services — so this poll is the one
      // that captures the verdict (anything else that resolves grades first
      // spends them silently).
      const g = await api.gradingPending()
      setPending(g.pending)
      const fresh = g.revealed.filter((r) => !revealedIds.current.has(r.inventoryId))
      for (const r of fresh) {
        revealedIds.current.add(r.inventoryId)
        toast(`${r.name} came back ${r.gradeLabel}!`, r.value >= r.costBasis ? 'good' : 'bad')
      }
      if (fresh.length > 0) setRevealQueue((q) => [...q, ...fresh])
      setStats(await api.gradingStats())
      setServices(await api.gradingServices())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 20000) // grades resolve on the game tick — poll for reveals
    return () => clearInterval(t)
  }, [load])

  // One-shot from Home's rush shortcut: land pre-filtered to rush-eligible cards.
  useEffect(() => {
    if (rushShortcut) {
      setRushOnly(true)
      setRushShortcut(false)
    }
  }, [rushShortcut, setRushShortcut])

  const roiClass = (roi: number | null) => (roi == null ? 'faint' : roi >= 0 ? 'delta-up' : 'delta-down')

  const shownCandidates = useMemo(() => {
    const all = stats?.candidates ?? []
    // Rush filter: the cards the $10 line is the play for — candidates whose
    // best service IS the special (it accepts raw ≥ its floor; grails still
    // route to express/premium). If the event ends mid-filter, it no-ops
    // instead of emptying the list.
    const rushActive = stats?.rush?.active ?? false
    const out = all.filter(
      (c) => matchesQuery(c, candQ, (x) => [x.name, x.set, x.condition, x.serviceName]) &&
        (!rushOnly || !rushActive || c.serviceId === 'psa_special'),
    )
    const sorters: Record<string, (a: typeof all[number], b: typeof all[number]) => number> = {
      edge_desc: byNum((c) => c.edge, 'desc'),
      profit_desc: byNum((c) => c.expectedProfit, 'desc'),
      gem_desc: byNum((c) => c.gemChance, 'desc'),
      raw_asc: byNum((c) => c.rawValue, 'asc'),
      raw_desc: byNum((c) => c.rawValue, 'desc'),
      name_asc: byStr((c) => c.name, 'asc'),
    }
    return [...out].sort(sorters[candSort] ?? sorters.edge_desc)
  }, [stats, candQ, candSort, rushOnly])

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

      {(() => {
        const rush = stats?.rush
        if (!rush || (!rush.active && rush.backlogDays <= 0)) return null
        if (rush.active) {
          return (
            <div className="panel mb14" style={{ padding: '10px 14px', borderColor: 'var(--yellow)', background: 'rgba(255,203,5,0.06)' }}>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <b style={{ color: 'var(--gold)' }}>🏷️ PSA SPECIAL — LIVE</b>
                <span className="small">$10-per-card grading · the whole scene is in line.</span>
                <span className="badge hit">slab prices +{Math.round((rush.slabPremium - 1) * 100)}%</span>
                {rush.specialOpen ? (
                  <span className="badge live">quota {rush.quotaUsed}/{rush.quotaTotal} used · {Math.max(0, rush.quotaUsed - (rush.npcUsed ?? 0))} yours</span>
                ) : (
                  <span className="badge" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>quota GONE — the scene ate the line</span>
                )}
                <span className="faint small" style={{ marginLeft: 'auto' }}>queue adds ~{rush.backlogDays}d to every turnaround · ends {new Date(rush.endsAt ?? Date.now()).toLocaleDateString()}</span>
              </div>
              <div className="faint small mt8">
                The arbitrage: slab prices run hot while the lab grinds the queue — slabs you ALREADY own sell at a premium, but cards submitted now wait in the very line that ends the party. Getting in early was the whole game; holding slabs and selling into the rush is the other play.
              </div>
            </div>
          )
        }
        return (
          <div className="panel mb14" style={{ padding: '8px 14px' }}>
            <span className="small">🏷️ <b>PSA backlog hangover</b> — the rush is over but the queue isn't: ~<b>{rush.backlogDays}</b> game-days of extra turnaround on every submission. Slab prices still carry a +{Math.round((rush.slabPremium - 1) * 100)}% premium while the scene waits it out.</span>
          </div>
        )
      })()}

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
            {stats?.rush?.active && (
              <span
                className={`chip ${rushOnly ? 'on' : ''}`}
                onClick={() => setRushOnly((v) => !v)}
                title={`Cards where the $10 special is the best play — it accepts raw ≥ $${stats.rush.minRawValue}; quota ${stats.rush.quotaUsed}/${stats.rush.quotaTotal}`}
              >
                🏷 rush-eligible{rushOnly ? ' ✓' : ''}
              </span>
            )}
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
            <div style={{ marginLeft: 'auto' }}><DensityToggle /></div>
          </div>
          <table className="table" style={density !== 'comfortable' ? { display: 'none' } : undefined}>
            <thead>
              <tr><th>Card</th><th className="right">Raw</th><th>Best service</th><th className="right">Gem chance</th>
                  <th className="right">Expected profit</th><th className="right">If gem</th><th className="right">Edge</th><th></th></tr>
            </thead>
            <tbody>
              {shownCandidates.map((c) => (
                <tr key={c.inventoryId}>
                  <td>
                    <div className="row" style={{ cursor: 'pointer' }} onClick={() => openCard(c.cardId)}>
                      <div style={{ width: 32 }}><CardImg src={c.image} alt={c.name} cardId={c.cardId} /></div>
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
          {density !== 'comfortable' && (
            <div className={`card-grid ${density === 'list' ? 'density-list' : 'density-compact'}`}>
              {shownCandidates.map((c) => (
                <div key={c.inventoryId} className="card-cell" style={density === 'list' ? undefined : { position: 'relative' }}>
                  <div onClick={() => openCard(c.cardId)} style={{ cursor: 'pointer' }}>
                    <CardImg src={c.image} alt={c.name} cardId={c.cardId} />
                  </div>
                  <div className="card-meta">
                    <div className="nm">{c.name}</div>
                    <div className="st">{c.set} · {c.condition}</div>
                    <div className="card-row-between">
                      <span className="faint" style={{ fontSize: 10 }}>raw {fmtUsd(c.rawValue)}</span>
                      <span className="delta-up" style={{ fontSize: 10, fontWeight: 650 }}>+{fmtUsd(c.edge)}</span>
                    </div>
                  </div>
                  {density === 'list' && (
                    <div className="faint" style={{ fontSize: 10, flex: '0 0 auto' }}>
                      {c.serviceName} · {c.gemChance}% gem · profit {fmtUsd(c.expectedProfit)}
                    </div>
                  )}
                  <button
                    className="small primary"
                    style={density === 'list' ? { flex: '0 0 auto' } : { width: '100%', marginTop: 6 }}
                    disabled={submitting === c.inventoryId}
                    onClick={async () => {
                      setSubmitting(c.inventoryId)
                      try {
                        const res = await api.gradingSubmit(c.inventoryId, c.serviceId)
                        toast(`Submitted to ${c.serviceName} ($${res.cost.toFixed(2)}) — deductible next filing`, 'good')
                        await load()
                        refreshState()
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'Submit failed', 'bad')
                      } finally {
                        setSubmitting(null)
                      }
                    }}
                  >
                    ⚖ Grade
                  </button>
                </div>
              ))}
            </div>
          )}
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
                  // Game-days are 12h or 24h per the save's setting — day-scale ETAs, then h/m as the reveal closes.
                  const back = gameDayEtaFor(state?.day?.lengthHours ?? 12, msLeft)
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="row" style={{ cursor: 'pointer' }} onClick={() => openCard(p.card_id)}>
                          <div style={{ width: 34 }}><SlabCard src={p.image_small} alt={p.name} grade="PSA10" /></div>
                          <b className="small">{p.name}</b>
                        </div>
                      </td>
                      <td className="small">{SERVICE_NAME[p.grading_service ?? ''] ?? p.grading_service}</td>
                      <td className="num">{back}</td>
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
                        <div style={{ width: 34 }}><SlabCard src={h.image_small} alt={h.name} grade={h.grade} /></div>
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

      {/* The ceremony for verdicts this page's own poll just resolved. */}
      {reveal && (
        <GradeRevealModal
          reveal={reveal}
          onClose={closeReveal}
          onSeeCollection={() => { window.location.hash = '#/inventory' }}
        />
      )}
    </div>
  )
}
