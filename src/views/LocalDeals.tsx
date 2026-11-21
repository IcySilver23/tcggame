import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type LocalFeedRow, type LocalKind, type LocalMessage, type LocalReveal, type MyLocalListing, type MyLocalSale, type SealedStockRow } from '../api'
import { crinkle, flipSwish, hitStinger, ripChime } from '../audio'
import { useStore } from '../store'
import { CardImg, EmptyState, FirstUseTip, fmtUsd, LoadFailure, SlabCard, TipList } from '../components'
import cardBack from '../assets/card-back.png'

// ---------------------------------------------------------------------------
// 🪧 Local Deals — rebuilt as Facebook Marketplace 1:1 (roadmap item 3.0).
//
// Marketplace's shape: a chrome header with search → a left rail holding
// create-listing plus filters → the signature square-tile GRID (price first,
// then title, then source and age) → a listing detail with a big photo, a
// right-hand info column and a seller card.
//
// Mechanics are untouched: no fees, no protection, cash in a parking lot,
// 1-in-8 ghosts, the 🐟 counterfeit tell and the counter-offer dice all come
// from the same server calls as before. Nothing on screen is invented — there
// is no location field in the data, so there is no location filter here, and
// the meet-up lot is chosen when you agree to meet, not before.
// ---------------------------------------------------------------------------

type Sort = 'best' | 'price_asc' | 'price_desc' | 'newest'
type Tab = 'browse' | 'mine'

const SORTS: { id: Sort; label: string }[] = [
  { id: 'best', label: 'Closest match' },
  { id: 'price_asc', label: 'Lowest price' },
  { id: 'price_desc', label: 'Highest price' },
  { id: 'newest', label: 'Newly listed' },
]

const srcLabel = (s: string) => (s === 'facebook' ? 'Facebook Marketplace' : 'Craigslist')
const srcIcon = (s: string) => (s === 'facebook' ? '📘' : '📋')

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** Marketplace's green "Good deal" chip — same thresholds the game always used. */
function DealTag({ delta, tell }: { delta: number; tell: LocalFeedRow['tell'] }) {
  const pct = Math.round(delta * 100)
  if (tell === '🐟') return <span className="ld-flag" title="Too good to be true? Cheap local deals can be counterfeits — corner-check it in the lot.">🐟 too good?</span>
  if (pct <= -50) return <span className="ld-deal hot" title="More than half off this card's market value">🔥 {pct}% off</span>
  if (pct <= -15) return <span className="ld-deal">✓ Good deal</span>
  if (pct >= 15) return <span className="ld-dreamer">+{pct}% vs market</span>
  return null
}

// --- chrome -----------------------------------------------------------------

function Chrome({
  q,
  setQ,
  tab,
  setTab,
  onSearch,
  mineCount,
}: {
  q: string
  setQ: (v: string) => void
  tab: Tab
  setTab: (t: Tab) => void
  onSearch: () => void
  mineCount: number
}) {
  return (
    <div className="ld-chrome">
      <div className="ld-top">
        <div className="ld-wordmark" title="Local Deals — cash, no fees, no recourse">
          Local<span>Deals</span>
        </div>
        <form className="ld-search" onSubmit={(e) => { e.preventDefault(); onSearch() }}>
          <input type="search" placeholder="Search sellers and listings" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search listings" />
          <button type="submit" className="ld-go" aria-label="Search">🔍</button>
        </form>
        {/* Marketplace keeps "Create new listing" in the left rail only — a
            second one in the chrome was pure duplication. */}
      </div>

      <div className="ld-tabs" role="tablist">
        <button className={`ld-tab ${tab === 'browse' ? 'on' : ''}`} role="tab" aria-selected={tab === 'browse'} onClick={() => setTab('browse')}>
          Nearby chats
        </button>
        <button className={`ld-tab ${tab === 'mine' ? 'on' : ''}`} role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}>
          Your posts{mineCount > 0 && <span className="ld-badge">{mineCount}</span>}
        </button>
        <span className="ld-tabs-note">Person to person · cash only · no buyer protection</span>
      </div>
    </div>
  )
}

// --- filter rail ------------------------------------------------------------

type Filters = {
  min: string
  max: string
  conds: string[]
  source: 'all' | 'facebook' | 'craigslist'
  hideFish: boolean
}

function Rail({
  f,
  setF,
  conds,
  hits,
  total,
  onCreate,
}: {
  f: Filters
  setF: (patch: Partial<Filters>) => void
  conds: string[]
  hits: number
  total: number
  onCreate: () => void
}) {
  const any = f.min !== '' || f.max !== '' || f.conds.length > 0 || f.source !== 'all' || f.hideFish
  const toggleCond = (c: string) =>
    setF({ conds: f.conds.includes(c) ? f.conds.filter((x) => x !== c) : [...f.conds, c] })

  return (
    <aside className="ld-rail" aria-label="Filters">
      <button className="ld-create ld-create-block" onClick={onCreate}>+ Create new listing</button>

      <div className="ld-fgroup">
        <div className="ld-flabel">Price</div>
        <div className="ld-price-row">
          <input type="number" min={0} step={1} placeholder="Min" value={f.min} onChange={(e) => setF({ min: e.target.value })} aria-label="Minimum price" />
          <span>–</span>
          <input type="number" min={0} step={1} placeholder="Max" value={f.max} onChange={(e) => setF({ max: e.target.value })} aria-label="Maximum price" />
        </div>
      </div>

      <div className="ld-fgroup">
        <div className="ld-flabel">Source</div>
        {(
          [
            ['all', 'All listings'],
            ['facebook', '📘 Facebook Marketplace'],
            ['craigslist', '📋 Craigslist'],
          ] as [Filters['source'], string][]
        ).map(([id, label]) => (
          <label className="ld-check" key={id}>
            <input type="radio" name="ld-src" checked={f.source === id} onChange={() => setF({ source: id })} />
            {label}
          </label>
        ))}
      </div>

      {conds.length > 0 && (
        <div className="ld-fgroup">
          <div className="ld-flabel">Condition</div>
          {conds.map((c) => (
            <label className="ld-check" key={c}>
              <input type="checkbox" checked={f.conds.includes(c)} onChange={() => toggleCond(c)} />
              {c}
            </label>
          ))}
        </div>
      )}

      <div className="ld-fgroup">
        <div className="ld-flabel">Show only</div>
        <label className="ld-check">
          <input type="checkbox" checked={f.hideFish} onChange={(e) => setF({ hideFish: e.target.checked })} />
          Good deals
        </label>
      </div>

      <div className="ld-fcount">
        {hits} of {total} conversation{total === 1 ? '' : 's'}
        {any && (
          <button
            className="ld-clear"
            onClick={() => setF({ min: '', max: '', conds: [], source: 'all', hideFish: false })}
          >
            Clear
          </button>
        )}
      </div>

      <div className="ld-safety">
        <b>Meet in public.</b> Cash only — once it changes hands there's no recourse, and nobody owes you an
        explanation if they don't show.
      </div>
    </aside>
  )
}// --- listing art -----------------------------------------------------------

