import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type AuctionLot } from '../api'
import { useStore } from '../store'
import { byNum, byStr, fmtUsd, matchesQuery, SearchInput, SortSelect } from '../components'

function useCountdown(closesAt: string) {
  const [left, setLeft] = useState(() => new Date(closesAt).getTime() - Date.now())
  const ref = useRef(closesAt)
  ref.current = closesAt
  useEffect(() => {
    const t = setInterval(() => setLeft(new Date(ref.current).getTime() - Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor(left / 1000))
  const m = Math.floor(s / 60)
  return { expired: left <= 0, label: m >= 1 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s` }
}

function BidBox({ lot, onBid }: { lot: AuctionLot; onBid: (id: number, max: number) => void }) {
  const minBid = lot.current_bid > 0 ? Math.round(lot.current_bid * 1.05 * 100) / 100 : 0.5
  const [val, setVal] = useState(String(minBid.toFixed(2)))
  const { toast } = useStore()
  useEffect(() => { setVal(String(minBid.toFixed(2))) }, [minBid])
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input
        type="number"
        min={minBid}
        step="0.5"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        style={{ width: 92 }}
        title={`Minimum bid ${fmtUsd(minBid)} — your max stays hidden from the room`}
      />
      <button className="primary small" disabled={lot.leader === 'you'} onClick={() => {
        const v = Number(val)
        if (!v || v < minBid) { toast(`Minimum is ${fmtUsd(minBid)}`, 'bad'); return }
        onBid(lot.id, v)
      }}>
        {lot.leader === 'you' ? '✓ Leading' : 'Bid'}
      </button>
    </div>
  )
}

function LotCard({ lot, onBid }: { lot: AuctionLot; onBid: (id: number, max: number) => void }) {
  const { openCard } = useStore()
  const cd = useCountdown(lot.closes_at)
  const vsEst = lot.current_bid / lot.estimate_high
  const heat = vsEst > 1.1 ? 'frenzy' : vsEst > 0.85 ? 'hot' : 'cool'
  return (
    <div className="panel lot-card" style={{ margin: 0 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ width: 72, cursor: 'pointer' }} onClick={() => openCard(lot.card_id)}>
          <img src={lot.image_small ?? ''} alt={lot.name} style={{ width: '100%', borderRadius: 6, display: 'block', background: '#0d1017' }}
            onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <b className="small" style={{ cursor: 'pointer' }} onClick={() => openCard(lot.card_id)}>{lot.name}</b>
            <span className={`lot-timer ${heat}`}>{cd.label}</span>
          </div>
          <div className="faint small">{lot.set_name}{lot.graded_grade ? ` · ${lot.graded_grade}` : ` · ${lot.condition}`}{lot.seller === 'you' ? ' · YOUR LOT' : ''}</div>
          <div className="row mt8" style={{ justifyContent: 'space-between' }}>
            <div>
              <div className="faint small" style={{ fontSize: 10 }}>CURRENT BID</div>
              <div className="price">{fmtUsd(lot.current_bid)} <span className="faint small">({lot.bid_count} bids)</span></div>
            </div>
            <div className="right">
              <div className="faint small" style={{ fontSize: 10 }}>EST. {fmtUsd(lot.estimate_low)}–{fmtUsd(lot.estimate_high)}</div>
              <div className="faint small">mkt {fmtUsd(lot.anchor)}</div>
            </div>
          </div>
          <div className="row mt8" style={{ justifyContent: 'space-between' }}>
            <span className="faint small">{lot.leader === 'you' ? `You lead — ${fmtUsd(lot.my_escrow)} escrowed` : lot.leader ? `Leader: ${lot.leader}` : 'No bids yet'}</span>
            {lot.seller === 'house' && !cd.expired && <BidBox lot={lot} onBid={onBid} />}
          </div>
        </div>
      </div>
    </div>
  )
}

export function AuctionView() {
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<{ live: AuctionLot[]; closed: AuctionLot[] } | null>(null)
  const [consignId, setConsignId] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('closing')
  const [mineOnly, setMineOnly] = useState(false)

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

  const shownLots = useMemo(() => {
    const out = (data?.live ?? []).filter((l) => {
      if (mineOnly && l.seller !== 'you' && l.leader !== 'you' && !l.my_escrow) return false
      if (!matchesQuery(l, q, (x) => [x.name, x.set_name, x.rarity, x.seller, x.graded_grade, x.condition])) return false
      return true
    })
    const sorters: Record<string, (a: AuctionLot, b: AuctionLot) => number> = {
      closing: byStr((l) => l.closes_at, 'asc'),
      bid_desc: byNum((l) => l.current_bid, 'desc'),
      bid_asc: byNum((l) => l.current_bid, 'asc'),
      est_desc: byNum((l) => l.estimate_high, 'desc'),
      est_asc: byNum((l) => l.estimate_high, 'asc'),
      name_asc: byStr((l) => l.name, 'asc'),
    }
    return [...out].sort(sorters[sort] ?? sorters.closing)
  }, [data, q, sort, mineOnly])

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
          <div className="sub">Timed lots, hidden maxes, snipe guards — hammer prices anchor to real market.</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>Consign a card:</b>
        <select value={consignId} onChange={(e) => setConsignId(e.target.value ? Number(e.target.value) : '')} style={{ flex: 1, minWidth: 240 }}>
          <option value="">Choose from your collection…</option>
          {collection.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <button className="primary" disabled={!consignId || busy} onClick={consign}>{busy ? '…' : 'Put on the block'}</button>
        <span className="faint small">House takes 15% of the hammer. You get the rest.</span>
      </div>

      {(data?.live.length ?? 0) > 0 && (
        <div className="filter-row">
          <SearchInput value={q} onChange={setQ} placeholder="Search lots by card, set, seller…" />
          <SortSelect
            value={sort}
            onChange={setSort}
            options={[
              { value: 'closing', label: 'Sort: Closing soonest' },
              { value: 'bid_desc', label: 'Sort: Current bid high→low' },
              { value: 'bid_asc', label: 'Sort: Current bid low→high' },
              { value: 'est_desc', label: 'Sort: Estimate high→low' },
              { value: 'est_asc', label: 'Sort: Estimate low→high' },
              { value: 'name_asc', label: 'Sort: Name A→Z' },
            ]}
          />
          <span className={`chip ${mineOnly ? 'on' : ''}`} onClick={() => setMineOnly(!mineOnly)}>🎯 Mine</span>
          <span className="result-count faint small">{shownLots.length} of {data?.live.length ?? 0} lots</span>
        </div>
      )}
      {data?.live.length === 0 && <div className="faint small">No live lots right now — the house is setting up. Check back after a few ticks.</div>}
      <div className="grid cols2">
        {shownLots.map((lot) => <LotCard key={lot.id} lot={lot} onBid={onBid} />)}
      </div>

      {data && data.closed.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h2 style={{ marginBottom: 8 }}>Recently closed</h2>
          {data.closed.map((lot) => (
            <div key={lot.id} className="row small" style={{ padding: '5px 0', borderBottom: '1px solid var(--border-soft)', justifyContent: 'space-between' }}>
              <span>
                <b>{lot.name}</b>
                {lot.graded_grade ? ` (${lot.graded_grade})` : ` (${lot.condition})`}
                {' — '}
                <span style={{ color: lot.leader === 'you' ? 'var(--green)' : 'var(--text)' }}>
                  {lot.status === 'passed' ? 'passed (no bids)' : `${fmtUsd(lot.final_bid ?? 0)} to ${lot.leader === 'you' ? 'YOU' : lot.leader}`}
                </span>
              </span>
              <span className="faint small">{lot.seller === 'you' ? 'your consignment' : `est ${fmtUsd(lot.estimate_low)}–${fmtUsd(lot.estimate_high)}`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
