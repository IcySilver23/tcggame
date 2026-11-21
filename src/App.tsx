import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { gameDayMsFor } from './lib/gameday'
import { fmtUsd } from './format'
import { api, type TodayResponse, type TodayRoll, type UpdateStatus } from './api'
// Route metadata (labels, gates, legacy hashes) lives in its own module so the
// shell never imports a screen just to name it in the breadcrumb.
import { collectionModeLabel, dealVenueLabel, DEALS_GATE, DEAL_VENUE_IDS, eventsModeLabel, inventoryModeLabel, LEGACY_EVENT_ROUTES, marketModeLabel } from './route-meta'
import { useWhatsNewBadge } from './changelog-badge'
import { NotificationBell } from './views/Notifications'

// Route-level code splitting (roadmap 16.0): each screen is its own chunk, so
// the shell, sidebar and day clock paint without waiting on the market, the
// shop, the foil inspector or the pack ceremony. Opening a screen fetches its
// chunk once; revisits are served from the browser cache.
const HomePage = lazy(() => import('./views/Home').then((m) => ({ default: m.HomePage })))
const CollectionHubView = lazy(() => import('./views/CollectionHub').then((m) => ({ default: m.CollectionHubView })))
const PortfolioView = lazy(() => import('./views/Portfolio').then((m) => ({ default: m.PortfolioView })))
const SetDetailView = lazy(() => import('./views/SetDetail').then((m) => ({ default: m.SetDetailView })))
const MarketHubView = lazy(() => import('./views/MarketHub').then((m) => ({ default: m.MarketHubView })))
const PacksView = lazy(() => import('./views/Packs').then((m) => ({ default: m.PacksView })))
const PackOpeningView = lazy(() => import('./views/PackOpening').then((m) => ({ default: m.PackOpeningView })))
const InventoryHubView = lazy(() => import('./views/InventoryHub').then((m) => ({ default: m.InventoryHubView })))
const SettingsView = lazy(() => import('./views/Settings').then((m) => ({ default: m.SettingsView })))
const AchievementsView = lazy(() => import('./views/Achievements').then((m) => ({ default: m.AchievementsView })))
const PullHistoryView = lazy(() => import('./views/PullHistory').then((m) => ({ default: m.PullHistoryView })))
const GradingView = lazy(() => import('./views/Grading').then((m) => ({ default: m.GradingView })))
const TradeView = lazy(() => import('./views/Trade').then((m) => ({ default: m.TradeView })))
const ForumView = lazy(() => import('./views/Forum').then((m) => ({ default: m.ForumView })))
const DealsView = lazy(() => import('./views/Deals').then((m) => ({ default: m.DealsView })))
const EventsHubView = lazy(() => import('./views/EventsHub').then((m) => ({ default: m.EventsHubView })))
const PackBattlesView = lazy(() => import('./views/PackBattles').then((m) => ({ default: m.PackBattlesView })))
const StreamView = lazy(() => import('./views/Stream').then((m) => ({ default: m.StreamView })))
const ResaleView = lazy(() => import('./views/Resale').then((m) => ({ default: m.ResaleView })))
const ShopView = lazy(() => import('./views/Shop').then((m) => ({ default: m.ShopView })))
const CardDetailModal = lazy(() => import('./views/CardDetail').then((m) => ({ default: m.CardDetailModal })))
const StartingTutorial = lazy(() => import('./views/Tutorial').then((m) => ({ default: m.StartingTutorial })))
const ChangelogModal = lazy(() => import('./views/WhatsNew').then((m) => ({ default: m.ChangelogModal })))

/** What the content pane shows while a screen's chunk is in flight. */
function ScreenFallback() {
  return <div className="empty" style={{ minHeight: 240 }}><span className="spinner" /> Loading…</div>
}

/** Dev-only inspector. The ternary is folded at build time, so a packaged build
 *  carries no launcher and no inspector chunk. */
const HoloDebugLauncher = import.meta.env.DEV
  ? lazy(() => import('./foil/HoloDebug').then((m) => ({ default: m.HoloDebugLauncher })))
  : null

