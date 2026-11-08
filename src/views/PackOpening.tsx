import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { CardImg, EmptyState, fmtUsd, TearPack, glowClass, packHue } from '../components'
// The official Pokémon card back, bundled into the build (no network, works
// in the packaged exe) — every reveal turns from this print.
import cardBack from '../assets/card-back.png'
import { takeOpeningHandoff } from '../store'
import { flipSwish, hitStinger } from '../audio'
import type { BoxOpen, BoxPromo, OpenSession, OpenedCard, ProductRow } from '../types'

type Phase = 'idle' | 'promo' | 'pack' | 'revealing' | 'summary'
type Stage = 'hold' | 'flip' | 'landed' // where the card on stage is in its ceremony
type Tier = 'common' | 'super' | 'epic' | 'massive' | 'ghost'

// Ceremony timing per tier (ms): the back swings in and holds its breath
// (hold), turns over (flip), then sits with its value while the beat lands
// (beat) before the next card. Big pulls hold longer on purpose — the
// anticipation IS the pull.
const TIMING: Record<Tier, { hold: number; flip: number; beat: number }> = {
  common: { hold: 400, flip: 460, beat: 480 },
  super: { hold: 650, flip: 560, beat: 700 },
  epic: { hold: 1000, flip: 660, beat: 1050 },
  massive: { hold: 1250, flip: 740, beat: 1300 },
  ghost: { hold: 1250, flip: 740, beat: 1300 },
}
const FAST_TIMING = { hold: 60, flip: 160, beat: 160 }

function tierOf(card: OpenedCard): Tier {
  if (card.variant && card.variant.startsWith('1stEdition')) return 'ghost'
  if (card.value >= 150) return 'massive'
  if (card.value >= 60 || (card.isHit && card.value >= 40)) return 'epic'
  if (card.isHit || card.value >= 8) return 'super'
  return 'common'
}

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

