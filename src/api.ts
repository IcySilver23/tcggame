// Typed API client — every call hits the local TCG Life server.

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return data
}

const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const patch = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) })
const del = <T>(path: string) => req<T>(path, { method: 'DELETE' })

export const api = {
  state: () => req<import('./types').GameStateResponse>('/api/state'),
  activity: () => req<import('./types').ActivityRow[]>('/api/activity'),

  sets: () => req<import('./types').SetRow[]>('/api/sets'),
  setDetail: (id: string) => req<import('./types').SetDetailResponse>(`/api/sets/${encodeURIComponent(id)}`),

  cardsSearch: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
    return req<{ total: number; cards: import('./types').CardRow[] }>(`/api/cards/search?${qs}`)
  },
  cardDetail: (id: string) => req<import('./types').CardDetailResponse>(`/api/cards/${encodeURIComponent(id)}`),
  facets: () => req<{ rarities: { rarity: string; n: number }[]; types: string[] }>('/api/cards/facets'),

  marketListings: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
    return req<import('./types').ListingRow[]>(`/api/market/listings?${qs}`)
  },
  buyListing: (id: string) => post<{ ok: boolean; total: number; message: string }>(`/api/market/buy/${encodeURIComponent(id)}`),
  buyCardDirect: (cardId: string, _price: number) =>
    post<{ ok: boolean; total: number; message: string }>('/api/market/buy-direct', { cardId }),

  inventory: () => req<import('./types').InventoryRow[]>('/api/inventory'),
  gradingServices: () => req<GradingService[]>('/api/grading/services'),
  gradingPending: () => req<{ pending: GradingPendingRow[]; revealed: GradingReveal[] }>('/api/grading/pending'),
  gradingSubmit: (inventoryId: number, serviceId: string) =>
    post<{ ok: boolean; cost: number }>('/api/grading/submit', { inventoryId, serviceId }),
  gradingReveal: (inventoryId: number) =>
    req<GradingReveal>(`/api/grading/reveal/${inventoryId}`),
  gradingStats: () => req<GradingStats>('/api/grading/stats'),
  listItem: (id: number, price: number) => post<{ ok: boolean }>('/api/inventory/list', { id, price }),
  cancelListing: (id: number) => post<{ ok: boolean }>(`/api/inventory/cancel?id=${id}`),
  favoriteItem: (id: number) => post<{ ok: boolean }>('/api/inventory/favorite', { id }),
  sales: () => req<SaleRow[]>('/api/sales'),

  products: () => req<import('./types').ProductRow[]>('/api/shop/products'),
  buyProduct: (productId: string, qty: number, openNow: boolean) =>
    post<{ ok: boolean; cost: number; opened?: import('./types').OpenSession[] }>(`/api/shop/buy/${encodeURIComponent(productId)}`, { qty, openNow }),
  openPack: (productId: string) => post<import('./types').OpenSession>('/api/packs/open', { productId }),
  sellSealed: (productId: string, qty: number) =>
    post<SellSealedResult>(`/api/sealed/sell/${encodeURIComponent(productId)}`, { qty }),

  pulls: () => req<import('./types').PullRow[]>('/api/pulls'),
  pullsSummary: () => req<{ sessions: { session_id: string; total_value: number; card_count: number; opened_at: string; hits: number }[]; sealedInStock: SealedStockRow[] }>('/api/pulls/summary'),

  binders: () => req<BinderSummary[]>('/api/binders'),
  binderDetail: (id: number) => req<BinderDetail>(`/api/binders/${id}`),
  createBinder: (name: string, accent: string) => post<BinderSummary>('/api/binders', { name, accent }),
  updateBinder: (id: number, p: { name?: string; accent?: string }) => patch<{ ok: boolean }>(`/api/binders/${id}`, p),
  deleteBinder: (id: number) => del<{ ok: boolean }>(`/api/binders/${id}`),
  binderPlace: (id: number, inventoryId: number, page?: number, slot?: number) =>
    post<{ ok: boolean; page: number; slot: number }>(`/api/binders/${id}/place`, { inventoryId, page, slot }),
  binderRemove: (id: number, inventoryId: number) => post<{ ok: boolean }>(`/api/binders/${id}/remove`, { inventoryId }),
  binderMove: (id: number, from: { page: number; slot: number }, to: { page: number; slot: number }) =>
    post<{ ok: boolean; swapped: boolean }>(`/api/binders/${id}/move`, { from, to }),
  binderAvailable: (q = '') => req<BinderAvailableRow[]>(`/api/binders/available?q=${encodeURIComponent(q)}`),

  wishlist: () => req<WishlistRow[]>('/api/wishlist'),
  wishlistToggle: (cardId: string) => post<{ ok: boolean; wishlisted: boolean }>('/api/wishlist/toggle', { cardId }),
  setWishlistAlert: (cardId: string, target: number | null) =>
    post<{ ok: boolean }>('/api/wishlist/alert', { cardId, target }),
  marketDigest: () => req<MarketDigest>('/api/market/digest'),
  taxStatus: () => req<TaxStatus>('/api/tax'),
  fileTax: (quarter?: string) => post<{ ok: boolean; error?: string }>('/api/tax/file', { quarter }),
  payEstimate: (amount: number) => post<{ ok: boolean; amount?: number; paidSoFar?: number; error?: string }>('/api/tax/estimate', { amount }),
  renewLicense: () => post<{ ok: boolean; expiresAt?: string; error?: string }>('/api/tax/license', {}),
  payLicenseRenewal: () => post<{ ok: boolean; error?: string }>('/api/tax/license/renewal', {}),
  setNonprofit: (revoke: boolean) =>
    post<{ ok: boolean; fee?: number; error?: string }>('/api/tax/nonprofit', { revoke }),
  payAuditPenalty: (id: number) => post<{ ok: boolean; penalty?: number; error?: string }>('/api/tax/audit/pay', { id }),
  bribeAuditor: (id: number) => post<{ ok: boolean; amount?: number; error?: string }>('/api/tax/audit/bribe', { id }),
  setTaxStrategy: (strategy: TaxStrategy) =>
    post<{ ok: boolean; error?: string }>('/api/tax/strategy', { strategy }),
  salesTaxRemit: () =>
    post<{ ok: boolean; remitted: { month: string; remitted: number }[] }>('/api/shop/salestax/remit', {}),

  traders: () => req<TraderRow[]>('/api/traders'),
  tradePending: () => req<TradeOfferRow[]>('/api/trades/pending'),

  convention: () => req<ConventionStatus>('/api/convention'),
  conventionEnter: () => post<{ ok: boolean; paid?: number; error?: string }>('/api/convention/enter'),
  conventionBooth: (id: number) => req<BoothStockResponse>(`/api/convention/booth/${id}`),
  conventionBuy: (itemId: number) => post<ConventionBuyResult>(`/api/convention/buy/${itemId}`),
  estate: () => req<EstateSection>('/api/convention/estate'),
  conventionSummary: () => req<ConventionSummary>('/api/convention/summary'),
  vendorTable: () => req<import('./api').VendorStatus>('/api/convention/table'),
  vendorRent: (location: string) => post<{ ok: boolean; fee?: number; location?: string; error?: string }>('/api/convention/table/rent', { location }),
  vendorStockable: () => req<StockableResponse>('/api/convention/table/stockable'),
  vendorStock: (inventoryId: number, ask: number) => post<{ ok: boolean; slotsLeft?: number; error?: string }>('/api/convention/table/stock', { inventoryId, ask }),
  vendorUnstock: (inventoryId: number) => post<{ ok: boolean; error?: string }>('/api/convention/table/unstock', { inventoryId }),
  shop: () => req<ShopStatus>('/api/shop'),
  shopLease: (name: string, tier: string) => post<{ ok: boolean; name?: string; deposit?: number; error?: string }>('/api/shop/lease', { name, tier }),
  shopClose: () => post<{ ok: boolean; error?: string }>('/api/shop/close'),
  shopBuyCase: (caseId: number) => post<{ ok: boolean; label?: string; error?: string }>('/api/shop/cases/buy', { caseId }),
  shopStockable: () => req<StockableResponse>('/api/shop/stockable'),
  shopStock: (caseId: number, inventoryId: number, ask: number) => post<{ ok: boolean; error?: string }>('/api/shop/stock', { caseId, inventoryId, ask }),
  shopUnstock: (inventoryId: number) => post<{ ok: boolean; error?: string }>('/api/shop/unstock', { inventoryId }),
  staff: () => req<StaffStatus>('/api/shop/staff'),
  staffHire: (c: { name: string; role: string; quality: number; wage: number }) => post<{ ok: boolean; name?: string; error?: string }>('/api/shop/staff/hire', c),
  staffFire: (id: number) => post<{ ok: boolean; error?: string }>('/api/shop/staff/fire', { id }),
  bulkStockable: (pricePerCard: number) => req<StockableResponse>(`/api/shop/bulk/stockable?price=${pricePerCard}`),
  bulkBuy: (label: string, pricePerCard: number, capacity: number) => post<{ ok: boolean; label?: string; error?: string }>('/api/shop/bulk/buy', { label, pricePerCard, capacity }),
  bulkFill: (boxId: number, inventoryIds: number[]) => post<{ ok: boolean; added?: number; error?: string }>('/api/shop/bulk/fill', { boxId, inventoryIds }),
  bulkRemove: (inventoryId: number) => post<{ ok: boolean; error?: string }>('/api/shop/bulk/remove', { inventoryId }),
  bulkEmpty: (boxId: number) => post<{ ok: boolean; returned?: number; error?: string }>('/api/shop/bulk/empty', { boxId }),
  bulkSell: (boxId: number) => post<{ ok: boolean; gross?: number; cards?: number; error?: string }>('/api/shop/bulk/sell', { boxId }),
  bags: () => req<import('./api').BagsStatus>('/api/shop/bags'),
  bagsStockable: (price: number) => req<import('./api').BagStockableResponse>(`/api/shop/bags/stockable?price=${price}`),
  bagsAssemble: (price: number, junkIds: number[], hitId: number) => post<{ ok: boolean; bagId?: number; error?: string }>('/api/shop/bags/assemble', { price, junkIds, hitId }),
  bagsBuy: (bagId: number) => post<{ ok: boolean; price?: number; error?: string }>('/api/shop/bags/buy', { bagId }),
  bagsOpen: (bagId: number) => post<BagRevealResult>('/api/shop/bags/open', { bagId }),
  bagsStockBack: (bagId: number) => post<{ ok: boolean; returned?: number; error?: string }>('/api/shop/bags/stock-back', { bagId }),
  pnl: () => req<PnlResponse>('/api/shop/pnl'),
  shopStats: () => req<ShopStatsResponse>('/api/shop/stats'),
  finance: () => req<FinanceStatus>('/api/finance'),
  financeBorrow: (amount: number) => post<{ ok: boolean; amount?: number; lender?: string; rateDaily?: number; error?: string }>('/api/finance/borrow', { amount }),
  financeRepay: (loanId: number, amount?: number) => post<{ ok: boolean; paid?: number; remaining?: number; cleared?: boolean; error?: string }>('/api/finance/repay', { loanId, amount }),
  calendar: () => req<CalendarResponse>('/api/calendar'),
  netWorthHistory: () => req<NetWorthHistory>('/api/networth/history'),
  collectorStats: () => req<CollectorStats>('/api/collector/stats'),
  battleRivals: () => req<BattleRival[]>('/api/battles/rivals'),
  battleProducts: () => req<BattleProduct[]>('/api/battles/products'),
  battleRecord: () => req<BattleRecord>('/api/battles/record'),
  battleStart: (productId: string, opponentId: string) =>
    post<BattleResult>('/api/battles/start', { productId, opponentId }),
  battleDuck: (opponentId: string) =>
    post<{ ok: boolean; grudge?: number; message?: string; error?: string }>(`/api/battles/duck/${opponentId}`),
  tournamentStatus: () => req<TournamentStatus>('/api/tournaments'),
  tournamentJoin: (size: number) => post<TournamentJoinResult>('/api/tournaments/join', { size }),
  tournamentPlay: () => post<TournamentPlayResult>('/api/tournaments/play'),
  tournamentAbandon: () => post<{ ok: boolean }>('/api/tournaments/abandon'),
  streamChannel: () => req<StreamChannel>('/api/stream/channel'),
  streamProducts: () => req<BattleProduct[]>('/api/stream/products'),
  streamGoLive: (productId: string, packs: number) => post<StreamGoLive>('/api/stream/live', { productId, packs }),
  streamRip: () => post<StreamRipResult>('/api/stream/rip'),
  streamEnd: () => post<StreamEndResult>('/api/stream/end'),
  streamHistory: () => req<StreamHistoryRow[]>('/api/stream/history'),
  streamAnalytics: () => req<StreamAnalytics>('/api/stream/analytics'),
  sponsorOffers: () => req<SponsorOffer[]>('/api/sponsors/offers'),
  sponsorAccept: (id: number) => post<{ ok: boolean; contract?: SponsorContract; error?: string }>(`/api/sponsors/accept/${id}`),
  sponsorDecline: (id: number) => post<{ ok: boolean }>(`/api/sponsors/decline/${id}`),
  resaleInbox: () => req<ResaleDeal[]>('/api/resale/inbox'),
  resaleHaggle: (id: number) => post<ResaleHaggle>(`/api/resale/deals/${id}/haggle`),
  resaleBuy: (id: number) => post<ResaleBuy>(`/api/resale/deals/${id}/buy`),
  resaleWalk: (id: number) => post<{ ok: boolean }>(`/api/resale/deals/${id}/walk`),
  resaleStock: () => req<FlipStock>('/api/resale/stock'),
  resaleInstant: (inventoryId: number) => post<InstantSale>(`/api/resale/instant/${inventoryId}`),
  resaleLedger: () => req<ResaleLedger>('/api/resale/ledger'),
  estateBuy: (lotId: number) => post<EstateBuyResult>(`/api/convention/estate/buy/${lotId}`),

  auctions: () => req<AuctionList>('/api/auctions'),
  auctionBid: (id: number, maxBid: number) =>
    post<{ ok: boolean; escrowed?: number; minBid?: number; message?: string; error?: string }>(`/api/auctions/bid/${id}`, { maxBid }),
  auctionConsign: (inventoryId: number) =>
    post<{ ok: boolean; open?: number; message?: string; error?: string }>('/api/auctions/consign', { inventoryId }),
  tradeHistory: () => req<TradeHistoryRow[]>('/api/trades/history'),
  tradePropose: (traderId: number, inventoryId: number, cash: number) =>
    post<TradeReply>('/api/trade/propose', { traderId, inventoryId, cash }),
  tradeAcceptIncoming: (id: number) => post<TradeReply>(`/api/trade/accept-incoming/${id}`),
  tradeRejectIncoming: (id: number) => post<{ ok: boolean; improved?: boolean; bump?: number }>(`/api/trade/reject-incoming/${id}`),
  tradeAcceptCounter: (id: number) => post<TradeReply>(`/api/trade/accept-counter/${id}`),
  tradeDeclineCounter: (id: number) => post<{ ok: boolean }>(`/api/trade/decline-counter/${id}`),

  settings: () =>
    req<{
      apiKeySet: boolean
      pricechartingTokenSet: boolean
      ebayClientIdSet: boolean
      backfill: { running: boolean; done: number; total: number; priced: number; lastSource: string | null; sources: { pricecharting: boolean; ebay: boolean } }
      setsSyncedAt: string | null
      cardsSyncedAt: string | null
      lastSnapshotAt: string | null
      cardCount: number
      priceRecordCount: number
      dataSources: { name: string; role: string; url: string }[]
    }>('/api/settings'),
  setApiKey: (key: string) => post<{ ok: boolean }>('/api/settings/api-key', { key }),
  setPriceSources: (p: { pricechartingToken?: string; ebayClientId?: string; ebayClientSecret?: string }) =>
    post<{ ok: boolean; sources: { pricecharting: boolean; ebay: boolean } }>('/api/settings/price-sources', p),
  sealedStatus: () => req<SealedBackfillStatus>('/api/sealed/status'),
  startSealedBackfill: () => post<{ ok: boolean; status: SealedBackfillStatus }>('/api/sealed/backfill', {}),
  priceBackfill: () => post<{ started: boolean; reason?: string }>('/api/prices/backfill'),
  priceBackfillStatus: () =>
    req<{ running: boolean; done: number; total: number; priced: number; lastSource: string | null; sources: { pricecharting: boolean; ebay: boolean } }>('/api/prices/backfill'),
  resetSave: () => post<{ ok: boolean }>('/api/debug/reset-save'),
  syncProgress: () => req<import('./types').GameStateResponse['sync']>('/api/sync/progress'),
}

