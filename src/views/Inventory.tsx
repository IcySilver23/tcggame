import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { GradingReveal, GradingService, GradingPendingRow, SealedStockRow } from '../api'
import { useStore } from '../store'
import { byNum, byStr, CardImg, ConditionBadge, DensityToggle, DENSITY_METRICS, EmptyState, fmtUsd, matchesQuery, PriceTag, SearchInput, SortSelect, SourceBadge, VirtualGrid } from '../components'
import type { InventoryRow } from '../types'
import type { SaleRow } from '../api'

const GRADE_BADGE: Record<string, string> = {
  PSA10: 'GEM MNT 10', PSA9: 'MINT 9', PSA8: 'NM-MT 8', PSA7: 'NM 7',
  BGS10: 'BGS 10', CGC10: 'CGC 10', SGC10: 'SGC 10',
}

export function InventoryView() {
  const { toast, refreshState, openCard, density } = useStore()
  const [tab, setTab] = useState<'raw' | 'listed' | 'sealed' | 'grading'>('raw')
  const [items, setItems] = useState<InventoryRow[]>([])
  const [sales, setSales] = useState<SaleRow[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [sealed, setSealed] = useState<SealedStockRow[]>([])
  const [gradingSvc, setGradingSvc] = useState<GradingService[]>([])
  const [pendingGrading, setPendingGrading] = useState<GradingPendingRow[]>([])
  const [invQ, setInvQ] = useState('')
  const [invSort, setInvSort] = useState('value_desc')
  const [sealedQ, setSealedQ] = useState('')
  const [sealedSort, setSealedSort] = useState('value_desc')
  const [reveal, setReveal] = useState<GradingReveal | null>(null)
  const [gradePick, setGradePick] = useState<{ item: InventoryRow } | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await api.inventory())
      setSales(await api.sales())
      const sum = await api.pullsSummary()
      setSealed((sum.sealedInStock as SealedStockRow[]) ?? [])
      api.gradingServices().then(setGradingSvc).catch(() => {})
      const g = await api.gradingPending()
      setPendingGrading(g.pending)
      if (g.revealed.length > 0) {
        setReveal(g.revealed[0])
        toast(`${g.revealed[0].name} came back ${g.revealed[0].gradeLabel}!`, g.revealed[0].value >= g.revealed[0].costBasis ? 'good' : 'bad')
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])

  const raw = items.filter((i) => i.status === 'collection')
  const listed = items.filter((i) => i.status === 'listed')
  const shownRaw = useMemo(() => {
    const out = raw.filter((i) => matchesQuery(i, invQ, (x) => [x.name, x.set_name, x.rarity, x.variant, x.condition]))
    const sorters: Record<string, (a: InventoryRow, b: InventoryRow) => number> = {
      value_desc: byNum((i) => i.value, 'desc'),
      value_asc: byNum((i) => i.value, 'asc'),
      pl_desc: byNum((i) => i.value - i.cost_basis, 'desc'),
      pl_asc: byNum((i) => i.value - i.cost_basis, 'asc'),
      name_asc: byStr((i) => i.name, 'asc'),
      set_asc: byStr((i) => i.set_name, 'asc'),
      recent: byStr((i) => i.acquired_at, 'desc'),
    }
    return [...out].sort(sorters[invSort] ?? sorters.value_desc)
  }, [raw, invQ, invSort])
  const shownSealed = useMemo(() => {
    const out = sealed.filter((s) => matchesQuery(s, sealedQ, (x) => [x.name]))
    const sorters: Record<string, (a: SealedStockRow, b: SealedStockRow) => number> = {
      value_desc: byNum((s) => s.market_value, 'desc'),
      value_asc: byNum((s) => s.market_value, 'asc'),
      pl_desc: byNum((s) => s.unrealized, 'desc'),
      pl_asc: byNum((s) => s.unrealized, 'asc'),
      name_asc: byStr((s) => s.name, 'asc'),
      qty_desc: byNum((s) => s.quantity, 'desc'),
    }
    return [...out].sort(sorters[sealedSort] ?? sorters.value_desc)
  }, [sealed, sealedQ, sealedSort])

  const toggle = (id: number) => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const listSelected = async () => {
    const targets = raw.filter((i) => selected.has(i.id))
    if (targets.length === 0) return
    let ok = 0
    for (const t of targets) {
      try {
        const price = t.source.usd ?? t.value
        if (!price) continue
        await api.listItem(t.id, Math.round(price * 100) / 100)
        ok++
      } catch { /* skip */ }
    }
    toast(`Listed ${ok} card${ok === 1 ? '' : 's'} at market — NPC buyers incoming`, 'good')
    setSelected(new Set())
    await load()
    refreshState()
  }

  const listOne = async (i: InventoryRow, price: number) => {
    try {
      await api.listItem(i.id, price)
      toast(`${i.name} listed for ${fmtUsd(price)}`, 'good')
      await load()
      refreshState()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Listing failed', 'bad')
    }
  }

  const cancelOne = async (i: InventoryRow) => {
    await api.cancelListing(i.id)
    await load()
    refreshState()
  }

  const openSealed = async (productId: string) => {
    try {
      await api.openPack(productId)
      toast('Pack opened — check Pack Opening history', 'good')
      await load()
      refreshState()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Open failed', 'bad')
    }
  }

  const sellSealed = async (productId: string, qty: number) => {
    try {
      const r = await api.sellSealed(productId, qty)
      if (r.ok) {
        toast(`Sold ${r.units}× sealed for ${fmtUsd(r.proceeds)} (${r.profit >= 0 ? '+' : ''}${fmtUsd(r.profit)} vs cost)`, r.profit >= 0 ? 'good' : 'bad')
        await load()
        refreshState()
      } else {
        toast(r.error, 'bad')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sale failed', 'bad')
    }
  }

  const submitGrading = async (item: InventoryRow, serviceId: string) => {
    try {
      const res = await api.gradingSubmit(item.id, serviceId)
      toast(`Submitted to grading ($${res.cost.toFixed(2)}) — check back in a few game-days`, 'good')
      setGradePick(null)
      setTab('grading')
      await load()
      refreshState()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Submit failed', 'bad')
    }
  }

  function GradePicker() {
    if (!gradePick) return null
    return (
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setGradePick(null) }}>
        <div className="modal" style={{ width: 'min(560px, 95vw)' }}>
          <div className="modal-head">
            <div>
              <h1>Grade {gradePick.item.name}</h1>
              <div className="sub muted">Raw value {fmtUsd(gradePick.item.value)} · {gradePick.item.condition}</div>
            </div>
            <button className="ghost" onClick={() => setGradePick(null)}>✕</button>
          </div>
          <div className="stack">
            {gradingSvc.map((s) => (
              <div key={s.id} className="panel" style={{ margin: 0 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <b>{s.name}</b> <span className="badge">${s.cost}</span>
                    {gradePick.item.value < s.minRawValue && <span className="badge est">below min raw value</span>}
                    <div className="small muted mt4">{s.desc}</div>
                    <div className="faint small">Turnaround {s.daysMin}–{s.daysMax} game-days</div>
                  </div>
                  <button className="primary" disabled={gradePick.item.value < s.minRawValue} onClick={() => submitGrading(gradePick.item, s.id)}>SUBMIT</button>
                </div>
              </div>
            ))}
            <p className="small muted">
              Grade odds depend on raw condition (NM grades best). Values come from real PriceCharting
              PSA/BGS/CGC price data when available.
            </p>
          </div>
        </div>
      </div>
    )
  }

  function RevealModal() {
    if (!reveal) return null
    const pl = reveal.value * 0.9 - reveal.costBasis
    return (
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setReveal(null) }}>
        <div className="modal" style={{ width: 'min(620px, 95vw)', textAlign: 'center' }}>
          <div className="faint small" style={{ letterSpacing: 2 }}>GRADING RESULT</div>
          <h1 style={{ fontSize: 40, margin: '6px 0' }}>{reveal.gradeLabel}</h1>
          <div className="sub muted">{reveal.name}</div>
          <div style={{ fontSize: 34, fontWeight: 800, margin: '14px 0 4px', fontVariantNumeric: 'tabular-nums' }}>
            {fmtUsd(reveal.value)}
            {reveal.valueSource === 'live' && <span className="badge live" style={{ marginLeft: 10 }}>LIVE · PriceCharting</span>}
            {reveal.valueSource === 'estimated' && <span className="badge est" style={{ marginLeft: 10 }}>ESTIMATED</span>}
          </div>
          <div className={`small ${pl >= 0 ? 'delta-up' : 'delta-down'}`}>
            Profit if sold now: {pl >= 0 ? '+' : ''}{fmtUsd(Math.round(pl * 100) / 100)} (after 10% fee)
          </div>
          {reveal.allGrades.length > 1 && (
            <div className="mt14" style={{ textAlign: 'left' }}>
              <div className="faint small mb8">REAL GRADED PRICES</div>
              <table className="table">
                <thead><tr><th>Grade</th><th className="right">Value</th><th>Source</th></tr></thead>
                <tbody>
                  {reveal.allGrades.map((g) => (
                    <tr key={g.grade} style={g.grade === reveal.grade ? { color: 'var(--accent, #ffd54a)', fontWeight: 700 } : undefined}>
                      <td>{GRADE_BADGE[g.grade] ?? g.grade}</td>
                      <td className="num">{fmtUsd(g.usd)}</td>
                      <td className="small muted">{g.source === 'pc-graded' ? 'PriceCharting' : 'eBay comps'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="row mt14" style={{ justifyContent: 'center' }}>
            <button className="primary" onClick={() => setReveal(null)}>NICE</button>
            <button onClick={() => { setReveal(null); setTab('raw') }}>SEE MY COLLECTION</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
          <div className="sub">Raw cards, active listings, and sealed stock — with cost basis on everything.</div>
        </div>
        {selected.size > 0 && (
          <div className="row">
            <span className="small muted">{selected.size} selected</span>
            <button className="primary" onClick={listSelected}>LIST ALL AT MARKET</button>
            <button className="ghost" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
      </div>

      <div className="chip-row mb14">
        <span className={`chip ${tab === 'raw' ? 'on' : ''}`} onClick={() => setTab('raw')}>Raw cards ({raw.length})</span>
        <span className={`chip ${tab === 'listed' ? 'on' : ''}`} onClick={() => setTab('listed')}>Listed ({listed.length})</span>
        <span className={`chip ${tab === 'grading' ? 'on' : ''}`} onClick={() => setTab('grading')}>Grading ({pendingGrading.length})</span>
        <span className={`chip ${tab === 'sealed' ? 'on' : ''}`} onClick={() => setTab('sealed')}>Sealed ({sealed.reduce((a, s) => a + s.quantity, 0)})</span>
      </div>

      {tab === 'raw' && (
        raw.length === 0 ? (
          <EmptyState icon="🗃" text="No raw cards" sub="Pulls land here after pack openings." />
        ) : (
          <>
          <div className="filter-row" style={{ marginBottom: 10 }}>
            <SearchInput value={invQ} onChange={setInvQ} placeholder="Search inventory by card, set, variant…" />
            <SortSelect
              value={invSort}
              onChange={setInvSort}
              options={[
                { value: 'value_desc', label: 'Sort: Value high→low' },
                { value: 'value_asc', label: 'Sort: Value low→high' },
                { value: 'pl_desc', label: 'Sort: Biggest gainers' },
                { value: 'pl_asc', label: 'Sort: Biggest losers' },
                { value: 'name_asc', label: 'Sort: Name A→Z' },
                { value: 'set_asc', label: 'Sort: By set' },
                { value: 'recent', label: 'Sort: Recently acquired' },
              ]}
            />
            <span className="result-count faint small">{shownRaw.length} of {raw.length} cards</span>
            <div style={{ marginLeft: 'auto' }}><DensityToggle /></div>
          </div>
          {density !== 'comfortable' && (
            <div style={{ marginBottom: 14 }}>
              <VirtualGrid
                className={`card-grid ${density === 'list' ? 'density-list' : 'density-compact'}`}
                items={shownRaw}
                {...DENSITY_METRICS[density]}
                empty={null}
                render={(i) => (
                  <div className="card-cell">
                    <div onClick={() => openCard(i.card_id)} style={{ cursor: 'pointer' }}>
                      <CardImg src={i.image_small} alt={i.name} />
                    </div>
                    <div className="card-meta">
                      <div className="nm">{i.name}</div>
                      <div className="st">{i.set_name} · {i.condition}</div>
                      <div className="card-row-between">
                        <PriceTag price={i.source} />
                        {i.graded_grade && <span className="badge hit">{GRADE_BADGE[i.graded_grade] ?? i.graded_grade}</span>}
                      </div>
                    </div>
                    {density === 'list' ? (
                      <>
                        <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} title="Select for bulk listing" />
                        <button className="small ghost" disabled={!i.value} onClick={() => listOne(i, Math.round((i.source.usd ?? i.value) * 100) / 100)}>List</button>
                      </>
                    ) : (
                      <div className="card-row-between">
                        <button className="small ghost" disabled={!i.value} onClick={() => toggle(i.id)}>{selected.has(i.id) ? '✓ picked' : '+ pick'}</button>
                        <button className="small ghost" disabled={!i.value} onClick={() => listOne(i, Math.round((i.source.usd ?? i.value) * 100) / 100)}>List</button>
                      </div>
                    )}
                  </div>
                )}
              />
            </div>
          )}
          <table className="table" style={density !== 'comfortable' ? { display: 'none' } : undefined}>
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Card</th><th>Condition</th><th>Set</th>
                <th className="right">Cost</th><th className="right">Value</th><th className="right">P/L</th><th>Price source</th><th></th>
              </tr>
            </thead>
            <tbody>
              {shownRaw.map((i) => {
                const pl = i.value - i.cost_basis
                return (
                  <tr key={i.id}>
                    <td><input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} /></td>
                    <td>
                      <div className="row" style={{ cursor: 'pointer' }} onClick={() => openCard(i.card_id)}>
                        <div style={{ width: 32 }}><CardImg src={i.image_small} alt={i.name} /></div>
                        <b className="small">{i.name}</b>
                      </div>
                    </td>
                    <td>
                      <ConditionBadge cond={i.condition} />
                      {i.graded_grade && <span className="badge hit">{GRADE_BADGE[i.graded_grade] ?? i.graded_grade}</span>}
                      {!i.graded_grade && i.gradingHint && (
                        <span
                          className="badge hit"
                          title={`Grade with ${i.gradingHint.serviceName}: expected profit $${i.gradingHint.expectedProfit.toFixed(2)} vs $${i.value.toFixed(2)} raw (+$${i.gradingHint.edge.toFixed(2)} edge) · ${i.gradingHint.gemChance}% gem chance`}
                        >
                          ⚖ WORTH GRADING
                        </span>
                      )}
                    </td>
                    <td className="small muted">{i.set_name}</td>
                    <td className="num faint">{fmtUsd(i.cost_basis)}</td>
                    <td className="num">{fmtUsd(i.value)}</td>
                    <td className={`num ${pl >= 0 ? 'delta-up' : 'delta-down'}`}>{pl >= 0 ? '+' : ''}{fmtUsd(pl)}</td>
                    <td><SourceBadge price={i.source} /></td>
                    <td className="right">
                      {i.graded_grade ? (
                        <button className="small" disabled={!i.value} onClick={() => listOne(i, Math.round(i.value * 100) / 100)}>List graded</button>
                      ) : (
                        <button className="small" disabled={!i.value} onClick={() => listOne(i, Math.round((i.source.usd ?? i.value) * 100) / 100)}>List at market</button>
                      )}
                      {!i.graded_grade && (
                        <button className="small mt4" onClick={() => setGradePick({ item: i })} disabled={!gradingSvc.length}>⚖ Grade</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </>
        )
      )}

      {tab === 'listed' && (
        listed.length === 0 ? (
          <EmptyState icon="🏷" text="Nothing listed" sub="List cards from the Raw tab — lower price = faster sale." />
        ) : (
          <table className="table">
            <thead><tr><th>Card</th><th>Condition</th><th className="right">Listed at</th><th className="right">Market</th><th></th></tr></thead>
            <tbody>
              {listed.map((i) => (
                <tr key={i.id}>
                  <td><b className="small">{i.name}</b></td>
                  <td><ConditionBadge cond={i.condition} /></td>
                  <td className="num">{fmtUsd(i.listing_price)}</td>
                  <td className="num faint">{fmtUsd(i.value)}</td>
                  <td className="right"><button className="small" onClick={() => cancelOne(i)}>Cancel</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {tab === 'grading' && (
        pendingGrading.length === 0 ? (
          <EmptyState icon="⚖" text="Nothing at the grading company" sub="Use the ⚖ Grade button on a raw card worth $15+." />
        ) : (
          <table className="table">
            <thead><tr><th>Card</th><th>Service</th><th>Submitted as</th><th className="right">Back in</th></tr></thead>
            <tbody>
              {pendingGrading.map((p) => {
                const svc = gradingSvc.find((s) => s.id === p.grading_service)
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
                    <td className="small">{svc?.name ?? p.grading_service}</td>
                    <td><ConditionBadge cond={p.condition} /></td>
                    <td className="num">~{days} game-day{days === 1 ? '' : 's'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )
      )}

      {tab === 'sealed' && (
        sealed.length === 0 ? (
          <EmptyState icon="📦" text="No sealed stock" sub="Buy from the Pack Shop and choose KEEP SEALED." />
        ) : (
          <div>
            <div className="filter-row" style={{ marginBottom: 10 }}>
              <SearchInput value={sealedQ} onChange={setSealedQ} placeholder="Search sealed stock…" />
              <SortSelect
                value={sealedSort}
                onChange={setSealedSort}
                options={[
                  { value: 'value_desc', label: 'Sort: Position value' },
                  { value: 'value_asc', label: 'Sort: Position value ↑' },
                  { value: 'pl_desc', label: 'Sort: Biggest unrealized gains' },
                  { value: 'pl_asc', label: 'Sort: Biggest unrealized losses' },
                  { value: 'qty_desc', label: 'Sort: Most packs held' },
                  { value: 'name_asc', label: 'Sort: Name A→Z' },
                ]}
              />
              <span className="result-count faint small">{shownSealed.length} of {sealed.length} products</span>
            </div>
            <div className="row mb14" style={{ gap: 22 }}>
              <div><div className="faint small">MARKET VALUE</div><div className="price" style={{ fontSize: 18 }}>{fmtUsd(sealed.reduce((a, s) => a + s.market_value, 0))}</div></div>
              <div><div className="faint small">COST BASIS</div><div className="price" style={{ fontSize: 18 }}>{fmtUsd(sealed.reduce((a, s) => a + s.basis, 0))}</div></div>
              <div>
                <div className="faint small">UNREALIZED P&L</div>
                <div className="price" style={{ fontSize: 18, color: sealed.reduce((a, s) => a + s.unrealized, 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmtUsd(sealed.reduce((a, s) => a + s.unrealized, 0))}
                </div>
              </div>
            </div>
            <table className="table">
              <thead><tr><th>Product</th><th className="right">Qty</th><th className="right">Paid/unit</th><th className="right">Market</th><th className="right">P&L</th><th></th></tr></thead>
              <tbody>
                {shownSealed.map((s) => (
                  <tr key={s.product_id}>
                    <td>
                      <b className="small">{s.name}</b>{' '}
                      {s.oop && <span className="badge oop" title={`Print run ended ~${s.oop_months} months ago`}>📈 OOP</span>}
                      <div className="faint small">{s.source === 'pricecharting' ? 'PriceCharting' : 'est. price'} · {s.status}</div>
                    </td>
                    <td className="num">{s.quantity}</td>
                    <td className="num faint">{fmtUsd(s.cost)}</td>
                    <td className="num">{fmtUsd(s.market_price)}</td>
                    <td className="num" style={{ color: s.unrealized >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {s.unrealized >= 0 ? '+' : ''}{fmtUsd(s.unrealized)}
                    </td>
                    <td className="right">
                      <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <button className="small" onClick={() => openSealed(s.product_id)}>OPEN 1</button>
                        <button className="small primary" onClick={() => sellSealed(s.product_id, s.quantity)}>SELL ALL · {fmtUsd(s.quantity * s.market_price * 0.9)}</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="faint small mt8">Selling pays today's market price minus a 10% dealer fee. Out-of-print sealed appreciates as supply dries up.</div>
          </div>
        )
      )}

      <div className="panel mt22">
        <h2>Sales log</h2>
        {sales.length === 0 ? (
          <EmptyState icon="💰" text="No sales yet" sub="Listed cards sell to NPC buyers over time." />
        ) : (
          <table className="table">
            <thead><tr><th>Card</th><th>Buyer</th><th className="right">Received</th><th className="right">Fee</th><th className="right">Profit</th><th className="right">When</th></tr></thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id}>
                  <td><b className="small">{s.name}</b> <span className="faint small">×{s.quantity}</span></td>
                  <td className="small muted">{s.buyer}</td>
                  <td className="num">{fmtUsd(s.sale_price)}</td>
                  <td className="num faint">{fmtUsd(s.fee)}</td>
                  <td className={`num ${s.profit >= 0 ? 'delta-up' : 'delta-down'}`}>{s.profit >= 0 ? '+' : ''}{fmtUsd(s.profit)}</td>
                  <td className="num faint small">{new Date(s.sold_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <GradePicker />
      <RevealModal />
    </div>
  )
}
