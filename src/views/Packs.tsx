import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useStore, setOpeningHandoff } from '../store'
import { byNum, byStr, Chip, EmptyState, fmtUsd, matchesQuery, OverflowMenu, SearchInput, SortSelect } from '../components'
import type { ProductRow } from '../types'

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

const priceOf = (p: ProductRow) => p.market_price ?? p.msrp
/** Packs inside one purchase — a display is not priced like a booster. */
const packsIn = (p: ProductRow) => Math.max(1, p.packs ?? 1)

/** Typical return: median pack value × packs, against the product's price. */
const p50Of = (p: ProductRow) => {
  const price = priceOf(p)
  return price > 0 ? (p.est.p50 * packsIn(p)) / price : 0
}
/** Chase-weighted return — the long-run mean, dominated by the top hits. */
const avgOf = (p: ProductRow) => {
  const price = priceOf(p)
  return price > 0 ? (p.est.avg * packsIn(p)) / price : 0
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
 *  Products TCGplayer never listed fall back to their set's symbol. */
function ProductArt({ p }: { p: ProductRow }) {
  const [broken, setBroken] = useState(false)
  if (p.image_url && !broken) {
    return <img src={p.image_url} alt="" loading="lazy" onError={() => setBroken(true)} />
  }
  return (
    <span className="bay-art-ph" title={p.set_name}>
      {p.set_symbol ? <img src={p.set_symbol} alt="" loading="lazy" /> : <span aria-hidden>📦</span>}
    </span>
  )
}

/** One honest sentence about the rip, in this product's own numbers. */
function ripLine(p: ProductRow): string {
  const chase = p.est.topChases[0]
  const typical = p50Of(p)
  const oop = p.oop
    ? ` The print run ended ${(p.oop_months ?? 0) >= 36 ? `${Math.round((p.oop_months ?? 0) / 12)} years` : `${p.oop_months ?? 0} months`} ago — sealed only gets rarer.`
    : ''
  if (GHOST_SETS.has(p.set_id)) {
    return `Unlimited WotC-era print run — every pack can still ghost a 1st Edition.${oop}`
  }
  if (chase) {
    return `Chase is ${chase.name} at ${fmtUsd(chase.value)}; a typical rip returns ${ratioLabel(typical)} of the pack.${oop}`
  }
  return `${p.packs} pack${p.packs > 1 ? 's' : ''} × ${p.cards_per_pack} cards — a typical rip returns ${fmtUsd(p.est.p50)} on ${fmtUsd(priceOf(p))}.${oop}`
}

/** A mini pack's foil slot, as the server measures it. */
type SequinOdds = NonNullable<ProductRow['mini']>

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
  const [sort, setSort] = useState('p50_desc')
  const [sel, setSel] = useState<string | null>(null)

  const load = () => {
    setStatus('loading')
    api.products()
      .then((rows) => { setProducts(rows); setStatus('ready') })
      .catch(() => setStatus('error'))
  }
  useEffect(() => { load() }, [])

  const buy = async (p: ProductRow, qty: number, openNow: boolean) => {
    setBusy(p.id)
    try {
      // Buy the stock only — the rip belongs to the ceremony. Asking the
      // server to open it here (openNow) rips every pack server-side and
      // leaves the ceremony an empty shelf: "No sealed product in inventory".
      await api.buyProduct(p.id, qty, false)
      refreshState()
      if (openNow) {
        // Opening is a ceremony, not a bulk rip: hand the first pack and the
        // rest of the box over, and the ceremony asks before every wrapper.
        const first = await api.openBox(p.id)
        setOpeningHandoff({ session: first as unknown as import('../types').OpenSession, productId: p.id })
        window.location.hash = '#/opening'
      } else {
        toast(`Added ${qty}× ${p.name} to your sealed inventory — open anytime from Inventory`, 'good')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Purchase failed', 'bad')
    } finally {
      setBusy(null)
    }
  }

  const realCount = products.filter((p) => p.price_source === 'pricecharting').length

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
      if (source === 'real' && p.price_source !== 'pricecharting') return false
      if (source === 'est' && p.price_source === 'pricecharting') return false
      if (source === 'ghost' && !GHOST_SETS.has(p.set_id)) return false
      if (source === 'oop' && !p.oop) return false
      return true
    })
    const sorters: Record<string, (a: ProductRow, b: ProductRow) => number> = {
      p50_desc: byNum((p) => p50Of(p) || null, 'desc'),
      p50_asc: byNum((p) => p50Of(p) || null, 'asc'),
      avg_desc: byNum((p) => avgOf(p) || null, 'desc'),
      chase_desc: byNum((p) => p.est.topChases[0]?.value ?? null, 'desc'),
      name_asc: byStr((p) => p.name, 'asc'),
      name_desc: byStr((p) => p.name, 'desc'),
      price_asc: byNum(priceOf, 'asc'),
      price_desc: byNum(priceOf, 'desc'),
      release_desc: byStr((p) => p.release_date, 'desc'),
      release_asc: byStr((p) => p.release_date, 'asc'),
      oop_desc: byNum((p) => (p.oop ? p.oop_months ?? 0 : -1), 'desc'),
    }
    return [...out].sort(sorters[sort] ?? sorters.p50_desc)
  }, [products, q, kind, era, source, sort])

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

  // The picked pack follows the shop, and the fallback is the best-ranked rip
  // you can actually pay for — leaning on whatever tops the sort put a $1,025
  // display at the till saying "Not enough cash", which reads as broken.
  const selProduct = useMemo(
    () => shown.find((p) => p.id === sel)
      ?? shown.find((p) => priceOf(p) <= cash)
      ?? shown[0]
      ?? null,
    [shown, sel, cash],
  )

  const selP50 = selProduct ? p50Of(selProduct) : 0
  const selAvg = selProduct ? avgOf(selProduct) : 0
  const selPrice = selProduct ? priceOf(selProduct) : 0
  const selChase = selProduct?.est.topChases[0] ?? null
  const packsPerChase = selChase && selPrice > 0 ? Math.max(1, Math.round(selChase.value / selPrice)) : null
  const afford = selPrice > 0 ? Math.floor(cash / selPrice) : 0

  return (
    <div className="shop">
      {/* The sign over the door. */}
      <div className="shop-sign">
        <span className="shop-neon" aria-hidden>OPEN</span>
        <div className="shop-sign-text">
          <h1>Pack Shop</h1>
          <div className="sub">
            Sealed product on the shelf, priced against what it actually returns. The sticker on each item is the{' '}
            <b>typical</b> rip — the median pack, not the mean, because one chase card flatters an average you will never
            see. Pick something and the till on the right rings it up.
            {realCount > 0 && ` ${realCount}/${products.length} priced from real data.`}
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
          action={{ label: 'Try again', onClick: load }}
        />
      ) : status === 'loading' ? (
        <EmptyState icon="📦" text="Unlocking the doors…" sub="Fetching every product for your synced sets." />
      ) : products.length === 0 ? (
        <EmptyState icon="📦" text="Shop opens when sets finish syncing" sub="Products appear as soon as their set's cards are in the database." />
      ) : (
        <>
          <div className="shop-tools">
            <SearchInput value={q} onChange={setQ} placeholder="Ask the clerk — packs, boxes, sets…" />
            <SortSelect
              value={sort}
              onChange={setSort}
              options={[
                { value: 'p50_desc', label: 'Shelf: Best typical rip' },
                { value: 'p50_asc', label: 'Shelf: Worst typical rip' },
                { value: 'avg_desc', label: 'Shelf: Chase-weighted EV' },
                { value: 'chase_desc', label: 'Shelf: Biggest chase' },
                { value: 'price_asc', label: 'Shelf: Cheapest' },
                { value: 'price_desc', label: 'Shelf: Most expensive' },
                { value: 'name_asc', label: 'Shelf: Name A→Z' },
                { value: 'release_desc', label: 'Shelf: Newest sets' },
                { value: 'oop_desc', label: 'Shelf: Most out-of-print' },
              ]}
            />
            <span className="result-count faint small">{shown.length} on the shelves</span>
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
            {(q || kind !== 'all' || era !== 'all' || source !== 'all' || sort !== 'p50_desc') && (
              <Chip on={false} onClick={() => { setQ(''); setKind('all'); setEra('all'); setSource('all'); setSort('p50_desc') }}>✕ Reset</Chip>
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
                    {a.items.map((p) => {
                      const active = selProduct?.id === p.id
                      const typical = p50Of(p)
                      const price = priceOf(p)
                      const tone = typical >= 1 ? 'good' : typical >= 0.5 ? 'mid' : 'low'
                      return (
                        <div
                          key={p.id}
                          role="option"
                          aria-selected={active}
                          tabIndex={0}
                          className={`bay-item ${active ? 'sel' : ''}`}
                          title={`${p.name} — ${fmtUsd(price)} · typical rip returns ${ratioLabel(typical)}`}
                          onClick={() => setSel(p.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(p.id) }
                          }}
                        >
                          {(isNew(p) || p.oop) && (
                            <span className={`bay-flag ${p.oop ? 'oop' : 'new'}`}>{p.oop ? 'OOP' : 'NEW'}</span>
                          )}
                          <span className="bay-art"><ProductArt p={p} /></span>
                          <span className="bay-name">{p.name.replace(/Scarlet & Violet—|Sword & Shield—/, '')}</span>
                          {/* Shelf-edge label: price big, unit price small, and the
                              typical return as the shop's own honesty sticker. */}
                          <span className="bay-label">
                            <b>{fmtUsd(price)}</b>
                            <em>{packsIn(p) > 1 ? `${packsIn(p)} pk` : '1 pk'}</em>
                            <i className={tone}>TYP {ratioLabel(typical)}</i>
                          </span>
                          {p.mini && (
                            <span className="bay-sequin" title={sequinDetail(p.mini)}>
                              {sequinBadge(p.mini)}
                            </span>
                          )}
                          {active && (
                            <button
                              className="bay-rip"
                              disabled={busy === p.id || cash < price}
                              title={cash < price ? 'Not enough cash' : `Buy and open for ${fmtUsd(price)}`}
                              onClick={(e) => { e.stopPropagation(); buy(p, 1, true) }}
                            >
                              {cash < price ? 'NO CASH' : 'RIP'}
                            </button>
                          )}
                        </div>
                      )
                    })}
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
              <aside className="till" aria-label="Till">
                <div className="till-head">
                  <span className="till-sign">TILL</span>
                  <span className="till-clerk" aria-hidden>🧑‍💼</span>
                </div>
                <div className="till-item">{selProduct.name}</div>
                <div className="till-meta faint small">{selProduct.set_name} · {selProduct.kind}</div>
                <div className="till-price">{fmtUsd(selPrice)}</div>
                <div className="till-line" aria-hidden />
                <p className="till-say">“{ripLine(selProduct)}”</p>
                {selProduct.slots && selProduct.slots.length > 0 && (
                  <div className="till-slots" aria-label="What is in the pack">
                    <div className="till-slots-head">In the pack</div>
                    {selProduct.slots.map((s) => (
                      <div className="till-slot" key={s.slot} title={s.detail}>
                        <span className="till-slot-count">{s.count}×</span>
                        <span className="till-slot-label">{s.label}</span>
                        <span className="till-slot-note">{s.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="ev-bar" title={`Typical rip ${fmtUsd(selProduct.est.p50 * packsIn(selProduct))} against a ${fmtUsd(selPrice)} purchase`}>
                  <span
                    className={selP50 >= 1 ? 'good' : selP50 >= 0.5 ? '' : 'low'}
                    style={{ width: `${Math.max(3, Math.min(100, Math.round(selP50 * 100)))}%` }}
                  />
                </div>
                <div className="ev-caption">
                  <span>typical returns <b>{ratioLabel(selP50)}</b> of {fmtUsd(selPrice)}</span>
                  <span className="faint">· average {ratioLabel(selAvg)} (chase-weighted)</span>
                  {selChase && packsPerChase != null && (
                    <span className="faint">· {selChase.name} {fmtUsd(selChase.value)} — {packsPerChase} of these buys it</span>
                  )}
                </div>
                <div className="till-nums">
                  <span><span className="faint">P50</span> {fmtUsd(selProduct.est.p50 * packsIn(selProduct))}</span>
                  <span><span className="faint">AVG</span> {fmtUsd(selProduct.est.avg * packsIn(selProduct))}</span>
                  <span><span className="faint">P90</span> {fmtUsd(selProduct.est.p90 * packsIn(selProduct))}</span>
                </div>
                <button
                  className="primary till-pay"
                  disabled={busy === selProduct.id || afford < 1}
                  onClick={() => buy(selProduct, 1, true)}
                >
                  {afford < 1 ? 'Not enough cash' : `RING UP & RIP · ${fmtUsd(selPrice)}`}
                </button>
                <div className="till-foot">
                  <span className="faint small">you can afford {afford}</span>
                  <OverflowMenu
                    title={`More ways to buy ${selProduct.name}`}
                    items={[
                      ...(selProduct.packs > 1 ? [{
                        label: 'Bag it, keep it sealed',
                        hint: `One sealed ${selProduct.packs}-pack product straight to storage`,
                        onClick: () => buy(selProduct, 1, false),
                      }] : []),
                      {
                        label: selProduct.kind === 'booster' ? 'Rip the 10-pack lot' : `Rip all ${selProduct.packs} packs`,
                        hint: selProduct.kind === 'booster' ? 'Ten packs, ripped in one go' : `All ${selProduct.packs} packs from this box`,
                        onClick: () => buy(selProduct, selProduct.kind === 'booster' ? 10 : 1, true),
                      },
                    ]}
                  />
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