export type SaleRow = {
  id: number
  card_id: string
  name: string
  image_small: string | null
  quantity: number
  sale_price: number
  cost_basis: number
  fee: number
  profit: number
  buyer: string
  sold_at: string
}

export type SealedStockRow = {
  product_id: string
  name: string
  quantity: number
  cost: number
  market_price: number
  source: 'pricecharting' | 'estimated'
  oop: boolean
  oop_months: number
  status: 'in print' | 'out of print'
  market_value: number
  basis: number
  unrealized: number
}

export type SellSealedResult =
  | { ok: true; units: number; unitPrice: number; gross: number; fee: number; proceeds: number; basis: number; profit: number }
  | { ok: false; error: string }

export type BinderSummary = { id: number; name: string; accent: string; created_at: string; cardCount: number; value: number }

export type BinderSlot = {
  page: number
  slot: number
  inventory_id: number
  card_id: string
  name: string
  image_small: string | null
  image_large: string | null
  rarity: string | null
  number: string
  set_name: string
  condition: string
  variant: string
  value: number
  cost_basis: number
  status: string
  favorite: number
}

export type BinderDetail = { binder: BinderSummary; slots: BinderSlot[]; pages: number; cardCount: number; value: number }

export type BinderAvailableRow = {
  id: number
  card_id: string
  condition: string
  variant: string
  quantity: number
  cost_basis: number
  acquired_at: string
  name: string
  image_small: string | null
  rarity: string | null
  number: string
  set_name: string
  value: number
}

