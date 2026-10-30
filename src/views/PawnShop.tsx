import { useEffect, useState } from 'react'
import { api } from '../api'
import { gameDayMsFor } from '../lib/gameday'
import type { PawnSection, PawnQuoteRow } from '../api'
import { useStore } from '../store'
import { CardImg, EmptyState, FirstUseTip, fmtUsd, TipList } from '../components'

function daysLeft(dueAt: string, hours: 12 | 24 = 12): number {
  return Math.ceil((new Date(dueAt).getTime() - Date.now()) / gameDayMsFor(hours))
}

export function PawnShopView() {
  const { toast, refreshState, openCard } = useStore()
  const [data, setData] = useState<PawnSection | null>(null)
  const [busy, setBusy] = useState(false)
  const [hockAmt, setHockAmt] = useState<Record<number, string>>({})

  const load = () => api.pawn().then(setData).catch(() => {})
  useEffect(() => { load() }, [])

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

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>💠 The Gold Exchange</h1>
          <div className="sub">Instant cash, no questions. Sell outright at a fire-sale quote, or hock a card as collateral — 30 game-days, 0.75% a day. The ticket is in your pocket, not the books.</div>
        </div>
      </div>

      <FirstUseTip surface="pawn">
        <TipList
          title="💠 The pawn math is honest — and rough"
          items={[
            { icon: '💵', label: 'Sell outright ≈ 30¢', text: <>they value your card at <b>75% of a quick dump</b>, then offer <b>40% of that</b> — cash now</> },
            { icon: '🔑', label: 'Hock it instead', text: <>leave the card in the case and walk out with a <b>30-game-day loan</b> at <b>0.75% a day, compounded</b></> },
            { icon: '✅', label: 'Pay on time', text: <>the ticket clears and the card comes home</> },
            { icon: '⏰', label: 'Miss the date', text: <>it goes in the case at a <b>25% markup</b>, first come first served — you can buy your own card back like any stranger</> },
            { icon: '📓', label: 'Off the books', text: <>the loan shows up nowhere on your net worth. Your conscience still knows</> },
          ]}
        />
      </FirstUseTip>

      {data && data.loans.length > 0 && (
        <div className="panel mb14">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>🎫 Your tickets</b>
            <span className="small muted">{data.loans.length} active · {fmtUsd(data.loans.reduce((a, l) => a + l.total, 0))} owed if redeemed today</span>
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.loans.map((l) => {
              const dl = daysLeft(l.due_at)
              const late = dl <= 0
              return (
                <div key={l.id} className="row small" style={{ gap: 8, padding: '6px 10px', background: 'var(--panel2)', borderRadius: 6, flexWrap: 'wrap' }}>
                  <b style={{ minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.card}</b>
                  <span className="faint">principal {fmtUsd(l.principal)}</span>
                  <span className="faint">interest so far {fmtUsd(l.interest)}</span>
                  <b style={{ color: late ? 'var(--red)' : dl <= 3 ? 'var(--yellow)' : undefined }}>
                    {late ? '⚠ DUE — the case has it' : `${dl}d left`}
                  </b>
                  <b>payoff {fmtUsd(l.total)}</b>
                  <button className="primary small" disabled={busy} onClick={() => run(() => api.pawnPayoff(l.id), (r) => `Redeemed for ${fmtUsd(r.paid ?? 0)} — card's back in the binder.`)}>Redeem</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="panel mb14">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <b>The counter</b>
          <span className="small muted">
            fire-sale ≈ 75% of market · cash quote = 40% of that · hock = 40%, 0.75%/game-day, {data?.terms.days ?? 30} game-days
            {data && data.activeLoans > 0 && <> · {data.activeLoans} card{data.activeLoans === 1 ? '' : 's'} in the case</>}
          </span>
        </div>

        {(data?.quotes ?? []).length === 0 ? (
          <EmptyState icon="💠" text="Nothing in your collection to quote" sub="Pull cards, win auctions, or hit the buylist — then walk in." />
        ) : (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(data?.quotes ?? []).slice(0, 25).map((q: PawnQuoteRow) => (
              <div key={q.inventoryId} className="row small" style={{ gap: 8, padding: '5px 8px' }}>
                <CardImg src={q.image} alt={q.name} className="row-thumb" cardId={q.cardId} />
                <span style={{ minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }} onClick={() => openCard(q.cardId)}>
                  {q.name} <span className="faint">· {q.condition}{q.gradedGrade ? ` · ${q.gradedGrade}` : ''}</span>
                </span>
                <span className="faint" style={{ width: 74, textAlign: 'right' }}>{fmtUsd(q.market)}</span>
                <b style={{ width: 84, textAlign: 'right', color: 'var(--gold)' }}>{fmtUsd(q.cashNow)} cash</b>
                <span className="faint" style={{ width: 86, textAlign: 'right' }}>hock {fmtUsd(q.loanMax)}</span>
                <input
                  className="input"
                  style={{ width: 78 }}
                  inputMode="decimal"
                  placeholder={String(Math.floor(q.loanMax))}
                  value={hockAmt[q.inventoryId] ?? ''}
                  onChange={(e) => setHockAmt((h) => ({ ...h, [q.inventoryId]: e.target.value }))}
                />
                <button className="ghost small" disabled={busy} title={`Leave the card as collateral for up to ${fmtUsd(q.loanMax)}`} onClick={() => {
                  const amt = Number(hockAmt[q.inventoryId])
                  run(() => api.pawnHock(q.inventoryId, Number.isFinite(amt) && amt > 0 ? amt : undefined), (r) => `Hocked for ${fmtUsd(r.principal ?? 0)} — 30 days on the ticket.`)
                }}>hock</button>
                <button className="primary small" disabled={busy} title="Sell it outright, cash now, gone forever" onClick={() =>
                  run(() => api.pawnSell(q.inventoryId), (r) => `Sold for ${fmtUsd(r.paid ?? 0)} cash — no questions asked.`)
                }>sell</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {data && data.shelf.rows.length > 0 && (
        <div className="panel mb14">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>🔒 The case</b>
            <span className="small muted">defaulted cards, 25% over what was owed{data.shelf.mineCount > 0 && <> · <b style={{ color: 'var(--gold)' }}>{data.shelf.mineCount} of them are yours</b></>}</span>
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.shelf.rows.map((r) => (
              <div key={r.id} className="row small" style={{ gap: 8, padding: '5px 8px' }}>
                <span style={{ minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }} onClick={() => openCard(r.cardId)}>
                  {r.name} {r.mine && <span className="badge hit">yours</span>}
                </span>
                <span className="faint" style={{ width: 74, textAlign: 'right' }}>{fmtUsd(r.market)}</span>
                <b style={{ width: 84, textAlign: 'right' }}>{fmtUsd(r.ask)}</b>
                <button className="small primary" disabled={busy} onClick={() => run(() => api.pawnBuyBack(r.id), (r2) => `Bought it back for ${fmtUsd(r2.paid ?? 0)} — the house always wins the vig.`)}>
                  {r.mine ? 'buy back' : 'buy'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && data.history.length > 0 && (
        <div className="panel">
          <b className="small">Ticket history</b>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.history.slice(0, 12).map((h) => (
              <div key={h.id} className="row small" style={{ gap: 8 }}>
                <span className="faint">{new Date(h.issued_at).toLocaleDateString()}</span>
                <span style={{ minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.card}</span>
                <span className="faint">{fmtUsd(h.principal)} hocked</span>
                {h.status === 'repaid' && <span style={{ color: 'var(--green)' }}>redeemed {fmtUsd(h.repaid_amount ?? h.total)}</span>}
                {h.status === 'defaulted' && <span style={{ color: 'var(--red)' }}>defaulted at {fmtUsd(h.total)}</span>}
                {h.status === 'active' && <b>live · {fmtUsd(h.total)}</b>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
