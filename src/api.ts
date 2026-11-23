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
  /** Rarity + set for a batch of card ids — how a thumbnail picks its foil. */
  cardMeta: (ids: string[]) =>
    req<{ id: string; rarity: string | null; set_id: string; types: string | null; supertype: string | null }[]>('/api/cards/meta?ids=' + encodeURIComponent(ids.join(','))),

  marketListings: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
    return req<import('./types').ListingRow[]>(`/api/market/listings?${qs}`)
  },
  buyListing: (id: string) => post<{ ok: boolean; total: number; message: string }>(`/api/market/buy/${encodeURIComponent(id)}`),
  marketIncoming: () => req<{ incoming: MarketIncomingRow[] }>('/api/market/incoming'),
  buyCardDirect: (cardId: string, _price: number) =>
    post<{ ok: boolean; total: number; message: string }>('/api/market/buy-direct', { cardId }),

  inventory: () => req<import('./types').InventoryRow[]>('/api/inventory'),
  /** Card pickers only need name/image/value — not the full priced collection. */
  inventoryLight: () => req<import('./types').InventoryPickRow[]>('/api/inventory/light'),
  supplies: () => req<SuppliesStatus>('/api/supplies'),

  insurance: () => req<InsuranceStatus>('/api/insurance'),
  insuranceBind: (tier: string) => post<{ ok: boolean; error?: string; waitingDays?: number }>('/api/insurance/bind', { tier }),
  insuranceCancel: () => post<{ ok: boolean; error?: string }>('/api/insurance/cancel', {}),

  local: () => req<LocalFeedRow[]>('/api/local'),
  localMine: () => req<{ listings: MyLocalListing[]; sold: MyLocalSale[] }>('/api/local/mine'),
  localMeet: (id: number, offer?: number) => post<LocalMeetResult>('/api/local/meet', { id, offer }),
  localList: (inventoryId: number, ask: number) => post<{ ok: boolean; error?: string }>('/api/local/list', { inventoryId, ask }),
  localListSealed: (productId: string, ask: number) =>
    post<{ ok: boolean; error?: string }>('/api/local/list-sealed', { productId, ask }),
  localListBundle: (inventoryIds: number[], ask: number) =>
    post<{ ok: boolean; error?: string }>('/api/local/list-bundle', { inventoryIds, ask }),
  localCancel: (id: number) => post<{ ok: boolean; error?: string }>('/api/local/cancel', { id }),
  localAccept: (id: number, buyer: string, amount?: number) => post<LocalMeetResult>('/api/local/accept', { id, buyer, amount }),
  localSellFake: (inventoryId: number) => post<{ ok: boolean; error?: string; paid?: number }>('/api/local/sell-fake', { inventoryId }),
  localInspect: (inventoryId: number) => post<{ ok: boolean; error?: string; fake?: boolean; message?: string }>('/api/local/inspect', { inventoryId }),
  buySupply: (kind: string, packs = 1) => post<{ ok: boolean; error?: string; spent?: number; got?: number }>('/api/supplies/buy', { kind, packs }),
  protectCard: (id: number, kind: string) => post<{ ok: boolean; error?: string }>('/api/inventory/protect', { id, kind }),
  protectBulk: (ids: number[], kind: string) =>
    post<{ ok: boolean; error?: string; protected?: number; skipped?: { id: number; reason: string }[]; outOfStock?: number }>('/api/inventory/protect-bulk', { ids, kind }),
  unprotectCard: (id: number) => post<{ ok: boolean; error?: string }>('/api/inventory/unprotect', { id }),
  gradingServices: () => req<GradingService[]>('/api/grading/services'),
  gradingPending: () => req<{ pending: GradingPendingRow[]; revealed: GradingReveal[] }>('/api/grading/pending'),
  gradingSubmit: (inventoryId: number, serviceId: string) =>
    post<{ ok: boolean; cost: number }>('/api/grading/submit', { inventoryId, serviceId }),
  gradingReveal: (inventoryId: number) =>
    req<GradingReveal>(`/api/grading/reveal/${inventoryId}`),
  gradingStats: () => req<GradingStats>('/api/grading/stats'),
  psaRush: () => req<PsaRushSection>('/api/grading/rush'),
  listItem: (id: number, price: number) => post<{ ok: boolean }>('/api/inventory/list', { id, price }),
  repriceBulk: (ids: number[], pct: number) =>
    post<{ ok: boolean; moved?: number; skipped?: number; before?: number; after?: number; error?: string }>('/api/inventory/reprice-bulk', { ids, pct }),
  cancelListing: (id: number) => post<{ ok: boolean }>(`/api/inventory/cancel?id=${id}`),
  favoriteItem: (id: number) => post<{ ok: boolean }>('/api/inventory/favorite', { id }),
  sales: () => req<SaleRow[]>('/api/sales'),

  products: () => req<import('./types').ProductRow[]>('/api/shop/products'),
  productDetail: (productId: string) =>
    req<import('./types').ProductDetail>(`/api/shop/products/${encodeURIComponent(productId)}/detail`),
  productDetails: (ids: string[]) =>
    post<import('./types').ProductDetail[]>('/api/shop/products/details', { ids }),
  dailyDealsHistory: () => req<import('./types').DailyDealHistoryDay[]>('/api/shop/daily-deals/history'),
  /** Every purchase lands sealed; opening is a separate choice in Inventory. */
  buyProduct: (productId: string, qty: number) =>
    post<{ ok: boolean; cost: number }>(`/api/shop/buy/${encodeURIComponent(productId)}`, { qty }),
  openPack: (productId: string) => post<import('./types').OpenSession & { packsInBox?: number; packsOpened?: number; perPack?: { sessionId: string; totalValue: number; spent: number }[] }>('/api/packs/open', { productId }),
  /** Start a box: one pack comes out, the promo (if any) is already banked. */
  openBox: (productId: string) => post<import('./types').BoxOpen>('/api/packs/box', { productId }),
  /** The next wrapper out of a box that is already open. */
  openBoxNext: (boxId: number) => post<import('./types').BoxOpen>('/api/packs/box/next', { boxId }),
  /** Skip to the end: open every remaining wrapper and return the whole box. */
  openBoxRest: (boxId: number) => post<import('./types').BoxOpen>('/api/packs/box/rest', { boxId }),
  /** Boxes that still have wrappers inside — a reload mid-box must not lose them. */
  openBoxes: () => req<{ id: number; product_id: string; packs_left: number; packs_total: number; name: string | null }[]>('/api/packs/boxes'),
  sellSealed: (productId: string, qty: number) =>
    post<SellSealedResult>(`/api/sealed/sell/${encodeURIComponent(productId)}`, { qty }),
  sealedFutures: () => req<SealedFuturesSection>('/api/sealed/futures'),
  sealedSellCond: (productId: string, qty: number, cond?: 'fresh' | 'worn') =>
    post<SellSealedResult>(`/api/sealed/sell-cond/${encodeURIComponent(productId)}`, { qty, cond }),
  sealedRewrap: (productId: string, qty: number) =>
    post<{ ok: true; units: number; fee: number } | { ok: false; error: string }>(`/api/sealed/rewrap/${encodeURIComponent(productId)}`, { qty }),
  sealedDump: (productId: string, qty: number) =>
    post<{ ok: true; units: number; unitPrice: number; proceeds: number } | { ok: false; error: string }>(`/api/sealed/dump/${encodeURIComponent(productId)}`, { qty }),
  sealedBorrow: (productId: string, qty: number, amount?: number) =>
    post<{ ok: true; principal: number; units: number } | { ok: false; error: string }>('/api/sealed/loans', { productId, qty, amount }),
  sealedRedeem: (loanId: number, units: number) =>
    post<{ ok: true; paid: number; redeemedUnits: number; balanceLeft: number } | { ok: false; error: string }>(`/api/sealed/loans/${loanId}/redeem`, { units }),
  sealedSettle: (loanId: number) =>
    post<{ ok: true; paid: number; units: number } | { ok: false; error: string }>(`/api/sealed/loans/${loanId}/settle`, {}),
  sealedForfeit: (loanId: number) =>
    post<{ ok: true; units: number; kept: number; surplus: number } | { ok: false; error: string }>(`/api/sealed/loans/${loanId}/forfeit`, {}),

  pulls: () => req<import('./types').PullRow[]>('/api/pulls'),
  pullsSummary: () => req<{ sessions: { session_id: string; total_value: number; card_count: number; opened_at: string; hits: number }[]; sealedInStock: SealedStockRow[] }>('/api/pulls/summary'),
  /** The all-time record. Pass the session being revealed when the server
   *  already ripped it (Inventory → Sealed, a resumed box) to get the record
   *  as it stood before that rip, not one that includes it. */
  pullsBest: (excludeSession?: string) => req<{ cardId: string | null; value: number; name?: string; image?: string | null; setName?: string; rarity?: string | null; isHit?: boolean; openedAt?: string; bestPackTotal?: number }>(
    `/api/pulls/best${excludeSession ? `?exclude=${encodeURIComponent(excludeSession)}` : ''}`,
  ),

  binders: () => req<BinderSummary[]>('/api/binders'),
  binderDetail: (id: number) => req<BinderDetail>(`/api/binders/${id}`),
  binderCovers: () => req<{ covers: BinderCover[]; slotted: number }>('/api/binders/covers'),
  createBinder: (name: string, accent: string, cover?: string) => post<BinderSummary>('/api/binders', { name, accent, cover }),
  updateBinder: (id: number, p: { name?: string; accent?: string; cover?: string }) => patch<{ ok: boolean }>(`/api/binders/${id}`, p),
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
  marketRegimes: () => req<MarketRegimes>('/api/market/regimes'),
  marketSeasonal: () => req<MarketSeasonal>('/api/market/seasonal'),
  marketScene: () => req<MarketScene>('/api/market/scene'),
  taxStatus: () => req<TaxStatus>('/api/tax'),
  fileTax: (quarter?: string) => post<{ ok: boolean; error?: string }>('/api/tax/file', { quarter }),
  payEstimate: (amount: number) => post<{ ok: boolean; amount?: number; paidSoFar?: number; error?: string }>('/api/tax/estimate', { amount }),
  renewLicense: () => post<{ ok: boolean; expiresAt?: string; error?: string }>('/api/tax/license', {}),
  payLicenseRenewal: () => post<{ ok: boolean; error?: string }>('/api/tax/license/renewal', {}),
  setNonprofit: (revoke: boolean) =>
    post<{ ok: boolean; fee?: number; error?: string }>('/api/tax/nonprofit', { revoke }),
  setRoundUps: (enabled: boolean) => post<{ ok: boolean }>('/api/tax/roundups', { enabled }),
  accountant: () => req<AccountantStatus>('/api/accountant'),
  hireAccountant: (name: string, quality: number) => post<{ ok: boolean; name?: string; error?: string }>('/api/accountant/hire', { name, quality }),
  fireAccountant: () => post<{ ok: boolean; error?: string }>('/api/accountant/fire', {}),
  payAuditPenalty: (id: number) => post<{ ok: boolean; penalty?: number; error?: string }>('/api/tax/audit/pay', { id }),
  bribeAuditor: (id: number) => post<{ ok: boolean; amount?: number; error?: string }>('/api/tax/audit/bribe', { id }),
  setTaxStrategy: (strategy: TaxStrategy) =>
    post<{ ok: boolean; error?: string }>('/api/tax/strategy', { strategy }),
  salesTaxRemit: () =>
    post<{ ok: boolean; remitted: { month: string; remitted: number }[] }>('/api/shop/salestax/remit', {}),

  traders: () => req<TraderRow[]>('/api/traders'),
  tradePending: () => req<TradeOfferRow[]>('/api/trades/pending'),

  convention: () => req<ConventionStatus>('/api/convention'),
  floor: () => req<FloorStatus>('/api/convention/floor'),
  floorTable: (id: number) => req<FloorTable>(`/api/convention/table/${id}`),
  floorHaggle: (itemId: number, offer: number) =>
    post<FloorHaggleResult>('/api/convention/floor/haggle', { itemId, offer }),
  floorBuy: (itemId: number) => post<FloorBuyResult>('/api/convention/floor/buy', { itemId }),
  floorOffers: (boothId: number) => req<FloorOffersResponse>(`/api/convention/floor/${boothId}/offers`),
  floorSell: (boothId: number, inventoryId: number, mode: 'cash' | 'credit' | 'haggle') =>
    post<FloorSellResult>('/api/convention/floor/sell', { boothId, inventoryId, mode }),
  floorCreditBuy: (boothId: number, itemId: number) =>
    post<FloorBuyResult & { creditUsed?: number; cashUsed?: number }>('/api/convention/floor/credit-buy', { boothId, itemId }),
  floorGradeAndGo: (boothId: number, inventoryId: number) =>
    post<{ ok: boolean; error?: string; fee?: number; card?: string }>('/api/convention/floor/grade-and-go', { boothId, inventoryId }),
  shows: () => req<ShowsStatus>('/api/shows'),
  showBook: (venue: string, gate: number, tablePrice: number, guests: string[] = []) =>
    post<{ ok: boolean; error?: string }>('/api/shows/book', { venue, gate, tablePrice, guests }),
  showPricing: (gate: number, tablePrice: number) =>
    post<{ ok: boolean; error?: string }>('/api/shows/pricing', { gate, tablePrice }),
  showGuests: (guests: string[]) =>
    post<{ ok: boolean; error?: string; spent?: number }>('/api/shows/guests', { guests }),
  showCancel: () => post<{ ok: boolean; error?: string }>('/api/shows/cancel', {}),
  showBoothClaim: () => post<{ ok: boolean; error?: string; tableId?: number; venue?: string }>('/api/shows/booth/claim', {}),
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
  franchise: () => req<FranchiseStatus>('/api/franchise'),
  franchiseOpen: (name: string, tier: string, managerName: string, managerQuality: number, managerWage: number, store = 1) =>
    post<{ ok: boolean; error?: string }>('/api/franchise/open', { name, tier, managerName, managerQuality, managerWage, store }),
  franchiseClose: (store = 1) => post<{ ok: boolean; error?: string }>('/api/franchise/close', { store }),
  franchiseInternal: () => req<{ ok: boolean; candidates: FranchiseInternalCandidate[] }>('/api/franchise/internal'),
  franchisePromote: (employeeId: number, name: string, tier: string, store = 1) =>
    post<{ ok: boolean; error?: string; managerName?: string; wage?: number }>('/api/franchise/promote', { employeeId, name, tier, store }),
  franchiseStock: (inventoryId: number, ask: number, store = 1) => post<{ ok: boolean; error?: string }>('/api/franchise/stock', { inventoryId, ask, store }),
  franchiseUnstock: (inventoryId: number) => post<{ ok: boolean; error?: string }>('/api/franchise/unstock', { inventoryId }),
  franchiseStockable: () => req<{ ok: boolean; rows: StockableRow[]; error?: string }>('/api/franchise/stockable'),
  franchiseAudit: (store = 1) =>
    post<{ ok: boolean; error?: string; found?: number; unbooked?: number; clean?: boolean; message?: string }>('/api/franchise/audit', { store }),
  franchiseDm: () => req<{ ok: boolean; dm: FranchiseDm | null; candidates: FranchiseManagerCandidate[]; internal: FranchiseInternalCandidate[] }>('/api/franchise/dm'),
  franchiseRegionalHire: (payload: { name: string; quality: number; wage: number }) =>
    req<{ ok: boolean; error?: string; name?: string; wage?: number }>('/api/franchise/regional/hire', { method: 'POST', body: JSON.stringify(payload) }),
  franchiseRegionalFire: () => req<{ ok: boolean; error?: string }>('/api/franchise/regional/fire', { method: 'POST' }),
  franchiseLoyaltyResolve: (payload: { store?: number; dm?: boolean; regional?: boolean; action: 'grant' | 'refuse' }) =>
    req<{ ok: boolean; error?: string; granted?: number; wage?: number; refused?: boolean; loyaltyHit?: number }>('/api/franchise/loyalty/resolve', { method: 'POST', body: JSON.stringify(payload) }),
  franchiseLoyaltyRehire: (payload: { store: number; name: string; quality: number; wage: number }) =>
    req<{ ok: boolean; error?: string; name?: string; wage?: number }>('/api/franchise/loyalty/rehire', { method: 'POST', body: JSON.stringify(payload) }),
  rival: () => req<RivalStatus>('/api/rival'),
  achievements: () => req<AchievementsStatus>('/api/achievements'),
  rivalBuyout: (amount: number) =>
    req<{ ok: boolean; error?: string; refused?: boolean; ask?: number; bump?: number; paid?: number; stockValue?: number }>('/api/rival/buyout', { method: 'POST', body: JSON.stringify({ amount }) }),
  rivalMatch: () =>
    req<{ ok: boolean; error?: string; matched?: number; surrendered?: number }>('/api/rival/match', { method: 'POST' }),
  franchiseDmHire: (c: { name: string; quality: number; wage: number } | { employeeId: number }) =>
    post<{ ok: boolean; error?: string; name?: string; wage?: number }>('/api/franchise/dm/hire', c),
  franchiseDmFire: () => post<{ ok: boolean; error?: string }>('/api/franchise/dm/fire', {}),
  franchiseIntel: () => req<IntelStatus>('/api/franchise/intel'),
  franchiseIntelTransfer: (inventoryId: number, toKind: 'flagship' | 'satellite', toStore: number) =>
    post<{ ok: boolean; error?: string; to?: string; lost?: boolean }>('/api/franchise/intel/transfer', { inventoryId, toKind, toStore }),
  shopBuyCase: (caseId: number) => post<{ ok: boolean; label?: string; error?: string }>('/api/shop/cases/buy', { caseId }),
  shopBuyBuilding: () =>
    post<{ ok: boolean; price?: number; down?: number; principal?: number; daily?: number; rate?: number; error?: string }>('/api/shop/buy'),
  shopStockable: () => req<{ ok: true; rows: ShopStockRow[] } | { ok: false; error: string }>('/api/shop/stockable'),
  shopStock: (caseId: number, inventoryId: number, ask: number) => post<{ ok: boolean; error?: string }>('/api/shop/stock', { caseId, inventoryId, ask }),
  shopUnstock: (inventoryId: number) => post<{ ok: boolean; error?: string }>('/api/shop/unstock', { inventoryId }),
  consignmentAccept: (id: number, ask: number) => post<{ ok: boolean; error?: string }>('/api/shop/consignment/accept', { id, ask }),
  consignmentDecline: (id: number) => post<{ ok: boolean; error?: string }>('/api/shop/consignment/decline', { id }),
  consignmentReturn: (id: number) => post<{ ok: boolean; error?: string }>('/api/shop/consignment/return', { id }),
  consignment: () => req<ConsignmentStatus>('/api/shop/consignment'),
  staff: () => req<StaffStatus>('/api/shop/staff'),
  staffHire: (c: { name: string; role: string; quality: number; wage: number }) => post<{ ok: boolean; name?: string; error?: string }>('/api/shop/staff/hire', c),
  staffFire: (id: number) => post<{ ok: boolean; error?: string }>('/api/shop/staff/fire', { id }),
  staffDayOff: (id: number, action: 'grant' | 'refuse') => post<{ ok: boolean; error?: string; dayOff?: string; label?: string; refused?: boolean }>('/api/shop/staff/dayoff', { id, action }),
  staffPoach: (id: number, action: 'match' | 'letgo') => post<{ ok: boolean; error?: string; wage?: number; left?: boolean }>('/api/shop/staff/poach', { id, action }),
  staffHuff: (id: number, action: 'grant' | 'refuse') => post<{ ok: boolean; error?: string; wage?: number; dayOff?: string; label?: string; left?: boolean }>('/api/shop/staff/huff', { id, action }),
  bulkStockable: (pricePerCard: number) => req<{ ok: true; rows: ShopBulkRow[] } | { ok: false; error: string }>(`/api/shop/bulk/stockable?price=${pricePerCard}`),
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

  // ------------------------------------------------------------- lending desk
  lending: () => req<LendingDesk>('/api/lending'),
  lend: (offerId: number, rate: number) =>
    post<{ ok: boolean; principal?: number; dueAt?: string; interest?: number; error?: string }>('/api/lending/lend', { offerId, rate }),

  // ----------------------------------------------------------------- repacks
  repacks: () => req<RepackStatus>('/api/shop/repacks'),
  repacksStockable: () => req<RepackStockable>('/api/shop/repacks/stockable'),
  repacksAssemble: (price: number, chaseInventoryId: number, publishedOdds: number) =>
    post<{ ok: boolean; repackId?: number; chaseValue?: number; printedOdds?: number; actualOdds?: number; error?: string }>(
      '/api/shop/repacks/assemble',
      { price, chaseInventoryId, publishedOdds },
    ),
  repacksBuy: (repackId: number) =>
    post<{ ok: boolean; reveal?: { cardId: string; name: string; value: number }[]; totalValue?: number; price?: number; chase?: boolean; error?: string }>(
      '/api/shop/repacks/buy',
      { repackId },
    ),
  repacksStockBack: (repackId: number) =>
    post<{ ok: boolean; returned?: number; error?: string }>('/api/shop/repacks/stock-back', { repackId }),
  pnl: () => req<PnlResponse>('/api/shop/pnl'),
  shopStats: () => req<ShopStatsResponse>('/api/shop/stats'),
  today: () => req<TodayResponse>('/api/today'),
  /** Pay the day pass to skip the wait to the next game-day; the server moves the clock. */
  skipDay: () =>
    post<{ ok: true; fee: number; cash: number; day: { number: number; resetsAt: string }; message: string }>('/api/day/skip'),
  finance: () => req<FinanceStatus>('/api/finance'),
  financeBorrow: (amount: number) => post<{ ok: boolean; amount?: number; lender?: string; rateDaily?: number; error?: string }>('/api/finance/borrow', { amount }),
  financeRepay: (loanId: number, amount?: number) => post<{ ok: boolean; paid?: number; remaining?: number; cleared?: boolean; error?: string }>('/api/finance/repay', { loanId, amount }),
  // `weeks` widens the published window — the month grid asks for enough to
  // page either side of the current month.
  calendar: (weeks?: number) =>
    req<CalendarResponse>(weeks ? `/api/calendar?weeks=${weeks}` : '/api/calendar'),
  netWorthHistory: () => req<NetWorthHistory>('/api/networth/history'),
  portfolio: () => req<Portfolio>('/api/portfolio'),
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
  streamProducts: () => req<StreamProduct[]>('/api/stream/products'),
  streamGoLive: (productId: string, packs: number) => post<StreamGoLive>('/api/stream/live', { productId, packs }),
  streamRip: () => post<StreamRipResult>('/api/stream/rip'),
  streamEnd: () => post<StreamEndResult>('/api/stream/end'),
  breakStatus: () => req<BreakStatus>('/api/stream/break'),
  breakCreate: (productId: string, spots: number, spotPrice: number | null) =>
    post<{ ok: boolean; error?: string; breakId?: number; suggested?: number; spotPrice?: number; spotsTotal?: number; productCost?: number }>('/api/stream/breaks', { productId, spots, spotPrice }),
  breakCancel: (id: number) => post<{ ok: boolean; error?: string }>(`/api/stream/breaks/${id}/cancel`, {}),
  breakBuy: (id: number, team: string) =>
    post<{ ok: boolean; error?: string; holder?: string; spotsSold?: number; spotsTotal?: number; chat?: { who: string; avatar: string; text: string } }>(`/api/stream/breaks/${id}/buy`, { team }),
  breakRip: () => post<BreakRipResult>('/api/stream/break/rip'),
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

  storageUnits: () => req<StorageUnitsSection>('/api/storage/units'),

  inspectCard: (inventoryId: number) =>
    post<{ stats?: { centering: number; whitening: number; corners: number; printLine: number }; error?: number; skill?: number; summary?: string; error_msg?: string }>(`/api/substats/inspect/${inventoryId}`, {}),
  substatsEye: () => req<{ skill: number; looks: number; graded: number; remaining: number; hint: string }>('/api/substats/eye'),
  substatComps: (inventoryId: number) =>
    req<{ band: number; copyValue: number | null; copyKnown: boolean; copyFactor: number; low: number | null; high: number | null; read: { stats: { centering: number; whitening: number; corners: number; printLine: number }; summary: string } | null }>(`/api/substats/comps/${inventoryId}`),
  storageBid: (unitId: number, amount: number) =>
    post<{ ok: boolean; won?: boolean; paid?: number | null; counter?: number | null; bidder?: string; error?: string }>(`/api/storage/bid/${unitId}`, { amount }),
  storageOpen: (unitId: number) =>
    post<StorageOpenResult>(`/api/storage/open/${unitId}`),
  storageSort: (unitId: number, keep: string[]) =>
    post<{ ok: boolean; kept?: number; bulkCount?: number; bulkCash?: number; error?: string }>(`/api/storage/sort/${unitId}`, { keep }),

  // ------------------------------------------------- storage & the vault
  storageCapacity: () => req<StorageCapacity>('/api/storage/capacity'),
  storageRentLocker: (tier: string) =>
    post<{ ok: boolean; id?: number; monthly?: number; error?: string }>('/api/storage/lockers/rent', { tier }),
  storageCloseLocker: (id: number) =>
    post<{ ok: boolean; error?: string }>('/api/storage/lockers/close', { id }),
  storageVaultSubscribe: () => post<{ ok: boolean; monthly?: number; error?: string }>('/api/storage/vault/subscribe', {}),
  storageVaultCancel: () => post<{ ok: boolean; error?: string }>('/api/storage/vault/cancel', {}),
  storageOverflowPolicy: (policy: 'refuse' | 'scrap') =>
    post<{ ok: boolean; policy?: 'refuse' | 'scrap'; error?: string }>('/api/storage/overflow', { policy }),
  storageOverflowPreview: (count = 1) =>
    req<StorageOverflowPreview>(`/api/storage/overflow-preview?count=${count}`),
  storageScrapFloor: (value: number) =>
    post<{ ok: boolean; floor?: number; error?: string }>('/api/storage/scrap-floor', { value }),

  // ------------------------------------------------------------- buylist
  buylist: () => req<BuylistSection>('/api/buylist'),
  buylistOffers: (shopId: number) => req<BuylistOffers>(`/api/buylist/offers/${shopId}`),
  buylistShelf: (shopId: number) => req<BuylistShelf>(`/api/buylist/shelf/${shopId}`),
  buylistSell: (shopId: number, inventoryIds: number[], creditSplit: number, expectedCash?: number) =>
    post<{ ok: boolean; cash?: number; credit?: number; error?: string }>(`/api/buylist/sell`, { shopId, inventoryIds, creditSplit, expectedCash }),
  buylistBuyShelf: (shopId: number, rowId: number, payCredit: boolean) =>
    post<{ ok: boolean; paid?: number; method?: 'cash' | 'credit'; error?: string }>(`/api/buylist/shelf/${shopId}`, { rowId, payCredit }),

  // ------------------------------------------------------------- pawn shop
  pawn: () => req<PawnSection>('/api/pawn'),
  pawnSell: (inventoryId: number) => post<{ ok: boolean; paid?: number; error?: string }>(`/api/pawn/sell/${inventoryId}`),

  // One door from the "Which door pays most?" panel. The server re-checks the
  // route's gate and performs that route's own sale (list, buylist, dealer, pawn).
  sellRoute: (inventoryId: number, routeId: string) =>
    post<{ ok: boolean; paid?: number; listed?: number; message?: string; error?: string }>(`/api/sell-routes/${inventoryId}/${routeId}`, {}),
  pawnHock: (inventoryId: number, amount?: number) =>
    post<{ ok: boolean; principal?: number; dueAt?: string; error?: string }>(`/api/pawn/hock/${inventoryId}`, { amount }),
  pawnPayoff: (loanId: number) => post<{ ok: boolean; paid?: number; error?: string }>(`/api/pawn/payoff/${loanId}`),
  pawnBuyBack: (shelfId: number) => post<{ ok: boolean; paid?: number; error?: string }>(`/api/pawn/buyback/${shelfId}`),

  // ------------------------------------------------------------- yard sales
  yard: () => req<YardSection>('/api/yard'),

  // ---------------------------------------------------------------- flea markets
  flea: () => req<FleaSection>('/api/flea'),
  fleaDig: (binId: number) => post<{ ok: boolean; card?: FleaDigResult; error?: string }>(`/api/flea/dig/${binId}`),
  fleaDebugSpawn: () => post<{ ok: boolean }>('/api/flea/debug-spawn'),
  yardOffer: (rowId: number, offer: number) => post<YardOfferResult>(`/api/yard/offer/${rowId}`, { offer }),
  yardBuy: (rowId: number) => post<YardPickResult>(`/api/yard/buy/${rowId}`),
  yardBox: (saleId: number) => post<YardBoxResult>(`/api/yard/box/${saleId}`),

  // ------------------------------------------------- estate & collection buyouts
  estateSales: () => req<EstateBuyoutsSection>('/api/estate-sales'),
  estateOffer: (id: number, offer: number) =>
    post<{ ok: boolean; accepted?: boolean; paid?: number; counter?: number | null; message: string; finalSaid?: boolean; error?: string }>(
      `/api/estate-sales/offer/${id}`,
      { offer },
    ),
  estateApologize: (id: number) => post<{ ok: boolean; message?: string; error?: string }>(`/api/estate-sales/apologize/${id}`),
  estateBuyout: (id: number) => post<EstateBuyoutResult>(`/api/estate-sales/buy/${id}`),
  authSection: () => req<AuthSection>('/api/auth'),
  forum: () => req<ForumSection>('/api/forum'),
  agents: () => req<AgentsSection>('/api/wishlist/agents'),
  agentsSet: (cardId: string, enabled: boolean, maxPrice: number | null, condition: string) =>
    post<{ ok: boolean; enabled?: boolean; cap?: number | null; error?: string }>('/api/wishlist/agents/set', { cardId, enabled, maxPrice, condition }),
  agentsCap: (cap: number) => post<{ ok: boolean; cap?: number; error?: string }>('/api/wishlist/agents/cap', { cap }),
  agentsRun: () => post<{ ok: boolean; buys?: AgentBuy[]; error?: string }>('/api/wishlist/agents/run', {}),
  forumPull: (inventoryId: number) => post<{ ok: boolean; warmth?: number; rep?: number; title?: string; error?: string }>('/api/forum/pull', { inventoryId }),
  forumReply: () => post<{ ok: boolean; reply?: string; rep?: number; error?: string }>('/api/forum/reply'),
  forumGuide: () => post<{ ok: boolean; title?: string; warmth?: number; rep?: number; error?: string }>('/api/forum/guide'),
  forumGroupBuy: (cardId: string) => post<{ ok: boolean; cardName?: string; myShare?: number; splitN?: number; error?: string }>('/api/forum/groupbuy', { cardId }),
  authSurvey: (inventoryId?: number) => post<AuthSurvey>(`/api/auth/survey`, { inventoryId }),
  authBuyTool: (toolId: string) => post<{ ok: boolean; toolId?: string; name?: string; cost?: number; error?: string }>(`/api/auth/tools`, { toolId }),
  deskReviewEligibility: (inventoryId: number) =>
    post<{ ok: boolean; eligible?: boolean; reason?: string; error?: string }>(`/api/auth/desk-eligibility`, { inventoryId }),
  authSubmit: (inventoryId: number, serviceId: string) => post<AuthSubmitResult>(`/api/auth/submit`, { inventoryId, serviceId }),
  authReveal: (inventoryId: number) => post<AuthReveal>(`/api/auth/reveal`, { inventoryId }),
  authSellFake: (inventoryId: number) => post<{ ok: boolean; paid?: number; name?: string; error?: string }>(`/api/auth/sell-fake`, { inventoryId }),

  // ------------------------------------------------------- NPC live shopping
  live: (showId?: number) => req<LiveSection>(`/api/live${showId ? `?showId=${showId}` : ''}`),
  liveBid: (itemId: number, amount: number) =>
    post<{ ok: boolean; leading?: boolean; current?: number; extended?: boolean; error?: string }>(`/api/live/bid/${itemId}`, { amount }),
  liveSnipe: (itemId: number) =>
    post<{ ok: boolean; stolen?: boolean; paid?: number; card?: string; error?: string }>(`/api/live/snipe/${itemId}`),
  liveBin: (itemId: number) => post<{ ok: boolean; paid?: number; card?: string; error?: string }>(`/api/live/bin/${itemId}`),
  liveMystery: (itemId: number) =>
    post<{ ok: boolean; paid?: number; cards?: { name: string; value: number }[]; total?: number; error?: string }>(`/api/live/mystery/${itemId}`),
  liveSpot: (itemId: number, spotId: number) =>
    post<{ ok: boolean; team?: string; paid?: number; error?: string }>(`/api/live/spot/${itemId}/${spotId}`),
  liveRipshipChoose: (itemId: number, choice: 'rip' | 'ship') =>
    post<{ ok: boolean; error?: string; choice?: 'rip' | 'ship'; paid?: number; product?: string; cards?: { name: string; value: number }[]; total?: number; hits?: { name: string; cardId: string; image: string | null; value: number }[]; firstHit?: string | null }>(
      `/api/live/ripship/${itemId}/${choice}`,
    ),

  auctions: () => req<AuctionList>('/api/auctions'),
  auctionBid: (id: number, maxBid: number) =>
    post<{ ok: boolean; escrowed?: number; minBid?: number; message?: string; error?: string }>(`/api/auctions/bid/${id}`, { maxBid }),
  auctionConsign: (inventoryId: number) =>
    post<{ ok: boolean; open?: number; message?: string; error?: string }>('/api/auctions/consign', { inventoryId }),
  tradeHistory: () => req<TradeHistoryRow[]>('/api/trades/history'),
  /** One card or a bundle — the trader values every card you put up as one offer. */
  tradePropose: (traderId: number, inventoryIds: number[], cash: number) =>
    post<TradeReply>('/api/trade/propose', { traderId, inventoryIds, cash }),
  tradeAcceptIncoming: (id: number) => post<TradeReply>(`/api/trade/accept-incoming/${id}`),
  tradeRejectIncoming: (id: number) => post<{ ok: boolean; improved?: boolean; bump?: number }>(`/api/trade/reject-incoming/${id}`),
  tradeAcceptCounter: (id: number) => post<TradeReply>(`/api/trade/accept-counter/${id}`),
  tradeDeclineCounter: (id: number) => post<{ ok: boolean }>(`/api/trade/decline-counter/${id}`),
  tradeHaggle: (id: number, cashToYou: number) => post<{ ok: boolean; reply?: string; result?: 'accepted' | 'countered' | 'walked'; error?: string }>(`/api/trade/haggle-counter/${id}`, { cashToYou }),
  ebay: () => req<EbayStatus>('/api/ebay'),
  ebayList: (id: number, ask: number) => post<{ ok: boolean; error?: string }>('/api/ebay/list', { id, ask }),
  ebayCancel: (id: number) => post<{ ok: boolean; error?: string }>(`/api/ebay/cancel/${id}`),
  ebayPromote: (id: number) => post<{ ok: boolean; error?: string }>(`/api/ebay/promote/${id}`),
  ebayMarket: () => req<EbayMarketListing[]>('/api/ebay/market'),
  ebayMarketBuy: (id: number) => post<{ ok: boolean; error?: string }>(`/api/ebay/market/buy/${id}`),
  ebayAuctions: () => req<{ live: EbayAuction[]; recent: EbayAuction[] }>('/api/ebay/auctions'),
  ebayAuctionStart: (id: number, startBid?: number) => post<{ ok: boolean; error?: string; start?: number }>('/api/ebay/auctions/start', { id, startBid }),
  ebayAuctionCancel: (id: number) => post<{ ok: boolean; error?: string }>(`/api/ebay/auctions/cancel/${id}`),
  ebayNpcAuctions: () => req<EbayNpcAuction[]>('/api/ebay/npc-auctions'),
  ebayNpcBid: (id: number, max: number) => post<{ ok: boolean; error?: string; message?: string }>(`/api/ebay/npc-auctions/bid/${id}`, { max }),
  ebayWatch: (cardId: string, maxPrice?: number | null) => post<{ ok: boolean; error?: string }>('/api/ebay/watch', { card_id: cardId, max_price: maxPrice ?? null }),
  ebayUnwatch: (cardId: string) => post<{ ok: boolean }>(`/api/ebay/unwatch/${encodeURIComponent(cardId)}`),

  setDayLength: (hours: 2 | 12 | 24) => post<{ ok: boolean; hours: number }>('/api/settings/day-length', { hours }),
  settings: () =>
    req<{
      apiKeySet: boolean
      pricechartingTokenSet: boolean
      ebayClientIdSet: boolean
      eurUsdRate: number
      backfill: { running: boolean; done: number; total: number; priced: number; lastSource: string | null; lastError: string | null; sources: { pricecharting: boolean; ebay: boolean; tcgcsv: boolean } }
      setsSyncedAt: string | null
      cardsSyncedAt: string | null
      lastSnapshotAt: string | null
      cardCount: number
      priceRecordCount: number
      unpricedCount: number
      quota: import('./api').QuotaState
      tcgcsv: { lastSync: string | null; lastAttempt: string | null }
      benchmark: { rows: number; oldestDay: string | null; newestDay: string | null; covered: boolean; lastFetchAt: string | null; lastSuccessAt: string | null; lastHost: 'query1' | 'query2' | null; mode: 'real' | 'model' }
      delta: import('./api').CatalogDeltaStatus
      dataSources: { name: string; role: string; url: string }[]
    }>('/api/settings'),
  catalogDelta: () => req<import('./api').CatalogDeltaStatus>('/api/sync/delta'),
  runCatalogDelta: () => post<import('./api').CatalogDeltaRun>('/api/sync/delta'),
  setApiKey: (key: string) => post<{ ok: boolean }>('/api/settings/api-key', { key }),
  setPriceSources: (p: { pricechartingToken?: string; ebayClientId?: string; ebayClientSecret?: string; eurUsdRate?: number }) =>
    post<{ ok: boolean; sources: { pricecharting: boolean; ebay: boolean }; eurUsdRate: number; error?: string }>('/api/settings/price-sources', p),
  sealedStatus: () => req<SealedBackfillStatus>('/api/sealed/status'),
  startSealedBackfill: () => post<{ ok: boolean; status: SealedBackfillStatus }>('/api/sealed/backfill', {}),
  priceBackfill: () => post<{ started: boolean; reason?: string }>('/api/prices/backfill'),
  priceBackfillStatus: () =>
    req<{ running: boolean; done: number; total: number; priced: number; lastSource: string | null; lastError: string | null; sources: { pricecharting: boolean; ebay: boolean; tcgcsv: boolean } }>('/api/prices/backfill'),
  tcgcsvSync: () =>
    post<{ ok: boolean; setsSynced: number; cardsPriced: number; error?: string }>('/api/prices/tcgcsv-sync'),
  priceQuota: () =>
    req<import('./api').QuotaState>('/api/prices/quota'),
  resetSave: () => post<{ ok: boolean }>('/api/debug/reset-save'),

  saveBackups: () => req<SaveBackupsResponse>('/api/saves/backups'),
  saveBackupNow: () => post<{ ok: boolean; backup: SaveBackupRow }>('/api/saves/backup', {}),
  saveRestore: (file: string) => post<{ ok: boolean; safety?: string; error?: string }>('/api/saves/restore', { file }),

  tutorialDone: () => post<{ ok: boolean }>('/api/tutorials/start/done'),
  tutorialReplay: () => post<{ ok: boolean }>('/api/tutorials/start/replay'),
  /** The optional Collector's Academy — chapters, progress and the one-time pay. */
  academy: () => req<import('./types').AcademyState>('/api/academy'),
  academyChapter: (id: string) =>
    post<{ ok: boolean; awarded: number; state: import('./types').AcademyState }>('/api/academy/chapter', { id }),
  academyReset: () => post<{ ok: boolean; state: import('./types').AcademyState }>('/api/academy/reset'),
  syncProgress: () => req<import('./types').GameStateResponse['sync']>('/api/sync/progress'),

  changelog: () => req<ChangelogResponse>('/api/changelog'),
  /** Sidebar badge only needs versions; the panel still reads the full log. */
  changelogSummary: () => req<{ current: string; versions: string[] }>('/api/changelog/summary'),
  changelogSeen: () => req<{ seen: string | null; current: string; veteran: boolean }>('/api/changelog/seen'),
  changelogMarkSeen: (version: string) => post<{ ok: boolean; seen: string }>('/api/changelog/seen', { version }),

  updateCheck: () => req<UpdateStatus>('/api/update'),
  updateApply: (version: string) => post<{ ok: boolean; version?: string; installerName?: string; error?: string }>('/api/update/apply', { version }),
  updateSeen: () => post<{ ok: boolean }>('/api/update/seen'),
  updateOpenRelease: (url?: string) => post<{ ok: boolean; url?: string }>('/api/update/open-release', { url }),

  shipments: () => req<ShipmentsSection>('/api/shipments'),
  shipOrder: (kind: string, id: number, method: string, pack: string, photos: boolean) =>
    post<{ ok: boolean; error?: string; postage?: number }>('/api/shipments/ship', { kind, id, method, pack, photos }),
  resolveDispute: (kind: string, id: number) =>
    post<{ ok: boolean; error?: string; outcome?: 'won' | 'lost'; message?: string }>('/api/shipments/dispute', { kind, id }),
}