export type GradingService = {
  id: string
  name: string
  cost: number
  minRawValue: number
  daysMin: number
  daysMax: number
  gradeBias: number
  desc: string
}

export type SealedBackfillStatus = {
  running: boolean
  done: number
  total: number
  updated: number
  configured: boolean
  real: number
  products: number
}

export type GradingPendingRow = {
  id: number
  card_id: string
  condition: string
  grading_service: string | null
  grading_due_at: string
  cost_basis: number
  name: string
  image_small: string | null
  image_large: string | null
  rarity: string | null
}

export type GradingReveal = {
  inventoryId: number
  cardId: string
  name: string
  grade: string
  gradeLabel: string
  value: number
  valueSource: 'live' | 'estimated'
  costBasis: number
  allGrades: { grade: string; usd: number; retrievedAt: string; source: 'pc-graded' | 'ebay-graded' }[]
  profitIfSoldNow: number
}

export type GradingHint = {
  serviceId: string
  serviceName: string
  cost: number
  expectedValue: number
  expectedProfit: number
  upside: number
  edge: number
  gemChance: number
  recommended: boolean
  taxSavings: { honest: number; aggressive: number; bracketRate: number; deductible: boolean }
}

export type GradingStats = {
  totals: {
    submitted: number
    spent: number
    returned: number
    gems: number
    pending: number
    soldCount: number
    revenue: number
    fees: number
    profit: number
    unrealized: number
    net: number
    gemRate: number | null
  }
  services: {
    service: string | null
    submitted: number
    spent: number
    returned: number
    gems: number
    gemRate: number | null
    soldCount: number
    revenue: number
    profit: number
    unrealized: number
    roi: number | null
  }[]
  distribution: { grade: string; n: number }[]
  candidates: (GradingHint & { inventoryId: number; cardId: string; name: string; image: string | null; set: string; condition: string; rawValue: number })[]
  history: {
    id: number
    inventory_id: number
    card_id: string
    sale_price: number
    fee: number
    profit: number
    sold_at: string
    name: string
    image_small: string | null
    grade: string
    service: string | null
    grading_cost: number | null
  }[]
}