export type ViewId =
  | 'home' | 'collection' | 'portfolio' | 'set' | 'binder' | 'market' | 'packs' | 'opening' | 'inventory' | 'grading' | 'trade' | 'forum'  | 'events'  | 'battles' | 'stream'  | 'resale' | 'shop' | 'deals' | 'settings' | 'pulls-history' | 'achievements'

type UnlockState = { cash: number; collectionValue: number; inventoryValue: number; netWorth: number; progress: { cardsOwned: number; salesCount: number; followers: number; hasShop: boolean } }
type NavEntry = { id: ViewId; label: string; icon: string; section: string; /** When set, the view stays locked (shown as a 🔒 hint row) until the predicate fires. */ locked?: (s: UnlockState) => boolean; hint?: string; /** One sentence of the locked screen's own guidance, shown on the lock row. */ note?: string; /** Tie-break for next-unlock sorting when two goals need the same progress. */ goal?: number }

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
  // Storage & Auctions is a mode of Inventory now (roadmap 11.0) — one door
  // for the cards and the roof over them. The capacity strip and every saved
  // #/storage link still open that mode.
  { id: 'inventory', label: 'Inventory', icon: '🗃', section: 'BUSINESS' },
  { id: 'shop', label: 'Card Shop', icon: '🏪', section: '', locked: (s) => s.cash >= 500, hint: 'Save $500 · lease $250', note: '$6/day while stocked — fill a case and walk-ins buy.', goal: 500 },
  { id: 'resale', label: 'Resale Desk', icon: '💼', section: '', locked: (s) => s.cash >= 400, hint: 'Save $400', note: 'Sellers leave lots priced under market — buy, then flip the cards.', goal: 400 },
  { id: 'battles', label: 'Pack Battles', icon: '⚔️', section: 'PLAY' },
  // Streaming EARNS the followers, so gating Stream behind five of them was a
  // deadlock on a fresh save: the one screen that grows the channel was the one
  // the channel count kept shut. It opens from the start; the default following
  // is what you build on.
  { id: 'stream', label: 'Stream', icon: '📡', section: '' },
  { id: 'settings', label: 'Settings', icon: '⚙', section: 'SYSTEM' },
]

/**
 * Locked views that carry their own explanation screen. Deals is the one that
 * does: its hub lists every venue and, while the gate is still shut, says what
 * actually counts as a sale — the Market, the Buylist, the Trading Post and
 * shop cases. Bouncing that page home hid the answer behind the very lock that
 * asked the question, so the door opens onto its own explanation instead.
 */
