import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { EstateSaleListing, EstateBuyoutsSection, EstateBuyoutResult } from '../api'
import { useStore } from '../store'
import { CardImg, EmptyState, FirstUseTip, fmtUsd, TipList } from '../components'
import cardBack from '../assets/card-back.png'

// ---------------------------------------------------------------------------
// 📑 ESTATE BUYOUTS — roadmap 5.0: "negotiation first, reveal second".
//
// The verb is GAMBLING SIGHT-UNSEEN, and the decision needs two things side
// by side: what the photo shows, and what the heirs are asking. So each
// estate is one table — the photo on the left, the money ledger on the right,
// and the thread underneath where they answer you. Everything on that ledger
// is already on the wire (claim, ask, your offer, counters left, mood, the
// clock); it was just never laid out as a decision.
//
// Then the reveal is a ceremony: paid / claimed / appraises, the verdict, and
// the drumroll where the face-down cards' conditions roll one at a time —
// server rolled them at buy, this is only the showing.
//
// Mechanics untouched: same /api/estate-sales payload, same floor/counter
// math, same condition roll, same apology, same first-refusal window.
// ---------------------------------------------------------------------------

const MOOD_FACE = (m: number) => (m >= 70 ? '😊' : m >= 40 ? '😐' : '😠')
const COND_STYLE: Record<string, string> = { NM: 'var(--green)', LP: 'var(--yellow)', MP: 'var(--yellow)', HP: 'var(--orange, var(--yellow))', DM: 'var(--red)' }
const COND_COLOR = (c: string) => COND_STYLE[c] ?? 'var(--text-faint)'
const ROLL_CYCLE = ['NM', 'LP', 'MP', 'HP', 'DM']
const COUNTER_MAX = 2

const closeLabel = (s: EstateSaleListing) =>
  s.hoursLeft < 36
    ? `${s.hoursLeft}h left`
    : `${Math.round(s.hoursLeft / Math.max(1, s.hoursPerGameDay))} game-days left`

// --- the photo: what you are actually allowed to see ------------------------

