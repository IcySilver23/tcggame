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
  /** The actual sale value of a graded slab, as inventory/net worth use it. */
  slabValue?: {
    usd: number
    source: 'live' | 'estimated'
    kind: 'pc-graded' | 'ebay-graded' | null
    basis: 'sold' | 'asking' | 'estimated'
  } | null
  gradingHint?: import('./api').GradingHint | null
  substatNote?: string | null
  protection?: 'sleeve' | 'toploader' | 'one_touch' | null
  authBadge?: 'fake' | 'authenticated' | 'unvetted' | null
  deskReading?: 'vouched' | 'flagged' | 'partial' | null
}

// The light row behind card pickers (auctions, BidBay lots, forum trades, local
// listings). It deliberately omits grading advice, copy drift and desk reads.
export type InventoryPickRow = {
  id: number
  card_id: string
  name: string
  image_small: string | null
  set_name: string
  variant: string
  condition: Condition
  quantity: number
  graded_grade: string | null
  status: 'collection'
  favorite: number
  cost_basis: number
  is_fake: number
  value: number
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
  /** Today's Pack Shop discount; its price is computed from product detail. */
  deal?: {
    discountPct: number
    price?: number
    endsAt: string
    claimed: boolean
    /** What a claim on a skipped day adds to the deal price, in dollars: the
     *  deal's own resale margin (discount minus the resale desk's cut). */
    surcharge?: number
  }
  /** Cheap source/print facts available without pricing the packs inside. */
  price_source?: 'pricecharting' | 'tcgplayer' | 'pokeinvest' | 'estimated'
  oop?: boolean
  oop_months?: number
  oop_status?: 'in print' | 'out of print'
  packs: number
  cards_per_pack: number
  release_date: string | null
  set_name: string
  set_symbol: string | null
  /** The set's logo, used when this product has no wrapper photo. */
  set_logo?: string | null
  /** Real wrapper art for this sealed product (TCGplayer CDN), when matched. */
  image_url: string | null
  /** Named promo cards sealed in this product, for the shelf badge. */
  promos?: string[]
  /** Those same promos with their catalogue ids, so the till can show the art. */
  promoCards?: { cardId: string | null; name: string; image?: string | null }[]
  /** Whether the box held one of the named promos or all of them. */
  promoPolicy?: 'one-of' | 'all'
}

/** The expensive half of a shelf row, loaded when the product is needed. */
export type ProductDetail = {
  id: string
  market: number
  price_source: 'pricecharting' | 'tcgplayer' | 'pokeinvest' | 'estimated'
  oopMonths: number
  oop: boolean
  status: 'in print' | 'out of print'
  est: {
    avg: number
    p50: number
    p90: number
    topChases: { id: string; name: string; rarity: string; value: number }[]
  }
  /** A General Mills mini pack's Sequin contents and odds; null otherwise. */
  mini?: MiniSequinOdds | null
  /** The era's slot breakdown for one pack; absent on mini packs. */
  slots?: PackSlotInfo[]
}

/** One product on a past Daily Deals board, snapshotted when the day ran. */
export type PastDailyDeal = {
  dayKey: string
  productId: string
  productName: string
  setName: string
  kind: string
  discountPct: number
  basePrice: number
  dealPrice: number
  /** Whether this save claimed it before the board rolled over. */
  bought: boolean
}

