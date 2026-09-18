import { useEffect } from 'react'
import { useStore } from './store'
import { fmtUsd } from './components'
import { HomePage } from './views/Home'
import { CollectionView } from './views/Collection'
import { SetsGalleryView, SetDetailView } from './views/SetDetail'
import { MarketView } from './views/Market'
import { PacksView } from './views/Packs'
import { PackOpeningView } from './views/PackOpening'
import { InventoryView } from './views/Inventory'
import { WishlistView } from './views/Wishlist'
import { SettingsView } from './views/Settings'
import { PullHistoryView } from './views/PullHistory'
import { BindersView } from './views/Binders'
import { GradingView } from './views/Grading'
import { TradeView } from './views/Trade'
import { ConventionView } from './views/Convention'
import { CalendarView } from './views/Calendar'
import { AuctionView } from './views/Auctions'
import { PackBattlesView } from './views/PackBattles'
import { StreamView } from './views/Stream'
import { ResaleView } from './views/Resale'
import { ShopView } from './views/Shop'
import { CardDetailModal } from './views/CardDetail'

export type ViewId =
  | 'home' | 'collection' | 'sets' | 'set' | 'binders' | 'binder' | 'market' | 'packs' | 'opening' | 'inventory' | 'grading' | 'trade' | 'convention' | 'calendar' | 'auctions' | 'battles' | 'stream' | 'resale' | 'shop' | 'wishlist' | 'settings' | 'pulls-history'

const NAV: { id: ViewId; label: string; icon: string; section: string }[] = [
  { id: 'home', label: 'Home', icon: '◉', section: '' },
  { id: 'collection', label: 'Collection', icon: '▤', section: 'COLLECT' },
  { id: 'binders', label: 'Binders', icon: '📔', section: '' },
  { id: 'sets', label: 'Set Completion', icon: '🏸', section: '' },
  { id: 'market', label: 'Market', icon: '⇄', section: '' },
  { id: 'wishlist', label: 'Wishlist', icon: '★', section: '' },
  { id: 'packs', label: 'Pack Shop', icon: '📦', section: 'PLAY' },
  { id: 'battles', label: 'Pack Battles', icon: '⚔️', section: '' },
  { id: 'auctions', label: 'Auction House', icon: '🔨', section: '' },
  { id: 'trade', label: 'Trading Post', icon: '🔁', section: '' },
  { id: 'convention', label: 'Conventions', icon: '🎪', section: '' },
  { id: 'calendar', label: 'Calendar', icon: '📅', section: '' },
  { id: 'stream', label: 'Stream', icon: '📡', section: '' },
  { id: 'shop', label: 'Card Shop', icon: '🏪', section: 'BUSINESS' },
  { id: 'resale', label: 'Resale Desk', icon: '💼', section: '' },
  { id: 'inventory', label: 'Inventory', icon: '🗃', section: '' },
  { id: 'grading', label: 'Grading', icon: '⚖', section: '' },
  { id: 'settings', label: 'Settings', icon: '⚙', section: 'SYSTEM' },
]

export default function App() {
  const { state, refreshState, toasts, dismissToast, detailCardId } = useStore()

  const hash = window.location.hash.replace('#/', '')
  const [route, routeParam] = hash.split('/') as [string, string?]
  const view = (route || 'home') as ViewId

  useEffect(() => {
    refreshState()
    const t = setInterval(refreshState, 15000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onHash = () => useStore.setState((s) => ({ ...s }))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const nav = (id: ViewId) => { window.location.hash = `#/${id}` }

  const currentLabel = NAV.find((n) => n.id === view)?.label ?? 'TCG Life'

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>TCG <span className="accent">LIFE</span></h1>
          <div className="tag">Collector Simulator</div>
        </div>
        {NAV.map((n, i) => (
          <div key={n.id} style={{ display: 'contents' }}>
            {n.section && <div className="nav-section">{n.section}</div>}
            <div className={`nav-item ${view === n.id ? 'active' : ''}`} onClick={() => nav(n.id)}>
              <span className="ico">{n.icon}</span> {n.label}
            </div>
          </div>
        ))}
        <div className="grow" />
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
            <div className="stat hero"><span className="lbl">Cash</span><span className="val">{fmtUsd(state?.cash)}</span></div>
            <div className="stat"><span className="lbl">Net Worth</span><span className="val">{fmtUsd(state?.netWorth)}</span></div>
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
          {view === 'home' && <HomePage />}
          {view === 'collection' && <CollectionView />}
          {view === 'sets' && <SetsGalleryView />}
          {view === 'set' && routeParam && <SetDetailView setId={routeParam} />}
          {view === 'binders' && <BindersView />}
          {view === 'market' && <MarketView />}
          {view === 'packs' && <PacksView />}
          {view === 'opening' && <PackOpeningView />}
          {view === 'inventory' && <InventoryView />}
          {view === 'grading' && <GradingView />}
          {view === 'trade' && <TradeView />}
          {view === 'convention' && <ConventionView />}
          {view === 'calendar' && <CalendarView />}
          {view === 'auctions' && <AuctionView />}
          {view === 'battles' && <PackBattlesView />}
          {view === 'stream' && <StreamView />}
          {view === 'resale' && <ResaleView />}
          {view === 'shop' && <ShopView />}
          {view === 'wishlist' && <WishlistView />}
          {view === 'settings' && <SettingsView />}
          {view === 'pulls-history' && <PullHistoryView />}
        </main>
      </div>

      {detailCardId && <CardDetailModal />}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>{t.text}</div>
        ))}
      </div>
    </div>
  )
}
