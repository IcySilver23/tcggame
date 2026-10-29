import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { EstateSaleListing, EstateBuyoutsSection, EstateBuyoutResult } from '../api'
import { useStore } from '../store'
import { CardImg, EmptyState, FirstUseTip, fmtUsd, fmtDate } from '../components'

// ---------------------------------------------------------------------------
// Estate & collection buyouts — the sight-unseen whale. One photo, one number,
// heirs with moods. The inherited-binder reveal pays first and shows
// everything after, sorted rich-to-bulk like flipping through someone's
// forty-year binder. Glimpse cards show their real condition; the cards
// behind them roll theirs only when the binder opens — each face-down card
// flips in sequence with a condition spinner before settling (NM…DM), so the
// suspense you paid for is the suspense you get.
// ---------------------------------------------------------------------------

const MOOD_FACE = (m: number) => (m >= 70 ? '😊' : m >= 40 ? '😐' : '😠')

const COND_STYLE: Record<string, string> = { NM: 'var(--green)', LP: 'var(--yellow)', MP: 'var(--yellow)', HP: 'var(--orange, var(--yellow))', DM: 'var(--red)' }
const COND_COLOR = (c: string) => COND_STYLE[c] ?? 'var(--text-faint)'
const ROLL_CYCLE = ['NM', 'LP', 'MP', 'HP', 'DM']

function GlimpseStrip({ g, behind }: { g: EstateSaleListing['glimpses']; behind: number }) {
  if (!g.length) return null
  return (
    <div style={{ margin: '8px 0' }}>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        {g.map((c) => (
          <div key={c.card_id} style={{ width: 72, textAlign: 'center' }}>
            <CardImg src={c.image_small} alt={c.name} cardId={c.card_id} />
            <div className="faint" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
            <div className="small" style={{ fontSize: 10, fontWeight: 700, color: COND_COLOR(c.condition) }}>{c.condition}</div>
          </div>
        ))}
      </div>
      {behind > 0 && (
        <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
          {behind} more cards behind them — their conditions roll only when the binder opens.
        </div>
      )}
    </div>
  )
}

