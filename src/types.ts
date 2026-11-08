// Shared API types mirroring server responses

export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DM'

export type ResolvedPrice = {
  usd: number | null
  source: 'live' | 'last' | 'estimated' | 'model' | 'simulated'
  retrievedAt: string | null
  kind: string | null
  variant: string
  low: number | null
  high: number | null
}

export type CardRow = {
  id: string
  set_id: string
  name: string
  supertype: string
  subtypes: string | null
  number: string
  position: number
  rarity: string | null
  types: string | null
  hp: number | null
  artist: string | null
  dex_numbers: string | null
  image_small: string | null
  image_large: string | null
  regulation_mark: string | null
  updated_at: string | null
  set_name?: string
  set_series?: string
  set_symbol_url?: string
  set_release_date?: string
  set_total?: number | null
  price?: ResolvedPrice
  /** Copies you hold in a labelled printing (a stamped reverse, a Sequin copy) — plain copies are not listed. */
  ownedVariants?: { variant: string; label: string; qty: number }[]
  market_price?: number | null
  market_at?: string | null
  ownedQty?: number
}

export type SetRow = {
  id: string
  name: string
  series: string
  printed_total: number
  total: number
  ptcgo_code: string | null
  release_date: string
  symbol_url: string | null
  logo_url: string | null
  cards_synced?: number
  /** Cards in this set the player owns (collection + in-grading), distinct. */
  owned?: number
}

export type PriceRow = {
  kind: string
  variant: string
  low: number | null
  mid: number | null
  high: number | null
  market: number | null
  direct_low: number | null
  avg1: number | null
  avg7: number | null
  avg30: number | null
  retrieved_at: string
}

export type HistoryPoint = { value: number; at: string }

export type InventoryRow = {
  id: number
  card_id: string
  variant: string
  condition: Condition
  quantity: number
  graded_grade: string | null
  status: 'collection' | 'listed' | 'grading' | 'sold'
  listing_price: number | null
  listed_at: string | null
  acquired_via: string
  cost_basis: number
  acquired_at: string
  favorite: number
  name: string
  image_small: string | null
  image_large: string | null
  rarity: string | null
  number: string
  set_name: string
  value: number
  source: ResolvedPrice
  gradingHint?: import('./api').GradingHint | null
  substatNote?: string | null
  protection?: 'sleeve' | 'toploader' | 'one_touch' | null
  authBadge?: 'fake' | 'authenticated' | 'unvetted' | null
  deskReading?: 'vouched' | 'flagged' | 'partial' | null
}

export type ListingRow = {
  id: string
  card_id: string
  variant: string
  condition: Condition
  price: number
  shipping: number
  seller_name: string
  seller_rating: number
  seller_sales: number
  eta_days: number
  listed_at: string
  expires_at: string
  deal_score: number | null
  name: string
  image_small: string | null
  rarity: string | null
  set_name: string
  market: ResolvedPrice
  total: number
  delta: number
}

export type ProductRow = {
  id: string
  set_id: string
  name: string
  kind: string
  msrp: number
  market_price: number | null
  price_source?: 'pricecharting' | 'estimated'
  oop?: boolean
  oop_months?: number
  oop_status?: 'in print' | 'out of print'
  packs: number
  cards_per_pack: number
  release_date: string | null
  set_name: string
  set_symbol: string | null
  /** Real wrapper art for this sealed product (TCGplayer CDN), when matched. */
  image_url: string | null
  est: {
    avg: number
    p50: number
    p90: number
    topChases: { id: string; name: string; rarity: string; value: number }[]
  }
  /** A General Mills mini pack's Sequin contents and odds; absent on every other product. */
  mini?: MiniSequinOdds | null
  /** The era's slot breakdown for one pack: which cards come from which slot. */
  slots?: PackSlotInfo[]
}

/** One slot in a pack, as the shelf prints it. */
export type PackSlotInfo = {
  slot: string
  count: number
  label: string
  detail: string
}