export type WishlistRow = {
  card_id: string
  target_price: number | null
  added_at: string
  name: string
  image_small: string | null
  rarity: string | null
  set_name: string
  price: import('./types').ResolvedPrice
}

// ------------------------------------------------------------- Market digest

export type DigestMover = {
  cardId: string
  name: string
  setName: string
  image: string | null
  from: number
  to: number
  changePct: number
}

export type MarketDigest = {
  week: string
  postedAt: string | null
  gainers: DigestMover[]
  losers: DigestMover[]
  sampled: number
}

// ------------------------------------------------------------- Tax season

export type TaxStrategy = 'honest' | 'aggressive'

export type TaxPreview = {
  quarter: string
  revenue: number
  deductions: number
  grading: { total: number; cards: number }
  profit: number
  carryforwardApplied: number
  carryforwardRemaining: number
  taxable: number
  tax: number
  effectiveRate: number
  filed: boolean
  strategy: TaxStrategy
  phantomDeductions: number
  auditChance: number
  taxSavedIfPhantomsHold: number
  penaltyIfCaught: number
}

export type TaxLicense = {
  licensed: boolean
  expiresAt: string | null
  daysLeft: number | null
  graceUsed: boolean
  renewalDue: boolean
  renewalFee: number
}

export type TaxEstimate = {
  quarter: string
  windowStart: string
  windowEnd: string
  running: {
    revenue: number
    deductions: number
    grading: { total: number; cards: number }
    profit: number
    taxable: number
    tax: number
    effectiveRate: number
    strategy: TaxStrategy
  }
  projectedTax: number
  suggestedPayment: number
  paidSoFar: number
  creditFromPrior: number
}

