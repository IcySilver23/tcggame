import { useEffect, useState } from 'react'
import { api } from '../api'
import type { YardCard, YardOfferResult, YardPickResult, YardSaleRow, YardSection, YardBoxResult } from '../api'
import { useStore } from '../store'
import { CardImg, EmptyState, FirstUseTip, fmtUsd, TipList } from '../components'

// ---------------------------------------------------------------------------
// 🛗 YARD SALES — roadmap 6.0: "read the table".
//
// Sibling to the Flea Market (same in-person-bargain DNA) but the opposite
// verb: the flea charges one flat price and you DIG, here every pile has its
// own vibes-priced ask and a one-line PEEK that is the only data you get.
// So the screen is a driveway — a tablecloth of piles where the peek is the
// headline, the ask is a hand-written price tag, and haggling happens in a
// thread with the seller (two counters, then they wave you off).
//
// Mechanics are untouched: same /api/yard payload, same rigidity/counter
// math on the server, same weekend window, same mystery box.
// ---------------------------------------------------------------------------

type Say = { kind: 'counter' | 'nah'; amount?: number; text: string }

/** `4h 12m` / `12m 03s` — the window clock. It has to actually move. */
function until(target: string, now: number): { text: string; soon: boolean; done: boolean } {
  const ms = new Date(target).getTime() - now
  if (ms <= 0) return { text: 'packed up', soon: false, done: true }
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  if (h > 0) return { text: `${h}h ${String(m).padStart(2, '0')}m left`, soon: h < 1, done: false }
  return { text: `${m}m ${String(s).padStart(2, '0')}s left`, soon: true, done: false }
}

// --- one pile on the table --------------------------------------------------

function Pile({
  c,
  expired,
  busy,
  offer,
  say,
  setOffer,
  onOffer,
  onBuy,
}: {
  c: YardCard
  expired: boolean
  busy: boolean
  offer: string
  say: Say | undefined
  setOffer: (v: string) => void
  onOffer: (rowId: number, amt: number) => void
  onBuy: (rowId: number) => void
}) {
  const myOffer = Number(offer) || 0
  return (
    <article className="ys-pile">
      {/* The peek IS the data — no name, no image, no market column. */}
      <p className="ys-peek">{c.peek}</p>

      <div className="ys-tag" aria-label={`Asking ${fmtUsd(c.ask)}`}>
        <span className="ys-tag-cond">{c.condition}{c.qty > 1 ? ` ×${c.qty}` : ''}</span>
        <b className="ys-tag-ask">{fmtUsd(c.ask)}</b>
      </div>

      {say && (
        <div className={`ys-say ${say.kind}`}>
          {say.kind === 'counter' ? (
            <>“Best I'll do is <b>{fmtUsd(say.amount ?? 0)}</b>.”</>
          ) : (
            <>{say.text}</>
          )}
        </div>
      )}

      <div className="ys-haggle">
        <input
          className="ys-offer-in"
          inputMode="decimal"
          placeholder={`offer ${Math.max(1, Math.round(c.ask * 0.7))}`}
          value={offer}
          disabled={expired || busy}
          aria-label={`Your offer on this pile (asking ${fmtUsd(c.ask)})`}
          onChange={(e) => setOffer(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && myOffer > 0) onOffer(c.id, myOffer) }}
        />
        <button
          className="ys-offer"
          disabled={expired || busy || myOffer <= 0}
          title="Talk them down — they counter twice at most, then they wave you off"
          onClick={() => onOffer(c.id, myOffer)}
        >
          Offer
        </button>
        <button
          className="ys-sticker"
          disabled={expired || busy}
          title="Pay the sticker — no haggling, nobody gets sore"
          onClick={() => onBuy(c.id)}
        >
          {fmtUsd(c.ask)} sticker
        </button>
      </div>

      {say?.kind === 'counter' && say.amount != null && (
        <button className="ys-take" disabled={expired || busy} onClick={() => onOffer(c.id, say.amount!)}>
          Take {fmtUsd(say.amount)}
        </button>
      )}
    </article>
  )
}

// --- one driveway -----------------------------------------------------------