function CountUp({ value, dur }: { value: number; dur: number }) {
  const [n, setN] = useState(dur <= 0 ? value : 0)
  useEffect(() => {
    if (dur <= 0) { setN(value); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      setN(value * (1 - Math.pow(1 - p, 3))) // ease-out: races up, settles soft
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, dur])
  return <>{fmtUsd(n)}</>
}

function RevealCard({ card, tier, stage, fast, hold, flip, hue }: {
  card: OpenedCard
  tier: Tier
  stage: Stage
  fast: boolean
  hold: number
  flip: number
  hue: number
}) {
  const src = useCardImage(card.cardId)
  const flipped = stage === 'flip' || stage === 'landed'
  const big = tier === 'epic' || tier === 'massive' || tier === 'ghost'
  const glowy = big || tier === 'super'
  return (
    <div
      className={`po-flip-wrap ${flipped ? 'flipped' : ''} ${fast ? 'snap' : ''}`}
      data-tier={tier}
      style={{
        '--bh': hue,
        '--swing': '360ms',
        '--hold': `${Math.max(120, hold - 360)}ms`,
        '--flipdur': `${flip}ms`,
      } as CSSProperties}
    >
      {glowy && <div className="po-aura" aria-hidden />}
      {big && <div className="po-rays" aria-hidden />}
      <div className="po-flipper">
        <div className="po-face po-back po-back-real">
          <img className="po-back-art" src={cardBack} alt="" />
        </div>
        <div className="po-face po-front">
          <CardImg src={src} alt={card.cardId} cardId={card.cardId} variant={card.variant} rarity={card.rarity} />
        </div>
      </div>
      {stage === 'landed' && big && <div className="po-flash" aria-hidden />}
      {stage === 'landed' && big && <div className="po-sheen" aria-hidden />}
      {stage === 'landed' && card.isNew && <div className="po-new-tag">✨ NEW</div>}
    </div>
  )
}



// ---------------------------------------------------------------------------

export function PackOpeningView() {
  const { toast, refreshState } = useStore()
  const [products, setProducts] = useState<ProductRow[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [queue, setQueue] = useState<OpenedCard[]>([])
  const [idx, setIdx] = useState(0) // card currently on stage
  const [stage, setStage] = useState<Stage>('hold')
  const stungRef = useRef(-1) // last idx whose landing played its stinger
  // The back's face: the pack's hue, kept for the whole ceremony (the card
  // back itself is the official Pokémon print; the hue drives aura/glow).
  const [backArt, setBackArt] = useState<{ hue: number }>({ hue: 215 })
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true, [])
  const [session, setSession] = useState<OpenSession | null>(null)
  const [fast, setFast] = useState(false)
  // The summary binder pages 40 pulls at a time: a 36-pack box is 360 cards,
  // and a 360-cell grid is a wall, not a keepsake page.
  const [page, setPage] = useState(0)
  const [sealedStock, setSealedStock] = useState<{ product_id: string; quantity: number }[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  // The tear-open ceremony: the pack exists on screen first — hold and pull
  // down (or press Enter) to rip the foil, then the card reveal begins.
  const [pendingPack, setPendingPack] = useState<{ key: string; name: string; sub: string; cards: number; spent: number; symbol: string | null; image: string | null } | null>(null)
  const [wantAuto, setWantAuto] = useState(false)
  // A box (bundle/ETB/display) opens one wrapper at a time: every pack is its
  // own tear and its own reveal, and the summary asks before the next one.
  const [box, setBox] = useState<{ boxId: number; productId: string; productName: string; packsTotal: number; packsLeft: number; packIndex: number } | null>(null)
  // The promo that shipped in the box, shown before a single wrapper opens.
  const [promo, setPromo] = useState<BoxPromo | null>(null)
  const [promoThen, setPromoThen] = useState<{ s: OpenSession; product?: ProductRow; prevBest: number; prevPack: number } | null>(null)
  const [boxTotals, setBoxTotals] = useState<{ cards: number; value: number; spent: number } | null>(null)
  // Boxes left half-open (a reload, a closed tab) are listed so the ceremony
  // can pick the box back up at the next wrapper instead of stranding it.
  const [openBoxList, setOpenBoxList] = useState<{ id: number; product_id: string; packs_left: number; packs_total: number; name: string | null }[]>([])

  const loadBoxes = useCallback(() => {
    api.openBoxes().then(setOpenBoxList).catch(() => {})
  }, [])
  // The record chase: when a pack beats your best pull on record, the screen
  // edges catch fire and the summary wears the crown. previousBest is the
  // record *before* this session (fetched when the ceremony begins), so the
  // comparison is fair even though the server has already written the pulls.
  const [previousBest, setPreviousBest] = useState(0)
  const [record, setRecord] = useState<{ cardId: string; value: number } | null>(null)
  // The second chase: best single-PACK total (the whole rip's worth, not one
  // card). Same fairness rule as the card record — the bar is the value
  // BEFORE this session existed.
  const [prevBestPack, setPrevBestPack] = useState(0)
  // Pack Shop handoff, captured into state on mount: state survives React
  // StrictMode's double effect-invoke, a module slot does not — the first
  // effect run would otherwise consume the handoff and be thrown away.
  const [handoff, setHandoff] = useState<import('../store').OpeningHandoff | null>(null)

  const loadSealed = useCallback(() => {
    api.pullsSummary().then((r) => {
      setSealedStock((r.sealedInStock as { product_id: string; quantity: number }[]) ?? [])
    }).catch(() => {})
  }, [])

  // The product list is a 250 KB payload that arrives asynchronously. The
  // ceremony used to read it straight from state, so a fast open (the Pack
  // Shop handoff resolves before the fetch) found no product and fell back to
  // a generic "Booster pack" with no wrapper art. Everyone waits for it now.
  const productsReq = useRef<Promise<ProductRow[]> | null>(null)
  const productsRef = useRef<ProductRow[]>([])
  const ensureProducts = useCallback((): Promise<ProductRow[]> => {
    if (productsReq.current) return productsReq.current
    const req = api.products()
      .then((rows) => { productsRef.current = rows; setProducts(rows); return rows })
      .catch((e) => { productsReq.current = null; throw e })
    productsReq.current = req
    return req
  }, [])

  useEffect(() => {
    ensureProducts().catch(() => {})
    loadSealed()
    loadBoxes()
    const h = takeOpeningHandoff()
    if (h) setHandoff(h)
  }, [ensureProducts, loadSealed])

  // Pack Shop handoff: the purchase already happened (and wrote pull
  // history), so fetch both record bars now — this is the honest "before"
  // for any record this session set — then run the ceremony.
  useEffect(() => {
    if (!handoff) return
    api.pullsBest().then((best) => {
      beginCeremony(handoff.session, handoff.productId, best.value, best.bestPackTotal ?? 0)
    }).catch(() => beginCeremony(handoff.session, handoff.productId, 0, 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff])

  const beginCeremony = (s: OpenSession, productId: string | undefined, prevBest = 0, prevPack = 0) => {
    ensureProducts()
      .catch(() => products) // a failed fetch must not block the rip itself
      .then((rows) => {
        const product = rows.find((x) => x.id === productId)
        const asBox = s as OpenSession & Partial<BoxOpen>
        // A handoff from the Pack Shop or Inventory is a whole box with
        // wrappers still inside it — open it pack by pack.
        if (asBox.boxId && asBox.packsTotal) beginBox(asBox as BoxOpen, product, prevBest, prevPack)
        else runCeremony(s, product, prevBest, prevPack)
      })
  }

  const runCeremony = (s: OpenSession, product?: ProductRow, prevBest = 0, prevPack = 0) => {
    setSession(s)
    setQueue(s.cards)
    setIdx(0)
    setStage('hold')
    stungRef.current = -1
    // The record chase: the caller fetched the all-time best BEFORE opening
    // (the server writes this session's pulls during the open call, so any
    // later fetch would already include them and the comparison would lie).
    setPreviousBest(prevBest)
    setPrevBestPack(prevPack ?? 0)
    setRecord(null)
    setPage(0)
    const first = s.cards[0]
    const setName = product?.set_name ?? first?.setName ?? 'Booster pack'
    // What comes off is a PACK: an ETB hands you nine booster wrappers, so the
    // stage wears the set's booster art and the booster's name, never the tin.
    // A single-wrapper product (the General Mills mini packs ship one three-card
    // pack) is not a box, so it keeps its own name rather than the booster's.
    const catalog = productsRef.current.length > 0 ? productsRef.current : products
    const booster = product && product.kind !== 'booster' && product.packs > 1
      ? catalog.find((p) => p.set_id === product.set_id && p.kind === 'booster')
      : undefined
    const face = booster ?? product
    setBackArt({ hue: packHue(face?.name ?? setName) })
    const asBox = s as OpenSession & Partial<BoxOpen>
    const packNo = asBox.packIndex ?? 1
    const packTotal = asBox.packsTotal ?? 1
    setPendingPack({
      key: s.sessionId,
      name: face?.name ?? `${setName} Booster Pack`,
      sub: packTotal > 1 ? `${setName} · pack ${packNo} of ${packTotal} · ${s.cards.length} cards` : `${setName} · ${s.cards.length} cards`,
      cards: s.cards.length,
      spent: s.spent,
      symbol: face?.set_symbol ?? product?.set_symbol ?? null,
      image: face?.image_url ?? null,
    })
    setWantAuto(false)
    setPhase('pack')
    refreshState()
  }

  // A box opens one wrapper at a time. The promo (when the product ships one)
  // is shown first — it is already in your binder, because it was in the box.
  const beginBox = (res: BoxOpen, product: ProductRow | undefined, prevBest: number, prevPack: number) => {
    setBox({
      boxId: res.boxId,
      productId: res.productId,
      productName: res.productName,
      packsTotal: res.packsTotal,
      packsLeft: res.packsLeft,
      packIndex: res.packIndex,
    })
    setBoxTotals((t) => ({ cards: (t?.cards ?? 0) + res.cards.length, value: (t?.value ?? 0) + res.totalValue, spent: (t?.spent ?? 0) + res.spent }))
    if (res.promo) {
      setPromo(res.promo)
      setPromoThen({ s: res, product, prevBest, prevPack })
      setPhase('promo')
      return
    }
    runCeremony(res, product, prevBest, prevPack)
  }

  const openNextPack = async () => {
    if (!box || busy) return
    setBusy('next')
    try {
      const res = await api.openBoxNext(box.boxId)
      setBox({ ...box, packsLeft: res.packsLeft, packIndex: res.packIndex })
      setBoxTotals((t) => ({ cards: (t?.cards ?? 0) + res.cards.length, value: (t?.value ?? 0) + res.totalValue, spent: (t?.spent ?? 0) + res.spent }))
      ensureProducts().catch(() => products).then((rows) => {
        runCeremony(res, rows.find((x) => x.id === res.productId), previousBest, prevBestPack)
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not open the next pack', 'bad')
    } finally {
      setBusy(null)
    }
  }

  const resumeBox = async (b: { id: number; product_id: string; packs_left: number; packs_total: number; name: string | null }) => {
    if (busy) return
    setBusy('resume')
    try {
      const res = await api.openBoxNext(b.id)
      setBox({
        boxId: res.boxId,
        productId: res.productId,
        productName: res.productName,
        packsTotal: res.packsTotal,
        packsLeft: res.packsLeft,
        packIndex: res.packIndex,
      })
      setBoxTotals({ cards: res.cards.length, value: res.totalValue, spent: res.spent })
      setPromo(null)
      setPromoThen(null)
      ensureProducts().catch(() => products).then((rows) => {
        runCeremony(res, rows.find((x) => x.id === res.productId), previousBest, prevBestPack)
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not reopen that box', 'bad')
      loadBoxes()
    } finally {
      setBusy(null)
    }
  }

  const dismissPromo = () => {
    const p = promoThen
    setPromo(null)
    setPromoThen(null)
    if (p) runCeremony(p.s, p.product, p.prevBest, p.prevPack)
  }

  // Did this session's best beat the pre-session record?
  const sessionBest = useMemo(() => session?.cards.reduce((a, c) => (c.value > a.value ? c : a), session.cards[0]) ?? null, [session])
  const isRecord = !!sessionBest && sessionBest.value > previousBest && previousBest > 0

  // The shared TearPack fires onTorn the moment the rip completes; hold the
  // stage ~760ms so the flash and falling foil shards play out, then the
  // first card back swings in.
  const finishTear = useCallback(() => {
    setTimeout(() => {
      setPendingPack(null)
      setPhase('revealing')
    }, 760)
  }, [])

  const startSession = async (productId: string, qty: number) => {
    setBusy(productId)
    try {
      const best = await api.pullsBest().catch(() => ({ value: 0, bestPackTotal: 0 }))
      const buy = await api.buyProduct(productId, qty, false)
      if (!buy.ok) { toast('Purchase failed', 'bad'); return }
      // The box comes off the shelf here. A bundle is 6 separate rips, an ETB
      // 9, a display 36 — the ceremony opens them one at a time.
      const first = await api.openBox(productId)
      ensureProducts().catch(() => products).then((rows) => {
        beginBox(first, rows.find((x) => x.id === productId), best.value, best.bestPackTotal ?? 0)
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Open failed', 'bad')
    } finally {
      setBusy(null)
    }
  }

  const openSealedOne = async (productId: string) => {
    setBusy(productId)
    try {
      const best = await api.pullsBest().catch(() => ({ value: 0, bestPackTotal: 0 }))
      const first = await api.openBox(productId)
      ensureProducts().catch(() => products).then((rows) => {
        beginBox(first, rows.find((x) => x.id === productId), best.value, best.bestPackTotal ?? 0)
      })
      loadSealed()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Open failed', 'bad')
    } finally {
      setBusy(null)
    }
  }

  // The card on stage: where it is in its ceremony, and how long this tier
  // takes. Big pulls hold longer on purpose — the anticipation IS the pull.
  const current = phase === 'revealing' ? queue[idx] : undefined
  const tier: Tier = current ? tierOf(current) : 'common'
  const timing = fast || reduced ? FAST_TIMING : TIMING[tier]
  const landed = stage === 'landed'
  const showHitBanner = Boolean(landed && current && (current.isHit || current.value >= 40))
  const remaining = queue.length - idx - (landed ? 1 : 0)

  // Stage machine: back swings in → turns over → lands with its value, then
  // a beat, then the next card (or the summary). Timers restart whenever the
  // player clicks (advance) or toggles Skip — nothing can desync the card
  // you're looking at from the timer driving it.
  useEffect(() => {
    if (phase !== 'revealing') return
    if (!queue[idx]) {
      const t = setTimeout(() => setPhase('summary'), 400)
      return () => clearTimeout(t)
    }
    if (stage === 'hold') {
      const t = setTimeout(() => setStage('flip'), timing.hold)
      return () => clearTimeout(t)
    }
    if (stage === 'flip') {
      const t = setTimeout(() => setStage('landed'), timing.flip)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      if (idx >= queue.length - 1) setPhase('summary')
      else { setIdx((i) => i + 1); setStage('hold') }
    }, timing.beat)
    return () => clearTimeout(t)
  }, [phase, stage, idx, queue, timing])

  // The turn-over swish: exactly when the card starts flipping.
  // Every phase starts at the top of the stage. Without this the pane keeps
  // the previous screen's scroll — a 360-card summary leaves you thousands of
  // pixels down, staring at the empty middle of the next pack's stage.
  useEffect(() => {
    const pane = document.querySelector('.content')
    if (pane) pane.scrollTop = 0
    window.scrollTo(0, 0)
  }, [phase])

  useEffect(() => {
    if (phase !== 'revealing' || stage !== 'flip') return
    const c = queue[idx]
    if (!c) return
    const t = tierOf(c)
    flipSwish(t === 'epic' || t === 'massive' || t === 'ghost')
  }, [phase, stage, idx, queue])

  // Landings: the stinger fires when a card's face lands, scaled to the pull.
  // Skipped reveals land as one jump — play only the best of the batch so it
  // doesn't turn into one long blast. The record banner rides the same moment
  // (a record pull is definitionally $150+ territory or a first-hit).
  useEffect(() => {
    if (phase !== 'revealing' || stage !== 'landed' || idx <= stungRef.current) return
    const batch = queue.slice(stungRef.current + 1, idx + 1)
    stungRef.current = idx
    if (batch.length === 0) return
    const best = batch.reduce((a, c) => (c.value > a.value ? c : a), batch[0])
    hitStinger(best.value, best.isHit)
    if (previousBest > 0 && !record && best.value > previousBest) setRecord({ cardId: best.cardId, value: best.value })
  }, [phase, stage, idx, queue, previousBest, record])

  // Click anywhere on the stage to walk the ceremony faster: hold → flip →
  // land → next card. A landed last card pushes straight to the summary.
  const advance = () => {
    if (phase !== 'revealing' || !queue[idx]) return
    if (stage === 'hold') setStage('flip')
    else if (stage === 'flip') setStage('landed')
    else if (idx < queue.length - 1) { setIdx((i) => i + 1); setStage('hold') }
    else setPhase('summary')
  }
  const revealAll = () => {
    if (queue.length === 0) return
    setIdx(queue.length - 1)
    setStage('landed')
  }

  const roi = useMemo(() => {
    if (!session || session.spent === 0) return null
    return session.totalValue / session.spent - 1
  }, [session])

  // Summary-facing record state: true when this session's best beats the
  // pre-session record (the server has already counted this session's pulls,
  // so previousBest is the honest "before" number).
  const beatRecord = !!session && !!sessionBest && sessionBest.value > previousBest && previousBest > 0
  // Second chase: this rip's best SINGLE PACK beats the pre-session
  // pack-total record. For boxes (bundle/ETB/display) the session total spans
  // many packs, so the honest number is the best per-pack session the server
  // reported — a 6-pack box shouldn't fake-beat a single-pack record.
  const bestPackOfSession = useMemo(() => {
    if (!session) return 0
    const per = (session as OpenSession & { perPack?: { totalValue: number }[] }).perPack
    if (per && per.length > 0) return Math.max(...per.map((p) => p.totalValue))
    return session.totalValue
  }, [session])
  const beatPackRecord = !!session && prevBestPack > 0 && bestPackOfSession > prevBestPack
  // How many of this rip's pulls you didn't own a single copy of before it.
  const newCount = session?.cards.filter((c) => c.isNew).length ?? 0

  const sealedProducts = products.filter((p) => sealedStock.some((s) => s.product_id === p.id))

  return (
    <div className={glowClass(beatRecord, beatPackRecord)}>
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

      {record && (
        <div className="po-banner massive" style={{ marginBottom: 12 }}>👑 NEW BEST PULL — {fmtUsd(record.value)}!</div>
      )}

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

          {openBoxList.length > 0 && (
            <div className="panel mb14">
              <h2>Boxes in progress</h2>
              <div className="faint small" style={{ marginBottom: 8 }}>
                A box opens one wrapper at a time — these still have packs inside.
              </div>
              {openBoxList.map((b) => (
                <div key={b.id} className="row" style={{ justifyContent: 'space-between', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '10px 12px', marginTop: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <b className="small">{b.name ?? b.product_id}</b>
                    <div className="faint small">{b.packs_left} of {b.packs_total} packs left</div>
                  </div>
                  <button className="primary small" disabled={busy === 'resume'} onClick={() => resumeBox(b)}>
                    {busy === 'resume' ? 'OPENING…' : 'CONTINUE'}
                  </button>
                </div>
              ))}
            </div>
          )}

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

      {phase === 'promo' && promo && (
        <div className="po-stage po-stage-summary">
          <div className="po-banner">★ PROMO — SEALED IN THE BOX</div>
          <div className="faint small" style={{ maxWidth: 330, margin: '2px auto 12px', lineHeight: 1.5 }}>
            {box?.productName ?? 'This product'} ships with {promo.name} in the box beside the packs.
            It is already in your binder — the wrappers come next.
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <PromoCell cardId={promo.cardId} value={promo.value} />
          </div>
          <div className="po-actions">
            <button className="primary" onClick={dismissPromo}>
              OPEN PACK 1 OF {box?.packsTotal ?? 1}
            </button>
          </div>
        </div>
      )}

      {phase === 'pack' && pendingPack && (
        <div className="po-stage po-pack-stage" style={{ '--bh': backArt.hue } as CSSProperties}>
          <div className="po-room" aria-hidden>
            <div className="po-dust">
              {Array.from({ length: 12 }).map((_, i) => <i key={i} style={{ '--d': i } as CSSProperties} />)}
            </div>
          </div>
          <div className="po-pack-pill">Sealed · {pendingPack.name}</div>
          <div className="po-pack-hero">
            <TearPack
              /* Key by the pack: without a remount the tear state survived from
                 the previous rip, so the next wrapper arrived already cut open. */
              key={pendingPack.key}
              symbolUrl={pendingPack.symbol}
              imageUrl={pendingPack.image}
              name={pendingPack.name}
              sub={pendingPack.sub}
              onTorn={finishTear}
              /* Only the explicit "Tear it open" button or Enter auto-rips. Fast
                 mode is about card reveals, not about skipping the pack —
                 binding it here auto-opened every pack for anyone who had ever
                 pressed Skip animation, so the wrapper arrived already cut. */
              autoRip={wantAuto}
              globalEnter
            />
            <div className="po-pack-reflect" aria-hidden />
          </div>
          <div className="po-pack-hint">Swipe across the cut, left to right — or press Enter</div>
          <div className="faint small">{pendingPack.cards} cards inside — {fmtUsd(pendingPack.spent)}</div>
          <div className="po-actions">
            <button className="small btn-red" onClick={(e) => { e.stopPropagation(); setWantAuto(true) }}>Tear it open</button>
          </div>
        </div>
      )}

      {phase === 'revealing' && current && (
        <div className="po-stage" data-tier={tier} onClick={advance}>
          <div className="po-room" aria-hidden>
            <div className="po-dust">
              {Array.from({ length: 14 }).map((_, i) => <i key={i} style={{ '--d': i } as CSSProperties} />)}
            </div>
          </div>
          <div className="po-reveal">
            {/* The rest of the pack, fanned behind the card on stage — you can
                see how much is left in your hand, not just a dot count. */}
            <div className="po-deck" aria-hidden>
              {Array.from({ length: Math.min(4, Math.max(0, queue.length - idx - 1)) }).map((_, i) => (
                <span key={i} style={{ '--k': i } as CSSProperties} />
              ))}
            </div>
            <RevealCard
              key={idx}
              card={current}
              tier={tier}
              stage={stage}
              fast={fast || reduced}
              hold={timing.hold}
              flip={timing.flip}
              hue={backArt.hue}
            />
            {landed && (
              <div className="po-value">
                <CountUp value={current.value} dur={fast || reduced ? 0 : Math.min(900, timing.beat)} />
              </div>
            )}
            {landed && current.variant && current.variant.startsWith('1stEdition') && (
              <div className="po-banner massive ghost-banner">👻 1ST EDITION GHOST PULL — {fmtUsd(current.value)}</div>
            )}
            {showHitBanner && !(current.variant && current.variant.startsWith('1stEdition')) && (
              <div className={`po-banner ${current.value >= 150 ? 'massive' : ''}`}>
                {current.value >= 150 ? '🔥 MASSIVE PULL' : current.value >= 60 ? '⭐ HUGE PULL' : '✨ HIT!'}
              </div>
            )}
            {landed && tier !== 'common' && <div className="po-shock" data-tier={tier} aria-hidden />}
          </div>
          <div className="po-progress">
            {queue.map((_, i) => (
              <span key={i} className={`dot ${i < idx || (i === idx && landed) ? (queue[i].isHit ? 'hit-shown' : 'shown') : ''}`} />
            ))}
          </div>
          <div className="faint small">{remaining > 0 ? `${remaining} card${remaining > 1 ? 's' : ''} left — click to reveal faster` : landed ? 'session complete' : ''}</div>
          <div className="po-actions">
            <button className="small" onClick={(e) => { e.stopPropagation(); setFast(true) }}>Skip animation</button>
            <button className="small ghost" onClick={(e) => { e.stopPropagation(); revealAll() }}>Reveal all</button>
          </div>
        </div>
      )}

      {phase === 'summary' && session && (
        <div className="po-stage po-stage-summary">
          <div className="po-banner" style={{ fontSize: 20 }}>
            {box ? `PACK ${box.packIndex} OF ${box.packsTotal} OPEN` : 'SESSION COMPLETE'}
          </div>
          {box && boxTotals && (
            <div className="faint small" style={{ marginBottom: 8 }}>
              {box.productName} · {boxTotals.cards} cards so far · {fmtUsd(boxTotals.value)} out of {fmtUsd(boxTotals.spent)}
            </div>
          )}
          {beatPackRecord && (
            <div className="po-banner massive pack-record-banner" style={{ marginBottom: 6 }}>📦 BEST PACK EVER — {fmtUsd(bestPackOfSession)}!</div>
          )}
          <div className="row mt8" style={{ gap: 26, flexWrap: 'wrap', justifyContent: 'center' }}>
            <div className="right"><div className="faint small">CARDS PULLED</div><div className="po-value">{session.cards.length}</div></div>
            {newCount > 0 && (
              <div className="right"><div className="faint small">NEW TO BINDER</div><div className="po-value" style={{ color: 'var(--green)' }}>✨ {newCount}</div></div>
            )}
            <div className="right"><div className="faint small">TOTAL PULL VALUE</div><div className="po-value" style={{ color: 'var(--yellow)' }}><CountUp value={session.totalValue} dur={fast || reduced ? 0 : 900} /></div></div>
            <div className="right"><div className="faint small">MONEY SPENT</div><div className="po-value">{fmtUsd(session.spent)}</div></div>
            {beatRecord && (
              <div className="right"><div className="faint small">PREVIOUS BEST</div><div className="po-value" style={{ textDecoration: 'line-through', opacity: 0.65 }}>{fmtUsd(previousBest)}</div></div>
            )}
            {beatPackRecord && (
              <div className="right"><div className="faint small">BEST PACK BEFORE</div><div className="po-value" style={{ textDecoration: 'line-through', opacity: 0.65 }}>{fmtUsd(prevBestPack)}</div></div>
            )}
            {!beatPackRecord && prevBestPack > 0 && (
              <div className="right"><div className="faint small">BEST PACK ON RECORD</div><div className="po-value" style={{ opacity: 0.85 }}>{fmtUsd(prevBestPack)}</div></div>
            )}
            <div className="right">
              <div className="faint small">PACK ROI</div>
              <div className="po-value" style={{ color: (roi ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {roi == null ? '—' : `${roi >= 0 ? '+' : ''}${(roi * 100).toFixed(0)}%`}
              </div>
            </div>
          </div>
          {/* The pulls come off the table and into sleeves: the summary is the
              page you just filled, not a spreadsheet of the rip. */}
          <div className="po-binder">
            <div className="po-summary-grid">
            {session.cards.slice(page * 40, page * 40 + 40).map((c, i) => (
              <SummaryCell
                key={page * 40 + i}
                card={c}
                index={i}
                fast={fast || reduced}
                record={beatRecord && sessionBest != null && c.cardId === sessionBest.cardId && c.value === sessionBest.value}
              />
            ))}
            </div>
            <div className="po-binder-foot">
              Pulls · page {page + 1} of {Math.max(1, Math.ceil(session.cards.length / 40))} · {session.cards.length} cards
            </div>
            {session.cards.length > 40 && (
              <div className="po-binder-nav">
                <button className="ghost small" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Prev page</button>
                <button className="ghost small" disabled={(page + 1) * 40 >= session.cards.length} onClick={() => setPage((p) => p + 1)}>Next page →</button>
              </div>
            )}
          </div>
          <div className="po-actions">
            {box && box.packsLeft === 0 && <button className="ghost" onClick={loadBoxes}>Refresh boxes</button>}
            {box && box.packsLeft > 0 ? (
              <button className="primary" disabled={busy === 'next'} onClick={openNextPack}>
                {busy === 'next' ? 'TEARING…' : `OPEN PACK ${box.packIndex + 1} OF ${box.packsTotal}`}
              </button>
            ) : (
              <button className="primary" onClick={() => { setPhase('idle'); setSession(null); setBox(null); setPromo(null); setBoxTotals(null) }}>OPEN MORE</button>
            )}
            <button className="btn-blue" onClick={() => (window.location.hash = '#/pulls-history')}>View pull history</button>
            <button className="ghost" onClick={() => (window.location.hash = '#/collection')}>See it in your collection</button>
          </div>
        </div>
      )}
    </div>
  )
}

function PromoCell({ cardId, value }: { cardId: string; value: number }) {
  const src = useCardImage(cardId)
  return (
    <div className="po-summary-cell promo-cell">
      <span className="promo-tag">★ PROMO</span>
      <CardImg src={src} alt={cardId} cardId={cardId} />
      <div className="val">{fmtUsd(value)}</div>
    </div>
  )
}

function SummaryCell({ card, index = 0, fast = false, record }: { card: OpenedCard; index?: number; fast?: boolean; record?: boolean }) {
  const src = useCardImage(card.cardId)
  return (
    <div
      className={`po-summary-cell ${record ? 'record-cell' : ''}`}
      title={record ? 'Your best pull on record' : undefined}
      style={{ '--i': index, '--sd': fast ? '0ms' : undefined } as CSSProperties}
    >
      {record && <span className="record-tag">👑 BEST</span>}
      {card.isNew && <span className="new-tag">✨ NEW</span>}
      {card.variant && card.variant.startsWith('1stEdition') && <span className="ghost-tag">1st</span>}
      <CardImg src={src} alt={card.cardId} cardId={card.cardId} variant={card.variant} rarity={card.rarity} />
      <div className="val">{card.isHit ? 'HIT · ' : ''}{fmtUsd(card.value)}</div>
    </div>
  )
}