export type DailyDealHistoryDay = {
  dayKey: string
  deals: PastDailyDeal[]
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
/** What a rip would do to the shelf, asked before anything is dealt. */
export type RipPreview = {
  productId: string
  name: string
  cards: number
  free: number
  capacity: number
  overflow: number
  policy: 'refuse' | 'scrap'
  scrapLow: number
  scrapHigh: number
  blockedByFloor: boolean
  warning: string | null
}

export type BoxOpen = OpenSession & {
  boxId: number
  productId: string
  productName: string
  packIndex: number
  /** The expansion this particular wrapper came from (a mixed box's wrappers differ). */
  packSetId?: string
  /** That wrapper's own name, symbol and photo, for an expansion the shop never sells. */
  packName?: string | null
  packSymbol?: string | null
  packArt?: string | null
  packsTotal: number
  packsLeft: number
  done: boolean
  /** Present on a skip-to-end response: how many wrappers were opened. */
  packsOpened?: number
  /** Per-wrapper values and, on a skip-to-end response, the cards inside each. */
  perPack?: { sessionId: string; cards?: OpenedCard[]; totalValue: number; spent: number; packIndex?: number }[]
  promo?: BoxPromo | null
  /** Every promo sealed in the box — more than one for a UPC or poster box. */
  promos?: BoxPromo[]
}

export type PullRow = {
  id: number
  value: number
  rarity: string | null
  is_hit: number
  opened_at: string
  name: string
  set_name: string
}

export type ActivityRow = { id: number; kind: string; message: string; amount: number | null; created_at: string; href?: string | null }

export type GameStateResponse = {
  cash: number
  collectionValue: number
  inventoryValue: number
  netWorth: number
  /** In-game day clock: UTC day number (since the save started) + progress toward the next one. */
  day: {
    number: number
    progress: number
    resetsAt: string
    lengthHours: 2 | 12 | 24
    /** Price of one day pass at this save's pace (the rate is per hour of wait). */
    skipFee: number
    /** How far the save's clock runs ahead of this machine's, in ms. */
    offsetMs: number
  }
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
  /** How many of your cards one trade offer may hold (server-enforced). */
  trade: { maxOfferCards: number }
  /** Play-history counters the sidebar's progressive unlocks read. */
  progress: { cardsOwned: number; salesCount: number; followers: number; hasShop: boolean; hasResale: boolean }
  /** Waiting-lab-result counters for badge chips — arrived auth verdicts and finished grading jobs. */
  counters?: { authVerdicts: number; gradingReady: number }
  /** Academy chapters with every step ticked and no reward claimed yet. */
  academyReady?: number
  apiConfigured: boolean
  /** One-time negotiation tutorial gate — flips after the player's first haggle. */
  haggledOnce: boolean
  tutorialEligible: boolean
  /** First-use tutorial gates for the other game surfaces. */
  tutorials: { start: boolean; local: boolean; auction: boolean; resale: boolean; convention: boolean; ebay: boolean; storage: boolean; buylist: boolean; pawn: boolean; yard: boolean; live: boolean; shipping: boolean; estate: boolean; auth: boolean; futures: boolean }
}

/** One checklist step in an Academy chapter. */
export type AcademyStep = {
  id: string
  kind: 'act' | 'answer'
  label: string
  /** Where to do it, or why it is still open. */
  how: string
  /** The screen the step names, as a hash route, and its label for the button. */
  route?: string
  where?: string
  done: boolean
  /** Only on answer steps: the question and its choices. */
  question?: string
  options?: string[]
}

/** The optional Collector's Academy course — ten chapters, each paid once. */
export type AcademyState = {
  chapters: {
    id: string
    title: string
    reward: number
    done: boolean
    paid: boolean
    steps: AcademyStep[]
    stepsDone: number
    /** Every step ticked — the reward can be claimed. */
    ready: boolean
    /** Finished before the checklist existed: its steps are kept, not demanded. */
    waived: boolean
    /** Skipped: no reward, no progress, no nagging. Reversible. */
    skipped: boolean
    /** The app version that added the chapter. */
    addedIn: string
    /** Added after this save graduated. */
    fresh: boolean
  }[]
  doneCount: number
  total: number
  bonus: number
  bonusClaimed: boolean
  earned: number
  offerTotal: number
  allDone: boolean
  /** Chapters added after this save graduated. */
  newSinceGraduation: number
}

export type CardDetailResponse = {
  card: CardRow & { price: ResolvedPrice }
  priceRows: PriceRow[]
  history: HistoryPoint[]
  gradedPrices: { grade: string; usd: number; value: number; retrievedAt: string; source: 'pc-graded' | 'ebay-graded'; basis: 'sold' | 'asking' | 'estimated' }[]
  bestRoi?: { serviceId: string; serviceName: string; cost: number; gemChance: number; pristineChance: number | null; evNet: number; roi: number; recommended: boolean }[] | undefined
  owned: InventoryRow[]
  wishlisted: boolean
}

export type SetDetailResponse = {
  set: SetRow
  cards: CardRow[]
  completion: { owned: number; total: number; pct: number; missingValue: number; collectionValue: number }
}
