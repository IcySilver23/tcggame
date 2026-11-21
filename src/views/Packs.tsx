import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { byNum, byStr, Chip, EmptyState, fmtUsd, matchesQuery, OverflowMenu, SearchInput, SortSelect } from '../components'
import type { DailyDealHistoryDay, ProductDetail, ProductRow } from '../types'

// ---------------------------------------------------------------------------
// 📦 Pack Shop — a shop (roadmap: one verb per venue — RIP).
//
// It used to be a grid of tiles on a dark background: a dashboard of products,
// not a store you could stand in. This is a floor plan instead. Products sit on
// shelving planks under aisle signs, each with a stick-on price label like a
// real shelf edge, and the till stands beside the floor — always on screen, so
// the thing you picked is the thing you can pay for.
//
// The numbers stay honest: the label shows the typical (median) rip as a share
// of the price, and the till carries the chase maths. Nothing here is modelled
// beyond what the server already publishes.
// ---------------------------------------------------------------------------

// WotC sets whose unlimited packs can ghost 1st Edition pulls.
const GHOST_SETS = new Set(['base1', 'base2', 'base3', 'gym1', 'gym2', 'neo1', 'neo2', 'neo3', 'neo4', 'base5'])

/** The shelf price from the lazy detail, before any daily deal. */
const marketOf = (d: ProductDetail | undefined) => d?.market ?? 0
/** The till price: today's deal when the shop has one, otherwise the shelf price. */
const priceOf = (p: ProductRow, d: ProductDetail | undefined) => {
  const market = marketOf(d)
  if (!(market > 0)) return null
  return p.deal
    ? Math.round(market * (1 - p.deal.discountPct / 100) * 100) / 100
    : market
}
/** A published quote, not a modelled shelf price. */
const isRealPrice = (source: ProductRow['price_source']) => source === 'pricecharting' || source === 'tcgplayer' || source === 'pokeinvest'
const priceSourceName = (source: ProductRow['price_source']) =>
  source === 'tcgplayer' ? 'TCGplayer market'
    : source === 'pricecharting' ? 'PriceCharting guide'
      : source === 'pokeinvest' ? 'PokeInvest market'
        : 'pack contents'
const priceSourceTitle = (source: ProductRow['price_source']) => isRealPrice(source)
  ? `Published market quote — ${priceSourceName(source)}`
  : 'Model estimate derived from the packs inside — not a published quote'
/** Packs inside one purchase — a display is not priced like a booster. */
const packsIn = (p: ProductRow) => Math.max(1, p.packs ?? 1)
/** Drop the era prefix the shelf already knows, for narrow labels. */
const shortDealName = (name: string) => name.replace(/Scarlet & Violet—|Sword & Shield—/, '')
/** Sorts whose numbers live in productDetail(), not the fast list. */
const DETAIL_SORTS = new Set(['p50_desc', 'p50_asc', 'avg_desc', 'chase_desc', 'price_asc', 'price_desc'])

