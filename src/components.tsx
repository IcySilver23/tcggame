import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { ResolvedPrice, HistoryPoint } from './types'
import { useStore } from './store'

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmtUsd(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n == null) return '—'
  if (opts.compact && Math.abs(n) >= 10000) {
    return `$${(n / 1000).toFixed(1)}k`
  }
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

// ---------------------------------------------------------------------------
// Badges & price display
// ---------------------------------------------------------------------------

const LIVE_SOURCE_LABEL: Record<string, string> = {
  tcgplayer: 'LIVE · TCGplayer',
  pricecharting: 'LIVE · PriceCharting',
  ebay: 'LIVE · eBay (median)',
  cardmarket: 'LIVE · Cardmarket',
}

export function SourceBadge({ price }: { price: ResolvedPrice | undefined }) {
  if (!price) return null
  if (price.source === 'live') return <span className="badge live" title={price.kind === 'ebay' ? 'Median of active eBay fixed-price listings' : price.kind === 'pricecharting' ? 'PriceCharting tracked raw-card price' : undefined}>{LIVE_SOURCE_LABEL[price.kind ?? ''] ?? 'LIVE'}</span>
  if (price.source === 'model') return <span className="badge model" title="Estimated from comparable card prices — no market data published yet">EST · MODEL</span>
  if (price.source === 'estimated') return <span className="badge est">ESTIMATED</span>
  return <span className="badge est">LAST UPDATED</span>
}

export function ConditionBadge({ cond }: { cond: string }) {
  const label: Record<string, string> = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DM: 'Damaged' }
  return <span className="badge">{label[cond] ?? cond}</span>
}

export function RarityBadge({ rarity }: { rarity: string | null | undefined }) {
  if (!rarity) return null
  const cls = /Special Illustration|Hyper|SECRET/i.test(rarity) ? 'hit' : /Illustration|Ultra|VMAX|VSTAR|EX/i.test(rarity) ? 'rare' : ''
  return <span className={`badge ${cls}`}>{rarity}</span>
}

