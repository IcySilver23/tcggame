import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { gameDayMsFor } from '../lib/gameday'
import type { LendingDesk as LendingDeskData, PawnSection, PawnQuoteRow } from '../api'
import { useStore } from '../store'
import { CardImg, EmptyState, FirstUseTip, fmtUsd, LoadFailure, TipList } from '../components'

// ---------------------------------------------------------------------------
// 💠 THE GOLD EXCHANGE — rebuilt as "a counter with a clock" (roadmap 4.0).
//
// The verb here is HOCK: cash now against a card you intend to get back. So
// the screen's main object is the ticket in your pocket and the clock running
// on it — the quotes are the counter you walk up to *after* you know what a
// loan costs. Mechanics are untouched: same /api/pawn payload, same three
// actions (sell, hock, redeem), same case and history.
// ---------------------------------------------------------------------------

function daysLeft(dueAt: string, hours: 12 | 24 = 12): number {
  return Math.ceil((new Date(dueAt).getTime() - Date.now()) / gameDayMsFor(hours))
}

const dayLabel = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** A number too small to print must not print as nothing — a pawn shop runs on cents. */
const money = (n: number) => (n > 0 && n < 0.01 ? '<$0.01' : fmtUsd(n))

// --- the clock: one ticket per active loan ----------------------------------

