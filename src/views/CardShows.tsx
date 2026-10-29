import { useEffect, useState } from 'react'
import { api, type GuestOption, type ShowDealer, type ShowsStatus, type ShowResultRow, type StockableRow, type VendorStockRow } from '../api'
import { useStore } from '../store'
import { FirstUseTip, fmtUsd } from '../components'

// ---------------------------------------------------------------------------
// 🏟 Card Shows — you're the organizer now. Book a hall, price the gate,
// sell vendor tables to the NPC dealer scene, and live or die by reputation.
// Once your own doors are open, you can also claim a table as your own booth
// and sell your stock to the very crowd you paid to gather.
// ---------------------------------------------------------------------------

type VendorStatusTable = Extract<import('../api').VendorStatus, { active: true }>

const VENUE_ICON: Record<string, string> = {
  rec_center: '🏫',
  hotel_hall: '🏨',
  convention_hall: '🏟',
}

const SPECIALTY_LABEL: Record<string, string> = {
  deals: 'Deal Bins', bulk: 'Bulk Tables', vintage: 'Vintage',
  modern: 'Modern', graded: 'Slabs', trap: 'Tourist Trap',
}

function GateVerdict({ gate }: { gate: number }) {
  const label =
    gate === 0 ? 'FREE — maximum walk-ins, zero gate revenue'
    : gate <= 5 ? 'cheap — the crowd barely notices'
    : gate <= 12 ? 'fair — typical for the scene'
    : gate <= 20 ? 'steep — casual collectors start balking'
    : 'daylight robbery — only the devoted (and the lost) pay'
  const cls = gate <= 5 ? 'below' : gate <= 12 ? 'at' : 'above'
  return <span className={`badge ${cls}`}>{label}</span>
}

function TableVerdict({ price, anchor }: { price: number; anchor: number }) {
  if (price === 0) return <span className="badge below">FREE — every dealer in the scene shows up, you make nothing</span>
  const ratio = anchor > 0 ? price / anchor : 2
  const label =
    ratio < 0.5 ? 'a steal — tables sell out on the spot'
    : ratio <= 1.05 ? 'in the money — most dealers bite'
    : ratio <= 1.5 ? 'pushing it — only the motivated commit'
    : 'nobody pays this — the hall goes empty'
  const cls = ratio < 0.5 ? 'below' : ratio <= 1.05 ? 'at' : 'above'
  return <span className={`badge ${cls}`}>{label}</span>
}

