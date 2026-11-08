import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { CardImg, BrowseToggle, CapacityStrip, DensityToggle, EmptyState, fmtUsd, PriceTag, RarityBadge, SetSection, VirtualGrid } from '../components'
import type { CardRow, SetRow } from '../types'

// The server caps /api/cards/search at 250 rows per request; that's also the
// page this view streams in.
const PAGE = 250

export function CollectionView() {
  const { state, openCard, density, browse } = useStore()
  const [sets, setSets] = useState<SetRow[]>([])
  const [cards, setCards] = useState<CardRow[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [setId, setSetId] = useState('')
  const [rarity, setRarity] = useState('')
  const [type, setType] = useState('')
  const [sort, setSort] = useState('price_desc')
  const [ownedOnly, setOwnedOnly] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [facets, setFacets] = useState<{ rarities: { rarity: string; n: number }[]; types: string[] }>({ rarities: [], types: [] })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.sets().then(setSets).catch(() => {})
    api.facets().then(setFacets).catch(() => {})
  }, [])

  // Page one — refetched (and the list replaced) whenever a filter moves.
  // 250 is the server's per-request ceiling; further pages stream in below.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // 'owned' is filtered server-side so owned cards surface regardless of price rank
    const t = setTimeout(() => {
      api
        .cardsSearch({ q, setId, rarity, type, sort, limit: PAGE, offset: 0, owned: ownedOnly ? 1 : undefined })
        .then((r) => { if (!cancelled) { setCards(r.cards); setTotal(r.total) } })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 220)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, setId, rarity, type, sort, ownedOnly])

  // Next page — requested by the sentinel at the bottom of the grid, so the
  // collection fills itself the way Inventory does instead of making the
  // player click "Load more" every 60 cards.
  const loadMore = useCallback(() => {
    if (loading || loadingMore) return
    setLoadingMore(true)
    api
      .cardsSearch({ q, setId, rarity, type, sort, limit: PAGE, offset: cards.length, owned: ownedOnly ? 1 : undefined })
      .then((r) => {
        setTotal(r.total)
        // Append only if the list is still the one we read `offset` from — a
        // filter change may have replaced it mid-flight.
        setCards((prev) => (prev.length === cards.length ? [...prev, ...r.cards] : prev))
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false))
  }, [q, setId, rarity, type, sort, ownedOnly, loading, loadingMore, cards.length])

  const sentinel = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || cards.length >= total) return
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMore() },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore, cards.length, total])

  const shown = cards

  // Grouped browse: sections in the same order the flat view sorts, so
  // switching modes never scrambles the cards — it only re-organizes them.
  const groups = useMemo(() => {
    const m = new Map<string, CardRow[]>()
    for (const c of shown) {
      const k = c.set_name || 'Unknown set'
      const arr = m.get(k)
      if (arr) arr.push(c)
      else m.set(k, [c])
    }
    return [...m.entries()]
  }, [shown])

  return (
    <div>
      <div className="page-head desk">
        <div className="ph-id">
          <span className="ph-mark" aria-hidden>🗂</span>
          <div>
            <h1>Collection</h1>
            <div className="sub">Every card you own — priced from real TCGplayer market data.</div>
          </div>
        </div>
        <div className="right">
          <div className="faint small">Cards shown</div>
          <div className="price" style={{ fontSize: 18 }}>{shown.length.toLocaleString()}{total > shown.length ? ` of ${total.toLocaleString()}` : ''}</div>
        </div>
      </div>

      <CapacityStrip />

      <div className="filter-row">
        <input type="search" placeholder="Search name, number, set…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={setId} onChange={(e) => setSetId(e.target.value)}>
          <option value="">All sets</option>
          {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
          <option value="">All rarities</option>
          {facets.rarities.map((r) => <option key={r.rarity} value={r.rarity}>{r.rarity} ({r.n})</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {facets.types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="price_desc">Price ↓</option>
          <option value="price_asc">Price ↑</option>
          <option value="name_asc">Name A–Z</option>
          <option value="set_desc">Newest set</option>
          <option value="number_asc">Set order</option>
        </select>
        <div className="chip-row">
          <span className={`chip ${ownedOnly ? 'on' : ''}`} onClick={() => setOwnedOnly(!ownedOnly)}>Owned only</span>
        </div>
        <div style={{ marginLeft: 'auto' }} className="row">
          <BrowseToggle />
          <DensityToggle />
        </div>
      </div>

      {loading && cards.length === 0 ? (
        <EmptyState icon="⏳" text="Loading cards…" />
      ) : shown.length === 0 ? (
        <EmptyState icon="🃏" text="No cards here yet" sub="Rip some packs or buy singles on the Market." />
      ) : browse === 'byset' ? (
        <div className="set-sections">
          {groups.map(([name, cardsInSet]) => {
            const ownedCount = cardsInSet.reduce((a, c) => a + (c.ownedQty ?? 0), 0)
            const value = cardsInSet.reduce((a, c) => a + (c.price?.usd ?? 0) * (c.ownedQty || 0), 0)
            return (
              <SetSection
                key={name}
                setName={name}
                stats={<>{cardsInSet.length} card{cardsInSet.length === 1 ? '' : 's'} · {ownedCount} owned · {fmtUsd(value)}</>}
              >
                <VirtualGrid
                  className={`card-grid ${density !== 'comfortable' ? `density-${density}` : ''}`}
                  items={cardsInSet}
                  density={density}
                  minHeight={200}
                  empty={null}
                  render={(c) => (
                    <div className="card-cell" onClick={() => openCard(c.id)}>
                      <CardImg src={c.image_small} alt={c.name} cardId={c.id} rarity={c.rarity} />
                      <div className="card-meta">
                        <div className="nm">{c.name}</div>
                        <div className="st">#{c.number}</div>
                        <div className="card-row-between">
                          <RarityBadge rarity={c.rarity} />
                          {(c.ownedQty ?? 0) > 1 && <span className="badge">×{c.ownedQty}</span>}
                          {(c.ownedVariants ?? []).map((v) => (
                            <span
                              key={v.variant}
                              className="badge"
                              title={`You own this as ${v.label} — a separate printing of #${c.number}, not the plain card`}
                            >
                              {v.label}{v.qty > 1 ? ` ×${v.qty}` : ''}
                            </span>
                          ))}
                        </div>
                        <div className="card-row-between">
                          <PriceTag price={c.price} />
                        </div>
                      </div>
                    </div>
                  )}
                />
              </SetSection>
            )
          })}
        </div>
      ) : (
        <VirtualGrid
          className={`card-grid ${density !== 'comfortable' ? `density-${density}` : ''}`}
          items={shown}
          density={density}
          empty={null}
          render={(c) => (
            <div className={`card-cell ${ownedOnly ? '' : 'silhouette'}`} onClick={() => openCard(c.id)}>
              <CardImg src={c.image_small} alt={c.name} cardId={c.id} rarity={c.rarity} />
              <div className="card-meta">
                <div className="nm">{c.name}</div>
                <div className="st">{c.set_name} · {c.number}</div>
                <div className="card-row-between">
                  <RarityBadge rarity={c.rarity} />
                  {(c.ownedQty ?? 0) > 1 && <span className="badge">×{c.ownedQty}</span>}
                  {(c.ownedVariants ?? []).map((v) => (
                    <span
                      key={v.variant}
                      className="badge"
                      title={`You own this as ${v.label} — a separate printing of #${c.number}, not the plain card`}
                    >
                      {v.label}{v.qty > 1 ? ` ×${v.qty}` : ''}
                    </span>
                  ))}
                </div>
                <div className="card-row-between">
                  <PriceTag price={c.price} />
                </div>
              </div>
            </div>
          )}
        />
      )}

      {/* Scroll sentinel: crossing it pulls the next 250 cards. Placed after
          whichever grid is mounted so both browse modes fill themselves. */}
      {shown.length < total && shown.length > 0 && (
        <div ref={sentinel} style={{ height: 1 }} aria-hidden="true" />
      )}
      {loadingMore && (
        <div className="faint small" style={{ textAlign: 'center', marginTop: 14 }}>Loading more cards…</div>
      )}
    </div>
  )
}
