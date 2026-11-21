import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, type AchievementsStatus, type CalendarResponse, type CatalogDeltaSummary, type CollectorStats, type ConventionSummary, type MarketDigest, type NetWorthHistory, type PsaRushSection, type ShopStatsResponse } from '../api'
import { useStore } from '../store'
import { DEALS_GATE } from '../route-meta'
import { CardImg, Delta, EmptyState, fmtDate, fmtUsd, fmtWhen, fmtWait, LoadFailure, PriceChart, timeAgo, BestPullCard } from '../components'
import type { ActivityRow, CardRow, SetRow } from '../types'

// ---------------------------------------------------------------------------
// Home — the dashboard.
//
// This screen used to open with four equal KPI boxes (cash / collection /
// inventory / net worth), then stack eight panels of the same weight under it:
// collector record, shop, digest, releases, the scene, the net-worth chart, two
// feeds. Four equal boxes say "these four numbers are equally important", which
// is never true — net worth is the score, cash is the constraint, and inventory
// value is usually zero. So the boxes became one hero: the score big, a split
// bar showing where that money actually is, and the legend under it.
//
// Below that the page answers, in order: what is happening on the clock right
// now (and one button per thing), what your record looks like, what the market
// is doing, and what just happened. Everything still comes from the same
// endpoints — this is a hierarchy pass, not a new dashboard.
// ---------------------------------------------------------------------------

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

const kindIcon = (kind: string) =>
  kind === 'sale' ? '💰' : kind === 'buy' ? '🛒' : kind === 'pack' ? '📦' : kind === 'listing' ? '🏷'
  : kind === 'release' ? '🆕' : kind === 'show' ? '🏟' : kind === 'digest' ? '📋' : kind === 'market' ? '📈'
  : kind === 'live' ? '📺' : kind === 'yard' ? '🛗' : kind === 'insurance' ? '🛡' : '•'

