import { useEffect, useState } from 'react'
import { api, type AchievementsStatus, type CalendarResponse, type CatalogDeltaSummary, type CollectorStats, type ConventionSummary, type MarketDigest, type NetWorthHistory, type PsaRushSection, type ShopStatsResponse } from '../api'
import { useStore } from '../store'
import { CardImg, Delta, EmptyState, fmtDate, fmtUsd, fmtWhen, fmtWait, PriceChart, PriceTag, timeAgo, BestPullCard } from '../components'
import type { ActivityRow, CardRow, SetRow } from '../types'

// The buylist tick posts one "<shop> posted a new want list" line per shop in
// the same second — four identical-looking rows is spam, not news. Collapse a
// consecutive run into a single counted line so the feed stays readable.
const WANT_LIST_END = 'posted a new want list — check the buylist before you sell.'

function feedRows(rows: ActivityRow[]): { row: ActivityRow; n: number }[] {
  const out: { row: ActivityRow; n: number }[] = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (r.message.endsWith(WANT_LIST_END) && last && last.row.message.endsWith(WANT_LIST_END)) last.n++
    else out.push({ row: r, n: 1 })
  }
  return out
}

export function HomePage() {
  const { state, openCard, toast, setRushShortcut } = useStore()
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [watch, setWatch] = useState<CardRow[]>([])
  const [prev, setPrev] = useState<Record<string, number | null | undefined>>({})
  const [conv, setConv] = useState<ConventionSummary | null>(null)
  const [cal, setCal] = useState<CalendarResponse | null>(null)
  const [nw, setNw] = useState<NetWorthHistory | null>(null)
  const [rec, setRec] = useState<CollectorStats | null>(null)
  const [shopPerf, setShopPerf] = useState<ShopStatsResponse | null>(null)
  const [digest, setDigest] = useState<MarketDigest | null>(null)
  const [setsById, setSetsById] = useState<Record<string, SetRow>>({})
  const [ach, setAch] = useState<AchievementsStatus | null>(null)
  const [rush, setRush] = useState<PsaRushSection | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [bestPull, setBestPull] = useState<Awaited<ReturnType<typeof api.pullsBest>> | null>(null)

  useEffect(() => {
    api.activity().then(setActivity).catch(() => {})
    api.sets().then((rows) => setSetsById(Object.fromEntries(rows.map((s) => [s.id, s])))).catch(() => {})
    api.conventionSummary().then(setConv).catch(() => {})
    api.calendar().then(setCal).catch(() => {})
    api.netWorthHistory().then(setNw).catch(() => {})
    api.collectorStats().then(setRec).catch(() => {})
    api.shopStats().then(setShopPerf).catch(() => {})
    api.marketDigest().then(setDigest).catch(() => {})
    api.achievements().then(setAch).catch(() => {})
    api.pullsBest().then(setBestPull).catch(() => {})
    api.psaRush().then(setRush).catch(() => {})
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
      try { api.psaRush().then(setRush).catch(() => {}) } catch { /* ignore */ }
    }, 20000)
    return () => clearInterval(t)
  }, [])

  // The rush countdown ticks live while the event runs (state polls every 20s;
  // the seconds shouldn't).
  useEffect(() => {
    if (!rush?.active) return
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [rush?.active])

  const deltaFor = (c: CardRow) => {
    const before = prev[c.id]
    const now = c.market_price
    if (before == null || now == null || before === 0) return null
    return now / before - 1
  }

  const syncDone = state?.sync.phase === 'done' || (state?.sync.cardCount ?? 0) > 1000

  // Weekly catalog delta — surface what it pulled on the dashboard.
  // "This week" = sets that actually RELEASED within the last 7 days (so a
  // release-day drop headlines the strip); if the latest run only caught
  // back-catalog updates, show those instead — the summary is replaced at
  // each weekly check, so it never goes stale on screen.
  const releaseItems = (() => {
    const s: CatalogDeltaSummary | null | undefined = state?.sync.delta?.lastSummary
    if (!s || (s.newSets.length === 0 && s.updatedSets.length === 0)) return []
    const weekAgo = Date.now() - 7 * 24 * 3600_000
    const ranAt = new Date(s.at).getTime()
    const releasedRecently = (iso: string | undefined) => {
      if (!iso) return false
      const t = new Date(iso).getTime()
      return !Number.isNaN(t) && t >= weekAgo && t <= ranAt + 24 * 3600_000
    }
    const items = [
      ...s.newSets.map((x) => ({ ...x, isNew: true, at: s.at })),
      ...s.updatedSets.map((x) => ({ ...x, isNew: false, at: s.at })),
    ]
    const fresh = items.filter((x) => releasedRecently(setsById[x.id]?.release_date))
    return (fresh.length > 0 ? fresh : items).slice(0, 4)
  })()

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
        <div className="kpi"><div className="lbl">Net Worth</div><div className="val" style={{ color: 'var(--gold)' }}>{fmtUsd(state?.netWorth)}</div></div>
      </div>

      {rush && rush.active && (() => {
        // Live PSA-rush event card — countdown, the quota race, and a shortcut
        // that drops you on Grading filtered to what the $10 special accepts.
        const fmtCd = (ms: number) => {
          if (ms <= 0) return 'ending now'
          const s = Math.floor(ms / 1000)
          const d = Math.floor(s / 86400)
          const h = Math.floor((s % 86400) / 3600)
          const m = Math.floor((s % 3600) / 60)
          if (d > 0) return `${d}d ${h}h ${m}m`
          if (h > 0) return `${h}h ${m}m`
          return `${m}m ${s % 60}s`
        }
        const total = rush.quotaTotal
        const used = Math.min(rush.quotaUsed, total)
        const npc = Math.min(rush.npcUsed ?? 0, used)
        const mine = used - npc
        const gone = !rush.specialOpen
        return (
          <div className="panel mt14" style={{ borderColor: 'var(--yellow)', background: 'rgba(255,203,5,0.06)' }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <b style={{ color: 'var(--gold)' }}>🏷️ PSA SPECIAL — LIVE</b>
                <span className="small">$10-per-card grading · the whole scene is in line.</span>
                <span className="badge hit">slab prices +{Math.round((rush.slabPremium - 1) * 100)}%</span>
                {gone && <span className="badge" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>quota GONE — the scene ate the line</span>}
              </div>
              <span className="small"><b style={{ color: 'var(--gold)' }}>{fmtCd(new Date(rush.endsAt ?? Date.now()).getTime() - nowMs)}</b> left</span>
            </div>
            <div className="row small mt8" style={{ justifyContent: 'space-between', gap: 8 }}>
              <span><b>QUOTA {used}/{total}</b> · {mine} yours · {npc} eaten by the scene</span>
              <span className="faint">{Math.max(0, total - used)} slot{total - used === 1 ? '' : 's'} left · queue adds ~{rush.backlogDays}d to every turnaround</span>
            </div>
            <div className="bar mt4" style={{ height: 10, position: 'relative' }} title={`${npc} NPC + ${mine} yours = ${used}/${total} quota used`}>
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${(npc / total) * 100}%`, background: 'rgba(248,113,113,0.7)', borderRadius: 3 }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(npc / total) * 100}%`, width: `${(mine / total) * 100}%`, background: 'var(--yellow)', borderRadius: 3 }} />
            </div>
            <div className="row mt8" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span className="faint small">Slabs you already own sell into the premium; cards submitted now wait out the queue. Ends {new Date(rush.endsAt ?? Date.now()).toLocaleDateString()} — {gone ? 'the special is closed, hold your raws.' : 'get in early, the crowd is eating the line.'}</span>
              {!gone && (
                <button className="primary" onClick={() => { setRushShortcut(true); window.location.hash = '#/grading' }}>
                  🏷 Rush-eligible cards →
                </button>
              )}
            </div>
          </div>
        )
      })()}

      {rec && rec.cardsOwned > 0 && (
        <div className="panel mt14">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>🏆 Collector record</h2>
            <span className="faint small">
              📔 {state?.binders?.count ?? 0} binder{((state?.binders?.count ?? 0)) === 1 ? '' : 's'} · {(state?.binders?.slotted ?? 0).toLocaleString()} slotted · {fmtUsd(state?.binders?.value)}
              {rec.activeStreak > 1 && <> · <b style={{ color: 'var(--gold)' }}>{rec.activeStreak}-day streak</b></>}
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
          {bestPull && bestPull.cardId && (
            <div className="mt14" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <b className="small">👑 Best pull on record</b>
              <div className="mt8">
                <BestPullCard best={bestPull} onOpenCard={openCard} compact />
              </div>
            </div>
          )}

          <div className="grid cols2 mt14">
            <div>
              <b className="small">Biggest gainers</b>
              {rec.gainers.length === 0 ? (
                <div className="faint small mt8">No gainers yet — the market decides, buy low anyway.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} className="mt8">
                  {rec.gainers.map((g) => (
                    <div key={g.cardId + g.condition} className="row" style={{ gap: 10, cursor: 'pointer' }} onClick={() => openCard(g.cardId)}>
                      <div style={{ width: 34 }}><CardImg src={g.image} alt={g.name} cardId={g.cardId} /></div>
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
                  <div style={{ width: 44 }}><CardImg src={rec.bestFlip.image} alt={rec.bestFlip.name} cardId={rec.bestFlip.cardId} /></div>
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

          {ach && (
            <div className="mt14" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b className="small">🏆 Trophy shelf</b>
                <a
                  className="faint small"
                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => { window.location.hash = '#/achievements' }}
                >
                  {ach.unlockedCount}/{ach.total} unlocked — see all
                </a>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {ach.rows.filter((r) => r.unlockedAt).length === 0 && (
                  <span className="faint small">Nothing on the shelf yet — first sale, first gem, first completed set.</span>
                )}
                {ach.rows.filter((r) => r.unlockedAt).slice(-12).map((r) => (
                  <span key={r.id} title={`${r.title} — ${r.desc} (${fmtDate(r.unlockedAt)})`} style={{ fontSize: 18, cursor: 'default' }}>{r.icon}</span>
                ))}
                {(() => { const next = ach.rows.find((r) => r.isNext && !r.unlockedAt); return next ? (
                  <span className="faint small" title={next.desc} style={{ alignSelf: 'center' }}>
                    next: {next.title}{next.label ? ` (${next.label})` : ''}
                  </span>
                ) : null })()}
              </div>
            </div>
          )}
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
              <div className="val" style={{ color: shopPerf.reputation >= 0 ? 'var(--green)' : 'var(--red)' }}>
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
              <div className="val" style={{ color: shopPerf.lifetimeNet >= 0 ? 'var(--green)' : 'var(--red)' }}>
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
                        <div style={{ height: h, background: pos ? 'var(--green, var(--green))' : 'var(--red)', borderRadius: 3, opacity: pos ? 1 : 0.75, cursor: 'pointer' }} />
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
              week of {digest.week} · {digest.sampled} card{digest.sampled === 1 ? '' : 's'} with a week of quotes
              {digest.postedAt ? ` · posted ${timeAgo(digest.postedAt)}` : ' · preview'}
            </span>
          </div>
          {digest.gainers.length === 0 && digest.losers.length === 0 ? (
            // One honest line instead of the same note printed under both
            // columns — "13 cards tracked · Not enough price history yet"
            // (twice) read like a broken catalog on a save that has all
            // 20,641 cards.
            <div className="faint small" style={{ marginTop: 8, lineHeight: 1.5 }}>
              No movers to show yet — a card needs a week of quotes before it can count as a gainer or a drop, and the
              daily price sync fills that in as it runs. Your catalog is fine; the history is still young.
            </div>
          ) : (
          <div className="grid cols2 mt8" style={{ gap: 12 }}>
            {(
              [
                { label: '▲ Top gainers — 7 days', movers: digest.gainers, color: 'var(--green, var(--green))' },
                { label: '▼ Biggest drops — 7 days', movers: digest.losers, color: 'var(--red)' },
              ] as const
            ).map((col) => (
              <div key={col.label}>
                <div className="small" style={{ color: col.color, marginBottom: 6 }}>{col.label}</div>
                {col.movers.length === 0 ? (
                  <div className="faint small">No movers this week.</div>
                ) : (
                  col.movers.slice(0, 5).map((m) => (
                    <div key={m.cardId} className="row" style={{ padding: '4px 0', gap: 8, cursor: 'pointer', borderBottom: '1px solid var(--border-soft)' }}
                      onClick={() => openCard(m.cardId)}>
                      <div style={{ width: 30 }}><CardImg src={m.image} alt={m.name} cardId={m.cardId} /></div>
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
          )}
        </div>
      )}

      {releaseItems.length > 0 && (
        <div className="panel mt14">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>🆕 New releases this week</h2>
            <span className="faint small">
              {state?.sync.delta?.lastRunAt && <>checked {timeAgo(state.sync.delta.lastRunAt)} · </>}
              <button className="ghost small" onClick={() => (window.location.hash = '#/sets')}>Set completion →</button>
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} className="mt8">
            {releaseItems.map((r) => (
              <div key={r.id} className="row" style={{ gap: 10, cursor: 'pointer' }} onClick={() => (window.location.hash = `#/set/${r.id}`)}>
                <div style={{ width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {setsById[r.id]?.symbol_url && <img src={setsById[r.id].symbol_url!} alt={r.name} style={{ width: 22, height: 22, borderRadius: 3 }} loading="lazy" />}
                </div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.name}
                    <span className={`badge ${r.isNew ? 'live' : ''}`} style={{ marginLeft: 6 }}>{r.isNew ? 'NEW' : 'UPDATED'}</span>
                  </div>
                  <div className="faint" style={{ fontSize: 11 }}>
                    {r.cards} card{r.cards === 1 ? '' : 's'} added · {setsById[r.id]?.series ?? ''}
                  </div>
                </div>
                <span className="faint small">{timeAgo(r.at)}<span style={{ marginLeft: 6 }}>→</span></span>
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
                      {conv.next.liveNow
                        ? 'Opening now'
                        : conv.next.nextShowAt
                          ? `${conv.next.nextShowTitle ?? 'Next show'} · ${fmtWhen(conv.next.nextShowAt)}`
                          : `Next rolls in ~${fmtWait(conv.next.nextShowInMin)}`}
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
            {feedRows(activity).slice(0, 7).map(({ row: a, n }) => (
              <div
                key={a.id}
                className="row"
                style={{ gap: 10, ...(a.href ? { cursor: 'pointer' } : {}) }}
                title={a.href ? 'Open' : undefined}
                onClick={() => { if (a.href) window.location.hash = a.href.startsWith('#') ? a.href.slice(1) : a.href }}
              >
                <span>{a.kind === 'sale' ? '💰' : a.kind === 'buy' ? '🛒' : a.kind === 'pack' ? '📦' : a.kind === 'listing' ? '🏷' : a.kind === 'release' ? '🆕' : a.kind === 'show' ? '🏟' : a.kind === 'digest' ? '📋' : a.kind === 'market' ? '📈' : a.kind === 'live' ? '📺' : a.kind === 'yard' ? '🛗' : a.kind === 'insurance' ? '🛡' : '•'}</span>
                <span className="grow small">{n > 1 ? `${n} shops posted new want lists — check the buylist before you sell.` : a.message}</span>
                <span className="faint small">{timeAgo(a.created_at)}{a.href && <span style={{ marginLeft: 4 }}>→</span>}</span>
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
                <div style={{ width: 36 }}><CardImg src={c.image_small} alt={c.name} cardId={c.id} /></div>
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