export type TaxFiling = {
  id: number
  month: string
  revenue: number
  deductions: number
  taxable: number
  carryforward: number
  tax: number
  rate: number
  strategy: TaxStrategy
  audited: number
  penalty: number
  fine: number
  filed_at: string
}

export type AuditFinding = {
  id: number
  month: string
  penalty: number
  phantom: number
  bribePrice: number
  mood: string
  foundAt: string
}

export type TaxStatus = {
  current: TaxPreview
  lastQuarter?: TaxPreview
  estimate: TaxEstimate
  license: TaxLicense
  licenseFee: number
  nonprofit: boolean
  nonprofitCharterFee: number
  filings: TaxFiling[]
  strategy: TaxStrategy
  pendingAudits: number
  auditFindings: AuditFinding[]
}

// ------------------------------------------------------------- NPC trading

export type TraderCard = {
  id: number
  card_id: string
  condition: string
  name: string
  image_small: string | null
  rarity: string | null
  set_name: string
  value: number
}

export type TraderRow = {
  id: number
  name: string
  handle: string
  archetype: string
  cash: number
  seed_cash: number
  blurb: string
  avatar: string
  trade_count: number
  card_count: number
  reputation: number
  stance: string
  walked_away: number
  traits: { patience: number; scrutiny: number; cashFlex: number; heat: number }
  cards: TraderCard[]
}

export type TradeOfferCard = {
  traderCardId?: number
  cardId: string
  name: string
  image: string | null
  condition: string
  value: number
}

export type TradeOfferYourItem = {
  inventoryId: number
  cardId: string
  name: string
  image: string | null
  condition: string
  value: number
}

export type TradeOfferRow = {
  id: number
  trader_id: number
  direction: 'incoming' | 'outgoing'
  their_cards: TradeOfferCard[]
  their_cash: number
  your_items: TradeOfferYourItem[]
  your_cash: number
  message: string
  expires_at: string
  rounds: number
  created_at: string
  trader_name: string
  avatar: string
  handle: string
}

export type TradeReply = {
  ok: boolean
  reply?: string
  accepted?: boolean
  gained?: number
  gave?: number
  error?: string
}

export type TradeHistoryRow = {
  id: number
  kind: string
  message: string
  amount: number | null
  created_at: string
}

// ------------------------------------------------------------- event calendar

export type CalendarEvent = {
  id: string
  kind: 'convention' | 'tournament' | 'sponsor'
  title: string
  blurb: string
  start: string
  end: string | null
  now: boolean
}

export type CalendarResponse = {
  events: CalendarEvent[]
  live: CalendarEvent | null
  next: CalendarEvent | null
  serverNow: string
  clockShifted: boolean
}

// ------------------------------------------------------------- conventions

export type ConventionShow = {
  id: number
  name: string
  blurb: string
  entry_fee: number
  opened_at: string
  closes_at: string
}

export type ConventionBoothRow = {
  id: number
  vendor_name: string
  avatar: string
  specialty: string
  blurb: string
  stock: number
}

export type ConventionStatus =
  | { open: false; nextShowInMin: number }
  | { open: true; show: ConventionShow; entered: boolean; minutesLeft: number; booths: ConventionBoothRow[]; totalStock: number }

export type BoothItem = {
  id: number
  card_id: string
  variant: string
  condition: string
  graded_grade: string | null
  ask: number
  name: string
  image_small: string | null
  rarity: string | null
  set_name: string
  anchor: number
  delta: number
}

export type BoothStockResponse =
  | { ok: true; booth: ConventionBoothRow; items: BoothItem[] }
  | { ok: false; error: string }

export type ConventionBuyResult = {
  ok: boolean
  paid?: number
  anchor?: number
  verdict?: string
  message?: string
  error?: string
}

// ----------------------------------------------------------- vendor tables

export type VendorLocation = { id: string; label: string; blurb: string; traffic: number; fee: number }

export type VendorStockRow = {
  id: number
  card_id: string
  variant: string
  condition: string
  quantity: number
  cost_basis: number
  name: string
  image_small: string | null
  rarity: string | null
  number: string
  set_name: string
  ask: number
  anchor: number
  delta: number | null
  daysOnTable: number
}

export type VendorStatus =
  | { active: false; showOpen: false }
  | { active: false; showOpen: true; showName: string; minutesLeft: number; locations: VendorLocation[] }
  | {
      active: true
      showOpen: true
      showName: string
      minutesLeft: number
      table: { location: string; fee: number; revenue: number; costOut: number; buyerCount: number; profit: number }
      stock: VendorStockRow[]
      slotsUsed: number
      slotsMax: number
      unitsOnTable: number
    }



