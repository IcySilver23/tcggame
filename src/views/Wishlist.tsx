import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { byNum, byStr, CardImg, DensityToggle, EmptyState, fmtUsd, matchesQuery, PriceTag, SearchInput, SortSelect, SourceBadge } from '../components'
import type { WishlistRow } from '../api'

export function WishlistView() {
  const { toast, openCard, refreshState, density } = useStore()
  const [rows, setRows] = useState<WishlistRow[]>([])
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('added_desc')

  const load = () => api.wishlist().then(setRows).catch(() => {})
  useEffect(() => { load() }, [])

  const remove = async (cardId: string) => {
    await api.wishlistToggle(cardId)
    toast('Removed from wishlist')
    load()
    refreshState()
  }

  const setAlert = async (cardId: string, current: number | null, now: number | null) => {
    const hint = current ?? now ?? undefined
    const input = window.prompt(
      `Price alert target for this card\n(fire when market drops to or below — clear to remove):`,
      hint != null ? hint.toFixed(2) : '',
    )
    if (input === null) return
    const trimmed = input.trim()
    const target = trimmed === '' ? null : Math.max(0.01, Number(trimmed) || 0)
    if (trimmed !== '' && (!target || !Number.isFinite(target))) { toast('Enter a dollar amount'); return }
    await api.setWishlistAlert(cardId, target).catch(() => {})
    toast(target ? `Alert set at $${target.toFixed(2)}` : 'Alert cleared')
    load()
  }

  const total = rows.reduce((a, r) => a + (r.price.usd ?? 0), 0)
  const alertCount = rows.filter((r) => r.target_price != null).length

  const shown = useMemo(() => {
    const out = rows.filter((r) => matchesQuery(r, q, (x) => [x.name, x.set_name, x.rarity]))
    const sorters: Record<string, (a: WishlistRow, b: WishlistRow) => number> = {
      added_desc: byStr((r) => r.added_at, 'desc'),
      added_asc: byStr((r) => r.added_at, 'asc'),
      price_desc: byNum((r) => r.price.usd, 'desc'),
      price_asc: byNum((r) => r.price.usd, 'asc'),
      name_asc: byStr((r) => r.name, 'asc'),
      set_asc: byStr((r) => r.set_name, 'asc'),
    }
    return [...out].sort(sorters[sort] ?? sorters.added_desc)
  }, [rows, q, sort])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Wishlist</h1>
          <div className="sub">Cards you're hunting — priced live from TCGplayer data.</div>
        </div>
        <div className="right">
          <div className="faint small">Total to acquire all</div>
          <div className="price" style={{ fontSize: 18 }}>{fmtUsd(total)}</div>
          {alertCount > 0 && <div className="faint small mt8">🔔 {alertCount} price alert{alertCount === 1 ? '' : 's'} armed</div>}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="★" text="Wishlist is empty" sub="Open any card and choose ADD TO WISHLIST." />
      ) : (
        <>
        <div className="filter-row">
          <SearchInput value={q} onChange={setQ} placeholder="Search your wishlist…" />
          <SortSelect
            value={sort}
            onChange={setSort}
            options={[
              { value: 'added_desc', label: 'Sort: Recently added' },
              { value: 'added_asc', label: 'Sort: Oldest wishes' },
              { value: 'price_desc', label: 'Sort: Price high→low' },
              { value: 'price_asc', label: 'Sort: Cheapest first' },
              { value: 'name_asc', label: 'Sort: Name A→Z' },
              { value: 'set_asc', label: 'Sort: By set' },
            ]}
          />
          <span className="result-count faint small">{shown.length} of {rows.length} cards · {fmtUsd(shown.reduce((a, r) => a + (r.price.usd ?? 0), 0))} shown</span>
          <div style={{ marginLeft: 'auto' }}><DensityToggle /></div>
        </div>
        {density === 'list' ? (
          <div className="card-grid density-list">
            {shown.map((r) => (
              <div key={r.card_id} className="card-cell" onClick={() => openCard(r.card_id)}>
                <CardImg src={r.image_small} alt={r.name} />
                <div className="card-meta">
                  <div className="nm">{r.name}</div>
                  <div className="st">{r.set_name}</div>
                  <div className="card-row-between">
                    <PriceTag price={r.price} />
                    <SourceBadge price={r.price} />
                  </div>
                </div>
                {r.target_price != null && <span className="badge live" title={`Alert target ${fmtUsd(r.target_price)}`}>🔔 {fmtUsd(r.target_price)}</span>}
                <button className="small ghost" title="Set price alert" onClick={(e) => { e.stopPropagation(); setAlert(r.card_id, r.target_price, r.price.usd) }}>🔔</button>
                <button className="small ghost" title="Remove" onClick={(e) => { e.stopPropagation(); remove(r.card_id) }}>✕</button>
              </div>
            ))}
          </div>
        ) : (
          <div className={`grid ${density === 'compact' ? 'cols4' : 'cols3'}`}>
            {shown.map((r) => (
              <div key={r.card_id} className="panel" style={{ margin: 0 }}>
                <div className="row">
                  <div style={{ width: density === 'compact' ? 52 : 74, cursor: 'pointer' }} onClick={() => openCard(r.card_id)}>
                    <img src={r.image_small ?? ''} alt={r.name} style={{ width: '100%', borderRadius: 8, display: 'block' }} onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
                  </div>
                  <div className="grow">
                    <b className="small" style={{ cursor: 'pointer' }} onClick={() => openCard(r.card_id)}>{r.name}</b>
                    <div className="faint small">{r.set_name}</div>
                    <div className="mt8"><PriceTag price={r.price} /></div>
                    {density !== 'compact' && <div className="mt8"><SourceBadge price={r.price} /></div>}
                    {r.target_price != null && (
                      <div className="small mt8" style={{ color: 'var(--green, #4ade80)' }} title="Fires into the activity feed when the market drops to your target">
                        🔔 Target {fmtUsd(r.target_price)}
                        {r.price.usd != null && r.price.usd <= r.target_price && ' · HIT — go buy it'}
                      </div>
                    )}
                    <button className="ghost small mt8" onClick={() => setAlert(r.card_id, r.target_price, r.price.usd)}>
                      {r.target_price != null ? 'Edit alert' : '🔔 Set price alert'}
                    </button>
                  </div>
                  <button className="small ghost" onClick={() => remove(r.card_id)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
        </>
      )}
    </div>
  )
}
