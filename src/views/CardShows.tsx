import { useEffect, useState } from 'react'
import { api, type GuestOption, type ShowDealer, type ShowsStatus, type ShowResultRow, type StockableRow } from '../api'
import { useStore } from '../store'
import { EmptyState, FirstUseTip, fmtUsd, LoadFailure } from '../components'

// ---------------------------------------------------------------------------
// 🏟 Card Shows — you're the organizer now. Book a hall, price the gate, sell
// vendor tables to the NPC dealer scene, and live or die by reputation. Once
// your own doors are open, you can also claim a table as your own booth and
// sell your stock to the very crowd you paid to gather.
//
// The old screen was one tall panel per state: terms, pricing inputs, guest
// lineup, your booth and the dealer roster all stacked together, so "can I still
// change the gate?" and "where do I sign a headliner?" meant scrolling a wall.
// A booked show is really four small decisions — the deal, the lineup, your own
// booth, and the dealer scene — so they are four sections now, and which ones
// are still live depends on whether the doors are open.
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

const SHOW_SECTIONS = [
  { id: 'deal', label: 'The deal', icon: '📋', verb: 'What the hall costs, what the gate and tables are priced at, and the way out' },
  { id: 'guests', label: 'Guests', icon: '⭐', verb: 'Sign headliners — real money up front, real crowds on the day' },
  { id: 'booth', label: 'My booth', icon: '🪑', verb: 'Hold a dealer table for yourself and sell your own stock to your crowd' },
  { id: 'dealers', label: 'Dealers', icon: '🎯', verb: "Who is committing at today's table price — and who thinks you've lost it" },
] as const

type ShowSection = (typeof SHOW_SECTIONS)[number]['id']

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

