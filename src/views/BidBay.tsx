import { useEffect, useMemo, useState } from 'react'
import { api, type EbayListing, type EbayMarketListing, type EbayAuction, type EbayNpcAuction } from '../api'
import { useStore } from '../store'
import { CardImg, FirstUseTip, fmtUsd, TipList } from '../components'
import { ShipSection } from './ShipBay'

// ---------------------------------------------------------------------------
// 📦 BidBay (Phase 5) — the online storefront. List anything from the binder
// at any per-unit price; NPC snipers hunt the feed for underpriced cardboard.
// 13% seller fees, a shipping cost per order, feedback that feeds sales speed,
// and channel conflict: every live listing siphons walk-in traffic from the
// physical shop.
// ---------------------------------------------------------------------------

function DealBadge({ ask, market, cond }: { ask: number; market: number; cond?: string }) {
  if (market <= 0) return null
  const delta = ask / market - 1
  const label = delta < -0.1 ? 'DEAL' : delta > 0.25 ? 'STEEPY' : 'MARKET'
  const cls = delta < -0.1 ? 'below' : delta > 0.25 ? 'above' : 'at'
  return (
    <span
      className={`badge ${cls}`}
      style={{ fontSize: 10, padding: '2px 8px' }}
      title={cond ? `Compared against this card's ${cond} market value.` : undefined}
    >
      {label} {delta > 0 ? '+' : ''}{(delta * 100).toFixed(0)}%
      {cond && <span className="faint" style={{ marginLeft: 4, fontSize: 9 }}>vs {cond}</span>}
    </span>
  )
}

