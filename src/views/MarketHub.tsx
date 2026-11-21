import type { ComponentType } from 'react'
import { MARKET_MODES_META, marketModeLabel, isMarketMode, type MarketModeId } from '../route-meta'
import { MarketView } from './Market'
import { AuctionView } from './Auctions'
import { BuylistView } from './Buylist'

/**
 * The MARKET hub (roadmap item 9.0).
 *
 * The marketplace feed, the auction house and the buylist shops are all "ways
 * of buying and selling a card", so they're modes of one door instead of three
 * sidebar rows. Pack Shop, Trading Post and Community stay their own doors —
 * they're different jobs (sealed product, player-to-player swaps, the scene),
 * not views of this market.
 *
 * Same shape as the DEALS and COLLECTION hubs: param route
 * (#/market/auctions), fixed-order mode bar, old hashes normalized by App.
 */
export type { MarketModeId }
export { marketModeLabel, isMarketMode }

export type MarketMode = {
  id: MarketModeId
  label: string
  icon: string
  /** What this mode is for. Hover-only: the tabs stay uncluttered. */
  verb: string
  Component: ComponentType
}

const MARKET_COMPONENTS: Record<MarketModeId, ComponentType> = {
  feed: MarketView,
  auctions: AuctionView,
  buylist: BuylistView,
}

export const MARKET_MODES: MarketMode[] = MARKET_MODES_META.map((m) => ({ ...m, Component: MARKET_COMPONENTS[m.id] }))

const go = (id: MarketModeId) => {
  window.location.hash = `#/market/${id}`
}

export function MarketHubView({ mode }: { mode?: string }) {
  const active = MARKET_MODES.find((m) => m.id === mode) ?? MARKET_MODES[0]
  const Body = active.Component

  return (
    <div className="hub">
      <div className="hub-bar">
        <div className="tab-bar hub-tabs" role="tablist" aria-label="Market modes">
          {MARKET_MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={m.id === active.id}
              className={`tab ${m.id === active.id ? 'on' : ''}`}
              title={`${m.label} — ${m.verb}`}
              onClick={() => go(m.id)}
            >
              <span aria-hidden>{m.icon}</span> {m.label}
            </button>
          ))}
        </div>
      </div>
      <Body />
    </div>
  )
}