/**
 * Five kinds of listing need three art strategies: a card (derived from its
 * id), sealed product (its own wrapper photo), and a mystery — which has art
 * the buyer is not allowed to see, so it shows the card back.
 */
function ItemArt({ r, cls }: { r: { image: string | null; imageCardId: string | null; name: string; kind: LocalKind }; cls: string }) {
  if (r.imageCardId) return <CardImg src={r.image} alt={r.name} className={cls} cardId={r.imageCardId} />
  if (r.image) return <img className={`${cls} ld-plain`} src={r.image} alt={r.name} loading="lazy" />
  // A mystery has art the buyer is not allowed to see — the card back says so.
  if (r.kind === 'mystery_slab' || r.kind === 'mystery_box') {
    return <img className={`${cls} ld-plain ld-unknown`} src={cardBack} alt="Contents undisclosed" loading="lazy" />
  }
  // No photo of a known thing (a sealed product with no wrapper art) is not a
  // mystery — it is just missing a photo, and must not pretend otherwise.
  return <div className={`${cls} ld-noart`} role="img" aria-label="No photo supplied"><span aria-hidden>📦</span></div>
}

const KIND_ICON: Record<LocalKind, string> = {
  card: '🃏',
  sealed: '📦',
  bundle: '📚',
  mystery_slab: '💠',
  mystery_box: '🎁',
}

// --- a seller's thread ------------------------------------------------------

/**
 * The last line in a conversation. It is derived from the listing, not a
 * stored message: the point is to make the seller and the risk the first
 * thing the player reads, not a photo grid.
 */
function sellerNote(r: LocalFeedRow): string {
  if (r.ghosted) return 'You have dealt with this seller before — they ghosted. Bring a backup plan.'
  if (r.counterOffer != null) return `They countered at ${fmtUsd(r.counterOffer)}. Say yes and agree a lot.`
  if (r.tell === '🐟') return 'Far under market. Either the find of the week or a counterfeit — check the corners.'
  if (r.delta <= -0.15) return 'Priced under market. Cash only, first come, first served.'
  return r.kind === 'card'
    ? `Still available — ${r.condition}${r.setName ? ` · ${r.setName}` : ''}, cash in a public lot.`
    : `Still available — ${r.detail ?? r.kindLabel}, cash in a public lot.`
}

function ThreadRow({
  r,
  onOpen,
}: {
  r: LocalFeedRow
  onOpen: () => void
}) {
  return (
    <article className={`ld-thread-row ${r.ghosted ? 'ghosted' : ''}`} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
      <div className="ld-thread-ava" aria-hidden>{r.seller.slice(0, 1).toUpperCase()}</div>

      <div className="ld-thread-main">
        <div className="ld-thread-top">
          <b>{r.seller}</b>
          <span>{srcIcon(r.source)} {srcLabel(r.source)}</span>
          <span>·</span>
          <span>{ago(r.postedAt)}</span>
        </div>

        <div className="ld-thread-item">
          <span>{r.name}</span>
          <b>{fmtUsd(r.ask)}</b>
        </div>

        <p className="ld-thread-line">{sellerNote(r)}</p>

        <div className="ld-thread-tags">
          <span className="ld-kind" title={`Listing type: ${r.kindLabel}`}>
            {KIND_ICON[r.kind]} {r.kindLabel}
          </span>
          <DealTag delta={r.delta} tell={r.tell} />
          {r.ghosted && <span className="ld-ghost" title="This seller has ghosted you before">👻 ghosted</span>}
          {r.counterOffer != null && <span className="ld-countered" title="They countered your offer">💬 countered {fmtUsd(r.counterOffer)}</span>}
        </div>
      </div>

      <div className="ld-thread-art">
        <ItemArt r={r} cls="ld-thread-img" />
      </div>
      <span className="ld-thread-open" aria-hidden>→</span>
    </article>
  )
}

// --- the conversation -------------------------------------------------------

