import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { MarketRegimes, MarketScene, MarketSeasonal } from '../api'
import { useStore } from '../store'
import { CardImg, ConditionBadge, DensityToggle, EmptyState, fmtUsd, OverflowHint } from '../components'
import type { ListingRow } from '../types'

const PHASE_META: Record<MarketRegimes['phase'], { icon: string; label: string; color: string; note: string }> = {
  bull: { icon: '🐂', label: 'BULL', color: '#1a7f37', note: 'Sellers emboldened — your inventory is ripening.' },
  bear: { icon: '🐻', label: 'BEAR', color: '#b35900', note: 'Wallets closed — a buying season, not a selling one.' },
  chop: { icon: '↔️', label: 'CHOP', color: '#57606a', note: 'No direction — pickers hunt misprices, deals go fast.' },
}

function dealBadge(delta: number) {
  if (delta <= -0.1) return <span className="badge below">🔥 BELOW MARKET</span>
  if (delta <= -0.02) return <span className="badge below">Under market</span>
  if (delta < 0.08) return <span className="badge at">At market</span>
  return <span className="badge above">Above market</span>
}

/** Deal-quality trust line — names the anchor so the comparison is explicit.
 *  "priced vs LP" under a badge means the delta compares the ask against this
 *  condition's own market, not NM; the tooltip adds where that anchor came
 *  from (live TCGplayer, PriceCharting, simulated…). Badges without an anchor
 *  (graded lots anchor to their PSA price) stay as-is. */
function TrustLine({ cond, anchorKind }: { cond?: string; anchorKind?: string | null }) {
  if (!cond) return null
  const kindLabel: Record<string, string> = {
    tcgplayer: 'live TCGplayer market',
    pricecharting: 'PriceCharting',
    ebay: 'eBay comps',
    cardmarket: 'Cardmarket trend',
    simulated: 'the simulated market',
    model: 'a comparable-based estimate',
    estimated: 'an estimate',
    'pc-graded': 'real PSA comps',
  }
  const src = anchorKind ? kindLabel[anchorKind] ?? anchorKind : null
  return (
    <div
      className="faint"
      style={{ fontSize: 10, lineHeight: '13px', marginTop: -2 }}
      title={src ? `The ${cond} anchor comes from ${src}.` : `Anchored against ${cond} market value.`}
    >
      priced vs {cond}
    </div>
  )
}