/** What a mini pack's foil slot can hand you — the shelf prints this as odds. */
export type MiniSequinOdds = {
  cardsPerPack: number
  /** Sequin printings that can appear, with the chance a rip holds each. */
  cards: { id: string; name: string; value: number; chance: number }[]
  /** Named entries the Sequin draws pick from. */
  pool: number
  /** Draws that can land a Sequin card besides one in every pack. */
  draws: number
  /** Chance a rip holds at least one Sequin card, 0–1. */
  anyChance: number
  /** Sequin printings stamped into every pack. */
  guaranteed: string[]
}

export type OpenedCard = { cardId: string; isHit: boolean; value: number; variant?: string; setName?: string; rarity?: string | null; image?: string | null; name?: string; /** Zero copies owned before this rip — first copy only. */ isNew?: boolean }
export type OpenSession = { sessionId: string; cards: OpenedCard[]; totalValue: number; spent: number }

/** The promo card sealed beside a box's packs — it lands before any wrapper. */
export type BoxPromo = { cardId: string; name: string; image: string | null; value: number }

/** One pack out of a box that is being opened wrapper by wrapper. */
export type BoxOpen = OpenSession & {
  boxId: number
  productId: string
  productName: string
  packIndex: number
  packsTotal: number
  packsLeft: number
  done: boolean
  promo?: BoxPromo | null
}

export type PullRow = {
  id: number
  session_id: string
  pack_product_id: string
  card_id: string
  value: number
  rarity: string | null
  is_hit: number
  opened_at: string
  name: string
  image_small: string | null
  set_name: string
}

export type ActivityRow = { id: number; kind: string; message: string; amount: number | null; created_at: string; href?: string | null }

export type GameStateResponse = {
  cash: number
  collectionValue: number
  inventoryValue: number
  netWorth: number
  /** In-game day clock: UTC day number (since the save started) + progress toward the next one. */
  day: { number: number; progress: number; resetsAt: string; lengthHours: 12 | 24 }
  sync: {
    running: boolean
    phase: 'idle' | 'sets' | 'cards' | 'done'
    setsDone: number
    setsTotal: number
    currentSet: string | null
    cardsSyncedTotal: number
    lastError: string | null
    cardCount: number
    setCount: number
    lastSnapshotAt: string | null
    delta: import('./api').CatalogDeltaStatus
  }
  binders: { count: number; slotted: number; value: number }
  /** Play-history counters the sidebar's progressive unlocks read. */
  progress: { cardsOwned: number; salesCount: number; followers: number; hasShop: boolean }
  /** Waiting-lab-result counters for badge chips — arrived auth verdicts and finished grading jobs. */
  counters?: { authVerdicts: number; gradingReady: number }
  apiConfigured: boolean
  /** One-time negotiation tutorial gate — flips after the player's first haggle. */
  haggledOnce: boolean
  tutorialEligible: boolean
  /** First-use tutorial gates for the other game surfaces. */
  tutorials: { start: boolean; local: boolean; auction: boolean; resale: boolean; convention: boolean; ebay: boolean; storage: boolean; buylist: boolean; pawn: boolean; yard: boolean; live: boolean; shipping: boolean; estate: boolean; auth: boolean; futures: boolean }
}

export type CardDetailResponse = {
  card: CardRow & { price: ResolvedPrice }
  priceRows: PriceRow[]
  history: HistoryPoint[]
  gradedPrices: { grade: string; usd: number; retrievedAt: string; source: 'pc-graded' | 'ebay-graded' }[]
  bestRoi?: { serviceId: string; serviceName: string; cost: number; gemChance: number; evNet: number; roi: number; recommended: boolean }[] | undefined
  owned: InventoryRow[]
  wishlisted: boolean
}

export type SetDetailResponse = {
  set: SetRow
  cards: CardRow[]
  completion: { owned: number; total: number; pct: number; missingValue: number; collectionValue: number }
}
