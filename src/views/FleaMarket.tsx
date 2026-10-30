import { useEffect, useState } from 'react'
import { api } from '../api'
import type { FleaSection, FleaMarketRow, FleaBin, FleaDigResult } from '../api'
import type { ActivityRow } from '../types'
import { useStore } from '../store'
import { CardImg, ConditionBadge, EmptyState, fmtUsd } from '../components'

// ---------------------------------------------------------------------------
// 🛒 Flea Markets — roadmap 4.x: "the bins ARE the UI".
//
// It used to be a header, a paragraph and a <table> of bins with a Dig button
// in the last column — which is exactly the shape every other venue already
// had (problem 1 in the roadmap: screens that blur together). The verb here is
// DIG, and a dig is a physical act, so the screen is now a ground: bins as
// objects you can see filling up, a clock counting the grounds down, and a
// live feed of what the pickers just took out from under you.
//
// Nothing about the economy moved. Same flat prices, same 3% gold chance,
// same 15–120× score pool, same picker drain, same counterfeit risk stamp.
// The only server change is that the dig reply now carries cardId so the
// reveal can show the card it actually gave you.
// ---------------------------------------------------------------------------

type Reveal = FleaDigResult & { binPrice: number }

const priceColor = (p: number) =>
  p === 0.25 ? 'var(--green)' : p === 0.5 ? 'var(--blue)' : p === 1 ? 'var(--violet)' : p === 2 ? 'var(--amber)' : 'var(--red)'