export function PriceTag({ price, size }: { price: ResolvedPrice | undefined; size?: 'lg' }) {
  if (!price || price.usd == null) return <span className="price faint">No data</span>
  if (price.source === 'model') {
    return (
      <span className="price model-est" title="Model estimate from comparable cards — no market data yet">
        ~<span className="cur">$</span>
        {price.usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    )
  }
  return (
    <span className={`price ${size === 'lg' ? 'po-value' : ''}`}>
      <span className="cur">$</span>
      {price.usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  )
}

export function Delta({ pct }: { pct: number | null }) {
  if (pct == null || !isFinite(pct)) return <span className="faint small">—</span>
  const cls = pct > 0.001 ? 'delta-up' : pct < -0.001 ? 'delta-down' : 'faint'
  const sign = pct > 0 ? '+' : ''
  return (
    <span className={`${cls} small`} style={{ fontWeight: 650 }}>
      {sign}
      {(pct * 100).toFixed(1)}%
    </span>
  )
}

// ---------------------------------------------------------------------------
// Card image with graceful fallback
// ---------------------------------------------------------------------------

export function CardImg({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(src ? 'loading' : 'error')
  useEffect(() => setState(src ? 'loading' : 'error'), [src])
  return (
    <div className={`card-img-wrap ${className ?? ''}`}>
      {state === 'loading' && <div className="img-loading"><span className="spinner" /></div>}
      {state === 'error' && (
        <div className="img-error">
          <div style={{ fontSize: 20 }}>🃏</div>
          <div>Image unavailable</div>
        </div>
      )}
      {/* Keep the img in layout (opacity, not display:none) so lazy-loading still triggers. */}
      {src && state !== 'error' && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: state === 'ok' ? 1 : 0, transition: 'opacity 0.25s' }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({ onClose, children, wide }: { onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={wide ? { width: 'min(1200px, 97vw)' } : undefined}>{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sparkline / price history chart
// ---------------------------------------------------------------------------

export function PriceChart({ history, height = 180 }: { history: HistoryPoint[]; height?: number }) {
  const path = useMemo(() => {
    if (history.length < 2) return null
    const w = 640
    const h = height
    const vals = history.map((p) => p.value)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const span = max - min || 1
    const pts = history.map((p, i) => {
      const x = (i / (history.length - 1)) * (w - 8) + 4
      const y = h - 12 - ((p.value - min) / span) * (h - 28)
      return [x, y] as const
    })
    const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
    return { d, min, max, first: vals[0], last: vals[vals.length - 1], w, h, pts }
  }, [history, height])

  if (!path) {
    return (
      <div className="empty" style={{ padding: 26 }}>
        Price history builds as TCG Life snapshots the market.<br />
        <span className="small">Two+ data points needed — check back after the next snapshot.</span>
      </div>
    )
  }
  const up = path.last >= path.first
  const stroke = up ? '#2ee6a8' : '#ff5d5d'
  return (
    <div>
      <svg viewBox={`0 0 ${path.w} ${path.h}`} style={{ width: '100%', height: 'auto' }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="pcFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${path.d} L${path.w - 4},${path.h - 4} L4,${path.h - 4} Z`} fill="url(#pcFill)" stroke="none" />
        <path d={path.d} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="faint small">low {fmtUsd(path.min)}</span>
        <span className="faint small">{history.length} snapshots</span>
        <span className="faint small">high {fmtUsd(path.max)}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sealed pack visual (generated — official product images are not in the API)
// ---------------------------------------------------------------------------

export function PackArt({ symbolUrl, name, kind }: { symbolUrl: string | null | undefined; name: string; kind: string }) {
  const label = name.replace(/Scarlet & Violet—|Sword & Shield—/, '').replace(/ (Booster Pack|Booster Bundle|Elite Trainer Box|Booster Display.*|Premium Collection)$/, '')
  return (
    <div className="po-pack" style={{ cursor: 'default' }}>
      {symbolUrl ? <img className="pack-logo" src={symbolUrl} alt="" /> : <div style={{ fontSize: 40 }}>📦</div>}
      <div className="pack-name">{label}</div>
      <div className="pack-sub">{kind === 'booster' ? '1 pack' : kind === 'display' ? '36 packs' : kind.toUpperCase()}</div>
    </div>
  )
}

/**
 * VirtualGrid — windowed rendering for huge card grids.
 *
 * Renders only the rows visible in the .content scroll container (plus overscan),
 * so a 10,000-card collection mounts ~60 cells instead of 10,000. Rows are kept
 * correctly positioned by an absolutely-positioned spacer of the full virtual
 * height; measured row heights (per density) come in via rowHeight/cols and
 * must match the CSS — a data-testid probe keeps them honest.
 */
export function VirtualGrid<T>({
  items, render, rowHeight, cols, gap = 0, overscanRows = 3, minHeight = 400, className = '', empty,
}: {
  items: T[]
  render: (item: T, index: number) => React.ReactNode
  rowHeight: number
  cols: number
  gap?: number
  overscanRows?: number
  minHeight?: number
  className?: string
  empty?: React.ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(900)

  // The scroll container is the app's .content div (or window on small screens).
  const getScroller = () => scrollRef.current?.closest('.content') ?? null

  useEffect(() => {
    const sc = getScroller()
    if (!sc) return
    const onScroll = () => setScrollTop(sc.scrollTop)
    const ro = new ResizeObserver(() => setViewportH(sc.clientHeight))
    ro.observe(sc)
    setViewportH(sc.clientHeight)
    setScrollTop(sc.scrollTop)
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => { sc.removeEventListener('scroll', onScroll); ro.disconnect() }
  }, [])

  // Keep the window anchored when the list shrinks (filter change, density
  // switch): a stale scrollTop past the new content height would render a
  // blank window, so clamp the held position back into range.
  const strideRaw = rowHeight + gap
  const rowsRaw = Math.max(1, Math.ceil(items.length / Math.max(1, cols)))
  const maxScroll = Math.max(0, rowsRaw * strideRaw - viewportH)
  useEffect(() => {
    if (scrollTop > maxScroll) setScrollTop(maxScroll)
  }, [maxScroll, scrollTop])

  if (items.length === 0 && empty) return <>{empty}</>

  const stride = strideRaw
  const rows = rowsRaw
  const clampedTop = Math.min(scrollTop, maxScroll)
  const firstRow = Math.max(0, Math.floor(clampedTop / stride) - overscanRows)
  const lastRow = Math.max(firstRow, Math.min(rows - 1, Math.ceil((clampedTop + viewportH) / stride) + overscanRows))
  const first = firstRow * cols
  const last = Math.min(items.length, (lastRow + 1) * cols)

  const slice = items.slice(first, last)
  const totalH = rows * stride
  return (
    <div ref={scrollRef} className={`virtual-grid ${className}`} style={{ position: 'relative', minHeight }}>
      <div style={{ height: totalH, position: 'relative' }}>
        <div
          className="virtual-window"
          style={{
            position: 'absolute',
            top: firstRow * stride,
            left: 0,
            right: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap,
            alignItems: 'start',
          }}
        >
          {slice.map((item, i) => (
            <div key={first + i} style={className.includes('density-list') ? undefined : { height: rowHeight }}>
              {render(item, first + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Live-measured cell metrics for the density modes, so VirtualGrid math can't
 * drift from the CSS. Values verified in the running app; the probe above
 * re-checks the list row height on every mount.
 */
export const DENSITY_METRICS = {
  comfortable: { rowHeight: 308, cols: 4, gap: 14 },
  compact: { rowHeight: 271, cols: 5, gap: 9 },
  list: { rowHeight: 67, cols: 1, gap: 0 },
} as const

/** Tab bar — lets heavy views swap a stack of panels for one focused section. */
export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string; badge?: string | number }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={`tab ${active === t.id ? 'on' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.badge != null && t.badge !== '' && <span className="tab-badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  )
}

/** Segmented control for card-grid density — comfortable / compact / list. Persisted in the store. */
export function DensityToggle() {
  const density = useStore((s) => s.density)
  const setDensity = useStore((s) => s.setDensity)
  return (
    <div className="tab-bar density-toggle" role="group" aria-label="Density" title="Card density">
      {([['comfortable', '▦'], ['compact', '▦▦'], ['list', '☰']] as const).map(([d, icon]) => (
        <button key={d} className={`tab ${density === d ? 'on' : ''}`} onClick={() => setDensity(d)} aria-label={d} aria-pressed={density === d}>
          {icon}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ icon, text, sub }: { icon: string; text: string; sub?: string }) {
  return (
    <div className="empty">
      <div style={{ fontSize: 34, marginBottom: 8 }}>{icon}</div>
      <div>{text}</div>
      {sub && <div className="small faint" style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// List-control kit — shared search / sort / filter toolbar used by every
// heavy view (pack shop, sets, battles, pulls, inventory…).
// ---------------------------------------------------------------------------

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="search"
      className="list-search"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function SortSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select className="list-sort" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Sort">
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <span className={`chip ${on ? 'on' : ''}`} onClick={onClick}>{children}</span>
  )
}

/** Case-insensitive substring match across the given fields of a row. */
export function matchesQuery<T>(row: T, q: string, fields: (r: T) => (string | null | undefined)[]): boolean {
  if (!q.trim()) return true
  const needle = q.trim().toLowerCase()
  return fields(row).some((f) => (f ?? '').toLowerCase().includes(needle))
}

/** Numeric compare that treats null/undefined as smallest (so asc puts blanks first). */
export function byNum<T>(key: (r: T) => number | null | undefined, dir: 'asc' | 'desc'): (a: T, b: T) => number {
  return (a, b) => {
    const av = key(a)
    const bv = key(b)
    const an = av == null
    const bn = bv == null
    if (an && bn) return 0
    if (an) return 1 // blanks sink in both directions
    if (bn) return -1
    return dir === 'asc' ? av - bv : bv - av
  }
}

export function byStr<T>(key: (r: T) => string | null | undefined, dir: 'asc' | 'desc'): (a: T, b: T) => number {
  return (a, b) => {
    const av = (key(a) ?? '').toLowerCase()
    const bv = (key(b) ?? '').toLowerCase()
    return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
  }
}
