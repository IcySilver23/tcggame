import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { CardImg, ConditionBadge, DensityToggle, EmptyState, fmtUsd } from '../components'
import type { ListingRow } from '../types'

function dealBadge(delta: number) {
  if (delta <= -0.1) return <span className="badge below">🔥 BELOW MARKET</span>
  if (delta <= -0.02) return <span className="badge below">Under market</span>
  if (delta < 0.08) return <span className="badge at">At market</span>
  return <span className="badge above">Above market</span>
}

export function MarketView() {
  const { toast, refreshState, openCard, density } = useStore()
  const [listings, setListings] = useState<ListingRow[]>([])
  const [q, setQ] = useState('')
  const [onlyDeals, setOnlyDeals] = useState(false)
  const timer = useRef<number | null>(null)

  const load = useCallback(async (query: string) => {
    try { setListings(await api.marketListings({ q: query })) } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(q), 200)
    return () => clearTimeout(t)
  }, [q, load])

  useEffect(() => {
    // Listings refresh so expirations/NPC purchases create urgency
    timer.current = window.setInterval(() => load(q), 25000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [q, load])

  const shown = onlyDeals ? listings.filter((l) => l.delta <= -0.02) : listings

  const buy = async (l: ListingRow) => {
    try {
      const r = await api.buyListing(l.id)
      toast(r.message, 'good')
      refreshState()
      setListings((ls) => ls.filter((x) => x.id !== l.id))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Purchase failed', 'bad')
      load(q)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Marketplace</h1>
          <div className="sub">Simulated seller feed anchored to real TCGplayer market prices. Good deals get sniped — move fast.</div>
        </div>
        <div className="chip-row">
          <span className={`chip ${onlyDeals ? 'on' : ''}`} onClick={() => setOnlyDeals(!onlyDeals)}>🔥 Deals only</span>
          <button className="small" onClick={() => load(q)}>Refresh</button>
        </div>
      </div>

      <div className="filter-row">
        <input type="search" placeholder="Search the marketplace (e.g. Charizard)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="faint small">{shown.length} listings</span>
        <div style={{ marginLeft: 'auto' }}><DensityToggle /></div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="🔍" text="No listings right now" sub="The feed refills continuously — check back." />
      ) : (
        <div className={`grid ${density === 'compact' ? 'cols3' : 'cols2'}`}>
          {shown.map((l) => (
            <div key={l.id} className="panel" style={{ margin: 0 }}>
              <div className="row" style={{ alignItems: 'stretch' }}>
                <div style={{ width: density === 'compact' ? 64 : 96, cursor: 'pointer' }} onClick={() => openCard(l.card_id)}>
                  <CardImg src={l.image_small} alt={l.name} />
                </div>
                <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</b>
                    {dealBadge(l.delta)}
                  </div>
                  <div className="small muted">{l.set_name} · {l.rarity ?? ''}</div>
                  <div className="row" style={{ gap: 6 }}>
                    <ConditionBadge cond={l.condition} />
                    {density !== 'compact' && <span className="faint small">by {l.seller_name} · ★{l.seller_rating.toFixed(1)} ({l.seller_sales.toLocaleString()} sales)</span>}
                  </div>
                  <div className="small">
                    Listing {fmtUsd(l.price)} + ship {fmtUsd(l.shipping)}
                    {density !== 'compact' && <> · ETA {l.eta_days}d</>}
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', marginTop: 'auto' }}>
                    <div>
                      <span className="faint small">Market {fmtUsd(l.market.usd)}</span>
                      <div style={{ fontWeight: 750 }}>{fmtUsd(l.total)} <span className="faint small">total</span></div>
                    </div>
                    <button className="primary" onClick={() => buy(l)}>BUY</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
