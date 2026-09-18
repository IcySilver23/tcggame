import { useEffect, useMemo, useState } from 'react'
import { api, type BagRevealResult, type BagRow, type BulkBoxRow, type FinanceStatus, type PnlStatement, type PnlWeekRow, type ShopCaseRow, type ShopStatus, type StockableRow, type StaffCandidate, type StaffMember } from '../api'
import { useStore } from '../store'
import { fmtUsd, matchesQuery, Tabs } from '../components'

// ---------------------------------------------------------------------------
// 🏪 The Card Shop — your permanent storefront (Phase 4)
// ---------------------------------------------------------------------------

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta == null) return null
  const label = delta < -0.1 ? 'DEAL' : delta > 0.15 ? 'PRICEY' : 'FAIR'
  const cls = delta < -0.1 ? 'below' : delta > 0.15 ? 'above' : 'at'
  return (
    <span className={`badge ${cls}`} style={{ fontSize: 10, padding: '2px 8px' }}>
      {label} {delta > 0 ? '+' : ''}{Math.round(delta * 100)}%
    </span>
  )
}

function RepBadge({ rep }: { rep: number }) {
  const label = rep >= 20 ? 'Beloved' : rep >= 6 ? 'Well-liked' : rep <= -10 ? 'Notorious' : rep <= -3 ? 'Shady' : 'Unknown'
  return (
    <span className="badge" style={{ fontSize: 10 }} title="Fair deals build word of mouth; gouging ruins it">
      ⭐ {label} ({rep >= 0 ? '+' : ''}{rep})
    </span>
  )
}