export type StockableRow = {
  id: number
  card_id: string
  variant: string
  condition: string
  quantity: number
  cost_basis: number
  name: string
  image_small: string | null
  rarity: string | null
  number: string
  set_name: string
  anchor: number
  suggestedAsk: number
}

export type StockableResponse = { ok: true; rows: StockableRow[] } | { ok: false; error: string }

// --------------------------------------------------------------- card shop

export type ShopTierOption = { id: string; label: string; blurb: string; deposit: number; rent: number }

export type ShopCaseCard = {
  id: number
  card_id: string
  variant: string
  condition: string
  quantity: number
  cost_basis: number
  name: string
  image_small: string | null
  set_name: string
  ask: number
  anchor: number
  delta: number | null
}

export type ShopCaseRow = {
  id: number
  tier: string
  label: string
  blurb: string
  price: number
  slots: number
  owned: boolean
  used: number
  locked: boolean
  cards: ShopCaseCard[]
}

export type ShopSaleRow = {
  id: number
  card_id: string
  quantity: number
  price: number
  cost_basis: number
  buyer: string
  sold_at: string
  name: string
  profit: number
}

export type FinanceLoan = {
  id: number
  kind: 'loan' | 'overdraft'
  lender: string
  principal: number
  balance: number
  rateDaily: number
  interestPaid: number
  issuedAt: string
  daysOld: number
}

export type FinanceStatus = {
  creditScore: number
  creditLimit: number
  availableCredit: number
  outstanding: number
  missedDrafts: number
  totalBorrowed: number
  totalInterest: number
  dailyInterest: number
  overdraftRate: number
  loans: FinanceLoan[]
}

export type StaffCandidate = { role: string; roleLabel: string; blurb: string; name: string; quality: number; wage: number }

export type StaffMember = {
  id: number
  role: string
  roleLabel: string
  name: string
  wage: number
  quality: number
  hired_at: string
  sourced_value: number
  sourced_cost: number
  submits: number
  sales_lift: number
}

export type StaffStatus = {
  candidates: StaffCandidate[]
  roster: StaffMember[]
  payroll: number
  counterBoost: number
  limits: Record<string, number>
}

export type BulkBoxRow = {
  id: number
  label: string
  price_per_card: number
  capacity: number
  paid: number
  revenue: number
  cards_sold: number
  created_at: string
  count: number
  fullness: number
  sample: { id: number; name: string; image_small: string | null; cost_basis: number }[]
}

export type BagRow = {
  id: number
  label: string
  price: number
  hit_value: number
  status: 'in_shop' | 'sold' | 'opened' | 'stocked_back'
  cost_basis: number
  sold_to: string | null
  revenue: number | null
  created_at: string
  resolved_at: string | null
  count: number
  hitOdds: number
  margin: number
}

export type BagHistoryRow = BagRow & { profit: number }

export type BagsStatus = {
  bags: BagRow[]
  history: BagHistoryRow[]
  prices: number[]
  hitMultiplier: number
}

export type BagStockableResponse = {
  ok: true
  rows: (StockableRow & { isHitTier: boolean; isJunkTier: boolean })[]
  price: number
}

export type BagRevealCard = {
  inventoryId: number
  cardId: string
  name: string
  image: string | null
  setName: string
  isHit: boolean
  value: number
  costBasis: number
}

export type BagRevealResult = {
  ok: boolean
  error?: string
  reveal?: BagRevealCard[]
  totalValue?: number
  price?: number
  roi?: number
  hit?: BagRevealCard | null
}

export type PnlLine = { revenue: number; entries: number }
export type PnlOverheadLine = { amount: number; entries: number }

export type PnlStatement = {
  week: string
  lines: { cases: PnlLine; bulk: PnlLine; bags: PnlLine }
  salesTaxCollected: PnlLine
  overhead: { rent: PnlOverheadLine; payroll: PnlOverheadLine; interest: PnlOverheadLine; other: PnlOverheadLine }
  productRevenue: number
  totalCosts: number
  net: number
  margin: number | null
}

export type PnlWeekRow = { week: string; revenue: number; costs: number; net: number }

export type PnlResponse = { current: PnlStatement; history: PnlWeekRow[] }

export type ShopStatsDay = {
  day: string
  revenue: number
  costs: number
  net: number
  customers: number
  reputation: number
  lifetimeNet: number
}

export type ShopStatsResponse =
  | { open: false }
  | {
      open: true
      shopName: string
      reputation: number
      todayRevenue: number
      todayCustomers: number
      week: {
        series: ShopStatsDay[]
        revenue: number
        customers: number
      }
      bestLine: { line: string; label: string; revenue: number } | null
      lifetimeNet: number
    }

export type SalesTaxStatus = {
  baseRate: number
  rate: number
  district: string | null
  held: number
  collectedAllTime: number
  remittedAllTime: number
  week: string
  filings: { id: number; month: string; collected: number; remitted: number; filed_at: string }[]
}

