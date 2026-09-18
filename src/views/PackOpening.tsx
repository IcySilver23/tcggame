import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { CardImg, EmptyState, fmtUsd } from '../components'
import type { OpenSession, OpenedCard, ProductRow } from '../types'

type Phase = 'idle' | 'revealing' | 'summary'

// ---------------------------------------------------------------------------
// Reactive card-image lookup (the open API returns IDs; images come from cards)
// ---------------------------------------------------------------------------

const imgCache = new Map<string, string | null>()
const imgPending = new Set<string>()
const imgWaiters = new Set<() => void>()

function useCardImage(cardId: string): string | null {
  const [, bump] = useState(0)
  useEffect(() => {
    const notify = () => bump((n) => n + 1)
    imgWaiters.add(notify)
    if (!imgCache.has(cardId) && !imgPending.has(cardId)) {
      imgPending.add(cardId)
      api
        .cardDetail(cardId)
        .then((d) => imgCache.set(cardId, d.card.image_small))
        .catch(() => imgCache.set(cardId, null))
        .finally(() => {
          imgPending.delete(cardId)
          imgWaiters.forEach((w) => w())
        })
    }
    return () => { imgWaiters.delete(notify) }
  }, [cardId])
  return imgCache.get(cardId) ?? null
}

function RevealCard({ card, className }: { card: OpenedCard; className?: string }) {
  const src = useCardImage(card.cardId)
  return (
    <div className={`po-card ${className ?? ''}`}>
      <CardImg src={src} alt="" />
    </div>
  )
}

function hitClass(card: OpenedCard): string {
  if (card.variant && card.variant.startsWith('1stEdition')) return 'epic'
  if (card.value >= 60 || (card.isHit && card.value >= 40)) return 'epic'
  if (card.isHit || card.value >= 8) return 'super'
  return ''
}

// ---------------------------------------------------------------------------