/** Compact "2d 4h" / "3h 20m" / "40m" — the clock copy everywhere on this page. */
function fmtCd(ms: number): string {
  if (ms <= 0) return 'now'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

type NowRow = {
  id: string
  icon: string
  title: string
  meta: ReactNode
  live?: boolean
  action?: { label: string; hash: string }
  bar?: { used: number; total: number; npc: number }
}

export function HomePage() {
  const { state, openCard, setRushShortcut } = useStore()
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
  // The dashboard talks to eleven endpoints. Each used to fail silently, so a
  // dead server looked like a save with no record, no digest and no activity.
  // The page now says which of the two it is; a widget that answers still shows.
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const loadDashboard = useCallback(() => {
    setStatus('loading')
    const reqs = [
      api.activity().then(setActivity),
      api.sets().then((rows) => setSetsById(Object.fromEntries(rows.map((s) => [s.id, s])))),
      api.conventionSummary().then(setConv),
      api.calendar().then(setCal),
      api.netWorthHistory().then(setNw),
      api.collectorStats().then(setRec),
      api.shopStats().then(setShopPerf),
      api.marketDigest().then(setDigest),
      api.achievements().then(setAch),
      api.pullsBest().then(setBestPull),
      api.psaRush().then(setRush),
      api
        .cardsSearch({ sort: 'price_desc', limit: 10, q: '' })
        .then((r) => {
          setWatch(r.cards)
          setPrev(Object.fromEntries(r.cards.map((c) => [c.id, c.market_price])))
        }),
    ]
    Promise.allSettled(reqs).then((settled) =>
      setStatus(settled.some((r) => r.status === 'fulfilled') ? 'ready' : 'error'),
    )
  }, [])

  useEffect(() => { loadDashboard() }, [loadDashboard])

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
  // Until the first state arrives there is no count to quote, so the dashboard
  // stays quiet instead of printing "0 real cards priced" over a full catalogue.
  const catalogCount = state ? (state.sync.cardCount ?? 0) : null

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

  // Where the net worth actually sits — the last recorded week of the history
  // feed. Cash is the only slice you can spend today; that is the whole point
  // of drawing it as a bar instead of four separate boxes.
  const split = (() => {
    const p = nw?.points[nw.points.length - 1]
    if (!p) return null
    const rows = [
      { label: 'Cash', value: p.cash, color: 'var(--green)' },
      { label: 'Collection', value: p.collection, color: 'var(--yellow)' },
      { label: 'Listed', value: p.listed, color: 'var(--blue)' },
      { label: 'Sealed', value: p.sealed, color: 'var(--magenta, #d946ef)' },
    ].filter((r) => r.value > 0)
    const total = rows.reduce((a, r) => a + r.value, 0)
    return total > 0 ? { rows, total } : null
  })()

  // "Right now" — every time-bound thing the scene is doing, most urgent
  // first. Each row carries its own verb so the player never has to guess
  // which door a countdown belongs to.
  const nowRows: NowRow[] = []
  if (cal?.live) {
    const kind = cal.live.kind
    nowRows.push({
      id: 'live',
      icon: kind === 'convention' ? '🎪' : kind === 'tournament' ? '⚔️' : '📩',
      title: cal.live.title,
      live: true,
      meta: cal.live.end
        ? <>ends in <b>{fmtCd(new Date(cal.live.end).getTime() - new Date(cal.serverNow).getTime())}</b></>
        : 'running now — it ends when the scene moves on',
      action: kind === 'convention'
        ? { label: 'Walk the floor', hash: '#/events/conventions' }
        : { label: 'Open the calendar', hash: '#/events/calendar' },
    })
  }
  if (conv?.next.open) {
    nowRows.push({
      id: 'conv',
      icon: '🎪',
      title: conv.next.showName,
      live: true,
      meta: conv.next.entered
        ? <>you're set up inside · doors close in <b>{conv.next.minutesLeft} min</b></>
        : <>entry {fmtUsd(conv.next.entryFee)} · doors close in <b>{conv.next.minutesLeft} min</b></>,
      action: { label: conv.next.entered ? 'Back to your table' : 'Walk in', hash: '#/events/conventions' },
    })
  }
  if (rush?.active) {
    const total = rush.quotaTotal
    const used = Math.min(rush.quotaUsed, total)
    const npc = Math.min(rush.npcUsed ?? 0, used)
    const gone = !rush.specialOpen
    nowRows.push({
      id: 'rush',
      icon: '🏷️',
      title: 'PSA special — $10 slabs',
      meta: gone
        ? <>quota <b>gone</b> — the scene ate the line. Slabs still sell at +{Math.round((rush.slabPremium - 1) * 100)}%.</>
        : <>{used}/{total} quota used · {Math.max(0, total - used)} left · ends in <b>{fmtCd(new Date(rush.endsAt ?? Date.now()).getTime() - nowMs)}</b></>,
      action: gone ? undefined : { label: 'Rush-eligible cards', hash: '#/grading' },
      bar: { used, total, npc },
    })
  }
  if (!cal?.live && cal?.next) {
    const ev = cal.next
    nowRows.push({
      id: 'next',
      icon: ev.kind === 'convention' ? '🎪' : ev.kind === 'tournament' ? '⚔️' : '📩',
      title: ev.title,
      meta: <>starts in <b>{fmtCd(new Date(ev.start).getTime() - new Date(cal.serverNow).getTime())}</b></>,
      action: { label: 'Calendar', hash: '#/events/calendar' },
    })
  }
  // Narrow the union through a local: `conv?.next.open` in a condition does
  // not carry the `open: false` branch into the property reads below.
  const convNext = conv?.next
  if (convNext && !convNext.open && convNext.nextShowAt) {
    nowRows.push({
      id: 'convnext',
      icon: '🛍️',
      title: convNext.nextShowTitle ?? 'The next convention',
      meta: <>{fmtWhen(convNext.nextShowAt)} · {fmtWait(convNext.nextShowInMin)}</>,
      action: { label: 'Conventions', hash: '#/events/conventions' },
    })
  }

  // A brand-new save gets the one thing the dashboard never gave it: a route.
  // The Deals district is gated behind three sales, but the old Home only
  // showed a locked row reading "Make 3 sales" and never named the counter
  // where a sale happens — the Buylist. These steps stay until the gate opens,
  // tick as they are done, and each one lands on the screen that finishes it.
  const sold = state?.progress.salesCount ?? 0
  const firstMoves = state && sold < DEALS_GATE
    ? [
        {
          id: 'rip',
          icon: '📦',
          title: 'Rip your first pack',
          done: state.progress.cardsOwned > 0,
          meta: 'Any set on the shelf, $2.50 and up. The cards land in your Main Collection binder.',
          action: { label: 'Pack Shop', hash: '#/packs' },
        },
        {
          id: 'sell',
          icon: '🧾',
          title: "Sell what you don't keep at the Buylist",
          done: sold > 0,
          meta: 'Six shops buy outright at 55–75% of market — instant cash, no listing wait.',
          action: { label: 'Open the Buylist', hash: '#/market/buylist' },
        },
        {
          id: 'deals',
          icon: '🏷',
          title: `Make ${DEALS_GATE} sales to open the Deals district`,
          done: sold >= DEALS_GATE,
          meta: `${Math.max(0, DEALS_GATE - sold)} to go (${sold}/${DEALS_GATE}) — then the Pawn Shop, Yard Sales and the rest are on the map.`,
          action: { label: 'Keep selling', hash: '#/market/buylist' },
        },
      ]
    : []

  if (status === 'error') {
    return <LoadFailure what="your dashboard" sub="None of the widgets answered the local server. Your save was not touched." onRetry={loadDashboard} />
  }
  if (status === 'loading') {
    return <EmptyState icon="🏠" text="Reading your dashboard…" sub="Net worth, the clock, your record, the market digest and the activity feed." />
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Home</h1>
          <div className="sub">Your collector dashboard — live TCGplayer pricing, every 15 seconds.</div>
        </div>
      </div>

      {state && !syncDone && (
        <div className="panel" style={{ borderColor: 'rgba(59,130,246,0.4)', marginBottom: 14 }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span className="spinner" />
            <div className="grow" style={{ minWidth: 0 }}>
              <b className="small">Building the real card database…</b>
              <div className="home-mini">
                Syncing every Pokémon TCG set from the official API. Browse and rip packs now — prices land as sets arrive.
              </div>
            </div>
            <button className="primary small" onClick={() => (window.location.hash = '#/packs')}>Open packs meanwhile</button>
          </div>
        </div>
      )}

      <div className="panel home-hero">
        <div className="home-kicker">Net worth</div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <div className="home-worth" style={{ color: 'var(--gold)' }}>{fmtUsd(state?.netWorth)}</div>
          {nw?.change != null && (
            <div className="home-delta" style={{ color: nw.change >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {nw.change >= 0 ? '▲ +' : '▼ -'}{fmtUsd(Math.abs(nw.change))} since you started
            </div>
          )}
        </div>

        {split ? (
          <>
            <div className="home-split" title={split.rows.map((r) => `${r.label} ${fmtUsd(r.value)}`).join(' · ')}>
              {split.rows.map((r) => (
                <span key={r.label} style={{ width: `${(r.value / split.total) * 100}%`, background: r.color }} />
              ))}
            </div>
            <div className="home-legend">
              {split.rows.map((r) => (
                <div key={r.label}>
                  <span className="sw" style={{ background: r.color }} />
                  <span>{r.label}</span>
                  <b>{fmtUsd(r.value)}</b>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="home-legend" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
            <div><span className="sw" style={{ background: 'var(--green)' }} /><span>Cash</span><b>{fmtUsd(state?.cash)}</b></div>
            <div><span className="sw" style={{ background: 'var(--yellow)' }} /><span>Collection</span><b>{fmtUsd(state?.collectionValue)}</b></div>
          </div>
        )}
        <div className="home-mini" style={{ marginTop: 8 }}>
          {catalogCount == null ? 'Reading the card catalogue…' : `${catalogCount.toLocaleString()} real cards priced`} · cash is the only slice you can spend today
        </div>
      </div>

      {firstMoves.length > 0 && (
        <div className="panel mt14">
          <div className="home-sec-head">
            <b className="small">🧭 Your first moves</b>
            <span className="faint small">the shortest route to the rest of the game</span>
          </div>
          <div className="home-now">
            {firstMoves.map((m) => (
              <div key={m.id} className="home-now-row">
                <span className="home-now-ico" aria-hidden>{m.done ? '✅' : m.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="home-now-title">
                    {m.title}
                    {m.done && <span className="badge">DONE</span>}
                  </div>
                  <div className="home-now-meta">{m.meta}</div>
                </div>
                <button className="small go" onClick={() => (window.location.hash = m.action.hash)}>
                  {m.action.label}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel mt14">
        <div className="home-sec-head">
          <b className="small">⏱ Right now</b>
          <span className="faint small">what the scene is doing this minute</span>
        </div>
        {nowRows.length === 0 ? (
          <div className="home-mini">
            Nothing on the clock — no convention doors, no live event, no grading special. The market never sleeps, though.
          </div>
        ) : (
          <div className="home-now">
            {nowRows.map((r) => (
              <div key={r.id} className="home-now-row">
                <span className="home-now-ico" aria-hidden>{r.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="home-now-title">
                    {r.title}
                    {r.live && <span className="badge live">LIVE</span>}
                  </div>
                  <div className="home-now-meta">{r.meta}</div>
                  {r.bar && (
                    <div className="bar" style={{ height: 8, position: 'relative', marginTop: 5 }} title={`${r.bar.npc} NPC + ${r.bar.used - r.bar.npc} yours = ${r.bar.used}/${r.bar.total} quota used`}>
                      <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${(r.bar.npc / r.bar.total) * 100}%`, background: 'rgba(248,113,113,0.7)' }} />
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(r.bar.npc / r.bar.total) * 100}%`, width: `${((r.bar.used - r.bar.npc) / r.bar.total) * 100}%`, background: 'var(--yellow)' }} />
                    </div>
                  )}
                </div>
                {r.action && (
                  <button
                    className={`small go${r.live ? ' primary' : ''}`}
                    onClick={() => {
                      if (r.id === 'rush') setRushShortcut(true)
                      window.location.hash = r.action!.hash
                    }}
                  >{r.action.label}</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {rec && rec.cardsOwned > 0 && (
        <div className="panel mt14">
          <div className="home-sec-head">
            <b className="small">🏆 Your record</b>
            <span className="faint small">
              📔 {state?.binders?.count ?? 0} binder{(state?.binders?.count ?? 0) === 1 ? '' : 's'} · {(state?.binders?.slotted ?? 0).toLocaleString()} slotted
              {rec.activeStreak > 1 && <> · <b style={{ color: 'var(--gold)' }}>{rec.activeStreak}-day streak</b></>}
            </span>
          </div>
          <div className="home-stats">
            <div className="home-stat">
              <div className="lbl">Cards owned</div>
              <div className="val">{rec.cardsOwned.toLocaleString()}</div>
              <div className="note">{rec.uniqueCards.toLocaleString()} unique{rec.gradedCount > 0 && ` · ${rec.gradedCount} graded`}</div>
            </div>
            <div className="home-stat">
              <div className="lbl">Invested</div>
              <div className="val">{fmtUsd(rec.totalInvested)}</div>
              <div className="note">now {fmtUsd(rec.collectionValue)}</div>
            </div>
            <div className="home-stat">
              <div className="lbl">Unrealized</div>
              <div className="val" style={{ color: rec.unrealized >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {rec.unrealized >= 0 ? '+' : '-'}{fmtUsd(Math.abs(rec.unrealized))}
              </div>
              <div className="note">vs what you paid</div>
            </div>
            <div className="home-stat">
              <div className="lbl">Days played</div>
              <div className="val">{rec.daysPlayed}</div>
              <div className="note">since {fmtDate(rec.firstPlayed ? rec.firstPlayed : null)}</div>
            </div>
          </div>

          {bestPull && bestPull.cardId && (
            <div className="mt14" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 10 }}>
              <b className="small">👑 Best pull on record</b>
              <div className="mt8">
                <BestPullCard best={bestPull} onOpenCard={openCard} compact />
              </div>
            </div>
          )}

          <div className="mt14" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 10 }}>
            <div className="home-sec-head" style={{ marginBottom: 6 }}>
              <b className="small">Biggest gainers</b>
              <span className="faint small">{rec.salesCount} sale{rec.salesCount === 1 ? '' : 's'} · {fmtUsd(rec.lifetimeEarned)} earned</span>
            </div>
            {rec.gainers.length === 0 ? (
              <div className="home-mini">No gainers yet — the market decides, buy low anyway.</div>
            ) : (
              <div className="stack">
                {/* The same card + grade can appear twice in the holdings feed
                    (two copies bought separately); on a four-line list the twins
                    read as a rendering bug, so collapse them. */}
                {rec.gainers
                  .filter((g, i, arr) => arr.findIndex((x) => x.cardId === g.cardId && x.condition === g.condition) === i)
                  .slice(0, 4)
                  .map((g, i) => (
                  <div key={`${g.cardId}-${g.condition}-${i}`} className="row" style={{ gap: 10, cursor: 'pointer' }} onClick={() => openCard(g.cardId)}>
                    <div style={{ width: 30 }}><CardImg src={g.image} alt={g.name} cardId={g.cardId} /></div>
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

          <div className="mt14" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 10 }}>
            <b className="small">Best flip</b>
            {!rec.bestFlip ? (
              <div className="home-mini" style={{ marginTop: 4 }}>No sales yet — your first flip writes itself here.</div>
            ) : (
              <div className="row" style={{ gap: 10, cursor: 'pointer', marginTop: 6 }} onClick={() => openCard(rec.bestFlip!.cardId)}>
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
            <div className="home-mini" style={{ marginTop: 8 }}>
              realized <b style={{ color: rec.realizedProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {rec.realizedProfit >= 0 ? '+' : '-'}{fmtUsd(Math.abs(rec.realizedProfit))}
              </b> on {rec.salesCount} sale{rec.salesCount === 1 ? '' : 's'}
            </div>
          </div>

          {ach && (
            <div className="mt14" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 10 }}>
              <div className="home-sec-head" style={{ marginBottom: 0 }}>
                <b className="small">🏆 Trophy shelf</b>
                <a
                  className="faint small"
                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => { window.location.hash = '#/achievements' }}
                >{ach.unlockedCount}/{ach.total} unlocked →</a>
              </div>
              <div className="home-trophy">
                {ach.rows.filter((r) => r.unlockedAt).length === 0 && (
                  <span className="home-mini">Nothing on the shelf yet — first sale, first gem, first completed set.</span>
                )}
                {ach.rows.filter((r) => r.unlockedAt).slice(-12).map((r) => (
                  <span key={r.id} title={`${r.title} — ${r.desc} (${fmtDate(r.unlockedAt)})`} style={{ fontSize: 18, cursor: 'default' }}>{r.icon}</span>
                ))}
                {(() => { const next = ach.rows.find((r) => r.isNext && !r.unlockedAt); return next ? (
                  <span className="faint small" title={next.desc}>
                    next: {next.title}{next.label ? ` (${next.label})` : ''}
                  </span>
                ) : null })()}
              </div>
            </div>
          )}
        </div>
      )}

      {nw && nw.points.length >= 2 && (
        <div className="panel mt14">
          <div className="home-sec-head">
            <b className="small">📈 Week by week</b>
            {nw.change != null && (
              <span className="small" style={{ color: nw.change >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                {nw.change >= 0 ? '+' : '-'}{fmtUsd(Math.abs(nw.change))}
              </span>
            )}
          </div>
          <PriceChart history={nw.points.map((p) => ({ value: p.netWorth, at: p.week }))} height={120} />
        </div>
      )}

      <div className="grid cols2 mt14">
        <div className="panel" style={{ margin: 0 }}>
          <h2>Market Watch <span className="badge live">LIVE</span></h2>
          {watch.length === 0 && <EmptyState icon="📈" text="Market loading…" sub="Waiting for the first synced sets." />}
          <div className="stack">
            {/* The price search can return the same card twice (one per
                printing); keying on id alone logged a duplicate-key warning. */}
            {watch.slice(0, 8).map((c, i) => (
              <div key={`${c.id}-${i}`} className="row" style={{ gap: 10, cursor: 'pointer' }} onClick={() => openCard(c.id)}>
                <div style={{ width: 34 }}><CardImg src={c.image_small} alt={c.name} cardId={c.id} /></div>
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

        {digest && digest.sampled > 0 && (
          <div className="panel" style={{ margin: 0 }}>
            <h2>📰 Weekly digest</h2>
            <div className="home-mini" style={{ marginTop: -4, marginBottom: 8 }}>
              week of {digest.week} · {digest.sampled} card{digest.sampled === 1 ? '' : 's'} with a week of quotes
              {digest.postedAt ? ` · posted ${timeAgo(digest.postedAt)}` : ' · preview'}
            </div>
            {digest.gainers.length === 0 && digest.losers.length === 0 ? (
              // One honest line instead of the same note printed under both
              // columns — "13 cards tracked · Not enough price history yet"
              // (twice) read like a broken catalog on a save that has all
              // 20,641 cards.
              <div className="home-mini">
                No movers to show yet — a card needs a week of quotes before it can count as a gainer or a drop, and the
                daily price sync fills that in as it runs. Your catalog is fine; the history is still young.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {([
                  { label: '▲ Top gainers — 7 days', movers: digest.gainers, color: 'var(--green)' },
                  { label: '▼ Biggest drops — 7 days', movers: digest.losers, color: 'var(--red)' },
                ] as const).map((col) => (
                  <div key={col.label}>
                    <div className="small" style={{ color: col.color, marginBottom: 4, fontWeight: 700 }}>{col.label}</div>
                    {col.movers.length === 0 ? (
                      <div className="home-mini">No movers this week.</div>
                    ) : (
                      col.movers.slice(0, 5).map((m, i) => (
                        <div key={`${m.cardId}-${i}`} className="row" style={{ padding: '4px 0', gap: 8, cursor: 'pointer', borderBottom: '1px solid var(--border-soft)' }}
                          onClick={() => openCard(m.cardId)}>
                          <div style={{ width: 28 }}><CardImg src={m.image} alt={m.name} cardId={m.cardId} /></div>
                          <div className="grow" style={{ minWidth: 0 }}>
                            <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                            <div className="faint" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.setName}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div className="small" style={{ color: col.color }}>{m.changePct > 0 ? '+' : ''}{(m.changePct * 100).toFixed(1)}%</div>
                            <div className="faint" style={{ fontSize: 10 }}>{fmtUsd(m.from)} → {fmtUsd(m.to)}</div>
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
      </div>

      {shopPerf && shopPerf.open && (
        <div className="panel mt14">
          <div className="home-sec-head">
            <b className="small">🏪 {shopPerf.shopName}</b>
            <button className="ghost small" onClick={() => (window.location.hash = '#/shop')}>Run the shop →</button>
          </div>
          <div className="home-stats">
            <div className="home-stat">
              <div className="lbl">Today</div>
              <div className="val">{fmtUsd(shopPerf.todayRevenue)}</div>
              <div className="note">{shopPerf.todayCustomers} walk-in{shopPerf.todayCustomers === 1 ? '' : 's'}</div>
            </div>
            <div className="home-stat">
              <div className="lbl">7-day revenue</div>
              <div className="val">{fmtUsd(shopPerf.week.revenue)}</div>
            </div>
            <div className="home-stat">
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
            <div className="home-stat">
              <div className="lbl">Lifetime shop net</div>
              <div className="val" style={{ color: shopPerf.lifetimeNet >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtUsd(shopPerf.lifetimeNet)}</div>
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
                        <div style={{ height: h, background: pos ? 'var(--green)' : 'var(--red)', borderRadius: 3, opacity: pos ? 1 : 0.75, cursor: 'pointer' }} />
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

      {releaseItems.length > 0 && (
        <div className="panel mt14">
          <div className="home-sec-head">
            <b className="small">🆕 New releases this week</b>
            <span className="faint small">
              {state?.sync.delta?.lastRunAt && <>checked {timeAgo(state.sync.delta.lastRunAt)} · </>}
              <button className="ghost small" onClick={() => (window.location.hash = '#/collection/sets')}>Set completion →</button>
            </span>
          </div>
          <div className="stack">
            {releaseItems.map((r) => (
              <div key={r.id} className="row" style={{ gap: 10, cursor: 'pointer' }} onClick={() => (window.location.hash = `#/set/${r.id}`)}>
                <div style={{ width: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {setsById[r.id]?.symbol_url && <img src={setsById[r.id].symbol_url!} alt={r.name} style={{ width: 20, height: 20, borderRadius: 3 }} loading="lazy" />}
                </div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.name}
                    <span className={`badge ${r.isNew ? 'live' : ''}`} style={{ marginLeft: 6 }}>{r.isNew ? 'NEW' : 'UPDATED'}</span>
                  </div>
                  <div className="faint" style={{ fontSize: 11 }}>{r.cards} card{r.cards === 1 ? '' : 's'} added · {setsById[r.id]?.series ?? ''}</div>
                </div>
                <span className="faint small">{timeAgo(r.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel mt14">
        <div className="home-sec-head">
          <b className="small">🕰 Recent activity</b>
          <span className="faint small">
            {activity.length > 0 ? "what's happening in the hobby — your moves and the town's" : ''}
          </span>
        </div>
        {activity.length === 0 && <EmptyState icon="🕰" text="No activity yet" sub="Buy a pack, hunt the market, list a card." />}
        <div className="stack">
          {feedRows(activity).slice(0, 7).map(({ row: a, n }) => (
            <div
              key={a.id}
              className="row"
              style={{ gap: 10, ...(a.href ? { cursor: 'pointer' } : {}) }}
              title={a.href ? 'Open' : undefined}
              onClick={() => { if (a.href) window.location.hash = a.href.startsWith('#') ? a.href.slice(1) : a.href }}
            >
              <span>{kindIcon(a.kind)}</span>
              <span className="grow small">{n > 1 ? `${n} shops posted new want lists — check the buylist before you sell.` : a.message}</span>
              <span className="faint small">{timeAgo(a.created_at)}{a.href && <span style={{ marginLeft: 4 }}>→</span>}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
