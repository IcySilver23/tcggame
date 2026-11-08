import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { gameDayMsFor } from './lib/gameday'
import { fmtUsd } from './components'
import { api, type TodayResponse, type TodayRoll } from './api'
import { HomePage } from './views/Home'
import { CollectionHubView, collectionModeLabel } from './views/CollectionHub'
import { PortfolioView } from './views/Portfolio'
import { SetDetailView } from './views/SetDetail'
import { MarketHubView, marketModeLabel } from './views/MarketHub'
import { PacksView } from './views/Packs'
import { PackOpeningView } from './views/PackOpening'
import { InventoryView } from './views/Inventory'
import { SettingsView } from './views/Settings'
import { AchievementsView } from './views/Achievements'
import { PullHistoryView } from './views/PullHistory'
import { GradingView } from './views/Grading'
import { TradeView } from './views/Trade'
import { ForumView } from './views/Forum'
import { StorageUnitsView } from './views/StorageUnits'
import { DealsView, DEAL_VENUES, DEALS_GATE, dealVenueLabel } from './views/Deals'
// Calendar, Conventions and Card Shows are modes of the Events hub (roadmap
// 10.0) — one door for what's on and whether you're going.
import { EventsHubView, eventsModeLabel, LEGACY_EVENT_ROUTES } from './views/EventsHub'
import { PackBattlesView } from './views/PackBattles'
import { StreamView } from './views/Stream'
import { ResaleView } from './views/Resale'
import { ShopView } from './views/Shop'
import { CardDetailModal } from './views/CardDetail'
import { StartingTutorial } from './views/Tutorial'
import { ChangelogModal, useWhatsNewBadge } from './views/WhatsNew'
import { NotificationBell } from './views/Notifications'
import { HoloDebugLauncher } from './foil/HoloDebug'

/** Dev-only surfaces. A packaged build has no inspector and no way to open one. */
const DEV_BUILD = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)

export type ViewId =
  | 'home' | 'collection' | 'portfolio' | 'set' | 'binder' | 'market' | 'packs' | 'opening' | 'inventory' | 'grading' | 'trade' | 'forum'  | 'events'  | 'battles' | 'stream'  | 'resale' | 'shop' | 'deals' | 'storage' | 'settings' | 'pulls-history' | 'achievements'

type UnlockState = { cash: number; collectionValue: number; inventoryValue: number; netWorth: number; progress: { cardsOwned: number; salesCount: number; followers: number; hasShop: boolean } }
type NavEntry = { id: ViewId; label: string; icon: string; section: string; /** When set, the view stays locked (shown as a 🔒 hint row) until the predicate fires. */ locked?: (s: UnlockState) => boolean; hint?: string; /** Tie-break for next-unlock sorting when two goals need the same progress. */ goal?: number }

