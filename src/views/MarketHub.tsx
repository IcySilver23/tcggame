import type { ComponentType } from 'react'
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
export type MarketModeId = 'feed' | 'auctions' | 'buylist'

export type MarketMode = {
  id: MarketModeId
  label: string
  icon: string
  /** What this mode is for. Hover-only: the tabs stay uncluttered. */
  verb: string
  Component: ComponentType
}

export const MARKET_MODES: MarketMode[] = [
  { id: 'feed', label: 'Marketplace', icon: '⇄', verb: 'Buy singles from the simulated seller feed, anchored to real market prices', Component: MarketView },
  { id: 'auctions', label: 'Auction House', icon: '🔨', verb: 'Bid on lots with escrow, or consign your own and let the room fight over it', Component: AuctionView },
  { id: 'buylist', label: 'Buylist', icon: '🧾', verb: 'Sell bulk into shop want-lists for cash or store credit, and shop their shelves', Component: BuylistView },
]

export function marketModeLabel(id?: string): string | undefined {
  return MARKET_MODES.find((m) => m.id === id)?.label
}

export function isMarketMode(id?: string): id is MarketModeId {
  return !!id && MARKET_MODES.some((m) => m.id === id)
}

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
