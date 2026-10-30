import { useEffect, useMemo, useState } from 'react'
import {
  api,
  type EbayAuction,
  type EbayListing,
  type EbayMarketListing,
  type EbayNpcAuction,
} from '../api'
import { useStore } from '../store'
import { CardImg, FirstUseTip, fmtUsd, TipList } from '../components'
import { ShipSection } from './ShipBay'

// ---------------------------------------------------------------------------
// 📦 BidBay — rebuilt as a 1:1 eBay storefront (roadmap item 2.0).
//
// The old screen was seven stacked sections of panels. eBay's shape is:
// a chrome header with search → a category strip → a left filter rail next to
// ONE unified result list (every item, whatever its buying format) → an item
// page with a buy box. That skeleton is what's rebuilt here; every mechanic
// (fees, sniping, proxy bidding, promotion, feedback, shipping disputes) is
// the same code it was before, just wearing the storefront it's imitating.
//
// The wordmark is deliberately the game's own — this is a fake eBay, not a
// copy of their logo. The layout is the imitation.
// ---------------------------------------------------------------------------

type Kind = 'buy' | 'auction' | 'mine' | 'mineAuction'
type Sort = 'best' | 'price_asc' | 'price_desc' | 'ending' | 'newest'
type Tab = 'browse' | 'selling' | 'watching' | 'shipping'

type Row = {
  key: string
  kind: Kind
  card_id: string
  name: string
  set_name: string | null
  image_small: string | null
  condition: string
  qty: number
  price: number
  market: number
  seller: string
  closing?: string
  views?: number
  watchers?: number
  listing?: EbayListing
  npc?: EbayNpcAuction
  own?: EbayAuction
}

const SORTS: { id: Sort; label: string }[] = [
  { id: 'best', label: 'Best Match' },
  { id: 'price_asc', label: 'Price + shipping: lowest first' },
  { id: 'price_desc', label: 'Price + shipping: highest first' },
  { id: 'ending', label: 'Time: ending soonest' },
  { id: 'newest', label: 'Time: newly listed' },
]

function dealTag(ask: number, market: number): { label: string; cls: string } | null {
  if (market <= 0) return null
  const d = ask / market - 1
  if (d < -0.1) return { label: `Deal ${Math.round(d * 100)}%`, cls: 'bb-deal' }
  if (d > 0.25) return { label: `Steepy +${Math.round(d * 100)}%`, cls: 'bb-steep' }
  return null
}

function timeLeft(iso?: string): { text: string; hot: boolean } | null {
  if (!iso) return null
  const left = new Date(iso).getTime() - Date.now()
  if (left <= 0) return { text: 'Ending…', hot: true }
  const s = Math.ceil(left / 1000)
  if (s < 3600) return { text: `${Math.floor(s / 60)}m ${s % 60}s`, hot: s < 120 }
  const h = Math.floor(s / 3600)
  if (h < 24) return { text: `${h}h ${Math.floor((s % 3600) / 60)}m`, hot: false }
  return { text: `${Math.floor(h / 24)}d ${h % 24}h`, hot: false }
}

const fmtWhen = (iso?: string) => {
  const t = timeLeft(iso)
  if (!t) return '—'
  return t.text
}

// --- chrome -----------------------------------------------------------------

function Chrome({
  q,
  setQ,
  cat,
  setCat,
  cats,
  tab,
  setTab,
  watchCount,
  sellCount,
  fb,
  onSearch,
}: {
  q: string
  setQ: (v: string) => void
  cat: string
  setCat: (v: string) => void
  cats: string[]
  tab: Tab
  setTab: (t: Tab) => void
  watchCount: number
  sellCount: number
  fb: { avg: number; count: number }
  onSearch: () => void
}) {
  return (
    <div className="bb-chrome">
      <div className="bb-top">
        <div className="bb-wordmark" title="BidBay — the online marketplace">
          Bid<span>Bay</span>
        </div>
        <form
          className="bb-search"
          onSubmit={(e) => {
            e.preventDefault()
            onSearch()
          }}
        >
          <select aria-label="Search category" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">All categories</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            type="search"
            placeholder="Search for anything"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search BidBay"
          />
          <button type="submit" className="bb-go">Search</button>
        </form>
        <div className="bb-top-links">
          <span className="bb-fb" title="Your feedback rating — the only seller score this page knows for certain">
            ⭐ {fb.avg.toFixed(1)} <span className="faint">({fb.count} sales)</span>
          </span>
          <button className={`bb-link ${tab === 'selling' ? 'on' : ''}`} onClick={() => setTab('selling')}>
            Sell<span className="bb-count">{sellCount}</span>
          </button>
          <button className={`bb-link ${tab === 'watching' ? 'on' : ''}`} onClick={() => setTab('watching')}>
            Watchlist<span className="bb-count">{watchCount}</span>
          </button>
          <button className={`bb-link ${tab === 'shipping' ? 'on' : ''}`} onClick={() => setTab('shipping')}>
            To ship
          </button>
          <span className="bb-bell" title="Notifications land in your activity feed">🔔</span>
        </div>
      </div>

      <div className="bb-cats">
        <button className={`bb-cat ${tab === 'browse' ? 'on' : ''}`} onClick={() => setTab('browse')}>
          Browse all
        </button>
        <span className="bb-cat-sep" />
        <span className="bb-cat-note">Pokémon TCG singles · raw cards only · 13% seller fee</span>
        <span className="bb-cat-sep" />
        <span className="bb-cat-note faint">Every price anchors to the real market · shipping chosen at checkout</span>
      </div>
    </div>
  )
}

