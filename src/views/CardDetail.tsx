import { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { CardImg, ConditionBadge, EyeSkill, fmtDate, fmtUsd, LoadFailure, Modal, OverflowMenu, PriceChart, PriceTag, RarityBadge, slabLabel, SlabCard, SourceBadge, SubStatBars } from '../components'
import type { Condition } from '../types'
import { variantTag } from '../variant-label'
import { CardTradePanel } from './CardTradePanel'
import { SellRoutes } from './SellRoutes'

const CONDITIONS: Condition[] = ['NM', 'LP', 'MP', 'HP', 'DM']
const CONDITION_LABEL: Record<Condition, string> = {
  NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DM: 'Damaged',
}

// Same order the server uses for its real comp ladder, so an estimated rung a
// slab needs (CGC Pristine with no published comp) still lands beside CGC 10.
const GRADE_SORT = ['PSA10', 'BGS10BL', 'BGS10', 'CGC10P', 'CGC10', 'SGC10', 'PSA9', 'BGS9', 'CGC9', 'SGC9', 'PSA8', 'BGS8', 'PSA7']

export function CardDetailModal() {
  const { detail, detailCardId, detailLoading, closeCard, toast, refreshState, refreshDetail, openCard } = useStore()
  const [buying, setBuying] = useState(false)
  const [histRange, setHistRange] = useState<number | null>(null)
  const [tradeInvId, setTradeInvId] = useState<number | null>(null)
  const [eye, setEye] = useState<Record<number, { stats: { centering: number; whitening: number; corners: number; printLine: number }; error: number; skill: number; summary?: string }>>({})
  const [eyeSkill, setEyeSkill] = useState<{ skill: number; hint: string } | null>(null)
  const [comps, setComps] = useState<Record<number, { band: number; copyValue: number | null; copyKnown: boolean; copyFactor: number; low: number | null; high: number | null }>>({})

  useEffect(() => {
    api.substatsEye().then(setEyeSkill).catch(() => {})
    // Load comps for any owned raw single copies.
    for (const o of detail?.owned ?? []) {
      if (!o.graded_grade && (o.quantity as number) === 1) {
        api.substatComps(o.id).then((c) => setComps((m) => ({ ...m, [o.id]: c }))).catch(() => {})
      }
    }
  }, [detail?.owned.length, detail?.card.id])

  const inspectCopy = async (invId: number) => {
    try {
      const r = await api.inspectCard(invId)
      if (r.stats) {
        setEye((e) => ({ ...e, [invId]: { stats: r.stats!, error: r.error ?? 0, skill: r.skill ?? 0, summary: r.summary } }))
        api.substatComps(invId).then((c) => setComps((m) => ({ ...m, [invId]: c }))).catch(() => {})
        api.substatsEye().then(setEyeSkill).catch(() => {})
      } else toast(r.error_msg ?? 'Nothing to see', 'bad')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Inspect failed', 'bad')
    }
  }

  const substatRow = (o: { id: number; graded_grade?: string | null; quantity?: number; status: string; listing_price?: number | null }) => {
    const read = eye[o.id]
    const c = comps[o.id]
    if (o.graded_grade) return null
    return (
      <div style={{ marginTop: 3 }}>
        {read ? (
          <div>
            <div className="small faint">
              👁 {read.summary}
              {read.error > 0 && ` · ±${read.error} (eye ${read.skill}%)`}
              {read.error === 0 && ' · mastered eye'}
            </div>
            <SubStatBars stats={read.stats} />
          </div>
        ) : (
          <button className="small ghost" style={{ marginTop: 3 }} onClick={() => inspectCopy(o.id)}>👁 Inspect this copy</button>
        )}
        {c && c.copyKnown && c.copyValue != null && (
          <div className="small faint" style={{ marginTop: 3 }}>
            Comps: band {fmtUsd(c.band)} · this copy {fmtUsd(c.copyValue)}
            <b style={{ color: c.copyFactor >= 1 ? 'var(--good, var(--green))' : 'var(--red)' }}> {c.copyFactor >= 1 ? '+' : ''}{Math.round((c.copyFactor - 1) * 1000) / 10}%</b>
            {' '}· window {fmtUsd(c.low)}–{fmtUsd(c.high)}
          </div>
        )}
        {c && !c.copyKnown && (
          <div className="small faint" style={{ marginTop: 3 }}>
            Band comps {fmtUsd(c.low)}–{fmtUsd(c.high)} · list it (or offer it) and the market prices THIS copy
          </div>
        )}
      </div>
    )
  }

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
      const printing = variantTag(owned.variant) ? ` · ${variantTag(owned.variant)}` : ''
      toast(`${detail.card.name}${printing} listed at market — watch Inventory for the sale`, 'good')
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

  if (detailLoading) {
    return (
      <Modal onClose={closeCard} wide>
        <div className="empty"><span className="spinner" /> Loading card…</div>
      </Modal>
    )
  }
  // The store drops detailLoading on a failed read, so this used to spin forever.
  if (!detail) {
    return (
      <Modal onClose={closeCard} wide>
        <LoadFailure
          what="this card"
          sub="The card sheet did not load. Nothing was changed."
          onRetry={() => { if (detailCardId) openCard(detailCardId) }}
        />
      </Modal>
    )
  }

  const { card } = detail
  const price = card.price
  const history = (histRange ? detail.history.slice(-histRange) : detail.history)
  const tradeRow = detail.owned.find((o) => o.id === tradeInvId)
  // The first copy you can actually sell — the comparison prices that row.
  const compareRow = detail.owned.find((o) => o.status === 'collection')
  // Hero art goes in a slab when any owned copy is graded — the big picture
  // should match what's actually sitting in your collection.
  const firstOwnedSlab = detail.owned.find((o) => o.graded_grade)
  const ownedSlabs = detail.owned.filter((o) => o.graded_grade)

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
          <SlabCard src={card.image_large} alt={card.name} grade={firstOwnedSlab?.graded_grade} setName={card.set_name} cardNo={card.number} cardId={card.id} rarity={card.rarity} variant={compareRow?.variant ?? firstOwnedSlab?.variant ?? null} />
          <div className="row mt8">
            <RarityBadge rarity={card.rarity} />
            {card.types && <span className="badge">{JSON.parse(card.types).join(' / ')}</span>}
            {card.hp && <span className="badge">{card.hp} HP</span>}
          </div>

          {compareRow && <SellRoutes inventoryId={compareRow.id} compact onSold={() => { refreshState(); refreshDetail(); closeCard() }} />}
          {ownedSlabs.length > 0 && (
            <div className="panel" style={{ margin: '12px 0 0', padding: '10px 12px' }}>
              <div className="faint small" style={{ letterSpacing: 1, marginBottom: 8 }}>■ SLAB CERTIFIER</div>
              {ownedSlabs.map((s, idx) => {
                const L = slabLabel(card.name, s.graded_grade)
                if (!L) return null
                // Real comps are published per service+grade (PSA10, BGS9…);
                // fall back to the PSA rung of the same number when the exact
                // service isn't quoted. The server's slabValue is the value the
                // rest of the game uses, so a CGC Pristine with no exact comp
                // shows its real estimate rather than the CGC 10 fallback.
                const exactCode = L.code
                const comp = detail.gradedPrices?.find((gp) => gp.grade === exactCode)
                  ?? (L.blackLabel ? detail.gradedPrices?.find((gp) => gp.grade === 'BGS10') : undefined)
                  ?? (L.pristine ? detail.gradedPrices?.find((gp) => gp.grade === 'CGC10') : undefined)
                  ?? detail.gradedPrices?.find((gp) => gp.grade === `PSA${L.num}`)
                const exact = comp?.grade === exactCode
                const slabValue = s.slabValue ?? null
                const displayed = slabValue?.usd ?? comp?.usd ?? null
                const basis = slabValue?.basis ?? comp?.basis ?? null
                const sourceKind = slabValue?.kind ?? comp?.source ?? null
                const units = s.quantity ?? 1
                const cost = s.cost_basis * units
                const pl = displayed != null ? Math.round((displayed - cost) * 100) / 100 : null
                const sourceNote = basis === 'asking'
                  ? 'eBay active asking prices — not sold'
                  : basis === 'estimated'
                    ? L.pristine
                      ? 'CGC Pristine estimate — 1.45× the CGC 10 quote; no published Pristine comp'
                      : L.blackLabel
                        ? 'BGS Black Label estimate — 1.6× the BGS 10 quote; no published Black Label comp'
                        : 'game estimate — no published comp for this grade'
                    : basis === 'sold'
                      ? sourceKind === 'ebay-graded' ? 'eBay sold-based value' : 'PriceCharting sold-based value'
                      : null
                return (
                  <div key={s.id} style={{ display: 'flex', gap: 12, alignItems: 'center', ...(idx > 0 ? { borderTop: '1px solid var(--border-soft)', paddingTop: 10, marginTop: 10 } : {}) }}>
                    <div className={`cert-mini${L.blackLabel ? ' black-label' : ''}${L.pristine ? ' pristine-label' : ''}`} style={{ borderColor: L.frame }}>
                      <div className="cert-mini-lines">
                        <span>{(card.name || '').toUpperCase()}</span>
                        <span>{card.set_name?.toUpperCase()}</span>
                      </div>
                      <div className="cert-mini-rank">
                        {card.number && <span>#{/^\d+$/.test(card.number) ? Number(card.number) : card.number}</span>}
                        {L.word && <span>{L.word}</span>}
                        <b>{L.num}</b>
                      </div>
                      <div className="cert-mini-foot">
                        <span className="cert-mini-logo" style={{ color: L.ink }}>{L.abbr}</span>
                        <span className="cert-mini-cert">{L.cert}</span>
                      </div>
                    </div>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="small" style={{ fontWeight: 650 }}>{L.abbr} {L.num}{L.word ? ` · ${L.word}` : ''}</div>
                      <div className="faint small">CERT #{L.cert} · registration valid ✓</div>
                      <div className="row" style={{ marginTop: 6, gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <div>
                          <div className="faint small">EST. RESALE</div>
                          <div style={{ fontSize: 19, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 }}>
                            {displayed != null ? fmtUsd(displayed) : '—'}
                          </div>
                        </div>
                        {pl != null && (
                          <div className="small" style={{ color: pl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 650 }}>
                            {pl >= 0 ? '+' : ''}{fmtUsd(pl)} vs {fmtUsd(cost)} cost
                          </div>
                        )}
                      </div>
                      {displayed == null && <div className="faint small">no comps published for this rung</div>}
                      {sourceNote && <div className="faint small" style={{ marginTop: 2 }}>{sourceNote}</div>}
                      {slabValue == null && comp && !exact && <div className="faint small" style={{ marginTop: 2 }}>priced off the {comp.grade} comp — no {exactCode} quote</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
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
            {/* The three secondary actions live behind one control — five
                buttons in a row pushed the buy/sell pair off the fold. */}
            <OverflowMenu
              title="More actions for this card"
              items={[
                {
                  label: detail.wishlisted ? '★ Remove from wishlist' : '★ Add to wishlist',
                  hint: detail.wishlisted ? 'Stop pinging me about it' : 'Ping when a listing hits your price',
                  onClick: toggleWishlist,
                },
                { label: '♥ Favorite', hint: 'Star it in your collection', onClick: toggleFavorite },
                { label: 'See market listings →', hint: 'Open the full market', onClick: () => (window.location.hash = '#/market') },
              ]}
            />
          </div>

          {(detail.gradedPrices?.length > 0 || ownedSlabs.length > 0) && (() => {
            // When you own a slab this becomes the COMP LADDER — every real
            // rung the game has a quote for, plus the slab's own value when it
            // is an estimate (CGC Pristine with no exact comp), with each row's
            // P/L measured against your slab's cost. No slab → plain REAL
            // GRADED PRICES.
            const ref = ownedSlabs[0]
            const refL = ref ? slabLabel(card.name, ref.graded_grade) : null
            const refCost = (ref?.cost_basis ?? 0) * (ref?.quantity ?? 1)
            const slabQuote = ref?.slabValue ?? null
            const rows: { grade: string; usd: number; source: 'pc-graded' | 'ebay-graded' | null; basis: 'sold' | 'asking' | 'estimated'; estimated: boolean }[] =
              (detail.gradedPrices ?? []).map((g) => {
                const mine = refL != null && g.grade === refL.code && slabQuote != null
                return {
                  grade: g.grade,
                  usd: mine ? slabQuote!.usd : g.value ?? g.usd,
                  source: g.source,
                  basis: mine ? slabQuote!.basis : g.basis,
                  estimated: mine && slabQuote!.basis === 'estimated',
                }
              })
            if (refL && slabQuote && !rows.some((g) => g.grade === refL.code)) {
              rows.push({
                grade: refL.code,
                usd: slabQuote.usd,
                source: slabQuote.kind,
                basis: slabQuote.basis,
                estimated: slabQuote.basis === 'estimated',
              })
            }
            rows.sort((a, b) => {
              const ia = GRADE_SORT.indexOf(a.grade)
              const ib = GRADE_SORT.indexOf(b.grade)
              if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
              return b.usd - a.usd
            })
            if (rows.length === 0) return null
            // Best chase: which service is worth submitting a raw copy to,
            // given real fees × the copy's grade odds, net of sale fees.
            // Prefer services that actually beat selling raw; fall back to the
            // least-bad one purely so the strip can say why not to bother.
            const runs = detail.bestRoi ?? null
            const cands = (runs?.filter((r) => r.recommended).length ? runs!.filter((r) => r.recommended) : runs) ?? []
            const best = cands.length ? cands.reduce((a, b) => (b.roi > a.roi ? b : a)) : null
            const bestCode = best?.serviceId === 'beckett' ? 'BGS10' : best?.serviceId === 'cgc' ? 'CGC10P' : 'PSA10'
            return (
              <div>
                <div className="faint small" style={{ letterSpacing: 1, marginBottom: 6 }}>
                  {refL ? (
                    <>COMP LADDER <span className="badge est">quoted rungs + your slab · vs {fmtUsd(refCost)} cost</span></>
                  ) : (
                    <>REAL GRADED PRICES <span className="badge live">PriceCharting</span></>
                  )}
                </div>
                <table className="table">
                  <thead><tr><th>Grade</th><th className="right">Est. resale</th><th>Source</th>{refL && <th className="right">vs cost</th>}</tr></thead>
                  <tbody>
                    {rows.map((g) => {
                      const mine = refL != null && g.grade === refL.code
                      const pl = Math.round((g.usd - refCost) * 100) / 100
                      return (
                        <tr key={g.grade} style={mine || (best?.recommended && g.grade === bestCode) ? { background: 'rgba(255,203,5,.07)' } : undefined}>
                          <td>{
                            {
                              PSA10: 'PSA 10 (Gem Mint)', PSA9: 'PSA 9 (Mint)', PSA8: 'PSA 8 (NM-MT)', PSA7: 'PSA 7 (NM)',
                              BGS10BL: 'BGS 10 (Black Label)', BGS10: 'BGS 10 (Pristine)', BGS9: 'BGS 9 (Mint)', BGS8: 'BGS 8 (NM-MT)',
                              CGC10P: 'CGC 10 (Pristine)', CGC10: 'CGC 10 (Gem Mint)', CGC9: 'CGC 9 (Mint)', CGC8: 'CGC 8 (NM-MT)',
                              SGC10: 'SGC 10', SGC9: 'SGC 9',
                            }[g.grade]
                            ?? g.grade.replace(/^(PSA|BGS|CGC|SGC)(\d+)(BL|P)?$/, '$1 $2')
                          }
                            {mine && <span className="badge hit" style={{ marginLeft: 6 }}>◂ your slab</span>}
                            {best?.recommended && g.grade === bestCode && (
                              <span className="badge hit" style={{ marginLeft: 6 }} title={`Best ROI route to this rung: ${best.serviceName} at ${fmtUsd(best.cost)}`}>🎯 best chase</span>
                            )}
                          </td>
                          <td className="num">{fmtUsd(g.usd)}</td>
                          <td>{g.estimated
                            ? <span className="badge est" title={g.grade === 'CGC10P' ? 'CGC Pristine estimate — 1.45× the CGC 10 quote; no published Pristine comp' : 'Game estimate — no published comp for this rung'}>game estimate</span>
                            : g.source === 'pc-graded'
                              ? <span className="badge live">PriceCharting</span>
                              : <span className="badge live" title="Median of active eBay fixed-price listings for this grade">eBay comps</span>}</td>
                          {refL && (
                            <td className="num" style={{ color: pl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 650 }}>
                              {pl >= 0 ? '+' : ''}{fmtUsd(pl)}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {rows.some((g) => g.estimated) && (
                  <div className="faint small" style={{ marginTop: 6 }}>
                    Estimate rungs are this game's model, not a sold comp. CGC Pristine is 1.45× the CGC 10 quote because PriceCharting has no Pristine column.
                  </div>
                )}
                {best != null && (
                  <div className="small" style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(255,203,5,.06)', border: '1px solid rgba(255,203,5,.22)', borderRadius: 8 }}>
                    🎯 <b>Best chase:</b> submit your raw copy with <b>{best.serviceName}</b> ({fmtUsd(best.cost)}) —
                    EV {fmtUsd(best.evNet)} net of fees, <b style={{ color: best.roi >= 0 ? 'var(--green)' : 'var(--red)' }}>{Math.round(best.roi * 100)}% on the fee</b>, {best.gemChance}% gem odds
                    {best.pristineChance == null
                      ? best.serviceId === 'cgc' ? ', inspect for Pristine odds' : ''
                      : best.pristineChance > 0 ? `, ${best.pristineChance}% ${best.serviceId === 'cgc' ? 'Pristine' : 'Black Label'}` : ''}
                    {!best.recommended && ' · below just selling it raw'}
                  </div>
                )}
              </div>
            )
          })()}

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
                <thead>
                  <tr>
                    <th>Condition</th><th>Status</th><th className="right">Cost</th><th className="right">Value</th><th></th>
                  </tr>
                  {eyeSkill && (
                    <tr><td colSpan={5} className="small faint"><EyeSkill skill={eyeSkill.skill} hint={eyeSkill.hint} /></td></tr>
                  )}
                </thead>
                <tbody>
                  {detail.owned.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <ConditionBadge cond={o.condition} />
                        {variantTag(o.variant) && (
                          <span className="badge" style={{ marginLeft: 6 }} title="A separate printing of this number — same price anchor as the plain copy">
                            {variantTag(o.variant)}
                          </span>
                        )}
                        {substatRow(o)}
                      </td>
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