export type ChangelogEntry = { version: string; date: string; title: string; features: string[] }
export type ChangelogResponse = { current: string; entries: ChangelogEntry[] }
export type UpdateStatus = {
  currentVersion: string
  available: boolean
  version?: string
  installerName?: string
  size?: number
  justUpdated: { from: string; to: string; at: string } | null
  /** False for a portable folder: it is told about a release, not offered an install. */
  canSelfUpdate: boolean
  /** The release page the offered build came from, when it knows one. */
  pageUrl?: string
  source?: 'github' | 'downloads'
}

// ------------------------------------------------------------- Quota / simulated market

export type CatalogDeltaSummary = {
  at: string
  newSets: { id: string; name: string; cards: number }[]
  updatedSets: { id: string; name: string; cards: number }[]
  errors: string[]
}

export type CatalogDeltaStatus = {
  running: boolean
  lastRunAt: string | null
  lastSummary: CatalogDeltaSummary | null
}

export type CatalogDeltaRun = { ran: boolean; reason?: string; summary?: CatalogDeltaSummary }

export type SuppliesStatus = {
  stock: { kind: string; label: string; icon: string; unitCost: number; packSize: number; blurb: string; worthItAbove: number; quantity: number }[]
  wear: { bareCards: number; bareValue: number; byProtection: Record<string, number>; lastWearDay: string | null }
}

