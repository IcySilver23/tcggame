import { useEffect, useState } from 'react'
import {
  api,
  type BoothItem,
  type BoothStockResponse,
  type ConventionStatus,
  type EstateBuyResult,
  type EstateLotRow,
  type EstateSection,
  type StockableRow,
  type VendorStatus,
} from '../api'
import { useStore } from '../store'
import { fmtUsd } from '../components'

const SPECIALTY_LABEL: Record<string, string> = {
  deals: 'Deal Bins',
  bulk: 'Bulk Tables',
  vintage: 'Vintage Specialist',
  modern: 'Modern Chaser',
  graded: 'Slab Dealer',
  trap: 'Tourist Trap',
}

function DeltaBadge({ delta }: { delta: number }) {
  const label = delta < -0.1 ? 'DEAL' : delta > 0.15 ? 'PRICEY' : 'FAIR'
  const cls = delta < -0.1 ? 'below' : delta > 0.15 ? 'above' : 'at'
  return (
    <span className={`badge ${cls}`} style={{ fontSize: 10, padding: '2px 8px' }}>
      {label} {delta > 0 ? '+' : ''}{Math.round(delta * 100)}%
    </span>
  )
}

function BoothView({ boothId, onBack }: { boothId: number; onBack: () => void }) {
  const { toast, refreshState, openCard } = useStore()
  const [data, setData] = useState<BoothStockResponse | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const load = () => api.conventionBooth(boothId).then(setData).catch(() => {})
  useEffect(() => { load() }, [boothId])

  const buy = async (item: BoothItem) => {
    setBusy(item.id)
    try {
      const res = await api.conventionBuy(item.id)
      if (res.ok) {
        toast(res.message ?? 'Purchased', 'good')
        refreshState()
        load()
      } else {
        toast(res.error ?? 'Purchase failed', 'bad')
        load()
      }
    } finally {
      setBusy(null)
    }
  }

  if (!data) return <div className="empty"><span className="spinner" /> Browsing the table…</div>
  if (!data.ok) {
    return (
      <div>
        <div className="trade-bubble" style={{ marginBottom: 10 }}>{data.error}</div>
        <button onClick={onBack}>← Back to the floor</button>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{data.booth.avatar} {data.booth.vendor_name}</h1>
          <div className="sub">{SPECIALTY_LABEL[data.booth.specialty] ?? data.booth.specialty} — {data.booth.blurb}</div>
        </div>
        <div className="right">
          <button onClick={onBack}>← Back to the floor</button>
        </div>
      </div>

      {data.items.length === 0 ? (
        <div className="faint small">Table's been picked clean.</div>
      ) : (
        <div className="grid cols3">
          {data.items.map((it) => (
            <div key={it.id} className="panel conv-item" style={{ margin: 0 }}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div style={{ width: 66, cursor: 'pointer' }} onClick={() => openCard(it.card_id)}>
                  <img src={it.image_small ?? ''} alt={it.name} style={{ width: '100%', borderRadius: 6, display: 'block', background: '#0d1017' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
                </div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <b className="small" style={{ cursor: 'pointer' }} onClick={() => openCard(it.card_id)}>{it.name}</b>
                  <div className="faint small">{it.set_name}</div>
                  <div className="row mt8" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {it.graded_grade && <span className="badge hit">{it.graded_grade}</span>}
                    <span className="badge">{it.graded_grade ? 'SLAB' : it.condition}</span>
                    <DeltaBadge delta={it.delta} />
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
                    <span className="price">{fmtUsd(it.ask)}</span>
                    <span className="faint small">mkt {fmtUsd(it.anchor)}</span>
                  </div>
                  <button className="primary small" style={{ marginTop: 6, width: '100%' }} disabled={busy === it.id} onClick={() => buy(it)}>
                    {busy === it.id ? '…' : 'Buy'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Estate lots — bundled mystery collections, one price, no peeking
// ---------------------------------------------------------------------------

const FLAVOR_ICON: Record<string, string> = {
  bulk_clearout: '📦',
  mixed_vault: '🧰',
  collector_decay: '🏚️',
}

function signed(n: number): string {
  return (n >= 0 ? '+$' : '-$') + fmtUsd(Math.abs(n)).slice(1)
}

function EstateReveal({ result, onClose }: { result: EstateBuyResult; onClose: () => void }) {
  const { openCard } = useStore()
  const profit = result.profit ?? 0
  const good = profit >= 0
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="panel" style={{ maxWidth: 640, width: '94%', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 40 }}>{good ? '🎉' : '😬'}</div>
          <h2 style={{ margin: '4px 0' }}>{result.verdict}</h2>
          <div className="faint small">The estate claimed {fmtUsd(result.estimate ?? 0)} — the real number is below.</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 28, margin: '14px 0' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="faint small">YOU PAID</div>
            <div className="price" style={{ fontSize: 24 }}>{fmtUsd(result.paid ?? 0)}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="faint small">REALIZED VALUE</div>
            <div className="price" style={{ fontSize: 24 }}>{fmtUsd(result.realized ?? 0)}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="faint small">NET</div>
            <div className="price" style={{ fontSize: 24, color: good ? 'var(--green)' : 'var(--red)' }}>{signed(profit)}</div>
          </div>
        </div>
        <div className="faint small" style={{ textAlign: 'center', marginBottom: 10 }}>
          All {result.cards?.length ?? 0} cards landed in your collection — tap any to inspect.
        </div>
        <div className="grid cols3">
          {(result.cards ?? []).map((c) => (
            <div key={c.card_id} className="panel" style={{ margin: 0, padding: 8, cursor: 'pointer' }}
              onClick={() => { onClose(); openCard(c.card_id) }}>
              <img src={c.image_small ?? ''} alt={c.name} style={{ width: '100%', borderRadius: 6, display: 'block', background: '#0d1017' }}
                onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
              <b className="small" style={{ display: 'block', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</b>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="badge">{c.condition}</span>
                <span className="price small">{fmtUsd(c.value)}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button className="primary" onClick={onClose}>Add to collection</button>
        </div>
      </div>
    </div>
  )
}

function EstateFloor({ entered, onSold }: { entered: boolean; onSold: () => void }) {
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<EstateSection | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [reveal, setReveal] = useState<EstateBuyResult | null>(null)

  const load = () => api.estate().then(setData).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [])

  const buy = async (lot: EstateLotRow) => {
    const lines = [
      `Buy out "${lot.seller_name}"?`,
      '',
      `${lot.card_count} cards, one price: ${fmtUsd(lot.ask)}`,
      `The estate estimates ${fmtUsd(lot.seller_estimate)} — they're guessing.`,
      'Contents stay wrapped until you pay.',
    ]
    if (!confirm(lines.join('\n'))) return
    setBusy(lot.id)
    try {
      const res = await api.estateBuy(lot.id)
      if (res.ok) {
        setReveal(res)
        refreshState()
        onSold()
      } else {
        toast(res.error ?? 'Purchase failed', 'bad')
        load()
      }
    } finally {
      setBusy(null)
    }
  }

  if (!data) return null
  const { lots, history, stats } = data
  const showTable = entered && (lots.length > 0 || history.length > 0)
  if (!showTable) return null

  return (
    <div>
      {lots.length > 0 && (
        <div className="grid cols3">
          {lots.map((lot) => (
            <div key={lot.id} className="panel estate-lot" style={{ margin: 0 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <b>{FLAVOR_ICON[lot.flavor] ?? '📦'} {lot.seller_name}</b>
                  <div className="badge" style={{ margin: '4px 0' }}>{lot.flavor_label}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="faint small">{lot.card_count} cards</div>
                  <div className="price" style={{ fontSize: 20 }}>{fmtUsd(lot.ask)}</div>
                  <div className="faint small">estate says {fmtUsd(lot.seller_estimate)}</div>
                </div>
              </div>
              <div className="faint small" style={{ margin: '6px 0 8px' }}>{lot.flavor_blurb}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {lot.preview.map((p, i) => (
                  <div key={i} style={{ flex: 1, minWidth: 0 }}>
                    <img src={p.image_small ?? ''} alt={p.name} style={{ width: '100%', borderRadius: 6, display: 'block', background: '#0d1017' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
                    <div className="faint" style={{ fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    <div className="badge" style={{ fontSize: 9, padding: '1px 5px' }}>{p.condition}</div>
                  </div>
                ))}
              </div>
              <button className="primary small" style={{ marginTop: 10, width: '100%' }} disabled={busy === lot.id} onClick={() => buy(lot)}>
                {busy === lot.id ? 'Counting cash…' : `Buy the lot — ${fmtUsd(lot.ask)}`}
              </button>
              {lot.ask <= lot.seller_estimate * 0.8 && (
                <div className="faint small" style={{ marginTop: 4, textAlign: 'center' }}>Priced under the estate's own guess</div>
              )}
            </div>
          ))}
        </div>
      )}

      {lots.length === 0 && history.length === 0 && (
        <div className="panel" style={{ padding: 18, textAlign: 'center' }}>
          <div className="faint small">No estate tables left at this show.</div>
        </div>
      )}

      {history.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <b>📦 Estate ledger</b>
            <span className="small">
              {stats.lotsBought} lot{stats.lotsBought === 1 ? '' : 's'} · spent {fmtUsd(stats.totalSpent)} · realized {fmtUsd(stats.totalRealized)} ·
              <b style={{ color: stats.netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}> {signed(stats.netProfit)} all-time</b>
              {stats.beatEstimateRate != null && <> · beat the estate's guess {stats.beatEstimateRate}% of the time</>}
            </span>
          </div>
          {stats.best && (
            <div className="faint small" style={{ marginTop: 4 }}>
              Best rip: {stats.best.seller} — {fmtUsd(stats.best.ask)} in, {fmtUsd(stats.best.realized)} out (+{fmtUsd(stats.best.gain)})
            </div>
          )}
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr><th>Lot</th><th>Show</th><th>Paid</th><th>Estimate</th><th>Realized</th><th>Net</th></tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{h.seller_name} <span className="faint small">({h.card_count})</span></td>
                  <td className="faint small">{h.show_name}</td>
                  <td>{fmtUsd(h.ask)}</td>
                  <td className="faint">{fmtUsd(h.estimate)}</td>
                  <td>{fmtUsd(h.realized)}</td>
                  <td style={{ color: h.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{signed(h.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reveal && <EstateReveal result={reveal} onClose={() => { setReveal(null); load() }} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vendor tables — rent a spot and sell your own cards during the show
// ---------------------------------------------------------------------------

function PricePicker({ row, onStock, onClose }: { row: StockableRow; onStock: (ask: number) => void; onClose: () => void }) {
  const [ask, setAsk] = useState(String(row.suggestedAsk.toFixed(2)))
  const num = Number(ask)
  const delta = row.anchor > 0 && num > 0 ? num / row.anchor - 1 : 0
  const label = delta < -0.1 ? 'DEAL — will fly off the table' : delta > 0.15 ? 'PRICEY — buyers will walk' : 'FAIR — steady interest'
  const cls = delta < -0.1 ? 'below' : delta > 0.15 ? 'above' : 'at'
  return (
    <div className="trade-bubble" style={{ marginTop: 8 }}>
      <b className="small">Price {row.name} ×{row.quantity}</b>
      <div className="row mt8" style={{ gap: 8 }}>
        <input
          className="input"
          style={{ width: 110 }}
          value={ask}
          onChange={(e) => setAsk(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="0.00"
        />
        <span className={`badge ${cls}`} style={{ fontSize: 10 }}>{label}</span>
      </div>
      <div className="faint small mt8">Market: {fmtUsd(row.anchor)} · your cost: {fmtUsd(row.cost_basis * row.quantity)} · quick fills: {fmtUsd(row.suggestedAsk)}</div>
      <div className="row mt8" style={{ gap: 8 }}>
        <button className="primary small" disabled={!(num > 0)} onClick={() => onStock(Math.round(num * 100) / 100)}>Put on table</button>
        <button className="small" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

function VendorPanel({ entered, onChange }: { entered: boolean; onChange: () => void }) {
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<VendorStatus | null>(null)
  const [picker, setPicker] = useState<StockableRow | null>(null)
  const [pickers, setPickers] = useState<StockableRow[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.vendorTable().then(setData).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setInterval(load, 12000)
    return () => clearInterval(t)
  }, [])

  const rent = async (location: string) => {
    setBusy(true)
    try {
      const res = await api.vendorRent(location)
      if (res.ok) {
        toast(`Table secured — ${res.location}. Now stock it.`, 'good')
        load()
        onChange()
      } else toast(res.error ?? 'Could not rent a table', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const doStock = async (row: StockableRow, ask: number) => {
    setBusy(true)
    try {
      const res = await api.vendorStock(row.id, ask)
      if (res.ok) {
        toast(`${row.name} on the table at ${fmtUsd(ask)}`, 'good')
        setPicker(null)
        load()
        onChange()
      } else toast(res.error ?? 'Could not stock that card', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const unstock = async (id: number, name: string) => {
    const res = await api.vendorUnstock(id)
    if (res.ok) {
      toast(`${name} back in the binder`, 'good')
      load()
      onChange()
    } else toast(res.error ?? 'Failed', 'bad')
  }

  const openPicker = async () => {
    setBusy(true)
    try {
      const res = await api.vendorStockable()
      if (res.ok) setPickers(res.rows)
      else toast(res.error ?? 'Nothing to stock', 'bad')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null
  if (!data.showOpen) return null
  if (!data.active) {
    if (!entered) {
      return (
        <div className="panel" style={{ marginBottom: 16 }}>
          <b>🪑 Your own table</b>
          <div className="faint small mt8">Pay entry at the door first, then rent a table and sell from your own binder.</div>
        </div>
      )
    }
    return (
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <b>🪑 Rent a vendor table</b>
            <div className="faint small">Sell from your own collection while the show runs. {data.minutesLeft} min left — buyers dry up at close.</div>
          </div>
        </div>
        <div className="grid cols3" style={{ marginTop: 10 }}>
          {data.locations.map((l) => (
            <div key={l.id} className="conv-booth" style={{ cursor: 'default' }}>
              <b className="small">{l.label}</b>
              <div className="price" style={{ fontSize: 16 }}>{fmtUsd(l.fee)}</div>
              <div className="faint small">{l.blurb}</div>
              <div className="badge mt8" style={{ fontSize: 10 }}>traffic ×{l.traffic}</div>
              <button className="primary small" style={{ marginTop: 8, width: '100%' }} disabled={busy} onClick={() => rent(l.id)}>
                Rent this spot
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const t = data.table
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <b>🪑 Your table — {t.location}</b>
          <div className="faint small">
            Rent {fmtUsd(t.fee)} · {data.slotsUsed}/{data.slotsMax} slots · {data.unitsOnTable} units out · closes in {data.minutesLeft} min
          </div>
        </div>
        <div className="row" style={{ gap: 14 }}>
          <div style={{ textAlign: 'right' }}>
            <div className="faint small">Gross sales</div>
            <div className="price">{fmtUsd(t.revenue)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="faint small">{t.buyerCount} buyer{t.buyerCount === 1 ? '' : 's'} · net of rent & cost</div>
            <div className="price" style={{ color: t.profit >= 0 ? 'var(--good, #4ade80)' : '#f87171' }}>
              {t.profit >= 0 ? '+' : ''}{fmtUsd(t.profit)}
            </div>
          </div>
          <button disabled={busy} onClick={openPicker}>+ Stock cards</button>
        </div>
      </div>

      {data.stock.length === 0 ? (
        <div className="faint small mt8">Empty table — buyers walk right past. Stock it with cards priced under market.</div>
      ) : (
        <table className="table mt10" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Card</th>
              <th>Set</th>
              <th>Cond</th>
              <th>Ask</th>
              <th>Market</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.stock.map((r) => (
              <tr key={r.id}>
                <td style={{ textAlign: 'left' }}>
                  <b className="small">{r.name}</b> {r.quantity > 1 && <span className="badge">×{r.quantity}</span>}
                </td>
                <td className="faint small">{r.set_name}</td>
                <td className="small">{r.condition}</td>
                <td className="price">{fmtUsd(r.ask)}</td>
                <td className="faint small">
                  {fmtUsd(r.anchor)}{' '}
                  {r.delta != null && (
                    <span className={`badge ${r.delta < -0.1 ? 'below' : r.delta > 0.15 ? 'above' : 'at'}`} style={{ fontSize: 9, padding: '1px 6px' }}>
                      {r.delta > 0 ? '+' : ''}{Math.round(r.delta * 100)}%
                    </span>
                  )}
                </td>
                <td><button className="small" onClick={() => unstock(r.id, r.name)}>Take back</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pickers && (
        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b className="small">Pick from your binder — {pickers.length} raw cards available</b>
            <button className="small" onClick={() => setPickers(null)}>Close</button>
          </div>
          {pickers.length === 0 ? (
            <div className="faint small mt8">No eligible cards (listed, graded, or slotted cards can't come out).</div>
          ) : (
            <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 8 }}>
              <table className="table" style={{ width: '100%' }}>
                <tbody>
                  {pickers.map((r) => (
                    <tr key={r.id}>
                      <td style={{ textAlign: 'left' }}>
                        <b className="small">{r.name}</b> {r.quantity > 1 && <span className="badge">×{r.quantity}</span>}
                        <span className="faint small"> · {r.set_name} · {r.condition}</span>
                      </td>
                      <td className="faint small">mkt {fmtUsd(r.anchor)}</td>
                      <td className="faint small">cost {fmtUsd(r.cost_basis * r.quantity)}</td>
                      <td>
                        <button className="small" disabled={busy} onClick={() => setPicker(picker?.id === r.id ? null : r)}>
                          {picker?.id === r.id ? 'Close' : 'Price it'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {picker && <PricePicker key={picker.id} row={picker} onStock={(ask) => doStock(picker, ask)} onClose={() => setPicker(null)} />}
        </div>
      )}
    </div>
  )
}

export function ConventionView() {
  const { toast, refreshState } = useStore()
  const [status, setStatus] = useState<ConventionStatus | null>(null)
  const [boothId, setBoothId] = useState<number | null>(null)
  const [entering, setEntering] = useState(false)

  const load = () => api.convention().then(setStatus).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  const enter = async () => {
    setEntering(true)
    try {
      const res = await api.conventionEnter()
      if (res.ok) {
        toast('Welcome in — wristband on.', 'good')
        load()
        refreshState()
      } else {
        toast(res.error ?? 'Entry failed', 'bad')
      }
    } finally {
      setEntering(false)
    }
  }

  if (boothId !== null && status?.open) {
    return <BoothView boothId={boothId} onBack={() => { setBoothId(null); load() }} />
  }

  if (!status) return <div className="empty"><span className="spinner" /> Checking the calendar…</div>

  if (!status.open) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1>🎪 Conventions</h1>
            <div className="sub">Pop-up card shows that come to town on the game clock.</div>
          </div>
        </div>
        <div className="panel" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 42, marginBottom: 10 }}>🗓️</div>
          <h2>No show in town right now</h2>
          <div className="faint small" style={{ marginTop: 6 }}>
            The next convention rolls in around {status.nextShowInMin} min of active play. Watch the activity feed.
          </div>
        </div>
      </div>
    )
  }

  // Entry is server-authoritative: the wristband survives page reloads.
  const alreadyIn = status.entered
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🎪 {status.show.name}</h1>
          <div className="sub">{status.show.blurb}</div>
        </div>
        <div className="right">
          <div className="faint small">Closes in</div>
          <div className="price" style={{ fontSize: 18 }}>{status.minutesLeft} min</div>
        </div>
      </div>

      {!alreadyIn && (
        <div className="panel" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <b>Entry: {fmtUsd(status.show.entry_fee)}</b>
            <div className="faint small">Pay at the door to browse every booth. Vendors sell out — real bargains don't wait.</div>
          </div>
          <button className="primary" disabled={entering} onClick={enter}>Pay entry & come in</button>
        </div>
      )}

      <EstateFloor entered={alreadyIn} onSold={load} />

      <VendorPanel entered={alreadyIn} onChange={load} />

      <div className="grid cols3" style={{ marginTop: 16 }}>
        {status.booths.map((b) => (
          <div key={b.id} className="panel conv-booth" style={{ margin: 0, cursor: alreadyIn ? 'pointer' : 'default', opacity: alreadyIn ? 1 : 0.6 }} onClick={() => alreadyIn && setBoothId(b.id)}>
            <div style={{ fontSize: 26 }}>{b.avatar}</div>
            <b>{b.vendor_name}</b>
            <div className="badge" style={{ margin: '4px 0' }}>{SPECIALTY_LABEL[b.specialty] ?? b.specialty}</div>
            <div className="faint small">{b.blurb}</div>
            <div className="small" style={{ marginTop: 6 }}>{b.stock} items on the table</div>
          </div>
        ))}
      </div>
    </div>
  )
}