export type ShopStatus =
  | { open: false; tiers: ShopTierOption[] }
  | {
      open: true
      shop: {
        name: string
        tier: string
        tierLabel: string
        rent: number
        reputation: number
        lifetimeRevenue: number
        lifetimeCost: number
        customerCount: number
        todayCustomers: number
        todayRevenue: number
        displayedUnits: number
        bulkCards: number
      bagsInShop: number
      }
      cases: ShopCaseRow[]
      boxes: BulkBoxRow[]
      bags: BagRow[]
      bagHistory: BagHistoryRow[]
      bagPrices: number[]
      bagHitMultiplier: number
      recent: ShopSaleRow[]
      salesTax: SalesTaxStatus
    }

// ------------------------------------------------------------- estate lots

export type EstatePreviewCard = {
  card_id: string
  name: string
  image_small: string | null
  rarity: string | null
  set_name: string
  condition: string
  value: number
}

export type EstateLotRow = {
  id: number
  seller_name: string
  flavor: string
  flavor_label: string
  flavor_blurb: string
  card_count: number
  ask: number
  seller_estimate: number
  preview: EstatePreviewCard[]
}

export type EstateBuyResult = {
  ok: boolean
  paid?: number
  estimate?: number
  realized?: number
  profit?: number
  pct?: number
  verdict?: string
  cards?: {
    card_id: string
    name: string
    condition: string
    rarity: string | null
    set_name: string
    image_small: string | null
    value: number
  }[]
  error?: string
}

export type EstateLedgerRow = {
  id: number
  seller_name: string
  flavor_label: string
  show_name: string
  card_count: number
  ask: number
  estimate: number
  realized: number
  profit: number
  bought_at: string
}

export type ConventionShowSummary = {
  id: number
  name: string
  date: string
  entryFee: number
  cards: number
  spent: number
  value: number
  net: number
  active: boolean
}

export type ConventionSummary = {
  next:
    | { open: true; showName: string; entryFee: number; entered: boolean; minutesLeft: number }
    | { open: false; nextShowInMin: number }
  lastShow: ConventionShowSummary | null
  activeShow: ConventionShowSummary | null
  totals: { shows: number; spent: number; value: number; net: number }
}

export type NetWorthPoint = {
  week: string
  cash: number
  collection: number
  listed: number
  sealed: number
  netWorth: number
  snapshotted_at: string
}

export type NetWorthHistory = {
  points: NetWorthPoint[]
  start: number | null
  latest: number | null
  change: number | null
}

// ------------------------------------------------------------- pack battles

export type BattleRival = {
  id: string
  name: string
  avatar: string
  style: string
  blurb: string
  likes: string[]
  nerve: number
  wins: number
  losses: number
  grudge: number
  grudgeMatch: boolean
  pendingProduct: string | null
  salty: string | null
}

export type BattleProduct = {
  id: string
  set_id: string
  name: string
  kind: string
  msrp: number
  market_price: number | null
  symbol_url: string | null
}

export type BattleCard = { cardId: string; name: string; value: number; isHit: boolean }

export type BattleChatLine = { at: number; who: string; avatar: string; text: string }

export type BattleResult = {
  ok: boolean
  battleId?: number
  opponent?: { id: string; name: string; avatar: string; style: string }
  product?: { id: string; name: string; stake: number; packsPerSide: number }
  mine?: BattleCard[]
  theirs?: BattleCard[]
  myTotal?: number
  theirTotal?: number
  winner?: 'player' | 'opponent'
  tiebreak?: boolean
  pot?: number
  net?: number
  declined?: boolean
  grudgeMatch?: boolean
  grudgeAfter?: number
  chat?: BattleChatLine[]
  error?: string
}

export type BattleHistoryRow = {
  id: number
  opponent: string
  productName: string
  stake: number
  playerTotal: number
  opponentTotal: number
  winner: string
  tiebreak: boolean
  net: number
  bestPull: { name: string; value: number } | null
  at: string
}

export type BattleRecord = {
  wins: number
  losses: number
  net: number
  byRival: { opponent_id: string; wins: number; losses: number }[]
  history: BattleHistoryRow[]
}

// ------------------------------------------------------------- tournaments

export type BracketSlot = {
  a: string
  b: string
  winner: string | null
  aTotal: number | null
  bTotal: number | null
}

export type TournamentRoundDef = { kind: string; label: string }

export type TournamentStatus =
  | { active: false; mini?: { entry: number; prize: number }; grand?: { entry: number; prize: number } }
  | {
      active: true
      id: number
      size: number
      entry: number
      round: number
      prize: number
      title: string
      rounds: TournamentRoundDef[]
      bracket: BracketSlot[][]
    }

export type TournamentJoinResult = {
  ok: boolean
  id?: number
  size?: number
  entry?: number
  prize?: number
  title?: string
  rounds?: TournamentRoundDef[]
  bracket?: BracketSlot[][]
  yourNextOpponent?: string | null
  error?: string
}

export type TournamentPlayResult = {
  ok: boolean
  round?: number
  roundLabel?: string
  opponent?: { id: string; name: string; avatar: string; style: string }
  product?: { id: string; name: string; stake: number; packsPerSide: number }
  mine?: BattleCard[]
  theirs?: BattleCard[]
  myTotal?: number
  theirTotal?: number
  winner?: 'player' | 'opponent'
  eliminated?: boolean
  champion?: boolean
  prizePaid?: number
  bracket?: BracketSlot[][]
  chat?: BattleChatLine[]
  error?: string
}

// ------------------------------------------------------------- streaming room