function Driveway({
  s,
  now,
  busy,
  offers,
  says,
  setOffer,
  onOffer,
  onBuy,
  onBox,
}: {
  s: YardSaleRow
  now: number
  busy: boolean
  offers: Record<number, string>
  says: Record<number, Say>
  setOffer: (rowId: number, v: string) => void
  onOffer: (rowId: number, amt: number) => void
  onBuy: (rowId: number) => void
  onBox: () => void
}) {
  const left = until(s.closesAt, now)
  const expired = s.expired || left.done
  const counters = s.sellerCounters

  return (
    <section className={`ys-drive ${expired ? 'done' : ''}`} aria-label={`${s.seller}, ${s.neighborhood}`}>
      <header className="ys-head">
        <div className="ys-head-main">
          <div className="ys-seller">🛗 {s.seller}</div>
          <div className="ys-hood">
            {s.neighborhood} · {s.table.length} pile{s.table.length === 1 ? '' : 's'} on the table
          </div>
        </div>

        <div className="ys-haggle-state" title="Sellers counter twice at most — after that they sour">
          {counters === 0 ? '🙂 fresh — nobody has haggled yet' : `🗣 ${counters}/2 counters used`}
        </div>

        <div className="ys-clock" data-soon={left.soon || undefined}>
          <span className="ys-clock-num">{left.text}</span>
          <span className="ys-clock-lbl">{left.done ? 'the table is in the garage' : 'until they bring it in'}</span>
        </div>
      </header>

      {s.table.length === 0 ? (
        <p className="ys-bare">🫥 The table's bare — somebody read it before you.</p>
      ) : (
        <div className="ys-table">
          {s.table.map((c) => (
            <Pile
              key={c.id}
              c={c}
              expired={expired}
              busy={busy}
              offer={offers[c.id] ?? ''}
              say={says[c.id]}
              setOffer={(v) => setOffer(c.id, v)}
              onOffer={onOffer}
              onBuy={onBuy}
            />
          ))}
        </div>
      )}

      {s.boxAsk != null && !s.boxTaken && !expired && (
        <div className="ys-box">
          <div className="ys-box-art" aria-hidden>📦</div>
          <div className="ys-box-txt">
            <b>Mystery box in the garage</b>
            <span className="faint small">{s.boxCount} cards, taped shut, no peek — {fmtUsd(s.boxAsk)} takes it</span>
          </div>
          <button className="primary" disabled={busy} onClick={onBox}>
            Take the box — {fmtUsd(s.boxAsk)}
          </button>
        </div>
      )}
      {s.boxTaken && <p className="ys-boxgone faint small">📦 the box went home with somebody.</p>}
    </section>
  )
}

// --- the view ---------------------------------------------------------------

