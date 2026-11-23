import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
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
type SummaryPack = { packIndex: number; cards: OpenedCard[] }
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
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef(false)
  // The back's face: the pack's hue, kept for the whole ceremony (the card
  // back itself is the official Pokémon print; the hue drives aura/glow).
  const [backArt, setBackArt] = useState<{ hue: number }>({ hue: 215 })
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true, [])
  const [session, setSession] = useState<OpenSession | null>(null)
  const [fast, setFast] = useState(false)
  // Manual is the default: a landed card waits for the player. Auto schedules
  // the next card after the usual beat, for a hands-off rip.
  const [autoReveal, setAutoReveal] = useState(false)
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
  const [promo, setPromo] = useState<BoxPromo[]>([])
  const [promoThen, setPromoThen] = useState<{ s: OpenSession; product?: ProductRow; prevBest: number; prevPack: number } | null>(null)
  const [boxTotals, setBoxTotals] = useState<{ cards: number; value: number; spent: number } | null>(null)
  // Every pull and every wrapper value already opened in this box. The summary
  // normally shows only the current pack; skipping to the end combines these
  // with the remaining packs so the final page holds the whole box.
  const [boxPulls, setBoxPulls] = useState<OpenedCard[]>([])
  const [boxPackValues, setBoxPackValues] = useState<number[]>([])
  // The combined summary groups cards by the wrapper they came out of. Keep
  // the cards per wrapper as the ceremony opens them; openBoxRest already
  // returns the remaining wrappers grouped, so a skip can join the two.
  const [boxPackCards, setBoxPackCards] = useState<SummaryPack[]>([])
  // The combined summary shows one wrapper at a time: opening a pack folds
  // the previous one, so a long box reads as a list of packs rather than a
  // 360-card wall. Remember the choice per page, so paging away and back
  // returns to the wrapper you were reading instead of the first one.
  const [openPacksByPage, setOpenPacksByPage] = useState<Record<number, number[]>>({})
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
  // The highest record this BOX has already crowned. A box opens wrapper by
  // wrapper against the pre-box bar, so without this a $15 card in pack 4
  // would "set a record" the box broke in pack 1 with a $900 pull.
  const [boxRecord, setBoxRecord] = useState(0)
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

  // Inventory → Sealed handoff: the pack was already ripped server-side (its
  // pulls are in pull_history), so the record is read EXCLUDING this session.
  // A plain read here returns the new record as the bar to beat, which no
  // pull can ever clear — that was the whole broken chase.
  useEffect(() => {
    if (!handoff) return
    api.pullsBest(handoff.session.sessionId).then((best) => {
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
    setOpenPacksByPage({})
    const first = s.cards[0]
    const setName = product?.set_name ?? first?.setName ?? 'Booster pack'
    // What comes off is a PACK: an ETB hands you nine booster wrappers, so the
    // stage wears the set's booster art and the booster's name, never the tin.
    // A single-wrapper product (the General Mills mini packs ship one three-card
    // pack) is not a box, so it keeps its own name rather than the booster's.
    const catalog = productsRef.current.length > 0 ? productsRef.current : products
    const asBox = s as OpenSession & Partial<BoxOpen>
    // A mixed box can hand out a wrapper from another expansion (the 30th UPC
    // closes on a Classic Collection pack), so that wrapper's own product — not
    // the box's anchor set — is the face on the stage.
    const wrapper = asBox.packSetId
      ? catalog.find((p) => p.set_id === asBox.packSetId && p.kind === 'booster')
      : undefined
    const booster = product && product.kind !== 'booster' && product.packs > 1
      ? catalog.find((p) => p.set_id === product.set_id && p.kind === 'booster')
      : undefined
    const face = wrapper ?? booster ?? product
    // An expansion the shop never sells (the Classic Collection pack inside the
    // 30th UPC) has no row in the product list, so the box reports its name,
    // symbol and wrapper photo itself.
    const wrapperName = asBox.packName ?? null
    const wrapperSymbol = asBox.packSymbol ?? null
    const wrapperArt = asBox.packArt ?? null
    setBackArt({ hue: packHue(wrapperName ?? face?.name ?? setName) })
    const packNo = asBox.packIndex ?? 1
    const packTotal = asBox.packsTotal ?? 1
    setPendingPack({
      key: s.sessionId,
      name: wrapperName ?? face?.name ?? `${setName} Booster Pack`,
      sub: packTotal > 1 ? `${setName} · pack ${packNo} of ${packTotal} · ${s.cards.length} cards` : `${setName} · ${s.cards.length} cards`,
      cards: s.cards.length,
      spent: s.spent,
      symbol: wrapperSymbol ?? face?.set_symbol ?? product?.set_symbol ?? null,
      // A wrapper the shop never sold carries its own photo from the box
      // response; only a wrapper with no photo at all (and no shelf row to look
      // one up in) falls back to the foil-and-symbol pack, never the box's art.
      image: wrapperArt ?? (wrapperName ? null : (face?.image_url ?? null)),
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
    setBoxPulls(res.cards)
    setBoxPackValues([res.totalValue])
    setBoxPackCards([{ packIndex: res.packIndex, cards: res.cards }])
    setBoxTotals({ cards: res.cards.length, value: res.totalValue, spent: res.spent })
    // The promo screen comes before the first reveal, but pack 1 is already in
    // this session. Record baselines must exist for a skip from that screen.
    setPreviousBest(prevBest)
    setPrevBestPack(prevPack)
    setRecord(null)
    setBoxRecord(0)
    const boxPromos = res.promos?.length ? res.promos : res.promo ? [res.promo] : []
    if (boxPromos.length > 0) {
      setPromo(boxPromos)
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
      setBoxPulls((pulls) => [...pulls, ...res.cards])
      setBoxPackValues((values) => [...values, res.totalValue])
      setBoxPackCards((packs) => [...packs, { packIndex: res.packIndex, cards: res.cards }])
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

  const skipRemainingPacks = async () => {
    // The promo screen has no runCeremony session yet, but its first pack was
    // already ripped by beginBox and sits in promoThen.s. The combined summary
    // can use that pack without putting it on stage first. A previous box can
    // leave a stale session in state, so promoThen decides which one is current.
    const fromPromo = !!promoThen
    const baseSession = promoThen?.s ?? session
    if (!box || box.packsLeft <= 0 || busy || !baseSession) return
    setBusy('skip')
    try {
      const res = await api.openBoxRest(box.boxId)
      const allCards = [...boxPulls, ...res.cards]
      const remainingValues = res.perPack?.map((p) => p.totalValue) ?? [res.totalValue]
      const allPackValues = [...boxPackValues, ...remainingValues]
      // openBoxRest returns the remaining wrappers in order. Its last packIndex
      // gives the first one, so a resumed box keeps the real pack numbers.
      const firstRemaining = res.packIndex - Math.max(1, res.perPack?.length ?? 1) + 1
      const remainingPacks: SummaryPack[] = res.perPack?.length
        ? res.perPack.map((p, i) => ({ packIndex: p.packIndex ?? firstRemaining + i, cards: p.cards ?? [] }))
        : [{ packIndex: res.packIndex, cards: res.cards }]
      const allPacks = [...boxPackCards, ...remainingPacks]
      const totalValue = Number(((boxTotals?.value ?? 0) + res.totalValue).toFixed(2))
      const spent = Number(((boxTotals?.spent ?? 0) + res.spent).toFixed(2))
      setBox({ ...box, packsLeft: 0, packIndex: res.packsTotal })
      setBoxTotals({ cards: allCards.length, value: totalValue, spent })
      setBoxPulls(allCards)
      setBoxPackValues(allPackValues)
      setBoxPackCards(allPacks)
      const bestPull = allCards.reduce((a, c) => (c.value > a.value ? c : a), allCards[0])
      const skipBar = Math.max(previousBest, boxRecord)
      if (bestPull && skipBar > 0 && bestPull.value > skipBar) {
        setRecord({ cardId: bestPull.cardId, value: bestPull.value })
        setBoxRecord((r) => Math.max(r, bestPull.value))
      }
      // The summary reads one session; give it the whole box rather than the
      // last wrapper, so the grid is every card pulled from every pack.
      const combined: OpenSession & { perPack: NonNullable<BoxOpen['perPack']> } = {
        ...baseSession,
        cards: allCards,
        totalValue,
        spent,
        perPack: allPacks.map((pack, i) => ({
          sessionId: '',
          cards: pack.cards,
          totalValue: allPackValues[i] ?? 0,
          spent: 0,
          packIndex: pack.packIndex,
        })),
      }
      setSession(combined)
      setQueue(allCards)
      setIdx(Math.max(0, allCards.length - 1))
      setStage('landed')
      setPage(0)
      setOpenPacksByPage({})
      if (fromPromo) {
        setPromo([])
        setPromoThen(null)
      }
      setPhase('summary')
      refreshState()
      loadBoxes()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not open the rest of the box', 'bad')
    } finally {
      setBusy(null)
    }
  }

  const resumeBox = async (b: { id: number; product_id: string; packs_left: number; packs_total: number; name: string | null }) => {
    if (busy) return
          setBusy('resume')
    try {
      const res = await api.openBoxNext(b.id)
      // Same honest-baseline rule as the handoff: this wrapper's cards are
      // already written, so the bar is everything except this session.
      const best = await api.pullsBest(res.sessionId).catch(() => ({ value: 0, bestPackTotal: 0 }))
      setBox({
        boxId: res.boxId,
        productId: res.productId,
        productName: res.productName,
        packsTotal: res.packsTotal,
        packsLeft: res.packsLeft,
        packIndex: res.packIndex,
      })
      setBoxTotals({ cards: res.cards.length, value: res.totalValue, spent: res.spent })
      setBoxPulls(res.cards)
      setBoxPackValues([res.totalValue])
      setBoxPackCards([{ packIndex: res.packIndex, cards: res.cards }])
      setPromo([])
      setPromoThen(null)
      ensureProducts().catch(() => products).then((rows) => {
        runCeremony(res, rows.find((x) => x.id === res.productId), best.value, best.bestPackTotal ?? 0)
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
    setPromo([])
    setPromoThen(null)
    if (p) runCeremony(p.s, p.product, p.prevBest, p.prevPack)
  }

  // Did this session's best beat the pre-session record?
  const sessionBest = useMemo(() => session?.cards.reduce((a, c) => (c.value > a.value ? c : a), session.cards[0]) ?? null, [session])

  // The shared TearPack fires onTorn the moment the rip completes; hold the
  // stage ~760ms so the flash and falling foil shards play out, then the
  // first card back swings in.
  const finishTear = useCallback(() => {
    setTimeout(() => {
      setPendingPack(null)
      setPhase('revealing')
    }, 760)
  }, [])

  const buySealed = async (productId: string, qty: number) => {
    setBusy(productId)
    try {
      const buy = await api.buyProduct(productId, qty)
      if (!buy.ok) { toast('Purchase failed', 'bad'); return }
      const product = productsRef.current.find((p) => p.id === productId)
      toast(`Added ${qty}× ${product?.name ?? 'product'} sealed — open it from Inventory → Sealed.`, 'good')
      loadSealed()
      refreshState()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Purchase failed', 'bad')
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

  // Stage machine: back swings in → turns over → lands with its value. In
  // Manual the landed card waits for a swipe or click; in Auto the next card
  // is scheduled after the usual beat.
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
    if (!autoReveal) return
    const t = setTimeout(() => {
      if (idx >= queue.length - 1) setPhase('summary')
      else { setIdx((i) => i + 1); setStage('hold') }
    }, timing.beat)
    return () => clearTimeout(t)
  }, [phase, stage, idx, queue, timing, autoReveal])

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
    // The bar rises as records fall: a card revealed after a smaller record
    // breaker upgrades the banner instead of being swallowed by the first
    // one, and nothing in a box can out-crown a bigger pull from the same box.
    const bar = Math.max(previousBest, boxRecord)
    if (bar > 0 && best.value > bar && best.value > (record?.value ?? 0)) {
      setRecord({ cardId: best.cardId, value: best.value })
      setBoxRecord((r) => Math.max(r, best.value))
    }
  }, [phase, stage, idx, queue, previousBest, record, boxRecord])

  // Click or swipe anywhere on the stage to walk the ceremony: hold → flip →
  // land → next card. A landed last card pushes straight to the summary.
  const advance = () => {
    if (phase !== 'revealing' || !queue[idx]) return
    if (stage === 'hold') setStage('flip')
    else if (stage === 'flip') setStage('landed')
    else if (idx < queue.length - 1) { setIdx((i) => i + 1); setStage('hold') }
    else setPhase('summary')
  }
  const startSwipe = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    swipeStart.current = { x: e.clientX, y: e.clientY }
  }
  const endSwipe = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < 45 || Math.abs(dx) <= Math.abs(dy)) return
    // A drag can still emit a click after pointerup; swallow that one so the
    // swipe advances exactly one step.
    suppressClick.current = true
    window.setTimeout(() => { suppressClick.current = false }, 350)
    advance()
  }
  const cancelSwipe = () => { swipeStart.current = null }
  const stageClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return }
    advance()
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
  const recordBar = Math.max(previousBest, boxRecord)
  const beatRecord = !!session && !!sessionBest && sessionBest.value > recordBar && recordBar > 0
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
  // The skip-to-end summary carries the cards inside each wrapper. Group only
  // when every wrapper is represented; otherwise keep the old flat page rather
  // than putting a pack label over cards that may not belong to it.
  const summaryPacks = useMemo<SummaryPack[]>(() => {
    if (!session) return []
    const per = (session as OpenSession & { perPack?: NonNullable<BoxOpen['perPack']> }).perPack
    if (!per?.length || per.some((p) => !p.cards?.length)) return []
    const groups = per.map((p, i) => ({ packIndex: p.packIndex ?? i + 1, cards: p.cards ?? [] }))
    return groups.reduce((n, g) => n + g.cards.length, 0) === session.cards.length ? groups : []
  }, [session])
  // Page by wrapper, not by card: a pack may not be cut in half between pages.
  const summaryPages = useMemo(() => {
    if (!summaryPacks.length) return [] as SummaryPack[][]
    const pages: SummaryPack[][] = []
    let current: SummaryPack[] = []
    let cards = 0
    for (const pack of summaryPacks) {
      if (current.length > 0 && cards + pack.cards.length > 40) {
        pages.push(current)
        current = []
        cards = 0
      }
      current.push(pack)
      cards += pack.cards.length
    }
    if (current.length) pages.push(current)
    return pages
  }, [summaryPacks])
  const pageCount = summaryPacks.length ? summaryPages.length : Math.max(1, Math.ceil((session?.cards.length ?? 0) / 40))
  const pageIndex = Math.min(page, Math.max(0, pageCount - 1))
  // A box summary is a running scoreboard, not just the last wrapper: count
  // every hit in every pack opened so far, including packs before this page.
  const boxHitCards = box ? boxPulls.filter((card) => card.isHit) : []
  const boxHits = boxHitCards.length
  const boxAvgHit = boxHits > 0
    ? boxHitCards.reduce((sum, card) => sum + card.value, 0) / boxHits
    : null
  const bestBoxHit = boxHitCards.reduce<OpenedCard | null>(
    (best, card) => !best || card.value > best.value ? card : best,
    null,
  )
  const bestBoxPack = boxPackValues.length > 0 ? Math.max(...boxPackValues) : 0
  const pagePacks = summaryPages[pageIndex] ?? []
  const openPacks = Object.prototype.hasOwnProperty.call(openPacksByPage, pageIndex)
    ? openPacksByPage[pageIndex]
    : pagePacks.length > 0 ? [pagePacks[0].packIndex] : []
  const allPacksOpen = pagePacks.length > 0 && pagePacks.every((pack) => openPacks.includes(pack.packIndex))
  const togglePack = (packIndex: number) => {
    setOpenPacksByPage((pages) => {
      const remembered = Object.prototype.hasOwnProperty.call(pages, pageIndex)
      const first = pagePacks[0]?.packIndex
      const current = remembered ? pages[pageIndex] : first == null ? [] : [first]
      const next = current.includes(packIndex)
        ? current.filter((index) => index !== packIndex)
        : remembered ? [...current, packIndex] : [packIndex]
      return { ...pages, [pageIndex]: next }
    })
  }
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
          <span className={`chip ${!autoReveal ? 'on' : ''}`} onClick={() => setAutoReveal(false)}>Manual reveal</span>
          <span className={`chip ${autoReveal ? 'on' : ''}`} onClick={() => setAutoReveal(true)}>Auto reveal</span>
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
            <h2>Buy sealed</h2>
            <div className="faint small" style={{ marginBottom: 8 }}>
              Purchases land in your sealed inventory. Open one here or in Inventory → Sealed whenever you choose.
            </div>
            <div className="grid cols2 mt8">
              {products.map((p) => (
                <div key={p.id} className="row" style={{ justifyContent: 'space-between', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '10px 12px' }}>
                  <div>
                    <b className="small">{p.name}</b>
                    <div className="faint small">
                      {fmtUsd(p.msrp)} · {p.packs} pack{p.packs > 1 ? 's' : ''}
                      {p.deal?.claimed ? ' · daily deal claimed today' : ''}
                    </div>
                  </div>
                  <button
                    className="primary small"
                    disabled={busy === p.id || p.deal?.claimed}
                    title={p.deal?.claimed ? 'Daily deal claimed for this game day' : undefined}
                    onClick={() => buySealed(p.id, 1)}
                  >
                    {p.deal?.claimed ? 'CLAIMED' : 'BUY SEALED'}
                  </button>
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

      {phase === 'promo' && promo.length > 0 && (
        <div className="po-stage po-stage-summary">
          <div className="po-banner">★ PROMO — SEALED IN THE BOX</div>
          <div className="faint small" style={{ maxWidth: 330, margin: '2px auto 12px', lineHeight: 1.5 }}>
            {box?.productName ?? 'This product'} ships with{' '}
            {promo.map((p) => p.name).join(promo.length === 2 ? ' and ' : ', ')} in the box beside the packs.{
              promo.length === 1 ? ' It is already in your binder — the wrappers come next.' : ' They are already in your binder — the wrappers come next.'
            }
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 14 }}>
            {promo.map((p) => <PromoCell key={p.cardId} cardId={p.cardId} value={p.value} />)}
          </div>
          <div className="po-actions">
            <button className="primary" onClick={dismissPromo}>
              OPEN PACK 1 OF {box?.packsTotal ?? 1}
            </button>
            {box && box.packsLeft > 0 && (
              <button className="ghost" disabled={busy === 'skip'} onClick={skipRemainingPacks}>
                {busy === 'skip' ? 'OPENING ALL…' : `SKIP TO END · REVEAL ALL ${box.packsTotal} PACKS`}
              </button>
            )}
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
        <div
          className="po-stage po-reveal-stage"
          data-tier={tier}
          onClick={stageClick}
          onPointerDown={startSwipe}
          onPointerUp={endSwipe}
          onPointerCancel={cancelSwipe}
          onPointerLeave={cancelSwipe}
        >
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
            {/* This slot is always here, empty while the card is face-down.
                Without it the value line appears after the flip and pushes the
                progress row and the action buttons down under the cursor. */}
            <div className="po-result">
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
            </div>
            {landed && tier !== 'common' && <div className="po-shock" data-tier={tier} aria-hidden />}
          </div>
          <div className="po-progress">
            {queue.map((_, i) => (
              <span key={i} className={`dot ${i < idx || (i === idx && landed) ? (queue[i].isHit ? 'hit-shown' : 'shown') : ''}`} />
            ))}
          </div>
          <div className="faint small">
            {landed
              ? autoReveal
                ? remaining > 0
                  ? `${remaining} card${remaining > 1 ? 's' : ''} left — next card automatically`
                  : 'Auto — finishing…'
                : remaining > 0
                  ? `${remaining} card${remaining > 1 ? 's' : ''} left — swipe for the next card`
                  : 'Last card — swipe to finish'
              : autoReveal ? 'Auto reveal' : 'Swipe or click to reveal'}
          </div>
          <div className="po-actions">
            <button className="small" onClick={(e) => { e.stopPropagation(); setFast(true) }}>Skip animation</button>
            <button className="small ghost" onClick={(e) => { e.stopPropagation(); revealAll() }}>Reveal all</button>
          </div>
        </div>
      )}

      {phase === 'summary' && session && (
        <div className="po-stage po-stage-summary">
          <div className="po-banner" style={{ fontSize: 20 }}>
            {box
              ? box.packsLeft === 0
                ? `BOX COMPLETE — ${box.packsTotal} PACKS OPEN`
                : `PACK ${box.packIndex} OF ${box.packsTotal} OPEN`
              : 'SESSION COMPLETE'}
          </div>
          {box && boxTotals && (
            <div className="faint small" style={{ marginBottom: 8 }}>
              {box.productName} · {boxTotals.cards} cards so far · {fmtUsd(boxTotals.value)} out of {fmtUsd(boxTotals.spent)}
            </div>
          )}
          {box && bestBoxHit && (
            <div className="po-best-hit">
              <span className="po-best-hit-label">🏆 BEST HIT</span>
              <b>{bestBoxHit.name ?? bestBoxHit.cardId}</b>
              {bestBoxHit.setName && <span className="po-best-hit-set">{bestBoxHit.setName}</span>}
              <em>{fmtUsd(bestBoxHit.value)}</em>
            </div>
          )}
          {beatPackRecord && (
            <div className="po-banner massive pack-record-banner" style={{ marginBottom: 6 }}>📦 BEST PACK EVER — {fmtUsd(bestPackOfSession)}!</div>
          )}
          <div className="row mt8" style={{ gap: 26, flexWrap: 'wrap', justifyContent: 'center' }}>
            <div className="right"><div className="faint small">CARDS PULLED</div><div className="po-value">{session.cards.length}</div></div>
            {box && (
              <>
                <div className="right">
                  <div className="faint small">BOX HITS</div>
                  <div className="po-value" style={{ color: boxHits > 0 ? 'var(--magenta)' : undefined }}>⚡ {boxHits}</div>
                </div>
                <div className="right" title="Average market value of every HIT card in the box so far">
                  <div className="faint small">AVG PER HIT</div>
                  <div className="po-value" style={{ color: boxAvgHit != null ? 'var(--gold)' : undefined }}>
                    {boxAvgHit == null ? '—' : fmtUsd(boxAvgHit)}
                  </div>
                </div>
                <div className="right" title="Highest-value single wrapper opened in this box so far">
                  <div className="faint small">BEST PACK</div>
                  <div className="po-value" style={{ color: 'var(--gold)' }}>{fmtUsd(bestBoxPack)}</div>
                </div>
              </>
            )}
            {newCount > 0 && (
              <div className="right"><div className="faint small">NEW TO BINDER</div><div className="po-value" style={{ color: 'var(--green)' }}>✨ {newCount}</div></div>
            )}
            <div className="right"><div className="faint small">TOTAL PULL VALUE</div><div className="po-value" style={{ color: 'var(--gold)' }}><CountUp value={session.totalValue} dur={fast || reduced ? 0 : 900} /></div></div>
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
            {summaryPacks.length > 0 && (
              <div className="po-binder-tools">
                <span className="faint small">Packs on this page</span>
                <button
                  type="button"
                  className="ghost small"
                  disabled={allPacksOpen}
                  onClick={() => setOpenPacksByPage((pages) => ({
                    ...pages,
                    [pageIndex]: pagePacks.map((pack) => pack.packIndex),
                  }))}
                >Expand all</button>
                <button
                  type="button"
                  className="ghost small"
                  disabled={openPacks.length === 0}
                  onClick={() => setOpenPacksByPage((pages) => ({ ...pages, [pageIndex]: [] }))}
                >Collapse all</button>
              </div>
            )}
            <div className={`po-pack-groups${allPacksOpen ? ' all-open' : ''}`}>
            {summaryPacks.length > 0 ? (
              pagePacks.map((pack) => {
                const open = openPacks.includes(pack.packIndex)
                const value = pack.cards.reduce((sum, c) => sum + c.value, 0)
                const hits = pack.cards.filter((c) => c.isHit).length
                const cardsId = `po-pack-cards-${pack.packIndex}`
                return (
                  <section className={`po-pack-group ${open ? 'open' : ''}`} key={pack.packIndex} aria-label={`Pack ${pack.packIndex}`}>
                    <button
                      type="button"
                      className="po-pack-group-label"
                      aria-expanded={open}
                      aria-controls={cardsId}
                      onClick={() => togglePack(pack.packIndex)}
                    >
                      PACK {pack.packIndex}
                      <span>
                        · {pack.cards.length} cards ·{' '}
                        <b className={hits > 0 ? 'po-pack-hits' : undefined}>{hits} hit{hits === 1 ? '' : 's'}</b>
                        {' '}· {fmtUsd(value)}
                      </span>
                      <span className="po-pack-group-chevron" aria-hidden>{open ? '▾' : '▸'}</span>
                    </button>
                    {open && (
                      <div className="po-summary-grid" id={cardsId}>
                        {pack.cards.map((c, i) => (
                          <SummaryCell
                            key={`${pack.packIndex}-${i}`}
                            card={c}
                            index={i}
                            fast={fast || reduced}
                            record={beatRecord && sessionBest != null && c.cardId === sessionBest.cardId && c.value === sessionBest.value}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )
              })
            ) : (
              <div className="po-summary-grid">
                {session.cards.slice(pageIndex * 40, pageIndex * 40 + 40).map((c, i) => (
                  <SummaryCell
                    key={pageIndex * 40 + i}
                    card={c}
                    index={i}
                    fast={fast || reduced}
                    record={beatRecord && sessionBest != null && c.cardId === sessionBest.cardId && c.value === sessionBest.value}
                  />
                ))}
              </div>
            )}
            </div>
            <div className="po-binder-foot">
              Pulls · page {pageIndex + 1} of {pageCount}
              {summaryPacks.length > 0
                ? ` · ${summaryPacks.length} pack${summaryPacks.length === 1 ? '' : 's'} · ${session.cards.length} cards`
                : ` · ${session.cards.length} cards`}
            </div>
            {pageCount > 1 && (
              <div className="po-binder-nav">
                <button className="ghost small" disabled={pageIndex === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Prev page</button>
                <button className="ghost small" disabled={pageIndex + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>Next page →</button>
              </div>
            )}
          </div>
          <div className="po-actions">
            {box && box.packsLeft === 0 && <button className="ghost" onClick={loadBoxes}>Refresh boxes</button>}
            {box && box.packsLeft > 0 ? (
              <>
                <button className="primary" disabled={busy === 'next' || busy === 'skip'} onClick={openNextPack}>
                  {busy === 'next' ? 'TEARING…' : `OPEN PACK ${box.packIndex + 1} OF ${box.packsTotal}`}
                </button>
                <button className="ghost" disabled={busy === 'skip' || busy === 'next'} onClick={skipRemainingPacks}>
                  {busy === 'skip' ? 'OPENING ALL…' : `SKIP TO END · OPEN ${box.packsLeft} PACKS`}
                </button>
              </>
            ) : (
              <button className="primary" onClick={() => (window.location.hash = '#/packs')}>OPEN MORE</button>
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