/** Ticks down from the server's own answer, so a shifted dev clock can't lie. */
function DoorsCountdown({ minutes }: { minutes: number }) {
  const [startedAt] = useState(() => Date.now())
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const total = Math.max(0, Math.floor((minutes * 60_000 - (Date.now() - startedAt)) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return (
    <div className="show-clock">
      <div className="show-kicker">doors open in</div>
      <b>{h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`}</b>
    </div>
  )
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
  // The booth's own two calls failed invisibly: the table vanished and the
  // stock list read "nothing stockable" even when the fetch never answered.
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = () => {
    Promise.allSettled([
      api.vendorTable().then((s) => { if (s.active) setTable(s); else setTable(null) }),
      api.vendorStockable().then((r) => { if (r.ok) setStockable(r.rows) }),
    ]).then((settled) =>
      setStatus(settled.some((r) => r.status === 'fulfilled') ? 'ready' : 'error'),
    )
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
        {status === 'error' ? (
          <div className="faint small">
            Couldn't load your table and binder — the local server did not answer. Nothing was stocked or sold.{' '}
            <button className="small ghost" onClick={() => { setStatus('loading'); load() }}>Try again</button>
          </div>
        ) : status === 'loading' ? (
          <div className="faint small">Reading your booth's table and binder…</div>
        ) : null}
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

/**
 * Past shows as rows rather than a seven-column table: at the width this game is
 * played, "Net" was the only column that fit on screen, which is the one number
 * the history is actually for.
 */
function PastShows({ rows }: { rows: ShowResultRow[] }) {
  if (rows.length === 0) return null
  return (
    <div className="panel mt14">
      <b className="small">📊 Past shows</b>
      <div className="show-results">
        {rows.map((r) => (
          <div key={r.id} className="show-result">
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <span className="small"><b>{VENUE_ICON[r.venue] ?? '🏟'} {r.venue.replace(/_/g, ' ')}</b></span>
              <span className={`small ${r.profit >= 0 ? 'delta-up' : 'delta-down'}`} style={{ fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>
                {r.profit >= 0 ? '+' : ''}{fmtUsd(r.profit)}
              </span>
            </div>
            <div className="faint small">
              {r.walkins ?? '—'} walk-ins · {r.tables_sold ?? '—'} tables · gate {r.gate_revenue != null ? fmtUsd(r.gate_revenue) : '—'} ·
              {' '}tables {r.table_revenue != null ? fmtUsd(r.table_revenue) : '—'}
              {r.rep_delta ? ` · rep ${r.rep_delta > 0 ? '+' : ''}${r.rep_delta}` : ''}
            </div>
          </div>
        ))}
      </div>
      {rows.some((r) => r.notes) && (
        <div className="faint small mt8">{rows.find((r) => r.notes)?.notes}</div>
      )}
    </div>
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
  const [section, setSection] = useState<ShowSection>('deal')
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = (initial = false) => {
    if (initial) setLoadState('loading')
    api.shows()
      .then((d) => { setStatus(d); setLoadState('ready') })
      .catch(() => { if (initial) setLoadState('error') })
  }
  useEffect(() => { load(true) }, [])
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
        setSection('deal')
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
      const dropped = status.bookedGuests.filter((g) => !guests.includes(g.id))
      if (dropped.length > 0 && !confirm(`Drop ${dropped.map((g) => g.name).join(', ')}? Their ${fmtUsd(dropped.reduce((a, g) => a + g.fee, 0))} in fees are already spent and won't come back.`)) return
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

  if (loadState === 'error') return <LoadFailure what="the show calendar" onRetry={() => load(true)} />
  if (!status) return <EmptyState icon="🏟" text="Checking the halls…" sub="Reading your booking, the dealer roster and the scene's calendar." />

  const gateNum = Math.max(0, Math.min(40, Number(gate) || 0))
  const tableNum = Math.max(0, Math.min(500, Number(tablePrice) || 0))

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🏟 Card Shows</h1>
          <div className="sub">Stop attending shows — run them.</div>
        </div>
        <div className="right">
          <div className="faint small">Scene reputation</div>
          <div className="price" style={{ fontSize: 18 }}>{status.rep}/100</div>
          <div className="faint small">{status.nextRepTier.label}</div>
        </div>
      </div>

      <FirstUseTip surface="convention">
        <b style={{ color: 'var(--gold)' }}>🏟 First time hosting?</b> Your money comes from two taps: the <b>gate</b> (every
        walk-in pays it) and <b>table rent</b> (NPC dealers pay per table). Price both too high and the hall goes empty — watch the
        roster react live as you change the numbers. Deliver a profitable show and your <b>reputation</b> rises, which draws more
        dealers and bigger crowds to the next one. Run a dead hall and the scene remembers.
      </FirstUseTip>

      {status.hasShow ? (
        <>
          <div className={`panel show-banner${status.opensInMin <= 0 ? ' is-live' : ''}`}>
            <div className="show-banner-top">
              <div style={{ minWidth: 0 }}>
                <div className="show-kicker">{status.opensInMin > 0 ? 'The hall is yours' : 'Doors are open'}</div>
                <div className="show-venue">{VENUE_ICON[status.venue.id] ?? '🏟'} {status.venue.name}</div>
                <div className="faint small">
                  {status.opensInMin > 0 ? status.venue.blurb : `closes in ${status.closesInMin} min of active play`}
                </div>
              </div>
              {status.opensInMin > 0
                ? <DoorsCountdown minutes={status.opensInMin} />
                : <div className="show-live-tag">LIVE</div>}
            </div>
            <div className="show-stats">
              <div><span className="faint small">projected walk-ins</span><b>{status.projectedWalkins}</b></div>
              <div><span className="faint small">gate</span><b>{fmtUsd(status.show.gate)}</b></div>
              <div><span className="faint small">dealers</span><b>{status.committed}/{status.show.tables_total}</b></div>
              <div><span className="faint small">projected gate</span><b>{fmtUsd(status.expectedGate)}</b></div>
            </div>
          </div>

          <div className="seg-bar" role="tablist" aria-label="Show planning">
            {SHOW_SECTIONS.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={section === s.id}
                className={`seg-item${section === s.id ? ' on' : ''}`}
                title={`${s.label} — ${s.verb}`}
                onClick={() => setSection(s.id)}
              >
                <span aria-hidden>{s.icon}</span> {s.label}
                {s.id === 'dealers' && <span className="seg-count">{status.committed}</span>}
              </button>
            ))}
          </div>

          {section === 'deal' && (
            <div className="panel">
              <b>📋 {status.opensInMin > 0 ? 'The deal on the table' : 'The deal you signed'}</b>
              <div className="show-terms">
                <div><span className="faint small">hall rent</span><b>{fmtUsd(status.venue.cost)}</b></div>
                <div><span className="faint small">deposit</span><b>{fmtUsd(status.venue.deposit)}</b></div>
                <div><span className="faint small">crowd pull</span><b>×{status.venue.crowd}</b></div>
                <div><span className="faint small">tables</span><b>{status.show.tables_total}</b></div>
              </div>

              {status.opensInMin > 0 ? (
                <>
                  <div className="faint small mt10">
                    Price the doors before they open. Dealers walk at a table price they won't pay; casuals balk at a steep gate.
                  </div>
                  <div className="show-price-grid mt8">
                    <label>
                      <span className="faint small">Gate $</span>
                      <input className="input" inputMode="decimal" value={gate} onChange={(e) => setGate(e.target.value)} />
                      <GateVerdict gate={gateNum} />
                    </label>
                    <label>
                      <span className="faint small">Table $</span>
                      <input className="input" inputMode="decimal" value={tablePrice} onChange={(e) => setTablePrice(e.target.value)} />
                      <TableVerdict price={tableNum} anchor={status.tableAnchorHint} />
                    </label>
                  </div>
                  <div className="row mt10" style={{ gap: 8, justifyContent: 'space-between' }}>
                    <button disabled={busy} onClick={doCancel} title="Walk away — the hall keeps half the deposit">Cancel show</button>
                    <button className="primary" disabled={busy} onClick={doPricing}>Update pricing</button>
                  </div>
                </>
              ) : (
                <div className="faint small mt10">
                  Pricing is locked at {fmtUsd(status.show.gate)} gate / {fmtUsd(status.show.table_price)} table while the doors are open.
                  {status.hostBooth ? ' Your own booth is holding one of the dealer tables.' : ''}
                </div>
              )}
            </div>
          )}

          {section === 'guests' && (
            <div className="panel">
              <b>⭐ {status.opensInMin > 0 ? 'Special guests' : 'On the marquee'}</b>
              {status.opensInMin > 0 ? (
                status.guests.length > 0 ? (
                  <GuestLineupEditor
                    options={status.guests}
                    booked={status.bookedGuests.map((g) => g.id)}
                    busy={busy}
                    onSave={doLineup}
                  />
                ) : (
                  <div className="faint small mt8">No headliners are taking your calls yet — reputation brings them around.</div>
                )
              ) : (
                <>
                  {status.bookedGuests.length > 0 ? (
                    <div className="row mt8" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {status.bookedGuests.map((g) => <span key={g.id} className="badge hit">⭐ {g.name}</span>)}
                    </div>
                  ) : (
                    <div className="faint small mt8">No headliners — the crowd is whatever your reputation and pricing pull.</div>
                  )}
                  <div className="faint small mt8">The lineup locks when the doors open. Sign the next one before it does.</div>
                </>
              )}
            </div>
          )}

          {section === 'booth' && (
            <div className="panel">
              <b>🪑 Your booth</b>
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
          )}

          {section === 'dealers' && (
            <div className="panel">
              <b>🎯 The dealer scene right now</b>
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
          )}
        </>
      ) : (
        <>
          <div className="panel">
            <b>🎚️ Price the doors</b>
            <div className="faint small mt4">
              The gate is what every walk-in pays. Table rent is what dealers pay for a spot. Both decide who shows up.
            </div>
            <div className="show-price-grid mt10">
              <label>
                <span className="faint small">Gate $</span>
                <input className="input" inputMode="decimal" value={gate} onChange={(e) => setGate(e.target.value)} />
                <GateVerdict gate={gateNum} />
              </label>
              <label>
                <span className="faint small">Table $</span>
                <input className="input" inputMode="decimal" value={tablePrice} onChange={(e) => setTablePrice(e.target.value)} />
                <TableVerdict price={tableNum} anchor={status.tableAnchorHint} />
              </label>
            </div>
          </div>

          {status.guests.length > 0 && (
            <div className="panel mt14">
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <b>⭐ Special guests</b>
                {pickedGuests.size > 0 && (
                  <span className="badge hit" style={{ fontSize: 9 }}>
                    +{fmtUsd(status.guests.filter((o) => pickedGuests.has(o.guest.id)).reduce((a, o) => a + o.guest.fee, 0))} in fees
                  </span>
                )}
              </div>
              <div className="faint small mt4">
                Headliners cost real money up front and pull real crowds. Picked here, they're signed when you book the hall.
              </div>
              <div className="grid cols3" style={{ marginTop: 8 }}>
                {status.guests.map((opt) => (
                  <GuestCard key={opt.guest.id} opt={opt} selected={pickedGuests.has(opt.guest.id)} feeKnown={false} onToggle={() => toggleGuest(opt.guest.id)} />
                ))}
              </div>
            </div>
          )}

          <div className="panel mt14">
            <b>🏟 Pick a hall</b>
            <div className="faint small mt4">
              You pay rent and a refundable deposit at booking. Every dealer table you sell is income; every empty one is rent you ate.
            </div>
            <div className="grid cols3" style={{ marginTop: 10 }}>
              {status.venues.map((v) => (
                <div key={v.id} className="panel conv-booth" style={{ margin: 0 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 26 }}>{VENUE_ICON[v.id] ?? '🏟'}</div>
                    <span className="badge" style={{ fontSize: 9 }}>{v.capacity} tables</span>
                  </div>
                  <b>{v.name}</b>
                  <div className="faint small" style={{ margin: '4px 0' }}>{v.blurb}</div>
                  <div className="hall-facts">
                    <span className="badge" style={{ fontSize: 9 }}>crowd ×{v.crowd}</span>
                    <span className="badge" style={{ fontSize: 9 }}>{v.capacity} spots</span>
                  </div>
                  <div className="small">
                    <b>{fmtUsd(v.total)}</b> down <span className="faint small">({fmtUsd(v.cost)} rent + {fmtUsd(v.deposit)} deposit)</span>
                  </div>
                  {tableNum > 0 && (
                    <div className="hall-math">
                      sell every table at {fmtUsd(tableNum)} → {fmtUsd(v.capacity * tableNum)} back
                    </div>
                  )}
                  <button className="primary small" style={{ marginTop: 8, width: '100%' }} disabled={busy} onClick={() => doBook(v.id)}>
                    Book this hall
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <PastShows rows={status.recent} />
    </div>
  )
}