export type StreamLive = {
  id: number
  product: { id: string; name: string; set_id: string; kind: string; price: number }
  packsOpened: number
  packsPlanned: number
  viewers: number
  peak: number
  donationsTotal: number
  chatLines: number
  best: { name: string; value: number } | null
}

export type StreamChannel = {
  followers: number
  totalStreams: number
  totalPacks: number
  totalDonations: number
  bestCardName: string | null
  bestCardValue: number | null
  live: StreamLive | null
  contract: SponsorContract | null
  offers: SponsorOffer[]
}

export type SponsorOffer = {
  id: number
  brand: string
  tagline: string
  kind: string
  packsRequired: number
  payoutPerPack: number
  totalPayout: number
  followerBonus: number
  expiresAt: string
}

export type SponsorContract = {
  id: number
  brand: string
  kind: string
  packsRequired: number
  packsDelivered: number
  payoutPerPack: number
  followerBonus: number
  remaining: number
}

export type StreamGoLive = { ok: boolean; live?: StreamLive; error?: string }

export type StreamChat = { at: number; who: string; avatar: string; text: string }

export type StreamRipResult = {
  ok: boolean
  cards?: { cardId: string; name: string; value: number; isHit: boolean }[]
  viewers?: number
  viewerDelta?: number
  sponsored?: boolean
  chat?: StreamChat[]
  donations?: { amount: number; who: string; text: string }[]
  donationsTotal?: number
  packsOpened?: number
  packsPlanned?: number
  streamDone?: boolean
  newBest?: { name: string; value: number } | null
  error?: string
}

export type StreamEndResult = {
  ok: boolean
  followersGain?: number
  followers?: number
  packs?: number
  peakViewers?: number
  donationsTotal?: number
  best?: { name: string; value: number } | null
  sponsor?: {
    brand: string
    packs: number
    payout: number
    completed: boolean
    followerBonus: number
    remaining: number
  } | null
  error?: string
}

export type StreamHistoryRow = {
  id: number
  product: string
  packsOpened: number
  peakViewers: number
  donationsTotal: number
  best: { name: string; value: number } | null
  startedAt: string
}

export type StreamAnalytics = {
  totals: {
    streams: number
    packs: number
    followersGained: number
    followersPerStream: number
    avgPeak: number
  }
  ranking: {
    product: string
    kind: string
    streams: number
    packs: number
    avgPeak: number
    followersPerPack: number
    totalFollowers: number
  }[]
  history: { id: number; product: string; peak: number; gain: number | null; packs: number; at: string }[]
}

// ------------------------------------------------------------- reselling (Phase 4)

export type ResaleCard = {
  cardId: string
  name: string
  image: string | null
  setName: string
  condition: string
  market: number
}

export type ResaleDeal = {
  id: number
  seller: string
  sellerType: string
  message: string
  ask: number
  cards: number
  preview: ResaleCard[]
  trueValueKnown: boolean
  estTrueValue: number
  margin: number
  expiresAt: string
}

export type ResaleHaggle = { ok: boolean; counter?: number; sellerReply?: string; error?: string }

export type ResaleBuy = { ok: boolean; bought?: number; spent?: number; estValue?: number; error?: string }

export type FlipStock = {
  dealer: string
  lots: {
    inventoryId: number
    cardId: string
    costBasis: number
    market: number
    offer: number
    marginPct: number
    heldSince: string
  }[]
}

export type InstantSale = { ok: boolean; proceeds?: number; profit?: number; market?: number; error?: string }

export type ResaleLedger = {
  capitalDeployed: number
  stockCount: number
  stockValue: number
  stockBasis: number
  unrealized: number
  instantSales: number
  instantProceeds: number
  marketSales: number
  realized: number
  roiPct: number
}

// ------------------------------------------------------------- collector record

export type GainerRow = {
  cardId: string
  name: string
  image: string | null
  setName: string
  condition: string
  gradedGrade: string | null
  quantity: number
  costBasis: number
  value: number
  gain: number
  gainPct: number | null
}

export type CollectorStats = {
  cardsOwned: number
  uniqueCards: number
  gradedCount: number
  totalInvested: number
  collectionValue: number
  unrealized: number
  lifetimeSpent: number
  lifetimeEarned: number
  realizedProfit: number
  salesCount: number
  bestFlip: {
    cardId: string
    name: string
    image: string | null
    setName: string
    bought: number
    sold: number
    profit: number
    roi: number | null
    soldAt: string
  } | null
  gainers: GainerRow[]
  daysPlayed: number
  firstPlayed: string | null
  activeStreak: number
}

export type EstateSection = {
  lots: EstateLotRow[]
  history: EstateLedgerRow[]
  stats: {
    lotsBought: number
    totalSpent: number
    totalRealized: number
    netProfit: number
    beatEstimateRate: number | null
    best: { seller: string; ask: number; realized: number; gain: number } | null
  }
}

// ------------------------------------------------------------- auction house

export type AuctionLot = {
  id: number
  card_id: string
  condition: string
  graded_grade: string | null
  seller: string
  anchor: number
  estimate_low: number
  estimate_high: number
  current_bid: number
  bid_count: number
  leader: string | null
  my_escrow: number
  closes_at: string
  status: string
  final_bid: number | null
  name: string
  image_small: string | null
  rarity: string | null
  set_name: string
}

export type AuctionList = {
  live: AuctionLot[]
  closed: AuctionLot[]
}