export function MarketView() {
  const { toast, refreshState, openCard, density } = useStore()
  const [listings, setListings] = useState<ListingRow[]>([])
  const [q, setQ] = useState('')
  const [onlyDeals, setOnlyDeals] = useState(false)
  const [regime, setRegime] = useState<MarketRegimes | null>(null)
  const [seasonal, setSeasonal] = useState<MarketSeasonal | null>(null)
  const [scene, setScene] = useState<MarketScene | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    api.marketRegimes().then(setRegime).catch(() => {})
    api.marketSeasonal().then(setSeasonal).catch(() => {})
    api.marketScene().then(setScene).catch(() => {})
  }, [])

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

      {regime && (() => {
        const meta = PHASE_META[regime.phase]
        const driftPct = Math.round((regime.drift - 1) * 100)
        return (
          <div className="panel" style={{ margin: '0 0 12px', padding: '10px 14px', borderLeft: `4px solid ${meta.color}` }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, color: meta.color }}>{meta.icon} {meta.label} MARKET</span>
              <span className="small muted">~{regime.daysLeft}d left in the regime · board {driftPct >= 0 ? '+' : ''}{driftPct}% from baseline · {meta.note}</span>
            </div>
            {regime.shocks.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {regime.shocks.map((s) => {
                  const recovering = Math.round(s.severity * (1 - s.ageDays / 21) * 100)
                  return (
                    <div key={s.card_id} className="small" style={{ cursor: 'pointer' }} onClick={() => openCard(s.card_id)} title="Open the card">
                      📰 <b>{s.name}</b> — reprint announced{s.ageDays > 0 ? ` ${s.ageDays}d ago` : ' today'} · down {Math.round(s.severity * 100)}%{s.ageDays > 0 ? `, ${recovering}% off and recovering` : ''}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {scene && (() => {
        // Population & meta drift — only show the strip when the scene has
        // actually moved (a live boom, or any era taste ≥4% off neutral).
        const pct = (v: number) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`
        const moved = Math.abs(scene.population.vintage - 1) >= 0.04 || Math.abs(scene.population.mid - 1) >= 0.04 || Math.abs(scene.population.modern - 1) >= 0.04
        if (scene.booms.length === 0 && !moved) return null
        const arrow = (t: number) => (t > 0.005 ? ' ↑' : t < -0.005 ? ' ↓' : '')
        const setLine = (list: MarketScene['hottest']) => list.slice(0, 3).map((s) => `${s.name} ${pct(s.demand)}${arrow(s.trend)}`).join(' · ')
        return (
          <div className="panel" style={{ margin: '0 0 12px', padding: '10px 14px', borderLeft: '4px solid #8a63d2' }}>
            {scene.booms.map((b) => (
              <div key={b.id} className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                <span style={{ fontWeight: 800, color: '#8a63d2' }}>🌟 META</span>
                <span className="small"><b>{b.headline}</b> — {b.blurb}</span>
                <span className="small muted">+{Math.round((b.mult - 1) * 100)}% {b.era === 'all' ? 'hobby-wide' : b.era} chase at peak · ~{b.daysLeft}d left</span>
              </div>
            ))}
            <div className="row small faint" style={{ gap: 12, flexWrap: 'wrap' }}>
              <span>🏛 vintage {pct(scene.population.vintage)}{scene.population.vintage > 1.03 ? ' · supply thinning — the old guard holds' : ''}</span>
              <span>📼 mid {pct(scene.population.mid)}</span>
              <span>✨ modern {pct(scene.population.modern)}</span>
              {scene.hottest.length > 0 && <span style={{ marginLeft: 'auto' }}>🔥 hottest demand: {setLine(scene.hottest)}</span>}
            </div>
            {scene.coldest.length > 0 && (
              <div className="row small faint" style={{ gap: 12, marginTop: 2 }}>
                <span>❄️ coolest: {setLine(scene.coldest)}</span>
                <span>set demand drifts on two collector cohorts — chase hunters and set builders, each on their own rhythm</span>
              </div>
            )}
          </div>
        )
      })()}

      {seasonal && seasonal.event && (() => {
        const ev = seasonal.event
        const pct = (n: number) => `${n >= 1 ? '+' : ''}${Math.round((n - 1) * 100)}%`
        const tone = ev.mult.price >= 1 ? '#d4a017' : '#5b8def'
        return (
          <div className="panel" style={{ margin: '0 0 12px', padding: '10px 14px', borderLeft: `4px solid ${tone}` }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, color: tone }}>{ev.icon} {ev.name.toUpperCase()}</span>
              <span className="small muted">{ev.blurb}</span>
            </div>
            <div className="row small faint" style={{ gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
              <span>🛒 foot traffic {pct(ev.mult.walkIn)}</span>
              <span>🏷️ prices {pct(ev.mult.price)}</span>
              <span>🎪 show crowds {pct(ev.mult.crowd)}</span>
              <span>🎁 impulse buys {pct(ev.mult.pack)}</span>
              <span style={{ marginLeft: 'auto' }}>~{ev.daysLeft}d left — ends {new Date(new Date(ev.endsAt).getTime() - 86_400_000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </div>
          </div>
        )
      })()}
      {seasonal && !seasonal.event && seasonal.next && (
        <div className="small faint" style={{ margin: '0 0 10px' }}>
          {seasonal.next.icon} Next on the hobby calendar: <b>{seasonal.next.name}</b> in {seasonal.next.startsInDays}d
        </div>
      )}

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
                  <CardImg src={l.image_small} alt={l.name} cardId={l.card_id} />
                </div>
                <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</b>
                    <div style={{ textAlign: 'right' }}>
                      {dealBadge(l.delta)}
                      <TrustLine cond={l.condition} anchorKind={l.market?.kind} />
                    </div>
                  </div>
                  <div className="small muted">{l.set_name} · {l.rarity ?? ''}</div>
                  <div className="row" style={{ gap: 6 }}>
                    <ConditionBadge cond={l.condition} />
                    {density !== 'compact' && <span className="faint small">by {l.seller_name} · ★{l.seller_rating.toFixed(1)} ({l.seller_sales.toLocaleString()} sales)</span>}
                  </div>
                  <div className="small">
                    Listing {fmtUsd(l.price)} + ship {fmtUsd(l.shipping)}
                    {density !== 'compact' && <> · ETA {l.eta_days} game-day{l.eta_days === 1 ? '' : 's'}</>}
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', marginTop: 'auto', alignItems: 'flex-end' }}>
                    <div>
                      <span className="faint small">Market {fmtUsd(l.market.usd)}</span>
                      <div style={{ fontWeight: 750 }}>{fmtUsd(l.total)} <span className="faint small">total</span></div>
                      <OverflowHint count={1} align="left" />
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