function HostBoothPanel({ opensInMin, closesInMin, hostBooth, venueName, tablePrice, tablesTotal, refresh }: {
  opensInMin: number
  closesInMin: number
  hostBooth: boolean
  venueName: string
  tablePrice: number
  tablesTotal: number
  refresh: () => void
}) {
  const { toast, refreshState } = useStore()
  const [stockable, setStockable] = useState<StockableRow[] | null>(null)
  const [table, setTable] = useState<VendorStatusTable | null>(null)
  const [ask, setAsk] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)

  const load = () => {
    api.vendorTable().then((s) => {
      if (s.active) setTable(s)
      else setTable(null)
    }).catch(() => {})
    api.vendorStockable().then((r) => { if (r.ok) setStockable(r.rows) }).catch(() => {})
  }
  useEffect(() => { load() }, [hostBooth])

  const claim = async () => {
    setBusy(true)
    try {
      const r = await api.showBoothClaim()
      if (r.ok) { toast(`Booth claimed — the spot costs you one of your ${fmtUsd(tablePrice)} dealer tables. Stock it!`, 'good'); refresh(); refreshState() }
      else toast(r.error ?? 'Could not claim a booth', 'bad')
    } finally { setBusy(false) }
  }

  const stock = async (inventoryId: number) => {
    const a = Number(ask[inventoryId])
    if (!a || a <= 0) { toast('Set an ask first', 'bad'); return }
    setBusy(true)
    try {
      const r = await api.vendorStock(inventoryId, a)
      if (r.ok) { toast('On the table.', 'good'); load(); refresh() }
      else toast(r.error ?? 'Could not stock', 'bad')
    } finally { setBusy(false) }
  }

  const unstock = async (inventoryId: number) => {
    setBusy(true)
    try {
      const r = await api.vendorUnstock(inventoryId)
      if (r.ok) { load(); refresh() }
      else toast(r.error ?? 'Could not pull it', 'bad')
    } finally { setBusy(false) }
  }

  if (opensInMin > 0) {
    return (
      <div className="faint small" style={{ marginTop: 10 }}>
        🪑 Your own booth unlocks when the doors open — one dealer table is held for it, so the floor runs one short.
      </div>
    )
  }

  if (!hostBooth) {
    return (
      <div className="row mt10" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="primary small" disabled={busy} onClick={claim}>🪑 Set up my own booth</button>
        <span className="faint small">Free — but the spot is one of your own dealer tables ({fmtUsd(tablePrice)} each). Sell to the crowd you paid for, at show prices.</span>
      </div>
    )
  }

  return (
    <div className="mt10" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <b className="small">🪑 Your booth — {venueName}</b>
        {table && (
          <span className="small">
            <span className="badge hit" style={{ fontSize: 9 }}>{table.slotsUsed}/{table.slotsMax} slots</span>{' '}
            gross {fmtUsd(table.table.revenue)} · profit {fmtUsd(table.table.profit)} · {table.table.buyerCount} sale{table.table.buyerCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {table && table.stock.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {table.stock.map((r) => (
            <div key={r.id} className="row" style={{ justifyContent: 'space-between', padding: '3px 8px', borderBottom: '1px solid var(--border-soft)' }}>
              <span className="small">{r.name}{r.quantity > 1 ? ` ×${r.quantity}` : ''} <span className="faint small">@ {fmtUsd(r.ask)}</span></span>
              <button className="small" disabled={busy} onClick={() => unstock(r.id)}>Pull</button>
            </div>
          ))}
        </div>
      )}
      <div className="faint small mt8">Stock from your collection — the show's walk-ins pay the same premium convention buyers do.</div>
      <div style={{ marginTop: 6 }}>
        {(stockable ?? []).slice(0, 12).map((r) => (
          <div key={r.id} className="row" style={{ justifyContent: 'space-between', padding: '3px 8px', borderBottom: '1px solid var(--border-soft)' }}>
            <span className="small">{r.name}{r.quantity > 1 ? ` ×${r.quantity}` : ''} <span className="faint small">mkt {fmtUsd(r.anchor)}</span></span>
            <span className="row" style={{ gap: 6 }}>
              <input className="input" style={{ width: 72 }} inputMode="decimal" placeholder={fmtUsd(r.suggestedAsk)} value={ask[r.id] ?? ''} onChange={(e) => setAsk((m) => ({ ...m, [r.id]: e.target.value }))} />
              <button className="small" disabled={busy} onClick={() => stock(r.id)}>Stock</button>
            </span>
          </div>
        ))}
        {stockable != null && stockable.length === 0 && <div className="faint small">Nothing stockable — only raw, unlisted collection cards can hit the table.</div>}
        {stockable != null && stockable.length > 12 && <div className="faint small mt4">…and {stockable.length - 12} more in your binder.</div>}
      </div>
      <div className="faint small mt8">Closes in {closesInMin} min — settlement packs the booth and books the missed dealer table as your rent.</div>
    </div>
  )
}

function DealerRow({ d }: { d: ShowDealer }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '5px 8px', borderBottom: '1px solid var(--border-soft)' }}>
      <span className="small">
        {d.name} <span className="badge" style={{ fontSize: 9 }}>{SPECIALTY_LABEL[d.specialty] ?? d.specialty}</span>
      </span>
      <span className={`badge ${d.committed ? 'hit' : 'est'}`} style={{ fontSize: 9 }}>
        {d.committed ? '✓ in' : d.reason}
      </span>
    </div>
  )
}