// --- filter rail ------------------------------------------------------------

function Rail({
  conds,
  f,
  setF,
  resultCount,
}: {
  conds: string[]
  f: {
    buyItNow: boolean
    auction: boolean
    conds: string[]
    min: string
    max: string
    mineOnly: boolean
    watchedOnly: boolean
  }
  setF: (patch: Partial<{
    buyItNow: boolean
    auction: boolean
    conds: string[]
    min: string
    max: string
    mineOnly: boolean
    watchedOnly: boolean
  }>) => void
  resultCount: number
}) {
  const toggleCond = (c: string) =>
    setF({ conds: f.conds.includes(c) ? f.conds.filter((x) => x !== c) : [...f.conds, c] })
  const any =
    f.buyItNow || f.auction || f.conds.length > 0 || f.min !== '' || f.max !== '' || f.mineOnly || f.watchedOnly

  return (
    <aside className="bb-rail" aria-label="Refine results">
      <div className="bb-rail-head">
        <b>Refine</b>
        {any && (
          <button
            className="bb-clear"
            onClick={() => setF({ buyItNow: false, auction: false, conds: [], min: '', max: '', mineOnly: false, watchedOnly: false })}
          >
            Clear all
          </button>
        )}
      </div>

      <div className="bb-fgroup">
        <div className="bb-flabel">Buying format</div>
        <label className="bb-check">
          <input type="checkbox" checked={f.buyItNow} onChange={(e) => setF({ buyItNow: e.target.checked })} />
          Buy It Now
        </label>
        <label className="bb-check">
          <input type="checkbox" checked={f.auction} onChange={(e) => setF({ auction: e.target.checked })} />
          Auction
        </label>
        {!f.buyItNow && !f.auction && <div className="bb-fhint">Both shown</div>}
      </div>

      {conds.length > 0 && (
        <div className="bb-fgroup">
          <div className="bb-flabel">Condition</div>
          {conds.map((c) => (
            <label className="bb-check" key={c}>
              <input type="checkbox" checked={f.conds.includes(c)} onChange={() => toggleCond(c)} />
              {c}
            </label>
          ))}
        </div>
      )}

      <div className="bb-fgroup">
        <div className="bb-flabel">Price</div>
        <div className="bb-price-row">
          <input
            type="number"
            min={0}
            step={1}
            placeholder="Min"
            value={f.min}
            onChange={(e) => setF({ min: e.target.value })}
            aria-label="Minimum price"
          />
          <span className="bb-dash">–</span>
          <input
            type="number"
            min={0}
            step={1}
            placeholder="Max"
            value={f.max}
            onChange={(e) => setF({ max: e.target.value })}
            aria-label="Maximum price"
          />
        </div>
      </div>

      <div className="bb-fgroup">
        <div className="bb-flabel">Seller</div>
        <label className="bb-check">
          <input type="checkbox" checked={f.mineOnly} onChange={(e) => setF({ mineOnly: e.target.checked })} />
          Your listings only
        </label>
        <label className="bb-check">
          <input type="checkbox" checked={f.watchedOnly} onChange={(e) => setF({ watchedOnly: e.target.checked })} />
          Watchlist only
        </label>
      </div>

      <div className="bb-fcount">{resultCount} match{resultCount === 1 ? '' : 'es'}</div>
    </aside>
  )
}

// --- result card ------------------------------------------------------------

