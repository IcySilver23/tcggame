import { useEffect, useState } from 'react'
import { api, type CalendarResponse, type CollectorStats, type ConventionSummary, type MarketDigest, type NetWorthHistory, type ShopStatsResponse } from '../api'
import { useStore } from '../store'
import { CardImg, Delta, EmptyState, fmtDate, fmtUsd, PriceChart, PriceTag, timeAgo } from '../components'
import type { ActivityRow, CardRow } from '../types'

export function HomePage() {
  const { state, openCard, toast } = useStore()
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [watch, setWatch] = useState<CardRow[]>([])
  const [prev, setPrev] = useState<Record<string, number | null | undefined>>({})
  const [conv, setConv] = useState<ConventionSummary | null>(null)
  const [cal, setCal] = useState<CalendarResponse | null>(null)
  const [nw, setNw] = useState<NetWorthHistory | null>(null)
  const [rec, setRec] = useState<CollectorStats | null>(null)
  const [shopPerf, setShopPerf] = useState<ShopStatsResponse | null>(null)
  const [digest, setDigest] = useState<MarketDigest | null>(null)

  useEffect(() => {
    api.activity().then(setActivity).catch(() => {})
    api.conventionSummary().then(setConv).catch(() => {})
    api.calendar().then(setCal).catch(() => {})
    api.netWorthHistory().then(setNw).catch(() => {})
    api.collectorStats().then(setRec).catch(() => {})
    api.shopStats().then(setShopPerf).catch(() => {})
    api.marketDigest().then(setDigest).catch(() => {})
    api
      .cardsSearch({ sort: 'price_desc', limit: 10, q: '' })
      .then((r) => {
        setWatch(r.cards)
        setPrev(Object.fromEntries(r.cards.map((c) => [c.id, c.market_price])))
      })
      .catch(() => {})
  }, [])

  // Track % moves between polls so the watchlist feels alive
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const r = await api.cardsSearch({ sort: 'price_desc', limit: 10 })
        setPrev((p) => {
          const next: Record<string, number | null | undefined> = {}
          for (const c of r.cards) next[c.id] = p[c.id] ?? c.market_price
          return next
        })
        setWatch(r.cards)
      } catch { /* ignore */ }
      try { setActivity(await api.activity()) } catch { /* ignore */ }
      try { api.conventionSummary().then(setConv).catch(() => {}) } catch { /* ignore */ }
      try { api.calendar().then(setCal).catch(() => {}) } catch { /* ignore */ }
      try { api.shopStats().then(setShopPerf).catch(() => {}) } catch { /* ignore */ }
      try { api.marketDigest().then(setDigest).catch(() => {}) } catch { /* ignore */ }
    }, 20000)
    return () => clearInterval(t)
  }, [])

  const deltaFor = (c: CardRow) => {
    const before = prev[c.id]
    const now = c.market_price
    if (before == null || now == null || before === 0) return null
    return now / before - 1
  }

  const syncDone = state?.sync.phase === 'done' || (state?.sync.cardCount ?? 0) > 1000

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Home</h1>
          <div className="sub">Your collector dashboard — live TCGplayer pricing, every 15 seconds.</div>
        </div>
      </div>

      <div className="grid cols4">
        <div className="kpi"><div className="lbl">Cash</div><div className="val">{fmtUsd(state?.cash)}</div></div>
        <div className="kpi"><div className="lbl">Collection Value</div><div className="val">{fmtUsd(state?.collectionValue)}</div><div className="note">{(state?.sync.cardCount ?? 0).toLocaleString()} real cards tracked</div></div>
        <div className="kpi"><div className="lbl">Inventory Value</div><div className="val">{fmtUsd(state?.inventoryValue)}</div></div>
        <div className="kpi"><div className="lbl">Net Worth</div><div className="val" style={{ color: 'var(--yellow)' }}>{fmtUsd(state?.netWorth)}</div></div>
      </div>

      {rec && rec.cardsOwned > 0 && (
        <div className="panel mt14">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>🏆 Collector record</h2>
            <span className="faint small">
              📔 {state?.binders?.count ?? 0} binder{((state?.binders?.count ?? 0)) === 1 ? '' : 's'} · {(state?.binders?.slotted ?? 0).toLocaleString()} slotted · {fmtUsd(state?.binders?.value)}
              {rec.activeStreak > 1 && <> · <b style={{ color: 'var(--yellow)' }}>{rec.activeStreak}-day streak</b></>}
            </span>
          </div>
          <div className="grid cols4 mt8">
            <div className="kpi"><div className="lbl">Cards Owned</div><div className="val">{rec.cardsOwned.toLocaleString()}</div><div className="note">{rec.uniqueCards.toLocaleString()} unique{rec.gradedCount > 0 && ` · ${rec.gradedCount} graded`}</div></div>
            <div className="kpi"><div className="lbl">Total Invested</div><div className="val">{fmtUsd(rec.totalInvested)}</div><div className="note">collection now {fmtUsd(rec.collectionValue)}</div></div>
            <div className="kpi">
              <div className="lbl">Unrealized</div>
              <div className="val" style={{ color: rec.unrealized >= 0 ? 'var(--green)' : 'var(--red)' }}>{rec.unrealized >= 0 ? '+' : '-'}{fmtUsd(Math.abs(rec.unrealized))}</div>
              <div className="note">vs what you paid</div>
            </div>
            <div className="kpi"><div className="lbl">Days Played</div><div className="val">{rec.daysPlayed}</div><div className="note">since {fmtDate(rec.firstPlayed ? rec.firstPlayed : null)}</div></div>
          </div>
          <div className="grid cols2 mt14">
            <div>
              <b className="small">Biggest gainers</b>
              {rec.gainers.length === 0 ? (
                <div className="faint small mt8">No gainers yet — the market decides, buy low anyway.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} className="mt8">
                  {rec.gainers.map((g) => (
                    <div key={g.cardId + g.condition} className="row" style={{ gap: 10, cursor: 'pointer' }} onClick={() => openCard(g.cardId)}>
                      <div style={{ width: 34 }}><CardImg src={g.image} alt={g.name} /></div>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="small" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {g.name}{g.quantity > 1 && <span className="faint"> ×{g.quantity}</span>}{g.gradedGrade && <span className="badge hit" style={{ marginLeft: 6 }}>{g.gradedGrade}</span>}
                        </div>
                        <div className="faint" style={{ fontSize: 11 }}>{g.setName}</div>
                      </div>
                      <div className="right">
                        <div className="small price">{fmtUsd(g.value)}</div>
                        <span className="small" style={{ color: 'var(--green)', fontWeight: 650 }}>+{Math.round((g.gainPct ?? 0) * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <b className="small">Best flip</b>
              {!rec.bestFlip ? (
                <div className="faint small mt8">No sales yet — your first flip writes itself here.</div>
              ) : (
                <div className="row mt8" style={{ gap: 10, cursor: 'pointer' }} onClick={() => openCard(rec.bestFlip!.cardId)}>
                  <div style={{ width: 44 }}><CardImg src={rec.bestFlip.image} alt={rec.bestFlip.name} /></div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="small" style={{ fontWeight: 600 }}>{rec.bestFlip.name}</div>
                    <div className="faint" style={{ fontSize: 11 }}>{rec.bestFlip.setName} · sold {fmtDate(rec.bestFlip.soldAt)}</div>
                    <div className="small mt8">{fmtUsd(rec.bestFlip.bought)} → {fmtUsd(rec.bestFlip.sold)}</div>
                  </div>
                  <div className="right">
                    <div className="price" style={{ color: 'var(--green)' }}>+{fmtUsd(rec.bestFlip.profit)}</div>
                    {rec.bestFlip.roi != null && <span className="small" style={{ color: 'var(--green)', fontWeight: 650 }}>+{Math.round(rec.bestFlip.roi * 100)}% ROI</span>}
                  </div>
                </div>
              )}
              <div className="faint small mt8">
                {rec.salesCount} sale{rec.salesCount === 1 ? '' : 's'} · {fmtUsd(rec.lifetimeEarned)} earned · realized{' '}
                <b style={{ color: rec.realizedProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{rec.realizedProfit >= 0 ? '+' : '-'}{fmtUsd(Math.abs(rec.realizedProfit))}</b>
              </div>
            </div>
          </div>
        </div>
      )}

      {shopPerf && shopPerf.open && (
        <div className="panel mt14">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>🏪 {shopPerf.shopName}</h2>
            <button className="ghost small" onClick={() => (window.location.hash = '#/shop')}>Run the shop →</button>
          </div>
          <div className="grid cols4 mt8">
            <div className="kpi">
              <div className="lbl">Today</div>
              <div className="val">{fmtUsd(shopPerf.todayRevenue)}</div>
              <div className="note">{shopPerf.todayCustomers} walk-in{shopPerf.todayCustomers === 1 ? '' : 's'}</div>
            </div>
            <div className="kpi">
              <div className="lbl">7-day revenue</div>
              <div className="val">{fmtUsd(shopPerf.week.revenue)}</div>
            </div>
            <div className="kpi">
              <div className="lbl">Reputation</div>
              <div className="val" style={{ color: shopPerf.reputation >= 0 ? 'var(--green)' : '#f87171' }}>
                {shopPerf.reputation >= 0 ? '+' : ''}{shopPerf.reputation}
              </div>
              <div className="note">
                {(() => {
                  const s = shopPerf.week.series
                  if (s.length < 2) return 'building history'
                  const delta = s[s.length - 1].reputation - s[0].reputation
                  return delta === 0 ? 'flat this week' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} this week`
                })()}
              </div>
            </div>
            <div className="kpi">
              <div className="lbl">Lifetime shop net</div>
              <div className="val" style={{ color: shopPerf.lifetimeNet >= 0 ? 'var(--green)' : '#f87171' }}>
                {fmtUsd(shopPerf.lifetimeNet)}
              </div>
              {shopPerf.bestLine && <div className="note">best line: {shopPerf.bestLine.label}</div>}
            </div>
          </div>

          {shopPerf.week.series.length > 1 && (
            <div className="mt8">
              <div className="faint small">Daily net — last {shopPerf.week.series.length} day{shopPerf.week.series.length === 1 ? '' : 's'} (taller is better)</div>
              <div className="row" style={{ gap: 4, alignItems: 'flex-end', height: 54, marginTop: 6 }}>
                {(() => {
                  const s = shopPerf.week.series
                  const max = Math.max(...s.map((d) => Math.abs(d.net)), 1)
                  return s.map((d) => {
                    const h = Math.max(3, Math.round((Math.abs(d.net) / max) * 48))
                    const pos = d.net >= 0
                    return (
                      <div key={d.day} style={{ flex: 1, textAlign: 'center' }} title={`${d.day}: ${d.net >= 0 ? '+' : ''}${fmtUsd(d.net)} net · ${d.customers} customers`}
                        onClick={() => (window.location.hash = '#/shop')}>
                        <div style={{ height: h, background: pos ? 'var(--green, #4ade80)' : '#f87171', borderRadius: 3, opacity: pos ? 1 : 0.75, cursor: 'pointer' }} />
                        <div className="faint" style={{ fontSize: 8 }}>{d.day.slice(8)}</div>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {digest && digest.sampled > 0 && (
        <div className="panel mt14">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>📰 Weekly market digest</h2>
            <span className="faint small">
              week of {digest.week} · {digest.sampled} cards tracked
              {digest.postedAt ? ` · posted ${timeAgo(digest.postedAt)}` : ' · preview'}
            </span>
          </div>
          <div className="grid cols2 mt8" style={{ gap: 12 }}>
            {(
              [
                { label: '▲ Top gainers — 7 days', movers: digest.gainers, color: 'var(--green, #4ade80)' },
                { label: '▼ Biggest drops — 7 days', movers: digest.losers, color: '#f87171' },
              ] as const
            ).map((col) => (
              <div key={col.label}>
                <div className="small" style={{ color: col.color, marginBottom: 6 }}>{col.label}</div>
                {col.movers.length === 0 ? (
                  <div className="faint small">Not enough price history yet.</div>
                ) : (
                  col.movers.slice(0, 5).map((m) => (
                    <div key={m.cardId} className="row" style={{ padding: '4px 0', gap: 8, cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                      onClick={() => openCard(m.cardId)}>
                      <div style={{ width: 30 }}><CardImg src={m.image} alt={m.name} /></div>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                        <div className="faint" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.setName}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="small" style={{ color: col.color }}>
                          {m.changePct > 0 ? '+' : ''}{(m.changePct * 100).toFixed(1)}%
                        </div>
                        <div className="faint" style={{ fontSize: 10 }}>
                          {fmtUsd(m.from)} → {fmtUsd(m.to)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(cal?.live || cal?.next || conv) && (
        <div className="panel mt14">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>📅 On the scene</h2>
            <button className="ghost small" onClick={() => (window.location.hash = '#/calendar')}>Full calendar →</button>
          </div>
          <div className="grid cols2 mt8" style={{ gap: 12 }}>
            {cal && (cal.live || cal.next) && (() => {
              const ev = cal.live ?? cal.next!
              const serverNow = new Date(cal.serverNow).getTime()
              const ms = cal.live && cal.live.end ? new Date(cal.live.end).getTime() - serverNow : new Date(ev.start).getTime() - serverNow
              const min = Math.max(0, Math.floor(ms / 60_000))
              const cd = min < 60 ? `${min}m` : min < 1440 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`
              const icon = ev.kind === 'convention' ? '🎪' : ev.kind === 'tournament' ? '⚔️' : '📩'
              return (
                <div className="kpi">
                  <div className="lbl">{cal.live ? 'Happening now' : 'Next event'}</div>
                  <div className="val" style={{ fontSize: 16 }}>{icon} {ev.title}</div>
                  <div className="note" style={{ color: cal.live ? 'var(--green)' : undefined }}>
                    {cal.live && !cal.live.end ? 'LIVE now' : `${cal.live ? 'Ends in' : 'Starts in'} ${cd}`}
                    {cal.next && cal.next.id !== ev.id && ` · then ${cal.next.title}`}
                  </div>
                </div>
              )
            })()}
            {conv && (
              <div className="kpi">
                <div className="lbl">Convention scene</div>
                {conv.next.open ? (
                  <>
                    <div className="val" style={{ fontSize: 16 }}>🎪 {conv.next.showName}</div>
                    <div className="note">
                      {conv.next.entered ? 'You are set up inside' : `Entry ${fmtUsd(conv.next.entryFee)}`} · closes in {conv.next.minutesLeft} min
                      {conv.lastShow && <> · last show <b style={{ color: conv.lastShow.net >= 0 ? 'var(--green)' : 'var(--red)' }}>{conv.lastShow.net >= 0 ? '+' : '-'}{fmtUsd(Math.abs(conv.lastShow.net))}</b></>}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="val" style={{ fontSize: 16, color: 'var(--text-dim)' }}>No show in town</div>
                    <div className="note">
                      Next rolls in ~{conv.next.nextShowInMin} min of play
                      {conv.lastShow && <> · last: <b style={{ color: conv.lastShow.net >= 0 ? 'var(--green)' : 'var(--red)' }}>{conv.lastShow.net >= 0 ? '+' : '-'}{fmtUsd(Math.abs(conv.lastShow.net))}</b></>}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {nw && nw.points.length >= 2 && (
        <div className="panel mt14">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>📈 Net worth, week by week</h2>
            {nw.change != null && (
              <b className="small" style={{ color: nw.change >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {nw.change >= 0 ? '+' : '-'}{fmtUsd(Math.abs(nw.change))} since you started
              </b>
            )}
          </div>
          <div className="mt8">
            <PriceChart history={nw.points.map((p) => ({ value: p.netWorth, at: p.week }))} height={160} />
          </div>
          <div className="faint small mt8">
            Cash {fmtUsd(nw.points[nw.points.length - 1].cash)} · collection {fmtUsd(nw.points[nw.points.length - 1].collection)} · listed {fmtUsd(nw.points[nw.points.length - 1].listed)} · sealed {fmtUsd(nw.points[nw.points.length - 1].sealed)}
          </div>
        </div>
      )}

      {!syncDone && (
        <div className="panel mt14" style={{ borderColor: 'rgba(59,130,246,0.4)' }}>
          <div className="row">
            <span className="spinner" />
            <div className="grow">
              <b>Building the real card database…</b>
              <div className="small muted">
                TCG Life is syncing every Pokémon TCG set from the official API. The market fills in as sets arrive.
                You can browse and open packs right away — prices appear as each set lands.
              </div>
            </div>
            <button className="primary" onClick={() => (window.location.hash = '#/packs')}>Open packs meanwhile</button>
          </div>
        </div>
      )}

      <div className="grid cols2 mt14">
        <div className="panel">
          <h2>Recent Activity</h2>
          {activity.length === 0 && <EmptyState icon="🕰" text="No activity yet" sub="Buy a pack, hunt the market, list a card." />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activity.slice(0, 7).map((a) => (
              <div key={a.id} className="row" style={{ gap: 10 }}>
                <span>{a.kind === 'sale' ? '💰' : a.kind === 'buy' ? '🛒' : a.kind === 'pack' ? '📦' : a.kind === 'listing' ? '🏷' : '•'}</span>
                <span className="grow small">{a.message}</span>
                <span className="faint small">{timeAgo(a.created_at)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Market Watch <span className="badge live">LIVE</span></h2>
          {watch.length === 0 && <EmptyState icon="📈" text="Market loading…" sub="Waiting for the first synced sets." />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {watch.slice(0, 8).map((c) => (
              <div key={c.id} className="row" style={{ gap: 10, cursor: 'pointer' }} onClick={() => openCard(c.id)}>
                <div style={{ width: 36 }}><CardImg src={c.image_small} alt={c.name} /></div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                  <div className="faint" style={{ fontSize: 11 }}>{c.set_name}</div>
                </div>
                <div className="right">
                  <div className="small price">{fmtUsd(c.market_price)}</div>
                  <Delta pct={deltaFor(c)} />
                </div>
              </div>
            ))}
          </div>
          <button className="ghost small mt8" onClick={() => (window.location.hash = '#/market')}>Browse full market →</button>
        </div>
      </div>

    </div>
  )
}
