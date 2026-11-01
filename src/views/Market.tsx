import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { MarketRegimes, MarketScene, MarketSeasonal } from '../api'
import { useStore } from '../store'
import { CardImg, ConditionBadge, DensityToggle, EmptyState, fmtUsd, OverflowHint, SortSelect } from '../components'
import type { ListingRow } from '../types'

// ---------------------------------------------------------------------------
// ⇄ Marketplace — the price desk (roadmap problem #1: no two venues share a shape).
//
// BidBay is the eBay storefront: rival listings, timers, you undercut them.
// Local Deals is Facebook Marketplace: square tiles, a stranger, a car park.
// This screen is deliberately neither. Its OBJECT is the quote, not the
// listing: one line per card *and condition*, carrying the market anchor, the
// cheapest live ask, the spread between them and a ladder of the sellers under
// it. You don't browse a feed here — you price a card, and buy the cheapest ask
// in one click because there is nothing to negotiate and no clock to beat.
//
// The depth is the spread and the seller ladder (a −14% ask from a ★4.2 seller
// on a 3-day ETA is a different decision from the same number from a nobody),
// which is knowledge no other venue gives you: BidBay hides it behind an
// auction, Local hides it behind a meet-up.
// ---------------------------------------------------------------------------

const PHASE_META: Record<MarketRegimes['phase'], { icon: string; label: string; color: string; note: string }> = {
  bull: { icon: '🐂', label: 'BULL', color: '#1a7f37', note: 'Sellers emboldened — your inventory is ripening.' },
  bear: { icon: '🐻', label: 'BEAR', color: '#b35900', note: 'Wallets closed — a buying season, not a selling one.' },
  chop: { icon: '↔️', label: 'CHOP', color: '#57606a', note: 'No direction — pickers hunt misprices, deals go fast.' },
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
      style={{ fontSize: 10, lineHeight: '13px' }}
      title={src ? `The ${cond} anchor comes from ${src}.` : `Anchored against ${cond} market value.`}
    >
      priced vs {cond}
    </div>
  )
}

/** How far under the anchor a card's cheapest ask has to be before it gets a name. */
type Verdict = 'steal' | 'deal' | 'under' | 'at' | 'over'
function verdictOf(delta: number): Verdict {
  if (delta <= -0.15) return 'steal'
  if (delta <= -0.05) return 'deal'
  if (delta <= -0.02) return 'under'
  if (delta < 0.08) return 'at'
  return 'over'
}
const VERDICT_LABEL: Record<Verdict, string> = { steal: 'STEAL', deal: 'DEAL', under: 'UNDER', at: 'AT', over: 'OVER' }

/** The detectable bands the desk can be tuned to. */
const BANDS: { min: number; label: string }[] = [
  { min: 0, label: 'Everything' },
  { min: 0.02, label: '≥2% under' },
  { min: 0.05, label: '≥5% under' },
  { min: 0.1, label: '≥10% under' },
  { min: 0.2, label: '≥20% under' },
]

/** One card+condition line: the quote. */
type Quote = {
  key: string
  cardId: string
  name: string
  image: string | null
  setName: string | null
  rarity: string | null
  condition: string
  /** Market anchor for this exact condition — null when nothing is published. */
  market: number | null
  anchorKind: string | null
  /** Cheapest ask, and every seller offering this card in this condition. */
  asks: ListingRow[]
  best: ListingRow
  /** Cheapest ask vs the anchor (the server's condition-aware delta). */
  spread: number
  sellers: number
}