function Detail({
  r,
  onClose,
  onMeet,
  onOffer,
  busy,
}: {
  r: LocalFeedRow
  onClose: () => void
  onMeet: () => void
  onOffer: () => void
  busy: boolean
}) {
  const { openCard } = useStore()
  const pct = Math.round(r.delta * 100)
  return (
    <div className="ld-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ld-sheet ld-chat-sheet" role="dialog" aria-label={`Conversation with ${r.seller}`}>
        <header className="ld-chat-head">
          <div className="ld-avatar lg" aria-hidden>{r.seller.slice(0, 1).toUpperCase()}</div>
          <div className="ld-chat-who">
            <b>{r.seller}</b>
            <span>{srcIcon(r.source)} {srcLabel(r.source)} · no rating · cash only</span>
          </div>
          <span className={`ld-chat-status ${r.ghosted ? 'bad' : ''}`}>
            {r.ghosted ? '👻 ghosted before' : '● active'}
          </span>
          <button className="ld-close ld-chat-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="ld-chat-body">
          <div className="ld-chat-listing">
            <div className="ld-chat-art"><ItemArt r={r} cls="ld-chat-img" /></div>
            <div className="ld-chat-listing-main">
              <div className="ld-facts">
                <span className="ld-kind" title={`Listing type: ${r.kindLabel}`}>{KIND_ICON[r.kind]} {r.kindLabel}</span>
                {r.kind === 'card' && <span className="ld-cond">{r.condition}</span>}
                {r.kind !== 'card' && r.detail && <span>{r.detail}</span>}
                <span>·</span>
                <span>Listed {ago(r.postedAt)}</span>
              </div>
              <h2 className="ld-title">{r.name}</h2>
              {r.setName && <span className="ld-chat-listing-sub">{r.setName}</span>}
            </div>
            <div className="ld-chat-ask">
              <span>asking</span>
              <b>{fmtUsd(r.ask)}</b>
            </div>
          </div>

          <DealTag delta={r.delta} tell={r.tell} />

          <div className="ld-chat-log">
            <div className="ld-chat-label">Seller's post</div>
            <div className="ld-chat-bubble seller">
              <span className="ld-chat-bubble-who">{r.seller}</span>
              <p>{sellerNote(r)}</p>
              <em>{ago(r.postedAt)} · {srcLabel(r.source)}</em>
            </div>

            {/* A lot is disclosed — that is the whole point of a lot. A
                mystery is not, and says so rather than showing nothing. */}
            {r.contents && r.contents.length > 0 && (
              <div className="ld-contents">
                <div className="ld-contents-h">What's in the lot <span className="badge">{r.contents.length}</span></div>
                <ul>
                  {r.contents.map((c, i) => (
                    <li key={i}><span>{c.name}</span><em>{c.condition}</em></li>
                  ))}
                </ul>
              </div>
            )}
            {r.kind === 'mystery_slab' && (
              <div className="ld-blind">
                💠 Nobody has had this slab graded or looked at. The card and the
                grade are decided — you just do not get to see them until you are
                holding it.
              </div>
            )}
            {r.kind === 'mystery_box' && (
              <div className="ld-blind">
                🎁 The box is packed and taped. Contents are decided but
                undisclosed — the estimate below is what is actually inside,
                which is the only honest number a blind buy can have.
              </div>
            )}

            <div className="ld-chat-system">Cash in a public lot. No fees, no protection.</div>
          </div>

          <div className="ld-chat-compose">
            {r.counterOffer != null ? (
              <button className="ld-primary" disabled={busy} onClick={onMeet}>
                Meet & pay {fmtUsd(r.counterOffer)}
              </button>
            ) : (
              <>
                <button className="ld-primary" disabled={busy} onClick={onMeet}>
                  {busy ? 'On the way…' : 'Arrange the meetup'}
                </button>
                <button className="ld-secondary" disabled={busy} onClick={onOffer}>
                  Send an offer
                </button>
              </>
            )}
          </div>

          <div className="ld-chat-foot">
            <div className="ld-card-facts">
              <div className="ld-fact">
                <span>{r.anchorLabel === 'est' ? 'Est. contents' : 'Market value'}</span>
                <b>{fmtUsd(r.anchor)}</b>
              </div>
              <div className="ld-fact"><span>Ask vs {r.anchorLabel === 'est' ? 'estimate' : 'market'}</span><b className={pct > 15 ? 'up' : pct <= -15 ? 'down' : ''}>{pct > 0 ? '+' : ''}{pct}%</b></div>
              <div className="ld-fact"><span>Cash only</span><b>No fees, no paper trail</b></div>
              <div className="ld-fact"><span>Expires</span><b>{new Date(r.expiresAt).toLocaleDateString()}</b></div>
            </div>

            {r.kind === 'card' && r.cardId && (
              <button className="ld-more" onClick={() => { onClose(); openCard(r.cardId!) }}>
                View full card details →
              </button>
            )}

            <div className="ld-safety lg">
              <b>Where you meet is agreed in the message.</b> Public lots only — the seller picks one when you
              arrange it. Bring cash, check the corners, and walk if anything feels off.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- your listings ----------------------------------------------------------

function MyPost({
  l,
  onAccept,
  onCancel,
  busy,
}: {
  l: MyLocalListing
  onAccept: (buyer: string, amount?: number) => void
  onCancel: () => void
  busy: boolean
}) {
  const daysLeft = Math.max(0, Math.ceil((new Date(l.expiresAt).getTime() - Date.now()) / 86400000))
  return (
    <article className="ld-tile mine">
      <div className="ld-photo">
        <ItemArt r={l} cls="ld-img" />
      </div>
      <div className="ld-body">
        <div className="ld-price">{fmtUsd(l.ask)}</div>
        <div className="ld-name">{l.name}</div>
        <div className="ld-sub">
          <span className="ld-kind">{KIND_ICON[l.kind]} {l.kindLabel}</span>{' '}
          {l.kind === 'card' ? l.condition : (l.detail ?? '')} · posted {new Date(l.postedAt).toLocaleDateString()} ·{' '}
          {daysLeft > 0 ? `${daysLeft}d left` : 'expired'}
        </div>

        <div className="ld-thread">
          {l.messages.length === 0 ? (
            <div className="ld-bubble system">No messages yet — the algorithm is resting.</div>
          ) : (
            l.messages.slice(0, 4).map((m: LocalMessage, i: number) => (
              <div key={i} className={`ld-bubble ${m.kind}`}>
                <span className="ld-bubble-who">{m.kind === 'ghost' ? '👻 ' : m.kind === 'lowball' ? '🌙 ' : ''}{m.buyer}</span>
                <span className="ld-bubble-text">
                  {m.kind === 'lowball' && m.amount
                    ? `offered ${fmtUsd(m.amount)}`
                    : m.kind === 'full' && m.amount
                      ? `will pay ${fmtUsd(m.amount)}`
                      : `“${m.note}”`}
                </span>
                {m.kind !== 'ghost' && (
                  <button className="ld-quick" disabled={busy} onClick={() => onAccept(m.buyer, m.amount ?? undefined)}>
                    Meet
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <div className="ld-tile-actions">
          <button className="ld-secondary" disabled={busy} onClick={onCancel}>Take down</button>
        </div>
      </div>
    </article>
  )
}

// --- create listing ---------------------------------------------------------

type Mode = 'card' | 'lot' | 'sealed'

const MODES: { id: Mode; label: string; blurb: string }[] = [
  {
    id: 'card',
    label: '🃏 Single card',
    blurb: 'Pick a raw card from your binder — no slabs, no known fakes.',
  },
  {
    id: 'lot',
    label: '📚 Card lot',
    blurb: 'Two or more raw cards sold as one listing. The contents are listed publicly — that is what makes it a lot instead of a mystery.',
  },
  {
    id: 'sealed',
    label: '📦 Sealed',
    blurb: 'A pack, bundle or box straight off your shelf. Sold sealed, as-is — no returns and no peeking.',
  },
]

function Lister({ onPosted, open }: { onPosted: () => void; open: boolean }) {
  const { toast, refreshState } = useStore()
  const [pick, setPick] = useState(open)
  const [mode, setMode] = useState<Mode>('card')
  const [rows, setRows] = useState<any[] | null>(null)
  const [stock, setStock] = useState<SealedStockRow[] | null>(null)
  const [askFor, setAskFor] = useState<any | null>(null)
  const [lotSel, setLotSel] = useState<number[]>([])
  const [sealedSel, setSealedSel] = useState<string | null>(null)
  const [val, setVal] = useState('')

  useEffect(() => { if (open) setPick(true) }, [open])

  // Binder rows back both card mode and lot mode.
  useEffect(() => {
    if (!pick) return
    fetch('/api/inventory/light').then((r) => r.json()).then((rs) => {
      setRows(rs.filter((r: any) => r.status === 'collection' && !r.graded_grade && !r.is_fake && !r.fake_revealed))
    }).catch(() => setRows([]))
  }, [pick])

  useEffect(() => {
    if (!pick || mode !== 'sealed') return
    setStock(null)
    api.pullsSummary().then((s) => setStock(s.sealedInStock.filter((x) => x.quantity > 0))).catch(() => setStock([]))
  }, [pick, mode])

  const lotTotal = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => lotSel.includes(r.id))
        .reduce((sum, r) => sum + (Number(r.value ?? r.source?.usd) || 0), 0),
    [rows, lotSel],
  )

  const finish = async (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => {
    try {
      const r = await fn()
      if (!r.ok) { toast(r.error ?? 'Post failed', 'bad'); return }
      toast(msg, 'good')
      refreshState()
      setAskFor(null); setLotSel([]); setSealedSel(null); setVal(''); setPick(false)
      onPosted()
    } catch (e) {
      // req() throws the server's message on a 4xx — surface it, do not swallow.
      toast(e instanceof Error ? e.message : 'Post failed', 'bad')
    }
  }

  const post = () => {
    const n = Number(val)
    if (!(n > 0)) { toast('Set an ask first', 'bad'); return }
    if (mode === 'card') {
      if (!askFor) return
      void finish(() => api.localList(askFor.id, n), 'Posted — cash only, meet at a public lot')
    } else if (mode === 'lot') {
      if (lotSel.length < 2) { toast('Pick at least two cards for a lot', 'bad'); return }
      void finish(() => api.localListBundle(lotSel, n), `Posted a ${lotSel.length}-card lot — cash only`)
    } else {
      if (!sealedSel) return
      void finish(() => api.localListSealed(sealedSel, n), 'Posted — sealed, cash only, meet at a public lot')
    }
  }

  // The rail owns the single entry point; rendering a second button here put
  // three "Create new listing" controls on one screen.
  if (!pick) return null
  const blurb = MODES.find((m) => m.id === mode)?.blurb ?? ''

  return (
    <div className="ld-form">
      <div className="ld-form-head">
        <b>Create new listing</b>
        <button className="ld-close" onClick={() => { setPick(false); setAskFor(null); setLotSel([]); setSealedSel(null) }} aria-label="Cancel">✕</button>
      </div>

      <div className="ld-modes" role="tablist" aria-label="What are you listing?">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            className={`ld-mode ${mode === m.id ? 'on' : ''}`}
            onClick={() => { setMode(m.id); setAskFor(null); setLotSel([]); setSealedSel(null); setVal('') }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="ld-form-sub">{blurb} Free to post, no fees on the sale.</div>

      {mode === 'sealed' ? (
        stock == null ? (
          <div className="faint small">Loading your shelf…</div>
        ) : stock.length === 0 ? (
          <div className="faint small">No sealed product on your shelf — the Pack Shop sells it.</div>
        ) : (
          <div className="ld-pick">
            {stock.map((s) => (
              <button
                key={s.product_id}
                className={`ld-pick-item ${sealedSel === s.product_id ? 'on' : ''}`}
                onClick={() => { setSealedSel(s.product_id); setVal(String(Math.round(s.market_value * 100) / 100)) }}
              >
                <span className="ld-pick-badge" aria-hidden>📦</span>
                <span className="ld-pick-name">{s.name}</span>
                <span className="ld-pick-meta">
                  ×{s.quantity} · {s.oop ? `OOP ${s.oop_months}mo` : s.status} · mkt {fmtUsd(s.market_value)}
                </span>
              </button>
            ))}
          </div>
        )
      ) : rows == null ? (
        <div className="faint small">Loading binder…</div>
      ) : rows.length === 0 ? (
        <div className="faint small">Nothing postable right now.</div>
      ) : (
        <div className="ld-pick">
          {rows.slice(0, 60).map((r: any) => {
            const on = mode === 'card' ? askFor?.id === r.id : lotSel.includes(r.id)
            return (
              <button
                key={r.id}
                className={`ld-pick-item ${on ? 'on' : ''}`}
                onClick={() => {
                  if (mode === 'card') { setAskFor(r); setVal(String(r.value ?? r.source?.usd ?? '')) }
                  else setLotSel((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))
                }}
              >
                <CardImg src={r.image ?? r.image_small} alt={r.name} className="ld-pick-img" />
                <span className="ld-pick-name">{r.name}</span>
                <span className="ld-pick-meta">
                  {r.condition}{r.quantity > 1 ? ` ×${r.quantity}` : ''} · mkt {fmtUsd(Number(r.value ?? r.source?.usd) || 0)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {(mode === 'card' && askFor) || (mode === 'lot' && lotSel.length >= 2) || (mode === 'sealed' && sealedSel) ? (
        <div className="ld-form-ask">
          <span>
            Ask for{' '}
            <b>
              {mode === 'card' ? askFor?.name
                : mode === 'lot' ? `${lotSel.length} cards (~${fmtUsd(lotTotal)} mkt)`
                : stock?.find((s) => s.product_id === sealedSel)?.name}
            </b>
          </span>
          <span className="faint">$</span>
          <input inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Your ask" />
          <button className="ld-primary" onClick={post}>Post it</button>
        </div>
      ) : mode === 'lot' && lotSel.length > 0 ? (
        <div className="faint small">Pick {2 - lotSel.length} more to make a lot.</div>
      ) : null}
    </div>
  )
}

// --- the view ---------------------------------------------------------------

export function LocalDealsView() {
  const { toast, refreshState } = useStore()
  const [feed, setFeed] = useState<LocalFeedRow[] | null>(null)
  const [mine, setMine] = useState<MyLocalListing[] | null>(null)
  const [sold, setSold] = useState<MyLocalSale[]>([])
  const seenSales = useRef<Set<number>>(new Set())
  const primedSales = useRef(false)
  const [tab, setTab] = useState<Tab>('browse')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState<number | null>(null)
  const [result, setResult] = useState<any>(null)
  // The listing behind the last meetup, so the scene can put a face and a car
  // in it. Selling your own post has no row — that keeps the plain modal.
  const [sceneRow, setSceneRow] = useState<LocalFeedRow | null>(null)
  const [offerFor, setOfferFor] = useState<LocalFeedRow | null>(null)
  const [open, setOpen] = useState<LocalFeedRow | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const [q, setQ] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [sort, setSort] = useState<Sort>('best')
  const [f, setFstate] = useState<Filters>({ min: '', max: '', conds: [], source: 'all', hideFish: false })
  const setF = (patch: Partial<Filters>) => setFstate((s) => ({ ...s, ...patch }))

  const load = (initial = false) => {
    if (initial) setStatus('loading')
    Promise.all([
      api.local().then(setFeed),
      api.localMine().then((r) => {
        // Announce sales that landed while we were watching — the backlog on the
        // first load is history, not news.
        const fresh = primedSales.current ? r.sold.filter((s) => !seenSales.current.has(s.id)) : []
        for (const s of r.sold) seenSales.current.add(s.id)
        primedSales.current = true
        setMine(r.listings)
        setSold(r.sold)
        if (fresh.length > 0) {
          const s = fresh[0]
          toast(`💵 ${s.name} sold to ${s.buyer} for ${fmtUsd(s.paid)}`, 'good')
          refreshState()
        }
      }),
    ]).then(() => setStatus('ready')).catch(() => { if (initial) setStatus('error') })
  }
  useEffect(() => {
    load(true)
    // NPC buyers act on the server clock (one tick every ~20s) — keep the
    // board honest while the player is watching it.
    const t = window.setInterval(load, 12_000)
    return () => window.clearInterval(t)
  }, [])

  const meet = async (row: LocalFeedRow, offer?: number) => {
    setBusy(row.id)
    try {
      const r = await api.localMeet(row.id, offer)
      if (r.ok) {
        setResult(r)
        setSceneRow(row)
        if (r.outcome === 'bought') refreshState()
        if (r.ok && r.outcome === 'bought') setOpen(null)
      } else toast(r.error ?? 'Meetup failed', 'bad')
      load()
    } finally { setBusy(null) }
  }

  const accept = async (l: MyLocalListing, buyer: string, amount?: number) => {
    setBusy(l.id)
    try {
      const r = await api.localAccept(l.id, buyer, amount)
      if (r.ok) { setResult(r); setSceneRow(null); refreshState() }
      else toast(r.error ?? 'Meetup failed', 'bad')
      load()
    } finally { setBusy(null) }
  }

  const conds = useMemo(() => [...new Set((feed ?? []).map((r) => r.condition).filter(Boolean))], [feed])

  const shown = useMemo(() => {
    let out = feed ?? []
    const needle = appliedQ.trim().toLowerCase()
    if (needle) {
      out = out.filter((r) =>
        r.name.toLowerCase().includes(needle) ||
        (r.setName ?? '').toLowerCase().includes(needle) ||
        r.seller.toLowerCase().includes(needle),
      )
    }
    if (f.source !== 'all') out = out.filter((r) => r.source === f.source)
    if (f.conds.length) out = out.filter((r) => f.conds.includes(r.condition))
    if (f.min !== '') out = out.filter((r) => r.ask >= Number(f.min))
    if (f.max !== '') out = out.filter((r) => r.ask <= Number(f.max))
    if (f.hideFish) out = out.filter((r) => r.delta <= -0.15 && r.tell !== '🐟')

    const s = [...out]
    if (sort === 'price_asc') s.sort((a, b) => a.ask - b.ask)
    else if (sort === 'price_desc') s.sort((a, b) => b.ask - a.ask)
    else if (sort === 'newest') s.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime())
    return s
  }, [feed, appliedQ, f, sort])

  const total = feed?.length ?? 0
  const goCreate = () => { setTab('mine'); setCreateOpen(true) }

  if (status === 'error') return <LoadFailure what="Local Deals" onRetry={() => load(true)} />

  return (
    <div className="ld">
      <Chrome
        q={q}
        setQ={setQ}
        tab={tab}
        setTab={(t) => { setTab(t); setCreateOpen(false) }}
        onSearch={() => { setAppliedQ(q); setTab('browse'); setOpen(null) }}
        mineCount={mine?.length ?? 0}
      />

      <FirstUseTip surface="local">
        <TipList
          title="🪧 The wild west — read this first"
          items={[
            { icon: '🐟', label: 'Too good = fake', text: <>a 🐟 tell means the deal is <i>too</i> good — cheap enough to be a counterfeit</> },
            { icon: '👻', label: '1 in 8 ghost', text: <>meetups vanish and sellers go quiet; nobody owes you an explanation</> },
            { icon: '🚫', label: 'No protection', text: <>no fees either — but once the cash changes hands it's just the corners in your hand</> },
            { icon: '🎲', label: 'Read the ask', text: <>local prices are vibes: clueless, dreaming, or scam-adjacent</> },
          ]}
        />
      </FirstUseTip>

      <div className="ld-shell">
        <Rail f={f} setF={setF} conds={conds} hits={shown.length} total={total} onCreate={goCreate} />

        <main className="ld-main">
          {tab === 'browse' && (
            <>
              <div className="ld-toolbar">
                <div className="ld-count"><b>{shown.length}</b> conversation{shown.length === 1 ? '' : 's'}{appliedQ && <> for “{appliedQ}”</>}</div>
                <label className="ld-sort">
                  <span className="faint small">Sort by</span>
                  <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                    {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
              </div>

              {feed == null ? (
                <EmptyState icon="🕰" text="Loading Marketplace…" sub="Scrolling past the furniture ads." />
              ) : shown.length === 0 ? (
                <EmptyState
                  icon="🪧"
                  text={total === 0 ? 'No sellers in the neighborhood' : 'No conversations match'}
                  sub={total === 0 ? 'New posts land as the day goes on.' : 'Try fewer filters — the neighborhood is small and it turns over fast.'}
                  action={total > 0 ? { label: 'Clear search & filters', onClick: () => { setAppliedQ(''); setQ(''); setF({ min: '', max: '', conds: [], source: 'all', hideFish: false }) } } : undefined}
                />
              ) : (
                <div className="ld-thread-list">
                  {shown.map((r) => <ThreadRow key={r.id} r={r} onOpen={() => setOpen(r)} />)}
                </div>
              )}
            </>
          )}              {tab === 'mine' && (
            <>
              <div className="ld-toolbar">
                <div className="ld-count"><b>{mine?.length ?? 0}</b> live post{(mine?.length ?? 0) === 1 ? '' : 's'}</div>
                <span className="faint small">Free to post · no fees · cash on meetup</span>
              </div>

              {sold.length > 0 && (
                <div className="ld-sold">
                  <div className="ld-sold-h">💵 Just sold <span className="faint">NPCs buy while you play — cash lands the moment they do</span></div>
                  {sold.map((s) => (
                    <div key={s.id} className="ld-sold-row">
                      <span className="ld-sold-icon" aria-hidden>{KIND_ICON[s.kind]}</span>
                      <span className="ld-sold-name" title={s.name}>{s.name}</span>
                      <span className="ld-sold-buyer">to {s.buyer}</span>
                      <span className="ld-sold-amt">{fmtUsd(s.paid)}</span>
                      <span className="ld-sold-ago">{ago(s.at)}</span>
                    </div>
                  ))}
                </div>
              )}


              {mine == null ? (
                <EmptyState icon="🕰" text="Loading…" />
              ) : mine.length === 0 ? (
                <EmptyState icon="🪧" text="You haven't posted anything" sub="List a raw card from your binder — buyers message you, you pick who to meet." />
              ) : (
                <div className="ld-grid">
                  {mine.map((l) => (
                    <MyPost key={l.id} l={l} busy={busy === l.id} onAccept={(b, a) => accept(l, b, a)} onCancel={async () => { await api.localCancel(l.id); load(); toast('Post taken down', 'info') }} />
                  ))}
                </div>
              )}

              <Lister onPosted={load} open={createOpen} />
            </>
          )}
        </main>
      </div>

      {open && (
        <Detail
          r={open}
          busy={busy === open.id}
          onClose={() => setOpen(null)}
          onMeet={() => meet(open)}
          onOffer={() => { setOfferFor(open); setOpen(null) }}
        />
      )}

      {offerFor && (
        <OfferModal
          row={offerFor}
          onClose={() => setOfferFor(null)}
          onSend={async (num) => { await meet(offerFor, num); setOfferFor(null) }}
        />
      )}
      {result && sceneRow && (result.outcome !== 'bought' || !result.reveal) ? (
        <MeetupScene
          row={sceneRow}
          result={result}
          onClose={() => { setResult(null); setSceneRow(null); refreshState() }}
          onCounter={(n) => {
            const next = sceneRow
            setResult(null)
            setSceneRow(null)
            void meet(next, n)
          }}
        />
      ) : (
        <MeetResultModal result={result} onClose={() => setResult(null)} />
      )}
    </div>
  )
}

// --- the unboxing ----------------------------------------------------------
//
// A blind buy does not get a text modal — you paid to hold the thing, so you
// open the thing. Press and hold to tear it (foil crinkle as it goes), the bag
// gives with a rip, and the contents deal themselves in one card at a time
// with the paid-vs-worth tally underneath. Contents were rolled by the seller
// at post time; this screen only reads them.
// ---------------------------------------------------------------------------

type Tier = 'filler' | 'solid' | 'hit'
function tierOf(value: number, total: number): Tier {
  const share = total > 0 ? value / total : 0
  if (share >= 0.55 || value >= 40) return 'hit'
  if (share >= 0.2) return 'solid'
  return 'filler'
}

/** "PSA10" → "PSA 10" — the badge reads like a label, not a code. */
function gradeLabel(grade: string): string {
  if (grade === 'BGS10BL') return 'BGS BLACK LABEL 10'
  if (grade === 'CGC10P') return 'CGC PRISTINE 10'
  const m = grade.match(/^([A-Z]+)(\d+)$/)
  return m ? `${m[1]} ${m[2]}` : grade
}

function MysteryReveal({ reveal, onClose }: { reveal: LocalReveal; onClose: () => void }) {
  const { openCard, refreshState } = useStore()
  const [phase, setPhase] = useState<'sealed' | 'ripping' | 'open'>('sealed')
  const [tear, setTear] = useState(0)
  const timer = useRef<number | null>(null)
  const lastCrinkle = useRef(0)
  const alive = useRef(true)
  const isSlab = reveal.kind === 'mystery_slab'

  // StrictMode mounts, unmounts and remounts effects in dev — the flag has to
  // go back to true on every mount, or the rip's timer gets dismissed by a
  // cleanup that ran before this instance ever opened.
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (timer.current != null) { clearInterval(timer.current); timer.current = null }
    }
  }, [])

  const stopHold = () => {
    if (timer.current != null) { clearInterval(timer.current); timer.current = null }
    setTear(0)
  }

  const fire = () => {
    if (timer.current != null) { clearInterval(timer.current); timer.current = null }
    setTear(1)
    setPhase('ripping')
    ripChime()
    window.setTimeout(() => {
      if (!alive.current) return
      setPhase('open')
      refreshState()
      flipSwish(true)
      hitStinger(reveal.total, reveal.total >= reveal.paid)
    }, 640)
  }

  const startHold = () => {
    if (phase !== 'sealed' || timer.current != null) return
    const t0 = performance.now()
    // A timer, not a frame loop: a hidden tab stops rAF entirely, and the
    // tear should still finish when the player comes back to it.
    timer.current = window.setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / 900)
      setTear(p)
      const now = performance.now()
      if (now - lastCrinkle.current > 230) { lastCrinkle.current = now; crinkle(0.3 + 0.6 * p) }
      if (p >= 1) fire()
    }, 40)
  }

  const close = () => { refreshState(); onClose() }
  const profit = reveal.total - reveal.paid

  return (
    <div className="myst-back" onClick={(e) => { if (e.target === e.currentTarget && phase === 'open') close() }}>
      <div className={`myst ${phase}`} role="dialog" aria-label={isSlab ? 'Mystery slab' : 'Mystery box'}>
        <button className="ld-close" onClick={close} aria-label="Close">✕</button>

        {phase !== 'open' ? (
          <div className="myst-sealed-wrap">
            <div className="myst-lead">
              <b>{isSlab ? '💠 A bag, still sealed' : '🎁 A box, still taped shut'}</b>
              <span className="faint small">
                {isSlab ? 'The grade was decided the moment it was listed.' : 'Contents decided at posting — nobody has seen them.'}
              </span>
            </div>

            <div
              className={`myst-sealed ${isSlab ? 'slab' : 'box'}`}
              role="button"
              tabIndex={0}
              aria-label="Press and hold to tear it open"
              onPointerDown={startHold}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire() } }}
            >
              <img src={cardBack} alt="Contents undisclosed" draggable={false} />
              <span className="myst-wrap" aria-hidden />
              <span className="myst-seal-emoji" aria-hidden>{isSlab ? '💠' : '🎁'}</span>
            </div>

            <span className="myst-flash" aria-hidden />

            <div className={`myst-tear ${tear > 0 ? 'trailing' : ''}`} aria-hidden>
              <i style={{ width: `${tear * 100}%` }} />
              <b style={{ left: `${tear * 100}%` }}>✂</b>
            </div>
            <div className="myst-hint">
              {phase === 'ripping' ? 'It\u2019s giving…' : tear > 0 ? 'keep holding…' : 'Press and hold to tear it open'}
            </div>
          </div>
        ) : (
          <div className="myst-open">
            <div className="myst-title">
              <b>{isSlab ? '💠 It was…' : `🎁 Inside: ${reveal.items.length} card${reveal.items.length === 1 ? '' : 's'}`}</b>
              <span className="faint small">{isSlab ? 'Graded and slabbed before it ever hit the feed' : 'Straight from the box into your binder'}</span>
            </div>

            <div className={`myst-row ${isSlab ? 'one' : ''}`}>
              {reveal.items.map((it, i) => {
                const tier: Tier = isSlab ? 'hit' : tierOf(it.value, reveal.total)
                return (
                  <button
                    key={`${it.cardId}-${i}`}
                    className={`myst-card ${tier}`}
                    style={{ animationDelay: `${140 + i * 150}ms` }}
                    onClick={() => { close(); openCard(it.cardId) }}
                    title={`Open ${it.name}`}
                  >
                    {isSlab ? (
                      <SlabCard src={it.image} alt={it.name} grade={it.grade ?? null} setName={it.set} className="myst-art" />
                    ) : (
                      <CardImg src={it.image} alt={it.name} className="myst-art" />
                    )}
                    {isSlab && <span className="myst-grade">{gradeLabel(it.grade ?? '')}</span>}
                    {tier === 'hit' && !isSlab && <span className="myst-hit" aria-hidden>HIT</span>}
                    <span className="myst-cap">
                      <b>{it.name}</b>
                      <em>{[it.set, it.condition !== 'NM' ? it.condition : null].filter(Boolean).join(' · ') || ' '}</em>
                      <i>{fmtUsd(it.value)}</i>
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="myst-tally">
              <span>Paid <b>{fmtUsd(reveal.paid)}</b></span>
              <span>Worth <b>{fmtUsd(reveal.total)}</b></span>
              <span className={profit >= 0 ? 'good' : 'bad'}>
                {profit >= 0 ? `+${fmtUsd(profit)} under market` : `${fmtUsd(-profit)} over market`}
              </span>
              <button className="primary" onClick={close}>They're yours</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The meetup — a parking lot, not a popup.
//
// Buying from a stranger is the one transaction in the game with no
// protection, so it gets the one screen with no paperwork: you pull in, you
// make small talk, you count cash, you check the corners, you leave. Every
// beat below is driven by what the server already decided (outcome, paid,
// inspected) — the scene dramatises the result, it never invents one.
// ---------------------------------------------------------------------------

type MeetBeat = {
  label: string
  /** What they say, in their own words. */
  seller?: string
  /** What you do / notice. */
  you?: string
  action?: string
  /** This beat ends in a corner check — advance twice. */
  reveal?: 'genuine' | 'fake'
  /** Final beat: shows the paid-vs-market tally. */
  tally?: boolean
}

const VERDICT: Record<'genuine' | 'fake', string> = {
  genuine:
    'Corners tight, edges clean, no reseal seam, and the holo lines up under the streetlight. The real thing.',
  fake:
    'The corner lifts under your thumbnail. Wrong stock, wrong gloss, wrong colour in this light. A counterfeit — and your cash is already in their pocket.',
}

function meetBeats(row: LocalFeedRow, r: any): MeetBeat[] {
  const seller = row.seller
  if (r.outcome === 'ghosted') {
    return [
      { label: 'ARRIVE', you: `The agreed lot. One streetlight, one abandoned cart, no ${seller}.`, action: 'Wait five minutes' },
      { label: 'NO SHOW', you: 'You text them. Delivered. Read. Nothing. The lot hums.', action: 'Drive home' },
    ]
  }
  if (r.outcome === 'sold_elsewhere') {
    return [
      { label: 'ARRIVE', you: 'You pull in as someone else is walking away with it, bag already in hand.', action: 'Get out anyway' },
      { label: 'TOO LATE', seller: '"Sorry — sold it locally already."', you: 'The taillights are two red dots before you reach the curb.', action: 'Drive home' },
    ]
  }
  if (r.outcome === 'counter') {
    return [
      { label: 'ARRIVE', you: `${seller} is leaning on the car with the item already out of the trunk.`, action: 'Name your price' },
      { label: 'THE NUMBER', seller: `"${fmtUsd(r.counter)} and it's yours."`, you: 'They say it like the number was always the number.', action: 'decide' },
    ]
  }

  const fake = r.inspected === 'fake'
  const line =
    row.kind === 'card' ? `It's the ${row.condition} one, like the photos.`
      : row.kind === 'sealed' ? 'Never opened. Sealed the day I bought it.'
        : row.kind === 'bundle' ? 'All of it, in the box, like I listed.'
          : 'Still sealed. I have not looked.'

  return [
    {
      label: 'ARRIVE',
      you: `The agreed lot. ${seller}'s car is already there — engine off, headlights dark, hazards blinking twice as you pull in.`,
      action: 'Walk over',
    },
    {
      label: 'SMALL TALK',
      seller: `"Yeah — still got it." ${line}`,
      you: 'No handshake. They keep one hand in their pocket the whole time.',
      action: 'Ask to see it',
    },
    {
      label: 'CASH',
      you: `You count ${fmtUsd(r.paid)} out of your wallet and hold it at arm's length. They take it without counting.`,
      action: 'Take the item',
    },
    { label: 'THE CHECK', action: 'Check the corners', reveal: fake ? 'fake' : 'genuine' },
    {
      label: 'DONE',
      you: fake
        ? 'You are standing in a parking lot holding a counterfeit you already paid for. They are already backing out.'
        : 'It goes in the bag. You are back in the car before the streetlight clicks off.',
      action: fake ? 'Drive home' : 'Drive home',
      tally: true,
    },
  ]
}

function MeetupScene({
  row,
  result,
  onClose,
  onCounter,
}: {
  row: LocalFeedRow
  result: any
  onClose: () => void
  onCounter: (counter: number) => void
}) {
  const beats = useMemo(() => meetBeats(row, result), [row, result])
  const [step, setStep] = useState(0)
  const [revealed, setRevealed] = useState(-1)
  const beat = beats[Math.min(step, beats.length - 1)]
  const isCounter = result.outcome === 'counter'
  const done = step >= beats.length - 1
  const verdict = beat.reveal && revealed === step ? VERDICT[beat.reveal] : null

  const advance = () => {
    // A check beat is two beats: turn the card over, then move on.
    if (beat.reveal && revealed !== step) {
      setRevealed(step)
      if (beat.reveal === 'fake') crinkle(0.9)
      else flipSwish(true)
      return
    }
    if (done) { onClose(); return }
    flipSwish(false)
    setStep((s) => Math.min(beats.length - 1, s + 1))
  }

  const paid = Number(result.paid ?? row.ask)
  const market = row.anchor
  const delta = market > 0 ? (paid - market) / market : 0

  return (
    <div className="mp-back" onClick={(e) => { if (e.target === e.currentTarget && done) onClose() }}>
      <div className="mp" role="dialog" aria-label={`Meetup with ${row.seller}`}>
        <button className="ld-close" onClick={onClose} aria-label="Leave">✕</button>

        {/* The lot: sky, lamp, car, and whoever is standing in it. */}
        <div className={`mp-sky ${result.outcome === 'ghosted' ? 'empty' : ''}`}>
          <span className="mp-star s1" aria-hidden /><span className="mp-star s2" aria-hidden /><span className="mp-star s3" aria-hidden />
          <div className="mp-lamp" aria-hidden><span className="mp-lamp-head">💡</span></div>
          <div className="mp-car" aria-hidden>{result.outcome === 'ghosted' ? '🚙' : result.outcome === 'sold_elsewhere' ? '🚗' : '🚙'}</div>
          {result.outcome !== 'ghosted' && (
            <div className="mp-figure">
              <span className="mp-avatar" aria-hidden>{row.seller.slice(0, 1).toUpperCase()}</span>
              <span className="mp-name">{row.seller}</span>
            </div>
          )}
          <div className="mp-ground" aria-hidden>
            <span className="mp-stall" /><span className="mp-stall" /><span className="mp-stall" />
          </div>
          <div className="mp-item" aria-hidden>
            <ItemArt r={row} cls="mp-item-art" />
          </div>
        </div>

        <div className="mp-beats" aria-hidden>
          {beats.map((b, i) => (
            <span key={b.label} className={`mp-beat ${i < step ? 'past' : ''} ${i === step ? 'now' : ''}`}>{b.label}</span>
          ))}
        </div>

        <div className="mp-body">
          {beat.seller && (
            <div className="mp-dlg">
              <span className="mp-who">{row.seller}</span>
              <p>{beat.seller}</p>
            </div>
          )}
          {beat.you && <p className="mp-you">{beat.you}</p>}
          {verdict && <p className={`mp-verdict ${beat.reveal}`}>{beat.reveal === 'fake' ? '🚫 ' : '✅ '}{verdict}</p>}

          {beat.tally && (
            <div className="mp-tally">
              <span>Paid <b>{fmtUsd(paid)}</b></span>
              <span>{row.anchorLabel === 'est' ? 'Est. contents' : 'Market'} <b>{fmtUsd(market)}</b></span>
              <span className={delta <= 0 ? 'good' : 'bad'}>
                {delta <= 0 ? `${Math.round(-delta * 100)}% under` : `${Math.round(delta * 100)}% over`}
              </span>
            </div>
          )}

          <div className="mp-actions">
            {isCounter && done ? (
              <>
                <button className="primary" onClick={() => onCounter(result.counter)}>Pay {fmtUsd(result.counter)}</button>
                <button className="ghost" onClick={onClose}>Walk away</button>
              </>
            ) : (
              <button className="primary" onClick={advance}>
                {beat.reveal && revealed !== step ? beat.action : done ? (beat.action ?? 'Drive home') : (beat.action ?? 'Continue')}
              </button>
            )}
            {!done && <button className="ghost" onClick={onClose}>Leave</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- result + offer modals (unchanged behaviour) ----------------------------

function MeetResultModal({ result, onClose }: { result: any; onClose: () => void }) {
  const { refreshState } = useStore()
  if (!result) return null
  const r = result
  // A blind buy opens instead of talks — the reveal is the point of the buy.
  if (r.outcome === 'bought' && r.reveal) return <MysteryReveal reveal={r.reveal} onClose={onClose} />
  const isBuy = r.outcome === 'bought'
  const header = isBuy
    ? (r.inspected === 'fake' ? '🃏 The corner test failed' : '🤝 Deal done')
    : r.outcome === 'sold'
      ? '💵 Cash in hand'
      : r.outcome === 'ghosted'
        ? '👻 Ghosted'
        : r.outcome === 'sold_elsewhere'
          ? '⏱ Sold already'
          : r.ok ? '💬 Counter' : '🚫'
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); refreshState() } }}>
      <div className="modal" style={{ width: 'min(460px, 94vw)' }}>
        <div className="modal-head">
          <div><h2 style={{ margin: 0 }}>{header}</h2></div>
          <button className="ghost" onClick={() => { onClose(); refreshState() }}>✕</button>
        </div>
        {isBuy ? (
          <div>
            <div className="trade-bubble" style={{ marginBottom: 12 }}>
              {r.inspected === 'fake'
                ? `You paid ${fmtUsd(r.paid)} for the "${r.card}" — and the second you held it, the corners told the truth. COUNTERFEIT. It's yours forever (or until a buylist shop takes it off your hands for a dollar).`
                : `${r.card} is yours for ${fmtUsd(r.paid)} cash, no receipts, no paper trail.`}
            </div>
            <button className="primary" onClick={() => { onClose(); refreshState() }}>Done</button>
          </div>
        ) : (
          <div>
            <div className="trade-bubble" style={{ marginBottom: 12 }}>{r.message ?? r.error}</div>
            <button className="ghost" onClick={() => { onClose(); refreshState() }}>Walk back to the car</button>
          </div>
        )}
      </div>
    </div>
  )
}

function OfferModal({ row, onClose, onSend }: { row: LocalFeedRow; onClose: () => void; onSend: (num: number) => void }) {
  const [val, setVal] = useState(String(Math.max(0.5, Math.round(row.ask * 0.7 * 100) / 100)))
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(430px, 94vw)' }}>
        <div className="modal-head">
          <div>
            <h2 style={{ margin: 0 }}>💬 Your offer</h2>
            <div className="faint small">{row.name} · asking {fmtUsd(row.ask)} · market {fmtUsd(row.anchor)}</div>
          </div>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="faint">$</span>
          <input className="input" style={{ width: 110 }} value={val} inputMode="decimal" onChange={(e) => setVal(e.target.value)} />
          <button className="primary" onClick={() => { const n = Number(val); if (n > 0) onSend(n) }}>Send & meet</button>
        </div>
        <div className="faint small mt8">They might counter, ghost you, or just take it. Cash rules.</div>
      </div>
    </div>
  )
}