const NAV: NavEntry[] = [
  { id: 'home', label: 'Home', icon: '◉', section: '' },
  { id: 'collection', label: 'Collection', icon: '▤', section: 'COLLECT' },
  { id: 'portfolio', label: 'Portfolio', icon: '📈', section: 'COLLECT' },
  // Binders, Set Completion and Wishlist are MODES of the Collection hub now
  // (roadmap 8.0) — four ways of looking at the same cards, one door.
  { id: 'achievements', label: 'Achievements', icon: '🏆', section: '' },
  { id: 'grading', label: 'Grading', icon: '⚖', section: '' },
  { id: 'market', label: 'Market', icon: '⇄', section: 'MARKET' },
  { id: 'packs', label: 'Pack Shop', icon: '📦', section: '' },
  // Auction House and Buylist are MODES of the Market hub now (roadmap 9.0)
  // — three ways of buying and selling a card, one door.
  { id: 'trade', label: 'Trading Post', icon: '🔁', section: '' },
  { id: 'forum', label: 'Community', icon: '🫂', section: '' },
  // One door for seven venues (roadmap 1.0). The gate is the EARLIEST venue
  // gate, so the hub can never open onto an empty shell — unlocking it always
  // unlocks the Pawn Shop with it. The venues' own gates live in DEAL_VENUES
  // and print on the tabs inside.
  { id: 'deals', label: 'Deals', icon: '🏷', section: 'DEALS', locked: (s) => s.progress.salesCount >= DEALS_GATE, hint: `Make ${DEALS_GATE} sales`, goal: DEALS_GATE },
  // One door for the calendar, the convention floor and your own shows
  // (roadmap 10.0). The calendar is the index — it already lists convention
  // weekends and show windows — and the other two are what you attend. The old
  // #/calendar, #/convention and #/shows hashes normalize into it below.
  { id: 'events', label: 'Events', icon: '🎪', section: 'EVENTS' },
  { id: 'inventory', label: 'Inventory', icon: '🗃', section: 'BUSINESS' },
  // Storage is always visible — it's the answer to "where do I put more cards?"
  // and hiding it behind a sales count left players hunting for it. The
  // delinquent-unit auctions inside stay as the flavor of the page.
  { id: 'storage', label: 'Storage & Auctions', icon: '🗝️', section: '' },
  { id: 'shop', label: 'Card Shop', icon: '🏪', section: '', locked: (s) => s.cash >= 500, hint: 'Save $500', goal: 500 },
  { id: 'resale', label: 'Resale Desk', icon: '💼', section: '', locked: (s) => s.cash >= 400, hint: 'Save $400', goal: 400 },
  { id: 'battles', label: 'Pack Battles', icon: '⚔️', section: 'PLAY' },
  { id: 'stream', label: 'Stream', icon: '📡', section: '', locked: (s) => s.progress.followers >= 5, hint: 'Gather 5 followers', goal: 5 },
  { id: 'settings', label: 'Settings', icon: '⚙', section: 'SYSTEM' },
]

/**
 * The in-game day clock (top right): DAY n with a progress bar filling toward
 * the next day. A game day is 12 real hours — rent, wear, disasters, and save
 * snapshots all roll at the 00:00/12:00 UTC boundaries — so the bar shows how
 * close the next daily roll (and the next save snapshot) is. Ticks locally
 * every 15s to stay smooth without hammering the server.
 */
const ROLL_ICON: Record<string, string> = {
  rent: '🏪',
  mortgage: '🏠',
  payroll: '👷',
  insurance: '🛡',
  lockers: '🗝️',
  vault: '🔐',
  interest: '🏦',
  snapshot: '💾',
  wear: '🀄',
  disaster: '🎲',
}

