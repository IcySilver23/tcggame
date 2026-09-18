import { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { CardImg, ConditionBadge, fmtDate, fmtUsd, Modal, PriceChart, PriceTag, RarityBadge, SourceBadge } from '../components'
import type { Condition } from '../types'
import { CardTradePanel } from './CardTradePanel'

const CONDITIONS: Condition[] = ['NM', 'LP', 'MP', 'HP', 'DM']
const CONDITION_LABEL: Record<Condition, string> = {
  NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DM: 'Damaged',
}

export function CardDetailModal() {
  const { detail, detailLoading, closeCard, toast, refreshState, refreshDetail, openCard } = useStore()
  const [buying, setBuying] = useState(false)
  const [histRange, setHistRange] = useState<number | null>(null)
  const [tradeInvId, setTradeInvId] = useState<number | null>(null)

  const refresh = async () => {
    await refreshDetail()
    refreshState()
  }

  const doBuy = async () => {
    if (!detail) return
    setBuying(true)
    try {
      // Find the cheapest NPC listing for this card; fall back to direct market purchase.
      const listings = await api.marketListings({ cardId: detail.card.id })
      if (listings.length > 0) {
        await api.buyListing(listings[0].id)
        toast(`Bought ${detail.card.name} from the marketplace feed`, 'good')
      } else {
        await api.buyCardDirect(detail.card.id, detail.card.price?.usd ?? 0)
        toast(`Bought ${detail.card.name} at market`, 'good')
        await refresh()
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Purchase failed', 'bad')
    } finally {
      setBuying(false)
    }
  }

  const doSell = async () => {
    if (!detail) return
    const owned = detail.owned.find((o) => o.status === 'collection')
    if (!owned || !detail.card.price?.usd) return
    const price = Math.round(detail.card.price.usd * 100) / 100
    try {
      await api.listItem(owned.id, price)
      toast(`${detail.card.name} listed at market — watch Inventory for the sale`, 'good')
      await refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Listing failed', 'bad')
    }
  }

  const toggleWishlist = async () => {
    if (!detail) return
    try {
      await api.wishlistToggle(detail.card.id)
      await refresh()
    } catch { toast('Wishlist update failed', 'bad') }
  }

  const toggleFavorite = async () => {
    if (!detail) return
    const target = detail.owned.find((o) => o.status !== 'sold')
    if (!target) { toast('Own this card first', 'bad'); return }
    await api.favoriteItem(target.id)
    await refresh()
  }

  if (detailLoading || !detail) {
    return (
      <Modal onClose={closeCard} wide>
        <div className="empty"><span className="spinner" /> Loading card…</div>
      </Modal>
    )
  }

  const { card } = detail
  const price = card.price
  const history = (histRange ? detail.history.slice(-histRange) : detail.history)
  const tradeRow = detail.owned.find((o) => o.id === tradeInvId)

  return (
    <Modal onClose={closeCard} wide>
      <div className="modal-head">
        <div>
          <h1>{card.name}</h1>
          <div className="sub muted">{card.set_name} · {card.number}/{card.set_total ?? '?'} · {card.rarity ?? '—'}</div>
          {card.artist && <div className="faint small">Illustrated by {card.artist}</div>}
        </div>
        <button className="ghost" onClick={closeCard}>✕</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: 22 }}>
        <div>
          <CardImg src={card.image_large} alt={card.name} />
          <div className="row mt8">
            <RarityBadge rarity={card.rarity} />
            {card.types && <span className="badge">{JSON.parse(card.types).join(' / ')}</span>}
            {card.hp && <span className="badge">{card.hp} HP</span>}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="panel" style={{ margin: 0 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="faint small" style={{ letterSpacing: 1 }}>MARKET PRICE (Near Mint)</div>
                <div style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtUsd(price?.usd)}
                </div>
                <div className="row mt8" style={{ gap: 6 }}>
                  <SourceBadge price={price} />
                  {price?.source === 'model' && (
                    <div className="faint small" style={{ marginTop: 4 }}>
                      Estimated from comparable cards — no market data published yet.
                    </div>
                  )}
                  {price?.retrievedAt && <span className="faint small">retrieved {fmtDate(price.retrievedAt)}</span>}
                </div>
              </div>
              {price?.source !== 'model' && (
                <div className="right">
                  <div className="faint small">{price?.kind === 'ebay' ? 'eBay listing range' : price?.kind === 'pricecharting' ? 'PriceCharting raw price' : 'TCGplayer low–high'}</div>
                  <div className="small">{fmtUsd(price?.low)} – {fmtUsd(price?.high)}</div>
                </div>
              )}
            </div>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="primary" disabled={buying || !price?.usd} onClick={doBuy}>BUY</button>
            <button disabled={!detail.owned.some((o) => o.status === 'collection')} onClick={doSell}>SELL</button>
            <button onClick={toggleWishlist}>{detail.wishlisted ? '★ WISHLISTED' : 'ADD TO WISHLIST'}</button>
            <button onClick={toggleFavorite}>FAVORITE</button>
            <button className="ghost" onClick={() => (window.location.hash = '#/market')}>VIEW LISTINGS →</button>
          </div>          {detail.gradedPrices?.length > 0 && (
            <div>
              <div className="faint small" style={{ letterSpacing: 1, marginBottom: 6 }}>
                REAL GRADED PRICES <span className="badge live">PriceCharting</span>
              </div>
              <table className="table">
                <thead><tr><th>Grade</th><th className="right">Value</th><th>Source</th><th className="right">Retrieved</th></tr></thead>
                <tbody>
                  {detail.gradedPrices.map((g) => (
                    <tr key={g.grade}>
                      <td>{{ PSA10: 'PSA 10 (Gem Mint)', PSA9: 'PSA 9 (Mint)', PSA8: 'PSA 8 (NM-MT)', PSA7: 'PSA 7 (NM)', BGS10: 'BGS 10 (Pristine)', CGC10: 'CGC 10', SGC10: 'SGC 10' }[g.grade] ?? g.grade}</td>
                      <td className="num">{fmtUsd(g.usd)}</td>
                      <td>{g.source === 'pc-graded' ? <span className="badge live">PriceCharting</span> : <span className="badge live" title="Median of active eBay fixed-price listings for this grade">eBay comps</span>}</td>
                      <td className="num faint small">{fmtDate(g.retrievedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <div className="faint small" style={{ letterSpacing: 1, marginBottom: 6 }}>
              CONDITION TIERS
                {price?.source === 'model'
                  ? <span className="badge model">all tiers estimated from model</span>
                  : <span className="badge est">NM = LIVE · others ESTIMATED</span>}
              </div>
            <table className="table">
              <thead>
                <tr><th>Condition</th><th className="right">Est. Value</th><th className="right">vs NM</th></tr>
              </thead>
              <tbody>
                {CONDITIONS.map((cond) => {
                  const mult = { NM: 1, LP: 0.8, MP: 0.65, HP: 0.5, DM: 0.35 }[cond]
                  const v = price?.usd != null ? Math.round(price.usd * mult * 100) / 100 : null
                  return (
                    <tr key={cond}>
                      <td>{CONDITION_LABEL[cond]}</td>
                      <td className="num">{fmtUsd(v)}</td>
                      <td className="num faint">{cond === 'NM' ? 'anchor' : `${Math.round(mult * 100)}%`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div>
            <div className="faint small" style={{ letterSpacing: 1, marginBottom: 6 }}>
              PRICE HISTORY <span className="badge est">our snapshot log</span>
            </div>
            <div className="chip-row mb8">
              {[7, 30, 90, null].map((n) => (
                <span key={String(n)} className={`chip ${histRange === n ? 'on' : ''}`} onClick={() => setHistRange(n)}>
                  {n ? `${n}D` : 'ALL'}
                </span>
              ))}
            </div>
            <PriceChart history={history} />
            {detail.history.length > 0 && (
              <div className="faint small mt8">
                First snapshot {fmtDate(detail.history[0].at)} · latest {fmtDate(detail.history[detail.history.length - 1].at)}
              </div>
            )}
          </div>

          {detail.owned.length > 0 && (
            <div>
              <div className="faint small" style={{ letterSpacing: 1, marginBottom: 6 }}>YOUR COPIES</div>
              <table className="table">
                <thead><tr><th>Condition</th><th>Status</th><th className="right">Cost</th><th className="right">Value</th><th></th></tr></thead>
                <tbody>
                  {detail.owned.map((o) => (
                    <tr key={o.id}>
                      <td><ConditionBadge cond={o.condition} /></td>
                      <td className="small">{o.status === 'listed' ? `Listed ${fmtUsd(o.listing_price)}` : o.status}</td>
                      <td className="num faint">{fmtUsd(o.cost_basis)}</td>
                      <td className="num">{fmtUsd(o.status === 'listed' ? o.listing_price : marketValueFor(o.condition))}</td>
                      {o.status === 'listed' ? (
                        <td className="right"><button className="small" onClick={async () => { await api.cancelListing(o.id); refresh() }}>Cancel</button></td>
                      ) : (
                        <td className="right" style={{ whiteSpace: 'nowrap' }}>
                          <button className="small" onClick={doSell}>Sell</button>{' '}
                          {(o.quantity as number) === 1 && !o.graded_grade && (
                            <button
                              className={`small ${tradeInvId === o.id ? 'primary' : ''}`}
                              title="Offer this copy to a collector"
                              onClick={() => setTradeInvId(tradeInvId === o.id ? null : o.id)}
                            >
                              Trade
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {tradeRow && (
                <div style={{ marginTop: 8 }}>
                  <div className="faint small" style={{ letterSpacing: 1, marginBottom: 6 }}>PROPOSE A TRADE</div>
                  <CardTradePanel
                    inventoryId={tradeRow.id}
                    cardName={card.name}
                    cardValue={marketValueFor(tradeRow.condition)}
                    onDone={() => { setTradeInvId(null); refresh() }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )

  function marketValueFor(cond: string) {
    if (!price?.usd) return null
    const mult = { NM: 1, LP: 0.8, MP: 0.65, HP: 0.5, DM: 0.35 } as Record<string, number>
    return Math.round(price.usd * (mult[cond] ?? 1) * 100) / 100
  }
}
