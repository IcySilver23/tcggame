import { hashKey } from './holo'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ResolvedPrice, HistoryPoint } from './types'
import { useStore } from './store'
import { api } from './api'
import type { GradingReveal } from './api'
import { crinkle, ripChime } from './audio'
import { fmtUsd } from './format'

// Re-exported for the dozens of screens that already import it from here; the
// shell imports ./format directly so it never pulls this renderer (16.0).
export { fmtUsd }

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "Sat 3:00 PM" — a scheduled instant as a player-readable wall-clock time. */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

/** "40 min" / "5 hr" / "1.6 days" — a wait in minutes the way a player says it. */
export function fmtWait(min: number): string {
  if (!Number.isFinite(min) || min < 1) return 'moments'
  if (min < 60) return `${Math.round(min)} min`
  const h = min / 60
  if (h < 24) return `${Math.round(h)} hr`
  const d = h / 24
  return d < 10 ? `${d.toFixed(1)} days` : `${Math.round(d)} days`
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
  tcgcsv: 'LIVE · TCGplayer (mirror)',
}

export function SourceBadge({ price }: { price: ResolvedPrice | undefined }) {
  if (!price) return null
  if (price.source === 'live') return <span className="badge live" title={price.kind === 'ebay' ? 'Median of active eBay fixed-price listings' : price.kind === 'pricecharting' ? 'PriceCharting tracked raw-card price' : price.kind === 'tcgcsv' ? 'TCGplayer market price via the free tcgcsv.com daily mirror' : price.kind === 'cardmarket' ? 'Cardmarket European trend price, converted to USD' : undefined}>{LIVE_SOURCE_LABEL[price.kind ?? ''] ?? 'LIVE'}</span>
  if (price.source === 'simulated') return <span className="badge sim" title="Simulated market price — real price APIs are out of daily quota. Reverts to live data automatically when the quota resets.">SIM · MARKET</span>
  if (price.source === 'model') return <span className="badge model" title="Estimated from comparable card prices — no market data published yet">EST · MODEL</span>
  if (price.source === 'estimated') return <span className="badge est">ESTIMATED</span>
  return <span className="badge est">LAST UPDATED</span>
}

export function ConditionBadge({ cond }: { cond: string }) {
  const label: Record<string, string> = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DM: 'Damaged' }
  // `.cond` is one of the four card-fact chips (condition / protection /
  // grading / auth) — each carries its own colour so a raw row scans by shape
  // and hue, not by reading every word.
  return <span className="badge cond" title={`Condition: ${label[cond] ?? cond}`}>{label[cond] ?? cond}</span>
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

/**
 * Derived image fallback: the canonical pokemontcg.io art URL for a card id.
 * Some catalog rows carry provider URLs that can hiccup (rate limits, provider
 * outages) — when the row's own URL fails, the chain falls back to this.
 */
function derivedTcgUrl(cardId: string): string | null {
  const cut = cardId.lastIndexOf('-')
  if (cut <= 0) return null
  return `https://images.pokemontcg.io/${cardId.slice(0, cut)}/${cardId.slice(cut + 1)}.png`
}

import { FoilOverlay } from './foil/FoilOverlay'