export type InsuranceClaimItem = { name: string; from: string; to: string; loss: number }

// ---- Rolling save backups (Settings → Save backups) ------------------------
export type SaveBackupRow = {
  file: string
  createdAt: string
  bytes: number
  inventory: number
  sealed: number
  cash: number | null
}
export type SaveBackupsResponse = { backups: SaveBackupRow[]; daily: { lastDay: string | null } }

// ---- The Floor: card shows as an attendee ---------------------------------
export type FloorTableSummary = {
  id: number
  vendor_name: string
  avatar: string
  specialty: string
  blurb: string
  moodSeen: 'cheerful' | 'fair' | 'grumpy' | 'miserable' | 'unknown'
  haggleTries: number
  soured: boolean
  stock: number
  boxesPending: number
}
export type FloorStatus =
  | { open: false; nextShowHint: string }
  | { open: true; entered: boolean; show: { id: number; name: string; entryFee: number }; tables: FloorTableSummary[]; minutesLeft?: number }
export type FloorItem = {
  id: number
  card_id: string
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
export type FloorTable = {
  ok: boolean
  error?: string
  booth?: { id: number; vendorName: string; avatar: string; specialty: string; blurb: string }
  mood?: number
  moodSeen?: string
  soured?: boolean
  haggleTries?: number
  playerOffered?: number
  items?: FloorItem[]
}
export type FloorHaggleResult = {
  ok: boolean
  error?: string
  accepted?: boolean
  paid?: number
  counter?: number | null
  card?: string
  message?: string
  souredNow?: boolean
}
export type FloorBuyResult = { ok: boolean; error?: string; paid?: number; card?: string }
export type FloorOffer = { id: number; name: string; condition: string; gradedGrade: string | null; anchor: number; offer: number; creditOffer: number }
export type FloorOffersResponse = { ok: boolean; error?: string; booth?: { id: number; vendorName: string; avatar: string }; mood?: number; credit?: number; offers?: FloorOffer[] }
export type FloorSellResult = { ok: boolean; error?: string; sold?: boolean; paid?: number; credit?: boolean; card?: string; message?: string; souredNow?: boolean }

// ---- Local deals: Facebook Marketplace & Craigslist ------------------------
/** What a local listing can be — the feed carries all five. */
export type LocalKind = 'card' | 'sealed' | 'bundle' | 'mystery_slab' | 'mystery_box'

export type LocalFeedRow = {
  id: number
  kind: LocalKind
  kindLabel: string
  cardId: string | null
  name: string
  /** Direct image URL — wrapper art for sealed, first card of a lot. */
  image: string | null
  /** When set, the client derives the art from this card id instead. */
  imageCardId: string | null
  condition: string
  setName: string | null
  /** Supporting line: 'Booster pack · 36 packs', '6 cards · contents listed'. */
  detail: string | null
  /** Disclosed only for a card lot — never for a mystery. */
  contents: { name: string; condition: string }[] | null
  /** 'mkt' = live market value; 'est' = estimate of undisclosed contents. */
  anchorLabel: 'mkt' | 'est'
  ask: number
  anchor: number
  seller: string
  source: 'facebook' | 'craigslist'
  postedAt: string
  expiresAt: string
  delta: number
  tell: '🐟' | '🤔' | null
  counterOffer: number | null
  counterOf: number | null
  ghosted: boolean
}
export type LocalMessage = { kind: 'full' | 'lowball' | 'ghost' | 'meeting'; buyer: string; amount: number | null; note: string }
/** A listing an NPC took off your hands while you were playing. */
export type MyLocalSale = {
  id: number
  name: string
  kind: LocalKind
  kindLabel: string
  paid: number
  buyer: string
  at: string
}
export type MyLocalListing = {
  id: number
  kind: LocalKind
  kindLabel: string
  name: string
  image: string | null
  imageCardId: string | null
  condition: string
  detail: string | null
  contents: { name: string; condition: string }[] | null
  ask: number
  postedAt: string
  expiresAt: string
  inventoryId: number | null
  messages: LocalMessage[]
}
/** What a blind buy actually contained — sent only at the meet, so the UI can
 *  stage the unboxing rather than burying the reveal in a text line. */
export type LocalRevealCard = {
  cardId: string
  name: string
  image: string | null
  set: string | null
  rarity: string | null
  condition: string
  value: number
  grade?: string
}
export type LocalReveal = {
  kind: 'mystery_slab' | 'mystery_box'
  paid: number
  total: number
  items: LocalRevealCard[]
}
export type LocalMeetResult =
  | { ok: true; outcome: 'bought'; paid: number; card: string; inspected: 'genuine' | 'fake'; basis: number; reveal?: LocalReveal }
  | { ok: true; outcome: 'ghosted'; message: string }
  | { ok: true; outcome: 'sold_elsewhere'; message: string }
  | { ok: true; outcome: 'counter'; counter: number; card: string; message: string }
  | { ok: false; error: string }
export type InsuranceClaim = { at: string; kind: string; label: string; loss: number; payout: number; items: InsuranceClaimItem[] }
export type InsurancePolicy = {
  tier: string
  tierName: string
  tierIcon: string
  status: 'active' | 'lapsed'
  startedAt: string
  nextDraftAt: string
  waitingUntil: string | null
  graceUntil: string | null
  waitingDaysLeft: number
  graceDaysLeft: number
  coverage: number
  deductibleFrac: number
  capFrac: number
  weeklyPremium: number
  claimCap: number
  claims: InsuranceClaim[]
  lifetimePremium: number
  lifetimeClaims: number
}
export type InsuranceStatus = {
  policy: (InsurancePolicy & { storageSurcharge?: number; vaultImmuneSlabs?: boolean; vaultProtected?: number; vaultExposed?: number }) | null
  tiers: { id: string; name: string; icon: string; coverage: number; premiumPerWeek: number; deductibleFrac: number; capFrac: number; blurb: string }[]
  appraisal: { raw: number; slab: number; sealed: number; total: number }
  bareCards: number
  cards: number
  weeklyPremiums: Record<string, number>
  storageSurcharge?: number
  vaultImmuneSlabs?: boolean
  vaultProtected?: number
  vaultExposed?: number
}

export type QuotaState = {
  pc: { budget: number; limit: number; exhaustedAt: string | null }
  ebay: { budget: number; limit: number; exhaustedAt: string | null }
  resetsAt: string
  cards?: number
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
  source: 'pricecharting' | 'tcgplayer' | 'pokeinvest' | 'estimated'
  oop: boolean
  oop_months: number
  status: 'in print' | 'out of print'
  market_value: number
  basis: number
  unrealized: number
  packs?: number
  /** Wrapper art, then the set logo and symbol — the same fallback ladder the
   *  Pack Shop shelf uses, so a box looks the same in both places. */
  image_url?: string | null
  set_logo?: string | null
  set_symbol?: string | null
  /** Futures desk: fresh/worn unit split and escrowed (vault) count. */
  freshQty?: number
  wornQty?: number
  escrowed?: number
  condition?: string
}

export type SellSealedResult =
  | { ok: true; units: number; unitPrice: number; gross: number; fee: number; proceeds: number; basis: number; profit: number }
  | { ok: false; error: string }

export type SealedFuturesRow = {
  productId: string
  name: string
  kind: string
  freshQty: number
  wornQty: number
  escrowQty: number
  market: number
  freshPrice: number
  wornPrice: number
  freshBasis: number
  wornBasis: number
  freshValue: number
  wornValue: number
  value: number
  basis: number
  unrealized: number
  oop: boolean
  oopMonths: number
  freshPremium: number
  rewrapFee: number
}

export type SealedLoanRow = {
  id: number
  principal: number
  balance: number
  rateDaily: number
  collateralQty: number
  collateralName: string
  collateralProductId: string | null
  collateralLeft: number
  collateralValue: number
  overhanging: boolean
  status: 'active' | 'settled' | 'forfeited'
  issuedAt: string
}

export type SealedFuturesSection = {
  rows: SealedFuturesRow[]
  terms: { collateralLtv: number; rateDaily: number; overhangRatio: number; overhangRateMult: number; rewrapFeePct: number; dockHaircut: number; minLoan: number }
  activeLoans: number
  outstanding: number
  collateralUnits: number
  escrowedValue: number
  collateral: { units: number; wornValue: number; maxLoan: number; activeLoans: number; outstanding: number }
  loans: SealedLoanRow[]
  history: SealedLoanRow[]
}

export type BinderSummary = { id: number; name: string; accent: string; cover: string; created_at: string; cardCount: number; value: number }

/** Cover stock, from the server's own catalogue (server/services/binders.ts). */
export type BinderCover = { id: string; label: string; blurb: string; unlockAt: number; special: boolean }

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

export type MarketIncomingRow = {
  id: number
  card_id: string
  variant: string
  condition: string
  quantity: number
  cost_basis: number
  via: string
  seller: string | null
  eta_days: number
  due_at: string
  purchased_at: string
  name: string
  image_small: string | null
  image_large: string | null
}

export type PortfolioSetRow = {
  setId: string
  setName: string
  series: string
  releaseDate: string | null
  cardsHeld: number
  invested: number
  value: number
  gain: number
  gainPct: number | null
}

export type PortfolioEraRow = {
  series: string
  sets: number
  invested: number
  value: number
  gain: number
  gainPct: number | null
}

export type PortfolioPosition = {
  cardId: string
  name: string
  image: string | null
  setName: string
  condition: string
  gradedGrade: string | null
  quantity: number
  invested: number
  value: number
  gain: number
  gainPct: number | null
}

export type Portfolio = {
  invested: number
  value: number
  unrealized: number
  unrealizedPct: number | null
  realized: number
  realizedCost: number
  realizedPct: number | null
  salesCount: number
  deployedTotal: number
  moneyWeightedReturnPct: number | null
  mwrNote: string
  totalReturnPct: number | null
  spReturnPct: number | null
  spSameMoney: number
  benchmarkNote: string
  spSource: 'real' | 'model'
  income: { line: string; total: number }[]
  incomeTotal: number
  chart: { week: string; collection: number; sp: number }[]
  sets: PortfolioSetRow[]
  eras: PortfolioEraRow[]
  best: PortfolioPosition | null
  worst: PortfolioPosition | null
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
  valueKind: 'pc-graded' | 'ebay-graded' | null
  valueBasis: 'sold' | 'asking' | 'estimated'
  costBasis: number
  allGrades: { grade: string; usd: number; retrievedAt: string; source: 'pc-graded' | 'ebay-graded'; basis: 'sold' | 'asking' | 'estimated' }[]
  profitIfSoldNow: number
}

// ------------------------------------------------------------------ authentication meta
export type AuthService = {
  id: string
  name: string
  cost: number
  daysMin: number
  daysMax: number
  miss: number
  blurb: string
  requiresVouched?: boolean
}

export type DeskReading = 'vouched' | 'flagged' | 'partial' | null

export type AuthTicket = {
  id: number
  inventoryId: number
  cardId: string
  name: string
  image: string | null
  setName: string
  condition: string
  serviceId: string
  serviceName: string
  fee: number
  status: 'in_lab' | 'arrived'
  hoursLeft: number
  rawValue: number
}

export type AuthAtRisk = {
  inventoryId: number
  cardId: string
  name: string
  image: string | null
  setName: string
  condition: string
  rawValue: number
  riskPct: number
  channel: string
  costBasis: number
  serviceId: string
}

export type AuthTool = { id: string; name: string; icon: string; cost: number; blurb: string; owned: boolean }

export type SurveyToolReading = { id: string; name: string; icon: string; reading: string; suspicious: boolean }

export type AuthAccusation = {
  id: number
  accuser: string
  persona: string
  cardName: string
  basis: number
  evidence: number
  needs: number
}

export type AuthAccusationHistory = { id: number; accuser: string; cardName: string; status: string; verdict: string | null }

export type AuthSection = {
  services: AuthService[]
  tools: AuthTool[]
  tickets: AuthTicket[]
  atRisk: AuthAtRisk[]
  fakes: { inventoryId: number; name: string; image: string | null; setName: string; costBasis: number; sellValue: number }[]
  stats: { authenticatedCards: number; spentOnAuth: number; fakesCaught: number; fakeBasisLost: number; burned: boolean }
  accusation: AuthAccusation | null
  notoriety: number
  suspicion: boolean
  history: AuthAccusationHistory[]
}

export type AuthSurvey = {
  ok: boolean
  found: boolean
  inventoryId?: number
  name?: string
  band?: 'cool' | 'warm' | 'hot'
  chance?: number
  note?: string
  tools?: SurveyToolReading[]
  message?: string
}

export type AuthSubmitResult = { ok: boolean; fee?: number; serviceName?: string; dueDays?: number; error?: string }

export type AuthReveal = {
  ok: boolean
  verdict?: 'genuine' | 'fake'
  inventoryId?: number
  cardId?: string
  name?: string
  image?: string | null
  rawValue?: number
  fee?: number
  message?: string
  error?: string
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
  pristineChance: number | null
  recommended: boolean
  taxSavings: { honest: number; aggressive: number; bracketRate: number; deductible: boolean }
}

// ------------------------------------------------------------------ PSA rush events
export type PsaRushSection = {
  active: boolean
  startedAt: string | null
  endsAt: string | null
  backlogDays: number
  quotaUsed: number
  quotaTotal: number
  specialOpen: boolean
  slabPremium: number
  /** Raw-value floor the $10 special accepts — rush-eligible cards at or above it. */
  minRawValue: number
  spawnChancePerDay: number
  /** Quota slots the NPC horde has already eaten — you're racing them. */
  npcUsed: number
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
  /** Raw single copies in the binder — the pool the candidates list scans. */
  ownedRaw: number
  /** The cheapest open grading door, so an empty list can name its fee and floor. */
  floor: { name: string; cost: number; minRawValue: number }
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
  /** PSA rush pediment-event state (active rush, backlog days, quota, slab premium). */
  rush: PsaRushSection
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
  agent_enabled?: number
  agent_max_price?: number | null
  agent_condition?: string
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

// ------------------------------------------------------------- Market regimes

export type ReprintShock = {
  card_id: string
  name: string
  severity: number
  announced_at: string
  ageDays: number
}

export type MarketRegimes = {
  phase: 'bull' | 'bear' | 'chop'
  since: string
  until: string
  drift: number
  daysLeft: number
  globalFactor: number
  shocks: ReprintShock[]
}

// ------------------------------------------------------------- Seasonal events

export type SeasonalEvent = {
  id: string
  name: string
  icon: string
  blurb: string
  mult: { price: number; walkIn: number; crowd: number; pack: number }
}

export type MarketSeasonal = {
  event: (SeasonalEvent & { endsAt: string; daysLeft: number }) | null
  next: { id: string; name: string; icon: string; startsInDays: number } | null
  multipliers: { price: number; walkIn: number; crowd: number; pack: number }
}

// ------------------------------------------- Population & meta drift

export type MarketSceneSet = { id: string; name: string; demand: number; trend: number; tilt: number }

export type MarketScene = {
  population: { vintage: number; mid: number; modern: number }
  booms: { id: string; era: 'vintage' | 'mid' | 'modern' | 'all'; headline: string; blurb: string; mult: number; daysLeft: number }[]
  hottest: MarketSceneSet[]
  coldest: MarketSceneSet[]
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
  roundUpsEnabled: boolean
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
  ev_net: number
  avg_ev: number
  offer_accept_rate: number | null
  guarding: boolean
  generous: boolean
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
  /** Any pending thread — the live slider bounds for haggling cash. */
  haggle?: { min: number; current: number; rounds: number; incoming: boolean }
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
  kind: 'convention' | 'tournament' | 'sponsor' | 'hosted-show' | 'live-shopping'
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
  | { open: false; nextShowInMin: number; nextShowAt: string | null; nextShowTitle: string | null; liveNow: boolean }
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

/** The shop's card pickers never render art — only these fields leave the server. */
export type ShopStockRow = Pick<StockableRow, 'id' | 'name' | 'set_name' | 'condition' | 'rarity' | 'quantity' | 'anchor' | 'suggestedAsk'>
export type ShopBulkRow = Pick<StockableRow, 'id' | 'name' | 'set_name' | 'condition' | 'rarity' | 'anchor' | 'cost_basis'>
export type ShopBagRow = Pick<StockableRow, 'id' | 'name' | 'set_name' | 'condition' | 'rarity' | 'anchor'> & { isHitTier: boolean; isJunkTier: boolean }

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
  roundup: number
}

export type RoundUpStats = { total: number; donors: number; declinedSales: number }

export type AccountantWasteFlag = { icon: string; title: string; detail: string; atStake: number }

export type AccountantStatus =
  | { hired: false; applicants: { name: string; quality: number; blurb: string }[]; weeklyFee: number }
  | {
      hired: true
      name: string
      quality: number
      hiredAt: string
      weeklyFee: number
      deductionBonusPct: number
      thisWeek: { revenue: number; costs: number; net: number }
      flags: AccountantWasteFlag[]
      lastWeekSummary: { revenue: number; costs: number; net: number }
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

export type StaffPoach = { offered: number; rival: string; daysLeft: number }

export type StaffHuff = { kind: 'raise' | 'snub'; asked: number | null; text: string; daysLeft: number }

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
  // Employees with lives
  xp: number
  nextXp: number | null
  floorXp: number
  mood: number
  moodLabel: string
  marketWage: number
  day_off: string | null
  day_off_ask: string | null
  offToday: boolean
  dayOffLabel: string | null
  dayOffAskLabel: string | null
  poach: StaffPoach | null
  huff: StaffHuff | null
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
  rows: ShopBagRow[]
  price: number
}

// ------------------------------------------------------------- lending desk

export type LendingOffer = {
  id: number
  borrower: string
  card_id: string
  card: string
  condition: string
  market: number
  ask: number
  created_at: string
  expires_at: string
  status: string
  principal: number
  /** One entry per offered rate, keyed by the rate as a string ('0.005'). */
  interest: Record<string, number>
}

export type LendingLoan = {
  id: number
  borrower: string
  card: string
  card_id: string
  condition: string
  principal: number
  rate_daily: number
  interest: number
  payoff: number
  worth: number
  daysLeft: number
  issued_at: string
  due_at: string
}

export type LendingHistoryRow = {
  id: number
  card: string
  borrower: string
  principal: number
  interest: number
  total: number
  status: 'repaid' | 'defaulted'
  issued_at: string
  due_at: string
  repaid_amount: number | null
}

export type LendingDesk = {
  terms: { days: number; maxLtv: number; rates: number[]; offerTtlDays: number; openOffers: number }
  offers: LendingOffer[]
  loans: LendingLoan[]
  history: LendingHistoryRow[]
  stats: {
    lentOut: number
    openLoans: number
    interestEarned: number
    repaid: number
    defaulted: number
    defaultRate: number | null
    collateralValue: number
    defaultedValue: number
  }
}

// ------------------------------------------------------------------ repacks

export type RepackShelf = {
  id: number
  label: string
  price: number
  cards_per_pack: number
  pack_count: number
  published_odds: number
  actual_odds: number
  chase_card_id: string
  card: string
  chase_value: number
  cost_basis: number
  sold: number
  revenue: number
  complaints: number
  status: string
  created_at: string
  remaining: number
  margin: number
  honest: boolean
}

export type RepackHistory = Omit<RepackShelf, 'remaining' | 'margin' | 'honest'> & { resolved_at: string | null }

export type RepackTerms = {
  prices: number[]
  packCount: number
  cardsPerPack: number
  publishedOdds: number[]
  minChaseMultiple: number
  fillerCeiling: number
}

export type RepackStatus = {
  batches: RepackShelf[]
  history: RepackHistory[]
  reputation: number
  terms: RepackTerms
}

export type RepackStockable = {
  ok: true
  rows: { id: number; card_id: string; name: string; anchor: number; condition: string; set_name: string; rarity: string | null }[]
  fillerCount: number
  need: number
  terms: RepackTerms
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
  lines: { cases: PnlLine; bulk: PnlLine; bags: PnlLine; repacks: PnlLine; lending: PnlLine; consignment: PnlLine }
  salesTaxCollected: PnlLine
  overhead: { rent: PnlOverheadLine; mortgage: PnlOverheadLine; payroll: PnlOverheadLine; interest: PnlOverheadLine; other: PnlOverheadLine }
  shows: { amount: number; entries: number }
  productRevenue: number
  totalCosts: number
  net: number
  margin: number | null
}

export type PnlWeekRow = { week: string; revenue: number; costs: number; shows?: number; lending?: number; net: number }

export type PnlResponse = { current: PnlStatement; history: PnlWeekRow[]; protection: ProtectionCosts }

export type ProtectionCosts = {
  insurance: number
  lockerRent: number
  vaultRider: number
  total: number
  active: boolean
  policyTier: string | null
  policyActive: boolean
  lockers: number
  vaultActive: boolean
}

export type ShopStatsDay = {
  day: string
  revenue: number
  costs: number
  net: number
  customers: number
  reputation: number
  lifetimeNet: number
}

// ---- Today panel — everything that rolls at the next UTC midnight ---------
export type TodayRoll = {
  kind: string
  label: string
  detail: string
  amount: number | null
  cadence: 'daily' | 'weekly'
  firedKey: string
}
export type TodayResponse = { rolls: TodayRoll[]; resetsAt: string; dayNumber: number }

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

/** The building itself (v0.5.97): rent creep for tenants, deed + mortgage for owners. */
export type ShopMortgage = {
  id: number
  lender: string
  principal: number
  balance: number
  rateDaily: number
  daily: number
  paidOff: boolean
}

export type ShopProperty = {
  owned: boolean
  boughtAt: string | null
  deedPrice: number | null
  price: number            // landlord's asking price (tenant view)
  down: number             // cash due at signing
  principal: number        // what the mortgage would cover
  rate: number             // per game-day
  daily: number            // scheduled draft once mortgaged
  rentBase: number         // the tier's base rent
  rentCurrent: number      // live rent (0 when owned)
  rentCap: number          // 3× base — the landlord's ceiling
  reviewEveryDays: number
  lastReviewAt: string | null
  nextReviewAt: string
  mortgage: ShopMortgage | null
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
        property: ShopProperty
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
      roundUps: RoundUpStats
      roundUpsEnabled: boolean
      consignment: ConsignmentStatus
      salesTax: SalesTaxStatus
    }

export type ConsignmentRow = {
  id: number
  card_id: string
  variant: string
  condition: string
  quantity: number
  ask: number
  ownerName: string
  ownerMin: number
  anchor: number
  commission: number
  name: string
  image: string | null
  setName: string
  delta: number | null
  patienceDays: number
  expiresAt: string
  status: string
  soldPrice: number | null
}

export type ConsignmentStatus = {
  offers: ConsignmentRow[]
  active: ConsignmentRow[]
  history: ConsignmentRow[]
  earned: number
  commissionPct: number
  slots: number
}

// ------------------------------------------------------------- franchise

export type FranchiseShelfRow = {
  id: number
  card_id: string
  name: string
  set_name: string
  image_small: string | null
  variant: string
  condition: string
  quantity: number
  ask: number
  anchor: number
  delta: number | null
  cost_basis: number
}

export type FranchiseSaleRow = { id: number; name: string; quantity: number; price: number; buyer: string; skimmed: number; sold_at: string }

export type FranchiseManagerCandidate = { name: string; quality: number; wage: number; blurb: string }

export type FranchiseInternalCandidate = { employeeId: number; name: string; quality: number; counterWage: number; wage: number; salesLift: number; leakMult: number; blurb: string }

export type LoyaltyView = {
  loyalty: number
  mood: string
  marketWage: number
  fairRatio: number
  tenureDays: number
  interim?: boolean
  demand: { asked: number; daysHeld: number; walksInDays: number } | null
  drawBonus?: number
}

export type FranchiseDm = {
  name: string
  quality: number
  wage: number
  coachStreak: number
  promoted: boolean
  weeklyCost: number
  loyalty: LoyaltyView
}

export type FranchiseStore = {
  id: number
  name: string
  tier: string
  tierLabel: string
  rent: number
  managerName: string
  managerQuality: number
  managerWage: number
  promoted: boolean
  reputation: number
  lifetimeRevenue: number
  lifetimeCost: number
  customerCount: number
  todayCustomers: number
  todayRevenue: number
  shelfUnits: number
  shelfRows: number
  shelfCap: number
  darkDays: number
  skimStreak: number
  loyalty: LoyaltyView
  interimCandidates: FranchiseManagerCandidate[]
  leakChance: number
  inTransit: number
  shelves: FranchiseShelfRow[]
  recent: FranchiseSaleRow[]
  pnl: { week: string; revenue: number; costs: number; rent: number; payroll: number; other: number; net: number; entries: number }
  lastAudit: string | null
}

export type FranchiseSlot = {
  id: number
  locked: boolean
  lockReason: string | null
  tiers: { id: string; label: string; blurb: string; deposit: number; rent: number }[]
  candidates: FranchiseManagerCandidate[]
  internal: FranchiseInternalCandidate[]
}

export type FranchiseStatus =
  | { canOpen: false; reason: string }
  | {
      canOpen: true
      dm: FranchiseDm | null
      regional: { name: string; quality: number; wage: number; weeklyCost: number; reportDay: string; unlocks: string; loyalty: LoyaltyView } | null
      regionalCandidates: { name: string; quality: number; wage: number; blurb: string }[]
      regionalInternal: never[]
      dmCandidates: FranchiseManagerCandidate[]
      dmInternal: FranchiseInternalCandidate[]
      stores: FranchiseStore[]
      slots: FranchiseSlot[]
      chainPnl: { week: string; revenue: number; costs: number; rent: number; payroll: number; other: number; net: number; entries: number }
      sharedPool: { used: number; cap: number }
    }

// --------------------------------------------------------- rival shop

export type RivalStatus =
  | { exists: false; closed: boolean; poach: number; war: null; buyoutPrice: number; bump: number }
  | {
      exists: true
      closed: false
      name: string
      quality: number
      reputation: number
      aggression: number
      cashHint: string
      stock: { case_no: number; card_id: string; quantity: number; ask: number; basis: number; name: string; image_small: string | null; rarity: string | null; set_name: string; anchor: number; delta: number | null; undercutsYou: boolean }[]
      recent: { id: number; name: string; quantity: number; price: number; buyer: string; sold_at: string }[]
      poach: number
      war: { until: string } | null
      humbled: boolean
      buyoutPrice: number
      bump: number
    }

// --------------------------------------------------------- achievements

export type AchievementRow = {
  id: string
  icon: string
  title: string
  desc: string
  group: string
  unlockedAt: string | null
  pct: number
  label?: string
  isNext: boolean
}

export type AchievementsStatus = {
  ok: true
  unlockedCount: number
  total: number
  groups: string[]
  rows: AchievementRow[]
  recent: AchievementRow[]
}

// --------------------------------------------------------- pricing intel

export type IntelVenue = {
  kind: 'flagship' | 'satellite'
  id: number
  name: string
  etaHours: number
  score: number
  note: string
  nonprofit?: boolean
}

export type IntelCard = {
  inventoryId: number
  name: string
  setName: string
  imageSmall: string | null
  rarity: string | null
  condition: string
  quantity: number
  anchor: number
  ask: number
  here: { kind: 'flagship' | 'satellite'; id: number; name: string; etaHours: number; score: number } | null
  best: IntelVenue | null
  venues: IntelVenue[]
  gainHours: number | null
  transferNote: string | null
  verdict: 'move' | 'leave' | 'unknown'
}

export type IntelStatus = {
  ok: boolean
  error?: string
  venues: { kind: 'flagship' | 'satellite'; id: number; name: string; note: string }[]
  cards: IntelCard[]
  summary: { total: number; moves: number; pooled: number; pooledCap: number }
}

// ------------------------------------------------------- storage unit auctions

export type StorageUnitOut = {
  id: number
  facility: string
  unit_code: string
  flavor: string
  flavor_label: string
  flavor_blurb: string
  street_price: number
  peek: { label: string; blurb: string; line: string }
  closes_at: string
  minutes_left: number
  current_bid: number
  current_bidder: string
}

export type StorageUnitsSection = {
  units: StorageUnitOut[]
  history: { id: number; unit_code: string; facility: string; flavor_label: string; paid: number | null; contents_value: number | null; profit: number | null; won: boolean }[]
  bulkRate: number
}

export type StorageOpenResult = {
  ok: boolean
  error?: string
  unit?: { id: number; facility: string; unit_code: string; paid: number | null }
  contentsValue?: number | null
  collectionFound?: boolean
  cards?: { card_id: string; name: string; image_small: string | null; rarity: string | null; set_name: string; condition: string; value: number; hidden_collection: number }[]
}

// ------------------------------------------------- storage & the vault

export type StorageCapacity = {
  rawOwned: number
  slabOwned: number
  rawCapacity: number
  slabCapacity: number
  rawFree: number
  slabFree: number
  rawPct: number
  slabPct: number
  hot: boolean
  full: boolean
  lockers: { id: number; tier: string; label: string; capacity: number; monthly: number; rentedAt: string; nextBillAt: string }[]
  vault: { active: boolean; capacity: number; monthly: number; startedAt: string; nextBillAt: string } | null
  monthlyTotal: number
  tiers: { id: string; label: string; blurb: string; capacity: number; monthly: number }[]
  overflowPolicy: 'refuse' | 'scrap'
  bulkRate: number
  overflowSurfaces: { id: string; label: string }[]
  scrapFloor: number
}

export type StorageScrapFloorResult = { ok: boolean; floor?: number; error?: string }

export type StorageOverflowResult = { ok: boolean; policy?: 'refuse' | 'scrap'; error?: string }
export type StorageOverflowPreview = { needed: number; wouldScrap: number; available: number; estimateLow: number; estimateHigh: number; blockedByFloor: boolean; scrapFloor: number; label: string | null }

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
    | { open: false; nextShowInMin: number; nextShowAt: string | null; nextShowTitle: string | null; liveNow: boolean }
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
  /** Real wrapper art (TCGplayer CDN) when matched for this product. */
  image_url: string | null
  /** Packs per side — the whole box: bundle 6, ETB 9, display 36. */
  packs: number
  /** What one side stakes: the whole box — every pack that gets ripped. */
  stake?: number
}

/** The stream setup picker only needs the label and shelf price. */
export type StreamProduct = Pick<BattleProduct, 'id' | 'name' | 'market_price' | 'msrp'>

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
  myBestPack?: number
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
  myBestPack?: number
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
  break?: {
    breakId: number
    spotsSold: number
    spotsTotal: number
    gross: number
    productCost: number
    net: number
    houseCards: number
    best: { name: string; value: number; team: string | null; holder: string | null } | null
  } | null
  error?: string
}