/** Typical return: median pack value × packs, against the product's price. */
const p50Of = (p: ProductRow, d: ProductDetail | undefined) => {
  const price = priceOf(p, d)
  return d && price && price > 0 ? (d.est.p50 * packsIn(p)) / price : null
}
/** Chase-weighted return — the long-run mean, dominated by the top hits. */
const avgOf = (p: ProductRow, d: ProductDetail | undefined) => {
  const price = priceOf(p, d)
  return d && price && price > 0 ? (d.est.avg * packsIn(p)) / price : null
}
/** "7h 12m" until the game day rolls, without a live second-by-second tick. */
function timeLeft(endsAt: string | undefined, now: number): string {
  const ms = Date.parse(endsAt ?? '') - now
  if (!Number.isFinite(ms) || ms <= 0) return 'rolling over'
  const mins = Math.max(1, Math.floor(ms / 60000))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** A past game-day key as a short shelf label: "Nov 12 · PM". */
function dealDayLabel(dayKey: string): string {
  const [y = 1970, m = 1, d = 1] = dayKey.slice(0, 10).split('-').map(Number)
  const label = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
  if (dayKey.endsWith('-am')) return `${label} · AM`
  if (dayKey.endsWith('-pm')) return `${label} · PM`
  return label
}

/** 0.01 → "1%", 0.89 → "89%", 27 → "27×" — never a four-digit percentage. */
const ratioLabel = (r: number) => {
  if (!Number.isFinite(r) || r <= 0) return '0%'
  if (r >= 10) return `${Math.round(r)}×`
  return `${Math.round(r * 100)}%`
}

/** Aisle signage, in the order you walk the store. */
const AISLE_LABEL: Record<string, string> = {
  booster: 'Booster packs',
  bundle: 'Bundles',
  etb: 'Elite Trainer Boxes',
  display: 'Displays & cases',
  tin: 'Tins & special',
  special: 'Counter stock',
  other: 'Counter stock',
}
const aisleRank = (kind: string) => {
  const order = ['booster', 'bundle', 'etb', 'display', 'tin', 'other']
  const i = order.indexOf(kind)
  return i === -1 ? order.length : i
}
const isNew = (p: ProductRow) => {
  const t = Date.parse(p.release_date ?? '')
  return Number.isFinite(t) && Date.now() - t < 1000 * 60 * 60 * 24 * 400
}

/** The product's real wrapper art — a shelf shows the pack you would buy.
 *  Products TCGplayer never listed fall back to their set's logo, then the
 *  set symbol, so every product still has a face. */
function ProductArt({ p }: { p: ProductRow }) {
  const [imageBroken, setImageBroken] = useState(false)
  const [logoBroken, setLogoBroken] = useState(false)
  const [symbolBroken, setSymbolBroken] = useState(false)
  if (p.image_url && !imageBroken) {
    return <img src={p.image_url} alt="" loading="lazy" onError={() => setImageBroken(true)} />
  }
  if (p.set_logo && !logoBroken) {
    return (
      <span className="bay-art-ph" title={p.set_name}>
        <img className="bay-set-logo" src={p.set_logo} alt="" loading="lazy" onError={() => setLogoBroken(true)} />
      </span>
    )
  }
  return (
    <span className="bay-art-ph" title={p.set_name}>
      {p.set_symbol && !symbolBroken
        ? <img src={p.set_symbol} alt="" loading="lazy" onError={() => setSymbolBroken(true)} />
        : <span aria-hidden>📦</span>}
    </span>
  )
}

/** One honest sentence about the rip, in this product's own numbers. */
function ripLine(p: ProductRow, d: ProductDetail | undefined): string {
  if (!d) return 'The clerk is weighing this pack — the numbers land in a moment.'
  const chase = d.est.topChases[0]
  const typical = p50Of(p, d) ?? 0
  const oop = p.oop
    ? ` The print run ended ${(p.oop_months ?? 0) >= 36 ? `${Math.round((p.oop_months ?? 0) / 12)} years` : `${p.oop_months ?? 0} months`} ago — sealed only gets rarer.`
    : ''
  if (GHOST_SETS.has(p.set_id)) {
    return `Unlimited WotC-era print run — every pack can still ghost a 1st Edition.${oop}`
  }
  if (chase) {
    return `Chase is ${chase.name} at ${fmtUsd(chase.value)}; a typical rip returns ${ratioLabel(typical)} of the pack.${oop}`
  }
  return `${p.packs} pack${p.packs > 1 ? 's' : ''} × ${p.cards_per_pack} cards — a typical rip returns ${fmtUsd(d.est.p50)} on ${fmtUsd(priceOf(p, d) ?? 0)}.${oop}`
}

/** A mini pack's foil slot, as the server measures it. */
type SequinOdds = NonNullable<ProductDetail['mini']>

/** The shelf tag for that slot: "SEQUIN 1 IN 8", or "SEQUIN IN EVERY PACK". */
function sequinBadge(m: SequinOdds): string {
  if (m.guaranteed.length > 0) return 'SEQUIN IN EVERY PACK'
  if (m.draws === 1 && m.cards.length === m.pool) return `SEQUIN 1 IN ${m.pool}`
  if (m.pool > 0) return `SEQUIN ${m.cards.length} IN ${m.pool}`
  return 'SEQUIN'
}

/** The hover card: every named Sequin printing, its value and its chance. */
function sequinDetail(m: SequinOdds): string {
  const pct = (p: number) => {
    const s = (p * 100).toFixed(1).replace(/\.0$/, '')
    return `${s}%`
  }
  const head = m.guaranteed.length > 0
    ? `One Sequin card in every pack, plus ${m.draws} more draw${m.draws === 1 ? '' : 's'} from ${m.pool}.`
    : `One of the pack's ${m.cardsPerPack} cards is a Sequin Holofoil draw from ${m.pool}.`
  const rows = m.cards.map((c) => `  ${c.name} ${fmtUsd(c.value)} — ${pct(c.chance)}`)
  return `Sequin Holofoil: ${pct(m.anyChance)} of packs hold one.\n${head}\n${rows.join('\n')}`
}

type ShelfItemProps = {
  p: ProductRow
  detail?: ProductDetail
  active: boolean
  busy: string | null
  cash: number
  onSelect: (id: string) => void
  onVisible: (id: string) => void
  onBuy: (p: ProductRow, qty: number) => void
}

/** One facing. It asks for its own price/EV detail when it scrolls into view,
 *  so the first Shop paint never waits for the whole catalogue's pack models. */
function ShelfItem({ p, detail, active, busy, cash, onSelect, onVisible, onBuy }: ShelfItemProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const price = priceOf(p, detail)
  const typical = p50Of(p, detail)
  const claimed = Boolean(p.deal?.claimed)
  const quoted = isRealPrice(p.price_source)
  const flagged = Boolean(p.deal) || isNew(p) || p.oop
  const tone = typical == null ? 'mid' : typical >= 1 ? 'good' : typical >= 0.5 ? 'mid' : 'low'

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      onVisible(p.id)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onVisible(p.id)
        observer.disconnect()
      }
    }, { rootMargin: '320px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [p.id, onVisible])

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={active}
      tabIndex={0}
      className={`bay-item ${active ? 'sel' : ''}`}
      title={price == null
        ? `${p.name} — weighing the packs…`
        : `${p.name} — ${fmtUsd(price)}${p.deal ? ` (daily deal, was ${fmtUsd(marketOf(detail))})` : ''} · ${priceSourceName(p.price_source)} · typical rip returns ${ratioLabel(typical ?? 0)}`}
      onClick={() => onSelect(p.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.id) }
      }}
    >
      {p.deal ? (
        <span className={`bay-flag deal${p.deal.claimed ? ' claimed' : ''}`}>
          {p.deal.claimed ? 'CLAIMED' : `-${p.deal.discountPct}%`}
        </span>
      ) : (isNew(p) || p.oop) && (
        <span className={`bay-flag ${p.oop ? 'oop' : 'new'}`}>{p.oop ? 'OOP' : 'NEW'}</span>
      )}
      <span
        className={`bay-price-source ${quoted ? 'quote' : 'model'}${flagged ? ' below-flag' : ''}`}
        title={priceSourceTitle(p.price_source)}
      >
        {quoted ? 'QUOTE' : 'MODEL'}
      </span>
      <span className="bay-art"><ProductArt p={p} /></span>
      <span className="bay-name">{p.name.replace(/Scarlet & Violet—|Sword & Shield—/, '')}</span>
      {p.promos && p.promos.length > 0 && (
        <span
          className="bay-promo"
          title={p.promos.length === 1
            ? `Promo included: ${p.promos[0]}`
            : p.promoPolicy === 'all'
              ? `Promos included: ${p.promos.join(', ')}`
              : `One of these promos is included: ${p.promos.join(' or ')}`}
        >
          PROMO · {p.promos.length === 1
            ? p.promos[0]
            : p.promoPolicy === 'all'
              ? p.promos.join(' + ')
              : p.promos.join(' or ')}
        </span>
      )}
      {/* Shelf-edge label: price big, unit price small, and the typical return
          as the shop's own honesty sticker. Both numbers arrive with detail. */}
      <span className="bay-label">
        <b>{price == null ? '…' : fmtUsd(price)}</b>
        <em>{packsIn(p) > 1 ? `${packsIn(p)} pk` : '1 pk'}</em>
        <i className={tone}>TYP {typical == null ? '…' : ratioLabel(typical)}</i>
      </span>
      {detail?.mini && (
        <span className="bay-sequin" title={sequinDetail(detail.mini)}>
          {sequinBadge(detail.mini)}
        </span>
      )}
      {active && (
        <button
          className="bay-rip"
          disabled={busy === p.id || price == null || cash < price || claimed}
          title={claimed
            ? 'Daily deal claimed for this game day'
            : price == null
              ? 'Weighing the packs…'
              : cash < price ? 'Not enough cash' : `Buy sealed for ${fmtUsd(price)}`}
          onClick={(e) => { e.stopPropagation(); onBuy(p, 1) }}
        >
          {claimed ? 'CLAIMED' : price == null ? '…' : cash < price ? 'NO CASH' : 'RING UP'}
        </button>
      )}
    </div>
  )
}