function DayClock({ day }: { day?: { number: number; progress: number; resetsAt: string; lengthHours: 12 | 24 } }) {
  const [, setTick] = useState(0)
  const [hover, setHover] = useState(false)
  const [today, setToday] = useState<TodayResponse | null>(null)
  const hoverT = useRef<number | undefined>(undefined)
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 15_000)
    return () => clearInterval(t)
  }, [])
  // Fresh rolls on every hover-open — checkboxes stay honest even across midnight.
  useEffect(() => {
    if (hover) api.today().then(setToday).catch(() => {})
  }, [hover])
  if (!day) return null
  // Recompute progress locally from resetsAt so the bar moves between polls.
  const remaining = Math.max(0, new Date(day.resetsAt).getTime() - Date.now())
  const progress = Math.min(1, Math.max(0, 1 - remaining / gameDayMsFor(day.lengthHours ?? 12)))
  const hoursLeft = Math.floor(remaining / 3_600_000)
  const minsLeft = Math.floor((remaining % 3_600_000) / 60_000)
  // Final hour: the chip turns into a countdown so rent/wear/snapshot/disaster never land unseen.
  const urgent = remaining <= 10 * 60_000
  const finalHour = remaining <= 3_600_000
  const cls = finalHour ? (urgent ? 'stat dayclock urgent' : 'stat dayclock finalhour') : 'stat dayclock'
  const countdown = `${Math.floor(remaining / 60_000)}:${String(Math.floor((remaining % 60_000) / 1_000)).padStart(2, '0')}`
  const rolls = today?.rolls ?? []
  const knownOut = rolls.reduce((a, r) => a + (r.amount ?? 0), 0)
  const daily = rolls.filter((r) => r.cadence === 'daily')
  const weekly = rolls.filter((r) => r.cadence === 'weekly')
  return (
    <div
      className={cls}
      onMouseEnter={() => { window.clearTimeout(hoverT.current); setHover(true) }}
      onMouseLeave={() => { hoverT.current = window.setTimeout(() => setHover(false), 250) }}
      style={{ cursor: 'pointer', position: 'relative' }}
    >
      <span className="lbl">{finalHour ? 'Rolls in' : 'Day'}</span>
      {finalHour
        ? <span className="val">{countdown}</span>
        : <span className="val">{day.number}</span>}
      <div className="daybar"><div className="dayfill" style={{ width: `${progress * 100}%` }} /></div>
      {hover && (
        <div className="daydrop" onClick={(e) => e.stopPropagation()}>
          <div className="daydrop-head">
            <b className="small">Today — game day {day.number}</b>
            <span className="small faint">{finalHour ? `${countdown} to the rolls` : `~${hoursLeft}h ${minsLeft}m to the rolls`}</span>
          </div>
          {today == null && <div className="faint small" style={{ padding: '6px 0' }}>loading today's rolls…</div>}
          {daily.map((r) => <DayRollRow key={r.kind} r={r} />)}
          {weekly.length > 0 && (
            <>
              <div className="small faint" style={{ margin: '6px 0 2px', letterSpacing: '0.08em' }}>WEEKLY</div>
              {weekly.map((r) => <DayRollRow key={r.kind} r={r} />)}
            </>
          )}
          {knownOut > 0 && (
            <div className="small faint" style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
              known out <b style={{ color: 'var(--red, #e0644d)' }}>-{fmtUsd(knownOut)}</b> at the next 00:00/12:00 UTC boundary
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** One row of the day-clock hover dropdown — icon, label, fired/amount state. */
function DayRollRow({ r }: { r: TodayRoll }) {
  const fired = r.firedKey === '1'
  return (
    <div className="row" style={{ gap: 8, padding: '4px 0', borderTop: '1px solid var(--border)', opacity: fired ? 0.55 : 1, alignItems: 'center' }}>
      <span style={{ width: 16, textAlign: 'center', fontSize: 12 }}>{fired ? '✅' : ROLL_ICON[r.kind] ?? '•'}</span>
      <span className="small" style={{ flex: 1, minWidth: 0, textDecoration: fired ? 'line-through' : undefined, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
      <span className="small" style={{ whiteSpace: 'nowrap', color: r.amount && r.amount > 0 && !fired ? 'var(--red, #e0644d)' : undefined }}>
        {fired ? 'done' : r.amount != null && r.amount > 0 ? `-${fmtUsd(r.amount)}` : r.cadence === 'weekly' ? 'weekly' : 'next boundary'}
      </span>
    </div>
  )
}

/** Current progress toward a goal — powers the (cur/goal) quest-counter in hint rows. */
function goalProgress(n: NavEntry, s: UnlockState): { cur: number; goal: number } {
  if (n.id === 'shop' || n.id === 'resale') return { cur: Math.floor(s.cash), goal: n.goal! }
  if (n.id === 'stream') return { cur: s.progress.followers, goal: n.goal! }
  return { cur: s.progress.salesCount, goal: n.goal! }
}

/** Dark ⇄ light chrome. Persisted in localStorage; the store applies the
 *  attribute to <html> so the first paint is already right. */
function ThemeToggle() {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const dark = theme === 'dark'
  return (
    <button
      className="theme-toggle"
      title={dark ? 'Switch to the light (paper) theme' : 'Switch to the dark theme'}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <span className="knob" aria-hidden>{dark ? '☾' : '☀'}</span>
      <span className="lbl">{dark ? 'Dark' : 'Light'}</span>
    </button>
  )
}

export default function App() {
  const { state, refreshState, toasts, dismissToast, detailCardId, toast } = useStore()
  const [whatsNewCount, refreshWhatsNew] = useWhatsNewBadge()
  const [showChangelog, setShowChangelog] = useState(false)

  // Routing: hash-first (#/view), with path-fallback for packaged mode where
  // the server SPA-serves deep links like /buylist. Path mode re-render comes
  // from popstate; the render is derived, so a plain reload also works.
  const pathRoute = window.location.pathname.replace(/^\//, '')
  const hash = window.location.hash.replace('#/', '') || pathRoute
  const [rawRoute, rawParam] = hash.split('/') as [string, string?]
  // The seven venues used to be routes of their own, and the feed still
  // carries hrefs pointing at them — 200 rows in an existing save say #/live
  // alone. Old links normalize into the hub rather than falling through to
  // "page not found — headed home".
  const legacyVenue = DEAL_VENUES.some((v) => v.id === rawRoute)
  // The same treatment for the four COLLECT screens: Binders, Set Completion
  // and Wishlist are modes of the Collection hub now (roadmap 8.0), and the
  // Home dashboard plus the set browser still write those old hashes.
  const legacyCollect = rawRoute === 'binders' || rawRoute === 'sets' || rawRoute === 'wishlist'
  // Auction House and Buylist are modes of the Market hub now (roadmap 9.0).
  const legacyMarket = rawRoute === 'auctions' || rawRoute === 'buylist'
  // Same treatment for EVENTS (roadmap 10.0): calendar rows, the Home
  // dashboard and server-written feed items still link #/convention, #/shows
  // and #/calendar, so those map onto hub modes rather than bouncing home.
  const legacyEvents = LEGACY_EVENT_ROUTES[rawRoute]
  const route = legacyVenue ? 'deals' : legacyCollect ? 'collection' : legacyMarket ? 'market' : legacyEvents ? 'events' : rawRoute
  const routeParam = legacyVenue || legacyCollect || legacyMarket ? rawRoute : legacyEvents ?? rawParam
  const view = (route || 'home') as ViewId

  useEffect(() => {
    refreshState()
    const t = setInterval(refreshState, 15000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onNav = () => useStore.setState((s) => ({ ...s }))
    window.addEventListener('hashchange', onNav)
    window.addEventListener('popstate', onNav)
    return () => {
      window.removeEventListener('hashchange', onNav)
      window.removeEventListener('popstate', onNav)
    }
  }, [])

  // Unlock toasts: when a previously-locked view becomes reachable, celebrate
  // it once. The first pass seeds the baseline silently (a veteran save that
  // loads already-unlocked stays quiet); only live transitions toast.
  const unlockedSeen = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!state?.progress) return
    const snap = { cash: state.cash, collectionValue: state.collectionValue, inventoryValue: state.inventoryValue, netWorth: state.netWorth, progress: state.progress }
    const nowOpen = new Set(NAV.filter((n) => n.locked && n.locked(snap)).map((n) => n.id))
    const allLockedIds = NAV.filter((n) => n.locked).map((n) => n.id)
    if (unlockedSeen.current === null) {
      unlockedSeen.current = new Set(allLockedIds.filter((id) => nowOpen.has(id)))
      return
    }
    for (const id of allLockedIds) {
      if (nowOpen.has(id) && !unlockedSeen.current.has(id)) {
        unlockedSeen.current.add(id)
        const entry = NAV.find((n) => n.id === id)
        toast(`🔓 Unlocked: ${entry?.label ?? id}`, 'good')
      }
    }
  }, [state?.cash, state?.collectionValue, state?.inventoryValue, state?.netWorth, state?.progress])

  const nav = (id: ViewId) => {
    // Locked views stay locked: state polls every 15s, so a stale hash from an
    // unlock that just lapsed (or a hand-typed URL) bounces home with a hint.
    const entry = NAV.find((n) => n.id === id)
    if (entry?.locked && state?.progress) {
      const snap = { cash: state.cash, collectionValue: state.collectionValue, inventoryValue: state.inventoryValue, netWorth: state.netWorth, progress: state.progress }
      if (!entry.locked(snap)) { toast(`🔒 Locked — ${entry.hint ?? 'keep playing'}`, 'bad'); window.location.hash = '#/home'; return }
    }
    window.location.hash = `#/${id}`
  }

  // Force-hash guard: if the deep link points at a locked view, route home.
  // Unknown views (stale bookmarks, typos) also bounce home — previously they
  // rendered a blank main with no explanation.
  const activeEntry = NAV.find((n) => n.id === view)
  // 'set' and 'binder' are param routes (not nav entries) — only known with a param.
  // 'opening' and 'pulls-history' are hidden ceremony-adjacent views (deep-linked
  // from the Pack Shop and the ceremony summary) — known without a nav entry.
  const knownView = !!activeEntry || view === 'home' || view === 'opening' || view === 'pulls-history' || ((view === 'set' || view === 'binder') && !!routeParam)
  const viewLocked = (!!activeEntry?.locked && !!state?.progress && !activeEntry.locked({ cash: state.cash, collectionValue: state.collectionValue, inventoryValue: state.inventoryValue, netWorth: state.netWorth, progress: state.progress }))
  const needsParam = (view === 'set' || view === 'binder') && !routeParam
  const unknownView = !knownView && !viewLocked
  useEffect(() => {
    if (unknownView) { toast(needsParam ? 'Pick a set or binder first' : `Page "${view}" not found — headed home`, 'bad'); window.location.hash = '#/home' }
  }, [unknownView, view, needsParam])

  const currentLabel =
    view === 'set' ? 'Set Detail'
    : view === 'binder' ? 'Binder'
    : view === 'pulls-history' ? 'Pull History'
    : view === 'opening' ? 'Pack Opening'
    : viewLocked ? 'Home'
    : view === 'deals' ? dealVenueLabel(routeParam) ?? 'Deals'
    : view === 'collection' ? collectionModeLabel(routeParam) ?? 'Collection'
    : view === 'market' ? marketModeLabel(routeParam) ?? 'Market'
    : view === 'events' ? eventsModeLabel(routeParam) ?? 'Events'
    : NAV.find((n) => n.id === view)?.label ?? 'TCG Life'

  return (
    <div className="app">
      {DEV_BUILD && <HoloDebugLauncher />}
      <aside className="sidebar">
        <div className="brand">
          <span className="pokeball" aria-hidden />
          <div>
            <h1>TCG <span className="accent">LIFE</span></h1>
            <div className="tag">Collector Simulator</div>
          </div>
        </div>
        <NotificationBell />
        {(() => {
          const snap: UnlockState | null = state?.progress
            ? { cash: state.cash, collectionValue: state.collectionValue, inventoryValue: state.inventoryValue, netWorth: state.netWorth, progress: state.progress }
            : null
          // Every tab is always visible: locked ones render as their own 🔒 row
          // carrying the exact unlock requirement (hover = full sentence, click =
          // the same bounce-home guard as a deep link). Section membership is
          // positional: continuation items carry section '', so resolve each
          // entry to the last header actually printed above it.
          const effective: string[] = []
          let cur = ''
          for (const n of NAV) { if (n.section) cur = n.section; effective.push(cur) }
          const printed = new Set<string>()
          return NAV.map((n, i) => {
            const isLocked = snap ? !!(n.locked && !n.locked(snap)) : false
            const sec = effective[i]
            const sectionChanged = sec && !printed.has(sec)
            if (sectionChanged) printed.add(sec)
            return (
              <div key={n.id} style={{ display: 'contents' }}>
                {sectionChanged && <div className="nav-section">{sec}</div>}
                {isLocked ? (
                  <div className="nav-item locked" title={`${n.label} — ${n.hint ?? 'keep playing'}`} onClick={() => nav(n.id)}>
                    <span className="ico">🔒</span>
                    <span className="lock-label">
                      {n.label}
                      <span className="nav-req">{n.hint}</span>
                    </span>
                    {snap && (() => { const p = goalProgress(n, snap); return <span className="lock-progress">{p.cur}/{p.goal}</span> })()}
                  </div>
                ) : (
                  <div className={`nav-item ${view === n.id ? 'active' : ''}`} onClick={() => nav(n.id)} title={n.label}>
                    <span className="ico">{n.icon}</span>
                    <span className="nav-label">{n.label}</span>
                    {n.id === 'inventory' && (state?.counters?.authVerdicts ?? 0) + (state?.counters?.gradingReady ?? 0) > 0 && (
                      <span className="nav-badge">{(state?.counters?.authVerdicts ?? 0) + (state?.counters?.gradingReady ?? 0)}</span>
                    )}
                  </div>
                )}
              </div>
            )
          })
        })()}
        <div className="grow" />
        <div className="nav-item" onClick={() => setShowChangelog(true)}>
          <span className="ico">✨</span>
          <span className="nav-label">What's New</span>
          {whatsNewCount > 0 && <span className="whatsnew-badge">{whatsNewCount}</span>}
        </div>
        <div className="footer-note" style={{ padding: '8px 10px' }}>
          Real data via pokemontcg.io · prices TCGplayer USD
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            <span className="logo-mini">TCG LIFE</span>
            <span className="crumb-sep">/</span>
            <span className="crumb">{currentLabel}</span>
          </div>
          <div className="stat-strip">
            <DayClock day={state?.day} />
            <div className="stat hero"><span className="lbl">Cash</span><span className="val">{fmtUsd(state?.cash)}</span></div>
            <div className="stat"><span className="lbl">Net Worth</span><span className="val">{fmtUsd(state?.netWorth)}</span></div>
            <ThemeToggle />
          </div>
        </header>

        {state?.sync.running && (
          <div className="syncbar">
            <span className="spinner" />
            <span>
              Syncing real card database — {state.sync.cardCount.toLocaleString()} cards
              {state.sync.currentSet ? ` · ${state.sync.currentSet}` : ''}
            </span>
            <div className="bar">
              <div className="fill" style={{ width: state.sync.setsTotal ? `${(state.sync.setsDone / state.sync.setsTotal) * 100}%` : '10%' }} />
            </div>
            <span>{state.sync.setsTotal ? `${state.sync.setsDone}/${state.sync.setsTotal} sets` : 'starting…'}</span>
          </div>
        )}

        <main className="content">
          {/* Keyed screen: each route fades in as its own scene. */}
          <div className="screen" key={`${view}:${routeParam ?? ''}`}>
          {viewLocked || unknownView ? <HomePage /> : (
            <>
              {view === 'home' && <HomePage />}
              {view === 'collection' && <CollectionHubView mode={routeParam} />}
              {view === 'portfolio' && <PortfolioView />}
              {view === 'achievements' && <AchievementsView />}
              {view === 'set' && routeParam && <SetDetailView setId={routeParam} />}
              {view === 'market' && <MarketHubView mode={routeParam} />}
              {view === 'packs' && <PacksView />}
              {view === 'opening' && <PackOpeningView />}
              {view === 'inventory' && <InventoryView />}
              {view === 'grading' && <GradingView />}
              {view === 'trade' && <TradeView />}
              {view === 'forum' && <ForumView />}
              {view === 'storage' && <StorageUnitsView />}
              {view === 'deals' && <DealsView venue={routeParam} />}
              {view === 'events' && <EventsHubView mode={routeParam} />}
              {view === 'battles' && <PackBattlesView />}
              {view === 'stream' && <StreamView />}
              {view === 'resale' && <ResaleView />}
              {view === 'shop' && <ShopView />}
              {view === 'settings' && <SettingsView />}
              {view === 'pulls-history' && <PullHistoryView />}
            </>
          )}
          </div>
        </main>
      </div>

      {detailCardId && <CardDetailModal />}
      {showChangelog && <ChangelogModal onClose={() => { setShowChangelog(false); refreshWhatsNew() }} />}
      <StartingTutorial />
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>{t.text}</div>
        ))}
      </div>
    </div>
  )
}
