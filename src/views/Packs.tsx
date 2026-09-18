import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { byNum, byStr, Chip, DensityToggle, EmptyState, fmtUsd, matchesQuery, SearchInput, SortSelect } from '../components'
import type { ProductRow } from '../types'

// WotC sets whose unlimited packs can ghost 1st Edition pulls.
const GHOST_SETS = new Set(['base1', 'base2', 'base3', 'gym1', 'gym2', 'neo1', 'neo2', 'neo3', 'neo4', 'base5'])

export function PacksView() {
  const { toast, refreshState, density } = useStore()
  const [products, setProducts] = useState<ProductRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('all')
  const [era, setEra] = useState('all')
  const [source, setSource] = useState('all')
  const [sort, setSort] = useState('name_asc')

  const load = () => api.products().then(setProducts).catch(() => {})
  useEffect(() => { load() }, [])

  const buy = async (p: ProductRow, qty: number, openNow: boolean) => {
    setBusy(p.id)
    try {
      await api.buyProduct(p.id, qty, openNow)
      refreshState()
      if (openNow) {
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

  const kinds = useMemo(() => [...new Set(products.map((p) => p.kind))].sort(), [products])
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
    const price = (p: ProductRow) => p.market_price ?? p.msrp
    const sorters: Record<string, (a: ProductRow, b: ProductRow) => number> = {
      name_asc: byStr((p) => p.name, 'asc'),
      name_desc: byStr((p) => p.name, 'desc'),
      price_asc: byNum(price, 'asc'),
      price_desc: byNum(price, 'desc'),
      value_desc: byNum((p) => (price(p) > 0 ? p.est.avg / price(p) : 0), 'desc'),
      release_desc: byStr((p) => p.release_date, 'desc'),
      release_asc: byStr((p) => p.release_date, 'asc'),
      oop_desc: byNum((p) => (p.oop ? p.oop_months ?? 0 : -1), 'desc'),
    }
    return [...out].sort(sorters[sort] ?? sorters.name_asc)
  }, [products, q, kind, era, source, sort])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Pack Shop</h1>
          <div className="sub">
            Sealed products for every synced set. Prices are real market prices (PriceCharting) where available;
            the rest are derived from each set's actual pull value and marked estimated.
            {products.length > 0 && ` ${realCount}/${products.length} priced from real data.`}
            {products.length > 0 && realCount === 0 && ' Add a PriceCharting token in ⚙ Settings to convert the catalog to real market prices.'}
          </div>
        </div>
        <button className="ghost small" onClick={() => (window.location.hash = '#/pulls-history')}>Pull history →</button>
      </div>

      {products.length === 0 ? (
        <EmptyState icon="📦" text="Shop opens when sets finish syncing" sub="Products appear as soon as their set's cards are in the database." />
      ) : (
        <>
          <div className="filter-row">
            <SearchInput value={q} onChange={setQ} placeholder="Search packs, boxes, sets…" />
            <SortSelect
              value={sort}
              onChange={setSort}
              options={[
                { value: 'name_asc', label: 'Sort: Name A→Z' },
                { value: 'name_desc', label: 'Sort: Name Z→A' },
                { value: 'price_desc', label: 'Sort: Price high→low' },
                { value: 'price_asc', label: 'Sort: Price low→high' },
                { value: 'value_desc', label: 'Sort: Pull value ÷ price' },
                { value: 'release_desc', label: 'Sort: Newest sets' },
                { value: 'release_asc', label: 'Sort: Oldest sets' },
                { value: 'oop_desc', label: 'Sort: Most out-of-print' },
              ]}
            />
            <span className="result-count faint small">{shown.length} of {products.length} products</span>
            <div style={{ marginLeft: 'auto' }}><DensityToggle /></div>
          </div>
          <div className="filter-row">
            <div className="chip-row">
              <Chip on={kind === 'all'} onClick={() => setKind('all')}>All kinds</Chip>
              {kinds.map((k) => (
                <Chip key={k} on={kind === k} onClick={() => setKind(kind === k ? 'all' : k)}>{k}</Chip>
              ))}
            </div>
          </div>
          <div className="filter-row">
            <div className="chip-row">
              <select value={era} onChange={(e) => setEra(e.target.value)} aria-label="Era">
                <option value="all">All eras</option>
                {eras.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
              <Chip on={source === 'real'} onClick={() => setSource(source === 'real' ? 'all' : 'real')}>Real price</Chip>
              <Chip on={source === 'est'} onClick={() => setSource(source === 'est' ? 'all' : 'est')}>Estimated</Chip>
              <Chip on={source === 'ghost'} onClick={() => setSource(source === 'ghost' ? 'all' : 'ghost')}>👻 1st Ed ghosts</Chip>
              <Chip on={source === 'oop'} onClick={() => setSource(source === 'oop' ? 'all' : 'oop')}>📈 Out of print</Chip>
              {(q || kind !== 'all' || era !== 'all' || source !== 'all' || sort !== 'name_asc') && (
                <Chip on={false} onClick={() => { setQ(''); setKind('all'); setEra('all'); setSource('all'); setSort('name_asc') }}>✕ Reset</Chip>
              )}
            </div>
          </div>
          <div className={`grid ${density === 'compact' ? 'cols3' : 'cols2'}`}>
          {shown.map((p) => (
            <div key={p.id} className="panel" style={{ margin: 0 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <h2 style={density === 'compact' ? { fontSize: 14 } : undefined}>
                    {p.name}
                    {GHOST_SETS.has(p.set_id) && <span className="shop-vintage-badge" title="WotC-era print run: unlimited packs can still contain 1st Edition stamped cards">👻 1st Ed ghosts</span>}
                  </h2>
                  <div className="small muted">{p.set_name} · {p.packs} pack{p.packs > 1 ? 's' : ''} · {p.cards_per_pack} cards/pack</div>
                </div>
                <div className="right">
                  <div className="faint small">MARKET</div>
                  <div style={{ fontSize: 20, fontWeight: 750 }}>{fmtUsd(p.market_price ?? p.msrp)}</div>
                  <span className={p.price_source === 'pricecharting' ? 'badge good' : 'badge est'}>
                    {p.price_source === 'pricecharting' ? 'PriceCharting' : 'est.'}
                  </span>
                  {p.oop && (
                    <span className="badge oop" title={`Print run ended ~${p.oop_months ?? 0} months ago — sealed only gets rarer`}>
                      📈 {(p.oop_months ?? 0) >= 36 ? `${Math.round((p.oop_months ?? 0) / 12)}y OOP` : `${p.oop_months ?? 0}mo OOP`}
                    </span>
                  )}
                </div>
              </div>

              <div className="row mt14" style={{ gap: density === 'compact' ? 12 : 18, flexWrap: 'wrap' }}>
                <div>
                  <div className="faint small">EST. AVG PULL VALUE</div>
                  <div className="price" style={{ fontSize: density === 'compact' ? 14 : 16 }}>{fmtUsd(p.est.avg)} <span className="badge est">est.</span></div>
                </div>
                <div>
                  <div className="faint small">TYPICAL PACK (P50)</div>
                  <div className="price">{fmtUsd(p.est.p50)}</div>
                </div>
                <div>
                  <div className="faint small">LUCKY PACK (P90)</div>
                  <div className="price" style={{ color: 'var(--green)' }}>{fmtUsd(p.est.p90)}</div>
                </div>
              </div>

              {density !== 'compact' && p.est.topChases.length > 0 && (
                <div className="mt14">
                  <div className="faint small" style={{ marginBottom: 6 }}>TOP CHASE CARDS</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {p.est.topChases.map((chase) => (
                      <div key={chase.id} className="row small" style={{ justifyContent: 'space-between' }}>
                        <span>{chase.name} <span className="faint">· {chase.rarity}</span></span>
                        <span className="price">{fmtUsd(chase.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="row mt14">
                <button className="primary" disabled={busy === p.id} onClick={() => buy(p, 1, true)}>
                  BUY 1 & OPEN · {fmtUsd(p.market_price ?? p.msrp)}
                </button>
                {p.packs > 1 && (
                  <button disabled={busy === p.id} onClick={() => buy(p, 1, false)}>BUY & KEEP SEALED</button>
                )}
                <span className="faint small">or</span>
                <button className="ghost small" disabled={busy === p.id} onClick={() => buy(p, p.kind === 'booster' ? 10 : 1, true)}>
                  {p.kind === 'booster' ? 'BUY 10-PACK LOT' : 'BUY & OPEN ALL'}
                </button>
              </div>
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  )
}