function Photo({ s }: { s: EstateSaleListing }) {
  const shown = s.glimpses.length
  const hidden = Math.max(0, s.card_count - shown)
  const backs = Math.min(5, hidden)
  return (
    <div className="es-photo">
      <div className="es-photo-h">
        📸 The photo <span className="faint">{shown} of {s.card_count} showing</span>
      </div>

      <div className="es-glimpses">
        {s.glimpses.map((g) => (
          <figure className="es-glimpse" key={g.card_id}>
            <CardImg src={g.image_small} alt={g.name} cardId={g.card_id} />
            <figcaption>
              <b title={g.name}>{g.name}</b>
              <span style={{ color: COND_COLOR(g.condition), fontWeight: 800 }}>{g.condition}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      {hidden > 0 && (
        <div className="es-facedown">
          <div className="es-backs" aria-hidden>
            {Array.from({ length: backs }).map((_, i) => (
              <img key={i} src={cardBack} alt="" />
            ))}
            {hidden > backs && <span className="es-backs-more">+{hidden - backs}</span>}
          </div>
          <span className="faint small">
            {hidden} face down — their conditions roll <b>only when the binder opens</b>
          </span>
        </div>
      )}

      <p className="es-note">{s.glimpse_note}</p>
    </div>
  )
}

// --- the money ledger: the whole decision in one column ---------------------

function Ledger({ s }: { s: EstateSaleListing }) {
  const agreed = s.dealPrice != null && s.dealPrice < s.ask
  const price = s.dealPrice ?? s.ask
  const markup = s.estimate > 0 ? Math.round((s.ask / s.estimate - 1) * 100) : 0
  return (
    <div className="es-ledger">
      <div className="es-price-block">
        <span className="es-price-lbl">{agreed ? 'Hand shaken on' : 'Asking'}</span>
        <b className="es-price">{fmtUsd(price)}</b>
        <div className="es-price-sub">
          {agreed && <s className="faint">{fmtUsd(s.ask)}</s>}
          {s.ask < s.opening_ask && <span className="faint">opened at {fmtUsd(s.opening_ask)}</span>}
        </div>
      </div>

      <dl className="es-nums">
        <div title="The heirs' number — a Facebook post, not a comp">
          <dt>They claim</dt>
          <dd>{fmtUsd(s.estimate)}</dd>
        </div>
        <div title={`The ask sits ${markup}% above their own claim`}>
          <dt>Ask vs claim</dt>
          <dd className={markup > 25 ? 'es-hot' : undefined}>{markup > 0 ? '+' : ''}{markup}%</dd>
        </div>
        <div>
          <dt>Your offer</dt>
          <dd>{s.yourOffer != null ? fmtUsd(s.yourOffer) : '—'}</dd>
        </div>
        <div title="Two counters, then their final number">
          <dt>Counters used</dt>
          <dd className={s.countersUsed >= COUNTER_MAX ? 'es-hot' : undefined}>{s.countersUsed}/{COUNTER_MAX}</dd>
        </div>
        <div>
          <dt>Stack</dt>
          <dd>{s.card_count} cards</dd>
        </div>
        <div>
          <dt>Closes</dt>
          <dd>{closeLabel(s)}</dd>
        </div>
      </dl>
    </div>
  )
}

// --- the thread: where they answer you --------------------------------------

function Thread({
  s,
  onDone,
  onReveal,
}: {
  s: EstateSaleListing
  onDone: () => void
  onReveal: (r: EstateBuyoutResult) => void
}) {
  const { toast, refreshState } = useStore()
  const [offer, setOffer] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<string | null>(null)

  const run = async (fn: () => Promise<any>, ok: (r: any) => void) => {
    setBusy(true)
    try {
      const r = await fn()
      ok(r)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  /** Every answer goes back on the ledger — mood, counters and their number all move. */
  const answered = (r: any) => {
    onDone()
    if (r?.message) setReply(r.message)
    if (r?.finalSaid) toast('That’s their final number — another lowball and they walk.', 'info')
  }

  const agreed = s.dealPrice != null && s.dealPrice < s.ask
  const price = s.dealPrice ?? s.ask

  return (
    <div className="es-thread">
      {s.refusal && (
        <div className="es-refusal">
          📩 <b>First refusal</b> — the heirs are holding this lot for you until tomorrow. Move before it goes public to everyone.
        </div>
      )}

      {agreed && (
        <div className="es-shook">
          🤝 Deal sealed at <b>{fmtUsd(price)}</b> — the Pay button charges that, not the ask.
        </div>
      )}

      <div className="es-thread-row">
        <input
          type="text"
          inputMode="decimal"
          placeholder={s.yourOffer != null ? `Last: ${fmtUsd(s.yourOffer)}` : `Under ${fmtUsd(s.ask)}`}
          value={offer}
          disabled={busy}
          aria-label={`Your offer (asking ${fmtUsd(s.ask)})`}
          onChange={(e) => setOffer(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && Number(offer)) sendOffer() }}
        />
        <button className="es-offer" disabled={busy || !Number(offer)} onClick={sendOffer}>
          Offer
        </button>
        <button
          className="es-pay"
          disabled={busy}
          title={agreed ? 'Close at the number they already shook on' : 'Pay the ask — no haggling, no waiting'}
          onClick={() =>
            run(
              () => api.estateBuyout(s.id),
              (r: EstateBuyoutResult) => {
                if (r.ok) {
                  toast(`Bought out ${s.seller_name} — ${fmtUsd(r.paid ?? 0)}.`, 'good')
                  refreshState()
                  onDone()
                  onReveal(r)
                } else toast(r.error ?? 'Rejected', 'bad')
              },
            )
          }
        >
          💰 Pay {fmtUsd(price)}
        </button>
        {s.finalSaid && (
          <button
            className="es-sorry"
            disabled={busy}
            title="Grovel — resets their counters and buys one more conversation"
            onClick={() =>
              run(() => api.estateApologize(s.id), (r: any) => {
                if (r.ok) { toast(r.message ?? 'They’ll hear you out.', 'good'); setReply(null); onDone() }
                else toast(r.error ?? 'Nothing to apologize for.', 'bad')
              })
            }
          >
            🙇 Apologize
          </button>
        )}
      </div>

      {reply && <div className="es-reply">{reply}</div>}
    </div>
  )

  function sendOffer() {
    const n = Number(offer)
    if (!n) return
    void run(async () => api.estateOffer(s.id, n), (r: any) => {
      if (r.ok && r.accepted) {
        toast(r.message, 'good')
        refreshState()
        setReply(r.message)
        onDone()
        setOffer('')
        return
      }
      if (r.ok) answered(r)
      else toast(r.error ?? 'Rejected', 'bad')
    })
  }
}

// --- the drumroll: conditions roll as the binder opens -----------------------

function RollStack({ cards, condBand }: { cards: NonNullable<EstateBuyoutResult['cards']>; condBand: EstateBuyoutResult['condBand'] }) {
  const pending = cards.filter((c) => c.rolled)
  const total = pending.length
  const [done, setDone] = useState(0)
  const [spin, setSpin] = useState(0)
  const timers = useRef<number[]>([])

  useEffect(() => {
    if (total === 0) return
    let i = 0
    const per = 220
    for (let k = 0; k < total; k++) {
      // Faster as the stack thins — the first flips are nervous, the last snap.
      const perCard = Math.max(260, 900 - Math.floor((k / Math.max(1, total)) * 640))
      const start = i
      const end = i + perCard
      for (let t = start; t < end; t += per) timers.current.push(window.setTimeout(() => setSpin((s) => s + 1), t))
      timers.current.push(window.setTimeout(() => setDone(k + 1), end))
      i = end
    }
    return () => { timers.current.forEach(clearTimeout); timers.current = [] }
  }, [total])

  const waiting = cards.filter((c) => !c.rolled)
  const band = condBand ?? { lo: 0.05, hi: 400 }

  if (total === 0) {
    return <p className="es-roll-none">The glimpses told the whole truth — every card's condition was already showing.</p>
  }

  const rows: (typeof cards) = [...waiting.slice(0, 3), ...pending]
  const rolling = done < total

  return (
    <div className="es-roll">
      <div className="es-roll-h">
        <span>{rolling ? 'Rolling conditions' : 'All settled'}</span>
        <b className={rolling ? 'es-roll-count' : 'es-roll-count done'}>{done}/{total}</b>
        <span className="faint">· {waiting.length} glimpses already showing</span>
      </div>

      <ol className="es-roll-list">
        {rows.map((c, i) => {
          const idx = c.rolled ? pending.indexOf(c) : -1
          const settled = idx >= 0 && idx < done
          const face = !c.rolled ? c.condition : settled ? c.condition : ROLL_CYCLE[spin % ROLL_CYCLE.length]
          return (
            <li className="es-roll-row" key={c.card_id} style={{ animationDelay: `${Math.min(600, i * 45)}ms` }}>
              <CardImg src={c.image_small} alt={c.name} cardId={c.card_id} className="es-roll-img" />
              <span className="es-roll-name">
                <b>{c.name}</b>
                <em className="faint">{c.set_name}</em>
              </span>
              <span className="es-roll-right">
                <b
                  className="es-cond"
                  data-spinning={c.rolled && !settled ? '1' : undefined}
                  style={{ color: settled ? COND_COLOR(face) : 'var(--text-faint)' }}
                >
                  {face}
                </b>
                <em>
                  {/* Glimpses are pinned and priced — only a face-down card
                      is still a range until its roll settles. */}
                  {!c.rolled || settled ? fmtUsd(c.price) : `$${band.lo.toFixed(2)}–${band.hi.toFixed(0)}`}
                </em>
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// --- the ceremony -----------------------------------------------------------

function RevealModal({ r, onClose }: { r: EstateBuyoutResult; onClose: () => void }) {
  const pct = r.pct ?? 0
  const good = (r.profit ?? 0) >= 0
  const rolling = (r.rolledCount ?? 0) > 0
  return (
    <div className="es-reveal-back" onClick={onClose}>
      <div className="es-reveal" role="dialog" aria-label="The inherited binder" onClick={(e) => e.stopPropagation()}>
        <header className="es-reveal-head">
          <b>📑 The inherited binder</b>
          <button className="ghost small" onClick={onClose}>close</button>
        </header>

        <div className="es-tally">
          <div><span>Paid</span><b>{fmtUsd(r.paid ?? 0)}</b></div>
          <div><span>They claimed</span><b>{fmtUsd(r.estimate ?? 0)}</b></div>
          <div><span>Appraises at</span><b className={good ? 'es-good' : 'es-bad'}>{fmtUsd(r.realized ?? 0)}</b></div>
          <div><span>Result</span><b className={good ? 'es-good' : 'es-bad'}>{pct >= 0 ? '+' : ''}{pct}%</b></div>
        </div>

        <div className="es-verdict">
          <b>{r.verdict ?? ''}</b>
          {(r.leftBehind ?? 0) > 0 && (
            <span className="faint">
              The shelf held {r.admitted} cards — {r.leftBehind} stayed with the estate. Cash is spent either way; that's the deal you made.
            </span>
          )}
          {rolling && <span className="faint">Conditions rolled as the binder opened.</span>}
        </div>

        <RollStack cards={r.cards ?? []} condBand={r.condBand} />

        <button className="primary es-reveal-go" onClick={onClose}>Into the collection →</button>
      </div>
    </div>
  )
}

// --- the view ---------------------------------------------------------------

export function EstateSalesView() {
  const [data, setData] = useState<EstateBuyoutsSection | null>(null)
  const [err, setErr] = useState(false)
  const [reveal, setReveal] = useState<EstateBuyoutResult | null>(null)

  const load = () => {
    api.estateSales().then((d) => { setData(d); setErr(false) }).catch(() => setErr(true))
  }
  useEffect(() => { load() }, [])

  const st = data?.stats
  const open = data?.listings ?? []

  if (err && !data) {
    return (
      <EmptyState
        icon="📡"
        text="Couldn't reach probate"
        sub="The estate notices didn't come back. Nothing was spent."
        action={{ label: 'Try again', onClick: load }}
      />
    )
  }

  if (data === null) {
    return (
      <div className="es-loading">
        {[0, 1].map((i) => <div className="es-table skeleton" key={i} />)}
      </div>
    )
  }

  return (
    <div className="es">
      <div className="page-head">
        <div>
          <h1>📑 Estate Buyouts</h1>
          <div className="sub">Whole collections, one photo, one number. What you see is the top of the stack — the rest you inherit.</div>
        </div>
      </div>

      <FirstUseTip surface="estate">
        <TipList
          title="📑 Buy the stack, not the story"
          items={[
            { icon: '📸', label: 'The photo', text: <><b>2–3 real cards</b> at real conditions — a strong top can hide junk, a weak top can hide a whale</> },
            { icon: '💬', label: 'They claim, they ask', text: <>the heirs' number is a Facebook post and the ask opens <b>above it</b> — offers walk it down</> },
            { icon: '🗣', label: 'Two counters', text: <>then their final number; lowball past that and they <b>walk</b> — 🙇 apologizing buys one more talk</> },
            { icon: '🎲', label: 'Sight unseen', text: <>face-down conditions roll <b>only when the binder opens</b> — the gamble is the product</> },
            { icon: '📦', label: 'Vault room', text: <>the collection lands at an even per-card cost basis — clear shelf space first</> },
          ]}
        />
      </FirstUseTip>

      {st && st.bought > 0 && (
        <div className="es-record" aria-label="Your probate record">
          <span className="es-record-h">Your record</span>
          <span><b>{st.bought}</b> <em>buyouts</em></span>
          <span><b>{st.cardsInherited}</b> <em>cards inherited</em></span>
          <span><b>{fmtUsd(st.spent)}</b> <em>spent</em></span>
          <span><b>{fmtUsd(st.realized)}</b> <em>now worth</em></span>
          <span className={st.net >= 0 ? 'es-good' : 'es-bad'}><b>{st.net >= 0 ? '+' : ''}{fmtUsd(st.net)}</b> <em>net</em></span>
        </div>
      )}

      {open.length === 0 ? (
        <EmptyState
          icon="🗂"
          text="No estates on the market"
          sub="Probate moves slowly. New collections surface on the game clock — and other collectors read the same notices."
        />
      ) : (
        open.map((s) => (
          <section className="es-table" key={s.id} aria-label={`${s.seller_name} — ${s.card_count} cards`}>
            <header className="es-head">
              <div className="es-head-main">
                <div className="es-heir">
                  <b>{s.seller_name}</b>
                  <span className="es-persona">{s.persona_label}</span>
                  <span className="es-mood" title={`mood ${s.mood}/100`}>{MOOD_FACE(s.mood)}</span>
                </div>
                <div className="es-blurb faint">{s.persona_blurb}</div>
              </div>
              <div className="es-clock" data-soon={s.hoursLeft < 12 || undefined}>
                <span className="es-clock-num">{closeLabel(s)}</span>
                <span className="es-clock-lbl">until probate closes</span>
              </div>
            </header>

            <div className="es-grid">
              <Photo s={s} />
              <Ledger s={s} />
            </div>

            <Thread s={s} onDone={load} onReveal={(r) => setReveal(r)} />
          </section>
        ))
      )}

      {reveal && <RevealModal r={reveal} onClose={() => setReveal(null)} />}
    </div>
  )
}