// The suspense mechanic: inherited cards roll their condition only when the
// binder opens. Face-down entries hold a "???" face that cycles NM→DM while
// they wait their turn; one by one each card's cycle slows, stops, and locks
// in its rolled condition (the server rolled it at buy; this is the drumroll).
// Glimpse cards never roll — the photo already told the truth about those.
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
      // Faster as the stack thins out — the first flips are nervous, the last
      // ones snap.
      const perCard = Math.max(260, 900 - Math.floor((k / Math.max(1, total)) * 640))
      const start = i
      const end = i + perCard
      for (let t = start; t < end; t += per) timers.current.push(window.setTimeout(() => setSpin((s) => s + 1), t))
      timers.current.push(window.setTimeout(() => setDone(k + 1), end))
      i = end
    }
    return () => { timers.current.forEach(clearTimeout); timers.current = [] }
  }, [total])

  if (total === 0) {
    return (
      <div className="small muted" style={{ marginBottom: 8 }}>
        The glimpses told the whole truth — every card's condition was already showing.
      </div>
    )
  }

  const waiting = cards.filter((c) => !c.rolled)
  const rows: (typeof cards) = [...waiting.slice(0, 3), ...pending]
  const band = condBand ?? { lo: 0.05, hi: 400 }

  return (
    <div>
      <div className="small muted" style={{ marginBottom: 6 }}>
        Rolling conditions — {done}/{total} settled · {waiting.length} glimpses already showing
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map((c) => {
            const idx = c.rolled ? pending.indexOf(c) : -1
            const settled = idx >= 0 && idx < done
            const face = !c.rolled ? c.condition : settled ? c.condition : ROLL_CYCLE[spin % ROLL_CYCLE.length]
            return (
              <tr key={c.card_id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                <td style={{ width: 44, padding: '4px 0' }}><CardImg src={c.image_small} alt={c.name} cardId={c.card_id} /></td>
                <td>
                  <b className="small">{c.name}</b>
                  <div className="faint small">{c.set_name}</div>
                </td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }} className="small">
                  <span style={{ fontWeight: 800, color: settled ? COND_COLOR(face) : 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{face}</span>
                  <div className="faint" style={{ fontSize: 10 }}>{settled ? fmtUsd(c.price) : `$${band.lo.toFixed(2)}–${band.hi.toFixed(0)}`}</div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function NegotiationRow({ s, onDone, onReveal }: { s: EstateSaleListing; onDone: () => void; onReveal: (r: EstateBuyoutResult) => void }) {
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

  const counterLine = (r: any) => {
    setReply(r.message ?? '')
    if (r.finalSaid) toast('That\u2019s their final number — another lowball and they walk.', 'info')
  }

  return (
    <div style={{ marginTop: 8, borderTop: '1px solid var(--border-soft)', paddingTop: 8 }}>
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <input
          type="text"
          inputMode="decimal"
          placeholder={s.yourOffer ? `Last offer: $${s.yourOffer.toFixed(2)}` : `Under $${s.ask.toFixed(2)}`}
          value={offer}
          onChange={(e) => setOffer(e.target.value)}
          style={{ width: 110 }}
        />
        <button
          className="primary"
          disabled={busy || !Number(offer)}
          onClick={() =>
            run(async () => api.estateOffer(s.id, Number(offer)), (r: any) => {
              if (r.ok && r.accepted) {
                toast(r.message, 'good')
                refreshState()
                onDone()
                return
              }
              if (r.ok) counterLine(r)
              else toast(r.error ?? 'Rejected', 'bad')
            })
          }
        >
          Offer
        </button>
        <button
          disabled={busy}
          onClick={() =>
            run(() => api.estateBuyout(s.id), (r: EstateBuyoutResult & { error?: string }) => {
                if (r.ok) {
                  toast(`Bought out ${s.seller_name} — ${fmtUsd(r.paid)}.`, 'good')
                  refreshState()
                  onDone()
                  onReveal(r)
                } else toast(r.error ?? 'Rejected', 'bad')
              })
          }
        >
          💰 Pay {fmtUsd(s.dealPrice ?? s.ask)}
        </button>
        {s.finalSaid && (
          <button
            disabled={busy}
            onClick={() =>
              run(() => api.estateApologize(s.id), (r: any) => {
                if (r.ok) { toast(r.message ?? 'They\u2019ll hear you out.', 'good'); setReply(null) }
                else toast(r.error ?? 'Nothing to apologize for.', 'bad')
              })
            }
          >
            🙇 Apologize
          </button>
        )}
      </div>
      {s.dealPrice != null && s.dealPrice < s.ask && (
        <div className="small" style={{ marginTop: 6, color: 'var(--green)' }}>
          🤝 Deal sealed at <b>{fmtUsd(s.dealPrice)}</b> — that is what the Pay button charges.
        </div>
      )}
      {reply && <div className="small" style={{ marginTop: 6, color: 'var(--accent, #9db4ff)' }}>{reply}</div>}
    </div>
  )
}

function RevealModal({ r, onClose }: { r: EstateBuyoutResult; onClose: () => void }) {
  const pct = r.pct ?? 0
  const rolling = (r.rolledCount ?? 0) > 0
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div className="panel" style={{ maxWidth: 680, maxHeight: '84vh', overflow: 'auto', margin: 16 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>The inherited binder</h2>
        <div className="small muted" style={{ marginBottom: 10 }}>
          Paid <b>{fmtUsd(r.paid ?? 0)}</b> · the heirs claimed {fmtUsd(r.estimate ?? 0)} · it appraises at <b style={{ color: (r.profit ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtUsd(r.realized ?? 0)}</b>{' '}
          ({pct >= 0 ? '+' : ''}{pct}%){rolling ? ' · conditions rolled as the binder opened' : ''}
        </div>
        <div className="panel" style={{ padding: '10px 12px', background: 'var(--panel2)', marginBottom: 10 }}>
          <b>{r.verdict ?? ''}</b>
          {(r.leftBehind ?? 0) > 0 && (
            <div className="small muted" style={{ marginTop: 4 }}>
              The shelf held {r.admitted ?? 0} cards — {r.leftBehind} stayed with the estate. Cash is spent either way; that's the deal you made.
            </div>
          )}
        </div>
        <RollStack cards={r.cards ?? []} condBand={r.condBand} />
        <button className="primary mt14" onClick={onClose}>Into the collection →</button>
      </div>
    </div>
  )
}

export function EstateSalesView() {
  const [data, setData] = useState<EstateBuyoutsSection | null>(null)
  const [reveal, setReveal] = useState<EstateBuyoutResult | null>(null)

  const load = () => api.estateSales().then(setData).catch(() => {})
  useEffect(() => { load() }, [])

  const open = data?.listings ?? []
  const st = data?.stats

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>📑 Estate Buyouts</h1>
          <div className="sub">Whole collections, one photo, one number. What you see is the top of the stack — the rest you inherit.</div>
        </div>
      </div>

      <FirstUseTip surface="estate">
        Heirs price from <b>grief and Facebook posts</b>, not comps — the ask can be way over or (rarely) way under what the
        collection is worth. The photo shows <b>2–3 real cards</b> from the stack; strong tops can hide junk, and whale hunts
        hide behind weak tops. <b>Offers are welcome</b>: two counters, then their final number — lowball past that and they
        walk (🙇 apologizing gets you one more conversation). Pay the ask to close instantly. The collection lands in your
        vault at an even per-card cost basis — make shelf room first.
      </FirstUseTip>

      {st && st.bought > 0 && (
        <div className="panel mb14" style={{ padding: '10px 14px' }}>
          <div className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="small"><b>{st.bought}</b> <span className="muted">buyouts</span></span>
            <span className="small"><b>{st.cardsInherited}</b> <span className="muted">cards inherited</span></span>
            <span className="small"><span className="muted">spent</span> <b>{fmtUsd(st.spent)}</b></span>
            <span className="small"><span className="muted">now worth</span> <b>{fmtUsd(st.realized)}</b></span>
            <span className="small" style={{ color: st.net >= 0 ? 'var(--green)' : 'var(--red)' }}>
              <span className="muted">net</span> <b>{st.net >= 0 ? '+' : ''}{fmtUsd(st.net)}</b>
            </span>
          </div>
        </div>
      )}

      {data === null ? (
        <EmptyState icon="📑" text="Reading the probate notices…" sub="Who\u2019s selling, what they want, and what the photo shows." />
      ) : open.length === 0 ? (
        <EmptyState
          icon="🗂"
          text="No estates on the market"
          sub="Probate moves slowly. New collections surface on the game clock — and other collectors read the same notices."
        />
      ) : (
        open.map((s) => (
          <div className="panel mb14" key={s.id}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <b>{s.seller_name}</b>{' '}
                <span className="badge">{s.persona_label}</span>{' '}
                <span title={`mood ${s.mood}/100`}>{MOOD_FACE(s.mood)}</span>
                <div className="faint small">{s.persona_blurb}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{fmtUsd(s.dealPrice ?? s.ask)}</div>
                {s.dealPrice != null && s.dealPrice < s.ask && (
                  <div className="small" style={{ color: 'var(--green)' }} title="They shook on this — the ask is off the table">
                    🤝 agreed · <span className="faint" style={{ textDecoration: 'line-through' }}>{fmtUsd(s.ask)}</span>
                  </div>
                )}
                {s.ask < s.opening_ask && <div className="faint small">opened at {fmtUsd(s.opening_ask)}</div>}
                <div className="faint small">{s.card_count} cards · {s.hoursLeft < 36 ? `${s.hoursLeft}h left` : `${Math.round(s.hoursLeft / Math.max(1, s.hoursPerGameDay))} game-days left`}</div>
              </div>
            </div>

            {s.refusal && (
              <div className="small" style={{ margin: '4px 0', padding: '6px 10px', borderRadius: 6, background: 'rgba(120,170,255,0.10)', border: '1px solid rgba(120,170,255,0.4)', color: 'var(--accent, #9db4ff)' }}>
                📩 <b>First refusal</b> — the heirs are holding this lot for you until tomorrow. Move before it goes public to everyone.
              </div>
            )}

            <div className="small muted" style={{ margin: '6px 0' }}>
              {s.glimpse_note}
            </div>
            <GlimpseStrip g={s.glimpses} behind={Math.max(0, s.card_count - s.glimpses.length)} />

            <NegotiationRow s={s} onDone={load} onReveal={(r) => setReveal(r)} />
          </div>
        ))
      )}

      {reveal && <RevealModal r={reveal} onClose={() => { setReveal(null) }} />}
    </div>
  )
}