function Ticket({
  l,
  days,
  rateDaily,
  busy,
  onRedeem,
}: {
  l: PawnSection['loans'][number]
  days: number
  rateDaily: number
  busy: boolean
  onRedeem: () => void
}) {
  const dl = daysLeft(l.due_at)
  const late = dl <= 0
  const soon = !late && dl <= 3
  // Term used up — the meter is how much of the 30 days you have already burned.
  const used = Math.max(0, Math.min(1, (days - Math.max(0, dl)) / days))
  const perDay = l.principal * rateDaily
  return (
    <article className={`pw-ticket ${late ? 'late' : soon ? 'soon' : ''}`}>
      <div className="pw-ticket-stub" aria-hidden>
        <span className="pw-ticket-no">#{l.id}</span>
        <span className="pw-ticket-sep" />
        <span className="pw-ticket-date">{dayLabel(l.issued_at)}</span>
      </div>

      <div className="pw-ticket-body">
        <div className="pw-ticket-top">
          <b title={l.card}>{l.card}</b>
          <span className={`pw-clock ${late ? 'late' : soon ? 'soon' : ''}`}>
            {late ? '⚠ due now' : `${dl}d left`}
          </span>
        </div>

        <div
          className="pw-meter"
          title={`${Math.round(used * 100)}% of the ${days}-day window used`}
          role="img"
          aria-label={`${Math.round(used * 100)}% of the loan window used`}
        >
          <i style={{ width: `${used * 100}%` }} />
        </div>

        <div className="pw-ticket-facts">
          <span>hocked <b>{fmtUsd(l.principal)}</b></span>
          <span className="pw-grow">
            interest <b>+{money(l.interest)}</b>
            <em>≈{money(perDay)}/day</em>
          </span>
          <span>payoff today <b className="pw-due">{fmtUsd(l.total)}</b></span>
          <span className="faint">due {dayLabel(l.due_at)}</span>
        </div>
      </div>

      <div className="pw-ticket-act">
        <button className="primary" disabled={busy} onClick={onRedeem} title="Pay principal plus interest — the card goes straight back in the binder">
          Redeem
        </button>
        <span className="pw-ticket-pay">{fmtUsd(l.total)}</span>
        {late && <span className="pw-ticket-warn">It's in the case — buy it back below</span>}
      </div>
    </article>
  )
}

// --- the view ---------------------------------------------------------------

export function PawnShopView() {
  const { toast, refreshState, openCard } = useStore()
  const [data, setData] = useState<PawnSection | null>(null)
  const [busy, setBusy] = useState(false)
  const [hockAmt, setHockAmt] = useState<Record<number, string>>({})
  const [filter, setFilter] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = (initial = false) => {
    if (initial) setLoadState('loading')
    api.pawn()
      .then((d) => { setData(d); setLoadState('ready') })
      .catch(() => { if (initial) setLoadState('error') })
  }
  useEffect(() => { load(true) }, [])

  const run = async (fn: () => Promise<{ ok: boolean; error?: string; paid?: number; principal?: number }>, okMsg: (r: { paid?: number; principal?: number }) => string) => {
    setBusy(true)
    try {
      const r = await fn()
      if (r.ok) { toast(okMsg(r), 'good'); refreshState(); load() } else toast(r.error ?? 'Rejected', 'bad')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const terms = data?.terms
  const loans = data?.loans ?? []
  const quotes = data?.quotes ?? []
  const shelf = data?.shelf

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle ? quotes.filter((q) => q.name.toLowerCase().includes(needle)) : quotes
  }, [quotes, filter])

  if (loadState === 'error') return <LoadFailure what="the pawn counter" onRetry={() => load(true)} />
  if (!data) return <EmptyState icon="💠" text="Opening the counter…" sub="Reading today's buy list and your tickets." />

  const owedToday = loans.reduce((a, l) => a + l.total, 0)
  const nextDue = loans.length > 0 ? Math.min(...loans.map((l) => daysLeft(l.due_at))) : 0

  return (
    <div className="pw">
      <div className="page-head">
        <div>
          <h1>💠 The Gold Exchange</h1>
          <div className="sub">Instant cash, no questions. Sell outright, or leave the card as collateral and walk out with a ticket.</div>
        </div>
      </div>

      {/* The shop sign — the four numbers every decision on this page is made against. */}
      {terms && (
        <div className="pw-sign" aria-label="Counter terms">
          <span><b>{(terms.rateDaily * 100).toFixed(2)}%</b><em>per game-day</em></span>
          <span><b>{terms.days}</b><em>game-days to pay</em></span>
          <span><b>40%</b><em>of fire-sale, hocked</em></span>
          <span><b>{terms.graceDays}</b><em>days grace, then default</em></span>
          <span><b>{terms.shelfMarkup}×</b><em>if you default</em></span>
        </div>
      )}

      <FirstUseTip surface="pawn">
        <TipList
          title="💠 The pawn math is honest — and rough"
          items={[
            { icon: '💵', label: 'Sell outright ≈ 30¢', text: <>they value your card at <b>75% of a quick dump</b>, then offer <b>40% of that</b> — cash now</> },
            { icon: '🔑', label: 'Hock it instead', text: <>leave the card in the case and walk out with a <b>30-game-day loan</b> at <b>0.75% a day, compounded</b></> },
            { icon: '✅', label: 'Pay on time', text: <>the ticket clears and the card comes home</> },
            { icon: '⏰', label: 'Miss the date', text: <>it goes in the case at a <b>25% markup</b>, first come first served — you can buy your own card back like any stranger</> },
            { icon: '🀄', label: 'Bare is cheap', text: <>an unsleeved card is valued under a protected one — the counter pays for how it is stored</> },
            { icon: '📓', label: 'Off the books', text: <>the loan shows up nowhere on your net worth. Your conscience still knows</> },
          ]}
        />
      </FirstUseTip>

      {/* --- THE CLOCK ---------------------------------------------------- */}
      <section className="pw-clockwall" aria-label="Your pawn tickets">
        <div className="pw-clockbar">
          <span className="pw-clockbar-ico" aria-hidden>{loans.length > 0 ? '⏰' : '🎫'}</span>
          <div className="pw-clockbar-txt">
            <b>{loans.length > 0 ? `${loans.length} ticket${loans.length === 1 ? '' : 's'} in your pocket` : 'No tickets in your pocket'}</b>
            <span className="faint small">
              {loans.length > 0
                ? `${fmtUsd(data?.outstanding ?? 0)} borrowed · next due in ${nextDue}d · interest compounds every game-day`
                : 'Hock a card from the counter and the clock starts — 30 game-days to get it back.'}
            </span>
          </div>
          {loans.length > 0 && (
            <div className="pw-clockbar-owed">
              <span>owed today</span>
              <b>{fmtUsd(owedToday)}</b>
            </div>
          )}
        </div>

        {loans.length > 0 && (
          <div className="pw-tickets">
            {loans
              .slice()
              .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
              .map((l) => (
                <Ticket
                  key={l.id}
                  l={l}
                  days={terms?.days ?? 30}
                  rateDaily={terms?.rateDaily ?? 0.0075}
                  busy={busy}
                  onRedeem={() => run(() => api.pawnPayoff(l.id), (r) => `Redeemed for ${fmtUsd(r.paid ?? 0)} — card's back in the binder.`)}
                />
              ))}
          </div>
        )}
      </section>

      {/* --- THE COUNTER -------------------------------------------------- */}
      <section className="panel mb14 pw-counter" aria-label="The counter">
        <div className="pw-counter-head">
          <b>🪙 The counter</b>
          <label className="pw-filter">
            <input
              className="input"
              placeholder="Find a card to move…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter your cards"
            />
          </label>
          <span className="small muted">
            {shown.length === quotes.length ? `${quotes.length} cards on the shelf` : `${shown.length} of ${quotes.length} cards`}
          </span>
        </div>

        <div className="pw-counter-legend">
          <span className="pw-legend sell">💵 <b>Sell</b> — instant cash on the glass, gone forever · the cut is printed on every card</span>
          <span className="pw-legend hock">🔑 <b>Hock</b> — up to 40% of fire-sale, {terms?.days ?? 30} days, card comes home</span>
        </div>

        {shown.length === 0 ? (
          quotes.length === 0 ? (
            <EmptyState icon="💠" text="Nothing in your collection to quote" sub="Pull cards, win auctions, or hit the buylist — then walk in." />
          ) : (
            <EmptyState icon="🔍" text="No card by that name" sub="The counter quotes everything you own — clear the search to see it all." />
          )
        ) : (
          <div className="pw-quotes">
            {shown.slice(0, 30).map((q: PawnQuoteRow) => {
              const sellPct = q.market > 0 ? Math.round((q.cashNow / q.market) * 100) : 0
              const hockPct = q.market > 0 ? Math.round((q.loanMax / q.market) * 100) : 0
              return (
                <div key={q.inventoryId} className="pw-quote">
                  <CardImg src={q.image} alt={q.name} className="pw-quote-img" cardId={q.cardId} />

                  <div className="pw-quote-name">
                    <b onClick={() => openCard(q.cardId)} title={q.name}>{q.name}</b>
                    <span className="faint">
                      {q.condition}{q.gradedGrade ? ` · ${q.gradedGrade}` : ''} · mkt {fmtUsd(q.market)}
                    </span>
                  </div>

                  <div className="pw-quote-opts">
                    <button
                      className="pw-opt sell"
                      disabled={busy}
                      title="Cash on the glass — the card leaves your collection for good"
                      onClick={() => run(() => api.pawnSell(q.inventoryId), (r) => `Sold for ${fmtUsd(r.paid ?? 0)} cash — no questions asked.`)}
                    >
                      <span>Sell now</span>
                      <b>{fmtUsd(q.cashNow)}</b>
                      <em>{sellPct}% of market</em>
                    </button>

                    <div className="pw-opt hock">
                      <span>Hock</span>
                      <div className="pw-hock-row">
                        <input
                          className="input"
                          inputMode="decimal"
                          placeholder={String(Math.floor(q.loanMax))}
                          value={hockAmt[q.inventoryId] ?? ''}
                          aria-label={`Loan amount against ${q.name}`}
                          onChange={(e) => setHockAmt((h) => ({ ...h, [q.inventoryId]: e.target.value }))}
                        />
                        <button
                          className="primary"
                          disabled={busy}
                          title={`Leave the card as collateral for up to ${fmtUsd(q.loanMax)}`}
                          onClick={() => {
                            const amt = Number(hockAmt[q.inventoryId])
                            run(() => api.pawnHock(q.inventoryId, Number.isFinite(amt) && amt > 0 ? amt : undefined), (r) => `Hocked for ${fmtUsd(r.principal ?? 0)} — ${terms?.days ?? 30} days on the ticket.`)
                          }}
                        >
                          Take loan
                        </button>
                      </div>
                      <em>up to {fmtUsd(q.loanMax)} · {hockPct}% of market</em>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* --- THE CASE ----------------------------------------------------- */}
      {shelf && shelf.rows.length > 0 && (
        <section className="panel mb14 pw-case" aria-label="The case">
          <div className="pw-case-head">
            <b>🔒 The case</b>
            <span className="small muted">
              defaulted tickets · {terms?.shelfMarkup ?? 1.25}× what was owed · first come, first served
              {shelf.mineCount > 0 && <> · <b className="pw-mine">{shelf.mineCount} of them are yours</b></>}
            </span>
          </div>
          <div className="pw-case-grid">
            {shelf.rows.map((r) => (
              <article key={r.id} className={`pw-case-item ${r.mine ? 'mine' : ''}`}>
                <div className="pw-case-name">
                  <b title={r.name}>{r.name}</b>
                  {r.mine && <span className="badge hit">yours</span>}
                </div>
                <div className="pw-case-figs">
                  <span className="faint">mkt {fmtUsd(r.market)}</span>
                  <b>{fmtUsd(r.ask)}</b>
                </div>
                <button
                  className="primary small"
                  disabled={busy}
                  title={r.mine ? 'Buy your own card back — the house always wins the vig' : 'Anyone can take it at this ask'}
                  onClick={() => run(() => api.pawnBuyBack(r.id), (r2) => `${r.mine ? 'Bought it back' : 'Bought it'} for ${fmtUsd(r2.paid ?? 0)} — out of the case and into the binder.`)}
                >
                  {r.mine ? 'Buy back' : 'Buy'}
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* --- HISTORY ------------------------------------------------------ */}
      {data && data.history.length > 0 && (
        <section className="panel pw-history" aria-label="Ticket history">
          <button className="pw-history-head" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
            <b>🧾 Ticket history</b>
            <span className="faint small">{data.history.length} records · {showHistory ? 'hide ▴' : 'show ▾'}</span>
          </button>
          {showHistory && (
            <div className="pw-history-rows">
              {data.history.slice(0, 20).map((h) => (
                <div key={h.id} className="pw-history-row">
                  <span className="faint">{new Date(h.issued_at).toLocaleDateString()}</span>
                  <span className="pw-history-card">{h.card}</span>
                  <span className="faint">{fmtUsd(h.principal)} hocked</span>
                  {h.status === 'repaid' && <span className="pw-ok">redeemed {fmtUsd(h.repaid_amount ?? h.total)}</span>}
                  {h.status === 'defaulted' && <span className="pw-bad">defaulted at {fmtUsd(h.total)}</span>}
                  {h.status === 'active' && <b>live · {fmtUsd(h.total)}</b>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <LendingCounter />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 🏦 THE DESK — the same counter, from behind it. The town borrows against a
// card; you set the rate and either collect the interest or the collateral.
// ---------------------------------------------------------------------------

function money2(n: number) {
  return n > 0 && n < 0.01 ? '<$0.01' : fmtUsd(n)
}

function LendingCounter() {
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<LendingDeskData | null>(null)
  const [rate, setRate] = useState(0.004) // must be one of DESK_TERMS.rates
  const [busy, setBusy] = useState(false)

  const load = () => { api.lending().then(setData).catch(() => {}) }
  useEffect(() => { load() }, [])

  const write = async (offerId: number) => {
    setBusy(true)
    try {
      const r = await api.lend(offerId, rate)
      if (r.ok) {
        toast(`Ticket written for ${fmtUsd(r.principal ?? 0)} — due in ${data?.terms.days ?? 14} game-days.`, 'good')
        refreshState()
        load()
      } else toast(r.error ?? 'Rejected', 'bad')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  if (!data) {
    return (
      <section className="panel mb14" aria-label="Lending desk">
        <b>🏦 The desk</b>
        <div className="faint small">Reading the walk-in queue…</div>
      </section>
    )
  }

  const s = data.stats
  return (
    <section className="panel mb14" aria-label="Lending desk">
      <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <b>🏦 The desk — lend against collateral</b>
          <div className="faint small">
            {data.terms.days} game-days · up to {Math.round(data.terms.maxLtv * 100)}% of market · plain daily interest on what you lend
          </div>
        </div>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
          <span className="small">lent out <b>{fmtUsd(s.lentOut)}</b></span>
          <span className="small">interest earned <b>{fmtUsd(s.interestEarned)}</b></span>
          <span className="small">collateral <b>{fmtUsd(s.collateralValue)}</b></span>
          <span className="small">defaults <b>{s.defaulted}</b>{s.defaultRate != null && <em className="faint"> ({Math.round(s.defaultRate * 100)}%)</em>}</span>
        </div>
      </div>

      {data.offers.length === 0 ? (
        <div className="faint small" style={{ marginTop: 10 }}>
          Nobody is at the desk right now. Walk-ins arrive on the game-day roll — a borrower with a card worth lending against.
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="small faint">Your rate</span>
            {data.terms.rates.map((r) => (
              <button
                key={r}
                className={`small ${Math.abs(rate - r) < 1e-9 ? 'primary' : 'ghost'}`}
                onClick={() => setRate(r)}
                title="The rate you charge per game-day. Higher rates pay more and get walked away from more often."
              >
                {(r * 100).toFixed(2)}%/day
              </button>
            ))}
          </div>

          {data.offers.map((o) => {
            const interest = o.interest[String(rate)] ?? 0
            return (
              <div key={o.id} className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '7px 0', borderTop: '1px solid var(--line, #2a2a2a)' }}>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <b className="small">{o.card}</b>
                  <span className="faint small"> · {o.borrower} · {o.condition} · mkt {money2(o.market)}</span>
                </span>
                <span className="small">asks <b>{money2(o.ask)}</b></span>
                <span className="small faint">returns {money2(o.ask + interest)} in {data.terms.days}d</span>
                <button className="primary small" disabled={busy} onClick={() => write(o.id)} title="Cash leaves the till now; the card is theirs until the loan is not repaid">
                  Write ticket
                </button>
              </div>
            )
          })}
        </div>
      )}

      {data.loans.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <b className="small">Tickets in the street</b>
          {data.loans.map((l) => (
            <div key={l.id} className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0' }}>
              <span style={{ minWidth: 0, flex: 1 }}>
                <b className="small">{l.card}</b>
                <span className="faint small"> · {l.borrower} · {(l.rate_daily * 100).toFixed(2)}%/day</span>
              </span>
              <span className="small">owed <b>{money2(l.payoff)}</b></span>
              <span className="small faint">mkt {money2(l.worth)}{l.worth < l.payoff ? ' — underwater' : ''}</span>
              <span className={`small ${l.daysLeft <= 2 ? 'pw-bad' : 'faint'}`}>{l.daysLeft}d left</span>
            </div>
          ))}
        </div>
      )}

      {data.history.length > 0 && (
        <div className="faint small" style={{ marginTop: 10 }}>
          Last {data.history.length}: {data.history.filter((h) => h.status === 'repaid').length} repaid,{' '}
          {data.history.filter((h) => h.status === 'defaulted').length} defaulted
          {s.defaultedValue > 0 && <> · collateral kept, worth {money2(s.defaultedValue)} today</>}.
        </div>
      )}
    </section>
  )
}