const SELF_GATED_VIEWS: ViewId[] = ['deals']

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
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateDismissed, setUpdateDismissed] = useState(false)

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
  const legacyVenue = DEAL_VENUE_IDS.includes(rawRoute)
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
  // Storage & Auctions was its own door before roadmap 11.0. The capacity
  // strip and old bookmarks still write #/storage, so it lands on the
  // Inventory hub's storage mode instead of bouncing home.
  const legacyStorage = rawRoute === 'storage'
  const route = legacyVenue ? 'deals' : legacyCollect ? 'collection' : legacyMarket ? 'market' : legacyEvents ? 'events' : legacyStorage ? 'inventory' : rawRoute
  const routeParam = legacyVenue || legacyCollect || legacyMarket ? rawRoute : legacyEvents ?? (legacyStorage ? 'storage' : rawParam)
  const view = (route || 'home') as ViewId

  useEffect(() => {
    refreshState()
    const t = setInterval(refreshState, 15000)
    return () => clearInterval(t)
  }, [])

  // One update check per launch. A just-installed version opens What's New
  // straight away; otherwise a newer setup in Downloads gets an offer. The
  // marker is cleared only after we have acted on it, so a failed hand-off
  // cannot make the changelog pop up on every reload.
  useEffect(() => {
    let alive = true
    api.updateCheck().then((u) => {
      if (!alive) return
      if (u.justUpdated) {
        setShowChangelog(true)
        api.updateSeen().catch(() => {})
      } else if (u.available) {
        setUpdate(u)
      }
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  const applyUpdate = async () => {
    if (!update?.version || updateBusy) return
    setUpdateBusy(true)
    try {
      const r = await api.updateApply(update.version)
      if (!r.ok) throw new Error(r.error || 'Update failed')
      toast(`Installing v${r.version ?? update.version} — the game will reopen when it is ready.`, 'good')
    } catch (err) {
      setUpdateBusy(false)
      toast(`Update failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'bad')
    }
  }

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
    // Views with their own gate screen are the exception — Deals explains how
    // to earn the sales it wants, and that explanation is the whole point.
    const entry = NAV.find((n) => n.id === id)
    if (entry?.locked && state?.progress && !SELF_GATED_VIEWS.includes(id)) {
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
  const viewLocked = (!!activeEntry?.locked && !SELF_GATED_VIEWS.includes(view) && !!state?.progress && !activeEntry.locked({ cash: state.cash, collectionValue: state.collectionValue, inventoryValue: state.inventoryValue, netWorth: state.netWorth, progress: state.progress }))
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
    : view === 'inventory' ? inventoryModeLabel(routeParam) ?? 'Inventory'
    : view === 'deals' ? dealVenueLabel(routeParam) ?? 'Deals'
    : view === 'collection' ? collectionModeLabel(routeParam) ?? 'Collection'
    : view === 'market' ? marketModeLabel(routeParam) ?? 'Market'
    : view === 'events' ? eventsModeLabel(routeParam) ?? 'Events'
    : NAV.find((n) => n.id === view)?.label ?? 'TCG Life'

  return (
    <div className="app">
      {HoloDebugLauncher && <Suspense fallback={null}><HoloDebugLauncher /></Suspense>}
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
          // carrying the exact unlock requirement (hover = full sentence; click
          // = the same guard as a deep link, except a view with its own gate
          // screen, which opens that screen). Section membership is
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
                  <div className="nav-item locked" title={`${n.label} — ${n.hint ?? 'keep playing'}${n.note ? `. ${n.note}` : ''}`} onClick={() => nav(n.id)}>
                    <span className="ico">🔒</span>
                    <span className="lock-label">
                      {n.label}
                      <span className="nav-req">{n.hint}</span>
                      {n.note && <span className="nav-note">{n.note}</span>}
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
          <Suspense fallback={<ScreenFallback />}>
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
              {view === 'inventory' && <InventoryHubView mode={routeParam} />}
              {view === 'grading' && <GradingView />}
              {view === 'trade' && <TradeView />}
              {view === 'forum' && <ForumView />}
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
          </Suspense>
          </div>
        </main>
      </div>

      <Suspense fallback={null}>
        {detailCardId && <CardDetailModal />}
        {showChangelog && <ChangelogModal onClose={() => { setShowChangelog(false); refreshWhatsNew() }} />}
        {update?.available && !updateDismissed && !showChangelog && (
          <div className="modal-backdrop">
            <div className="modal" style={{ width: 'min(470px, 94vw)' }}>
              <div className="modal-head">
                <div>
                  <h2 style={{ margin: 0 }}>Update available</h2>
                  <div className="faint small">TCG Life v{update.version} is ready — you're on v{update.currentVersion}.</div>
                </div>
              </div>
              <p className="small" style={{ lineHeight: 1.6, marginTop: 0 }}>
                {updateBusy
                  ? 'Installing now. The game will close and reopen — your save, collection and settings stay exactly as they are.'
                  : 'Update now closes the game, installs the new version, and opens it again. Your save, collection and settings stay exactly as they are.'}
              </p>
              {update.installerName && <div className="faint small" style={{ marginBottom: 14 }}>Found {update.installerName}.</div>}
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                {!updateBusy && <button className="ghost" onClick={() => setUpdateDismissed(true)}>Later</button>}
                <button className="primary" disabled={updateBusy} onClick={applyUpdate}>{updateBusy ? 'Updating…' : 'Update now'}</button>
              </div>
            </div>
          </div>
        )}
        <StartingTutorial />
      </Suspense>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>{t.text}</div>
        ))}
      </div>
    </div>
  )
}