// ------------------------------------------------------------- Case breaks

export type BreakSpot = { id: number; spotNo: number; team: string; holder: string; payout: number; pulls: number }

export type BreakStatus = {
  id: number
  productId: string
  productName: string
  spotPrice: number
  spotsTotal: number
  spotsSold: number
  gross: number
  productCost: number
  housePot: number
  status: string
  live: boolean
  spots: BreakSpot[]
  openTeams: string[]
} | null

export type BreakRipResult = {
  ok: boolean
  error?: string
  packNo?: number
  cards?: { cardId: string; name: string; value: number; isHit: boolean; spot: string | null; holder: string | null }[]
  packBest?: { name: string; value: number; team: string | null; holder: string | null } | null
  viewers?: number
  viewerDelta?: number
  chat?: { at: number; who: string; avatar: string; text: string }[]
  donations?: { amount: number; who: string; text: string }[]
  spotsSold?: number
  spotsTotal?: number
  streamDone?: boolean
  newBest?: { name: string; value: number } | null
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

export type ResaleBuy = { ok: boolean; bought?: number; spent?: number; estValue?: number; short?: number; error?: string }

export type FlipStock = {
  dealer: string
  lots: {
    inventoryId: number
    cardId: string
    name: string
    image: string | null
    condition: string
    variant?: string
    quantity: number
    costBasis: number
    market: number
    offer: number
    /** Raw and unprotected — the dealer pays under a sleeved copy. */
    bare?: boolean
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

export type EbayListing = {
  id: number
  inventory_id: number
  card_id: string
  variant: string
  condition: string
  quantity: number
  ask: number
  market_at_list: number
  status: string
  views: number
  watchers: number
  buyer: string | null
  sold_price: number | null
  fee: number | null
  shipping: number | null
  net: number | null
  paid: number
  promoted_ticks: number
  listed_at: string
  sold_at: string | null
  ships_at: string | null
  name: string
  image_small: string | null
  set_name: string | null
}

export type EbayMarketListing = {
  id: number
  card_id: string
  condition: string
  quantity: number
  ask: number
  market_at_list: number
  /** The printing on offer: a Sequin copy is the same number on different paper. */
  variant: string
  seller: string
  listed_at: string
  expires_at: string
  name: string
  image_small: string | null
  set_name: string | null
}

export type EbayAuction = {
  id: number
  inventory_id: number
  card_id: string
  variant?: string
  condition: string
  quantity: number
  start: number
  market_at_list: number
  current_bid: number
  bid_count: number
  leader: string | null
  extended: number
  status: string
  net: number | null
  paid: number
  closes_at: string
  ships_at: string | null
  name: string
  image_small: string | null
  set_name: string | null
}

export type EbayNpcAuction = {
  id: number
  card_id: string
  variant?: string
  condition: string
  quantity: number
  market_at_list: number
  current_bid: number
  min_next: number
  leader: string | null
  my_escrow: number
  my_max: number
  bid_count: number
  status: string
  hammer: number | null
  winner: string | null
  closes_at: string
  name: string
  image_small: string | null
  set_name: string | null
}

export type EbayWatch = {
  id: number
  card_id: string
  max_price: number | null
  name: string
  image_small: string | null
  set_name: string | null
  created_at: string
}

export type EbayStatus = {
  live: EbayListing[]
  sold: EbayListing[]
  feedback: { avg: number; count: number }
  feesPaid: number
  shippingPaid: number
  feeRate: number
  promoRate: { flat: number; pct: number; ticks: number }
  watches: EbayWatch[]
}

// ------------------------------------------------------------- shipping & disputes

export type ShipmentRow = {
  id: number
  kind: 'fixed' | 'auction'
  ref_id: number
  card_id: string
  quantity: number
  gross: number
  fee: number
  postage: number
  net: number
  buyer: string
  method: string | null
  pack: string | null
  photos: number
  status: string
  packed_at: string | null
  arrives_at: string | null
  resolved_at: string | null
  outcome: string | null
  name?: string
  image_small?: string | null
  est_postage?: Record<string, number>
}
export type ShipMethodInfo = { id: string; label: string; icon: string; base: number; pct: number; blurb: string }
export type PackLevelInfo = { id: string; label: string; icon: string; perCard: { kind: string; n: number }[]; blurb: string }
export type ShipmentsSection = {
  toShip: ShipmentRow[]
  inFlight: ShipmentRow[]
  history: ShipmentRow[]
  methods: ShipMethodInfo[]
  packs: PackLevelInfo[]
}

// ------------------------------------------------------------- hosted shows

export type ShowDealer = { name: string; avatar: string; specialty: string; committed: boolean; reason: string }

export type GuestOption = {
  guest: { id: string; name: string; blurb: string; fee: number; crowdMult: number; repBonus: number; repRequired: number }
  declined: boolean
}

export type GuestBooked = { id: string; name: string; blurb: string; fee: number; crowdMult: number; repBonus: number; repRequired: number }

export type ShowResultRow = {
  id: number
  venue: string
  walkins: number | null
  gate_revenue: number | null
  tables_sold: number | null
  table_revenue: number | null
  refund: number | null
  rep_delta: number | null
  notes: string | null
  profit: number
}

export type ShowsStatus =
  | {
      hasShow: false
      rep: number
      nextRepTier: { label: string; blurb: string; next: number | null }
      venues: { id: string; name: string; blurb: string; cost: number; deposit: number; crowd: number; capacity: number; total: number }[]
      guests: GuestOption[]
      tableAnchorHint: number
      recent: ShowResultRow[]
    }
  | {
      hasShow: true
      show: { id: number; venue: string; gate: number; table_price: number; tables_total: number; opens_at: string; closes_at: string }
      venue: { id: string; name: string; blurb: string; cost: number; deposit: number; crowd: number; capacity: number }
      rep: number
      nextRepTier: { label: string; blurb: string; next: number | null }
      opensInMin: number
      closesInMin: number
      roster: ShowDealer[]
      committed: number
      hostBooth?: boolean
      guests: GuestOption[]
      bookedGuests: GuestBooked[]
      projectedWalkins: number
      tableAnchorHint: number
      expectedGate: number
      recent: ShowResultRow[]
    }

// ------------------------------------------------------------------- buylist

export type BuylistShopOut = {
  id: number
  name: string
  blurb: string
  basePct: number
  bonusRate: number
  credit: number
  wants: { cardId: string; name: string; market: number; premium: number }[]
}

export type BuylistSection = {
  shops: BuylistShopOut[]
  offers: { shopId: number; count: number; totals: { cash: number; credit: number } }[]
}

export type BuylistOfferRow = {
  inventoryId: number
  cardId: string
  name: string
  variant: string
  condition: string
  market: number
  payoutCash: number
  payoutCredit: number
  want: boolean
  wantPremium: number
}

export type BuylistOffers = {
  shopId: number
  shop: { id: number; name: string; blurb: string; greed: number; wantCount: number; bonusRate: number }
  offers: BuylistOfferRow[]
  totals: { cash: number; credit: number }
}

export type BuylistShelf = {
  shopId: number
  shop: { id: number; name: string; blurb: string; greed: number; wantCount: number; bonusRate: number }
  rows: { id: number; cardId: string; name: string; variant: string; condition: string; price: number; market: number; wantStock: boolean }[]
  credit: number
  history: { delta: number; created_at: string; note: string }[]
}

// ------------------------------------------------------------------ pawn shop

export type PawnTerms = {
  fireSaleOfMarket: number
  quotePct: number
  loanPct: number
  rateDaily: number
  days: number
  graceDays: number
  shelfMarkup: number
}

export type PawnQuoteRow = {
  inventoryId: number
  cardId: string
  name: string
  variant: string
  condition: string
  gradedGrade: string | null
  image: string | null
  market: number
  fireSale: number
  cashNow: number
  loanMax: number
}

export type PawnLoanRow = {
  id: number
  card: string
  principal: number
  interest: number
  total: number
  status: string
  issued_at: string
  due_at: string
  repaid_amount: number | null
}

export type PawnSection = {
  quotes: PawnQuoteRow[]
  terms: PawnTerms
  activeLoans: number
  outstanding: number
  loans: PawnLoanRow[]
  shelf: { rows: { id: number; cardId: string; name: string; ask: number; market: number; mine: boolean; loanId: number | null }[]; mineCount: number }
  history: PawnLoanRow[]
}

// ------------------------------------------------------------------ yard sales

export type YardCard = { id: number; condition: string; qty: number; ask: number; peek: string }

export type YardSaleRow = {
  id: number
  seller: string
  neighborhood: string
  opensAt: string
  closesAt: string
  expired: boolean
  boxAsk: number | null
  boxTaken: boolean
  playerOffered: number
  sellerCounters: number
  table: YardCard[]
  boxCount: number
}

// ------------------------------------------------------------------ flea markets

export type FleaBin = { id: number; price: number; label: string; remaining: number; total: number; hotScores: number }

export type FleaMarketRow = {
  id: number
  grounds: string
  opensAt: string
  closesAt: string
  expired: boolean
  bins: FleaBin[]
}

export type FleaDigResult = { name: string; condition: string; paid: number; trueMarket: number; stolen: boolean; at: string; cardId?: string }

export type FleaSection = {
  terms: { binPrices: number[]; scoreChance: number; opensHour: number; windowHours: [number, number] }
  isWeekend: boolean
  openHour: number
  pickersActive: boolean
  markets: FleaMarketRow[]
  myDigs: FleaDigResult[]
}

export type YardSection = {
  terms: { peekCalibration: [number, number]; counterMax: number; boxAskPct: number; tableSize: [number, number]; boxSize: [number, number]; windowHours: [number, number] }
  isWeekend: boolean
  sales: YardSaleRow[]
}

export type YardOfferResult = {
  ok: boolean
  accepted?: boolean
  paid?: number
  counter?: number | null
  card?: string
  cardId?: string
  condition?: string
  qty?: number
  value?: number
  message?: string
  error?: string
}

/** What a yard-sale pile actually hands you. */
export type YardPickResult = {
  ok: boolean
  paid?: number
  card?: string
  cardId?: string
  condition?: string
  qty?: number
  value?: number
  error?: string
}

export type YardBoxResult = {
  ok: boolean
  cards?: { name: string; condition: string; qty: number; value: number }[]
  paid?: number
  trueTotal?: number
  error?: string
}

// ------------------------------------------------------------------ estate buyouts
export type EstateSaleListing = {
  id: number
  seller_name: string
  persona: string
  persona_label: string
  persona_blurb: string
  mood: number
  card_count: number
  ask: number
  opening_ask: number
  estimate: number
  yourOffer: number | null
  /** Sealed by an accepted handshake — buy() charges this instead of `ask`. */
  dealPrice?: number | null
  countersUsed: number
  finalSaid: boolean
  glimpse_note: string
  glimpses: { card_id: string; name: string; image_small: string | null; set_name: string; condition: string; hidden: boolean }[]
  condBand: { lo: number; hi: number }
  condHidden: number
  hoursLeft: number
  hoursPerGameDay: number
  /** True during this save's forum first-refusal window on this listing (rep 25 perk). */
  refusal?: boolean
}

export type EstateBuyoutsSection = {
  listings: EstateSaleListing[]
  stats: { bought: number; cardsInherited: number; spent: number; realized: number; net: number }
}

export type EstateBuyoutResult = {
  ok: boolean
  paid?: number
  estimate?: number
  realized?: number
  profit?: number
  pct?: number
  admitted?: number
  leftBehind?: number
  rolledCount?: number
  condBand?: { lo: number; hi: number }
  verdict?: string
  cards?: { card_id: string; name: string; condition: string; set_name: string; image_small: string | null; price: number; rolled?: boolean }[]
  error?: string
}

// ------------------------------------------------------------- NPC live shopping
export type LiveItem = {
  id: number
  kind: 'drop' | 'auction' | 'mystery' | 'sudden' | 'teamspot' | 'ripship'
  name: string
  cardId: string | null
  variant: string
  image: string | null
  status: string
  shipChoice: string | null
  ask: number | null
  market: number
  currentBid: number | null
  bids: number
  endsAt: string | null
  leading: boolean
  outbid: boolean
  myBid: number | null
}

export type LiveBreakBoard = {
  itemId: number
  spots: { id: number; team: string; ask: number; mine: boolean; holder: string | null }[]
}

export type LiveChannel = {
  showId: number
  host: string
  avatar: string
  style: string
  rating: number
  followers: number
  integrity: number
  product: string
  image: string | null
  rips: { done: number; planned: number }
  viewers: number
  peakViewers: number
  endsAt: string
  bestPull: { name: string; value: number } | null
}

export type LiveSection = {
  now: boolean
  channels: LiveChannel[]
  upcoming: { start: string; end: string; title: string; host: string; avatar: string; now: boolean }[]
  currentShow: {
    id: number
    host: { name: string; avatar: string; rating: number; followers: number; integrity: number; style: string } | null
    product: { name: string; market: number; symbol: string | null; image: string | null }
    rips: { done: number; planned: number }
    viewers: number
    peakViewers: number
    proceeds: number
    bestPull: { name: string; value: number } | null
    chat: { at: number; who: string; avatar: string; text: string }[]
    items: LiveItem[]
    recent: LiveItem[]
    boards: LiveBreakBoard[]
    style: string
    endsAt: string
    serverNow: string
  } | null
  hosts: { name: string; avatar: string; style: string; followers: number; rating: number; note: string }[]
  recentShows: { id: number; host: string; avatar: string; rips: number; bestPull: { name: string; value: number } | null; proceeds: number; at: string }[]
  wins: { card: string; variant: string; paid: number; value: number; host: string; at: string }[]
}

// ------------------------------------------------------------------ wishlist agents
export type AgentBuy = {
  cardId: string
  name: string
  surface: 'market' | 'bidbay'
  paid: number
  condition: string
  seller: string
  cap: number
}

export type AgentsSection = {
  orderCap: number
  armed: { cardId: string; name: string; image: string | null; cap: number; condition: string; needsTarget: boolean }[]
  conditions: string[]
}

// ------------------------------------------------------------------ community forum
export type ForumPost = {
  id: number
  kind: 'pull' | 'guide' | 'reply'
  title: string
  body: string | null
  cardName: string | null
  warmth: number
  createdAt: string
}

export type ForumGroupBuy = {
  id: number
  cardName: string
  cardId: string | null
  totalCost: number
  myShare: number
  splitN: number
  status: 'open' | 'filled'
  etaDays: number
}

export type ForumSection = {
  rep: number
  tier: 'lurker' | 'regular' | 'known' | 'trusted' | 'pillar'
  groupBuys: boolean
  firstRefusal: boolean
  shipFirst: boolean
  nextAt: number | null
  nextLabel: string | null
  posts: ForumPost[]
  repliesToday: number
  guideToday: number
  groupBuyList: ForumGroupBuy[]
  deliveredBuys: number
  streetHot: boolean
  thresholds: { groupBuy: number; firstRefusal: number; shipFirst: number }
}
