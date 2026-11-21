// Route metadata shared by the app shell and the hub screens.
//
// The shell needs a screen's label (breadcrumb), its nav gate and its legacy
// hashes BEFORE the screen itself is loaded — and since roadmap 16.0 loads each
// screen as its own chunk, it must not import the screen module to get them.
// The hub components attach themselves to these rows in their own modules, so
// this stays the single source for ids, labels, icons, verbs and gates.

export type CollectionModeId = 'cards' | 'binders' | 'sets' | 'wishlist'
export type CollectionModeMeta = { id: CollectionModeId; label: string; icon: string; verb: string }

export const COLLECTION_MODES_META: CollectionModeMeta[] = [
  { id: 'cards', label: 'Cards', icon: '▤', verb: 'Everything you own in one grid — filter by set, rarity, type, price or condition' },
  { id: 'binders', label: 'Binders', icon: '📔', verb: 'Group cards onto pages and flip through them like a real binder' },
  { id: 'sets', label: 'Sets', icon: '🏸', verb: 'Completion set by set — what you have, what is missing, what it costs to finish' },
  { id: 'wishlist', label: 'Wishlist', icon: '★', verb: 'Cards you want with targets set, and agents watching the market for them' },
]

export function collectionModeLabel(id?: string): string | undefined {
  return COLLECTION_MODES_META.find((m) => m.id === id)?.label
}

export function isCollectionMode(id?: string): id is CollectionModeId {
  return !!id && COLLECTION_MODES_META.some((m) => m.id === id)
}

export type MarketModeId = 'feed' | 'auctions' | 'buylist'
export type MarketModeMeta = { id: MarketModeId; label: string; icon: string; verb: string }

export const MARKET_MODES_META: MarketModeMeta[] = [
  { id: 'feed', label: 'Marketplace', icon: '⇄', verb: 'Buy singles from the simulated seller feed, anchored to real market prices' },
  { id: 'auctions', label: 'Auction House', icon: '🔨', verb: 'Bid on lots with escrow, or consign your own and let the room fight over it' },
  { id: 'buylist', label: 'Buylist', icon: '🧾', verb: 'Sell bulk into shop want-lists for cash or store credit, and shop their shelves' },
]

export function marketModeLabel(id?: string): string | undefined {
  return MARKET_MODES_META.find((m) => m.id === id)?.label
}

export function isMarketMode(id?: string): id is MarketModeId {
  return !!id && MARKET_MODES_META.some((m) => m.id === id)
}

export type InventoryModeId = 'cards' | 'storage'
export type InventoryModeMeta = { id: InventoryModeId; label: string; icon: string; verb: string }

export const INVENTORY_MODES_META: InventoryModeMeta[] = [
  {
    id: 'cards',
    label: 'Inventory',
    icon: '🗃',
    verb: 'Raw cards, listings, sealed stock, grading, supplies and the sales log — with cost basis on everything',
  },
  {
    id: 'storage',
    label: 'Storage & Auctions',
    icon: '🗝️',
    verb: 'Shelf capacity, lockers, overflow rules, the vault rider and delinquent-locker auctions',
  },
]

export function inventoryModeLabel(id?: string): string | undefined {
  return INVENTORY_MODES_META.find((m) => m.id === id)?.label
}

export function isInventoryMode(id?: string): id is InventoryModeId {
  return !!id && INVENTORY_MODES_META.some((m) => m.id === id)
}

export type EventsModeId = 'calendar' | 'conventions' | 'shows'
export type EventsModeMeta = { id: EventsModeId; label: string; icon: string; verb: string }

export const EVENTS_MODES_META: EventsModeMeta[] = [
  { id: 'calendar', label: 'Calendar', icon: '📅', verb: 'The whole scene on one clock — conventions, tournament nights, sponsor drops, show windows' },
  { id: 'conventions', label: 'Conventions', icon: '🎪', verb: 'Walk the floor: vendor tables, deal bins, haggling across the aisle, the back-room buyouts' },
  { id: 'shows', label: 'Card Shows', icon: '🏟', verb: 'Run your own: book a hall, price the gate, sell dealer tables, work a booth of your stock' },
]

export function eventsModeLabel(id?: string): string | undefined {
  return EVENTS_MODES_META.find((m) => m.id === id)?.label
}

export function isEventsMode(id?: string): id is EventsModeId {
  return !!id && EVENTS_MODES_META.some((m) => m.id === id)
}

/**
 * Old hashes → hub modes. The three routes were their own views for a long
 * time and the game still writes them: `#/convention` from calendar rows,
 * `#/calendar` from the Home dashboard, `#/shows` from the hosted-show
 * calendar slot. One map instead of three special cases in App.
 */
export const LEGACY_EVENT_ROUTES: Record<string, EventsModeId> = {
  calendar: 'calendar',
  convention: 'conventions',
  conventions: 'conventions',
  shows: 'shows',
}

export type DealVenueId = 'pawn' | 'yard' | 'local' | 'flea' | 'bidbay' | 'estate' | 'live'
export type DealVenueMeta = {
  id: DealVenueId
  label: string
  icon: string
  /** Sales count required to open this venue — unchanged from the old nav rows. */
  gate: number
  hint: string
  /** What you come here to do. Hover-only: the tabs stay uncluttered. */
  verb: string
}

export const DEAL_VENUE_META: DealVenueMeta[] = [
  { id: 'pawn', label: 'Pawn Shop', icon: '💠', gate: 3, hint: 'Make 3 sales', verb: 'Hock a card for cash now, or take a 30-day loan you have to service' },
  { id: 'yard', label: 'Yard Sales', icon: '🛗', gate: 3, hint: 'Make 3 sales', verb: 'Read a driveway table from one-line peeks and haggle across the hood' },
  { id: 'local', label: 'Local Deals', icon: '🪧', gate: 5, hint: 'Make 5 sales', verb: 'Meet a stranger in a parking lot — cheap and risky, or inspected and clean' },
  { id: 'flea', label: 'Flea Markets', icon: '🛒', gate: 6, hint: 'Make 6 sales', verb: 'Dig flat-price bins while NPC pickers drain the same bins beside you' },
  { id: 'bidbay', label: 'BidBay', icon: '🌐', gate: 8, hint: 'Make 8 sales', verb: 'Undercut the room — price against snipers who scan the feed twice a tick' },
  { id: 'estate', label: 'Estate Buyouts', icon: '📑', gate: 10, hint: 'Make 10 sales', verb: 'Buy a whole collection sight unseen and find out what you actually got' },
  { id: 'live', label: 'Live Shopping', icon: '📺', gate: 12, hint: 'Make 12 sales', verb: 'Pounce in a live room — six formats, a clock that does not wait' },
]

/** Earliest venue gate — also the hub's own gate in the sidebar. */
export const DEALS_GATE = Math.min(...DEAL_VENUE_META.map((v) => v.gate))

export const DEAL_VENUE_IDS: string[] = DEAL_VENUE_META.map((v) => v.id)

export function dealVenueLabel(id?: string): string | undefined {
  return DEAL_VENUE_META.find((v) => v.id === id)?.label
}

export function isDealVenue(id?: string): id is DealVenueId {
  return !!id && DEAL_VENUE_META.some((v) => v.id === id)
}