function ResultsTable({ rows }: { rows: ShowResultRow[] }) {
  if (rows.length === 0) return null
  return (
    <table className="table mt10" style={{ width: '100%' }}>
      <thead>
        <tr><th style={{ textAlign: 'left' }}>Show</th><th>Walk-ins</th><th>Tables</th><th>Gate</th><th>Tables rev.</th><th>Rep</th><th className="right">Net</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td style={{ textAlign: 'left' }}><b className="small">{VENUE_ICON[r.venue] ?? '🏟'} {r.venue.replace(/_/g, ' ')}</b></td>
            <td className="num">{r.walkins ?? '—'}</td>
            <td className="num">{r.tables_sold ?? '—'}</td>
            <td className="num faint">{r.gate_revenue != null ? fmtUsd(r.gate_revenue) : '—'}</td>
            <td className="num faint">{r.table_revenue != null ? fmtUsd(r.table_revenue) : '—'}</td>
            <td className="num">{r.rep_delta ? `${r.rep_delta > 0 ? '+' : ''}${r.rep_delta}` : '—'}</td>
            <td className={`num right ${r.profit >= 0 ? 'delta-up' : 'delta-down'}`}>{r.profit >= 0 ? '+' : ''}{fmtUsd(r.profit)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function GuestCard({ opt, selected, feeKnown, onToggle }: {
  opt: GuestOption
  selected: boolean
  feeKnown: boolean
  onToggle: () => void
}) {
  const g = opt.guest
  return (
    <div className="panel conv-booth" style={{ margin: 0, cursor: opt.declined ? 'default' : 'pointer', opacity: opt.declined ? 0.55 : selected ? 1 : 0.85, borderColor: selected ? 'var(--accent)' : undefined }}
      onClick={() => { if (!opt.declined) onToggle() }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b className="small">{g.name}</b>
        {opt.declined
          ? <span className="badge est" style={{ fontSize: 9 }}>needs rep {g.repRequired}</span>
          : <span className={`badge ${selected ? 'hit' : ''}`} style={{ fontSize: 9 }}>{selected ? '✓ booked' : feeKnown ? `${fmtUsd(g.fee)}` : `+ ${fmtUsd(g.fee)}`}</span>}
      </div>
      <div className="faint small" style={{ margin: '4px 0' }}>{g.blurb}</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="badge" style={{ fontSize: 9 }}>crowd ×{g.crowdMult}</span>
        <span className="badge" style={{ fontSize: 9 }}>rep +{g.repBonus}</span>
      </div>
    </div>
  )
}

/**
 * Lineup editor for a booked show: toggling a guest previews the walk-in
 * delta (compounded with what's already booked) before you commit the fee.
 * Removing guests warns that fees are sunk.
 */
function GuestLineupEditor({ options, booked, busy, onSave }: {
  options: GuestOption[]
  booked: string[]
  busy: boolean
  onSave: (guests: string[]) => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(booked))
  useEffect(() => { setPicked(new Set(booked)) }, [booked.join(',')])
  const added = [...picked].filter((id) => !booked.includes(id))
  const dropped = booked.filter((id) => !picked.has(id))
  const addedFees = options.filter((o) => added.includes(o.guest.id)).reduce((a, o) => a + o.guest.fee, 0)
  // crowdMult compounds multiplicatively across the whole lineup
  const multOf = (ids: string[]) => options.filter((o) => ids.includes(o.guest.id)).reduce((a, o) => a * o.guest.crowdMult, 1)
  const currentMult = multOf(booked)
  const newMult = multOf([...picked])
  const dirty = added.length > 0 || dropped.length > 0
  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b className="small">Special guests</b>
        {newMult !== currentMult && (
          <span className={`badge ${newMult > currentMult ? 'hit' : 'est'}`} style={{ fontSize: 9 }}>
            walk-ins ×{currentMult.toFixed(2)} → ×{newMult.toFixed(2)}
          </span>
        )}
      </div>
      <div className="faint small mt4">Add or drop headliners before doors open. Adding charges the fee now; dropping refunds nothing.</div>
      <div className="grid cols3" style={{ marginTop: 8 }}>
        {options.map((opt) => (
          <GuestCard key={opt.guest.id} opt={opt} selected={picked.has(opt.guest.id)} feeKnown={booked.includes(opt.guest.id)} onToggle={() => setPicked((s) => { const n = new Set(s); if (n.has(opt.guest.id)) n.delete(opt.guest.id); else n.add(opt.guest.id); return n })} />
        ))}
      </div>
      {dirty && (
        <div className="row mt8" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="small" onClick={() => setPicked(new Set(booked))}>Discard</button>
          <button className="primary small" disabled={busy} onClick={() => onSave([...picked])}>
            {added.length > 0 ? `Sign ${added.length} guest${added.length === 1 ? '' : 's'} — ${fmtUsd(addedFees)}` : `Drop ${dropped.length} guest${dropped.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    </div>
  )
}

export function CardShowsView() {
  const { toast, refreshState } = useStore()
  const [status, setStatus] = useState<ShowsStatus | null>(null)
  const [gate, setGate] = useState('5')
  const [tablePrice, setTablePrice] = useState('25')
  const [pickedGuests, setPickedGuests] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = () => api.shows().then(setStatus).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  const toggleGuest = (id: string) => {
    setPickedGuests((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const doBook = async (venue: string) => {
    setBusy(true)
    try {
      const r = await api.showBook(venue, Number(gate), Number(tablePrice), [...pickedGuests])
      if (r.ok) {
        toast('Hall booked — dealers are already hearing about it.', 'good')
        setPickedGuests(new Set())
        load(); refreshState()
      } else toast(r.error ?? 'Booking failed', 'bad')
    } finally { setBusy(false) }
  }

  const doPricing = async () => {
    setBusy(true)
    try {
      const r = await api.showPricing(Number(gate), Number(tablePrice))
      if (r.ok) { toast('Pricing updated — the roster reacts instantly.', 'good'); load() }
      else toast(r.error ?? 'Update failed', 'bad')
    } finally { setBusy(false) }
  }

  const doCancel = async () => {
    const booked = status?.hasShow ? status.bookedGuests : []
    const note = booked.length > 0 ? ` Guest fees (${fmtUsd(booked.reduce((a, g) => a + g.fee, 0))}) are non-refundable.` : ''
    if (!confirm(`Cancel the show? The hall keeps half the deposit.${note}`)) return
    setBusy(true)
    try {
      const r = await api.showCancel()
      if (r.ok) { toast('Show cancelled — the hall kept half the deposit.', 'bad'); load(); refreshState() }
      else toast(r.error ?? 'Cancel failed', 'bad')
    } finally { setBusy(false) }
  }

  const doLineup = async (guests: string[]) => {
    if (status?.hasShow) {
      const booked = new Set(status.bookedGuests.map((g) => g.id))
      const dropped = status.bookedGuests.filter((g) => !guests.includes(g.id))
      if (dropped.length > 0 && !confirm(`Drop ${dropped.map((g) => g.name).join(', ')}? Their ${fmtUsd(dropped.reduce((a, g) => a + g.fee, 0))} in fees are already spent and won't come back.`)) return
      void booked
    }
    setBusy(true)
    try {
      const r = await api.showGuests(guests)
      if (r.ok) {
        toast(r.spent ? `Guest signed — ${fmtUsd(r.spent)} in appearance fees.` : 'Lineup updated.', 'good')
        load(); refreshState()
      } else toast(r.error ?? 'Update failed', 'bad')
    } finally { setBusy(false) }
  }

  if (!status) return <div className="empty"><span className="spinner" /> Checking the halls…</div>

  const gateNum = Math.max(0, Math.min(40, Number(gate) || 0))
  const tableNum = Math.max(0, Math.min(500, Number(tablePrice) || 0))

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🏟 Card Shows</h1>
          <div className="sub">Stop attending shows — run them. Book a hall, price the gate, rent tables to dealers.</div>
        </div>
        <div className="right">
          <div className="faint small">Scene reputation</div>
          <div className="price" style={{ fontSize: 18 }}>{status.rep}/100 · {status.nextRepTier.label}</div>
        </div>
      </div>

      <FirstUseTip surface="convention">
        <b style={{ color: 'var(--gold)' }}>🏟 First time hosting?</b> Your money comes from two taps: the <b>gate</b> (every
        walk-in pays it) and <b>table rent</b> (NPC dealers pay per table). Price both too high and the hall goes empty — watch the
        roster react live as you drag the numbers. Deliver a profitable show and your <b>reputation</b> rises, which draws more
        dealers and bigger crowds to the next one. Run a dead hall and the scene remembers.
      </FirstUseTip>

      {status.hasShow ? (
        <>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <b>{VENUE_ICON[status.show.venue] ?? '🏟'} {status.venue.name} — doors {status.opensInMin > 0 ? `in ${status.opensInMin} min` : 'are OPEN'}</b>
                <div className="faint small">
                  {status.opensInMin > 0
                    ? `Show runs ~${status.closesInMin} min of active play · gate ${fmtUsd(status.show.gate)} · table ${fmtUsd(status.show.table_price)}`
                    : `Live now · closes in ${status.closesInMin} min of active play`}
                </div>
              </div>
              <div className="row" style={{ gap: 14 }}>
                <div style={{ textAlign: 'right' }}>
                  <div className="faint small">Dealers committed</div>
                  <div className="price">{status.committed}/{status.show.tables_total}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="faint small">Projected gate</div>
                  <div className="price">{fmtUsd(status.expectedGate)}</div>
                </div>
                {status.opensInMin > 0 && (
                  <button disabled={busy} onClick={doCancel} title="Walk away — the hall keeps half the deposit">
                    Cancel show
                  </button>
                )}
              </div>
            </div>

            {status.opensInMin > 0 && (
              <div className="row mt10" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <label className="small faint">Gate $</label>
                <input className="input" style={{ width: 80 }} inputMode="decimal" value={gate} onChange={(e) => setGate(e.target.value)} />
                <GateVerdict gate={gateNum} />
                <label className="small faint" style={{ marginLeft: 10 }}>Table $</label>
                <input className="input" style={{ width: 80 }} inputMode="decimal" value={tablePrice} onChange={(e) => setTablePrice(e.target.value)} />
                <TableVerdict price={tableNum} anchor={status.tableAnchorHint} />
                <button className="primary small" disabled={busy} onClick={doPricing}>Update pricing</button>
              </div>
            )}

            {status.bookedGuests.length > 0 && status.opensInMin <= 0 && (
              <div className="mt10">
                <b className="small">On the marquee</b>
                <div className="row mt4" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {status.bookedGuests.map((g) => <span key={g.id} className="badge hit">⭐ {g.name}</span>)}
                </div>
              </div>
            )}

            {status.opensInMin > 0 && status.guests.length > 0 && (
              <GuestLineupEditor
                options={status.guests}
                booked={status.bookedGuests.map((g) => g.id)}
                busy={busy}
                onSave={doLineup}
              />
            )}

            <HostBoothPanel
              opensInMin={status.opensInMin}
              closesInMin={status.closesInMin}
              hostBooth={Boolean(status.hostBooth)}
              venueName={status.venue.name}
              tablePrice={status.show.table_price}
              tablesTotal={status.show.tables_total}
              refresh={load}
            />
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <b className="small">The dealer scene right now</b>
            <div className="faint small mt4">Who's in at today's table price — and who thinks you've lost the plot.</div>
            <div style={{ marginTop: 8 }}>
              {status.roster.map((d) => <DealerRow key={d.name} d={d} />)}
            </div>
            <div className="faint small mt8">
              Roster locks when doors open. Reputation ({status.rep}/100 — {status.nextRepTier.label}) shifts every decision:
              {status.nextRepTier.next != null ? ` reach ${status.nextRepTier.next} to hit the next tier.` : ' you run this scene now.'}
            </div>
            {status.hostBooth && (
              <div className="row" style={{ justifyContent: 'space-between', padding: '5px 8px', borderBottom: '1px solid var(--border-soft)', background: 'var(--panel-2, rgba(255,255,0,0.04))' }}>
                <span className="small">🪑 <b>your booth</b> <span className="badge" style={{ fontSize: 9 }}>you</span></span>
                <span className="badge hit" style={{ fontSize: 9 }}>✓ holding a table</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="panel" style={{ marginBottom: 16 }}>
          <b>Pick a hall</b>
          <div className="row mt4 faint small">
            Gate <input className="input" style={{ width: 70, margin: '0 6px' }} inputMode="decimal" value={gate} onChange={(e) => setGate(e.target.value)} /> <GateVerdict gate={gateNum} />
            <span style={{ marginLeft: 14 }}>Table rent</span>
            <input className="input" style={{ width: 70, margin: '0 6px 0 6px' }} inputMode="decimal" value={tablePrice} onChange={(e) => setTablePrice(e.target.value)} />
            <TableVerdict price={tableNum} anchor={status.tableAnchorHint} />
          </div>
          {status.guests.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b className="small">Special guests</b>
                {pickedGuests.size > 0 && <span className="badge hit" style={{ fontSize: 9 }}>+{fmtUsd(status.guests.filter((o) => pickedGuests.has(o.guest.id)).reduce((a, o) => a + o.guest.fee, 0))} in fees</span>}
              </div>
              <div className="faint small mt4">Headliners cost real money up front — and pull real crowds. Click to add to the booking.</div>
              <div className="grid cols3" style={{ marginTop: 8 }}>
                {status.guests.map((opt) => (
                  <GuestCard key={opt.guest.id} opt={opt} selected={pickedGuests.has(opt.guest.id)} feeKnown={false} onToggle={() => toggleGuest(opt.guest.id)} />
                ))}
              </div>
            </div>
          )}
          <div className="grid cols3" style={{ marginTop: 12 }}>
            {status.venues.map((v) => (
              <div key={v.id} className="panel conv-booth" style={{ margin: 0, cursor: 'default' }}>
                <div style={{ fontSize: 26 }}>{VENUE_ICON[v.id] ?? '🏟'}</div>
                <b>{v.name}</b>
                <div className="faint small" style={{ margin: '4px 0' }}>{v.blurb}</div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span className="badge">{v.capacity} tables</span>
                  <span className="badge">crowd ×{v.crowd}</span>
                </div>
                <div className="small mt8"><b>{fmtUsd(v.total)}</b> down <span className="faint small">({fmtUsd(v.cost)} rent + {fmtUsd(v.deposit)} refundable deposit)</span></div>
                <button className="primary small" style={{ marginTop: 8, width: '100%' }} disabled={busy} onClick={() => doBook(v.id)}>
                  Book this hall
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {status.recent.length > 0 && (
        <div className="panel">
          <b className="small">Past shows</b>
          <ResultsTable rows={status.recent} />
          {status.recent.some((r) => r.notes) && (
            <div className="faint small mt8">{status.recent.find((r) => r.notes)?.notes}</div>
          )}
        </div>
      )}
    </div>
  )
}