export function PackOpeningView() {
  const { toast, refreshState } = useStore()
  const [products, setProducts] = useState<ProductRow[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [queue, setQueue] = useState<OpenedCard[]>([])
  const [revealed, setRevealed] = useState<OpenedCard[]>([])
  const [session, setSession] = useState<OpenSession | null>(null)
  const [fast, setFast] = useState(false)
  const [sealedStock, setSealedStock] = useState<{ product_id: string; quantity: number }[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const loadSealed = useCallback(() => {
    api.pullsSummary().then((r) => {
      setSealedStock((r.sealedInStock as { product_id: string; quantity: number }[]) ?? [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    api.products().then(setProducts).catch(() => {})
    loadSealed()
  }, [loadSealed])

  const beginCeremony = (s: OpenSession) => {
    setSession(s)
    setQueue(s.cards)
    setRevealed([])
    setPhase('revealing')
    refreshState()
  }

  const startSession = async (productId: string, qty: number) => {
    setBusy(productId)
    try {
      const res = await api.buyProduct(productId, qty, true)
      const opened = res.opened ?? []
      if (opened.length === 0) { toast('Nothing opened', 'bad'); return }
      const cards = opened.flatMap((s) => s.cards)
      const spent = opened.reduce((a, s) => a + s.spent, 0)
      const totalValue = opened.reduce((a, s) => a + s.totalValue, 0)
      beginCeremony({ sessionId: opened[0].sessionId, cards, totalValue, spent })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Open failed', 'bad')
    } finally {
      setBusy(null)
    }
  }

  const openSealedOne = async (productId: string) => {
    setBusy(productId)
    try {
      beginCeremony(await api.openPack(productId))
      loadSealed()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Open failed', 'bad')
    } finally {
      setBusy(null)
    }
  }

  // Staged reveal loop
  useEffect(() => {
    if (phase !== 'revealing') return
    if (revealed.length >= queue.length) {
      const t = setTimeout(() => setPhase('summary'), fast ? 400 : 1100)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setRevealed((r) => [...r, queue[r.length]]), revealed.length === 0 ? (fast ? 120 : 450) : fast ? 240 : 950)
    return () => clearTimeout(t)
  }, [phase, revealed, queue, fast])

  const current = revealed[revealed.length - 1]
  const showHitBanner = Boolean(current && (current.isHit || current.value >= 40))
  const remaining = queue.length - revealed.length

  const roi = useMemo(() => {
    if (!session || session.spent === 0) return null
    return session.totalValue / session.spent - 1
  }, [session])

  const sealedProducts = products.filter((p) => sealedStock.some((s) => s.product_id === p.id))

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Pack Opening</h1>
          <div className="sub">The ceremony. Cards reveal one at a time — hits get the full treatment.</div>
        </div>
        <div className="chip-row">
          <span className={`chip ${!fast ? 'on' : ''}`} onClick={() => setFast(false)}>Slow reveal</span>
          <span className={`chip ${fast ? 'on' : ''}`} onClick={() => setFast(true)}>Skip animation</span>
        </div>
      </div>

      {phase === 'idle' && (
        <div>
          <div className="panel mb14">
            <h2>Buy & open now</h2>
            <div className="grid cols2 mt8">
              {products.map((p) => (
                <div key={p.id} className="row" style={{ justifyContent: 'space-between', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '10px 12px' }}>
                  <div>
                    <b className="small">{p.name}</b>
                    <div className="faint small">{fmtUsd(p.msrp)} · {p.packs} pack{p.packs > 1 ? 's' : ''}</div>
                  </div>
                  <button className="primary small" disabled={busy === p.id} onClick={() => startSession(p.id, 1)}>OPEN</button>
                </div>
              ))}
            </div>
            {products.length === 0 && <EmptyState icon="📦" text="Shop loading…" sub="Products appear as sets sync." />}
          </div>

          {sealedProducts.length > 0 && (
            <div className="panel">
              <h2>Your sealed inventory</h2>
              <div className="grid cols2 mt8">
                {sealedProducts.map((p) => {
                  const stock = sealedStock.find((s) => s.product_id === p.id)
                  return (
                    <div key={p.id} className="row" style={{ justifyContent: 'space-between', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '10px 12px' }}>
                      <div>
                        <b className="small">{p.name}</b>
                        <div className="faint small">{stock?.quantity ?? 0} sealed</div>
                      </div>
                      <button className="small" disabled={busy === p.id} onClick={() => openSealedOne(p.id)}>OPEN 1</button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'revealing' && current && (
        <div
          className="po-stage"
          onClick={() => { if (remaining > 0) setRevealed((r) => (r.length < queue.length ? [...r, queue[r.length]] : r)) }}
        >
          <div className="po-reveal">
            <RevealCard card={current} className={hitClass(current)} />
            <div className="po-value">{fmtUsd(current.value)}</div>
            {current.variant && current.variant.startsWith('1stEdition') && (
              <div className="po-banner massive ghost-banner">👻 1ST EDITION GHOST PULL — {fmtUsd(current.value)}</div>
            )}
            {showHitBanner && !(current.variant && current.variant.startsWith('1stEdition')) && (
              <div className={`po-banner ${current.value >= 150 ? 'massive' : ''}`}>
                {current.value >= 150 ? '🔥 MASSIVE PULL' : current.value >= 60 ? '⭐ HUGE PULL' : '✨ HIT!'}
              </div>
            )}
          </div>
          <div className="po-progress">
            {queue.map((_, i) => (
              <span key={i} className={`dot ${i < revealed.length ? (queue[i].isHit ? 'hit-shown' : 'shown') : ''}`} />
            ))}
          </div>
          <div className="faint small">{remaining > 0 ? `${remaining} card${remaining > 1 ? 's' : ''} left — click to reveal faster` : 'session complete'}</div>
          <div className="po-actions">
            <button className="small" onClick={(e) => { e.stopPropagation(); setFast(true) }}>Skip animation</button>
            <button className="small ghost" onClick={(e) => { e.stopPropagation(); setRevealed(queue) }}>Reveal all</button>
          </div>
        </div>
      )}

      {phase === 'summary' && session && (
        <div className="po-stage">
          <div className="po-banner" style={{ fontSize: 20 }}>SESSION COMPLETE</div>
          <div className="row mt8" style={{ gap: 26, flexWrap: 'wrap', justifyContent: 'center' }}>
            <div className="right"><div className="faint small">CARDS PULLED</div><div className="po-value">{session.cards.length}</div></div>
            <div className="right"><div className="faint small">TOTAL PULL VALUE</div><div className="po-value" style={{ color: 'var(--yellow)' }}>{fmtUsd(session.totalValue)}</div></div>
            <div className="right"><div className="faint small">MONEY SPENT</div><div className="po-value">{fmtUsd(session.spent)}</div></div>
            <div className="right">
              <div className="faint small">PACK ROI</div>
              <div className="po-value" style={{ color: (roi ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {roi == null ? '—' : `${roi >= 0 ? '+' : ''}${(roi * 100).toFixed(0)}%`}
              </div>
            </div>
          </div>
          <div className="po-summary-grid mt14">
            {session.cards.map((c, i) => (
              <SummaryCell key={i} card={c} />
            ))}
          </div>
          <div className="po-actions">
            <button className="primary" onClick={() => { setPhase('idle'); setSession(null) }}>OPEN MORE</button>
            <button onClick={() => (window.location.hash = '#/pulls-history')}>View pull history</button>
            <button className="ghost" onClick={() => (window.location.hash = '#/collection')}>See it in your collection</button>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCell({ card }: { card: OpenedCard }) {
  const src = useCardImage(card.cardId)
  return (
    <div className="po-summary-cell">
      {card.variant && card.variant.startsWith('1stEdition') && <span className="ghost-tag">1st</span>}
      <CardImg src={src} alt="" />
      <div className="val">{card.isHit ? 'HIT · ' : ''}{fmtUsd(card.value)}</div>
    </div>
  )
}