function LeasePanel({ onLeased }: { onLeased: () => void }) {
  const { toast, refreshState } = useStore()
  const [name, setName] = useState('')
  const [tier, setTier] = useState('hole-in-the-wall')
  const [busy, setBusy] = useState(false)

  const lease = async () => {
    setBusy(true)
    try {
      const res = await api.shopLease(name, tier)
      if (res.ok) {
        toast(`Keys in hand — welcome to ${res.name}.`, 'good')
        refreshState()
        onLeased()
      } else toast(res.error ?? 'Lease failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🏪 Open a Card Shop</h1>
          <div className="sub">Sign a lease, fill your cases, and let the walk-ins come to you.</div>
        </div>
      </div>
      <div className="panel" style={{ maxWidth: 720 }}>
        <b>Choose your location</b>
        <div className="grid cols3 mt10">
          {[
            { id: 'hole-in-the-wall', label: 'Hole-in-the-wall', blurb: 'A narrow slot between a laundromat and a phone repair kiosk.', deposit: 250, rent: 12 },
            { id: 'storefront', label: 'Storefront', blurb: 'Real windows, real sign, a door that opens with intention.', deposit: 900, rent: 45 },
            { id: 'flagship', label: 'Flagship', blurb: 'The corner location everyone in the scene knows by name.', deposit: 3000, rent: 140 },
          ].map((t) => (
            <div
              key={t.id}
              className="conv-booth"
              style={{ cursor: 'pointer', outline: tier === t.id ? '2px solid var(--accent, #f5c518)' : 'none' }}
              onClick={() => setTier(t.id)}
            >
              <b className="small">{t.label}</b>
              <div className="price" style={{ fontSize: 16 }}>{fmtUsd(t.deposit)} deposit</div>
              <div className="faint small">{t.blurb}</div>
              <div className="badge mt8" style={{ fontSize: 10 }}>{fmtUsd(t.rent)}/day rent</div>
            </div>
          ))}
        </div>
        <div className="row mt10" style={{ gap: 8 }}>
          <input className="input" style={{ flex: 1 }} placeholder="Shop name — e.g. The Dragon Vault" value={name} maxLength={40}
            onChange={(e) => setName(e.target.value)} />
          <button className="primary" disabled={busy || !name.trim()} onClick={lease}>Sign the lease</button>
        </div>
        <div className="faint small mt8">
          Rent is charged once per in-game day while your cases are stocked. Empty cases are rent-free — but a shop that never opens never sells.
        </div>
      </div>
    </div>
  )
}

function CaseCard({ shopCase, onUnstock, onStockInto }: {
  shopCase: ShopCaseRow
  onUnstock: (id: number, name: string) => void
  onStockInto: (c: ShopCaseRow) => void
}) {
  const { openCard } = useStore()
  const full = shopCase.used >= shopCase.slots
  return (
    <div className="panel" style={{ margin: 0 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <b className="small">{shopCase.label}</b>
          <div className="faint small">{shopCase.used}/{shopCase.slots} slots · {shopCase.blurb}</div>
        </div>
        <button className="small" disabled={full} onClick={() => onStockInto(shopCase)}>{full ? 'Full' : '+ Stock'}</button>
      </div>
      {shopCase.cards.length === 0 ? (
        <div className="faint small mt8">Empty — dust and daydreams.</div>
      ) : (
        <div className="grid cols3 mt8" style={{ gap: 8 }}>
          {shopCase.cards.map((r) => (
            <div key={r.id} style={{ background: '#0d1017', borderRadius: 8, padding: 8 }}>
              <div style={{ width: 56, cursor: 'pointer', margin: '0 auto' }} onClick={() => openCard(r.card_id)}>
                <img src={r.image_small ?? ''} alt={r.name} style={{ width: '100%', borderRadius: 4, display: 'block' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
              </div>
              <div className="small" style={{ marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="price">{fmtUsd(r.ask)}</span>
                <DeltaBadge delta={r.delta} />
              </div>
              <button className="small mt8" style={{ width: '100%' }} onClick={() => onUnstock(r.id, r.name)}>Take out</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StockPicker({ targetCase, onClose, onStocked }: { targetCase: ShopCaseRow; onClose: () => void; onStocked: () => void }) {
  const { toast, refreshState } = useStore()
  const [rows, setRows] = useState<StockableRow[] | null>(null)
  const [q, setQ] = useState('')
  const [ask, setAsk] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.shopStockable().then((r) => setRows(r.ok ? r.rows : [])).catch(() => setRows([]))
  }, [])

  const shown = useMemo(
    () => (rows ?? []).filter((r) => matchesQuery(r, q, (x) => [x.name, x.set_name, x.rarity])),
    [rows, q],
  )

  const put = async (r: StockableRow) => {
    const raw = ask[r.id] ?? r.suggestedAsk.toFixed(2)
    const num = Number(raw)
    if (!(num > 0)) { toast('Set a real price', 'bad'); return }
    setBusy(true)
    try {
      const res = await api.shopStock(targetCase.id, r.id, Math.round(num * 100) / 100)
      if (res.ok) {
        toast(`${r.name} in the ${targetCase.label.toLowerCase()}`, 'good')
        refreshState()
        onStocked()
      } else toast(res.error ?? 'Could not stock', 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="trade-bubble" style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b className="small">Stock the {targetCase.label} — pick from your binder</b>
        <button className="small" onClick={onClose}>Close</button>
      </div>
      <input className="input mt8" style={{ width: '100%' }} placeholder="Search your collection…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ maxHeight: 240, overflowY: 'auto', marginTop: 8 }}>
        {!rows ? (
          <div className="faint small">Opening the binder…</div>
        ) : shown.length === 0 ? (
          <div className="faint small">Nothing eligible (listed, slotted, and graded cards stay put).</div>
        ) : (
          <table className="table" style={{ width: '100%' }}>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td style={{ textAlign: 'left' }}>
                    <b className="small">{r.name}</b> {r.quantity > 1 && <span className="badge">×{r.quantity}</span>}
                    <span className="faint small"> · {r.set_name} · {r.condition}</span>
                  </td>
                  <td className="faint small">mkt {fmtUsd(r.anchor)}</td>
                  <td>
                    <input className="input" style={{ width: 90 }} value={ask[r.id] ?? r.suggestedAsk.toFixed(2)}
                      onChange={(e) => setAsk({ ...ask, [r.id]: e.target.value.replace(/[^0-9.]/g, '') })} />
                  </td>
                  <td><button className="small" disabled={busy} onClick={() => put(r)}>Display</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 💳 Finance — credit line, loans, and the rent-day pressure cooker
// ---------------------------------------------------------------------------

function TaxPanel() {
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<import('../api').TaxStatus | null>(null)

  const load = () => api.taxStatus().then(setData).catch(() => {})
  useEffect(() => { load() }, [])
  if (!data) return null

  const switchStrategy = async (s: import('../api').TaxStrategy) => {
    const r = await api.setTaxStrategy(s).catch(() => null)
    if (r?.ok) {
      toast(s === 'aggressive' ? 'Books switched to aggressive — audits are watching' : 'Books back to honest', 'good')
      load()
    } else toast((r && 'error' in r && r.error) || 'Switch failed', 'bad')
  }

  const c = data.current
  const ratePct = Math.round((c.effectiveRate || 0) * 100)

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <b className="small">🧾 Tax season</b>
          <div className="faint small">Licensed businesses pay quarterly estimates, then a true-up when the quarter closes · grading & overhead deductible · losses carry forward</div>
        </div>
        {(() => {
          const l = data.license
          const expired = l.licensed && (l.daysLeft ?? 0) < 0
          const soon = l.licensed && !expired && (l.daysLeft ?? 99) <= 14
          return (
            <div className="conv-booth" style={{ cursor: 'default', padding: '8px 12px', minWidth: 220 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <b className="small">🪪 {l.licensed ? (expired ? 'License LAPSED' : l.renewalDue ? 'Renewal PAST DUE' : 'Licensed') : 'No business license'}</b>
                {!l.licensed || expired ? (
                  <button className="small primary" onClick={async () => {
                    const r = await api.renewLicense().catch(() => null)
                    if (r?.ok && r.expiresAt) { toast(`Licensed through ${r.expiresAt.slice(0, 10)} — first quarterly renewal included`, 'good'); load(); refreshState() }
                    else toast((r && 'error' in r && r.error) || 'Renewal failed', 'bad')
                  }}>
                    {l.licensed ? 'Renew' : 'Get licensed'} · {fmtUsd(data.licenseFee)}
                  </button>
                ) : l.renewalDue ? (
                  <button className="small primary" onClick={async () => {
                    // Back-pay by touching the license tick: borrow-then-repay is overkill; direct path:
                    const r = await api.payLicenseRenewal().catch(() => null)
                    if (r?.ok) { toast(`Quarterly renewal paid — ${fmtUsd(l.renewalFee)}`, 'good'); load(); refreshState() }
                    else toast((r && 'error' in r && r.error) || 'Payment failed', 'bad')
                  }}>
                    Pay {fmtUsd(l.renewalFee)}
                  </button>
                ) : (
                  <span className="faint small" style={{ color: soon ? '#fbbf24' : undefined }}>{expired ? `lapsed ${-(l.daysLeft ?? 0)}d ago` : `${l.daysLeft}d left`}</span>
                )}
              </div>
              <div className="faint small mt8">
                {l.licensed
                  ? l.renewalDue
                    ? `The quarterly ${fmtUsd(l.renewalFee)} renewal is unpaid — 21 days of stalling suspends the license.`
                    : `Quarterly renewal ${fmtUsd(l.renewalFee)} is current.`
                  : `Trading unlicensed risks a ${fmtUsd(60)} code-enforcement fine.`}
              </div>
            </div>
          )
        })()}
      </div>

      {(() => {
        const e = data.estimate
        return (
          <div className="mt10">
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <b className="small">📅 {e.quarter} estimated taxes — quarter to date</b>
              <span className="faint small">pay as you earn · estimates credit against the true-up</span>
            </div>
            <div className="grid cols4 mt8" style={{ gap: 12 }}>
              <div className="kpi">
                <div className="lbl">QTD revenue</div>
                <div className="val" style={{ fontSize: 15 }}>{fmtUsd(e.running.revenue)}</div>
              </div>
              <div className="kpi">
                <div className="lbl">Projected bill</div>
                <div className="val" style={{ fontSize: 15, color: e.projectedTax > 0 ? '#f87171' : 'var(--good, #4ade80)' }}>{fmtUsd(e.projectedTax)}</div>
              </div>
              <div className="kpi">
                <div className="lbl">Paid this quarter</div>
                <div className="val" style={{ fontSize: 15 }}>{fmtUsd(e.paidSoFar)}</div>
                {e.creditFromPrior > 0 && <div className="note">+ {fmtUsd(e.creditFromPrior)} prior credit</div>}
              </div>
              <div className="kpi">
                <div className="lbl">Suggested payment</div>
                <div className="val" style={{ fontSize: 15 }}>{fmtUsd(e.suggestedPayment)}</div>
                <div className="note">25% of projected{e.creditFromPrior > 0 ? ', after credit' : ''}</div>
              </div>
            </div>
            <div className="row mt8" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="primary small" disabled={e.suggestedPayment <= 0} onClick={async () => {
                const r = await api.payEstimate(e.suggestedPayment).catch(() => null)
                if (r?.ok) { toast(`Paid ${fmtUsd(r.amount)} toward ${e.quarter}`, 'good'); load(); refreshState() }
                else toast((r && 'error' in r && r.error) || 'Payment failed', 'bad')
              }} style={e.suggestedPayment <= 0 ? { opacity: 0.5 } : undefined}>
                Pay suggested {fmtUsd(e.suggestedPayment)}
              </button>
              <button className="small" onClick={async () => {
                const input = window.prompt(`Estimated payment toward ${e.quarter} ($):`, e.suggestedPayment > 0 ? e.suggestedPayment.toFixed(2) : '50')
                if (!input) return
                const amt = Number(input)
                if (!Number.isFinite(amt) || amt <= 0) { toast('Enter a positive amount'); return }
                const r = await api.payEstimate(amt).catch(() => null)
                if (r?.ok) { toast(`Paid ${fmtUsd(r.amount)} toward ${e.quarter}`, 'good'); load(); refreshState() }
                else toast((r && 'error' in r && r.error) || 'Payment failed', 'bad')
              }}>
                Custom amount…
              </button>
            </div>
          </div>
        )
      })()}

      <div className="row mt10" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <b className="small">📋 {c.quarter} closed — true-up</b>
          <div className="faint small">The real return once the quarter ends: estimates applied, remainder settles, underpayment draws a fine</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="faint small">True bill for {c.quarter}</div>
          <div className="price" style={{ fontSize: 20, color: c.tax > 0 ? '#f87171' : 'var(--good, #4ade80)' }}>
            {c.tax > 0 ? `-${fmtUsd(c.tax)}` : 'No tax due'}
          </div>
          {c.tax > 0 && <div className="faint small">effective rate {ratePct}%</div>}
        </div>
      </div>

      <div className="grid cols4 mt10" style={{ gap: 12 }}>
        <div className="kpi">
          <div className="lbl">Product revenue</div>
          <div className="val" style={{ fontSize: 15 }}>{fmtUsd(c.revenue)}</div>
        </div>
        <div className="kpi">
          <div className="lbl">Overhead deductions</div>
          <div className="val" style={{ fontSize: 15 }}>{fmtUsd(c.deductions)}</div>
          <div className="note">rent · payroll · interest</div>
        </div>
        <div className="kpi">
          <div className="lbl">Grading deduction</div>
          <div className="val" style={{ fontSize: 15 }}>{fmtUsd(c.grading.total)}</div>
          <div className="note">{c.grading.cards} card{c.grading.cards === 1 ? '' : 's'} submitted</div>
        </div>
        <div className="kpi">
          <div className="lbl">Taxable profit</div>
          <div className="val" style={{ fontSize: 15 }}>{fmtUsd(c.taxable)}</div>
          {c.carryforwardApplied > 0 && <div className="note">after {fmtUsd(c.carryforwardApplied)} loss carryforward</div>}
        </div>
      </div>

      {(() => {
        const np = data.nonprofit
        return (
          <div className="conv-booth mt10" style={{ cursor: 'default', outline: np ? '2px solid #4ade80' : undefined }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <b className="small">🕊️ {np ? 'Nonprofit charter — active' : 'Nonprofit charter'}</b>
                <div className="faint small mt8" style={{ maxWidth: 560 }}>
                  {np
                    ? 'Exempt from income tax and register sales tax — the quarterly return files itself at $0. The cost: mission over margin — walk-ins browse 20% more and spend 15% less, and every sale is donation-framed.'
                    : `File for nonprofit status ($${data.nonprofitCharterFee} charter fee): no income tax ever again, no sales tax at the register — but walk-ins browse 20% more and spend 15% less. Margin is a four-letter word.`}
                </div>
              </div>
              <button
                className={np ? 'small' : 'small primary'}
                onClick={async () => {
                  const r = await api.setNonprofit(np).catch(() => null)
                  if (r?.ok) {
                    toast(np ? 'Charter revoked — welcome back to capitalism' : `Nonprofit charter filed — $${r.fee}`, np ? 'good' : 'good')
                    load(); refreshState()
                  } else toast((r && 'error' in r && r.error) || 'Failed', 'bad')
                }}
              >
                {np ? 'Revoke charter' : `File charter · $${data.nonprofitCharterFee}`}
              </button>
            </div>
          </div>
        )
      })()}

      <div className="row mt10" style={{ gap: 10, flexWrap: 'wrap' }}>
        {(
          [
            {
              id: 'honest' as const,
              icon: '📗',
              label: 'Honest books',
              blurb: 'Claim what you are entitled to and sleep well. Audits pass.',
            },
            {
              id: 'aggressive' as const,
              icon: '📕',
              label: 'Aggressive books',
              blurb: `Pad returns with phantom deductions (35% of write-offs). Saves ${fmtUsd(c.taxSavedIfPhantomsHold)} on this assessment — but each padded return rolls a ${Math.round(c.auditChance * 100)}% audit chance, and getting caught repays the savings + 50% (currently ${fmtUsd(c.penaltyIfCaught)}) with a credit hit.`,
            },
          ]
        ).map((opt) => {
          const active = data.strategy === opt.id
          return (
            <div key={opt.id} className="conv-booth grow" style={{ cursor: 'default', outline: active ? '2px solid var(--accent, #7dd3fc)' : undefined, opacity: active ? 1 : 0.72 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b className="small">{opt.icon} {opt.label}{active ? ' · current' : ''}</b>
                {!active && <button className="small" onClick={() => switchStrategy(opt.id)}>{opt.id === 'aggressive' ? 'Cook the books' : 'Come clean'}</button>}
              </div>
              <div className="faint small mt8">{opt.blurb}</div>
            </div>
          )
        })}
      </div>
      {data.pendingAudits > 0 && (
        <div className="small mt8" style={{ color: '#fbbf24' }}>
          ⚠️ {data.pendingAudits} aggressive return{data.pendingAudits === 1 ? '' : 's'} still under audit watch — the city has not forgotten.
        </div>
      )}

      {data.auditFindings.length > 0 && (
        <div className="mt10">
          {data.auditFindings.map((f) => (
            <div key={f.id} className="conv-booth" style={{ cursor: 'default', outline: '2px solid #f87171' }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <b className="small" style={{ color: '#f87171' }}>🚨 AUDIT FINDING — {f.month} return</b>
                  <div className="faint small mt8">${f.phantom.toFixed(2)} of phantom deductions disallowed. Penalty if paid: <b>${f.penalty.toFixed(2)}</b>, credit −40, reputation −10.</div>
                  <div className="faint small">The auditor is <i>{f.mood}</i>. An envelope of <b>${f.bribePrice.toFixed(2)}</b> makes the whole thing go away — no record, no credit hit… but auditors gossip, and the next one will cost more.</div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="small" onClick={async () => {
                    const r = await api.payAuditPenalty(f.id).catch(() => null)
                    if (r?.ok) { toast(`Penalty paid — ${fmtUsd(f.penalty)}, reputation −10`, 'good'); load(); refreshState() }
                    else toast((r && 'error' in r && r.error) || 'Failed', 'bad')
                  }}>Pay the penalty</button>
                  <button className="small primary" onClick={async () => {
                    const r = await api.bribeAuditor(f.id).catch(() => null)
                    if (r?.ok) { toast(`The finding… went away. $${f.bribePrice.toFixed(2)} lighter`, 'good'); load(); refreshState() }
                    else toast((r && 'error' in r && r.error) || 'Failed', 'bad')
                  }}>🤝 Bribe the auditor · {fmtUsd(f.bribePrice)}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {c.filed && <div className="faint small mt8">✅ {c.quarter} has been filed.</div>}
      {!c.filed && c.tax > 0 && (
        <div className="row mt10" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="faint small">The quarter has closed — settle the true-up early and the city appreciates punctuality.</div>
          <button
            onClick={async () => {
              const r = await api.fileTax(c.quarter).catch((e: Error) => ({ ok: false, error: e.message }))
              if ('ok' in r && r.ok) { toast(`Filed ${c.quarter} — ${fmtUsd(c.tax)} true bill, estimates applied`); load(); refreshState() }
              else toast(('error' in r && r.error) || 'Filing failed')
            }}
          >
            File true-up
          </button>
        </div>
      )}

      {data.filings.length > 0 && (
        <table className="table mt10" style={{ width: '100%' }}>
          <thead>
            <tr><th style={{ textAlign: 'left' }}>Period</th><th>Revenue</th><th>Deductions</th><th>Taxable</th><th>Rate</th><th>Tax</th></tr>
          </thead>
          <tbody>
            {data.filings.map((f) => (
              <tr key={f.id}>
                <td style={{ textAlign: 'left' }} className="small">
                  {f.month}
                  {f.strategy === 'aggressive' && <span className="faint small" title="Filed with phantom deductions"> · 📕</span>}
                  {f.audited === 1 && <span className="small" style={{ color: f.penalty > 0 ? '#f87171' : 'var(--good, #4ade80)' }}> · {f.penalty > 0 ? `🚨 AUDITED −${fmtUsd(f.penalty)}` : '✅ audited clean'}</span>}
                  {f.fine > 0 && <span className="small" style={{ color: '#fbbf24' }}> · ⚠️ underpaid −{fmtUsd(f.fine)} fine</span>}
                </td>
                <td className="price small" style={{ textAlign: 'right' }}>{fmtUsd(f.revenue)}</td>
                <td className="faint small" style={{ textAlign: 'right' }}>{fmtUsd(f.deductions)}</td>
                <td className="small" style={{ textAlign: 'right', color: f.taxable < 0 ? '#f87171' : undefined }}>{fmtUsd(f.taxable)}</td>
                <td className="faint small" style={{ textAlign: 'right' }}>{Math.round(f.rate * 100)}%</td>
                <td className="price small" style={{ textAlign: 'right', color: f.tax > 0 ? '#f87171' : 'var(--good, #4ade80)' }}>{f.tax > 0 ? `-${fmtUsd(f.tax)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function SalesTaxPanel() {
  const { toast, refreshState } = useStore()
  const [st, setSt] = useState<import('../api').SalesTaxStatus | null>(null)

  useEffect(() => {
    const load = () => api.shop().then((d) => { if (d.open) setSt(d.salesTax) }).catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])
  if (!st) return null

  const remitNow = async () => {
    const r = await api.salesTaxRemit().catch(() => null)
    if (r?.ok) {
      const total = r.remitted.reduce((a, m) => a + m.remitted, 0)
      toast(total > 0 ? `Remitted ${fmtUsd(total)} to the city` : 'Nothing due — trust is settled', 'good')
      refreshState()
      api.shop().then((d) => { if (d.open) setSt(d.salesTax) }).catch(() => {})
    } else toast('Remittance failed', 'bad')
  }

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <b className="small">🏛️ City sales tax</b>
          <div className="faint small">
            {st.district ? (
              <>
                <span style={{ color: '#fbbf24' }}>⚡ Special district: {st.district} — rate is {Math.round(st.rate * 100)}% until the event ends</span>
                {' · '}
              </>
            ) : null}
            {Math.round(st.rate * 100)}% collected at the register on every sale — trust money that was never yours, remitted monthly
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="faint small">Held in trust</div>
          <div className="price" style={{ fontSize: 20, color: st.held > 0 ? '#fbbf24' : undefined }}>{fmtUsd(st.held)}</div>
        </div>
      </div>

      <div className="grid cols3 mt10" style={{ gap: 12 }}>
        <div className="kpi">
          <div className="lbl">Collected all-time</div>
          <div className="val" style={{ fontSize: 15 }}>{fmtUsd(st.collectedAllTime)}</div>
        </div>
        <div className="kpi">
          <div className="lbl">Remitted all-time</div>
          <div className="val" style={{ fontSize: 15 }}>{fmtUsd(st.remittedAllTime)}</div>
        </div>
        <div className="kpi" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button className={st.held > 0 ? 'primary' : ''} disabled={st.held <= 0} onClick={remitNow} style={st.held <= 0 ? { opacity: 0.5 } : undefined}>
            Remit to the city
          </button>
        </div>
      </div>

      {st.filings.length > 0 && (
        <table className="table mt10" style={{ width: '100%' }}>
          <thead>
            <tr><th style={{ textAlign: 'left' }}>Month</th><th>Collected</th><th>Remitted</th><th>Filed</th></tr>
          </thead>
          <tbody>
            {st.filings.map((f) => (
              <tr key={f.id}>
                <td style={{ textAlign: 'left' }} className="small">{f.month}</td>
                <td className="price small" style={{ textAlign: 'right' }}>{fmtUsd(f.collected)}</td>
                <td className="price small" style={{ textAlign: 'right' }}>{fmtUsd(f.remitted)}</td>
                <td className="faint small" style={{ textAlign: 'right' }}>{new Date(f.filed_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function FinancePanel() {
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<FinanceStatus | null>(null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api.finance().then(setData).catch(() => {})
  useEffect(() => { load() }, [])

  if (!data) return null
  const scoreLabel = data.creditScore >= 720 ? 'Excellent' : data.creditScore >= 640 ? 'Fair' : 'Risky'
  const scoreCls = data.creditScore >= 720 ? 'good' : data.creditScore >= 640 ? '' : 'bad'
  const utilization = data.creditLimit > 0 ? data.outstanding / data.creditLimit : 0

  const borrow = async () => {
    const num = Number(amount)
    if (!(num > 0)) { toast('Enter an amount', 'bad'); return }
    setBusy(true)
    try {
      const res = await api.financeBorrow(Math.round(num * 100) / 100)
      if (res.ok) {
        toast(`Borrowed ${fmtUsd(res.amount!)} from ${res.lender} at ${(res.rateDaily! * 100).toFixed(1)}%/day`, 'good')
        setAmount('')
        load()
        refreshState()
      } else toast(res.error ?? 'Loan failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const repay = async (loanId: number, full: boolean, balance: number) => {
    setBusy(true)
    try {
      const res = await api.financeRepay(loanId, full ? undefined : undefined)
      if (res.ok) {
        toast(res.cleared ? 'Loan cleared — credit climbing' : `Paid ${fmtUsd(res.paid)} — ${fmtUsd(res.remaining ?? 0)} left`, 'good')
        load()
        refreshState()
      } else toast(res.error ?? 'Repayment failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <b className="small">💳 Business credit</b>
          <div className="faint small">
            Score <span className={scoreCls}>{data.creditScore} ({scoreLabel})</span>
            {data.missedDrafts > 0 && <span className="bad"> · {data.missedDrafts}/3 missed drafts</span>}
          </div>
        </div>
        <div className="row" style={{ gap: 14 }}>
          <div style={{ textAlign: 'right' }}>
            <div className="faint small">Credit line</div>
            <div className="price">{fmtUsd(data.creditLimit)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="faint small">Outstanding</div>
            <div className="price" style={{ color: data.outstanding > 0 ? '#f87171' : undefined }}>−{fmtUsd(data.outstanding)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="faint small">Interest / day</div>
            <div className="price">{fmtUsd(data.dailyInterest)}</div>
          </div>
        </div>
      </div>

      {utilization >= 0.75 && (
        <div className="trade-bubble bad mt8" style={{ borderColor: '#f87171' }}>
          ⚠️ Credit utilization {Math.round(utilization * 100)}% — the bank watches anything over 75%.
        </div>
      )}

      {data.loans.length > 0 && (
        <table className="table mt8" style={{ width: '100%' }}>
          <thead>
            <tr><th style={{ textAlign: 'left' }}>Lender</th><th>Principal</th><th>Balance</th><th>Rate</th><th>Interest paid</th><th></th></tr>
          </thead>
          <tbody>
            {data.loans.map((l) => (
              <tr key={l.id}>
                <td style={{ textAlign: 'left' }}>
                  <b className="small">{l.lender}</b>
                  <span className="faint small"> · {l.daysOld}d old{l.kind === 'overdraft' ? ' · 🚨 overdraft' : ''}</span>
                </td>
                <td className="faint small">{fmtUsd(l.principal)}</td>
                <td className="price">{fmtUsd(l.balance)}</td>
                <td className="faint small">{(l.rateDaily * 100).toFixed(1)}%/day</td>
                <td className="faint small">{fmtUsd(l.interestPaid)}</td>
                <td><button className="small" disabled={busy} onClick={() => repay(l.id, true, l.balance)}>Pay off</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="row mt8" style={{ gap: 8 }}>
        <input className="input" style={{ width: 120 }} placeholder="0.00" value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        <button className="primary small" disabled={busy || data.availableCredit <= 0} onClick={borrow}>
          Borrow{data.availableCredit > 0 ? ` (up to ${fmtUsd(data.availableCredit)})` : ' — no credit'}
        </button>
        <span className="faint small">Score ≥720: 1.2%/day · ≥640: 2%/day · below: 3.5%/day. Rent you can't cover becomes a 5% overdraft — three bounced drafts and the bank takes the shop.</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 🗑️ Bulk boxes — the dollar bin. Junk cards, flat price, sold by the handful.
// ---------------------------------------------------------------------------

const BOX_PRESETS = [
  { label: 'Quarter Bin', price: 0.25, capacity: 300, note: 'Junk at 25¢. Handfuls of 1-4 — the volume play.' },
  { label: 'Dollar Box', price: 1, capacity: 200, note: 'The classic. Handfuls of 1-3.' },
  { label: 'Two-Dollar Box', price: 2, capacity: 150, note: 'Nicer junk. Handfuls of 1-2.' },
]

function FillPicker({ box, onClose, onFilled }: { box: BulkBoxRow; onClose: () => void; onFilled: () => void }) {
  const { toast, refreshState } = useStore()
  const [rows, setRows] = useState<StockableRow[] | null>(null)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())

  useEffect(() => {
    api.bulkStockable(box.price_per_card).then((r) => setRows(r.ok ? r.rows : [])).catch(() => setRows([]))
  }, [box.id])

  const shown = useMemo(
    () => (rows ?? []).filter((r) => matchesQuery(r, q, (x) => [x.name, x.set_name, x.rarity])),
    [rows, q],
  )
  const room = box.capacity - box.count
  const pickedArr = [...picked].slice(0, room)

  const fill = async () => {
    if (pickedArr.length === 0) { toast('Pick some cards first', 'bad'); return }
    const res = await api.bulkFill(box.id, pickedArr)
    if (res.ok) {
      toast(`${res.added} card${res.added === 1 ? '' : 's'} into the ${box.label}`, 'good')
      refreshState()
      onFilled()
    } else toast(res.error ?? 'Fill failed', 'bad')
  }

  return (
    <div className="trade-bubble" style={{ marginTop: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <b className="small">Fill the {box.label} — cards worth under ~{fmtUsd(box.price_per_card * 3)}</b>
        <button className="small" onClick={onClose}>Close</button>
      </div>
      <div className="row mt8" style={{ gap: 8 }}>
        <input className="input" style={{ flex: 1 }} placeholder="Search your collection…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="primary small" onClick={fill}>Add {pickedArr.length || ''}</button>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 8 }}>
        {!rows ? (
          <div className="faint small">Digging through the binder…</div>
        ) : shown.length === 0 ? (
          <div className="faint small">No junk-tier cards left — that's a good problem.</div>
        ) : (
          <table className="table" style={{ width: '100%' }}>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer', background: picked.has(r.id) ? 'rgba(245,197,24,0.12)' : undefined }}
                  onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else if (p.size < room) n.add(r.id); return n })}>
                  <td style={{ textAlign: 'left' }}>
                    <b className="small">{r.name}</b>
                    <span className="faint small"> · {r.set_name} · {r.condition}</span>
                  </td>
                  <td className="faint small">mkt {fmtUsd(r.anchor)}</td>
                  <td className="faint small">cost {fmtUsd(r.cost_basis)}</td>
                  <td>{picked.has(r.id) ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function BulkPanel({ boxes, onChange }: { boxes: BulkBoxRow[]; onChange: () => void }) {
  const { toast, refreshState } = useStore()
  const [fillInto, setFillInto] = useState<BulkBoxRow | null>(null)

  const buy = async (p: typeof BOX_PRESETS[number]) => {
    const res = await api.bulkBuy(p.label, p.price, p.capacity)
    if (res.ok) {
      toast(`${p.label} set up`, 'good')
      refreshState()
      onChange()
    } else toast(res.error ?? 'Failed', 'bad')
  }

  const act = async (fn: () => Promise<{ ok: boolean; error?: string; [k: string]: unknown }>, good: string) => {
    const res = await fn()
    if (res.ok) {
      toast(good, 'good')
      refreshState()
      onChange()
    } else toast(res.error ?? 'Failed', 'bad')
  }

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <b className="small">🗑️ Bulk boxes — the dollar bin</b>
          <div className="faint small">Junk cards at a flat price. Customers dig and buy by the handful; full bins sell faster than picked-over ones.</div>
        </div>
      </div>

      {boxes.length > 0 && (
        <div className="grid cols3 mt8" style={{ gap: 10 }}>
          {boxes.map((b) => {
            const profit = b.revenue - b.paid
            return (
              <div key={b.id} className="conv-booth" style={{ cursor: 'default' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b className="small">{b.label}</b>
                  <span className="badge">{fmtUsd(b.price_per_card)}/card</span>
                </div>
                <div className="faint small mt8">{b.count}/{b.capacity} cards · {b.cards_sold} sold</div>
                <div className="bar" style={{ height: 6, marginTop: 4 }}><div className="fill" style={{ width: `${Math.min(100, (b.count / b.capacity) * 100)}%` }} /></div>
                <div className="row mt8" style={{ justifyContent: 'space-between' }}>
                  <span className="faint small">rev {fmtUsd(b.revenue)}</span>
                  <span className="small" style={{ color: profit >= 0 ? 'var(--good, #4ade80)' : '#f87171' }}>
                    {profit >= 0 ? '+' : ''}{fmtUsd(profit)} vs basis
                  </span>
                </div>
                {b.sample.length > 0 && (
                  <div className="row mt8" style={{ gap: 4 }}>
                    {b.sample.slice(0, 6).map((s) => (
                      <img key={s.id} src={s.image_small ?? ''} alt={s.name} title={`${s.name} · cost ${fmtUsd(s.cost_basis)}`}
                        style={{ width: 26, borderRadius: 3, display: 'block' }}
                        onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
                    ))}
                  </div>
                )}
                <div className="row mt8" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {b.count < b.capacity && <button className="small" onClick={() => setFillInto(fillInto?.id === b.id ? null : b)}>+ Fill</button>}
                  {b.count > 0 && <button className="small" onClick={() => act(() => api.bulkSell(b.id), 'Bin Dealer bought the box')}>Sell to dealer</button>}
                  <button className="small" onClick={() => act(() => api.bulkEmpty(b.id), 'Box dumped back into the binder')}>Empty</button>
                </div>
                {fillInto?.id === b.id && <FillPicker box={b} onClose={() => setFillInto(null)} onFilled={() => { setFillInto(null); onChange() }} />}
              </div>
            )
          })}
        </div>
      )}

      {boxes.length < 3 && (
        <div className="row mt10" style={{ gap: 10, flexWrap: 'wrap' }}>
          {BOX_PRESETS.filter((p) => !boxes.some((b) => b.label === p.label)).map((p) => (
            <div key={p.label} className="conv-booth" style={{ cursor: 'default', flex: 1, minWidth: 180 }}>
              <b className="small">{p.label}</b>
              <div className="faint small">{p.note}</div>
              <div className="faint small">{p.capacity} capacity · setup ≈ {fmtUsd(p.price * 20)}</div>
              <button className="primary small mt8" style={{ width: '100%' }} onClick={() => buy(p)}>Set up box</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 🎁 Mystery grab bags — sealed 10-card packs with a guaranteed hit
// ---------------------------------------------------------------------------

function BagRevealModal({ result, onClose }: { result: BagRevealResult; onClose: () => void }) {
  const r = result
  if (!r.ok || !r.reveal) return null
  const roi = r.roi ?? 0
  return (
    <div className="panel" style={{ position: 'fixed', inset: '10% 20%', zIndex: 50, overflowY: 'auto', background: '#12151c', border: '1px solid #2a2f3a', borderRadius: 12, padding: 20 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 34 }}>🎁</div>
        <h2>Bag ripped open!</h2>
        <div className="faint small">Paid {fmtUsd(r.price ?? 0)} · cards inside worth {fmtUsd(r.totalValue ?? 0)} ({roi >= 0 ? '+' : ''}{Math.round(roi * 100)}%)</div>
      </div>
      <div className="grid cols3 mt10">
        {r.reveal.map((c) => (
          <div key={c.inventoryId} className="conv-item" style={{ margin: 0, outline: c.isHit ? '2px solid var(--accent, #f5c518)' : 'none' }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <img src={c.image ?? ''} alt={c.name} style={{ width: 60, borderRadius: 5, display: 'block' }}
                onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
              <div className="grow small" style={{ minWidth: 0 }}>
                <b>{c.isHit ? '⭐ ' : ''}{c.name}</b>
                {c.isHit && <div className="badge hit">GUARANTEED HIT</div>}
                <div className="faint small">{c.setName}</div>
                <div className="price">{fmtUsd(c.value)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center', marginTop: 14 }}>
        <button className="primary" onClick={onClose}>Sweet — all cards to the collection</button>
      </div>
    </div>
  )
}

function BagAssembler({ price, onClose, onAssembled }: { price: number; onClose: () => void; onAssembled: () => void }) {
  const { toast, refreshState } = useStore()
  const [rows, setRows] = useState<(StockableRow & { isHitTier: boolean; isJunkTier: boolean })[] | null>(null)
  const [q, setQ] = useState('')
  const [junk, setJunk] = useState<Set<number>>(new Set())
  const [hit, setHit] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.bagsStockable(price).then((r) => setRows(r.ok ? r.rows : [])).catch(() => setRows([]))
  }, [price])

  const shown = useMemo(
    () => (rows ?? []).filter((r) => matchesQuery(r, q, (x) => [x.name, x.set_name, x.rarity])),
    [rows, q],
  )

  const toggle = (r: StockableRow & { isHitTier: boolean }) => {
    if (junk.has(r.id)) { setJunk((p) => { const n = new Set(p); n.delete(r.id); return n }); return }
    if (hit === r.id) { setHit(null); return }
    if (r.isHitTier && hit === null) { setHit(r.id); return }
    if (junk.size < 9) setJunk((p) => new Set(p).add(r.id))
  }

  const seal = async () => {
    if (junk.size !== 9 || hit === null) { toast('Pick 9 junk + 1 hit', 'bad'); return }
    setBusy(true)
    try {
      const res = await api.bagsAssemble(price, [...junk], hit)
      if (res.ok) {
        toast('Bag sealed — hit hidden inside 🤫', 'good')
        refreshState()
        onAssembled()
      } else toast(res.error ?? 'Assembly failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="trade-bubble" style={{ marginTop: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <b className="small">Assemble a ${price} bag — 9 junk (under {fmtUsd(price * 2.5)}) + 1 hit (over {fmtUsd(price * 5)})</b>
        <button className="small" onClick={onClose}>Close</button>
      </div>
      <div className="row mt8" style={{ gap: 8 }}>
        <input className="input" style={{ flex: 1 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="badge">{junk.size}/9 junk</span>
        <span className="badge hit">{hit ? 'hit ✓' : 'no hit'}</span>
        <button className="primary small" disabled={busy || junk.size !== 9 || hit === null} onClick={seal}>Seal the bag</button>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 8 }}>
        {!rows ? (
          <div className="faint small">Digging…</div>
        ) : (
          <table className="table" style={{ width: '100%' }}>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer', background: hit === r.id ? 'rgba(245,197,24,0.18)' : junk.has(r.id) ? 'rgba(245,197,24,0.08)' : undefined }}
                  onClick={() => toggle(r)}>
                  <td style={{ textAlign: 'left' }}>
                    <b className="small">{r.name}</b>
                    <span className="faint small"> · {r.set_name} · {r.condition}</span>
                  </td>
                  <td className="faint small">mkt {fmtUsd(r.anchor)}</td>
                  <td>{r.isHitTier ? <span className="badge hit" style={{ fontSize: 9 }}>HIT</span> : r.isJunkTier ? <span className="badge" style={{ fontSize: 9 }}>junk</span> : <span className="faint small">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function GrabBagsPanel({ bags = [], history = [], prices = [], onChange }: {
  bags?: BagRow[]
  history?: import('../api').BagHistoryRow[]
  prices?: number[]
  onChange: () => void
}) {
  const { toast, refreshState } = useStore()
  const [assembling, setAssembling] = useState<number | null>(null)
  const [reveal, setReveal] = useState<BagRevealResult | null>(null)

  const rip = async (bag: BagRow) => {
    const bought = await api.bagsBuy(bag.id)
    if (!bought.ok) { toast(bought.error ?? 'Buy failed', 'bad'); return }
    refreshState()
    const opened = await api.bagsOpen(bag.id)
    if (opened.ok) {
      setReveal(opened)
      refreshState()
      onChange()
    } else toast(opened.error ?? 'Open failed', 'bad')
  }

  const stockBack = async (bag: BagRow) => {
    const res = await api.bagsStockBack(bag.id)
    if (res.ok) { toast(`Unsealed — ${res.returned} cards back`, 'good'); refreshState(); onChange() }
    else toast(res.error ?? 'Failed', 'bad')
  }

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <b className="small">🎁 Mystery grab bags</b>
      <div className="faint small">Sealed packs of 10 with one guaranteed hit (≥5× the bag price). Sell them to gamblers, or rip one yourself — the reveal is half the fun.</div>

      {bags.length > 0 && (
        <div className="grid cols3 mt8" style={{ gap: 10 }}>
          {bags.map((b) => (
            <div key={b.id} className="conv-booth" style={{ cursor: 'default' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b className="small">🎁 {b.label}</b>
                <span className="badge hit">{fmtUsd(b.price)}</span>
              </div>
              <div className="faint small mt8">hit worth ≥ {fmtUsd(b.price * 5)} · 1-in-10 odds · margin {b.margin >= 0 ? '+' : ''}{fmtUsd(b.margin)}</div>
              <div className="row mt8" style={{ gap: 6 }}>
                <button className="primary small" onClick={() => rip(b)}>Rip it yourself</button>
                <button className="small" onClick={() => stockBack(b)}>Unseal</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="row mt10" style={{ gap: 10, flexWrap: 'wrap' }}>
        {prices.map((p) => (
          <button key={p} className={assembling === p ? 'primary small' : 'small'} onClick={() => setAssembling(assembling === p ? null : p)}>
            + Assemble ${p} bag
          </button>
        ))}
      </div>

      {assembling !== null && (
        <BagAssembler price={assembling} onClose={() => setAssembling(null)} onAssembled={() => { setAssembling(null); onChange() }} />
      )}

      {history.length > 0 && (
        <table className="table mt10" style={{ width: '100%' }}>
          <thead>
            <tr><th style={{ textAlign: 'left' }}>Bag</th><th>Price</th><th>Outcome</th><th>Profit</th></tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td style={{ textAlign: 'left' }} className="small">{h.label} · {new Date(h.resolved_at ?? h.created_at).toLocaleDateString()}</td>
                <td className="faint small">{fmtUsd(h.price)}</td>
                <td className="faint small">
                  {h.status === 'sold' ? `sold to ${h.sold_to}` : h.status === 'opened' ? 'ripped yourself' : 'unsealed'}
                  {' · '}hit was worth {fmtUsd(h.hit_value)}
                </td>
                <td className={h.profit >= 0 ? 'good small' : 'bad small'}>{h.profit >= 0 ? '+' : ''}{fmtUsd(h.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {reveal && <BagRevealModal result={reveal} onClose={() => { setReveal(null); onChange() }} />}
    </div>
  )
}

function PnlPanel() {
  const [data, setData] = useState<{ current: PnlStatement; history: PnlWeekRow[] } | null>(null)

  useEffect(() => {
    const load = () => api.pnl().then(setData).catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  if (!data) return null
  const s = data.current
  const net = s.net
  const lines = [
    { label: '🪞 Case sales', revenue: s.lines.cases.revenue, entries: s.lines.cases.entries },
    { label: '🗑️ Dollar bins', revenue: s.lines.bulk.revenue, entries: s.lines.bulk.entries },
    { label: '🎁 Grab bags', revenue: s.lines.bags.revenue, entries: s.lines.bags.entries },
  ]
  const costs = [
    { label: 'Rent', ...s.overhead.rent },
    { label: 'Payroll', ...s.overhead.payroll },
    { label: 'Loan interest', ...s.overhead.interest },
    { label: 'Other', ...s.overhead.other },
  ]
  const monday = new Date(s.week + 'T00:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric' })

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <b className="small">📊 Weekly P&L</b>
          <div className="faint small">Week of {monday} · Monday-anchored, same weeks as the net-worth chart</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="faint small">Net this week</div>
          <div className="price" style={{ fontSize: 20, color: net >= 0 ? 'var(--good, #4ade80)' : '#f87171' }}>
            {net >= 0 ? '+' : ''}{fmtUsd(net)}
          </div>
        </div>
      </div>

      <div className="grid cols2 mt10" style={{ gap: 16 }}>
        <div>
          <b className="small">Revenue</b>
          <table className="table mt8" style={{ width: '100%' }}>
            <tbody>
              {lines.map((l) => (
                <tr key={l.label}>
                  <td style={{ textAlign: 'left' }} className="small">{l.label}</td>
                  <td className="faint small">{l.entries} entr{l.entries === 1 ? 'y' : 'ies'}</td>
                  <td className="price" style={{ textAlign: 'right' }}>{fmtUsd(l.revenue)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ textAlign: 'left' }} className="small">🏛️ Sales tax collected (trust)</td>
                <td className="faint small">{s.salesTaxCollected.entries} entr{s.salesTaxCollected.entries === 1 ? 'y' : 'ies'}</td>
                <td className="faint small" style={{ textAlign: 'right' }} title="Never yours — held for the city, remitted monthly">{s.salesTaxCollected.revenue === 0 ? '—' : fmtUsd(s.salesTaxCollected.revenue)}</td>
              </tr>
              <tr>
                <td style={{ textAlign: 'left' }}><b className="small">Product revenue</b></td>
                <td />
                <td className="price" style={{ textAlign: 'right' }}>{fmtUsd(s.productRevenue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <b className="small">Overhead</b>
          <table className="table mt8" style={{ width: '100%' }}>
            <tbody>
              {costs.map((c) => (
                <tr key={c.label}>
                  <td style={{ textAlign: 'left' }} className="small">{c.label}</td>
                  <td className="faint small">{c.entries} entr{c.entries === 1 ? 'y' : 'ies'}</td>
                  <td className="price" style={{ textAlign: 'right', color: c.amount < 0 ? '#f87171' : undefined }}>{c.amount === 0 ? '—' : fmtUsd(c.amount)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ textAlign: 'left' }}><b className="small">Total costs</b></td>
                <td />
                <td className="price" style={{ textAlign: 'right', color: '#f87171' }}>{fmtUsd(-s.totalCosts)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {s.margin != null && (
        <div className="faint small mt8">
          Margin on product revenue: <b style={{ color: s.margin >= 0 ? 'var(--good, #4ade80)' : '#f87171' }}>{Math.round(s.margin * 100)}%</b>
          {s.margin < 0 && ' — the shop is spending more than it sells. Raise prices, empty the payroll, or find a hit bag.'}
        </div>
      )}

      {data.history.length > 1 && (
        <table className="table mt10" style={{ width: '100%' }}>
          <thead>
            <tr><th style={{ textAlign: 'left' }}>Week</th><th>Revenue</th><th>Costs</th><th>Net</th></tr>
          </thead>
          <tbody>
            {data.history.map((w) => (
              <tr key={w.week} style={{ fontWeight: w.week === s.week ? 700 : undefined }}>
                <td style={{ textAlign: 'left' }} className="small">{new Date(w.week + 'T00:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric' })}{w.week === s.week ? ' (now)' : ''}</td>
                <td className="small" style={{ textAlign: 'right' }}>{fmtUsd(w.revenue)}</td>
                <td className="faint small" style={{ textAlign: 'right' }}>{fmtUsd(w.costs)}</td>
                <td className="small" style={{ textAlign: 'right', color: w.net >= 0 ? 'var(--good, #4ade80)' : '#f87171' }}>{w.net >= 0 ? '+' : ''}{fmtUsd(w.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Stars({ n }: { n: number }) {
  return <span title={`${n}-star staff`} style={{ letterSpacing: 1 }}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</span>
}

const ROLE_ICON: Record<string, string> = { buyer: '🔍', grader: '🔬', counter: '🧑‍💼' }

function StaffPanel() {
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<{ candidates: StaffCandidate[]; roster: StaffMember[]; payroll: number; counterBoost: number; limits: Record<string, number> } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.staff().then(setData).catch(() => {})
  useEffect(() => { load() }, [])

  if (!data) return null

  const hire = async (c: StaffCandidate) => {
    setBusy(true)
    try {
      const res = await api.staffHire({ name: c.name, role: c.role, quality: c.quality, wage: c.wage })
      if (res.ok) {
        toast(`${c.name} hired — payroll now ${fmtUsd(data.payroll + c.wage)}/day`, 'good')
        load()
        refreshState()
      } else toast(res.error ?? 'Hire failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const fire = async (e: StaffMember) => {
    const res = await api.staffFire(e.id)
    if (res.ok) {
      toast(`${e.name} let go`, 'good')
      load()
      refreshState()
    } else toast(res.error ?? 'Failed', 'bad')
  }

  const statLine = (e: StaffMember) => {
    if (e.role === 'buyer') {
      const gain = e.sourced_value - e.sourced_cost
      return `sourced ${fmtUsd(e.sourced_value)} of stock for ${fmtUsd(e.sourced_cost)} (${gain >= 0 ? '+' : ''}${fmtUsd(gain)})`
    }
    if (e.role === 'grader') return `${e.submits} submission${e.submits === 1 ? '' : 's'} to the grading desk`
    return `on the register for ${e.sales_lift} sale${e.sales_lift === 1 ? '' : 's'}`
  }

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <b className="small">👔 Staff</b>
          <div className="faint small">Payroll {fmtUsd(data.payroll)}/day, drafted with rent · counter boost ×{data.counterBoost}</div>
        </div>
      </div>

      {data.roster.length > 0 && (
        <table className="table mt8" style={{ width: '100%' }}>
          <thead>
            <tr><th style={{ textAlign: 'left' }}>Employee</th><th>Track record</th><th>Wage</th><th></th></tr>
          </thead>
          <tbody>
            {data.roster.map((e) => (
              <tr key={e.id}>
                <td style={{ textAlign: 'left' }}>
                  <b className="small">{ROLE_ICON[e.role]} {e.name}</b>
                  <span className="faint small"> · {e.roleLabel}</span>
                  <div className="faint small"><Stars n={e.quality} /></div>
                </td>
                <td className="faint small">{statLine(e)}</td>
                <td className="price">{fmtUsd(e.wage)}/d</td>
                <td><button className="small" onClick={() => fire(e)}>Let go</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <b className="small mt10" style={{ display: 'block' }}>Applicants this week</b>
      {data.candidates.length === 0 ? (
        <div className="faint small mt8">Nobody's looking right now.</div>
      ) : (
        <div className="grid cols3 mt8" style={{ gap: 8 }}>
          {data.candidates.map((c) => (
            <div key={c.role + c.name} className="conv-booth" style={{ cursor: 'default' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b className="small">{ROLE_ICON[c.role]} {c.name}</b>
                <span className="faint small">{c.roleLabel}</span>
              </div>
              <div className="faint small mt8" style={{ minHeight: 28 }}>{c.blurb}</div>
              <Stars n={c.quality} />
              <div className="row mt8" style={{ justifyContent: 'space-between' }}>
                <span className="price">{fmtUsd(c.wage)}/day</span>
                <button className="primary small" disabled={busy} onClick={() => hire(c)}>Hire</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ShopView() {
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<ShopStatus | null>(null)
  const [stockInto, setStockInto] = useState<ShopCaseRow | null>(null)
  const [tab, setTab] = useState('floor')

  const load = () => api.shop().then(setData).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  const unstock = async (id: number, name: string) => {
    const res = await api.shopUnstock(id)
    if (res.ok) {
      toast(`${name} back in the binder`, 'good')
      load()
      refreshState()
    } else toast(res.error ?? 'Failed', 'bad')
  }

  const buyCase = async (caseId: number) => {
    const res = await api.shopBuyCase(caseId)
    if (res.ok) {
      toast(`${res.label} installed`, 'good')
      load()
      refreshState()
    } else toast(res.error ?? 'Purchase failed', 'bad')
  }

  const closeShop = async () => {
    const res = await api.shopClose()
    if (res.ok) {
      toast('Shop closed — cards back in the binder', 'good')
      load()
      refreshState()
    } else toast(res.error ?? 'Failed', 'bad')
  }

  if (!data) return <div className="empty"><span className="spinner" /> Checking the storefront…</div>

  if (!data.open) return <LeasePanel onLeased={load} />

  const s = data.shop
  const ownedCases = data.cases.filter((c) => c.owned)
  const shopCases = data.cases.filter((c) => !c.owned && !c.locked)
  const lockedCases = data.cases.filter((c) => !c.owned && c.locked)

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🏪 {s.name}</h1>
          <div className="sub">{s.tierLabel} · {fmtUsd(s.rent)}/day · {s.displayedUnits} {s.displayedUnits === 1 ? 'card' : 'cards'} on display</div>
        </div>
        <div className="right" style={{ textAlign: 'right' }}>
          <RepBadge rep={s.reputation} />
          <div className="faint small mt8">Today: {s.todayCustomers} sales · {fmtUsd(s.todayRevenue)}</div>
        </div>
      </div>

      <div className="grid cols3" style={{ marginBottom: 16 }}>
        <div className="panel" style={{ margin: 0 }}>
          <div className="faint small">Lifetime revenue</div>
          <div className="price">{fmtUsd(s.lifetimeRevenue)}</div>
          <div className="faint small">{s.customerCount} walk-in sales</div>
        </div>
        <div className="panel" style={{ margin: 0 }}>
          <div className="faint small">Net of goods sold</div>
          <div className="price" style={{ color: s.lifetimeRevenue - s.lifetimeCost >= 0 ? 'var(--good, #4ade80)' : '#f87171' }}>
            {fmtUsd(s.lifetimeRevenue - s.lifetimeCost)}
          </div>
          <div className="faint small">goods sold at {fmtUsd(s.lifetimeCost)} basis</div>
        </div>
        <div className="panel" style={{ margin: 0 }}>
          <div className="faint small">Daily rent</div>
          <div className="price">{fmtUsd(s.rent)}</div>
          <div className="faint small">charged while cases are stocked</div>
        </div>
      </div>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {ownedCases.map((c) => (
          <CaseCard key={c.id} shopCase={c} onUnstock={unstock} onStockInto={setStockInto} />
        ))}
      </div>

      {stockInto && <StockPicker targetCase={stockInto} onClose={() => setStockInto(null)} onStocked={() => { setStockInto(null); load() }} />}

      <div className="tab-bar mt14" style={{ marginBottom: 14 }}>
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'floor', label: 'Floor' },
            { id: 'products', label: 'Products' },
            { id: 'money', label: 'Money' },
            { id: 'office', label: 'Office' },
          ]}
        />
      </div>

      {tab === 'floor' && (
        <>
          {shopCases.length > 0 && (
            <div className="panel">
              <b className="small">Furnish the shop</b>
              <div className="grid cols3 mt8">
                {shopCases.map((c) => (
                  <div key={c.id} className="conv-booth" style={{ cursor: 'default' }}>
                    <b className="small">{c.label}</b>
                    <div className="price" style={{ fontSize: 15 }}>{fmtUsd(c.price)}</div>
                    <div className="faint small">{c.blurb}</div>
                    <button className="primary small mt8" style={{ width: '100%' }} onClick={() => buyCase(c.id)}>Buy case</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {lockedCases.length > 0 && (
            <div className="panel faint small" style={{ marginTop: 10 }}>
              Bigger leases unlock: {lockedCases.map((c) => `${c.label} (${c.tier} lease)`).join(' · ')}
            </div>
          )}

          {data.recent.length > 0 && (
            <div className="panel" style={{ marginTop: 10 }}>
              <b className="small">Recent walk-in sales</b>
              <table className="table mt8" style={{ width: '100%' }}>
                <thead>
                  <tr><th style={{ textAlign: 'left' }}>Card</th><th>Buyer</th><th>Price</th><th>Profit</th><th>When</th></tr>
                </thead>
                <tbody>
                  {data.recent.slice(0, 8).map((r) => (
                    <tr key={r.id}>
                      <td style={{ textAlign: 'left' }}><b className="small">{r.name}</b>{r.quantity > 1 && ` ×${r.quantity}`}</td>
                      <td className="faint small">{r.buyer}</td>
                      <td className="price">{fmtUsd(r.price)}</td>
                      <td className={r.profit >= 0 ? 'good small' : 'bad small'}>{r.profit >= 0 ? '+' : ''}{fmtUsd(r.profit)}</td>
                      <td className="faint small">{new Date(r.sold_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="panel" style={{ marginTop: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <b className="small">Locking up</b>
                <div className="faint small">Close the shop for good — all displayed cards return to your binder. Sales history stays.</div>
              </div>
              <button className="small" onClick={closeShop}>Close the shop</button>
            </div>
          </div>
        </>
      )}

      {tab === 'products' && (
        <>
          <BulkPanel boxes={data.boxes} onChange={load} />
          <GrabBagsPanel bags={data.bags} history={data.bagHistory} prices={data.bagPrices} onChange={load} />
        </>
      )}

      {tab === 'money' && (
        <>
          <PnlPanel />
          <FinancePanel />
          <TaxPanel />
          <SalesTaxPanel />
        </>
      )}

      {tab === 'office' && <StaffPanel />}
    </div>
  )
}
