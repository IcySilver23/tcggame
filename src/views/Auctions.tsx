import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type AuctionLot } from '../api'
import { useStore } from '../store'
import {
  byNum, byStr, CardImg, EmptyState, FirstUseTip, fmtUsd, matchesQuery,
  SearchInput, SlabCard, SortSelect, TipList,
} from '../components'

// ---------------------------------------------------------------------------
// 🔨 Auction House — the room (roadmap: one verb per venue).
//
// The verb is BID. A grid of lot cards let you browse eleven auctions at once,
// which is the same shape as every other screen and the wrong question: an
// auction is one lot under a clock, with a room around it and a number you
// have to commit to. So the screen is a room — the lot currently closest to
// the hammer fills the stage, the rest of the night queues in the rail, and
// everything you need to decide (current bid, the estimate band, the anchor,
// your hidden max, the escrow, the snipe guard) sits under one countdown.
//
// No mechanic changed: hidden-max proxy bids, refunded escrow, the 45-second
// snipe guard and the house's 15% cut are the same server calls as before.
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100

function useCountdown(closesAt: string) {
  const [left, setLeft] = useState(() => new Date(closesAt).getTime() - Date.now())
  const ref = useRef(closesAt)
  ref.current = closesAt
  useEffect(() => {
    setLeft(new Date(ref.current).getTime() - Date.now())
    const t = setInterval(() => setLeft(new Date(ref.current).getTime() - Date.now()), 1000)
    return () => clearInterval(t)
  }, [closesAt])
  const s = Math.max(0, Math.floor(left / 1000))
  const m = Math.floor(s / 60)
  return {
    expired: left <= 0,
    secs: s,
    label: m >= 1 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`,
  }
}

/** Heat reads the room: how far the bidding has climbed into the estimate. */
function heatOf(lot: AuctionLot): 'cool' | 'hot' | 'frenzy' {
  const vs = lot.current_bid / Math.max(1, lot.estimate_high)
  return vs > 1.1 ? 'frenzy' : vs > 0.85 ? 'hot' : 'cool'
}

const leaderLabel = (lot: AuctionLot) =>
  lot.leader === 'you' ? 'you lead' : lot.leader ? `${lot.leader} leads` : 'no bids yet'

/** The bid desk: a hidden max, priced against the live min and the estimate. */
function BidDesk({ lot, onBid }: { lot: AuctionLot; onBid: (id: number, max: number) => void }) {
  const { toast } = useStore()
  const minBid = lot.current_bid > 0 ? round2(lot.current_bid * 1.05) : 0.5
  const [val, setVal] = useState(minBid.toFixed(2))
  // A new lot on the stage starts from its own minimum — a stale max from the
  // previous lot is how people overpay by a factor of ten.
  useEffect(() => { setVal(minBid.toFixed(2)) }, [lot.id, minBid])

  const leading = lot.leader === 'you'
  const quick: { label: string; v: number }[] = [
    { label: 'Min', v: minBid },
    { label: '+10%', v: round2(minBid * 1.1) },
    { label: 'Est. high', v: round2(lot.estimate_high) },
    { label: 'Anchor', v: round2(lot.anchor) },
  ]

  const submit = () => {
    const v = round2(Number(val))
    if (!v || v < minBid) { toast(`Bid at least ${fmtUsd(minBid)}`, 'bad'); return }
    onBid(lot.id, v)
  }

  return (
    <div>
      <div className="bid-desk">
        <input
          type="number"
          min={minBid}
          step="0.5"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          title={`Minimum ${fmtUsd(minBid)} — this is your hidden maximum, not your next bid`}
        />
        <button className="primary" onClick={submit} disabled={lot.bid_count < 0}>
          {leading ? 'RAISE MY MAX' : 'PLACE MAX BID'}
        </button>
        <div className="bid-quick">
          {quick.map((q) => (
            <button key={q.label} className="small ghost" onClick={() => setVal(q.v.toFixed(2))} title={`Set my max to ${fmtUsd(q.v)}`}>
              {q.label}
            </button>
          ))}
        </div>
      </div>
      <div className="house-foot small faint">
        {lot.my_escrow > 0
          ? <>Your max is <b style={{ color: 'var(--yellow)' }}>{fmtUsd(lot.my_escrow)}</b>, escrowed — proxy bids for you only as far as it must, and the whole max comes back if the room beats it.</>
          : <>Your bid is a <b>hidden max</b>. The house escrows it and bids for you one increment at a time; nothing above the winning price is spent.</>}
      </div>
    </div>
  )
}

/** One queue row in the rail. Own component so each row keeps its own clock. */
function RailLot({ lot, active, onPick }: { lot: AuctionLot; active: boolean; onPick: () => void }) {
  const cd = useCountdown(lot.closes_at)
  return (
    <button
      className={`rail-lot ${active ? 'on' : ''}`}
      onClick={onPick}
      title={`${lot.name} — ${fmtUsd(lot.current_bid)} · ${lot.bid_count} bid${lot.bid_count === 1 ? '' : 's'}`}
    >
      <span className={`lot-timer ${cd.secs < 45 ? 'frenzy' : heatOf(lot)}`}>{cd.expired ? 'HAMMER' : cd.label}</span>
      <img src={lot.image_small ?? ''} alt="" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
      <span className="rail-main">
        <b>{lot.name}</b>
        <span className="faint" style={{ fontSize: 10 }}>
          {lot.graded_grade ?? lot.condition}{lot.seller === 'you' ? ' · YOUR LOT' : ''}{lot.leader === 'you' ? ' · LEADING' : ''}
        </span>
      </span>
      <span className="rail-bid">
        {fmtUsd(lot.current_bid)}
        <span className="faint small"> {lot.bid_count}b</span>
      </span>
    </button>
  )
}

export function AuctionView() {
  const { toast, refreshState, openCard } = useStore()
  const [data, setData] = useState<{ live: AuctionLot[]; closed: AuctionLot[] } | null>(null)
  const [consignId, setConsignId] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('closing')
  const [mineOnly, setMineOnly] = useState(false)
  const [focusId, setFocusId] = useState<number | null>(null)

  const load = () => api.auctions().then(setData).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])

  const onBid = async (id: number, max: number) => {
    try {
      const r = await api.auctionBid(id, max)
      if (r.ok) { toast(r.message ?? 'Bid placed', 'good'); refreshState(); load() }
      else toast(r.error ?? 'Bid failed', 'bad')
    } catch { toast('Bid failed', 'bad') }
  }

  const consign = async () => {
    if (!consignId) return
    setBusy(true)
    try {
      const r = await api.auctionConsign(Number(consignId))
      if (r.ok) { toast(r.message ?? 'Consigned', 'good'); setConsignId(''); refreshState(); load() }
      else toast(r.error ?? 'Consign failed', 'bad')
    } finally { setBusy(false) }
  }

  const live = data?.live ?? []

  // The queue: the rail obeys the filters, but the stage always shows the lot
  // you picked — a search must never yank the lot you are bidding on.
  const shownLots = useMemo(() => {
    const out = live.filter((l) => {
      if (mineOnly && l.seller !== 'you' && l.leader !== 'you' && !l.my_escrow) return false
      return matchesQuery(l, q, (x) => [x.name, x.set_name, x.rarity, x.seller, x.graded_grade, x.condition])
    })
    const sorters: Record<string, (a: AuctionLot, b: AuctionLot) => number> = {
      closing: byStr((l) => l.closes_at, 'asc'),
      bid_desc: byNum((l) => l.current_bid, 'desc'),
      bid_asc: byNum((l) => l.current_bid, 'asc'),
      est_desc: byNum((l) => l.estimate_high, 'desc'),
      name_asc: byStr((l) => l.name, 'asc'),
    }
    return [...out].sort(sorters[sort] ?? sorters.closing)
  }, [live, q, sort, mineOnly])

  const focused = useMemo(() => {
    const picked = focusId != null ? live.find((l) => l.id === focusId) : undefined
    // A lot past its close time is waiting on the settlement tick: it can no
    // longer take bids, so the stage moves on rather than parking on a dead
    // lot with a bid box the server will refuse.
    const open = shownLots.find((l) => new Date(l.closes_at).getTime() > Date.now())
    return picked ?? open ?? shownLots[0] ?? live[0] ?? null
  }, [live, focusId, shownLots])
  const cd = useCountdown(focused?.closes_at ?? new Date(Date.now() + 60_000).toISOString())
  const focusIndex = focused ? live.findIndex((l) => l.id === focused.id) : -1
  const yours = live.filter((l) => l.seller === 'you')
  // What to point at when the stage's lot has closed: the next one still
  // taking bids, so the room never dead-ends on a hammer.
  const nextOpenLot = useMemo(
    () => shownLots.find((l) => l.id !== focused?.id && new Date(l.closes_at).getTime() > Date.now()) ?? null,
    [shownLots, focused],
  )

  const [collection, setCollection] = useState<{ id: number; label: string }[]>([])
  useEffect(() => {
    api.inventory().then((rows) =>
      setCollection(rows.filter((r) => r.status === 'collection').map((r) => ({ id: r.id as number, label: `${r.name} (${r.condition}${r.graded_grade ? ' · ' + r.graded_grade : ''})` }))),
    ).catch(() => {})
  }, [data])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🔨 Auction House</h1>
          <div className="sub">
            One lot under the hammer at a time. Hidden maxes, proxy bidding, a 45-second snipe guard — and a
            hammer price that settles against real market.
          </div>
        </div>
        <div className="chip-row">
          <span className="faint small">{live.length} live lots</span>
        </div>
      </div>

      <FirstUseTip surface="auction">
        <TipList
          title="How the room works"
          items={[
            { icon: '🎯', label: 'Hidden max', text: 'you enter the most you will pay; the house bids for you one increment at a time and never spends the rest.' },
            { icon: '💰', label: 'Escrow', text: 'your max is held up front and returned in full if the room beats it.' },
            { icon: '⏱️', label: 'Snipe guard', text: 'a bid inside the last 45 seconds extends the lot — no last-second steals.' },
            { icon: '🏷️', label: 'Consigning', text: 'free to list, the house keeps 15% of the hammer.' },
          ]}
        />
      </FirstUseTip>

      {!data ? (
        <EmptyState icon="🔨" text="Opening the doors…" sub="Fetching tonight's lots from the house." />
      ) : live.length === 0 ? (
        <EmptyState
          icon="🔨"
          text="No live lots right now"
          sub="The house keeps a rolling floor of lots — check back in a moment, or consign one of your own to open the room."
        />
      ) : (
        <div className="house-room">
          {focused && (
            <div className="house-stage">
              <div className="house-lights" aria-hidden />
              <div className="house-stage-head">
                <span className="house-kicker">On the block</span>
                <span className="faint small">Lot {focusIndex + 1} of {live.length}</span>
                {focused.seller === 'you' && <span className="badge warn">YOUR CONSIGNMENT</span>}
                {focused.leader === 'you' && <span className="badge auth-ok">YOU LEAD</span>}
                <span className="grow" />
                <span className={`lot-timer ${cd.secs < 45 ? 'frenzy' : heatOf(focused)}`} title="Time until the hammer">
                  {cd.expired ? 'HAMMER FALLING…' : cd.label}
                </span>
              </div>

              <div className="house-stage-body">
                <div className="house-art" onClick={() => openCard(focused.card_id)} title="Open the card">
                  {focused.graded_grade
                    ? <SlabCard src={focused.image_small} alt={focused.name} grade={focused.graded_grade} setName={focused.set_name} cardId={focused.card_id} />
                    : <CardImg src={focused.image_small} alt={focused.name} cardId={focused.card_id} />}
                </div>
                <div className="house-info">
                  <h2>{focused.name}</h2>
                  <div className="small muted">
                    {focused.set_name}
                    {focused.rarity ? ` · ${focused.rarity}` : ''} · {focused.graded_grade ?? focused.condition}
                  </div>

                  <div className="house-bid">
                    <div className="faint small">CURRENT BID</div>
                    <div className="house-bid-num">{fmtUsd(focused.current_bid)}</div>
                    <div className="small faint">
                      {focused.bid_count} bid{focused.bid_count === 1 ? '' : 's'} · {leaderLabel(focused)}
                    </div>
                  </div>

                  <div className="house-est">
                    EST. {fmtUsd(focused.estimate_low)}–{fmtUsd(focused.estimate_high)} · ANCHOR {fmtUsd(focused.anchor)}
                    {focused.current_bid > focused.estimate_high && (
                      <b style={{ color: 'var(--amber)' }}> · already past the high estimate</b>
                    )}
                    {focused.current_bid < focused.anchor * 0.9 && (
                      <b style={{ color: 'var(--green)' }}> · still under market</b>
                    )}
                  </div>

                  {focused.seller === 'you' ? (
                    <div className="house-foot small">
                      Your lot is on the block. You can't bid on it — the hammer takes 15%, you keep the rest.
                    </div>
                  ) : cd.expired ? (
                    <div className="house-foot small">
                      <b style={{ color: 'var(--amber)' }}>The hammer is falling on this lot.</b>{' '}
                      Bids are closed while it settles — the result posts on the next house tick.
                      {nextOpenLot && (
                        <div style={{ marginTop: 6 }}>
                          <button className="small" onClick={() => setFocusId(nextOpenLot.id)}>
                            Next lot: {nextOpenLot.name} →
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <BidDesk lot={focused} onBid={onBid} />
                  )}
                </div>
              </div>
            </div>
          )}

          <aside className="house-rail">
            <div className="house-rail-head">
              <span>Up next</span>
              <span>{shownLots.length} lot{shownLots.length === 1 ? '' : 's'}</span>
            </div>
            <div className="house-rail-filters">
              <SearchInput value={q} onChange={setQ} placeholder="Find a lot…" />
              <SortSelect
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'closing', label: 'Closing soonest' },
                  { value: 'bid_desc', label: 'Bid high→low' },
                  { value: 'bid_asc', label: 'Bid low→high' },
                  { value: 'est_desc', label: 'Estimate high→low' },
                  { value: 'name_asc', label: 'Name A→Z' },
                ]}
              />
              <span className={`chip ${mineOnly ? 'on' : ''}`} onClick={() => setMineOnly(!mineOnly)}>🎯 Mine</span>
            </div>
            <div className="house-rail-list">
              {shownLots.length === 0 ? (
                <div className="faint small" style={{ padding: 12 }}>No lots match that — clear the search or the Mine filter.</div>
              ) : (
                shownLots.map((lot) => (
                  <RailLot key={lot.id} lot={lot} active={focused?.id === lot.id} onPick={() => setFocusId(lot.id)} />
                ))
              )}
            </div>
          </aside>
        </div>
      )}

      {yours.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h2 style={{ marginBottom: 6 }}>Your consignments</h2>
          <div className="small">
            {yours.map((l) => (
              <div key={l.id} className="row" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <span><b>{l.name}</b> · {l.graded_grade ?? l.condition}</span>
                <span className="faint">
                  {fmtUsd(l.current_bid)} current · {l.bid_count} bid{l.bid_count === 1 ? '' : 's'}
                  {l.leader === 'you' ? '' : l.leader ? ` · ${l.leader} leading` : ' · no bids yet'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel house-consign">
        <b>Consign a card:</b>
        <select value={consignId} onChange={(e) => setConsignId(e.target.value ? Number(e.target.value) : '')} style={{ flex: 1, minWidth: 240 }}>
          <option value="">Choose from your collection…</option>
          {collection.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <button className="primary" disabled={!consignId || busy} onClick={consign}>{busy ? '…' : 'Put on the block'}</button>
        <span className="faint small">Free to list · the house keeps 15% of the hammer</span>
      </div>

      {data && data.closed.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h2 style={{ marginBottom: 8 }}>Hammered</h2>
          <div className="hammered">
            {data.closed.map((lot) => (
              <div key={lot.id} className="row small" style={{ justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <span>
                  <b>{lot.name}</b>{(lot.graded_grade ?? lot.condition) ? ` (${lot.graded_grade ?? lot.condition})` : ''}
                  {' — '}
                  <span style={{ color: lot.leader === 'you' ? 'var(--green)' : 'var(--text)', fontWeight: lot.leader === 'you' ? 750 : 400 }}>
                    {lot.status === 'passed' ? 'passed (no bids)' : `${fmtUsd(lot.final_bid ?? 0)} to ${lot.leader === 'you' ? 'YOU' : lot.leader}`}
                  </span>
                </span>
                <span className="faint small">
                  {lot.seller === 'you' ? 'your consignment' : `est ${fmtUsd(lot.estimate_low)}–${fmtUsd(lot.estimate_high)}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