function ago(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

/** `4h 12m` / `12m 03s` — the grounds clock. */
function until(target: string, now: number): { text: string; soon: boolean; done: boolean } {
  const ms = new Date(target).getTime() - now
  if (ms <= 0) return { text: 'packed up', soon: false, done: true }
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  if (h > 0) return { text: `${h}h ${String(m).padStart(2, '0')}m left`, soon: h < 1, done: false }
  return { text: `${m}m ${String(s).padStart(2, '0')}s left`, soon: true, done: false }
}

// --- the ground header ------------------------------------------------------

function GroundHead({ m, now }: { m: FleaMarketRow; now: number }) {
  const left = until(m.closesAt, now)
  const totalLeft = m.bins.reduce((a, b) => a + b.remaining, 0)
  const liveBins = m.bins.filter((b) => b.remaining > 0).length
  // pickerTick() runs on every server tick against ANY live market — it never
  // checks the calendar. So "pickers digging" is true exactly while the
  // grounds are open, weekday or not.
  const digging = !left.done
  return (
    <header className={`flea-head ${left.done ? 'done' : ''}`}>
      <div className="flea-head-main">
        <div className="flea-grounds">
          <span aria-hidden>🛒</span> {m.grounds}
        </div>
        <div className="flea-head-sub">
          <b>{totalLeft}</b> cards in <b>{liveBins}</b> bins · flat price, dig one at a time · cash only
        </div>
      </div>

      <div className="flea-clock" data-soon={left.soon || undefined} aria-live="off">
        <span className="flea-clock-num">{left.text}</span>
        <span className="flea-clock-lbl">{left.done ? 'the trucks are loaded' : 'until the grounds close'}</span>
      </div>

      <div className={`flea-pickers ${digging ? 'on' : ''}`}>
        <span className="flea-dot" aria-hidden />
        {digging ? 'pickers digging' : 'packing up'}
      </div>
    </header>
  )
}

// --- one bin ----------------------------------------------------------------

function BinCard({
  b,
  digging,
  onDig,
}: {
  b: FleaBin
  digging: number | null
  onDig: (b: FleaBin) => void
}) {
  const pct = b.total > 0 ? Math.round((b.remaining / b.total) * 100) : 0
  const empty = b.remaining === 0
  const busy = digging === b.id
  return (
    <article className="flea-bin" data-empty={empty || undefined}>
      {/* The cardboard price sign — taped to the front of the box. */}
      <div className="flea-sign" style={{ '--sign': priceColor(b.price) } as React.CSSProperties}>
        <span className="flea-sign-price">{fmtUsd(b.price)}</span>
        <span className="flea-sign-ea">each</span>
      </div>

      <div className="flea-bin-label">{b.label}</div>

      <div className="flea-gauge" title={`${b.remaining} of ${b.total} left`}>
        <div className="flea-gauge-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="flea-bin-foot">
        <span className={`flea-count ${empty ? 'gone' : ''}`}>
          {empty ? 'picked clean' : `${b.remaining}/${b.total} left`}
        </span>
        {b.hotScores > 0 && (
          <span className="flea-hot" title="Cards still in this bin worth 20×+ the bin price">
            🔥 {b.hotScores}
          </span>
        )}
      </div>

      <button
        className="flea-dig"
        disabled={busy || empty}
        onClick={() => onDig(b)}
        style={empty ? undefined : ({ '--dig': priceColor(b.price) } as React.CSSProperties)}
      >
        {busy ? 'Digging…' : empty ? 'Picked clean' : <>Dig {fmtUsd(b.price)}</>}
      </button>
    </article>
  )
}

// --- live ticker: what just left the tables --------------------------------

function Ticker({ feed, now }: { feed: ActivityRow[]; now: number }) {
  return (
    <section className="flea-card">
      <h3 className="flea-card-h">Just went</h3>
      {feed.length === 0 ? (
        <p className="flea-empty">Nothing pulled yet. The 6 AM crew is still on their coffee.</p>
      ) : (
        <ul className="flea-feed">
          {feed.slice(0, 7).map((e) => (
            <li key={e.id}>
              <span className="flea-feed-time">{ago(e.created_at, now)}</span>
              <span className="flea-feed-msg">{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// --- your digs --------------------------------------------------------------

function Digs({ digs, now }: { digs: FleaSection['myDigs']; now: number }) {
  return (
    <section className="flea-card">
      <h3 className="flea-card-h">Your digs <span className="badge">{digs.length}</span></h3>
      {digs.length === 0 ? (
        <p className="flea-empty">You haven't pulled anything yet.</p>
      ) : (
        <ul className="flea-digs">
          {digs.map((d, i) => {
            const mult = d.paid > 0 ? d.trueMarket / d.paid : 0
            return (
              <li key={i}>
                <div className="flea-dig-name">{d.name}</div>
                <div className="flea-dig-meta">
                  <ConditionBadge cond={d.condition} />
                  <span className="flea-dig-paid">{fmtUsd(d.paid)} paid</span>
                  <span className="flea-dig-comps">~{fmtUsd(d.trueMarket)}</span>
                  <span
                    className={`flea-mult ${mult >= 10 ? 'score' : mult >= 1 ? 'good' : 'bad'}`}
                    title="Comps ÷ what you paid"
                  >
                    {d.paid > 0 ? `${mult.toFixed(1)}×` : '—'}
                  </span>
                </div>
                <div className="flea-dig-when">{ago(d.at, now)}</div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// --- the reveal -------------------------------------------------------------

function RevealModal({ r, onClose }: { r: Reveal; onClose: () => void }) {
  const { refreshState } = useStore()
  const mult = r.binPrice > 0 ? r.trueMarket / r.binPrice : 0
  const isScore = mult >= 10
  const isFair = mult >= 1 && !isScore
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose()
          refreshState()
        }
      }}
    >
      <div className={`flea-reveal ${isScore ? 'score' : ''}`} role="dialog" aria-label={`You pulled ${r.name}`}>
        <div className="flea-reveal-tag">{isScore ? '🔥 SCORE' : isFair ? '🤝 Fair pull' : '🛒 Out of the bin'}</div>

        <div className="flea-reveal-art">
          {r.cardId ? (
            <CardImg src={null} alt={r.name} className="flea-reveal-img" cardId={r.cardId} />
          ) : (
            <div className="flea-reveal-noart">🃏</div>
          )}
        </div>

        <div className="flea-reveal-name">{r.name}</div>
        <div className="flea-reveal-cond">
          <ConditionBadge cond={r.condition} />
        </div>

        <div className="flea-reveal-nums">
          <div>
            <span>Paid</span>
            <b>{fmtUsd(r.paid)}</b>
          </div>
          <div>
            <span>Comps</span>
            <b>~{fmtUsd(r.trueMarket)}</b>
          </div>
          <div>
            <span>Multiple</span>
            <b className={isScore ? 'score' : isFair ? 'good' : 'bad'}>
              {r.paid > 0 ? `${mult.toFixed(1)}×` : '—'}
            </b>
          </div>
        </div>

        <p className="flea-reveal-note">
          {isScore
            ? `That card was worth ${Math.round(mult)}× the bin. Somebody was going to find it.`
            : isFair
              ? 'Pays for itself and then some — the bin was honest with you.'
              : mult >= 0.5
                ? 'Not a find. The bin was priced about right.'
                : 'You paid more than it is worth. That is what the bins are for.'}
        </p>

        <button
          className="primary"
          onClick={() => {
            onClose()
            refreshState()
          }}
        >
          Back to the bins
        </button>
      </div>
    </div>
  )
}

// --- the view ---------------------------------------------------------------

export function FleaMarketView() {
  const { toast } = useStore()
  const [data, setData] = useState<FleaSection | null>(null)
  const [feed, setFeed] = useState<ActivityRow[]>([])
  const [err, setErr] = useState(false)
  const [digging, setDigging] = useState<number | null>(null)
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const load = () => {
    api
      .flea()
      .then((d) => {
        setData(d)
        setErr(false)
      })
      .catch(() => setErr(true))
    api
      .activity()
      .then((rows) => setFeed(rows.filter((r) => r.kind === 'flea')))
      .catch(() => {})
  }

  useEffect(() => {
    load()
  }, [])

  // The grounds clock is the tension — it has to actually move.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // The bins breathe: pickers drain them while you read the table.
  const anyLive = (data?.markets ?? []).some((m) => !m.expired)
  useEffect(() => {
    if (!anyLive) return
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [anyLive])

  const dig = async (bin: FleaBin) => {
    setDigging(bin.id)
    try {
      const r = await api.fleaDig(bin.id)
      if (r.ok && r.card) {
        setReveal({ ...r.card, binPrice: bin.price })
      } else {
        toast(r.error ?? 'The bin is empty', 'bad')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Dig failed', 'bad')
    }
    setDigging(null)
    load()
  }

  const markets = data?.markets ?? []
  const side = feed.length > 0 || (data?.myDigs ?? []).length > 0

  // --- states: loading / failure / closed / live (roadmap 13.0) -----------

  if (err && !data) {
    return (
      <EmptyState
        icon="📡"
        text="Couldn't reach the flea"
        sub="The grounds feed didn't come back. Nothing was spent."
        action={{ label: 'Try again', onClick: load }}
      />
    )
  }

  if (!data) {
    return (
      <div className="flea-loading">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div className="flea-bin skeleton" key={i} />
        ))}
      </div>
    )
  }

  // A market can be live on a weekday (it spawns over a weekend and runs to
  // Sunday night), so "is it the weekend" only decides the CLOSED message —
  // it must never hide grounds that are actually open.
  const closedNote = data.isWeekend ? (
    <EmptyState
      icon="🛒"
      text="No grounds are open right now"
      sub="Flea markets pop up weekend mornings. They don't announce themselves — keep an eye on the feed."
    />
  ) : (
    <EmptyState
      icon="🛒"
      text="The flea grounds are closed — it's a weekday"
      sub={`Markets spawn weekend mornings from ${data.openHour}:00 AM, and the 6 AM crew takes the good stuff first. Check the Calendar for what's live.`}
    />
  )

  if (markets.length === 0 && !side) return closedNote

  return (
    <div className="flea">
      {markets.map((m) => (
        <div key={m.id} className="flea-market">
          <GroundHead m={m} now={now} />
          <div className="flea-bins">
            {m.bins.map((b) => (
              <BinCard key={b.id} b={b} digging={digging} onDig={dig} />
            ))}
          </div>
        </div>
      ))}

      {markets.length === 0 && closedNote}

      {side && (
        <div className="flea-side">
          <Ticker feed={feed} now={now} />
          <Digs digs={data.myDigs ?? []} now={now} />
        </div>
      )}

      {reveal && <RevealModal r={reveal} onClose={() => setReveal(null)} />}
    </div>
  )
}