export function MarketView() {
  const { toast, refreshState, openCard, density } = useStore()
  const [listings, setListings] = useState<ListingRow[]>([])
  const [q, setQ] = useState('')
  const [band, setBand] = useState(0)
  const [sort, setSort] = useState<'spread' | 'ask' | 'sellers'>('spread')
  const [regime, setRegime] = useState<MarketRegimes | null>(null)
  const [seasonal, setSeasonal] = useState<MarketSeasonal | null>(null)
  const [scene, setScene] = useState<MarketScene | null>(null)
  const [sweptAt, setSweptAt] = useState<number>(() => Date.now())
  const timer = useRef<number | null>(null)

  useEffect(() => {
    api.marketRegimes().then(setRegime).catch(() => {})
    api.marketSeasonal().then(setSeasonal).catch(() => {})
    api.marketScene().then(setScene).catch(() => {})
  }, [])

  const load = useCallback(async (query: string) => {
    try {
      setListings(await api.marketListings({ q: query }))
      setSweptAt(Date.now())
    } catch { /* keep the last sweep on screen rather than blanking it */ }
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

  // COLLAPSE THE FEED INTO QUOTES. A listing is a seller's opinion; the quote
  // is what the card costs right now. Grouping by card+condition is the whole
  // difference between this screen and BidBay's result list.
  const quotes = useMemo(() => {
    const byCard = new Map<string, ListingRow[]>()
    for (const l of listings) {
      const key = `${l.card_id}|${l.condition}`
      const bucket = byCard.get(key)
      if (bucket) bucket.push(l)
      else byCard.set(key, [l])
    }
    const out: Quote[] = []
    for (const [key, raw] of byCard) {
      const asks = [...raw].sort((a, b) => a.total - b.total)
      const best = asks[0]
      out.push({
        key,
        cardId: best.card_id,
        name: best.name,
        image: best.image_small,
        setName: best.set_name ?? null,
        rarity: best.rarity,
        condition: best.condition,
        market: best.market?.usd ?? null,
        anchorKind: best.market?.kind ?? null,
        asks,
        best,
        spread: best.delta,
        sellers: new Set(asks.map((a) => a.seller_name)).size,
      })
    }
    return out
  }, [listings])

  // What the sweep found, in the terms a price desk thinks in: cards, asks,
  // how many cards sit under their anchor, the best spread and the median one.
  const radar = useMemo(() => {
    const spreads = quotes.map((c) => c.spread).filter((d) => Number.isFinite(d)).sort((a, b) => a - b)
    const at = (p: number) => (spreads.length ? spreads[Math.min(spreads.length - 1, Math.floor(spreads.length * p))] : 0)
    return {
      cards: quotes.length,
      asks: listings.length,
      under: spreads.filter((d) => d <= -0.02).length,
      steals: spreads.filter((d) => d <= -0.15).length,
      best: spreads.length ? spreads[0] : 0,
      median: at(0.5),
    }
  }, [quotes, listings])

  const shown = useMemo(() => {
    const cutoff = band === 0 ? Infinity : -band
    const rows = quotes.filter((c) => c.spread <= cutoff)
    const sorted = [...rows]
    if (sort === 'ask') sorted.sort((a, b) => a.best.total - b.best.total)
    else if (sort === 'sellers') sorted.sort((a, b) => b.sellers - a.sellers)
    else sorted.sort((a, b) => a.spread - b.spread)
    return sorted
  }, [quotes, band, sort])

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
          <div className="sub">
            The reference desk: what a card is <b>actually worth</b>, and who is selling under it. One line per card and
            condition — the anchor, the cheapest ask, the spread. No haggling, no clock: you pay the ask and it ships.
          </div>
        </div>
        <div className="chip-row">
          <button className="small" onClick={() => load(q)}>Re-price the board</button>
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

      {/* The desk head: what the sweep found, before a single card is read. */}
      <div className="radar-head">
        <div className="radar-scope" aria-hidden>
          <span className="radar-ring" />
          <span className="radar-ring inner" />
          <span className="radar-sweep" />
          <span className="radar-blip" />
        </div>
        <div className="radar-stats">
          <div><div className="faint small">CARDS QUOTED</div><div className="radar-num">{radar.cards}</div></div>
          <div><div className="faint small">ASKS SCANNED</div><div className="radar-num">{radar.asks}</div></div>
          <div><div className="faint small">BELOW ANCHOR</div><div className="radar-num" style={{ color: 'var(--green)' }}>{radar.under}</div></div>
          <div><div className="faint small">STEALS ≤15%</div><div className="radar-num" style={{ color: 'var(--yellow)' }}>{radar.steals}</div></div>
          <div><div className="faint small">BEST SPREAD</div><div className="radar-num" style={{ color: 'var(--green)' }}>{Math.round(radar.best * 100)}%</div></div>
          <div><div className="faint small">MEDIAN SPREAD</div><div className="radar-num">{radar.median > 0 ? '+' : ''}{Math.round(radar.median * 100)}%</div></div>
        </div>
        <div className="radar-copy small">
          Each quote compares the cheapest ask against that card's <b>own condition</b> anchor, never NM — an LP at −12%
          is a real discount. BidBay is where sellers undercut each other; this is where you learn the number first.
          <div className="faint" style={{ marginTop: 3 }}>last sweep {new Date(sweptAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · re-prices every 25s</div>
          {/* An empty scan is a finding, not a failure: say the board is priced
              high instead of leaving six zeroes to be interpreted. */}
          {radar.cards > 0 && radar.under === 0 && (
            <div style={{ marginTop: 3, color: 'var(--amber)' }}>
              No quote sits under its anchor this sweep — every ask is at or above market. The list still ranks the
              least-bad quotes, and the band chips fill in as sellers list.
            </div>
          )}
        </div>
      </div>

      <div className="filter-row">
        <input type="search" placeholder="Price a card (e.g. Charizard)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chip-row">
          {BANDS.map((b) => (
            <span key={b.min} className={`chip ${band === b.min ? 'on' : ''}`} onClick={() => setBand(b.min)}>{b.label}</span>
          ))}
        </div>
        <SortSelect
          value={sort}
          onChange={(v) => setSort(v as 'spread' | 'ask' | 'sellers')}
          options={[
            { value: 'spread', label: 'Sort: Biggest spread' },
            { value: 'ask', label: 'Sort: Cheapest ask' },
            { value: 'sellers', label: 'Sort: Most sellers' },
          ]}
        />
        <span className="faint small">{shown.length} quotes</span>
        <div style={{ marginLeft: 'auto' }}><DensityToggle /></div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon="📋"
          text={band === 0 ? 'No quotes on the board' : `No card is ${Math.round(band * 100)}% under its anchor`}
          sub={band === 0 ? 'The feed refills continuously — re-price the board in a moment.' : 'Widen the band, or wait for the next sweep — sellers list under the anchor as stock turns over.'}
        />
      ) : (
        <div className={`radar-list density-${density}`}>
          {shown.map((c) => {
            const v = verdictOf(c.spread)
            const pct = Math.round(c.spread * 100)
            const save = c.market == null ? null : c.market - c.best.total
            return (
              <div key={c.key} className={`radar-row quote-row ${v}`}>
                <div className="radar-thumb" onClick={() => openCard(c.cardId)}>
                  <CardImg src={c.image} alt={c.name} cardId={c.cardId} />
                </div>
                <div className="radar-main">
                  <div className="radar-title">
                    <b className="radar-name" onClick={() => openCard(c.cardId)}>{c.name}</b>
                    <ConditionBadge cond={c.condition} />
                    <span className={`badge ${v === 'steal' ? 'warn' : v === 'over' ? 'above' : v === 'at' ? 'at' : 'below'}`}>{VERDICT_LABEL[v]}</span>
                    <span className="quote-sellers" title="Distinct sellers offering this card in this condition">
                      {c.sellers} seller{c.sellers === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="small muted radar-sub">{c.setName ?? '—'}{c.rarity ? ` · ${c.rarity}` : ''}</div>
                  {/* The ladder: what the sellers under the anchor are asking,
                      best first. This is the depth BidBay's list can't show. */}
                  <div className="quote-ladder">
                    {c.asks.slice(0, 3).map((a, i) => (
                      <span key={a.id} className={i === 0 ? 'best' : ''} title={`Listing ${fmtUsd(a.price)} + ${fmtUsd(a.shipping)} shipping · ETA ${a.eta_days} game-day${a.eta_days === 1 ? '' : 's'}`}>
                        {i === 0 ? 'best' : 'then'} {fmtUsd(a.total)} · {a.seller_name} ★{a.seller_rating.toFixed(1)} · {a.eta_days}d
                      </span>
                    ))}
                    {c.asks.length > 3 && <span className="faint">+{c.asks.length - 3} more</span>}
                  </div>
                  <TrustLine cond={c.condition} anchorKind={c.anchorKind} />
                </div>
                <div className="radar-metrics">
                  <div><div className="faint small">CHEAPEST ASK</div><div className="radar-price">{fmtUsd(c.best.total)}</div></div>
                  <div><div className="faint small">ANCHOR</div><div className="radar-mkt">{fmtUsd(c.market)}</div></div>
                  <div><div className="faint small">SPREAD</div><div className={`radar-off ${c.spread <= -0.02 ? 'good' : c.spread >= 0.08 ? 'bad' : ''}`}>{pct > 0 ? '+' : ''}{pct}%</div></div>
                  <div className="radar-save-col"><div className="faint small">UNDER ANCHOR</div><div className="radar-save">{save != null && save > 0 ? fmtUsd(save) : '—'}</div></div>
                </div>
                <div className="radar-act">
                  <button className="primary" onClick={() => buy(c.best)} title={`Buy the cheapest ask: ${fmtUsd(c.best.total)} from ${c.best.seller_name}`}>BUY CHEAPEST</button>
                  <OverflowHint count={1} align="right" />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