export function PacksView() {
  const { toast, refreshState } = useStore()
  const cash = useStore((s) => s.state?.cash ?? 0)
  const [products, setProducts] = useState<ProductRow[]>([])
  // Three distinct states, because they used to be one: the shop said "shop
  // opens when sets finish syncing" while the fetch was still in flight.
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('all')
  const [era, setEra] = useState('all')
  const [source, setSource] = useState('all')
  // The shelf opens in catalogue order; EV/price sorts weigh the products on
  // demand instead of holding the first paint hostage to 500 pack models.
  const [sort, setSort] = useState('release_desc')
  const [sel, setSel] = useState<string | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const [pastDeals, setPastDeals] = useState<DailyDealHistoryDay[]>([])
  const [details, setDetails] = useState<Record<string, ProductDetail>>({})
  const [detailFailed, setDetailFailed] = useState<Record<string, boolean>>({})
  const detailsRef = useRef<Record<string, ProductDetail>>({})
  const pendingDetails = useRef(new Set<string>())
  const [detailBusy, setDetailBusy] = useState(false)
  const [sortPending, setSortPending] = useState<string | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    api.dailyDealsHistory().then(setPastDeals).catch(() => {})
  }, [])

  // The strip holds three days of three offers, so a full history is the last
  // nine. Count the same bought flags the rows show rather than keeping a second
  // ledger that could drift from the saved claims.
  const pastDealTally = useMemo(() => {
    const offers = pastDeals.flatMap((day) => day.deals)
    const claimed = offers.filter((deal) => deal.bought).length
    return { total: offers.length, claimed, missed: offers.length - claimed }
  }, [pastDeals])

  const rememberDetails = useCallback((list: ProductDetail[]) => {
    if (list.length === 0) return
    const next = { ...detailsRef.current }
    for (const detail of list) next[detail.id] = detail
    detailsRef.current = next
    setDetails(next)
    setDetailFailed((failed) => {
      let changed = false
      const cleared = { ...failed }
      for (const detail of list) {
        if (cleared[detail.id]) { delete cleared[detail.id]; changed = true }
      }
      return changed ? cleared : failed
    })
  }, [])

  /** One product, requested by the selected till or by a visible bay. */
  const requestDetail = useCallback((id: string) => {
    if (!id || detailsRef.current[id] || pendingDetails.current.has(id)) return
    pendingDetails.current.add(id)
    api.productDetail(id)
      .then((detail) => { if (detail) rememberDetails([detail]) })
      .catch(() => { setDetailFailed((failed) => failed[id] ? failed : { ...failed, [id]: true }) })
      .finally(() => { pendingDetails.current.delete(id) })
  }, [rememberDetails])

  /** An explicit EV/price sort asks for the shown products' details in chunks. */
  const loadAllDetails = useCallback(async (ids: string[]) => {
    const need = ids.filter((id) => !detailsRef.current[id])
    if (need.length === 0) return
    setDetailBusy(true)
    try {
      for (let i = 0; i < need.length; i += 40) {
        const chunk = need.slice(i, i + 40)
        for (const id of chunk) pendingDetails.current.add(id)
        try {
          rememberDetails(await api.productDetails(chunk))
        } catch {
          // Leave the missing rows for a later retry; one bad chunk must not
          // stop the rest of the shelf's sort from loading.
        } finally {
          for (const id of chunk) pendingDetails.current.delete(id)
        }
      }
    } finally {
      setDetailBusy(false)
    }
  }, [rememberDetails])

  const load = (quiet = false) => {
    if (!quiet) setStatus('loading')
    api.products()
      .then((rows) => { setProducts(rows); setStatus('ready') })
      .catch(() => { if (!quiet) setStatus('error') })
  }
  useEffect(() => { load() }, [])

  // The daily-deal board sits above the shelf, so its three prices are worth
  // fetching at once even before a bay scrolls into view.
  useEffect(() => {
    for (const p of products) if (p.deal) requestDetail(p.id)
  }, [products, requestDetail])

  const buy = async (p: ProductRow, qty: number) => {
    setBusy(p.id)
    try {
      // A purchase is always sealed. Opening is a deliberate second step in
      // Inventory → Sealed, so the shop can never rip a product on the way out.
      await api.buyProduct(p.id, qty)
      refreshState()
      if (p.deal) load(true)
      toast(`Added ${qty}× ${p.name} sealed — open it from Inventory → Sealed whenever you want.`, 'good')
    } catch (e) {
      if (p.deal) load(true)
      toast(e instanceof Error ? e.message : 'Purchase failed', 'bad')
    } finally {
      setBusy(null)
    }
  }

  const realCount = products.filter((p) => isRealPrice(p.price_source)).length

  const kinds = useMemo(
    () => [...new Set(products.map((p) => p.kind))].sort((a, b) => aisleRank(a) - aisleRank(b)),
    [products],
  )
  const eras = useMemo(() => {
    const e = new Set<string>()
    for (const p of products) {
      const y = p.release_date?.slice(0, 4)
      if (y) e.add(Number(y) <= 2002 ? 'WotC (1999–2002)' : Number(y) <= 2007 ? 'ex era (2003–07)' : Number(y) <= 2019 ? 'Modern classic' : 'Sword & Shield / SV')
    }
    return [...e]
  }, [products])
  const eraOf = (p: ProductRow): string => {
    const y = Number(p.release_date?.slice(0, 4) ?? 0)
    if (y <= 2002) return 'WotC (1999–2002)'
    if (y <= 2007) return 'ex era (2003–07)'
    if (y <= 2019) return 'Modern classic'
    return 'Sword & Shield / SV'
  }

  const shown = useMemo(() => {
    const out = products.filter((p) => {
      if (!matchesQuery(p, q, (r) => [r.name, r.set_name, r.id])) return false
      if (kind !== 'all' && p.kind !== kind) return false
      if (era !== 'all' && eraOf(p) !== era) return false
      if (source === 'real' && !isRealPrice(p.price_source)) return false
      if (source === 'est' && isRealPrice(p.price_source)) return false
      if (source === 'ghost' && !GHOST_SETS.has(p.set_id)) return false
      if (source === 'oop' && !p.oop) return false
      return true
    })
    const sorters: Record<string, (a: ProductRow, b: ProductRow) => number> = {
      p50_desc: byNum((p) => p50Of(p, details[p.id]), 'desc'),
      p50_asc: byNum((p) => p50Of(p, details[p.id]), 'asc'),
      avg_desc: byNum((p) => avgOf(p, details[p.id]), 'desc'),
      chase_desc: byNum((p) => details[p.id]?.est.topChases[0]?.value ?? null, 'desc'),
      name_asc: byStr((p) => p.name, 'asc'),
      name_desc: byStr((p) => p.name, 'desc'),
      price_asc: byNum((p) => priceOf(p, details[p.id]), 'asc'),
      price_desc: byNum((p) => priceOf(p, details[p.id]), 'desc'),
      release_desc: byStr((p) => p.release_date, 'desc'),
      release_asc: byStr((p) => p.release_date, 'asc'),
      oop_desc: byNum((p) => (p.oop ? p.oop_months ?? 0 : -1), 'desc'),
    }
    return [...out].sort(sorters[sort] ?? sorters.release_desc)
  }, [products, q, kind, era, source, sort, details])

  const changeSort = (next: string) => {
    if (sortPending) return
    if (!DETAIL_SORTS.has(next)) { setSort(next); return }
    setSortPending(next)
    loadAllDetails(shown.map((p) => p.id))
      .then(() => setSort(next))
      .catch(() => {})
      .finally(() => setSortPending(null))
  }

  // The floor is shelved by aisle; filters narrow the aisles, never reorder them
  // across the shop, so a product stays where you found it.
  const aisles = useMemo(() => {
    const map = new Map<string, ProductRow[]>()
    for (const p of shown) {
      const list = map.get(p.kind) ?? []
      list.push(p)
      map.set(p.kind, list)
    }
    return [...map.entries()]
      .sort(([a], [b]) => aisleRank(a) - aisleRank(b))
      .map(([k, items]) => ({ kind: k, label: AISLE_LABEL[k] ?? AISLE_LABEL.other, items }))
  }, [shown])

  // The picked pack follows the shop. Until a product's detail arrives its
  // price is unknown, so the fallback only prefers an affordable row once the
  // list has a known price for it.
  const selProduct = useMemo(
    () => shown.find((p) => p.id === sel)
      ?? shown.find((p) => {
        const price = priceOf(p, details[p.id])
        return price != null && price <= cash
      })
      ?? shown[0]
      ?? null,
    [shown, sel, cash, details],
  )

  useEffect(() => {
    if (selProduct) requestDetail(selProduct.id)
  }, [selProduct, requestDetail])

  const dailyDeals = useMemo(() => products.filter((p) => p.deal), [products])
  const dailyEnds = dailyDeals[0]?.deal?.endsAt
  const selDetail = selProduct ? details[selProduct.id] : undefined

  const selP50 = selProduct ? p50Of(selProduct, selDetail) ?? 0 : 0
  const selAvg = selProduct ? avgOf(selProduct, selDetail) ?? 0 : 0
  const selPrice = selProduct ? priceOf(selProduct, selDetail) : null
  const selClaimed = Boolean(selProduct?.deal?.claimed)
  const selQuoted = isRealPrice(selDetail?.price_source)
  const selChase = selDetail?.est.topChases[0] ?? null
  const packsPerChase = selChase && selPrice && selPrice > 0 ? Math.max(1, Math.round(selChase.value / selPrice)) : null
  const afford = selPrice && selPrice > 0 ? Math.floor(cash / selPrice) : 0

  return (
    <div className="shop">
      {/* The sign over the door. */}
      <div className="pack-shop-sign">
        <span className="shop-neon" aria-hidden>OPEN</span>
        <div className="shop-sign-text">
          <h1>Pack Shop</h1>
          <div className="sub">
            Sealed product, priced at the <b>typical</b> rip — the median pack, not the mean. Pick something; the till rings it up sealed.
            Everything leaves the counter sealed — open it from <b>Inventory → Sealed</b> whenever you want.
            {realCount > 0 && ` ${realCount}/${products.length} priced from real data.`}
            {products.length > 0 && (
              <span className="faint">
                {' '}TYP is that median as a share of the price: TYP 80% means the cards inside
                typically resell for about 80% of what the pack costs. QUOTE is a published market
                price; MODEL is estimated from the packs inside.
              </span>
            )}
          </div>
        </div>
        <div className="shop-cash">
          <span className="faint small">IN THE DRAWER</span>
          <b>{fmtUsd(cash)}</b>
        </div>
      </div>

      {status === 'error' ? (
        <EmptyState
          icon="⚠️"
          text="Couldn't open the shop"
          sub="The product list didn't come back from the local server — your cash and inventory are untouched."
          action={{ label: 'Try again', onClick: () => load() }}
        />
      ) : status === 'loading' ? (
        <EmptyState icon="📦" text="Unlocking the doors…" sub="Fetching every product for your synced sets." />
      ) : products.length === 0 ? (
        <EmptyState icon="📦" text="Shop opens when sets finish syncing" sub="Products appear as soon as their set's cards are in the database." />
      ) : (
        <>
          {dailyDeals.length > 0 && (
            <section className="daily-deals" aria-label="Daily deals">
              <div className="daily-deals-head">
                <div>
                  <span className="daily-deals-kicker">TODAY AT THE COUNTER</span>
                  <h2>Daily deals</h2>
                </div>
                <span className="daily-deals-clock">
                  Ends in <b>{timeLeft(dailyEnds, clock)}</b>
                </span>
              </div>
              <div className="daily-deals-grid">
                {dailyDeals.map((p) => {
                  const d = details[p.id]
                  const price = priceOf(p, d)
                  const market = marketOf(d)
                  return (
                    <button
                      type="button"
                      className={`daily-deal${p.deal!.claimed ? ' claimed' : ''}`}
                      key={p.id}
                      title={p.deal!.claimed
                        ? `${p.name} — today's deal is already claimed; back when the day rolls`
                        : price == null
                          ? `${p.name} — weighing the packs…`
                          : `${p.name} — ${fmtUsd(price)}, was ${fmtUsd(market)}`}
                      onClick={() => {
                        // The board sits above the aisle filters, so a deal hidden by
                        // one must still be reachable: clear the shelf's filters
                        // before taking the product to the till.
                        setQ('')
                        setKind('all')
                        setEra('all')
                        setSource('all')
                        setSel(p.id)
                        document.getElementById('pack-till')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                      }}
                    >
                      <span className="daily-deal-art"><ProductArt p={p} /></span>
                      <span className="daily-deal-body">
                        <b>{shortDealName(p.name)}</b>
                        <span>{p.set_name} · {packsIn(p)} pack{packsIn(p) === 1 ? '' : 's'} · {isRealPrice(p.price_source) ? 'QUOTE' : 'MODEL'}</span>
                      </span>
                      <span className="daily-deal-price">
                        {p.deal!.claimed ? (
                          <em className="daily-deal-claimed">CLAIMED TODAY</em>
                        ) : (
                          <>
                            <s>{price == null ? '…' : fmtUsd(market)}</s>
                            <strong>{price == null ? '…' : fmtUsd(price)}</strong>
                            <em>{p.deal!.discountPct}% OFF</em>
                          </>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {pastDeals.length > 0 && (
            <section className="daily-history" aria-label="Past daily deals">
              <div className="daily-history-head">
                <span className="daily-deals-kicker">EARLIER AT THE COUNTER</span>
                <span
                  className="daily-history-summary"
                  title={`Across the last ${pastDealTally.total} past offers: ${pastDealTally.claimed} claimed, ${pastDealTally.missed} missed`}
                >
                  <b>{pastDealTally.claimed}</b> of {pastDealTally.total} claimed
                  <i aria-hidden>·</i>
                  <em>{pastDealTally.missed}</em> missed
                </span>
              </div>
              <div className="daily-history-grid">
                {pastDeals.map((day) => (
                  <div className="daily-history-day" key={day.dayKey}>
                    <div className="daily-history-date">{dealDayLabel(day.dayKey)}</div>
                    <div className="daily-history-items">
                      {day.deals.map((deal) => (
                        <div
                          className={`daily-history-deal ${deal.bought ? 'bought' : 'missed'}`}
                          key={deal.productId}
                          title={`${deal.productName} (${deal.setName}) — ${fmtUsd(deal.dealPrice)} (${deal.discountPct}% off, was ${fmtUsd(deal.basePrice)}) · ${deal.bought ? 'claimed' : 'missed'}`}
                        >
                          <b>{shortDealName(deal.productName)}</b>
                          <span>{deal.discountPct}% · {fmtUsd(deal.dealPrice)}</span>
                          <em>{deal.bought ? 'CLAIMED' : 'MISSED'}</em>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="shop-tools">
            <SearchInput value={q} onChange={setQ} placeholder="Ask the clerk — packs, boxes, sets…" />
            <SortSelect
              value={sortPending ?? sort}
              onChange={changeSort}
              options={[
                { value: 'release_desc', label: 'Shelf: Newest sets' },
                { value: 'p50_desc', label: 'Shelf: Best typical rip' },
                { value: 'p50_asc', label: 'Shelf: Worst typical rip' },
                { value: 'avg_desc', label: 'Shelf: Chase-weighted EV' },
                { value: 'chase_desc', label: 'Shelf: Biggest chase' },
                { value: 'price_asc', label: 'Shelf: Cheapest' },
                { value: 'price_desc', label: 'Shelf: Most expensive' },
                { value: 'name_asc', label: 'Shelf: Name A→Z' },
                { value: 'oop_desc', label: 'Shelf: Most out-of-print' },
              ]}
            />
            <span className="result-count faint small">
              {detailBusy ? 'Weighing the shelves…' : `${shown.length} on the shelves`}
            </span>
          </div>

          {/* Aisle signage doubles as the filter — you walk to a shelf. */}
          <div className="shop-aisles" role="tablist" aria-label="Aisles">
            <Chip on={kind === 'all'} onClick={() => setKind('all')}>Whole shop</Chip>
            {kinds.map((k) => (
              <Chip key={k} on={kind === k} onClick={() => setKind(kind === k ? 'all' : k)}>
                {AISLE_LABEL[k] ?? k}
              </Chip>
            ))}
            <span className="shop-aisles-sep" aria-hidden />
            <select value={era} onChange={(e) => setEra(e.target.value)} aria-label="Era">
              <option value="all">All eras</option>
              {eras.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
            <Chip on={source === 'real'} onClick={() => setSource(source === 'real' ? 'all' : 'real')}>Real price</Chip>
            <Chip on={source === 'est'} onClick={() => setSource(source === 'est' ? 'all' : 'est')}>Estimated</Chip>
            <Chip on={source === 'ghost'} onClick={() => setSource(source === 'ghost' ? 'all' : 'ghost')}>👻 1st Ed</Chip>
            <Chip on={source === 'oop'} onClick={() => setSource(source === 'oop' ? 'all' : 'oop')}>📈 OOP</Chip>
            {(q || kind !== 'all' || era !== 'all' || source !== 'all' || sort !== 'release_desc') && (
              <Chip on={false} onClick={() => { setQ(''); setKind('all'); setEra('all'); setSource('all'); setSort('release_desc') }}>✕ Reset</Chip>
            )}
          </div>

          <div className="shop-body">
            <div className="shop-floor">
              {aisles.map((a) => (
                <section className="aisle" key={a.kind}>
                  <div className="aisle-head">
                    <span className="aisle-name">{a.label}</span>
                    <span className="aisle-count">{a.items.length} facing{a.items.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="shelf">
                    {a.items.map((p) => (
                      <ShelfItem
                        key={p.id}
                        p={p}
                        detail={details[p.id]}
                        active={selProduct?.id === p.id}
                        busy={busy}
                        cash={cash}
                        onSelect={setSel}
                        onVisible={requestDetail}
                        onBuy={buy}
                      />
                    ))}
                  </div>
                </section>
              ))}
              {aisles.length === 0 && (
                <EmptyState icon="🔍" text="Nothing on that shelf" sub="No product matches these filters — try another aisle or reset them." />
              )}
            </div>

            {/* The till. It never scrolls away, so whatever you picked is
                always the thing you can pay for. */}
            {selProduct && (
              <aside className="till" id="pack-till" aria-label="Till">
                <div className="till-head">
                  <span className="till-sign">TILL</span>
                  <span className="till-clerk" aria-hidden>🧑‍💼</span>
                </div>
                <div className="till-item">{selProduct.name}</div>
                <div className="till-meta faint small">{selProduct.set_name} · {selProduct.kind}</div>
                <div className="till-price">{selPrice == null ? '…' : fmtUsd(selPrice)}</div>
                <div className={`till-price-source ${selQuoted ? 'quote' : 'model'}`} title={priceSourceTitle(selProduct.price_source)}>
                  <span>{selDetail ? (selQuoted ? 'PUBLISHED QUOTE' : 'MODEL ESTIMATE') : 'PRICING…'}</span>
                  <em>{selDetail ? (selQuoted ? priceSourceName(selProduct.price_source) : 'from the packs inside') : 'weighing the packs'}</em>
                </div>
                {selProduct.deal && (
                  <div className={`till-deal${selProduct.deal.claimed ? ' claimed' : ''}`}>
                    <span>
                      {selProduct.deal.claimed ? 'DAILY DEAL · CLAIMED TODAY' : `DAILY DEAL · ${selProduct.deal.discountPct}% OFF`}
                    </span>
                    <s>{selProduct.deal.claimed ? 'back next game day' : selDetail ? `was ${fmtUsd(marketOf(selDetail))}` : 'was …'}</s>
                  </div>
                )}
                <div className="till-line" aria-hidden />
                <p className="till-say">“{ripLine(selProduct, selDetail)}”</p>
                {selDetail?.slots && selDetail.slots.length > 0 && (
                  <div className="till-slots" aria-label="What is in the pack">
                    <div className="till-slots-head">In the pack</div>
                    {selDetail.slots.map((s) => (
                      <div className="till-slot" key={s.slot} title={s.detail}>
                        <span className="till-slot-count">{s.count}×</span>
                        <span className="till-slot-label">{s.label}</span>
                        <span className="till-slot-note">{s.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
                {selProduct.promos && selProduct.promos.length > 0 && (
                  <div className="till-promos" aria-label="Promo included">
                    <div className="till-promos-head">
                      {selProduct.promos.length === 1 ? 'Promo included' : selProduct.promoPolicy === 'all' ? 'Promos included' : 'One of these promos'}
                    </div>
                    {selProduct.promos.map((name) => (
                      <div className="till-promo" key={name}>
                        <span className="till-promo-star" aria-hidden>★</span>
                        <span>{name}</span>
                      </div>
                    ))}
                    {selProduct.promos.length > 1 && selProduct.promoPolicy !== 'all' && (
                      <div className="till-promo-note">One is sealed in each box.</div>
                    )}
                  </div>
                )}
                {selDetail ? (
                  <>
                    <div className="ev-bar" title={`Typical rip ${fmtUsd(selDetail.est.p50 * packsIn(selProduct))} against a ${fmtUsd(selPrice ?? 0)} purchase`}>
                      <span
                        className={selP50 >= 1 ? 'good' : selP50 >= 0.5 ? '' : 'low'}
                        style={{ width: `${Math.max(3, Math.min(100, Math.round(selP50 * 100)))}%` }}
                      />
                    </div>
                    <div className="ev-caption">
                      <span>typical returns <b>{ratioLabel(selP50)}</b> of {fmtUsd(selPrice ?? 0)}</span>
                      <span className="faint">· average {ratioLabel(selAvg)} (chase-weighted)</span>
                      {selChase && packsPerChase != null && (
                        <span className="faint">· {selChase.name} {fmtUsd(selChase.value)} — {packsPerChase} of these buys it</span>
                      )}
                    </div>
                    <div className="till-nums">
                      <span><span className="faint">P50</span> {fmtUsd(selDetail.est.p50 * packsIn(selProduct))}</span>
                      <span><span className="faint">AVG</span> {fmtUsd(selDetail.est.avg * packsIn(selProduct))}</span>
                      <span><span className="faint">P90</span> {fmtUsd(selDetail.est.p90 * packsIn(selProduct))}</span>
                    </div>
                  </>
                ) : detailFailed[selProduct.id] ? (
                  <div className="faint small">
                    Couldn't weigh this product.{' '}
                    <button className="ghost small" onClick={() => requestDetail(selProduct.id)}>Retry</button>
                  </div>
                ) : (
                  <div className="faint small">Weighing the packs for this product…</div>
                )}
                <button
                  className="primary till-pay"
                  disabled={busy === selProduct.id || selPrice == null || afford < 1 || selClaimed}
                  onClick={() => buy(selProduct, 1)}
                >
                  {selClaimed ? 'Daily deal claimed today' : selPrice == null ? 'Weighing…' : afford < 1 ? 'Not enough cash' : `RING UP · ${fmtUsd(selPrice)}`}
                </button>
                <div className="till-foot">
                  <span className="faint small">
                    {selClaimed ? 'this deal returns next game day' : selPrice == null ? 'price and pack maths loading' : `you can afford ${afford} · sealed at the till`}
                  </span>
                  {!selClaimed && (
                    <OverflowMenu
                      title={`More ways to buy ${selProduct.name}`}
                      items={[
                        ...(selProduct.kind === 'booster' && !selProduct.deal ? [{
                          label: 'Buy 10 sealed packs',
                          hint: 'Ten sealed boosters — open them one at a time later',
                          onClick: () => buy(selProduct, 10),
                        }] : []),
                      ]}
                    />
                  )}
                </div>
                <button className="ghost small till-history" onClick={() => (window.location.hash = '#/pulls-history')}>
                  Pull history →
                </button>
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  )
}
