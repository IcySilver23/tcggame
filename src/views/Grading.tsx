import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { gameDayEtaFor } from '../lib/gameday'
import type { GradingReveal, GradingService, GradingStats } from '../api'
import { useStore } from '../store'
import { byNum, byStr, CardImg, EmptyState, fmtUsd, GRADE_BADGE, GradeRevealModal, matchesQuery, SearchInput, SlabCard, SortSelect } from '../components'

// ---------------------------------------------------------------------------
// Grading — the lab.
//
// Three jobs live here and the old screen rendered all three as tables: a
// candidate table with eight columns (Card · Raw · Best service · Gem chance ·
// Expected profit · If gem · Edge · button), a nine-column ROI-per-service
// table, a pending table and a nine-column sales table. At this game's width
// exactly one column of each was readable, and the four headline numbers were
// four full-width panels above it all.
//
// So the shape is now: what the operation has made (one hero), what is worth
// grading right now (rows with the GRADE button attached), what is in the lab,
// what each service returns, and what sold. Same endpoints, same maths, same
// reveal ceremony.
// ---------------------------------------------------------------------------

const SERVICE_NAME: Record<string, string> = {
  standard: 'PSA Standard Grading',
  express: 'PSA Express Grading',
  premium: 'PSA Premium Grading',
  beckett: 'Beckett Grading (BGS)',
  cgc: 'CGC Cards Grading',
  psa_special: '🏷️ PSA Special',
}

