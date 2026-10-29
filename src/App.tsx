import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { gameDayMsFor } from './lib/gameday'
import { fmtUsd } from './components'
import { api, type TodayResponse, type TodayRoll } from './api'
import { HomePage } from './views/Home'
import { CollectionView } from './views/Collection'
import { PortfolioView } from './views/Portfolio'
import { SetsGalleryView, SetDetailView } from './views/SetDetail'
import { MarketView } from './views/Market'
import { PacksView } from './views/Packs'
import { PackOpeningView } from './views/PackOpening'
import { InventoryView } from './views/Inventory'
import { WishlistView } from './views/Wishlist'
import { SettingsView } from './views/Settings'
import { AchievementsView } from './views/Achievements'
import { PullHistoryView } from './views/PullHistory'
import { BindersView } from './views/Binders'
import { GradingView } from './views/Grading'
import { TradeView } from './views/Trade'
import { ForumView } from './views/Forum'
import { ConventionView } from './views/Convention'
import { StorageUnitsView } from './views/StorageUnits'
import { BuylistView } from './views/Buylist'
import { PawnShopView } from './views/PawnShop'
import { YardSalesView } from './views/YardSales'
import { FleaMarketView } from './views/FleaMarket'
import { EstateSalesView } from './views/EstateSales'
import { LocalDealsView } from './views/LocalDeals'
import { CardShowsView } from './views/CardShows'
import { CalendarView } from './views/Calendar'
import { AuctionView } from './views/Auctions'
import { PackBattlesView } from './views/PackBattles'
import { StreamView } from './views/Stream'
import { ResaleView } from './views/Resale'
import { BidBayView } from './views/BidBay'
import { LiveShoppingView } from './views/LiveShopping'
import { ShopView } from './views/Shop'
import { CardDetailModal } from './views/CardDetail'
import { StartingTutorial } from './views/Tutorial'
import { ChangelogModal, useWhatsNewBadge } from './views/WhatsNew'

export type ViewId =
  | 'home' | 'collection' | 'portfolio' | 'sets' | 'set' | 'binders' | 'binder' | 'market' | 'packs' | 'opening' | 'inventory' | 'grading' | 'trade' | 'forum'  | 'convention' | 'shows' | 'calendar' | 'auctions' | 'battles' | 'stream'  | 'resale' | 'shop' | 'bidbay' | 'storage' | 'buylist' | 'pawn' | 'yard' | 'flea' | 'local' | 'estate' | 'wishlist' | 'settings' | 'pulls-history' | 'achievements' | 'live'

type UnlockState = { cash: number; collectionValue: number; inventoryValue: number; netWorth: number; progress: { cardsOwned: number; salesCount: number; followers: number; hasShop: boolean } }
type NavEntry = { id: ViewId; label: string; icon: string; section: string; /** When set, the view stays locked (shown as a 🔒 hint row) until the predicate fires. */ locked?: (s: UnlockState) => boolean; hint?: string; /** Tie-break for next-unlock sorting when two goals need the same progress. */ goal?: number }

const NAV: NavEntry[] = [
  { id: 'home', label: 'Home', icon: '◉', section: '' },
  { id: 'collection', label: 'Collection', icon: '▤', section: 'COLLECT' },
  { id: 'portfolio', label: 'Portfolio', icon: '📈', section: 'COLLECT' },
  { id: 'binders', label: 'Binders', icon: '📔', section: '' },
  { id: 'sets', label: 'Set Completion', icon: '🏸', section: '' },
  { id: 'wishlist', label: 'Wishlist', icon: '★', section: '' },
  { id: 'achievements', label: 'Achievements', icon: '🏆', section: '' },
  { id: 'grading', label: 'Grading', icon: '⚖', section: '' },
  { id: 'market', label: 'Market', icon: '⇄', section: 'MARKET' },
  { id: 'packs', label: 'Pack Shop', icon: '📦', section: '' },
  { id: 'auctions', label: 'Auction House', icon: '🔨', section: '' },
  { id: 'trade', label: 'Trading Post', icon: '🔁', section: '' },
  { id: 'forum', label: 'Community', icon: '🫂', section: '' },
  { id: 'buylist', label: 'Buylist', icon: '🧾', section: '' },
  { id: 'pawn', label: 'Pawn Shop', icon: '💠', section: 'DEALS', locked: (s) => s.progress.salesCount >= 3, hint: 'Make 3 sales', goal: 3 },
  { id: 'yard', label: 'Yard Sales', icon: '🛗', section: '', locked: (s) => s.progress.salesCount >= 3, hint: 'Make 3 sales', goal: 3 },
  { id: 'flea', label: 'Flea Markets', icon: '🛒', section: '', locked: (s) => s.progress.salesCount >= 6, hint: 'Make 6 sales', goal: 6 },
  { id: 'estate', label: 'Estate Buyouts', icon: '📑', section: '', locked: (s) => s.progress.salesCount >= 10, hint: 'Make 10 sales', goal: 10 },
  { id: 'local', label: 'Local Deals', icon: '🪧', section: '', locked: (s) => s.progress.salesCount >= 5, hint: 'Make 5 sales', goal: 5 },
  { id: 'bidbay', label: 'BidBay', icon: '🌐', section: '', locked: (s) => s.progress.salesCount >= 8, hint: 'Make 8 sales', goal: 8 },
  { id: 'live', label: 'Live Shopping', icon: '📺', section: '', locked: (s) => s.progress.salesCount >= 12, hint: 'Make 12 sales', goal: 12 },
  { id: 'convention', label: 'Conventions', icon: '🎪', section: 'EVENTS' },
  { id: 'shows', label: 'Card Shows', icon: '🏟', section: '' },
  { id: 'calendar', label: 'Calendar', icon: '📅', section: '' },
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
  const [route, routeParam] = hash.split('/') as [string, string?]
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
    : NAV.find((n) => n.id === view)?.label ?? 'TCG Life'

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="pokeball" aria-hidden />
          <div>
            <h1>TCG <span className="accent">LIFE</span></h1>
            <div className="tag">Collector Simulator</div>
          </div>
        </div>
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
              {view === 'collection' && <CollectionView />}
              {view === 'portfolio' && <PortfolioView />}
              {view === 'sets' && <SetsGalleryView />}
              {view === 'achievements' && <AchievementsView />}
              {view === 'set' && routeParam && <SetDetailView setId={routeParam} />}
              {view === 'binders' && <BindersView />}
              {view === 'market' && <MarketView />}
              {view === 'packs' && <PacksView />}
              {view === 'opening' && <PackOpeningView />}
              {view === 'inventory' && <InventoryView />}
              {view === 'grading' && <GradingView />}
              {view === 'trade' && <TradeView />}
              {view === 'forum' && <ForumView />}
              {view === 'convention' && <ConventionView />}
              {view === 'storage' && <StorageUnitsView />}
              {view === 'buylist' && <BuylistView />}
              {view === 'pawn' && <PawnShopView />}
              {view === 'yard' && <YardSalesView />}
              {view === 'flea' && <FleaMarketView />}
              {view === 'estate' && <EstateSalesView />}
              {view === 'local' && <LocalDealsView />}
              {view === 'shows' && <CardShowsView />}
              {view === 'calendar' && <CalendarView />}
              {view === 'auctions' && <AuctionView />}
              {view === 'battles' && <PackBattlesView />}
              {view === 'stream' && <StreamView />}
              {view === 'resale' && <ResaleView />}
              {view === 'bidbay' && <BidBayView />}
              {view === 'live' && <LiveShoppingView />}
              {view === 'shop' && <ShopView />}
              {view === 'wishlist' && <WishlistView />}
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