function Countdown({ closesAt }: { closesAt: string }) {
  const left = new Date(closesAt).getTime() - Date.now()
  if (left <= 0) return <span className="small faint">hammer…</span>
  const s = Math.ceil(left / 1000)
  const hot = s < 30
  return <span className={`small ${hot ? '' : 'faint'}`} style={hot ? { color: 'var(--gold)' } : undefined}>⏱ {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>
}

function ShipCountdown({ shipsAt, paid }: { shipsAt: string | null; paid: number }) {
  if (paid) return <span className="badge at" style={{ fontSize: 10, padding: '2px 8px' }}>paid out</span>
  if (!shipsAt) return null
  const left = new Date(shipsAt).getTime() - Date.now()
  if (left <= 0) return <span className="small faint">arriving…</span>
  return <span className="small faint">ships in {Math.max(1, Math.ceil(left / 60000))}m</span>
}

export function BidBayView() {
  const { toast, refreshState, state } = useStore()
  const [data, setData] = useState<Awaited<ReturnType<typeof api.ebay>> | null>(null)
  const [market, setMarket] = useState<EbayMarketListing[]>([])
  const [lots, setLots] = useState<EbayAuction[]>([])
  const [recent, setRecent] = useState<EbayAuction[]>([])
  const [npcLots, setNpcLots] = useState<EbayNpcAuction[]>([])
  const [bidMax, setBidMax] = useState<Record<number, string>>({})
  const [watchMax, setWatchMax] = useState<Record<string, string>>({})
  const [collection, setCollection] = useState<{ id: number; label: string; value: number; qty: number }[]>([])
  const [listingId, setListingId] = useState<number | ''>('')
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api.ebay().then(setData).catch(() => {})
  const loadMarket = () => api.ebayMarket().then(setMarket).catch(() => {})
  const loadLots = () => api.ebayAuctions().then((d) => setLots(d.live)).catch(() => {})
  const loadRecent = () => api.ebayAuctions().then((d) => setRecent(d.recent)).catch(() => {})
  const loadNpcLots = () => api.ebayNpcAuctions().then(setNpcLots).catch(() => {})
  useEffect(() => { load(); loadMarket(); loadLots(); loadRecent(); loadNpcLots() }, [])
  useEffect(() => {
    const t = setInterval(load, 8000)
    const t2 = setInterval(loadMarket, 12000)
    const t3 = setInterval(loadLots, 3000)
    const t4 = setInterval(loadNpcLots, 3000)
    return () => { clearInterval(t); clearInterval(t2); clearInterval(t3); clearInterval(t4) }
  }, [])
  useEffect(() => {
    api.inventory().then((rows) =>
      setCollection(
        rows
          .filter((r) => r.status === 'collection' && !r.graded_grade)
          .map((r) => ({ id: r.id as number, label: `${r.name} (${r.condition})${(r.quantity as number) > 1 ? ` ×${r.quantity}` : ''}`, value: r.value as number, qty: r.quantity as number })),
      ),
    ).catch(() => {})
  }, [data])

  const selected = collection.find((c) => c.id === listingId) ?? null
  const listedIds = useMemo(() => new Set((data?.live ?? []).map((l) => l.inventory_id)), [data])

  const list = async () => {
    if (!listingId || !ask) return
    setBusy(true)
    try {
      const r = await api.ebayList(Number(listingId), Number(ask))
      if (r.ok) { toast('Listed on BidBay — the snipers are watching', 'good'); setListingId(''); setAsk(''); refreshState(); load() }
      else toast(r.error ?? 'Listing failed', 'bad')
    } finally { setBusy(false) }
  }

  const cancel = async (id: number) => {
    const r = await api.ebayCancel(id)
    if (r.ok) { toast('Listing cancelled', 'info'); load() }
    else toast(r.error ?? 'Cancel failed', 'bad')
  }

  const promote = async (id: number) => {
    const r = await api.ebayPromote(id)
    if (r.ok) { toast('Promoted — your listing is at the top of the feed', 'good'); refreshState(); load() }
    else toast(r.error ?? 'Promotion failed', 'bad')
  }

  const buyMarket = async (l: EbayMarketListing) => {
    const r = await api.ebayMarketBuy(l.id)
    if (r.ok) { toast(`Sniped ${l.quantity > 1 ? `${l.quantity}× ` : ''}${l.name} — on the road, lands in 1–2 game-days`, 'good'); refreshState(); load(); loadMarket() }
    else toast(r.error ?? 'Buy failed — the deal may be gone', 'bad')
  }

  const startAuction = async (id: number) => {
    const r = await api.ebayAuctionStart(id)
    if (r.ok) { toast(`On the block — opening $${r.start?.toFixed(2)}. The room is warming up…`, 'good'); refreshState(); load(); loadLots() }
    else toast(r.error ?? 'Auction failed', 'bad')
  }

  const cancelLot = async (id: number) => {
    const r = await api.ebayAuctionCancel(id)
    if (r.ok) { toast('Pulled from the block', 'info'); loadLots() }
    else toast(r.error ?? 'Cancel failed', 'bad')
  }

  const placeBid = async (a: EbayNpcAuction) => {
    const raw = bidMax[a.id]
    const max = Number(raw)
    if (!raw || !(max > 0)) { toast('Enter your max bid', 'bad'); return }
    const r = await api.ebayNpcBid(a.id, max)
    if (r.ok) { toast(r.message ?? 'Bid placed', 'good'); setBidMax((m) => ({ ...m, [a.id]: '' })); refreshState(); loadNpcLots() }
    else toast(r.error ?? 'Bid failed', 'bad')
  }

  const watchedIds = useMemo(() => new Set((data?.watches ?? []).map((w) => w.card_id)), [data])
  const toggleWatch = async (cardId: string, name: string) => {
    if (watchedIds.has(cardId)) {
      const r = await api.ebayUnwatch(cardId)
      if (r.ok) { toast(`Stopped watching ${name}`, 'info'); load() }
    } else {
      const r = await api.ebayWatch(cardId)
      if (r.ok) { toast(`Watching ${name} — 🔔 when it hits BidBay`, 'good'); load() }
    }
  }
  const saveWatchMax = async (cardId: string) => {
    const raw = watchMax[cardId]
    const capped = raw && Number(raw) > 0 ? Number(raw) : null
    const r = await api.ebayWatch(cardId, capped)
    if (r.ok) { toast(capped ? `Cap set — ping only at $${capped.toFixed(2)} or less` : 'Cap cleared — ping on any listing', 'info'); setWatchMax((m) => ({ ...m, [cardId]: '' })); load() }
  }

  const askNum = Number(ask)
  const fee = askNum > 0 ? askNum * (data?.feeRate ?? 0.13) : 0
  const ship = askNum > 0 ? 1 + askNum * 0.04 : 0

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>📦 BidBay</h1>
          <div className="sub">The online storefront — list it, price it, and hope the snipers agree. {data && data.feedback.count > 0 ? `${data.feedback.avg.toFixed(1)}★ from ${data.feedback.count} sale${data.feedback.count === 1 ? '' : 's'}` : ''}</div>
        </div>
      </div>

      <FirstUseTip surface="ebay">
        <TipList
          title="📦 Your first listing"
          items={[
            { icon: '🎯', label: 'Price to sell', text: <>snipers only pounce meaningfully <b>under</b> market — overpriced cardboard just sits there collecting views</> },
            { icon: '💸', label: '13% + shipping', text: <>BidBay's cut of the hammer; the payout lands after the envelope "arrives"</> },
            { icon: '⭐', label: 'Feedback compounds', text: <>buyers rate every sale, and your rating drives how fast the next listing moves</> },
            { icon: '🔔', label: 'Watch with a max', text: <>set a max price and it only pings when the card shows up at or under your number</> },
            { icon: '📣', label: 'Promote = eyes', text: <>ads buy attention, not sales — placement only helps if the price is right</> },
            { icon: '⚔️', label: 'Rivals shop here too', text: <>NPCs list stock below you and rival buyers hunt the same deals — sleep on a DEAL and it's gone</> },
            { icon: '🏪', label: 'It costs your shop', text: <>every live listing pulls walk-ins away from your storefront</> },
          ]}
        />
      </FirstUseTip>

      <div className="panel" style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>List a card:</b>
        <select value={listingId} onChange={(e) => {
          const id = e.target.value ? Number(e.target.value) : ''
          setListingId(id)
          const sel = collection.find((c) => c.id === id)
          if (sel) setAsk(sel.value.toFixed(2))
        }} style={{ flex: 1, minWidth: 240 }}>
          <option value="">Choose from your collection…</option>
          {collection.filter((c) => !listedIds.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.label} — mkt {fmtUsd(c.value)}</option>)}
        </select>
        <input type="number" min={0.5} step={0.5} placeholder="ask / card" value={ask} onChange={(e) => setAsk(e.target.value)} style={{ width: 130 }} />
        <button className="primary" disabled={!listingId || !ask || busy} onClick={list}>{busy ? '…' : 'List it'}</button>
        {selected && askNum > 0 && (
          <span className="faint small">
            market {fmtUsd(selected.value)} · fee −{fmtUsd(fee)} · ship −{fmtUsd(ship)} → net {fmtUsd(Math.max(0, askNum * selected.qty - fee * selected.qty - ship))} for {selected.qty > 1 ? `${selected.qty} cards` : 'one card'}
            {data && <> · promote later for {fmtUsd(data.promoRate.flat + askNum * data.promoRate.pct)}</>}
          </span>
        )}
        {selected && (
          <button className="small" disabled={busy} onClick={() => startAuction(selected.id)} title="Open bid ~25–45% of market; the room bids it up over the next few minutes; 15% house fee + shipping on the hammer">
            🔨 Auction instead
          </button>
        )}
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>🔔 Watching <span className="faint small">— BidBay pings your feed the moment these surface. Set a cap to only hear about deals.</span></h2>
      {(data?.watches.length ?? 0) === 0 && <div className="faint small" style={{ marginBottom: 14 }}>Not watching anything — hit the 🔔 on any hunt or auction listing below.</div>}
      {(data?.watches ?? []).map((w) => (
        <div key={w.card_id} className="panel" style={{ marginBottom: 8, padding: '8px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 16 }}>🔔</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b className="small">{w.name}</b> {w.set_name && <span className="faint small">{w.set_name}</span>}
            <div className="faint small">{w.max_price != null ? <>pinging at <b style={{ color: 'var(--gold)' }}>{fmtUsd(w.max_price)}</b> or less</> : 'pinging on any listing'}</div>
          </div>
          <input type="number" min={0.5} step={0.5} placeholder="max $ (any)" value={watchMax[w.card_id] ?? ''} onChange={(e) => setWatchMax((m) => ({ ...m, [w.card_id]: e.target.value }))} style={{ width: 120 }} />
          <button className="small" onClick={() => saveWatchMax(w.card_id)} title="Ping only when a new listing appears at or under this price">Cap</button>
          <button className="small" onClick={() => toggleWatch(w.card_id, w.name)} title="Stop watching">✕</button>
        </div>
      ))}

      <h2 style={{ marginBottom: 8 }}>🟢 Live listings {(data?.live.length ?? 0) > 0 && <span className="faint small">({data?.live.length})</span>}</h2>
      {(data?.live.length ?? 0) === 0 && <div className="faint small" style={{ marginBottom: 14 }}>Nothing listed. Your shop's walk-ins thank you.</div>}
      {(data?.live ?? []).map((l) => <ListingRow key={l.id} l={l} onCancel={cancel} onPromote={promote} promoTicks={data?.promoRate.ticks ?? 20} />)}

      {(lots.length > 0) && <h2 style={{ margin: '18px 0 8px' }}>🔨 On the block <span className="faint small">— the room is bidding. 15% house fee.</span></h2>}
      {lots.map((a) => <AuctionRow key={a.id} a={a} onCancel={cancelLot} />)}

      {(npcLots.length > 0) && <h2 style={{ margin: '18px 0 8px' }}>📣 Live auctions <span className="faint small">— NPC lots, rival bidders, escrowed maxes. No buyer's premium.</span></h2>}
      {npcLots.map((a) => (
        <div key={a.id} className="panel" style={{ marginBottom: 10, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', borderColor: a.leader === 'you' ? 'var(--green)' : undefined }}>
          <CardImg src={a.image_small} alt={a.name} className="row-thumb" cardId={a.card_id} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b className="small">{a.quantity > 1 ? `${a.quantity}× ` : ''}{a.name}</b> <span className="faint small">{a.set_name} · {a.condition}</span>
            {a.leader === 'you' && <span className="badge below" style={{ fontSize: 10, padding: '2px 8px', marginLeft: 6 }} title="Your max is escrowed — you pay at most your max, often less">YOU LEAD · ${a.my_escrow.toFixed(2)} escrowed</span>}
            <div className="faint small">
              {a.current_bid > 0
                ? <><b style={{ color: 'var(--gold)' }}>${a.current_bid.toFixed(2)}</b> — {a.leader === 'you' ? 'your proxy holds' : a.leader} · {a.bid_count} bid{a.bid_count === 1 ? '' : 's'} · next bid ≥ ${a.min_next.toFixed(2)}</>
                : <>opening ${a.min_next.toFixed(2)} vs market {fmtUsd(a.market_at_list)} · no bids yet</>}
            </div>
          </div>
          <Countdown closesAt={a.closes_at} />
          <button className="small" onClick={() => toggleWatch(a.card_id, a.name)} title={watchedIds.has(a.card_id) ? 'Watching this card — click to stop' : 'Watch — 🔔 when this card comes up again'}>{watchedIds.has(a.card_id) ? '🔔' : '🔕'}</button>
          <input type="number" min={a.min_next} step={0.5} placeholder={`max $${Math.max(a.min_next, 1).toFixed(0)}+`} value={bidMax[a.id] ?? ''} onChange={(e) => setBidMax((m) => ({ ...m, [a.id]: e.target.value }))} style={{ width: 110 }} />
          <button className="primary small" disabled={!(Number(bidMax[a.id]) > 0)} onClick={() => placeBid(a)} title="Proxy bid: your max is hidden and escrowed; you pay one increment over the runner-up">Bid</button>
        </div>
      ))}

      {(recent.length > 0) && <h2 style={{ margin: '18px 0 8px' }}>🫱 Hammer history <span className="faint small">— how your lots landed.</span></h2>}
      {recent.map((a) => (
        <div key={a.id} className="panel" style={{ marginBottom: 8, padding: '8px 14px', display: 'flex', gap: 12, alignItems: 'center', opacity: 0.85 }}>
          <CardImg src={a.image_small} alt={a.name} className="row-thumb" cardId={a.card_id} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b className="small">{a.quantity > 1 ? `${a.quantity}× ` : ''}{a.name}</b>
            <div className="faint small">
              {a.status === 'sold'
                ? <>🔨 {a.leader} won at <b style={{ color: 'var(--gold)' }}>${a.current_bid.toFixed(2)}</b> ({a.bid_count} bids) → net <b style={{ color: 'var(--green)' }}>{fmtUsd(a.net ?? 0)}</b>{a.paid === 0 ? ' · shipping…' : ' · paid out'}</>
                : <span>expired unsold at $${a.start.toFixed(2)} opening — the room passed.</span>}
            </div>
          </div>
        </div>
      ))}

      <h2 style={{ margin: '18px 0 8px' }}>🔍 On the hunt <span className="faint small">— NPC stock, rotating. Deals go fast.</span></h2>
      {market.length === 0 && <div className="faint small" style={{ marginBottom: 14 }}>The hunt is empty — new listings appear as the market turns over.</div>}
      {market.map((l) => (
        <div key={l.id} className="panel" style={{ marginBottom: 10, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <CardImg src={l.image_small} alt={l.name} className="row-thumb" cardId={l.card_id} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b className="small">{l.quantity > 1 ? `${l.quantity}× ` : ''}{l.name}</b> <span className="faint small">{l.set_name} · {l.condition}</span>
            <div className="faint small">seller <b>{l.seller}</b> · ask <b style={{ color: 'var(--gold)' }}>{fmtUsd(l.ask)}</b>/ea vs market {fmtUsd(l.market_at_list)}{l.quantity > 1 ? <> · lot {fmtUsd(l.ask * l.quantity)}</> : null}</div>
          </div>
          <DealBadge ask={l.ask} market={l.market_at_list} cond={l.condition} />
          <button className="small" onClick={() => toggleWatch(l.card_id, l.name)} title={watchedIds.has(l.card_id) ? 'Watching this card — click to stop' : 'Watch — 🔔 when this card shows up on BidBay again'}>{watchedIds.has(l.card_id) ? '🔔' : '🔕'}</button>
          <button className="primary small" disabled={l.ask * l.quantity > (state?.cash ?? 0)} onClick={() => buyMarket(l)} title={l.quantity > 1 ? `Buy the whole lot of ${l.quantity} for ${fmtUsd(l.ask * l.quantity)}` : `Buy for ${fmtUsd(l.ask)}`}>Buy</button>
        </div>
      ))}

      <ShipSection />

      {(data?.sold.length ?? 0) > 0 && (
        <>
          <h2 style={{ margin: '18px 0 8px' }}>📨 Sold & shipping</h2>
          {(data?.sold ?? []).map((l) => (
            <div key={l.id} className="panel" style={{ marginBottom: 10, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
              <CardImg src={l.image_small} alt={l.name} className="row-thumb" cardId={l.card_id} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b className="small">{l.quantity > 1 ? `${l.quantity}× ` : ''}{l.name}</b>
                <div className="faint small">{l.buyer} · sold @ {fmtUsd(l.sold_price ?? 0)}/ea = {fmtUsd((l.sold_price ?? 0) * l.quantity)} · fee −{fmtUsd(l.fee ?? 0)} · ship −{fmtUsd(l.shipping ?? 0)} → <b style={{ color: 'var(--green)' }}>{fmtUsd(l.net ?? 0)}</b></div>
                {l.paid === 0 && <ShipCountdown shipsAt={l.ships_at} paid={l.paid} />}
              </div>
              {l.paid === 0 ? <ShipCountdown shipsAt={l.ships_at} paid={l.paid} /> : <span className="badge below" style={{ fontSize: 10, padding: '2px 8px' }}>paid out</span>}
            </div>
          ))}
        </>
      )}

      <div className="faint small" style={{ marginTop: 16 }}>
        Lifetime fees paid: {data ? fmtUsd(data.feesPaid) : '—'} · shipping: {data ? fmtUsd(data.shippingPaid) : '—'} · fee rate {((data?.feeRate ?? 0.13) * 100).toFixed(0)}%
      </div>
    </div>
  )
}

function AuctionRow({ a, onCancel }: { a: EbayAuction; onCancel: (id: number) => void }) {
  const lotMarket = a.market_at_list * a.quantity
  const over = lotMarket > 0 ? a.current_bid / lotMarket - 1 : 0
  const hot = a.bid_count >= 5 || over > 0.15
  return (
    <div className="panel" style={{ marginBottom: 10, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', borderColor: hot ? 'var(--yellow)' : undefined }}>
      <CardImg src={a.image_small} alt={a.name} className="row-thumb" cardId={a.card_id} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b className="small">{a.quantity > 1 ? `${a.quantity}× ` : ''}{a.name}</b> <span className="faint small">{a.set_name} · {a.condition}</span>
        {hot && <span className="badge above" style={{ fontSize: 10, padding: '2px 8px', marginLeft: 6 }} title="The room is fighting over this">🔥 BIDDING WAR</span>}
        <div className="faint small">
          {a.bid_count === 0
            ? <>opening <b style={{ color: 'var(--gold)' }}>${a.start.toFixed(2)}</b> vs market {fmtUsd(lotMarket)} · no bidders yet</>
            : <><b style={{ color: 'var(--gold)' }}>${a.current_bid.toFixed(2)}</b> — {a.leader} · {a.bid_count} bid{a.bid_count === 1 ? '' : 's'} · {over >= 0 ? <b style={{ color: 'var(--green)' }}>{(over * 100).toFixed(0)}% over market</b> : <>{Math.abs(over * 100).toFixed(0)}% below market</>}</>}
        </div>
      </div>
      <Countdown closesAt={a.closes_at} />
      {a.bid_count === 0 && <button className="small" onClick={() => onCancel(a.id)} title="No bids yet — you can still pull the lot">Pull</button>}
    </div>
  )
}

function ListingRow({ l, onCancel, onPromote, promoTicks }: { l: EbayListing; onCancel: (id: number) => void; onPromote: (id: number) => void; promoTicks: number }) {
  return (
    <div className="panel" style={{ marginBottom: 10, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', borderColor: l.promoted_ticks > 0 ? 'var(--yellow)' : undefined }}>
      <CardImg src={l.image_small} alt={l.name} className="row-thumb" cardId={l.card_id} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b className="small">{l.quantity > 1 ? `${l.quantity}× ` : ''}{l.name}</b> <span className="faint small">{l.set_name} · {l.condition}</span>
        {l.promoted_ticks > 0 && (
          <span className="badge at" style={{ fontSize: 10, padding: '2px 8px', marginLeft: 6 }} title="Promoted: featured in the sniper feed, 3× views">
            PROMOTED · {l.promoted_ticks} tick{l.promoted_ticks === 1 ? '' : 's'} left
          </span>
        )}
        <div className="faint small">ask <b style={{ color: 'var(--gold)' }}>{fmtUsd(l.ask)}</b>/ea vs market {fmtUsd(l.market_at_list)} · 👁 {l.views} · ⭐ {l.watchers}</div>
      </div>
      <DealBadge ask={l.ask} market={l.market_at_list} cond={l.condition} />
      {l.promoted_ticks === 0 && (
        <button className="small" onClick={() => onPromote(l.id)} title={`Featured placement + 3× views for ${promoTicks} ticks; fee is non-refundable`}>Promote</button>
      )}
      <button className="small" onClick={() => onCancel(l.id)}>Cancel</button>
    </div>
  )
}