export function YardSalesView() {
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<YardSection | null>(null)
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)
  const [offers, setOffers] = useState<Record<number, string>>({})
  const [says, setSays] = useState<Record<number, Say>>({})
  const [reveal, setReveal] = useState<YardBoxResult | null>(null)
  // A table buy used to end in a toast, which is not an answer to "what did I
  // just carry home?" — this is the card, its condition, and what it is worth.
  const [pick, setPick] = useState<YardPickResult | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const load = () => {
    api.yard().then((d) => { setData(d); setErr(false) }).catch(() => setErr(true))
  }
  useEffect(() => { load() }, [])

  // The window is the tension — the clock has to actually move.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const run = async (fn: () => Promise<any>, okMsg: (r: any) => string) => {
    setBusy(true)
    try {
      const r = await fn()
      if (r.ok === false) { toast(r.error ?? 'Rejected', 'bad'); return r }
      const msg = okMsg(r)
      if (msg) toast(msg, 'good')
      refreshState()
      load()
      return r
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'bad')
      return null
    } finally {
      setBusy(false)
    }
  }

  /** Offer → accept, counter, or a door shut in your face. All three are talk. */
  const offer = async (rowId: number, amt: number) => {
    const r = (await run(
      () => api.yardOffer(rowId, amt),
      (res) => (res.accepted ? `Sold — ${res.card} for ${fmtUsd(res.paid ?? 0)}.` : ''),
    )) as YardOfferResult | null
    if (!r || r.ok === false) return
    if (r.accepted) {
      setSays((s) => { const n = { ...s }; delete n[rowId]; return n })
      setOffers((o) => ({ ...o, [rowId]: '' }))
      setPick(r)
      return
    }
    setSays((s) => ({
      ...s,
      [rowId]: r.counter
        ? { kind: 'counter', amount: r.counter, text: r.message ?? '' }
        : { kind: 'nah', text: r.message ?? "“Nah, I know what I've got.”" },
    }))
    if (!r.counter) toast(r.message ?? 'They passed.', 'info')
  }

  const buy = async (rowId: number) => {
    // No toast: the reveal is the receipt.
    const r = (await run(() => api.yardBuy(rowId), () => '')) as YardPickResult | null
    if (r && r.ok) setPick(r)
  }

  const openBox = (s: YardSaleRow) =>
    run(() => api.yardBox(s.id), () => 'Box paid — tear it open.').then((r: any) => {
      if (r && r.ok && r.cards) setReveal(r)
    })

  // --- states: failure / loading / closed (roadmap 13.0) -------------------

  if (err && !data) {
    return (
      <EmptyState
        icon="📡"
        text="Couldn't reach the street"
        sub="The driveway feed didn't come back. Nothing was spent."
        action={{ label: 'Try again', onClick: load }}
      />
    )
  }

  if (!data) {
    return (
      <div className="ys-loading">
        {[0, 1, 2, 3, 4, 5].map((i) => <div className="ys-pile skeleton" key={i} />)}
      </div>
    )
  }

  const sales = data.sales

  return (
    <div className="ys">
      <div className="page-head">
        <div>
          <h1>🛗 Yard Sales</h1>
          <div className="sub">Saturday-morning driveways. Nobody prices from a database — read the table, make an offer, and grab it before somebody else does.</div>
        </div>
      </div>

      <FirstUseTip surface="yard">
        <TipList
          title="🛗 The peek is the whole game"
          items={[
            { icon: '📖', label: 'Read the peek', text: <>one line per pile, calibrated around <b>30% of true value</b> — no names, no prices to check against</> },
            { icon: '🎲', label: 'Vibes pricing', text: <>most households guess wildly: some piles are <b>4× over</b>, a few are <b>near-giveaways</b>, 1 in 8 prices it right</> },
            { icon: '🗣', label: 'Haggle carefully', text: <>they counter <b>twice at most</b>, then they sour — pay the sticker to stay friendly</> },
            { icon: '📦', label: 'The box', text: <>some garages run a <b>mystery box</b>: flat price, contents unknown until you pay</> },
            { icon: '🕗', label: 'Weekends only', text: <>windows last hours — <b>by Sunday evening the driveways are bare</b></> },
          ]}
        />
      </FirstUseTip>

      {data && !data.isWeekend && sales.length > 0 && (
        <div className="faint small" style={{ marginBottom: 10 }}>
          It's a weekday — only the stray driveway is out. Real volume comes Saturday and Sunday morning.
        </div>
      )}

      {sales.length === 0 ? (
        <EmptyState
          icon="🛗"
          text={data.isWeekend ? 'No driveways out right now' : "The street is quiet — it's a weekday"}
          sub={
            data.isWeekend
              ? 'Card tables go up in the morning. Check the Calendar for what else is on this weekend.'
              : 'Real volume comes Saturday and Sunday morning — only the stray driveway is out midweek.'
          }
        />
      ) : (
        sales.map((s) => (
          <Driveway
            key={s.id}
            s={s}
            now={now}
            busy={busy}
            offers={offers}
            says={says}
            setOffer={(rowId, v) => setOffers((o) => ({ ...o, [rowId]: v }))}
            onOffer={(rowId, amt) => void offer(rowId, amt)}
            onBuy={buy}
            onBox={() => openBox(s)}
          />
        ))
      )}

      {pick && (
        <div className="ys-reveal-back" onClick={() => setPick(null)}>
          <div className="ys-reveal" role="dialog" aria-label="What you carried home" onClick={(e) => e.stopPropagation()}>
            <div className="ys-reveal-head">
              <b>🛗 What you carried home</b>
              <button className="ghost small" onClick={() => setPick(null)}>close</button>
            </div>
            <div className="ys-pick">
              <CardImg src={null} alt={pick.card ?? 'the pile'} cardId={pick.cardId} className="ys-pick-art" />
              <div className="ys-pick-info">
                <b>{pick.card}</b>
                <span className="faint small">
                  {pick.condition}{pick.qty && pick.qty > 1 ? ` ×${pick.qty}` : ''} · off a driveway table
                </span>
                <span className="faint small">Paid at the sticker, no haggling.</span>
              </div>
            </div>
            <div className="ys-reveal-tally">
              <span>paid <b>{fmtUsd(pick.paid ?? 0)}</b></span>
              <span>worth <b>{fmtUsd(pick.value ?? 0)}</b></span>
              <span className={(pick.value ?? 0) >= (pick.paid ?? 0) ? 'pw-ok' : 'pw-bad'}>
                {(pick.value ?? 0) >= (pick.paid ?? 0) ? '+' : '−'}
                {fmtUsd(Math.abs((pick.value ?? 0) - (pick.paid ?? 0)))}
                {(pick.value ?? 0) >= (pick.paid ?? 0) ? ' under market' : ' over market'}
              </span>
            </div>
            <div className="faint small">It's in your binder now — acquired at a yard sale.</div>
          </div>
        </div>
      )}

      {reveal && reveal.ok && reveal.cards && (
        <div className="ys-reveal-back" onClick={() => setReveal(null)}>
          <div className="ys-reveal" role="dialog" aria-label="The box, torn open" onClick={(e) => e.stopPropagation()}>
            <div className="ys-reveal-head">
              <b>📦 The box, torn open</b>
              <button className="ghost small" onClick={() => setReveal(null)}>close</button>
            </div>
            <div className="ys-reveal-tally">
              <span>paid <b>{fmtUsd(reveal.paid ?? 0)}</b></span>
              <span>
                worth <b>{fmtUsd(reveal.trueTotal ?? 0)}</b>
              </span>
              <span className={(reveal.trueTotal ?? 0) >= (reveal.paid ?? 0) ? 'pw-ok' : 'pw-bad'}>
                {(reveal.trueTotal ?? 0) >= (reveal.paid ?? 0) ? '+' : '−'}
                {fmtUsd(Math.abs((reveal.trueTotal ?? 0) - (reveal.paid ?? 0)))}
                {(reveal.trueTotal ?? 0) >= (reveal.paid ?? 0) ? ' under' : ' over'}
              </span>
            </div>
            <ul className="ys-reveal-list">
              {reveal.cards.slice().sort((a, b) => b.value - a.value).map((c, i) => (
                <li key={i}>
                  <b>{c.name}</b>
                  <span className="faint">{c.condition}{c.qty > 1 ? ` ×${c.qty}` : ''}</span>
                  <b className="ys-reveal-val">{fmtUsd(c.value)}</b>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