export function GradingView() {
  const { toast, refreshState, openCard, state, rushShortcut, setRushShortcut } = useStore()
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

  const submit = async (c: { inventoryId: number; serviceId: string; serviceName: string; taxSavings: { honest: number } }) => {
    setSubmitting(c.inventoryId)
    try {
      const res = await api.gradingSubmit(c.inventoryId, c.serviceId)
      toast(
        `Off to ${c.serviceName} (${fmtUsd(res.cost)}) — deductible next filing${c.taxSavings.honest > 0 ? `, saves ~${fmtUsd(c.taxSavings.honest)} in tax` : ''}`,
        'good',
      )
      await load()
      refreshState()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Submit failed', 'bad')
    } finally {
      setSubmitting(null)
    }
  }

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

  const gemRate = stats?.totals.gemRate
  const maxDist = Math.max(1, ...(stats?.distribution ?? []).map((d) => d.n))
  const held = (stats?.totals.returned ?? 0) - (stats?.totals.soldCount ?? 0)

  return (
    <div>
      <div className="page-head desk">
        <div className="ph-id">
          <span className="ph-mark" aria-hidden>🔬</span>
          <div style={{ minWidth: 0 }}>
            <h1>Grading</h1>
            <div className="sub">Your grading operation — what's worth slabbing, what's in the queue, and what the lab has actually been worth.</div>
          </div>
        </div>
      </div>

      {(() => {
        const rush = stats?.rush
        if (!rush || (!rush.active && rush.backlogDays <= 0)) return null
        if (rush.active) {
          return (
            <div className="panel mb14 lab-rush">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <b style={{ color: 'var(--gold)' }}>🏷️ PSA SPECIAL — LIVE</b>
                <span className="badge hit">slabs +{Math.round((rush.slabPremium - 1) * 100)}%</span>
                {rush.specialOpen
                  ? <span className="badge live">quota {rush.quotaUsed}/{rush.quotaTotal} · {Math.max(0, rush.quotaUsed - (rush.npcUsed ?? 0))} yours</span>
                  : <span className="badge" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>quota GONE</span>}
              </div>
              <div className="home-mini" style={{ marginTop: 6 }}>
                $10 a card, and the whole scene is in line. Slabs you already own sell into the premium; cards submitted now wait
                ~{rush.backlogDays}d in the same queue that ends the party. Ends {new Date(rush.endsAt ?? Date.now()).toLocaleDateString()}.
              </div>
            </div>
          )
        }
        return (
          <div className="panel mb14 lab-rush">
            <div className="small">
              🏷️ <b>Backlog hangover</b> — the rush is over, the queue isn't: ~<b>{rush.backlogDays}</b> extra game-days on every
              submission, and slab prices still carry +{Math.round((rush.slabPremium - 1) * 100)}% while the scene waits it out.
            </div>
          </div>
        )
      })()}

      <div className="panel">
        <div className="home-kicker">Net — profit + held − spent</div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <div className="pf-big" style={{ color: (stats?.totals.net ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {fmtUsd(stats?.totals.net)}
          </div>
          <div className="right small">
            {gemRate != null ? <>gem rate <b>{gemRate}%</b></> : <span className="faint">no results back yet</span>}
          </div>
        </div>
        <div className="pf-stats">
          <div className="pf-stat">
            <div className="lbl">Spent</div>
            <div className="val">{fmtUsd(stats?.totals.spent)}</div>
            <div className="note">{stats?.totals.submitted ?? 0} submitted</div>
          </div>
          <div className="pf-stat">
            <div className="lbl">Realized</div>
            <div className="val" style={{ color: (stats?.totals.profit ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtUsd(stats?.totals.profit)}</div>
            <div className="note">{stats?.totals.soldCount ?? 0} slabs sold</div>
          </div>
          <div className="pf-stat">
            <div className="lbl">Held</div>
            <div className="val">{fmtUsd(stats?.totals.unrealized)}</div>
            <div className="note">{held} slab{held === 1 ? '' : 's'} on the shelf</div>
          </div>
          <div className="pf-stat">
            <div className="lbl">In the lab</div>
            <div className="val">{pending.length}</div>
            <div className="note">{pending.length === 0 ? 'queue clear' : 'waiting on a verdict'}</div>
          </div>
        </div>
      </div>

      {(stats?.candidates ?? []).length > 0 ? (
        <div className="panel mt14">
          <div className="home-sec-head">
            <b className="small">⚖ Worth grading now</b>
            <span className="faint small">{shownCandidates.length} of {(stats?.candidates ?? []).length}</span>
          </div>
          <div className="home-mini" style={{ marginBottom: 9 }}>
            Expected graded value uses your grade odds per condition and real graded comps, minus the 10% sale fee and the grading
            fee — compared against selling the card raw.
          </div>
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
          </div>
          {stats?.rush?.active && (
            <button
              className={`small${rushOnly ? ' primary' : ''}`}
              style={{ marginBottom: 10 }}
              onClick={() => setRushOnly((v) => !v)}
              title={`Cards where the $10 special is the best play — it accepts raw ≥ ${fmtUsd(stats.rush.minRawValue)}; quota ${stats.rush.quotaUsed}/${stats.rush.quotaTotal}`}
            >
              🏷 rush-eligible only {rushOnly ? '✓' : ''}
            </button>
          )}

          {shownCandidates.length === 0 ? (
            <div className="home-mini">Nothing matches — clear the search{rushOnly ? ' or the rush filter' : ''}.</div>
          ) : (
            <div className="lab-list">
              {shownCandidates.map((c) => (
                <div key={c.inventoryId} className="lab-cand">
                  <div className="lab-art" onClick={() => openCard(c.cardId)}>
                    <CardImg src={c.image} alt={c.name} cardId={c.cardId} />
                  </div>
                  <div className="lab-body">
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <b className="lab-name" onClick={() => openCard(c.cardId)}>{c.name}</b>
                      <b className="small" style={{ color: 'var(--green)', flex: 'none', fontVariantNumeric: 'tabular-nums' }}>+{fmtUsd(c.edge)}</b>
                    </div>
                    <div className="faint small">{c.set} · {c.condition}</div>
                    <div className="lab-facts">
                      {/* Two deliberate lines instead of a dot-joined run: at
                          this width the separators wrapped to line starts. */}
                      <span>raw {fmtUsd(c.rawValue)} · {c.serviceName} ({fmtUsd(c.cost)})</span>
                      <span>
                        {c.gemChance}% gem
                        {c.serviceId === 'cgc' && c.pristineChance == null
                          ? ' · inspect for Pristine odds'
                          : c.pristineChance != null && c.pristineChance > 0
                            ? ` · ${c.pristineChance}% ${c.serviceId === 'cgc' ? 'Pristine' : 'Black Label'}`
                            : ''}
                        {' · profit '}{fmtUsd(c.expectedProfit)}{' · if top grade '}{fmtUsd(c.upside)}
                      </span>
                    </div>
                    <div className="lab-foot">
                      <span className="faint small" title={`Grading fees are deductible: saves ~${fmtUsd(c.taxSavings.honest)} at your ${Math.round(c.taxSavings.bracketRate * 100)}% bracket`}>
                        {c.taxSavings.honest > 0 ? `🧾 −${fmtUsd(c.taxSavings.honest)} tax` : '🧾 no tax benefit'}
                      </span>
                      <button className="small primary" disabled={submitting === c.inventoryId} onClick={() => submit(c)}>
                        ⚖ Grade
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : stats && (stats.ownedRaw ?? 0) > 0 ? (
        <div className="panel mt14">
          <div className="home-sec-head">
            <b className="small">⚖ Worth grading now</b>
            <span className="faint small">0 of {stats.ownedRaw} raw card{stats.ownedRaw === 1 ? '' : 's'} clear the bar</span>
          </div>
          <div className="home-mini">
            {stats.floor
              ? `${stats.floor.name} costs ${fmtUsd(stats.floor.cost)} and only takes cards worth ${fmtUsd(stats.floor.minRawValue)}+ raw. After that fee and the 10% sale fee, nothing in your binder is worth slabbing yet — sell those raw at the Buylist, and this list fills itself when a pack hands you a card that earns the plastic.`
              : 'After the grading fee and the 10% sale fee, nothing in your binder is worth slabbing yet. Sell those raw at the Buylist, and this list fills itself when a pack hands you a card that earns the plastic.'}
          </div>
        </div>
      ) : null}

      <div className="panel mt14">
        <div className="home-sec-head">
          <b className="small">🏭 In the lab ({pending.length})</b>
          <span className="faint small">{pending.length === 0 ? 'nothing in transit' : 'verdicts pop when they land'}</span>
        </div>
        {pending.length === 0 ? (
          <div className="home-mini">Nothing out for grading. A card has to clear the fee before it appears above as a candidate; once submitted, its verdict waits here for {state?.day?.lengthHours ?? 12}h game-days.</div>
        ) : (
          <div className="pf-rows">
            {pending.map((p) => {
              const msLeft = new Date(p.grading_due_at).getTime() - Date.now()
              // Game-days are 12h or 24h per the save's setting — day-scale ETAs, then h/m as the reveal closes.
              const back = gameDayEtaFor(state?.day?.lengthHours ?? 12, msLeft)
              return (
                <div className="pf-row" key={p.id}>
                  <div className="row" style={{ gap: 9, minWidth: 0, flex: 1, cursor: 'pointer' }} onClick={() => openCard(p.card_id)}>
                    <div style={{ width: 30, flex: 'none' }}><SlabCard src={p.image_small} alt={p.name} grade={p.grading_service === 'beckett' ? 'BGS10' : p.grading_service === 'cgc' ? 'CGC10' : 'PSA10'} /></div>
                    <div className="pf-row-main">
                      <b className="pf-row-name">{p.name}</b>
                      <div className="faint small">{SERVICE_NAME[p.grading_service ?? ''] ?? p.grading_service ?? '—'}</div>
                    </div>
                  </div>
                  <div className="pf-row-nums">
                    <b className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>{back}</b>
                    <div className="faint small">to go</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="panel mt14">
        <div className="home-sec-head">
          <b className="small">💰 ROI by service</b>
          <span className="faint small">profit + held − fees, ÷ fees</span>
        </div>
        {(stats?.services ?? []).length === 0 ? (
          <div className="home-mini">No grading history yet — the first slab writes this table.</div>
        ) : (
          <div className="pf-rows">
            {(stats?.services ?? []).map((s) => (
              <div className="pf-row" key={s.service ?? 'unknown'}>
                <div className="pf-row-main">
                  <b className="pf-row-name">{SERVICE_NAME[s.service ?? ''] ?? s.service ?? 'Unknown'}</b>
                  <div className="faint small">
                    {s.submitted} submitted · {s.soldCount} sold · {s.gemRate != null ? `${s.gemRate}% gem (${s.gems}/${s.returned})` : 'no verdicts'} · {fmtUsd(s.spent)} spent
                  </div>
                </div>
                <div className="pf-row-nums">
                  <b className={`small ${s.profit >= 0 ? 'delta-up' : 'delta-down'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(s.profit)}</b>
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <span className="faint small">held {fmtUsd(s.unrealized)}</span>
                    <span className={`small ${roiClass(s.roi)}`} style={{ fontWeight: 750 }}>
                      {s.roi != null ? `${s.roi > 0 ? '+' : ''}${s.roi}%` : '—'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid cols2 mt14">
        <div className="panel" style={{ margin: 0 }}>
          <div className="home-sec-head">
            <b className="small">📊 Grade distribution</b>
            <span className="faint small">{stats?.totals.returned ?? 0} back</span>
          </div>
          {(stats?.distribution ?? []).length === 0 ? (
            <div className="home-mini">No graded cards yet.</div>
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
          <div className="mt14" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 9 }}>
            <b className="small">Tiers</b>
            {services.map((s) => (
              <div key={s.id} className="pf-row" style={{ alignItems: 'flex-start' }}>
                <div className="pf-row-main">
                  <b className="pf-row-name">{s.name}{s.id === 'psa_special' ? ' 🏷️' : ''}</b>
                  <div className="faint small">{s.desc}</div>
                </div>
                <div className="pf-row-nums">
                  <b className="small">{fmtUsd(s.cost)}</b>
                  <div className="faint small">{s.daysMin}–{s.daysMax}d</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel" style={{ margin: 0 }}>
          <div className="home-sec-head">
            <b className="small">🧾 Graded sales</b>
            <span className="faint small">{stats?.totals.soldCount ?? 0} sold</span>
          </div>
          {(stats?.history ?? []).length === 0 ? (
            <div className="home-mini">No graded sales yet — list a slab from your inventory and it lands here with its full ROI.</div>
          ) : (
            <div className="pf-rows">
              {(stats?.history ?? []).map((h) => {
                // Profit here already has the grading fee deducted server-side.
                const totalCost = (h.grading_cost ?? 0) + (h.sale_price - h.fee - h.profit)
                const roi = totalCost > 0 ? Math.round((h.profit / totalCost) * 100) : null
                return (
                  <div className="pf-row" key={h.id}>
                    <div className="row" style={{ gap: 9, minWidth: 0, flex: 1, cursor: 'pointer' }} onClick={() => openCard(h.card_id)}>
                      <div style={{ width: 28, flex: 'none' }}><SlabCard src={h.image_small} alt={h.name} grade={h.grade} /></div>
                      <div className="pf-row-main">
                        <b className="pf-row-name">{h.name} <span className="badge hit" style={{ fontSize: 9 }}>{GRADE_BADGE[h.grade] ?? h.grade}</span></b>
                        <div className="faint small">
                          {SERVICE_NAME[h.service ?? ''] ?? h.service ?? '—'} · {new Date(h.sold_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="pf-row-nums">
                      <b className={`small ${h.profit >= 0 ? 'delta-up' : 'delta-down'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(h.profit)}</b>
                      <div className="faint small">{roi != null ? `${roi > 0 ? '+' : ''}${roi}% ROI` : fmtUsd(h.sale_price)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
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