function ResultCard({
  r,
  watched,
  onOpen,
  onWatch,
  onBuy,
  onBid,
  onCancel,
  onPromote,
  bid,
  setBid,
  promoTicks,
  cash,
}: {
  r: Row
  watched: boolean
  onOpen: () => void
  onWatch: () => void
  onBuy?: () => void
  onBid?: () => void
  onCancel?: () => void
  onPromote?: () => void
  bid: string
  setBid: (v: string) => void
  promoTicks: number
  cash: number
}) {
  const isAuction = r.kind === 'auction'
  const mine = r.kind === 'mine' || r.kind === 'mineAuction'
  const tag = dealTag(r.price, r.market)
  const t = timeLeft(r.closing)
  const promo = r.listing?.promoted_ticks ?? 0
  const canBuy = r.kind === 'buy' && onBuy && r.price * r.qty <= cash

  return (
    <li className={`bb-item ${mine ? 'mine' : ''}`}>
      <div className="bb-thumb" onClick={onOpen} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
        <CardImg src={r.image_small} alt={r.name} className="row-thumb" cardId={r.card_id} />
      </div>

      <div className="bb-info">
        <a className="bb-title" onClick={onOpen}>
          {r.qty > 1 ? `${r.qty}× ` : ''}
          {r.name}
        </a>
        <div className="bb-meta">
          {r.condition && <span className="bb-cond">{r.condition}</span>}
          {r.set_name && <span className="bb-set">{r.set_name}</span>}
          {isAuction && (
            <span className="bb-fmt bb-fmt-auction" title="Bidding — proxy max is escrowed">
              Auction
            </span>
          )}
          {r.kind === 'buy' && <span className="bb-fmt">Buy It Now</span>}
          {r.kind === 'mine' && <span className="bb-fmt bb-fmt-mine">Your listing</span>}
          {r.kind === 'mineAuction' && <span className="bb-fmt bb-fmt-mine">Your auction</span>}
          {promo > 0 && (
            <span className="bb-fmt bb-fmt-promo" title="Promoted: featured placement and 3× views">
              Promoted · {promo} tick{promo === 1 ? '' : 's'}
            </span>
          )}
          {tag && (
            <span className={`bb-tag ${tag.cls}`} title={r.market ? `Market ${fmtUsd(r.market)}` : undefined}>
              {tag.label}
            </span>
          )}
        </div>

        <div className="bb-sellerline">
          Seller: <b>{r.seller}</b>
          {r.views != null && <span className="bb-stat">👁 {r.views}</span>}
          {r.watchers != null && <span className="bb-stat">★ {r.watchers}</span>}
        </div>
      </div>

      <div className="bb-buycol">
        {isAuction ? (
          <>
            <div className="bb-pricelabel">{r.price > 0 ? 'Current bid' : 'Starting bid'}</div>
            <div className="bb-price">{fmtUsd(r.price)}</div>
            <div className="bb-ship">
              {r.npc ? `${r.npc.bid_count} bid${r.npc.bid_count === 1 ? '' : 's'} · next ≥ ${fmtUsd(r.npc.min_next)}` : `${r.own?.bid_count ?? 0} bids`}
            </div>
            {t && <div className={`bb-time ${t.hot ? 'hot' : ''}`}>⏱ {t.text}</div>}
            <div className="bb-bidrow">
              <input
                type="number"
                min={r.npc?.min_next ?? r.price}
                step={0.5}
                placeholder={`max $${Math.max(1, Math.ceil(r.npc?.min_next ?? r.price))}`}
                value={bid}
                onChange={(e) => setBid(e.target.value)}
                aria-label="Your maximum bid"
              />
              <button className="bb-bid" disabled={!(Number(bid) > 0)} onClick={onBid} title="Proxy bid: your max is hidden and escrowed; you pay one increment over the runner-up">
                Place bid
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="bb-pricelabel">{r.kind === 'buy' ? 'Buy It Now' : 'Your ask'}</div>
            <div className="bb-price">{fmtUsd(r.price)}</div>
            <div className="bb-ship">
              {r.qty > 1 ? `lot of ${r.qty} · ${fmtUsd(r.price * r.qty)}` : '+ $1.29 shipping'}
              {r.market > 0 && <> · mkt {fmtUsd(r.market)}</>}
            </div>
            {t && <div className={`bb-time ${t.hot ? 'hot' : ''}`}>⏱ {t.text}</div>}
          </>
        )}

        <div className="bb-actions">
          {canBuy && (
            <button className="bb-cta" onClick={onBuy} title={`Buy now for ${fmtUsd(r.price * r.qty)}`}>
              Buy It Now
            </button>
          )}
          <button className={`bb-watch ${watched ? 'on' : ''}`} onClick={onWatch} title={watched ? 'Stop watching' : 'Add to watchlist'}>
            {watched ? '♥ Watching' : '♡ Watch'}
          </button>
          {mine && r.listing && promo === 0 && onPromote && (
            <button className="bb-mini" onClick={onPromote} title={`Featured placement and 3× views for ${promoTicks} ticks; the fee is non-refundable`}>
              Promote
            </button>
          )}
          {mine && r.listing && r.listing.status === 'live' && onCancel && (
            <button className="bb-mini" onClick={onCancel}>
              End listing
            </button>
          )}
          {mine && r.own && r.own.bid_count === 0 && onCancel && (
            <button className="bb-mini" onClick={onCancel} title="No bids yet — you can still pull the lot">
              Pull
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

// --- item page --------------------------------------------------------------

function ItemPage({
  r,
  watched,
  onBack,
  onWatch,
  onBuy,
  onBid,
  bid,
  setBid,
  feeRate,
  cash,
  fb,
}: {
  r: Row
  watched: boolean
  onBack: () => void
  onWatch: () => void
  onBuy?: () => void
  onBid?: () => void
  bid: string
  setBid: (v: string) => void
  feeRate: number
  cash: number
  fb: { avg: number; count: number }
}) {
  const isAuction = r.kind === 'auction'
  const t = timeLeft(r.closing)
  const tag = dealTag(r.price, r.market)
  const canBuy = r.kind === 'buy' && onBuy && r.price * r.qty <= cash
  const fee = r.price * feeRate

  return (
    <div className="bb-detail">
      <div className="bb-crumb">
        <a onClick={onBack}>BidBay</a> › <a onClick={onBack}>Pokémon TCG</a> › {r.name}
      </div>

      <div className="bb-detail-grid">
        <div className="bb-gallery">
          <CardImg src={r.image_small} alt={r.name} className="bb-hero" cardId={r.card_id} />
          <div className="bb-gallery-note">Hover to zoom · seller photos</div>
        </div>

        <div className="bb-buybox-wrap">
          <h1 className="bb-dtitle">
            {r.qty > 1 ? `${r.qty}× ` : ''}
            {r.name}
          </h1>
          <div className="bb-dsub">
            {r.set_name && <>{r.set_name} · </>}
            {r.condition} condition
            {isAuction && <> · {r.npc?.bid_count ?? r.own?.bid_count ?? 0} bids</>}
            {!isAuction && r.views != null && <> · {r.views} views</>}
            {tag && <span className={`bb-tag ${tag.cls}`}>{tag.label}</span>}
          </div>

          <div className="bb-buybox">
            <div className="bb-bb-row">
              <span className="bb-bb-label">{isAuction ? (r.price > 0 ? 'Current bid' : 'Starting bid') : 'Price'}</span>
              <span className="bb-bb-price">{fmtUsd(r.price)}</span>
            </div>
            <div className="bb-bb-line">
              {isAuction
                ? `${r.npc ? r.npc.bid_count : r.own?.bid_count ?? 0} bids · ${t ? `${t.text} left` : ''}`
                : `+$1.29 shipping · arrives in 1–2 game-days`}
            </div>
            {r.qty > 1 && <div className="bb-bb-line">Lot of {r.qty} — {fmtUsd(r.price * r.qty)} total</div>}

            {isAuction ? (
              <>
                <div className="bb-bb-bid">
                  <input
                    type="number"
                    min={r.npc?.min_next ?? r.price}
                    step={0.5}
                    placeholder={`Your max bid, min $${(r.npc?.min_next ?? r.price).toFixed(2)}`}
                    value={bid}
                    onChange={(e) => setBid(e.target.value)}
                    aria-label="Your maximum bid"
                  />
                  <button className="bb-cta" disabled={!(Number(bid) > 0)} onClick={onBid}>
                    Place bid
                  </button>
                </div>
                <div className="bb-bb-note">
                  Proxy bidding: your maximum is hidden and escrowed. You pay one increment over the runner-up —
                  never your full max.
                  {r.npc && r.npc.leader === 'you' && (
                    <> <b>You lead</b> with ${r.npc.my_escrow.toFixed(2)} escrowed.</>
                  )}
                </div>
              </>
            ) : (
              <>
                {canBuy && (
                  <button className="bb-cta bb-cta-lg" onClick={onBuy}>
                    Buy It Now — {fmtUsd(r.price * r.qty)}
                  </button>
                )}
                {!canBuy && r.kind === 'buy' && (
                  <div className="bb-bb-note">Not enough cash on hand for this lot.</div>
                )}
                <div className="bb-bb-note">
                  BidBay takes {Math.round(feeRate * 100)}% of the sale; the payout lands after the envelope arrives.
                  Your net would be <b>{fmtUsd(Math.max(0, r.price - fee))}</b> per card.
                </div>
              </>
            )}

            <button className={`bb-watch bb-watch-wide ${watched ? 'on' : ''}`} onClick={onWatch}>
              {watched ? '♥ Added to watchlist' : '♡ Add to watchlist'}
            </button>
            <div className="bb-bb-line">🚚 Economy (2 game-days) · 📦 Standard (1) · 🚚 Priority (½)</div>
            <div className="bb-bb-line">Packed from real supplies — photos at pack-out win disputes.</div>
          </div>

          <div className="bb-sellerbox">
            <div className="bb-sb-title">Seller information</div>
            <div className="bb-sb-name">{r.seller}</div>
            <div className="bb-sb-line">NPC seller · stock rotates as the market turns over</div>
            <div className="bb-sb-line">
              Your feedback: ⭐ {fb.avg.toFixed(1)} from {fb.count} sale{fb.count === 1 ? '' : 's'}
            </div>
          </div>

          <div className="bb-specs">
            <div className="bb-specs-title">Item specifics</div>
            <dl>
              <dt>Condition</dt>
              <dd>{r.condition}</dd>
              <dt>Set</dt>
              <dd>{r.set_name ?? '—'}</dd>
              <dt>Quantity</dt>
              <dd>{r.qty}</dd>
              <dt>Market value</dt>
              <dd>{fmtUsd(r.market)}</dd>
              <dt>Format</dt>
              <dd>{isAuction ? 'Auction' : 'Buy It Now'}</dd>
            </dl>
          </div>
        </div>
      </div>

      <button className="bb-back" onClick={onBack}>← Back to results</button>
    </div>
  )
}

// --- the view ---------------------------------------------------------------

export function BidBayView() {
  const { toast, refreshState, state } = useStore()
  const [data, setData] = useState<Awaited<ReturnType<typeof api.ebay>> | null>(null)
  const [market, setMarket] = useState<EbayMarketListing[]>([])
  const [lots, setLots] = useState<EbayAuction[]>([])
  const [recent, setRecent] = useState<EbayAuction[]>([])
  const [npcLots, setNpcLots] = useState<EbayNpcAuction[]>([])
  const [bidMax, setBidMax] = useState<Record<string, string>>({})
  const [watchMax, setWatchMax] = useState<Record<string, string>>({})
  const [collection, setCollection] = useState<{ id: number; label: string; value: number; qty: number }[]>([])
  const [listingId, setListingId] = useState<number | ''>('')
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState(false)

  const [q, setQ] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [cat, setCat] = useState('all')
  const [tab, setTab] = useState<Tab>('browse')
  const [sort, setSort] = useState<Sort>('best')
  const [open, setOpen] = useState<string | null>(null)
  const [f, setFstate] = useState({
    buyItNow: false,
    auction: false,
    conds: [] as string[],
    min: '',
    max: '',
    mineOnly: false,
    watchedOnly: false,
  })
  const setF = (patch: Partial<typeof f>) => setFstate((s) => ({ ...s, ...patch }))

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
    const t5 = setInterval(loadRecent, 8000)
    return () => { clearInterval(t); clearInterval(t2); clearInterval(t3); clearInterval(t4); clearInterval(t5) }
  }, [])

  useEffect(() => {
    api.inventory().then((rows) =>
      setCollection(
        rows
          .filter((r) => r.status === 'collection' && !r.graded_grade)
          .map((r) => ({
            id: r.id as number,
            label: `${r.name} (${r.condition})${(r.quantity as number) > 1 ? ` ×${r.quantity}` : ''}`,
            value: r.value as number,
            qty: r.quantity as number,
          })),
      ),
    ).catch(() => {})
  }, [data])

  // --- unify every source into one result list (this is the eBay part) -----
  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    for (const l of market) {
      out.push({
        key: `m${l.id}`, kind: 'buy', card_id: l.card_id, name: l.name, set_name: l.set_name,
        image_small: l.image_small, condition: l.condition, qty: l.quantity, price: l.ask,
        market: l.market_at_list, seller: l.seller, closing: l.expires_at,
      })
    }
    for (const a of npcLots) {
      out.push({
        key: `n${a.id}`, kind: 'auction', card_id: a.card_id, name: a.name, set_name: a.set_name,
        image_small: a.image_small, condition: a.condition, qty: a.quantity, price: a.current_bid,
        market: a.market_at_list, seller: 'The room', closing: a.closes_at, npc: a,
      })
    }
    for (const l of data?.live ?? []) {
      out.push({
        key: `l${l.id}`, kind: 'mine', card_id: l.card_id, name: l.name, set_name: l.set_name,
        image_small: l.image_small, condition: l.condition, qty: l.quantity, price: l.ask,
        market: l.market_at_list, seller: 'You', views: l.views, watchers: l.watchers,
        listing: l, closing: l.listed_at,
      })
    }
    for (const a of lots) {
      out.push({
        key: `o${a.id}`, kind: 'mineAuction', card_id: a.card_id, name: a.name, set_name: a.set_name,
        image_small: a.image_small, condition: a.condition, qty: a.quantity, price: a.current_bid || a.start,
        market: a.market_at_list, seller: 'You', closing: a.closes_at, own: a,
      })
    }
    return out
  }, [market, npcLots, data, lots])

  const watchedIds = useMemo(() => new Set((data?.watches ?? []).map((w) => w.card_id)), [data])

  const conds = useMemo(() => [...new Set(rows.map((r) => r.condition).filter(Boolean))], [rows])
  // Real categories only: BidBay lists raw singles, so the dropdown offers the
  // sets actually present in the feed rather than invented departments.
  const cats = useMemo(() => [...new Set(rows.map((r) => r.set_name).filter((s): s is string => !!s))].sort(), [rows])

  const filtered = useMemo(() => {
    let out = rows
    const needle = appliedQ.trim().toLowerCase()
    if (needle) {
      out = out.filter((r) =>
        r.name.toLowerCase().includes(needle) || (r.set_name ?? '').toLowerCase().includes(needle),
      )
    }
    if (cat !== 'all') out = out.filter((r) => r.set_name === cat)
    if (f.buyItNow !== f.auction) {
      out = out.filter((r) => (f.buyItNow ? r.kind === 'buy' || r.kind === 'mine' : r.kind === 'auction' || r.kind === 'mineAuction'))
    }
    if (f.conds.length) out = out.filter((r) => f.conds.includes(r.condition))
    if (f.min !== '') out = out.filter((r) => r.price >= Number(f.min))
    if (f.max !== '') out = out.filter((r) => r.price <= Number(f.max))
    if (f.mineOnly) out = out.filter((r) => r.seller === 'You')
    if (f.watchedOnly) out = out.filter((r) => watchedIds.has(r.card_id))

    const s = [...out]
    if (sort === 'price_asc') s.sort((a, b) => a.price - b.price)
    else if (sort === 'price_desc') s.sort((a, b) => b.price - a.price)
    else if (sort === 'ending') s.sort((a, b) => (a.closing ? new Date(a.closing).getTime() : Infinity) - (b.closing ? new Date(b.closing).getTime() : Infinity))
    else if (sort === 'newest') s.sort((a, b) => (b.closing ? new Date(b.closing).getTime() : 0) - (a.closing ? new Date(a.closing).getTime() : 0))
    return s
  }, [rows, appliedQ, cat, f, sort, watchedIds])

  const openRow = open ? rows.find((r) => r.key === open) ?? null : null

  // --- actions (all unchanged mechanics) ---------------------------------
  const list = async () => {
    if (!listingId || !ask) return
    setBusy(true)
    try {
      const r = await api.ebayList(Number(listingId), Number(ask))
      if (r.ok) { toast('Listed on BidBay — the snipers are watching', 'good'); setListingId(''); setAsk(''); refreshState(); load() }
      else toast(r.error ?? 'Listing failed', 'bad')
    } finally { setBusy(false) }
  }
  const cancelListing = async (id: number) => {
    const r = await api.ebayCancel(id)
    if (r.ok) { toast('Listing ended', 'info'); load() } else toast(r.error ?? 'Cancel failed', 'bad')
  }
  const promote = async (id: number) => {
    const r = await api.ebayPromote(id)
    if (r.ok) { toast('Promoted — top of the feed', 'good'); refreshState(); load() } else toast(r.error ?? 'Promotion failed', 'bad')
  }
  const buyMarket = async (l: EbayMarketListing) => {
    const r = await api.ebayMarketBuy(l.id)
    if (r.ok) {
      toast(`Sniped ${l.quantity > 1 ? `${l.quantity}× ` : ''}${l.name} — lands in 1–2 game-days`, 'good')
      refreshState(); load(); loadMarket(); setOpen(null)
    } else toast(r.error ?? 'Buy failed — the deal may be gone', 'bad')
  }
  const startAuction = async (id: number) => {
    const r = await api.ebayAuctionStart(id)
    if (r.ok) { toast(`On the block — opening $${r.start?.toFixed(2)}. The room is warming up…`, 'good'); refreshState(); load(); loadLots() }
    else toast(r.error ?? 'Auction failed', 'bad')
  }
  const cancelLot = async (id: number) => {
    const r = await api.ebayAuctionCancel(id)
    if (r.ok) { toast('Pulled from the block', 'info'); loadLots() } else toast(r.error ?? 'Cancel failed', 'bad')
  }
  const placeBid = async (a: EbayNpcAuction) => {
    const key = `n${a.id}`
    const raw = bidMax[key]
    const max = Number(raw)
    if (!raw || !(max > 0)) { toast('Enter your maximum bid', 'bad'); return }
    const r = await api.ebayNpcBid(a.id, max)
    if (r.ok) { toast(r.message ?? 'Bid placed', 'good'); setBidMax((m) => ({ ...m, [key]: '' })); refreshState(); loadNpcLots() }
    else toast(r.error ?? 'Bid failed', 'bad')
  }
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
    if (r.ok) {
      toast(capped ? `Cap set — ping only at $${capped.toFixed(2)} or less` : 'Cap cleared — ping on any listing', 'info')
      setWatchMax((m) => ({ ...m, [cardId]: '' })); load()
    }
  }

  const selected = collection.find((c) => c.id === listingId) ?? null
  const listedIds = useMemo(() => new Set((data?.live ?? []).map((l) => l.inventory_id)), [data])
  const askNum = Number(ask)
  const feeRate = data?.feeRate ?? 0.13

  const findSource = (r: Row) => {
    if (r.kind === 'buy') return market.find((m) => `m${m.id}` === r.key) ?? null
    if (r.kind === 'auction') return r.npc
    return null
  }

  const renderRow = (r: Row) => (
    <ResultCard
      key={r.key}
      r={r}
      watched={watchedIds.has(r.card_id)}
      cash={state?.cash ?? 0}
      promoTicks={data?.promoRate.ticks ?? 20}
      bid={bidMax[r.key] ?? ''}
      setBid={(v) => setBidMax((m) => ({ ...m, [r.key]: v }))}
      onOpen={() => setOpen(r.key)}
      onWatch={() => toggleWatch(r.card_id, r.name)}
      onBuy={r.kind === 'buy' ? () => { const m = findSource(r) as EbayMarketListing | undefined; if (m) buyMarket(m) } : undefined}
      onBid={r.kind === 'auction' && r.npc ? () => placeBid(r.npc!) : undefined}
      onCancel={
        r.kind === 'mine' && r.listing
          ? () => cancelListing(r.listing!.id)
          : r.kind === 'mineAuction' && r.own
            ? () => cancelLot(r.own!.id)
            : undefined
      }
      onPromote={r.kind === 'mine' && r.listing ? () => promote(r.listing!.id) : undefined}
    />
  )

  return (
    <div className="bb">
      <Chrome
        q={q}
        setQ={setQ}
        cat={cat}
        setCat={setCat}
        cats={cats}
        tab={tab}
        setTab={setTab}
        watchCount={data?.watches.length ?? 0}
        sellCount={(data?.live.length ?? 0) + lots.length}
        fb={data?.feedback ?? { avg: 0, count: 0 }}
        onSearch={() => { setAppliedQ(q); setTab('browse'); setOpen(null) }}
      />

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

      {openRow ? (
        <ItemPage
          r={openRow}
          watched={watchedIds.has(openRow.card_id)}
          feeRate={feeRate}
          cash={state?.cash ?? 0}
          bid={bidMax[openRow.key] ?? ''}
          setBid={(v) => setBidMax((m) => ({ ...m, [openRow.key]: v }))}
          fb={data?.feedback ?? { avg: 0, count: 0 }}
          onBack={() => setOpen(null)}
          onWatch={() => toggleWatch(openRow.card_id, openRow.name)}
          onBuy={
            openRow.kind === 'buy'
              ? () => { const m = findSource(openRow) as EbayMarketListing | undefined; if (m) buyMarket(m) }
              : undefined
          }
          onBid={openRow.kind === 'auction' && openRow.npc ? () => placeBid(openRow.npc!) : undefined}
        />
      ) : (
        <div className="bb-body">
          <Rail
            conds={conds}
            f={f}
            setF={setF}
            resultCount={filtered.length}
          />

          <main className="bb-main">
            <div className="bb-tabs" role="tablist">
              {(
                [
                  ['browse', 'Browse'],
                  ['selling', `Selling (${(data?.live.length ?? 0) + lots.length})`],
                  ['watching', `Watchlist (${data?.watches.length ?? 0})`],
                  ['shipping', `To ship (${(data?.sold ?? []).filter((s) => s.paid === 0).length})`],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  className={`bb-tab ${tab === id ? 'on' : ''}`}
                  onClick={() => { setTab(id); setOpen(null) }}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'browse' && (
              <>
                <div className="bb-toolbar">
                  <div className="bb-count">
                    <b>{filtered.length.toLocaleString()}</b> results{appliedQ && <> for “{appliedQ}”</>}
                  </div>
                  <label className="bb-sort">
                    <span className="faint small">Sort by</span>
                    <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                      {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </label>
                </div>

                {filtered.length === 0 ? (
                  <div className="bb-empty">
                    <div style={{ fontSize: 34 }}>🔍</div>
                    <div>No results</div>
                    <div className="small faint" style={{ marginTop: 4 }}>
                      Try fewer filters — the hunt feed rotates, so new stock shows up as the market turns over.
                    </div>
                    <button
                      className="primary"
                      style={{ marginTop: 14 }}
                      onClick={() => {
                        setAppliedQ(''); setQ(''); setCat('all')
                        setF({ buyItNow: false, auction: false, conds: [], min: '', max: '', mineOnly: false, watchedOnly: false })
                      }}
                    >
                      Clear search & filters
                    </button>
                  </div>
                ) : (
                  <ul className="bb-list">{filtered.map(renderRow)}</ul>
                )}
              </>
            )}

            {tab === 'selling' && (
              <div className="bb-panel">
                <div className="bb-sell">
                  <b>List an item</b>
                  <select
                    value={listingId}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : ''
                      setListingId(id)
                      const sel = collection.find((c) => c.id === id)
                      if (sel) setAsk(sel.value.toFixed(2))
                    }}
                  >
                    <option value="">Choose from your collection…</option>
                    {collection
                      .filter((c) => !listedIds.has(c.id))
                      .map((c) => <option key={c.id} value={c.id}>{c.label} — mkt {fmtUsd(c.value)}</option>)}
                  </select>
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    placeholder="Your price"
                    value={ask}
                    onChange={(e) => setAsk(e.target.value)}
                  />
                  <button className="bb-cta" disabled={!listingId || !ask || busy} onClick={list}>
                    {busy ? '…' : 'List it'}
                  </button>
                  <button className="bb-mini" disabled={!listingId || !ask} onClick={() => listingId && startAuction(listingId)} title="Opening bid at 25–45% of market; the room bids it up; 15% house fee">
                    or Start an auction
                  </button>
                </div>
                {selected && askNum > 0 && (
                  <div className="bb-sellnote">
                    market {fmtUsd(selected.value)} · fee −{fmtUsd(askNum * feeRate)} · ship −{fmtUsd(1 + askNum * 0.04)} → net{' '}
                    <b>{fmtUsd(Math.max(0, askNum * selected.qty - askNum * feeRate * selected.qty - (1 + askNum * 0.04)))}</b> for{' '}
                    {selected.qty > 1 ? `${selected.qty} cards` : 'one card'}
                  </div>
                )}

                <div className="bb-subhead">Your active listings</div>
                {(data?.live.length ?? 0) === 0 && lots.length === 0 ? (
                  <div className="faint small">Nothing listed. Your shop's walk-ins thank you.</div>
                ) : (
                  <ul className="bb-list">
                    {rows.filter((r) => r.kind === 'mine' || r.kind === 'mineAuction').map(renderRow)}
                  </ul>
                )}
              </div>
            )}

            {tab === 'watching' && (
              <div className="bb-panel">
                {(data?.watches.length ?? 0) === 0 ? (
                  <div className="bb-empty">
                    <div style={{ fontSize: 34 }}>♡</div>
                    <div>Nothing on your watchlist</div>
                    <div className="small faint" style={{ marginTop: 4 }}>
                      Hit Watch on any result and BidBay pings your feed the moment it surfaces — set a cap to only
                      hear about deals.
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="bb-subhead">Watching {(data?.watches.length ?? 0)} card{(data?.watches.length ?? 0) === 1 ? '' : 's'}</div>
                    <ul className="bb-list">
                      {(data?.watches ?? []).map((w) => (
                        <li className="bb-item" key={w.id}>
                          <div className="bb-thumb">
                            <CardImg src={w.image_small} alt={w.name} className="row-thumb" cardId={w.card_id} />
                          </div>
                          <div className="bb-info">
                            <span className="bb-title">{w.name}</span>
                            <div className="bb-meta">{w.set_name && <span className="bb-set">{w.set_name}</span>}</div>
                            <div className="bb-sellerline">
                              {w.max_price != null ? (
                                <>pings at <b style={{ color: 'var(--gold)' }}>{fmtUsd(w.max_price)}</b> or less</>
                              ) : (
                                'pings on any listing'
                              )}
                            </div>
                          </div>
                          <div className="bb-buycol">
                            <div className="bb-bidrow">
                              <input
                                type="number"
                                min={0.5}
                                step={0.5}
                                placeholder="max $ (any)"
                                value={watchMax[w.card_id] ?? ''}
                                onChange={(e) => setWatchMax((m) => ({ ...m, [w.card_id]: e.target.value }))}
                                aria-label="Price cap"
                              />
                              <button className="bb-mini" onClick={() => saveWatchMax(w.card_id)} title="Ping only when a new listing appears at or under this price">
                                Set cap
                              </button>
                            </div>
                            <button className="bb-watch on" onClick={() => toggleWatch(w.card_id, w.name)}>
                              ♥ Stop watching
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {tab === 'shipping' && (
              <div className="bb-panel">
                <div className="bb-subhead">Sold & waiting to ship</div>
                {(data?.sold.length ?? 0) === 0 ? (
                  <div className="faint small">Nothing to ship — sales land here once a buyer pays.</div>
                ) : (
                  <ul className="bb-list">
                    {(data?.sold ?? []).map((l) => (
                      <li className="bb-item" key={l.id}>
                        <div className="bb-thumb">
                          <CardImg src={l.image_small} alt={l.name} className="row-thumb" cardId={l.card_id} />
                        </div>
                        <div className="bb-info">
                          <span className="bb-title">{l.quantity > 1 ? `${l.quantity}× ` : ''}{l.name}</span>
                          <div className="bb-meta"><span className="bb-fmt">Sold</span></div>
                          <div className="bb-sellerline">
                            buyer <b>{l.buyer}</b> · sold @ {fmtUsd(l.sold_price ?? 0)}/ea · fee −{fmtUsd(l.fee ?? 0)} · ship −{fmtUsd(l.shipping ?? 0)}
                          </div>
                        </div>
                        <div className="bb-buycol">
                          <div className="bb-pricelabel">Net</div>
                          <div className="bb-price">{fmtUsd(l.net ?? 0)}</div>
                          <div className="bb-ship">
                            {l.paid === 0
                              ? l.ships_at && new Date(l.ships_at).getTime() > Date.now()
                                ? `ships in ${Math.max(1, Math.ceil((new Date(l.ships_at).getTime() - Date.now()) / 60000))}m`
                                : 'arriving…'
                              : 'paid out'}
                          </div>
                          {l.paid === 0 ? <span className="bb-fmt">Awaiting shipment</span> : <span className="bb-fmt bb-fmt-mine">Paid out</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <ShipSection />
              </div>
            )}

            {(recent.length > 0 || (data?.sold.length ?? 0) > 0) && tab === 'browse' && (
              <div className="bb-foot">
                Lifetime fees paid: {data ? fmtUsd(data.feesPaid) : '—'} · shipping: {data ? fmtUsd(data.shippingPaid) : '—'} ·
                fee rate {Math.round(feeRate * 100)}%
                {recent.length > 0 && (
                  <> · last hammer: {recent[0].status === 'sold'
                    ? `${recent[0].name} at ${fmtUsd(recent[0].current_bid)}`
                    : `${recent[0].name} expired unsold`}</>
                )}
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  )
}