export function CardImg({ src, alt, className, wrapProps, cardId, rarity, variant }: {
  src: string | null | undefined
  alt: string
  className?: string
  wrapProps?: React.HTMLAttributes<HTMLDivElement>
  cardId?: string | null
  /** Which foil this printing wears — used by the overlay, not by the <img>. */
  variant?: string | null
  /** Rarity, for printings whose foil follows rarity rather than variant. */
  rarity?: string | null
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  // Fallback chain: the row's URL → the derived pokemontcg.io URL → the row's
  // URL once more (covers transient CDN/rate-limit failures). Exhausting the
  // chain shows the error card; one flaky response no longer kills the art
  // for the session.
  // cardId can stand alone (the flea reveal has nothing else), so it may not
  // be gated on src — with src null the chain came out empty and every
  // cardId-only thumbnail rendered "Image unavailable".
  const derived = cardId ? derivedTcgUrl(cardId) : null
  const chain = useMemo(() => {
    const arr: string[] = []
    if (src) arr.push(src)
    if (derived && derived !== src) arr.push(derived)
    if (src) arr.push(src)
    return arr
  }, [src, derived])
  const [stage, setStage] = useState(0)
  const url = chain[stage] ?? null
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(chain.length ? 'loading' : 'error')
  const [pos, setPos] = useState<{ x: number; y: number; width: number } | null>(null)
  const openCard = useStore((s) => s.openCard)
  const imgRef = useRef<HTMLImageElement | null>(null)
  useEffect(() => {
    setStage(0)
    setState(chain.length ? 'loading' : 'error')
    // Cached images can complete before onLoad attaches — settle immediately.
    if (chain.length && imgRef.current?.complete && imgRef.current.naturalWidth > 0) setState('ok')
  }, [chain])
  const onImgError = () => {
    if (stage + 1 < chain.length) { setStage(stage + 1); setState('loading') } else setState('error')
  }
  // Armed with a cardId, every thumbnail zooms on hover (floating preview
  // follows the cursor) and opens the full card detail modal on click. Views
  // opt in per-site by passing cardId; wrapProps still win if a view needs
  // its own handlers (draggable rows, selection toggles…).
  // The preview hangs BESIDE the card, not under the cursor. Drawn at the
  // pointer it sat on top of the very card it was enlarging, which read as a
  // duplicated card rather than a zoom; it also had no foil, so the one place
  // you go to look closely was the one place the holo vanished.
  const PREVIEW_W = 300
  const anchor = (el: HTMLElement) => {
    // Inside the card detail modal the card is already large, so a hovering copy
    // of it is pure duplication — and it landed a size SMALLER than the card it
    // sat on, which is what "it still duplicates the card" was looking at.
    if (el.closest('.modal')) return null
    const r = el.getBoundingClientRect()
    const gap = 14
    const roomRight = window.innerWidth - 8 - (r.right + gap)
    const roomLeft = r.left - gap - 8
    const room = Math.max(roomLeft, roomRight)
    // No room beside the card means no preview at all. Squeezing one onto the
    // card is never worth it: at that point it reads as a second card, not a
    // closer look at this one, and the click-through detail view is right there.
    if (room < 200) return null
    const width = Math.min(PREVIEW_W, room)
    const x = roomRight >= roomLeft ? r.right + gap : Math.max(8, r.left - gap - width)
    return { x, y: Math.max(8, Math.min(r.top, window.innerHeight - width * 1.4 - 34)), width }
  }
  const zoom = !!(cardId && url)
  const zoomHandlers: React.HTMLAttributes<HTMLDivElement> = zoom
    ? {
        title: 'Click to open the card',
        onMouseEnter: (e) => setPos(anchor(e.currentTarget)),
        onMouseMove: (e) => setPos(anchor(e.currentTarget)),
        onMouseLeave: () => setPos(null),
        onClick: (e) => { e.stopPropagation(); setPos(null); void openCard(cardId!) },
      }
    : {}
  return (
    <>
      <div ref={wrapRef} className={`card-img-wrap ${className ?? ''} ${zoom ? 'zoomable' : ''}`} {...zoomHandlers} {...wrapProps}>
        {state === 'loading' && <div className="img-loading"><span className="spinner" /></div>}
        {state === 'error' && (
          <div className="img-error">
            <div style={{ fontSize: 20 }}>🃏</div>
            <div>Image unavailable</div>
          </div>
        )}
        {/* Keep the img in layout (opacity, not display:none) so lazy-loading still triggers. */}
        {url && state !== 'error' && (
          <img
            ref={imgRef}
            src={url}
            alt={alt}
            loading="lazy"
            onLoad={() => setState('ok')}
            onError={onImgError}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: state === 'ok' ? 1 : 0, transition: 'opacity 0.25s' }}
          />
        )}
        {/* Foil sits ABOVE the scan. The card's paper renders at rest; the
            advanced treatment takes over on hover when that switch is on. */}
        {url && state === 'ok' && (
          <FoilOverlay wrapRef={wrapRef} src={url} cardId={cardId} rarity={rarity} variant={variant} />
        )}
      </div>
      {pos && zoom && createPortal(
        <div className="zoom-preview" style={{ left: pos.x, top: pos.y, width: pos.width }}>
          {/* The same CardImg as everywhere else, so the zoom carries the
              printing's paper and the shine instead of a flat second copy. */}
          <CardImg src={url} alt={alt} cardId={cardId} rarity={rarity} variant={variant} />
          <div className="small" style={{ padding: '6px 8px' }}><b>{alt}</b></div>
        </div>,
        document.body,
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Graded slabs — modeled on a real PSA case (label on TOP with the red
// frame: set name left, card #/grade/cert right, barcode + logo below;
// frosted silver case, weld seam, clear well for the card). `grade` is the
// DB code (PSA10, BGS10, …); falsy renders the plain card untouched.
// ---------------------------------------------------------------------------

const SLAB_SERVICE: Record<string, { frame: string; ink: string; abbr: string }> = {
  PSA: { frame: '#d1292f', ink: '#d1292f', abbr: 'PSA' },
  BGS: { frame: '#15161a', ink: '#15161a', abbr: 'BGS' },
  CGC: { frame: '#15161a', ink: '#15161a', abbr: 'CGC' },
  SGC: { frame: '#a87d2a', ink: '#8a6722', abbr: 'SGC' },
}
const SLAB_WORD: Record<string, string> = { '10': 'GEM MT', '9': 'MINT', '8': 'NM-MT', '7': 'NM' }

function gradeParts(grade: string | null | undefined) {
  const m = grade ? grade.match(/^([A-Z]+)(\d+)(BL|P)?$/) : null
  if (!m) return null
  const blackLabel = m[3] === 'BL'
  const pristine = m[3] === 'P'
  const s = blackLabel
    ? { frame: '#c9a227', ink: '#d4af37', abbr: 'BGS' }
    : pristine
      ? { frame: '#c79a1e', ink: '#6f5510', abbr: 'CGC' }
      : SLAB_SERVICE[m[1]] ?? { frame: '#3a4256', ink: '#3a4256', abbr: m[1] }
  const word = blackLabel ? 'BLACK LABEL' : pristine || (m[1] === 'BGS' && m[2] === '10') ? 'PRISTINE' : SLAB_WORD[m[2]] ?? ''
  return { ...s, num: m[2], word, code: grade as string, blackLabel, pristine }
}

// Deterministic cert-style serial from the card + grade — pure flavor, but
// stable for a given slab so it reads like a real cert number.
function slabCert(alt: string | null | undefined, grade: string) {
  let h = 0
  const s = alt + '|' + grade
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return '64' + String(h % 1000000).padStart(6, '0')
}

function SlabBarcode({ cert }: { cert: string }) {
  // Denser than one-bar-per-char: seeded LCG drives ~30 thin bars like a real
  // 1D symbology.
  let seed = 0
  for (let i = 0; i < cert.length; i++) seed = (seed * 31 + cert.charCodeAt(i)) >>> 0
  const rects: React.ReactNode[] = []
  let x = 0
  for (let i = 0; i < 30; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0
    const w = ((seed >>> 16) % 2) + 1
    rects.push(<rect key={i} x={x} y={0} width={w} height={10} />)
    x += w + 1
  }
  return <svg className="psa-barcode" viewBox={`0 0 ${x} 10`} preserveAspectRatio="none" aria-hidden>{rects}</svg>
}

// Shared with CardDetail's certifier panel — one source of truth for the
// cert number so the panel and the rendered slab can never disagree.
export function slabLabel(alt: string | null | undefined, grade: string | null | undefined) {
  const g = gradeParts(grade)
  if (!g) return null
  return { ...g, cert: slabCert(alt ?? '', grade ?? '') }
}

export function SlabCard({ src, alt, grade, setName, cardNo, className, cardId, variant, rarity }: {
  src: string | null | undefined
  alt: string
  grade: string | null | undefined
  setName?: string | null
  cardNo?: string | null
  className?: string
  cardId?: string | null
  /** Which foil this printing wears — used by the overlay, not by the <img>. */
  variant?: string | null
  /** Rarity, for printings whose foil follows rarity rather than variant. */
  rarity?: string | null
}) {
  const g = gradeParts(grade)
  if (!g) return <CardImg src={src} alt={alt} className={className} cardId={cardId} variant={variant} rarity={rarity} />
  const cert = slabCert(alt ?? '', grade ?? '')
  const no = cardNo && /^\d+$/.test(cardNo) ? String(Number(cardNo)) : cardNo
  return (
    <div className={`psa-slab ${g.blackLabel ? 'black-label' : ''} ${g.pristine ? 'pristine-label' : ''} ${className ?? ''}`}>
      <div className="psa-label" style={{ borderColor: g.frame }}>
        <div className="psa-main">
          <div className="psa-setlines">
            <span className="psa-set">{(alt || '').toUpperCase()}</span>
            {setName && <span className="psa-set">{setName.toUpperCase()}</span>}
          </div>
          <div className="psa-rank">
            {no && <span className="psa-cardno">#{no}</span>}
            {g.word && <span className="psa-word">{g.word}</span>}
            <span className="psa-num">{g.num}</span>
          </div>
        </div>
        <div className="psa-foot">
          <SlabBarcode cert={cert} />
          <span className="psa-logo" style={{ color: g.ink }}>{g.abbr}</span>
          <span className="psa-cert">{cert}</span>
        </div>
      </div>
      <div className="psa-well"><CardImg src={src} alt={alt} cardId={cardId} variant={variant} rarity={rarity} /></div>
      <div className="psa-glare" />
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
// Grading result ceremony — shared by Inventory and Grading so both pages
// play the identical reveal for a verdict (the server spends a verdict on
// the read that returns it; a page that drops the payload loses the ceremony).
// ---------------------------------------------------------------------------

export const GRADE_BADGE: Record<string, string> = {
  PSA10: 'GEM MNT 10', PSA9: 'MINT 9', PSA8: 'NM-MT 8', PSA7: 'NM 7',
  BGS10BL: 'BGS BLACK LABEL 10', BGS10: 'BGS 10', BGS9: 'BGS 9', BGS8: 'BGS 8', CGC10P: 'CGC PRISTINE 10', CGC10: 'CGC GEM MINT 10', CGC9: 'CGC 9', CGC8: 'CGC 8', SGC10: 'SGC 10', SGC9: 'SGC 9',
}

export function GradeRevealModal({
  reveal,
  onClose,
  onBackdropClose,
  onSeeCollection,
}: {
  reveal: GradingReveal
  onClose: () => void
  /** Backdrop dismiss (Inventory wraps this in its 400ms open-flush grace). */
  onBackdropClose?: () => void
  onSeeCollection?: () => void
}) {
  const pl = reveal.value * 0.9 - reveal.costBasis
  const valueBadge = reveal.valueBasis === 'asking'
    ? `ASKING · ${reveal.valueKind === 'ebay-graded' ? 'eBay' : 'Market'}`
    : reveal.valueBasis === 'estimated'
      ? (reveal.valueKind === 'pc-graded' ? 'PRICECHARTING ESTIMATE' : 'GAME ESTIMATE')
      : `SOLD-BASED · ${reveal.valueKind === 'ebay-graded' ? 'eBay' : 'PriceCharting'}`
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) (onBackdropClose ?? onClose)() }}>
      <div className="modal" style={{ width: 'min(620px, 95vw)', textAlign: 'center' }}>
        <div className="faint small" style={{ letterSpacing: 2 }}>GRADING RESULT</div>
        <h1 style={{ fontSize: 40, margin: '6px 0' }}>{reveal.gradeLabel}</h1>
        <div className="sub muted">{reveal.name}</div>
        <div style={{ fontSize: 34, fontWeight: 800, margin: '14px 0 4px', fontVariantNumeric: 'tabular-nums' }}>
          {fmtUsd(reveal.value)}
          <span className={`badge ${reveal.valueBasis === 'sold' ? 'live' : 'est'}`} style={{ marginLeft: 10 }}>{valueBadge}</span>
        </div>
        <div className={`small ${pl >= 0 ? 'delta-up' : 'delta-down'}`}>
          Profit if sold now: {pl >= 0 ? '+' : ''}{fmtUsd(Math.round(pl * 100) / 100)} (after 10% fee)
        </div>
        {reveal.allGrades.length > 1 && (
          <div className="mt14" style={{ textAlign: 'left' }}>
            <div className="faint small mb8">GRADED PRICE LADDER</div>
            <table className="table">
              <thead><tr><th>Grade</th><th className="right">Value</th><th>Source</th></tr></thead>
              <tbody>
                {reveal.allGrades.map((g) => (
                  <tr key={g.grade} style={g.grade === reveal.grade ? { color: 'var(--accent, #ffd54a)', fontWeight: 700 } : undefined}>
                    <td>{GRADE_BADGE[g.grade] ?? g.grade}</td>
                    <td className="num">{fmtUsd(g.usd)}</td>
                    <td className="small muted">
                      {g.basis === 'asking'
                        ? 'eBay active asks'
                        : g.basis === 'estimated'
                          ? `${g.source === 'pc-graded' ? 'PriceCharting' : 'eBay'} estimate`
                          : `${g.source === 'pc-graded' ? 'PriceCharting' : 'eBay'} sold-based`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="row mt14" style={{ justifyContent: 'center' }}>
          <button className="primary" onClick={onClose}>NICE</button>
          {onSeeCollection && (
            <button onClick={() => { onClose(); onSeeCollection() }}>SEE MY COLLECTION</button>
          )}
        </div>
      </div>
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
  // Theme tokens, not fixed mint/red: a mint line vanishes on a light panel.
  const stroke = up ? 'var(--green)' : 'var(--red)'
  return (
    <div>
      <svg viewBox={`0 0 ${path.w} ${path.h}`} style={{ width: '100%', height: 'auto' }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="pcFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: stroke, stopOpacity: 0.25 }} />
            <stop offset="100%" style={{ stopColor: stroke, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <path d={`${path.d} L${path.w - 4},${path.h - 4} L4,${path.h - 4} Z`} fill="url(#pcFill)" stroke="none" />
        <path d={path.d} fill="none" style={{ stroke }} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
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
 * height.
 *
 * The density bug, fixed here: virtualized row math must agree with the real
 * layout, so VirtualGrid measures itself — column count comes from a hidden
 * probe grid with the SAME density class (the CSS auto-fill resolution at this
 * exact width), and row height comes from the REAL rendered cells, not a
 * synthetic skeleton (a probe with simplified meta rows under-measured views
 * like Collection whose cells carry extra badge/price rows, and the drifted
 * rows overlapped). The host is deliberately a plain block: putting the
 * caller's card-grid class on it made the host an auto-fill grid, which
 * squeezed the spacer child (the window's geometry anchor) into a single
 * column — collapsing the whole grid to one card wide.
 */
export function VirtualGrid<T>({
  items, render, density = 'comfortable', overscanRows = 3, minHeight = 400, className = '', empty,
}: {
  items: T[]
  render: (item: T, index: number) => React.ReactNode
  /** Which density mode's CSS class this grid renders with. */
  density?: 'comfortable' | 'compact' | 'list'
  overscanRows?: number
  minHeight?: number
  className?: string
  empty?: React.ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(900)
  // Seed with the documented metrics, then let the probe correct them — the
  // seed only bridges the first paint.
  const [metrics, setMetrics] = useState<{ rowHeight: number; cols: number; gap: number }>(() => DENSITY_METRICS[density])

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

  // Cols + gap: a hidden probe grid with the same density class, spanning the
  // host — its resolved auto-fill tracks ARE the column count the CSS wants at
  // this width. Row height: measured from an actually-rendered cell inside the
  // virtual window (MutationObserver catches cells mounting as you scroll).
  useEffect(() => {
    const host = scrollRef.current
    if (!host) return
    const probe = document.createElement('div')
    probe.className = `card-grid ${density !== 'comfortable' ? `density-${density}` : ''}`
    probe.style.cssText = 'position:absolute;left:0;right:0;top:0;visibility:hidden;pointer-events:none;'
    host.appendChild(probe)
    let raf = 0
    let settle = 0
    const measure = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const cs = getComputedStyle(probe)
        const cols = Math.max(1, cs.gridTemplateColumns.split(' ').filter(Boolean).length)
        const gap = Math.max(0, Math.round(parseFloat(cs.rowGap || cs.gap) || 0))
        setMetrics((m) => (m.cols === cols && m.gap === gap ? m : { ...m, cols, gap }))
        // Row height from the REAL cells — take the MAX: a cell whose name
        // or set line wraps runs a few px taller, and the row pitch must
        // clear the tallest cell or neighbors collide.
        let h = 0
        host.querySelectorAll('.virtual-window .card-cell').forEach((cell) => {
          h = Math.max(h, Math.ceil(cell.getBoundingClientRect().height))
        })
        if (h > 1) setMetrics((m) => (m.rowHeight === h ? m : { ...m, rowHeight: h }))
      })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    // Cells mount/unmount as the window slides — every mount re-measures.
    const mo = new MutationObserver(measure)
    mo.observe(host, { childList: true, subtree: true })
    // Card art loading GROWS cells a few px after they mount — an img load
    // fires no mutation, but it does change the window's height, so observe
    // the window itself and re-measure whenever it settles taller.
    let winRo: ResizeObserver | null = null
    let observedWin: Element | null = null
    const measureAndWatch = () => {
      const win = host.querySelector('.virtual-window')
      if (win && win !== observedWin) {
        observedWin = win
        winRo = new ResizeObserver(measure)
        winRo.observe(win)
      }
      measure()
    }
    measureAndWatch()
    settle = window.setTimeout(measureAndWatch, 350) // after fonts/images settle
    return () => { clearTimeout(settle); cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); winRo?.disconnect(); probe.remove() }
  }, [density])

  // Keep the window anchored when the list shrinks (filter change, density
  // switch): a stale scrollTop past the new content height would render a
  // blank window, so clamp the held position back into range.
  const { rowHeight, cols, gap } = metrics
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
    <div ref={scrollRef} className="virtual-grid" style={{ position: 'relative', minHeight }}>
      <div style={{ height: totalH, position: 'relative' }}>
        <div
          className={`virtual-window card-grid ${className}`}
          style={{
            position: 'absolute',
            top: firstRow * stride,
            left: 0,
            right: 0,
            display: 'grid',
            // minmax(0,…): a plain 1fr track floors at the cell's min-content
            // width, so one long card name widened its whole column and the
            // grid rendered cards at different sizes. Equal tracks, always.
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap,
            alignItems: 'start',
          }}
        >
          {slice.map((item, i) => (
            <div key={first + i} style={density === 'list' ? undefined : { height: rowHeight }}>
              {render(item, first + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Seed cell metrics for the density modes — a first-paint bridge only. VirtualGrid
 * mounts a probe cell inside its own column and corrects these to the real
 * layout within a frame or two, so the values just need to be plausible; the
 * probe's in-place measurement is the source of truth for the row math.
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

/** Flat grid vs grouped-by-set sections — persisted in the store, shared by Collection and Inventory. */
export function BrowseToggle() {
  const browse = useStore((s) => s.browse)
  const setBrowse = useStore((s) => s.setBrowse)
  return (
    <div className="tab-bar density-toggle" role="group" aria-label="Browse mode" title="Browse mode — flat or grouped by set">
      <button className={`tab ${browse === 'flat' ? 'on' : ''}`} onClick={() => setBrowse('flat')} aria-pressed={browse === 'flat'}>Flat</button>
      <button className={`tab ${browse === 'byset' ? 'on' : ''}`} onClick={() => setBrowse('byset')} aria-pressed={browse === 'byset'}>By set</button>
    </div>
  )
}

/**
 * One collapsible set section for grouped browse. The header sticks under the
 * top bar while its section scrolls, and carries per-set stats (count, value)
 * plus optional actions (e.g. pick-whole-set in Inventory).
 */
export function SetSection({ setName, stats, defaultOpen = true, actions, children }: {
  setName: string
  stats?: React.ReactNode
  defaultOpen?: boolean
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="set-section">
      <div className="set-section-head">
        <button className="set-section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="set-section-caret">{open ? '▾' : '▸'}</span> {setName}
        </button>
        {stats && <span className="set-section-stats">{stats}</span>}
        {actions && <span className="set-section-actions">{actions}</span>}
      </div>
      {open && <div className="set-section-body">{children}</div>}
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

export function EmptyState({ icon, text, sub, action }: { icon: string; text: string; sub?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="empty">
      <div style={{ fontSize: 34, marginBottom: 8 }}>{icon}</div>
      <div>{text}</div>
      {sub && <div className="small faint" style={{ marginTop: 4 }}>{sub}</div>}
      {action && <button className="primary" style={{ marginTop: 14 }} onClick={action.onClick}>{action.label}</button>}
    </div>
  )
}

/** The same dead-end everywhere: say what could not load, and offer the reload. */
export function LoadFailure({ what, sub, onRetry }: { what: string; sub?: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon="⚠️"
      text={`Couldn't load ${what}`}
      sub={sub ?? 'The local server did not answer. Nothing was changed.'}
      action={{ label: 'Try again', onClick: onRetry }}
    />
  )
}

// ---------------------------------------------------------------------------
// OverflowMenu — one “⋯” button instead of a wall of per-row actions.
//
// The menu renders in a portal with fixed positioning: card cells transform
// on hover and virtualized lists clip their children, either of which would
// trap an absolutely-positioned dropdown. Closes on outside click, Escape and
// any scroll (so a virtualized row can never strand an open menu).
// ---------------------------------------------------------------------------

export type MenuItem = {
  label: string
  onClick: () => void
  disabled?: boolean
  /** Small grey second line — what the action actually does. */
  hint?: string
  /** Marks the one action worth showing first. */
  primary?: boolean
}

export function OverflowMenu({ items, title = 'More actions', label = '⋯' }: {
  items: MenuItem[]
  title?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  const toggle = () => {
    if (open) { setOpen(false); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const flip = r.bottom + 40 + items.length * 34 > window.innerHeight
    setPos({ top: flip ? Math.max(8, r.top - 6) : r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (btnRef.current?.contains(t) || t.closest?.('.ovf-menu')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    // Scroll-into-view from the click that opened the menu often lands a frame
    // later — don't let that swallow the menu the user just asked for.
    const openedAt = performance.now()
    const onScroll = () => { if (performance.now() - openedAt > 250) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <span style={{ display: 'inline-flex', position: 'relative' }}>
      <button
        ref={btnRef}
        className="ovf-trigger small"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >{label}</button>
      {open && createPortal(
        <div className="ovf-menu" role="menu" style={{ top: pos.top, right: pos.right }}>
          {items.map((it, i) => (
            <button
              key={i}
              role="menuitem"
              className={`ovf-item${it.primary ? ' lead' : ''}`}
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick() }}
            >
              <span>{it.label}</span>
              {it.hint && <em>{it.hint}</em>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Condition Wars — sub-stat bars, eye skill, copy comps
// ---------------------------------------------------------------------------

export type SubStatRead = { centering: number; whitening: number; corners: number; printLine: number }

function Bar({ label, value, invert = false }: { label: string; value: number; invert?: boolean }) {
  // invert: a higher raw number is WORSE (whitening) — tint tracks damage.
  const good = invert ? 100 - value : value
  const color = good >= 80 ? 'var(--good, var(--green))' : good >= 55 ? 'var(--accent, var(--blue))' : good >= 30 ? 'var(--amber)' : 'var(--red)'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '74px 1fr 30px', gap: 8, alignItems: 'center' }}>
      <span className="faint small">{label}</span>
      <div style={{ height: 6, background: 'var(--panel-border, #2a2a35)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(2, Math.min(100, value))}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span className="small" style={{ textAlign: 'right' }}>{value}</span>
    </div>
  )
}

/** The four sub-stat bars for an inspected copy, tinted by quality. */
export function SubStatBars({ stats }: { stats: SubStatRead }) {
  return (
    <div style={{ display: 'grid', gap: 5, marginTop: 6 }}>
      <Bar label="centering" value={stats.centering} />
      <Bar label="whitening" value={stats.whitening} invert />
      <Bar label="corners" value={stats.corners} />
      <Bar label="print line" value={stats.printLine} />
    </div>
  )
}

/** The eye-training meter: looks + grades sharpen the read. */
export function EyeSkill({ skill, hint }: { skill: number; hint?: string }) {
  const label = skill >= 100 ? 'mastered eye' : skill >= 70 ? 'trained eye' : skill >= 35 ? 'apprentice eye' : 'untrained eye'
  return (
    <span className="small faint" title={hint}>
      👁 {label} ({skill}%)
    </span>
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

export function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <span className={`chip ${on ? 'on' : ''}`} onClick={onClick} title={title}>{children}</span>
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

/**
 * One-time inline tutorial for a game surface. Shows until the server flips
 * the matching flag in `state.tutorials` (first real use of that surface —
 * a bid, a lot purchase, walking through convention doors). Keyed off the
 * store, so it's per-save and survives restarts; no localStorage.
 */
export function FirstUseTip({ surface, children }: { surface: 'auction' | 'resale' | 'convention' | 'haggle' | 'ebay' | 'storage' | 'buylist' | 'pawn' | 'yard' | 'live' | 'local' | 'shipping' | 'estate' | 'auth' | 'futures'; children: React.ReactNode }) {
  const done = useStore((s) => {
    const st = s.state
    if (!st) return true
    if (surface === 'haggle') return st.haggledOnce
    return st.tutorials[surface]
  })
  if (done) return null
  return (
    <div className="faint small" style={{ marginBottom: 10, padding: '8px 10px', background: 'var(--panel2)', borderRadius: 6, border: '1px solid var(--border-soft)', lineHeight: 1.5 }}>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TipList — short, scannable rule lines inside a FirstUseTip.
//
// A paragraph of rules is a wall the player skips; the same rules as one
// labelled line each (icon · bold lead · what it costs you) get read. Every
// entry keeps its label under ~4 words so the eye can run down the column.
// ---------------------------------------------------------------------------

export function TipList({ title, items }: { title?: string; items: { icon: string; label: string; text: React.ReactNode }[] }) {
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      {title && <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 1 }}>{title}</div>}
      {items.map((it) => (
        <div key={it.label} style={{ display: 'flex', gap: 8, alignItems: 'baseline', lineHeight: 1.45 }}>
          <span aria-hidden style={{ flex: '0 0 auto' }}>{it.icon}</span>
          <span><b style={{ color: 'var(--text)' }}>{it.label}</b> — {it.text}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Capacity strip — the shelf is filling up. Shows on Collection / Inventory
// once raw storage crosses 75%, with a shortcut to the Storage & Auctions
// locker desk. Silent below the threshold: a half-full shelf is not news.
// ---------------------------------------------------------------------------

export function CapacityStrip() {
  const [cap, setCap] = useState<import('./api').StorageCapacity | null>(null)
  useEffect(() => { api.storageCapacity().then(setCap).catch(() => {}) }, [])
  // Surfaces earlier (60%+) than the server's 'hot' threshold: the strip is the
  // main signpost to the locker desk, and surfacing only when nearly full made
  // "where do I buy more storage?" easy to miss entirely.
  if (!cap || (cap.rawPct < 0.6 && cap.slabOwned < cap.slabCapacity)) return null
  const full = cap.rawPct >= 1
  const slabsFull = cap.slabOwned >= cap.slabCapacity && cap.slabOwned > 0
  return (
    <div
      className="row small"
      style={{
        marginBottom: 12,
        padding: '8px 12px',
        borderRadius: 6,
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        background: full ? 'rgba(220, 60, 60, 0.12)' : 'rgba(230, 180, 40, 0.10)',
        border: `1px solid ${full ? 'rgba(220, 60, 60, 0.45)' : 'rgba(230, 180, 40, 0.4)'}`,
        color: full ? 'var(--red)' : 'var(--gold)',
      }}
    >
      <span>
        📦 Shelf {full ? 'FULL' : 'filling up'} — <b>{cap.rawOwned}/{cap.rawCapacity}</b> raw cards stored.
        {' '}{full ? 'New cards get refused at the door until you make room.' : 'A full rack refuses every delivery — rent before the next haul.'}
      </span>
      {slabsFull && <span>🏆 Slab rack full ({cap.slabOwned}/{cap.slabCapacity}).</span>}
      <button className="ghost small" style={{ marginLeft: 'auto' }} onClick={() => { window.location.hash = '#/inventory/storage' }}>
        🗄 Rent a locker →
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overflow pre-flight hint — when auto-scrap is on and a buy would have to
// scrap spares to fit, show exactly what it costs in cardboard, right on the
// buy button. Reads the live scrap pool (read-only) and refreshes with state.
// ---------------------------------------------------------------------------

export type OverflowPreviewInfo = import('./api').StorageOverflowPreview

export function useOverflowHint(count = 1): OverflowPreviewInfo | null {
  const state = useStore((s) => s.state)
  const [preview, setPreview] = useState<OverflowPreviewInfo | null>(null)
  useEffect(() => {
    let cancelled = false
    api.storageOverflowPreview(count)
      .then((p) => { if (!cancelled) setPreview(p.label ? p : null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [count, state?.progress?.cardsOwned, state?.cash])
  return preview
}

export function OverflowHint({ count = 1, align = 'right' }: { count?: number; align?: 'right' | 'left' }) {
  const hint = useOverflowHint(count)
  if (!hint?.label) return null
  const blocked = hint.blockedByFloor
  return (
    <div
      className="faint"
      style={{
        fontSize: 11,
        lineHeight: 1.35,
        textAlign: align,
        marginTop: 3,
        color: blocked ? 'var(--red, #ef4444)' : 'var(--gold, #eab308)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
      title={blocked ? `Auto-scrap is on, but your ${hint.scrapFloor > 0 ? `$${hint.scrapFloor.toFixed(0)} scrap floor` : 'settings'} spare everything left — the shop will refuse this buy.` : undefined}
    >
      {hint.label}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TearPack — the interactive foil pack. Hold and pull down to tear (pointer),
// Enter/Space to rip (keyboard), or let autoRip do it; a glowing tear line
// rides the pointer, the crimped top peels, and the finished rip throws a
// spark burst. Shared by Pack Opening, Pack Battles, and Live Shopping so
// every rip in the game feels the same.
// ---------------------------------------------------------------------------

/** Deterministic per-set accent: same set name → same hue, every time. */
export function packHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

const TEAR_SPARKS = Array.from({ length: 16 }, (_, i) => {
  const ang = (i / 16) * Math.PI * 2 + (i % 3) * 0.22
  const dist = 90 + ((i * 37) % 100)
  return {
    dx: Math.round(Math.cos(ang) * dist),
    dy: Math.round(Math.sin(ang) * dist - 30),
    d: `${(i % 4) * 0.05}s`,
    c: ['#ffcb05', '#ffffff', '#f0abfc', '#7dd3fc'][i % 4],
  }
})

// Heavier foil shards: they arc out slower, tumble, then fall under gravity
// — the pack isn't just sparkling, it's coming apart in your hands.
const TEAR_SHARDS = Array.from({ length: 12 }, (_, i) => {
  const ang = (i / 12) * Math.PI * 2 + (i % 4) * 0.31
  const dist = 70 + ((i * 53) % 90)
  return {
    dx: Math.round(Math.cos(ang) * dist),
    dy: Math.round(Math.sin(ang) * dist - 55 - ((i * 29) % 45)),
    r: `${120 + ((i * 67) % 200)}deg`,
    d: `${0.02 + (i % 4) * 0.05}s`,
  }
})

export function TearPack({ symbolUrl, imageUrl, name, sub, onTorn, compact = false, autoRip = false, ariaLabel, globalEnter = false }: {
  symbolUrl: string | null | undefined
  /** Real wrapper art (TCGplayer CDN). Present → the pack shows its actual
    * pack photo, and the rip splits that art along the tear line. */
  imageUrl?: string | null
  name: string
  sub: string
  /** Fired the moment the rip completes — delay your phase swap ~520ms to let the burst play. */
  onTorn: () => void
  compact?: boolean
  autoRip?: boolean
  ariaLabel?: string
  /** React to Enter anywhere on the page, not just when focused (the hint
    * promises it). Off for choreographed packs — the duel's rival rip must
    * not jump when the player rips theirs. */
  globalEnter?: boolean
}) {
  const [tear, setTear] = useState(0)
  const [ripping, setRipping] = useState(false)
  const [torn, setTorn] = useState(false)
  const [sparks, setSparks] = useState(false)
  const [broken, setBroken] = useState(false)
  // Parallax tilt: the pack leans toward the cursor like it's being held up
  // for inspection. Frozen the moment the tear starts (and on leave).
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  // The wrapper photo's own proportions, read off the image. TCGplayer's pack
  // shots are tall (219×400 for the 2026 sets, 291×400 for older ones) and the
  // tear box used to be card-shaped (245×342), so object-fit:cover cut ~24%
  // off a modern wrapper — the crimped top and the bottom "additional game
  // cards" strip — and the rip read as a crop of some artwork instead of a
  // pack. Sizing the box to the photo means cover crops nothing.
  const [artRatio, setArtRatio] = useState<number | null>(null)
  // Where the printed wrapper sits inside the photo. TCGplayer normalises its
  // product shots onto a padded canvas, so a Celestial Storm booster is a 356×400
  // image whose pack occupies only x 86–270, y 34–368: sizing the tear box to the
  // photo drew the wrapper at half width in a white card, with the SWIPE handle
  // out on the margin. Measure the printed edge and crop to it instead.
  const [crop, setCrop] = useState<{ cl: number; ct: number; cw: number; ch: number } | null>(null)
  // The photo comes through /api/packart so the canvas may read it (the CDN sends
  // no CORS headers). Direct is the fallback if that route is unavailable.
  const [directArt, setDirectArt] = useState(false)
  const artSrc = !imageUrl ? undefined : directArt ? imageUrl : `/api/packart?u=${encodeURIComponent(imageUrl)}`
  const measureArt = (img: HTMLImageElement) => {
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    if (!nw || !nh) return
    const scale = Math.min(1, 160 / Math.max(nw, nh))
    const w = Math.max(1, Math.round(nw * scale))
    const h = Math.max(1, Math.round(nh * scale))
    try {
      const cv = document.createElement('canvas')
      cv.width = w
      cv.height = h
      const ctx = cv.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(img, 0, 0, w, h)
      const px = ctx.getImageData(0, 0, w, h).data
      let left = w, top = h, right = -1, bottom = -1
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          const empty = px[i + 3] < 8 || (px[i] > 244 && px[i + 1] > 244 && px[i + 2] > 244)
          if (empty) continue
          if (x < left) left = x
          if (x > right) right = x
          if (y < top) top = y
          if (y > bottom) bottom = y
        }
      }
      if (right < 0) return
      const box = { cl: left / w, ct: top / h, cw: (right - left + 1) / w, ch: (bottom - top + 1) / h }
      // A photo that is already tight needs no crop; keep its own shape. Only a
      // real margin is worth moving (and only ~3% or more of one).
      if (box.cw > 0.97 && box.ch > 0.97) return
      setCrop(box)
      setArtRatio((nw / nh) * (box.cw / box.ch))
    } catch {
      // Cross-origin or an unreadable canvas: keep the photo's own shape.
    }
  }
  const tearRef = useRef(0)
  const autoRipRef = useRef<number | null>(null)
  const doneRef = useRef(false)
  const dragRef = useRef<number | null>(null)
  const hue = packHue(name)

  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    if (autoRipRef.current != null) { window.clearInterval(autoRipRef.current); autoRipRef.current = null }
    setRipping(false)
    setTorn(true)
    setSparks(true)
    ripChime()
    onTorn()
  }, [onTorn])

  // A rip is a SWIPE ACROSS: start at the left edge of the pack and drag right.
  // The cut travels with your hand along the line, opening the wrapper from the
  // left, instead of any drag direction moving the whole strip at once.
  const tearTo = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (dragRef.current == null) dragRef.current = e.clientX
    const dx = Math.max(0, e.clientX - dragRef.current)
    const pct = Math.max(0, Math.min(100, Math.round(Math.pow((dx / r.width) * 130, 1.05))))
    const prev = tearRef.current
    tearRef.current = Math.max(prev, pct)
    setTear(tearRef.current)
    // Foil friction: crinkle as the tear line advances (throttled by movement).
    if (tearRef.current > prev) crinkle(Math.min(1, (tearRef.current - prev) / 18 + 0.35))
  }
  const hoverTilt = (e: React.PointerEvent<HTMLDivElement>) => {
    if (ripping || torn || doneRef.current) return
    const r = e.currentTarget.getBoundingClientRect()
    const nx = ((e.clientX - r.left) / r.width - 0.5) * 2   // -1..1
    const ny = ((e.clientY - r.top) / r.height - 0.5) * 2
    setTilt({ x: -ny * 7, y: nx * 9 })
  }
  const startAutoRip = useCallback(() => {
    if (autoRipRef.current != null || doneRef.current) return
    autoRipRef.current = window.setInterval(() => {
      tearRef.current = Math.min(92, tearRef.current + 9)
      setTear(tearRef.current)
      if (tearRef.current >= 92) finish()
    }, 36)
  }, [finish])
  // StrictMode's mount→cleanup→mount runs this twice: the first cleanup must
  // also null the slot, or startAutoRip's "already running" guard (below) sees
  // the dead interval id forever and the rip never starts.
  useEffect(() => () => { if (autoRipRef.current != null) { window.clearInterval(autoRipRef.current); autoRipRef.current = null } }, [])
  useEffect(() => { if (autoRip) startAutoRip() }, [autoRip, startAutoRip])
  // The hint says "or press Enter" — honor it even when nothing has focus yet.
  // (startAutoRip no-ops after the rip, so late keypresses can't double-fire.)
  useEffect(() => {
    if (!globalEnter) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); startAutoRip() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [globalEnter, startAutoRip])

  return (
    <div className="po-reveal" style={compact ? { transform: 'scale(.78)', margin: '-26px 0' } : undefined}>
      <div className={`po-pack-shell ${ripping || torn ? 'held' : ''}`}>
      <div
        className={`po-pack ${imageUrl ? 'has-art' : ''} ${crop ? 'cropped' : ''} ${torn ? 'po-pack-torn' : ''} ${ripping && !torn ? 'ripping' : ''}`}
        style={{
          boxShadow: `0 18px 50px #00000080, 0 0 90px hsl(${hue} 80% 60% / 0.22)`,
          '--rx': `${tilt.x}deg`,
          '--ry': `${tilt.y}deg`,
          '--tn': (tear / 100).toFixed(3),
          '--pull': tear,
          '--bh': hue,
          ...(crop ? { '--cl': String(crop.cl), '--ct': String(crop.ct), '--cw': String(crop.cw), '--ch': String(crop.ch) } : null),
          ...(imageUrl && artRatio ? { aspectRatio: String(artRatio), '--art-ar': String(artRatio) } : null),
        } as React.CSSProperties}
        tabIndex={0}
        role="button"
        aria-label={ariaLabel ?? `Tear open ${name} — press Enter or Space`}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !torn && !e.repeat) { e.preventDefault(); startAutoRip() } }}
        onPointerDown={(e) => { if (torn) return; try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* synthetic pointers can't capture */ } dragRef.current = e.clientX; setRipping(true); tearTo(e) }}
        onPointerMove={(e) => { if (ripping && !torn) tearTo(e); else hoverTilt(e) }}
        onPointerLeave={() => { if (!ripping) setTilt({ x: 0, y: 0 }) }}
        onPointerUp={() => { if (torn) return; dragRef.current = null; setRipping(false); if (tearRef.current >= 62) finish(); else { tearRef.current = 0; setTear(0) } }}
        onPointerCancel={() => { dragRef.current = null; setRipping(false); tearRef.current = 0; setTear(0) }}
      >
        {imageUrl ? (
          /* The wrapper IS the interface: no frame, no printed captions. Two
             copies of the art, cut by the same zigzag, so pulling the tail
             actually splits the foil instead of sliding a panel. */
          <>
            {/* The inside of the wrapper, under the crimped strip. */}
            <div className="rip-mouth" aria-hidden />
            <div className="rip-body" aria-hidden>
              <img
                className="rip-img"
                src={artSrc}
                alt=""
                draggable={false}
                onError={() => { if (!directArt) setDirectArt(true) }}
                onLoad={(e) => {
                  const img = e.currentTarget
                  const r = img.naturalWidth / img.naturalHeight
                  // A sane range only: a broken/placeholder image must not
                  // stretch the wrapper into a sliver or a letterbox.
                  if (r > 0.2 && r < 3) setArtRatio((prev) => (prev === r ? prev : r))
                  measureArt(img)
                }}
              />
            </div>
            {/* Only the already-cut section of the strip lifts, so the wrapper
                opens from the left edge to the right along the swipe. */}
            <div className="rip-lift" aria-hidden>
              <div className="rip-tail" aria-hidden>
                <img className="rip-img" src={artSrc} alt="" draggable={false} />
                <span className="rip-backing" />
              </div>
            </div>
            <div className="rip-edge" aria-hidden />
            <div className="rip-knob" aria-hidden />
            {!torn && (
              <div className={`rip-grip ${ripping ? 'pulling' : ''}`} aria-hidden>
                <span className="rip-grip-teeth" />
                <span className="rip-grip-text">{ripping ? 'CUTTING' : 'SWIPE →'}</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="pack-foil" aria-hidden />
            {symbolUrl && !broken
              ? <img className="pack-logo-img" src={symbolUrl} alt={`${name} symbol`} onError={() => setBroken(true)} />
              : <div className="pack-logo">🎴</div>}
            <div className="pack-name">{name}</div>
            <div className="pack-sub">{sub}</div>
            <div className="tear-hint">{ripping ? 'keep pulling…' : 'hold & pull down — or press Enter'}</div>
          </>
        )}
      </div>
      </div>
      {/* Captions live UNDER the pack: printing them on the wrapper was the
          single worst thing about this screen. */}
      {imageUrl && <div className="rip-caption"><b>{name}</b><span>{sub}</span></div>}
      {torn && <div className="rip-flash" aria-hidden />}
      {sparks && (
        <div className="po-sparks" aria-hidden>
          {TEAR_SPARKS.map((s, i) => (
            <span key={i} style={{ '--dx': `${s.dx}px`, '--dy': `${s.dy}px`, '--d': s.d, '--c': s.c } as React.CSSProperties} />
          ))}
          {TEAR_SHARDS.map((s, i) => (
            <span
              key={`shard-${i}`}
              className="shard"
              style={{ '--dx': `${s.dx}px`, '--dy': `${s.dy}px`, '--r': s.r, '--d': s.d, '--c': i % 3 === 0 ? '#ffcb05' : i % 3 === 1 ? '#ffffff' : `hsl(${hue} 85% 62%)` } as React.CSSProperties}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// BestPullCard — the all-time single-card pull record, wherever it belongs.
// A crowned mini display with the card art, name, and value; links to the
// card detail like every other card surface.
// ---------------------------------------------------------------------------

export function BestPullCard({ best, onOpenCard, compact = false }: {
  best: { cardId: string | null; value: number; name?: string; image?: string | null; setName?: string; rarity?: string | null; isHit?: boolean; openedAt?: string }
  onOpenCard?: (id: string) => void
  compact?: boolean
}) {
  if (!best.cardId) {
    return (
      <div className="faint small" style={{ padding: '6px 0' }}>
        No pulls on record yet — the first pack writes the record.
      </div>
    )
  }
  if (compact) {
    return (
      <div className="row" style={{ gap: 10, cursor: onOpenCard ? 'pointer' : 'default', alignItems: 'center' }} onClick={onOpenCard ? () => onOpenCard(best.cardId!) : undefined}>
        <div style={{ width: 38 }}><CardImg src={best.image ?? null} alt={best.name ?? best.cardId} cardId={best.cardId} /></div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="small" style={{ fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>👑 {best.name ?? best.cardId}</div>
          <div className="faint" style={{ fontSize: 11 }}>{best.setName ?? ''}{best.openedAt ? ` · ${new Date(best.openedAt).toLocaleDateString()}` : ''}</div>
        </div>
        <div className="right"><div className="small price" style={{ color: 'var(--gold)' }}>{fmtUsd(best.value)}</div></div>
      </div>
    )
  }
  return (
    <div className="row" style={{ gap: 14, alignItems: 'center', cursor: onOpenCard ? 'pointer' : 'default' }} onClick={onOpenCard ? () => onOpenCard(best.cardId!) : undefined}>
      <div style={{ width: 64 }}><CardImg src={best.image ?? null} alt={best.name ?? best.cardId} cardId={best.cardId} /></div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 750 }}>👑 {best.name ?? best.cardId}{best.rarity ? <span className="faint" style={{ fontWeight: 400 }}> · {best.rarity}</span> : null}</div>
        <div className="faint small">{best.setName ?? ''}{best.openedAt ? ` · pulled ${new Date(best.openedAt).toLocaleDateString()}` : ''}</div>
      </div>
      <div className="right">
        <div className="price" style={{ color: 'var(--gold)', fontSize: 20 }}>{fmtUsd(best.value)}</div>
        <div className="faint small" style={{ textAlign: 'right' }}>best pull on record</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// RecordMoment — the shared new-best-pull celebration: the pulsing gold
// screen-edge glow plus the 👑 NEW BEST PULL banner. Wrap your surface in
// it when a rip beats the all-time single-card record (fetch that record
// BEFORE the open — the server writes pulls during the open call).
// ---------------------------------------------------------------------------

export function RecordMoment({ active, value, variant = 'card' }: { active: boolean; value?: number | null; variant?: 'card' | 'pack' }) {
  if (!active) return null
  return (
    <>
      {value != null && (
        variant === 'pack'
          ? <div className="po-banner massive pack-record-banner" style={{ marginBottom: 12 }}>📦 BEST PACK EVER — {fmtUsd(value)}!</div>
          : <div className="po-banner massive" style={{ marginBottom: 12 }}>👑 NEW BEST PULL — {fmtUsd(value)}!</div>
      )}
    </>
  )
}

/** Applied to the page root when a record falls — drives the edge glow via CSS. */
export const RECORD_GLOW_CLASS = 'record-glow'
/** Violet glow for the second chase: best single-pack total. */
export const PACK_GLOW_CLASS = 'record-glow pack-glow'
/** Compose the edge-glow classes when one or both records fall at once. */
export function glowClass(cardRecord: boolean, packRecord: boolean): string {
  if (cardRecord && packRecord) return 'record-glow pack-glow'
  if (cardRecord) return RECORD_GLOW_CLASS
  if (packRecord) return PACK_GLOW_CLASS
  return ''
}
