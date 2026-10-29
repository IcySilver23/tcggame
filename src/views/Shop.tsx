import { useEffect, useMemo, useState } from 'react'
import { api, type BagRevealResult, type BagRow, type BulkBoxRow, type ConsignmentStatus, type FinanceStatus, type FranchiseDm, type FranchiseInternalCandidate, type FranchiseManagerCandidate, type FranchiseShelfRow, type FranchiseSlot, type FranchiseStore, type IntelCard, type IntelStatus, type LoyaltyView, type PnlStatement, type ProtectionCosts, type RivalStatus, type PnlWeekRow, type ShopCaseRow, type ShopProperty, type ShopStatus, type StockableRow, type StaffCandidate, type StaffMember } from '../api'
import { useStore } from '../store'
import { gameDayMsFor } from '../lib/gameday'
import { DensityToggle, fmtUsd, matchesQuery, OverflowMenu, Tabs } from '../components'

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
  const { toast, refreshState, state } = useStore()
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
            { id: 'hole-in-the-wall', label: 'Hole-in-the-wall', blurb: 'A narrow slot between a laundromat and a phone repair kiosk.', deposit: 250, rent: 6 },
            { id: 'storefront', label: 'Storefront', blurb: 'Real windows, real sign, a door that opens with intention.', deposit: 900, rent: 22.5 },
            { id: 'flagship', label: 'Flagship', blurb: 'The corner location everyone in the scene knows by name.', deposit: 3000, rent: 70 },
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
  const { openCard, density } = useStore()
  const full = shopCase.used >= shopCase.slots
  const compact = density !== 'comfortable'
  return (
    <div className="panel" style={{ margin: 0 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <b className="small">{shopCase.label}</b>
          <div className="faint small">{shopCase.used}/{shopCase.slots} slots · {shopCase.blurb}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {shopCase.cards.length > 1 && <DensityToggle />}
          <button className="small" disabled={full} onClick={() => onStockInto(shopCase)}>{full ? 'Full' : '+ Stock'}</button>
        </div>
      </div>
      {shopCase.cards.length === 0 ? (
        <div className="faint small mt8">Empty — dust and daydreams.</div>
      ) : compact ? (
        <div className={`card-grid mt8 ${density === 'list' ? 'density-list' : 'density-compact'}`}>
          {shopCase.cards.map((r) => (
            <div key={r.id} className="card-cell">
              <div style={{ width: density === 'list' ? 38 : undefined, cursor: 'pointer' }} onClick={() => openCard(r.card_id)}>
                <img src={r.image_small ?? ''} alt={r.name} style={{ width: '100%', borderRadius: 4, display: 'block' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
              </div>
              <div className="card-meta">
                <div className="nm" title={r.name}>{r.name}</div>
                <div className="card-row-between">
                  <span className="price">{fmtUsd(r.ask)}</span>
                  <DeltaBadge delta={r.delta} />
                </div>
              </div>
              <button className="small ghost" onClick={() => onUnstock(r.id, r.name)}>Take out</button>
            </div>
          ))}
        </div>
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
                  <td className="faint small">mkt {fmtUsd(r.anchor)}{r.quantity > 1 ? ` ×${r.quantity} = ${fmtUsd(r.anchor * r.quantity)}` : ''}</td>
                  <td>
                    <input className="input" style={{ width: 90 }} value={ask[r.id] ?? r.suggestedAsk.toFixed(2)}
                      title={r.quantity > 1 ? `Total for all ${r.quantity} copies ($${(r.anchor).toFixed(2)} each)` : undefined}
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
                  <span className="faint small" style={{ color: soon ? 'var(--amber)' : undefined }}>{expired ? `lapsed ${-(l.daysLeft ?? 0)}d ago` : `${l.daysLeft}d left`}</span>
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
                <div className="val" style={{ fontSize: 15, color: e.projectedTax > 0 ? 'var(--red)' : 'var(--good, var(--green))' }}>{fmtUsd(e.projectedTax)}</div>
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
          <div className="price" style={{ fontSize: 20, color: c.tax > 0 ? 'var(--red)' : 'var(--good, var(--green))' }}>
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
          <div className="note">rent · mortgage · payroll · interest</div>
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
          <div className="conv-booth mt10" style={{ cursor: 'default', outline: np ? '2px solid var(--green)' : undefined }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <b className="small">🕊️ {np ? 'Nonprofit charter — active' : 'Nonprofit charter'}</b>
                <div className="faint small mt8" style={{ maxWidth: 560 }}>
                  {np
                    ? 'Exempt from income tax and register sales tax — the quarterly return files itself at $0. The cost: mission over margin — walk-ins browse 20% more and spend 15% less, and every sale is donation-framed.'
                    : `File for nonprofit status ($${data.nonprofitCharterFee} charter fee): no income tax ever again, no sales tax at the register — but walk-ins browse 20% more and spend 15% less. Margin is a four-letter word.`}
                </div>
                {np && (
                  <label className="row small mt8" style={{ gap: 8, cursor: 'pointer', maxWidth: 560 }}>
                    <input
                      type="checkbox"
                      defaultChecked={data.roundUpsEnabled}
                      onChange={async (e) => {
                        await api.setRoundUps(e.target.checked).catch(() => null)
                        toast(e.target.checked ? 'The register suggests round-ups for the cause' : 'Round-up prompts retired', 'good')
                        load()
                      }}
                    />
                    Suggest round-ups at the register — customers round the total up to the next dollar; donors talk (+rep)
                  </label>
                )}
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
        <div className="small mt8" style={{ color: 'var(--amber)' }}>
          ⚠️ {data.pendingAudits} aggressive return{data.pendingAudits === 1 ? '' : 's'} still under audit watch — the city has not forgotten.
        </div>
      )}

      {data.auditFindings.length > 0 && (
        <div className="mt10">
          {data.auditFindings.map((f) => (
            <div key={f.id} className="conv-booth" style={{ cursor: 'default', outline: '2px solid var(--red)' }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <b className="small" style={{ color: 'var(--red)' }}>🚨 AUDIT FINDING — {f.month} return</b>
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
                  {f.audited === 1 && <span className="small" style={{ color: f.penalty > 0 ? 'var(--red)' : 'var(--good, var(--green))' }}> · {f.penalty > 0 ? `🚨 AUDITED −${fmtUsd(f.penalty)}` : '✅ audited clean'}</span>}
                  {f.fine > 0 && <span className="small" style={{ color: 'var(--amber)' }}> · ⚠️ underpaid −{fmtUsd(f.fine)} fine</span>}
                </td>
                <td className="price small" style={{ textAlign: 'right' }}>{fmtUsd(f.revenue)}</td>
                <td className="faint small" style={{ textAlign: 'right' }}>{fmtUsd(f.deductions)}</td>
                <td className="small" style={{ textAlign: 'right', color: f.taxable < 0 ? 'var(--red)' : undefined }}>{fmtUsd(f.taxable)}</td>
                <td className="faint small" style={{ textAlign: 'right' }}>{Math.round(f.rate * 100)}%</td>
                <td className="price small" style={{ textAlign: 'right', color: f.tax > 0 ? 'var(--red)' : 'var(--good, var(--green))' }}>{f.tax > 0 ? `-${fmtUsd(f.tax)}` : '—'}</td>
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
                <span style={{ color: 'var(--amber)' }}>⚡ Special district: {st.district} — rate is {Math.round(st.rate * 100)}% until the event ends</span>
                {' · '}
              </>
            ) : null}
            {Math.round(st.rate * 100)}% collected at the register on every sale — trust money that was never yours, remitted monthly
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="faint small">Held in trust</div>
          <div className="price" style={{ fontSize: 20, color: st.held > 0 ? 'var(--amber)' : undefined }}>{fmtUsd(st.held)}</div>
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

/** One-line ownership summary for the shop header. */
function propertyHeadline(p: ShopProperty): string {
  if (p.owned) return p.mortgage && !p.mortgage.paidOff ? `🏠 owned · ${fmtUsd(p.mortgage.daily)}/day mortgage` : '🏠 owned outright · no rent'
  if (p.rentCurrent > p.rentBase) return `${fmtUsd(p.rentCurrent)}/day rent · crept from ${fmtUsd(p.rentBase)}`
  return `${fmtUsd(p.rentCurrent)}/day rent`
}

// ---------------------------------------------------------------------------
// 🏠 Rent vs buy (v0.5.97) — the landlord's revenue reviews vs the bank's
// mortgage. Tenants see the creep and the buy card; owners see the payoff.
// ---------------------------------------------------------------------------

function PropertyPanel({ prop, onChanged }: { prop: ShopProperty; onChanged: () => void }) {
  const { toast, refreshState } = useStore()
  const [busy, setBusy] = useState(false)
  const [extra, setExtra] = useState('')

  const buy = async () => {
    setBusy(true)
    try {
      const res = await api.shopBuyBuilding()
      if (res.ok) {
        toast(`Deed signed — ${fmtUsd(res.price!)} building, ${fmtUsd(res.down!)} down, ${fmtUsd(res.daily!)}/day mortgage. Rent is $0 from now on.`, 'good')
        refreshState()
        onChanged()
      } else toast(res.error ?? 'Could not buy the building', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const payExtra = async () => {
    if (!prop.mortgage || prop.mortgage.paidOff) return
    const num = Number(extra)
    if (!(num > 0)) { toast('Enter an amount', 'bad'); return }
    setBusy(true)
    try {
      const res = await api.financeRepay(prop.mortgage.id, Math.round(num * 100) / 100)
      if (res.ok) {
        toast(res.cleared ? 'Mortgage cleared — the building is yours outright' : `Paid ${fmtUsd(res.paid)} — ${fmtUsd(res.remaining ?? 0)} left`, 'good')
        setExtra('')
        refreshState()
        onChanged()
      } else toast(res.error ?? 'Payment failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const m = prop.mortgage
  const live = m && !m.paidOff ? m : null

  if (!prop.owned) {
    const reviewMs = Math.max(0, Date.parse(prop.nextReviewAt) - Date.now())
    const reviewIn = Math.max(1, Math.ceil(reviewMs / 86_400_000))
    return (
      <div className="panel" style={{ marginTop: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <b className="small">🏠 Buy the building from the landlord?</b>
            <div className="faint small">
              Reviews every {prop.reviewEveryDays} game-days · next in ~{reviewIn}d · ceiling {fmtUsd(prop.rentCap)}/day
              {prop.rentCurrent > prop.rentBase && <span className="bad"> · already crept from {fmtUsd(prop.rentBase)}</span>}
            </div>
          </div>
          <div className="row" style={{ gap: 14 }}>
            <div style={{ textAlign: 'right' }}>
              <div className="faint small">Rent now</div>
              <div className="price">{fmtUsd(prop.rentCurrent)}<span className="faint small">/day</span></div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="faint small">If you own</div>
              <div className="price" style={{ color: 'var(--good, var(--green))' }}>{fmtUsd(prop.daily)}<span className="faint small">/day</span></div>
            </div>
          </div>
        </div>

        <div className="grid cols3 mt8">
          <div>
            <div className="faint small">Asking price</div>
            <div className="price">{fmtUsd(prop.price)}</div>
          </div>
          <div>
            <div className="faint small">Down payment (cash)</div>
            <div className="price">{fmtUsd(prop.down)}</div>
          </div>
          <div>
            <div className="faint small">Mortgage</div>
            <div className="price">{fmtUsd(prop.principal)}</div>
            <div className="faint small">{(prop.rate * 100).toFixed(2)}%/game-day · {fmtUsd(prop.daily)}/day</div>
          </div>
        </div>

        <div className="row mt8" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div className="faint small" style={{ maxWidth: 560 }}>
            Rent never stops and the landlord reads your books every {prop.reviewEveryDays} game-days. The mortgage does stop: {fmtUsd(prop.daily)} drafts a day until the {fmtUsd(prop.principal)} clears, then this location costs nothing — forever. The down payment is principal (not deductible); each daily draft is.
          </div>
          <button className="primary small" disabled={busy} onClick={buy}>Buy the building — {fmtUsd(prop.price)}</button>
        </div>
      </div>
    )
  }

  const paidPct = m ? Math.min(100, Math.max(0, Math.round((1 - m.balance / m.principal) * 100))) : 100

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <b className="small">🏠 You own the building</b>
          <div className="faint small">
            Deed {fmtUsd(prop.deedPrice ?? prop.price)} · signed {prop.boughtAt ? new Date(prop.boughtAt).toLocaleDateString() : '—'} · no landlord, no reviews, no rent
          </div>
        </div>
        <div className="row" style={{ gap: 14 }}>
          <div style={{ textAlign: 'right' }}>
            <div className="faint small">Rent</div>
            <div className="price" style={{ color: 'var(--good, var(--green))' }}>{fmtUsd(0)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="faint small">Mortgage / day</div>
            <div className="price" style={{ color: live ? undefined : 'var(--good, var(--green))' }}>{live ? fmtUsd(live.daily) : 'clear'}</div>
          </div>
        </div>
      </div>

      {live ? (
        <>
          <div style={{ height: 8, background: 'rgba(18,39,95,.12)', borderRadius: 6, overflow: 'hidden', marginTop: 10 }}>
            <div style={{ height: '100%', width: `${paidPct}%`, background: 'var(--yellow)', borderRadius: 6, transition: 'width .4s' }} />
          </div>
          <div className="row mt8" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div className="faint small">
              {paidPct}% paid · {fmtUsd(live.balance)} left of {fmtUsd(live.principal)} at {(live.rateDaily * 100).toFixed(2)}%/game-day · {live.lender}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input className="input" style={{ width: 110 }} placeholder="0.00" value={extra}
                onChange={(e) => setExtra(e.target.value.replace(/[^0-9.]/g, ''))} />
              <button className="small" disabled={busy} onClick={payExtra}>Pay extra</button>
            </div>
          </div>
          <div className="faint small mt8">
            The draft books as a mortgage line in the P&L — deductible every game-day. Extra payments come straight off the balance.
          </div>
        </>
      ) : (
        <div className="trade-bubble mt8" style={{ borderColor: 'var(--good, var(--green))' }}>
          🏁 Paid off — {fmtUsd(0)}/day from here on. The P&L mortgage line reads $0 and nobody can charge you to stand where you stand.
        </div>
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
            <div className="price" style={{ color: data.outstanding > 0 ? 'var(--red)' : undefined }}>−{fmtUsd(data.outstanding)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="faint small">Interest / day</div>
            <div className="price">{fmtUsd(data.dailyInterest)}</div>
          </div>
        </div>
      </div>

      {utilization >= 0.75 && (
        <div className="trade-bubble bad mt8" style={{ borderColor: 'var(--red)' }}>
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
        <span className="faint small">Score ≥720: 0.6%/day · ≥640: 1%/day · below: 1.75%/day — per game-day (12h). Rent you can't cover becomes a 2.5% overdraft — three bounced drafts and the bank takes the shop.</span>
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
                  <span className="small" style={{ color: profit >= 0 ? 'var(--good, var(--green))' : 'var(--red)' }}>
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
                  <OverflowMenu
                    title={`More box actions — ${b.label}`}
                    items={[
                      ...(b.count > 0 ? [{
                        label: 'Sell to dealer',
                        hint: 'The Bin Dealer buys the whole box',
                        onClick: () => act(() => api.bulkSell(b.id), 'Bin Dealer bought the box'),
                      }] : []),
                      { label: 'Empty the box', hint: 'Dump it back into the binder', onClick: () => act(() => api.bulkEmpty(b.id), 'Box dumped back into the binder') },
                    ]}
                  />
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
  const [data, setData] = useState<{ current: PnlStatement; history: PnlWeekRow[]; protection: ProtectionCosts } | null>(null)

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
    { label: '🤝 Consignment cut', revenue: s.lines.consignment.revenue, entries: s.lines.consignment.entries },
  ]
  const costs = [
    { label: 'Rent', ...s.overhead.rent },
    // The deed's daily draft — only ever nonzero once you've bought the building.
    ...(s.overhead.mortgage.amount !== 0 ? [{ label: '🏠 Mortgage', ...s.overhead.mortgage }] : []),
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
          <div className="price" style={{ fontSize: 20, color: net >= 0 ? 'var(--good, var(--green))' : 'var(--red)' }}>
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
                  <td className="price" style={{ textAlign: 'right', color: c.amount < 0 ? 'var(--red)' : undefined }}>{c.amount === 0 ? '—' : fmtUsd(c.amount)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ textAlign: 'left' }}><b className="small">Total costs</b></td>
                <td />
                <td className="price" style={{ textAlign: 'right', color: 'var(--red)' }}>{fmtUsd(-s.totalCosts)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {s.margin != null && (
        <div className="faint small mt8">
          Margin on product revenue: <b style={{ color: s.margin >= 0 ? 'var(--good, var(--green))' : 'var(--red)' }}>{Math.round(s.margin * 100)}%</b>
          {s.margin < 0 && ' — the shop is spending more than it sells. Raise prices, empty the payroll, or find a hit bag.'}
        </div>
      )}

      {data.protection?.active && (
        <div className="panel mt10" style={{ margin: '10px 0 0', padding: '8px 10px', background: 'var(--panel2)' }}>
          <div className="row small" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <span>🛡 <b>Protection this week</b> — what safety costs:</span>
            <b>{fmtUsd(-data.protection.total)}</b>
          </div>
          <div className="faint small" style={{ marginTop: 3 }}>
            {[
              data.protection.insurance > 0 && `${data.protection.policyTier ?? 'insurance'} ${fmtUsd(-data.protection.insurance)}/wk`,
              data.protection.lockerRent > 0 && `${data.protection.lockers} locker${data.protection.lockers === 1 ? '' : 's'} ${fmtUsd(-data.protection.lockerRent)}/wk`,
              data.protection.vaultRider > 0 && `🏆 vault rider ${fmtUsd(-data.protection.vaultRider)}/wk`,
            ].filter(Boolean).join(' · ')} — booked as it drafts; disasters pay it back in claims.
          </div>
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
                <td className="small" style={{ textAlign: 'right', color: w.net >= 0 ? 'var(--good, var(--green))' : 'var(--red)' }}>{w.net >= 0 ? '+' : ''}{fmtUsd(w.net)}</td>
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

  // The three conversations: a day off, a rival offer, and the huff.
  const dayOffAct = async (e: StaffMember, action: 'grant' | 'refuse') => {
    setBusy(true)
    try {
      const res = await api.staffDayOff(e.id, action)
      if (res.ok) {
        toast(action === 'grant' ? `${e.name} has ${res.label} off — granted` : `${e.name} takes the no — noted`, 'good')
        load()
        refreshState()
      } else toast(res.error ?? 'Failed', 'bad')
    } finally { setBusy(false) }
  }

  const poachAct = async (e: StaffMember, action: 'match' | 'letgo') => {
    setBusy(true)
    try {
      const res = await api.staffPoach(e.id, action)
      if (res.ok) {
        if (res.left) toast(`${e.name} left for the rival`, 'bad')
        else toast(`${e.name} stays at ${fmtUsd(res.wage ?? 0)}/day`, 'good')
        load()
        refreshState()
      } else toast(res.error ?? 'Failed', 'bad')
    } finally { setBusy(false) }
  }

  const huffAct = async (e: StaffMember, action: 'grant' | 'refuse') => {
    setBusy(true)
    try {
      const res = await api.staffHuff(e.id, action)
      if (res.ok) {
        if (res.left) toast(`${e.name} quit in a huff`, 'bad')
        else toast(res.wage != null ? `Heard out — ${e.name} stays at ${fmtUsd(res.wage)}/day` : `Heard out — ${res.label} is theirs`, 'good')
        load()
        refreshState()
      } else toast(res.error ?? 'Failed', 'bad')
    } finally { setBusy(false) }
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

      {data.roster.some((e) => e.huff || e.poach || e.day_off_ask) && (
        <div className="stack mt8">
          {data.roster.filter((e) => e.huff).map((e) => (
            <div key={`huff-${e.id}`} className="conv-booth" style={{ borderColor: 'rgba(248,113,113,.55)' }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <b className="small">💢 {e.name} is in a huff</b>
                  <div className="faint small mt8">“{e.huff!.text}”</div>
                  <div className="faint small">The one conversation — unanswered (or a no) and they're gone for good. {e.huff!.daysLeft} day{e.huff!.daysLeft === 1 ? '' : 's'} left on it.</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="primary small" disabled={busy} onClick={() => huffAct(e, 'grant')}>💬 Hear them out</button>
                  <button className="small" disabled={busy} onClick={() => huffAct(e, 'refuse')}>Say no — they walk</button>
                </div>
              </div>
            </div>
          ))}
          {data.roster.filter((e) => e.poach).map((e) => (
            <div key={`poach-${e.id}`} className="conv-booth" style={{ borderColor: 'rgba(245,197,24,.45)' }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <b className="small">⚖️ {e.name} has an offer from {e.poach!.rival}</b>
                  <div className="faint small">{fmtUsd(e.poach!.offered)}/day — 1.2× your {fmtUsd(e.wage)} · no answer and they leave in {e.poach!.daysLeft} day{e.poach!.daysLeft === 1 ? '' : 's'}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="primary small" disabled={busy} onClick={() => poachAct(e, 'match')}>🤝 Match the offer</button>
                  <button className="small" disabled={busy} onClick={() => poachAct(e, 'letgo')}>Let them go</button>
                </div>
              </div>
            </div>
          ))}
          {data.roster.filter((e) => e.day_off_ask).map((e) => (
            <div key={`ask-${e.id}`} className="conv-booth" style={{ borderColor: 'rgba(74,222,128,.45)' }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <b className="small">🌴 {e.name} asks for {e.dayOffAskLabel} off</b>
                  <div className="faint small">Granted, they don't work that day — the shop runs without them. Refused, they remember.</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="primary small" disabled={busy} onClick={() => dayOffAct(e, 'grant')}>Grant the day</button>
                  <button className="small" disabled={busy} onClick={() => dayOffAct(e, 'refuse')}>Refuse</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

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
                  {e.offToday && <span className="badge" style={{ fontSize: 10, marginLeft: 6 }}>🏖 off today</span>}
                  <div className="faint small">
                    <Stars n={e.quality} />
                    {e.nextXp != null ? <span> · {e.xp}/{e.nextXp} XP to {e.quality + 1}★</span> : <span> · {e.xp} XP · fully trained</span>}
                  </div>
                  <div className="faint small">mood: {e.mood >= 60 ? '🙂' : e.mood >= 40 ? '😐' : e.mood >= 20 ? '😟' : '😠'} {e.moodLabel} · {Math.round(e.mood)}</div>
                </td>
                <td className="faint small">{statLine(e)}{e.offToday ? ' · off the clock today' : ''}</td>
                <td className="price">
                  {fmtUsd(e.wage)}/d
                  {e.wage < e.marketWage && <div className="faint small" style={{ fontWeight: 400 }}>market {fmtUsd(e.marketWage)}</div>}
                </td>
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

// ---------------------------------------------------------------------------
// 🛰 The Chain — satellites beyond the flagship: per-store managers, a
// district manager, and one shared shelf pool with over-the-road transfers.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 🤝 The consignment counter — NPC collectors' cards on your shelf, your 20%.
// ---------------------------------------------------------------------------

function ConsignmentPanel() {
  const { toast, refreshState, state } = useStore()
  const [data, setData] = useState<ConsignmentStatus | null>(null)
  const [asks, setAsks] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)

  const load = () => api.consignment().then(setData).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  if (!data) return null
  const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / gameDayMsFor(state?.day?.lengthHours ?? 12)))

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <b className="small">🤝 Consignment counter</b>
          <div className="faint small">Locals leave cards with you; you price the shelf, sell to walk-ins, and keep a {Math.round(data.commissionPct * 100)}% cut. Their patience runs out — price fairly or showcase their cardboard for free.</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="faint small">Commission earned</div>
          <div className="price">{fmtUsd(data.earned)}</div>
          <div className="faint small">{data.active.length}/{data.slots} counter slots in use</div>
        </div>
      </div>

      {data.offers.length > 0 && (
        <>
          <b className="small mt10" style={{ display: 'block' }}>Offers on the table</b>
          <div className="grid cols3 mt8" style={{ gap: 8 }}>
            {data.offers.map((o) => {
              const suggested = Math.max(o.ownerMin, Math.round(o.anchor * 100) / 100)
              return (
                <div key={o.id} className="conv-booth">
                  <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                    <b className="small">{o.name}</b>
                    <span className="faint small">mkt {fmtUsd(o.anchor)}</span>
                  </div>
                  <div className="faint small">{o.setName} · {o.condition} · owner floor {fmtUsd(o.ownerMin)}</div>
                  <input className="input mt8" style={{ width: '100%' }} inputMode="decimal" placeholder={`ask ≥ ${o.ownerMin.toFixed(2)} — try ${suggested.toFixed(2)}`} value={asks[o.id] ?? ''} onChange={(e) => setAsks((a) => ({ ...a, [o.id]: e.target.value }))} />
                  <div className="row mt8" style={{ gap: 6 }}>
                    <button className="primary small" style={{ flex: 1 }} disabled={busy} onClick={async () => {
                      setBusy(true)
                      try {
                        const val = Number(asks[o.id] || suggested)
                        const r = await api.consignmentAccept(o.id, val)
                        if (r.ok) { toast(`Consignment accepted — ${o.ownerName}'s card is on the counter at ${fmtUsd(val)}.`, 'good'); load(); refreshState() }
                        else toast(r.error ?? 'Failed', 'bad')
                      } finally { setBusy(false) }
                    }}>Take it in</button>
                    <button className="small" disabled={busy} onClick={async () => {
                      setBusy(true)
                      try {
                        const r = await api.consignmentDecline(o.id)
                        if (r.ok) { load() }
                        else toast(r.error ?? 'Failed', 'bad')
                      } finally { setBusy(false) }
                    }}>Pass</button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {data.active.length > 0 && (
        <>
          <b className="small mt10" style={{ display: 'block' }}>On the counter</b>
          <table className="table mt8" style={{ width: '100%' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Card</th><th>Owner</th><th>Ask</th><th>Market</th><th>Your cut</th><th>Patience</th><th></th></tr></thead>
            <tbody>
              {data.active.map((c) => (
                <tr key={c.id}>
                  <td style={{ textAlign: 'left' }}><b className="small">{c.name}</b><span className="faint small"> · {c.condition}</span></td>
                  <td className="faint small">{c.ownerName}</td>
                  <td className="price">{fmtUsd(c.ask)} {c.delta != null && <span className={`badge ${c.delta < -0.1 ? 'below' : c.delta > 0.15 ? 'above' : 'at'}`} style={{ fontSize: 9 }}>{c.delta > 0 ? '+' : ''}{Math.round(c.delta * 100)}%</span>}</td>
                  <td className="faint small">{fmtUsd(c.anchor)}</td>
                  <td className="good small">{fmtUsd(c.commission)}</td>
                  <td className={daysLeft(c.expiresAt) <= 3 ? 'bad small' : 'faint small'}>{daysLeft(c.expiresAt)}d left</td>
                  <td><button className="small" disabled={busy} onClick={async () => {
                    setBusy(true)
                    try {
                      const r = await api.consignmentReturn(c.id)
                      if (r.ok) { toast(`Handed back to ${c.ownerName}`, 'good'); load() }
                      else toast(r.error ?? 'Failed', 'bad')
                    } finally { setBusy(false) }
                  }}>Return</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {data.offers.length === 0 && data.active.length === 0 && (
        <div className="faint small mt8">No consignments right now — word gets around as your reputation grows.</div>
      )}

      {data.history.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="faint small" style={{ cursor: 'pointer' }}>Consignment history ({data.history.length})</summary>
          <table className="table mt8" style={{ width: '100%' }}>
            <tbody>
              {data.history.map((c) => (
                <tr key={c.id}>
                  <td style={{ textAlign: 'left' }}><b className="small">{c.name}</b><span className="faint small"> · {c.ownerName}</span></td>
                  <td className={c.status === 'sold' ? 'good small' : 'faint small'}>
                    {c.status === 'sold' ? `sold ${fmtUsd(c.soldPrice ?? 0)} — cut ${fmtUsd(c.commission)}` : 'taken back'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}

function FranchisePanel() {
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<import('../api').FranchiseStatus | null>(null)
  // Per-slot draft for the "open store" forms: name, tier, and who takes the keys.
  type SlotDraft = { name: string; tier: string; viaInternal: boolean; manager: FranchiseManagerCandidate | null; internal: FranchiseInternalCandidate | null }
  const emptyDraft: SlotDraft = { name: '', tier: 'hole-in-the-wall', viaInternal: true, manager: null, internal: null }
  const [drafts, setDrafts] = useState<Record<number, SlotDraft>>({})
  const [openSlot, setOpenSlot] = useState<number | null>(null)
  const [poolOpen, setPoolOpen] = useState(false)
  const [poolRows, setPoolRows] = useState<(StockableRow & { inPool?: boolean; store?: number })[] | null>(null)
  const [ask, setAsk] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [dmOpen, setDmOpen] = useState(false)

  const load = () => api.franchise().then(setData).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  if (!data) return <div className="faint small">Checking the chain…</div>

  if (!data.canOpen) {
    return (
      <div className="panel" style={{ marginTop: 10 }}>
        <b className="small">🛰 The Chain</b>
        <div className="faint small mt8">{data.reason}</div>
      </div>
    )
  }

  const draftFor = (id: number): SlotDraft => drafts[id] ?? emptyDraft
  const setDraft = (id: number, patch: Partial<SlotDraft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...emptyDraft, ...d[id], ...patch } }))

  const loadPool = async () => {
    const res = await api.franchiseStockable()
    if (res.ok) setPoolRows(res.rows.map((r) => ({ ...r })))
    else toast(res.error ?? 'Nothing to ship', 'bad')
  }
  const togglePool = () => {
    if (!poolOpen && !poolRows) loadPool()
    setPoolOpen(!poolOpen)
  }

  const ship = async (inventoryId: number, store: number, storeName: string) => {
    const val = Number(ask[inventoryId] || poolRows?.find((r) => r.id === inventoryId)?.suggestedAsk || 0)
    setBusy(true)
    try {
      const r = await api.franchiseStock(inventoryId, val, store)
      if (r.ok) { toast(`${poolRows?.find((x) => x.id === inventoryId)?.name ?? 'Card'} shipped to ${storeName}`, 'good'); loadPool(); load() }
      else toast(r.error ?? 'Failed', 'bad')
    } finally { setBusy(false) }
  }

  const transfer = async (inventoryId: number, from: string, to: number, toName: string, suggested: number) => {
    setBusy(true)
    try {
      const r = await api.franchiseStock(inventoryId, suggested, to)
      if (r.ok) { toast(`${from} → ${toName}: on the truck, lands tomorrow`, 'good'); load() }
      else toast(r.error ?? 'Failed', 'bad')
    } finally { setBusy(false) }
  }

  const dm = data.dm
  const stores = data.stores
  const openSlots = data.slots.filter((s) => !s.locked)
  const lockedSlots = data.slots.filter((s) => s.locked)

  return (
    <div>
      {/* ---- Chain header ------------------------------------------------ */}
      <div className="panel" style={{ marginTop: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <b className="small">🛰 The Chain</b>
            <div className="faint small">{stores.length + 1} location{stores.length + 1 === 1 ? '' : 's'} · shared shelf pool {data.sharedPool.used}/{data.sharedPool.cap} rows</div>
          </div>
          <div className="right">
            <div className="faint small">Chain books this week</div>
            <div className="price" style={{ color: data.chainPnl.net >= 0 ? 'var(--good, var(--green))' : 'var(--red)' }}>
              {data.chainPnl.net >= 0 ? '+' : ''}{fmtUsd(data.chainPnl.net)}
            </div>
            <div className="faint small">{fmtUsd(data.chainPnl.revenue)} revenue − {fmtUsd(data.chainPnl.costs)} rent & wages</div>
          </div>
        </div>

        {/* ---- Regional manager ------------------------------------------ */}
        {data.regional ? (
          <>
          <div className="row mt10" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <div style={{ minWidth: 260 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <b className="small">🌎 {data.regional.name}</b>
                <LoyaltyMeter l={data.regional.loyalty} compact />
              </div>
              <div className="faint small mt4"><Stars n={data.regional.quality} /> {fmtUsd(data.regional.wage)}/day ({fmtUsd(data.regional.weeklyCost)}/week) — runs the region, files the {data.regional.reportDay} report · unlocks {data.regional.unlocks}</div>
            </div>
            <button className="small" disabled={busy} onClick={async () => {
              if (!confirm(`Let ${data.regional!.name} go? The regional office empties, coaching ends, and store #3's slot locks until you hire a new regional.`)) return
              setBusy(true)
              try {
                const r = await api.franchiseRegionalFire()
                if (r.ok) { toast('The regional office is empty', 'good'); load(); refreshState() }
                else toast(r.error ?? 'Failed', 'bad')
              } finally { setBusy(false) }
            }}>Release</button>
          </div>
          {data.regional.loyalty.demand && (
            <DemandBanner name={data.regional.name} wage={data.regional.wage} l={data.regional.loyalty} busy={busy} onResolve={async (action) => {
              setBusy(true)
              try {
                const r = await api.franchiseLoyaltyResolve({ regional: true, action })
                if (r.ok && r.granted != null) toast(`${data.regional!.name} stays — +${fmtUsd(r.granted)}/day`, 'good')
                else if (r.ok) toast(`${data.regional!.name} takes it professionally — loyalty −${r.loyaltyHit}`, 'bad')
                else toast(r.error ?? 'Failed', 'bad')
                load()
              } finally { setBusy(false) }
            }} />
          )}
          </>
        ) : data.regionalCandidates.length > 0 ? (
          <div className="mt10">
            <b className="small" style={{ display: 'block' }}>🌎 The regional office — three doors need a map</b>
            <div className="faint small">A regional manager runs the district manager, tightens every till in the chain, and unlocks store #3. Reports Fridays.</div>
            <div className="grid cols3 mt8" style={{ gap: 8 }}>
              {data.regionalCandidates.map((c) => (
                <div key={c.name} className="conv-booth">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <b className="small">{c.name}</b>
                    <span className="price">{fmtUsd(c.wage)}/d</span>
                  </div>
                  <Stars n={c.quality} />
                  <div className="faint small mt4" style={{ minHeight: 28 }}>{c.blurb}</div>
                  <button className="small mt8" style={{ width: '100%' }} disabled={busy} onClick={async () => {
                    setBusy(true)
                    try {
                      const r = await api.franchiseRegionalHire({ name: c.name, quality: c.quality, wage: c.wage })
                      if (r.ok) { toast(`${c.name} takes the regional office — store #3 unlocked`, 'good'); load(); refreshState() }
                      else toast(r.error ?? 'Failed', 'bad')
                    } finally { setBusy(false) }
                  }}>Hire — {fmtUsd(c.wage * 7)} signing</button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* ---- District manager ----------------------------------------- */}
        {dm ? (
          <>
          <div className="row mt10" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <div style={{ minWidth: 260 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <b className="small">🧭 {dm.name}</b>
                <LoyaltyMeter l={dm.loyalty} compact />
              </div>
              <div className="faint small mt4"><Stars n={dm.quality} /> {fmtUsd(dm.wage)}/day ({fmtUsd(dm.weeklyCost)}/week) — coaches the floors, chases shrink</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="small" disabled={busy} onClick={async () => {
                if (!confirm(`Let ${dm.name} go? Coaching ends and the salary line stops.${dm.promoted ? ' They return to the flagship counter if you have room.' : ''}`)) return
                setBusy(true)
                try {
                  const r = await api.franchiseDmFire()
                  if (r.ok) { toast('The district office is empty', 'good'); load(); refreshState() }
                  else toast(r.error ?? 'Failed', 'bad')
                } finally { setBusy(false) }
              }}>Release</button>
            </div>
          </div>
          {dm.loyalty.demand && (
            <DemandBanner name={dm.name} wage={dm.wage} l={dm.loyalty} busy={busy} onResolve={async (action) => {
              setBusy(true)
              try {
                const r = await api.franchiseLoyaltyResolve({ dm: true, action })
                if (r.ok && r.granted != null) toast(`${dm.name} stays — +${fmtUsd(r.granted)}/day`, 'good')
                else if (r.ok) toast(`${dm.name} takes it professionally — loyalty −${r.loyaltyHit}`, 'bad')
                else toast(r.error ?? 'Failed', 'bad')
                load()
              } finally { setBusy(false) }
            }} />
          )}
          </>
        ) : (
          <div className="mt10">
            {!dmOpen ? (
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="faint small">A second satellite needs a district manager — you can't run two stores alone.</span>
                <button className="small" onClick={() => setDmOpen(true)}>🧭 Hire a district manager</button>
              </div>
            ) : (
              <>
                <b className="small" style={{ display: 'block' }}>🧭 District manager applicants</b>
                <div className="grid cols3 mt8" style={{ gap: 8 }}>
                  {data.dmCandidates.map((c) => (
                    <div key={c.name} className="conv-booth">
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <b className="small">{c.name}</b>
                        <span className="price">{fmtUsd(c.wage)}/d</span>
                      </div>
                      <Stars n={c.quality} />
                      <div className="faint small mt4" style={{ minHeight: 28 }}>{c.blurb}</div>
                      <button className="small mt8" style={{ width: '100%' }} disabled={busy} onClick={async () => {
                        setBusy(true)
                        try {
                          const r = await api.franchiseDmHire({ name: c.name, quality: c.quality, wage: c.wage })
                          if (r.ok) { toast(`${c.name} takes the district office`, 'good'); load(); refreshState() }
                          else toast(r.error ?? 'Failed', 'bad')
                        } finally { setBusy(false) }
                      }}>Hire — {fmtUsd(c.wage * 7)} signing</button>
                    </div>
                  ))}
                </div>
                {data.dmInternal.length > 0 && (
                  <>
                    <b className="small mt10" style={{ display: 'block' }}>⬆ …or promote a proven counter hand</b>
                    <div className="grid cols3 mt8" style={{ gap: 8 }}>
                      {data.dmInternal.map((c) => (
                        <div key={c.employeeId} className="conv-booth">
                          <div className="row" style={{ justifyContent: 'space-between' }}>
                            <b className="small">{c.name} <span className="badge" style={{ fontSize: 9 }}>counter · {c.salesLift} sales</span></b>
                            <span className="price">{fmtUsd(c.counterWage)}→{fmtUsd(Math.max(c.counterWage + 6, Math.round((9 + c.quality * 4) * 4) / 4))}/d</span>
                          </div>
                          <Stars n={c.quality} />
                          <div className="faint small mt4" style={{ minHeight: 28 }}>{c.blurb}</div>
                          <button className="small mt8" style={{ width: '100%' }} disabled={busy} onClick={async () => {
                            setBusy(true)
                            try {
                              const r = await api.franchiseDmHire({ employeeId: c.employeeId })
                              if (r.ok) { toast(`${r.name ?? c.name} steps into the district office`, 'good'); load(); refreshState() }
                              else toast(r.error ?? 'Failed', 'bad')
                            } finally { setBusy(false) }
                          }}>Promote — no signing fee</button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <button className="small mt8" onClick={() => setDmOpen(false)}>Never mind</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ---- Pricing intel -------------------------------------------------- */}
      <IntelPanel reload={load} toast={toast} />

      {/* ---- Open stores -------------------------------------------------- */}
      {stores.map((s) => <StoreCard key={s.id} s={s} dm={dm} siblings={stores.filter((x) => x.id !== s.id)} busy={busy} setBusy={setBusy} reload={load} refreshState={refreshState} transfer={transfer} toast={toast} />)}

      {/* ---- Empty slots -------------------------------------------------- */}
      {openSlots.map((slot) => {
        const d = draftFor(slot.id)
        const chosen = d.manager ?? slot.candidates[Math.min(2, slot.candidates.length - 1)]
        const picked = d.internal ?? slot.internal[0] ?? null
        const tier = slot.tiers.find((t) => t.id === d.tier)
        const down = (tier?.deposit ?? 0) + chosen.wage * 7
        const promoteDown = tier?.deposit ?? 0
        const expanded = openSlot === slot.id
        return (
          <div key={slot.id} className="panel" style={{ marginTop: 10, borderColor: 'var(--accent)' }}>
            {!expanded ? (
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="faint small">Location slot {slot.id} is empty — the chain can grow.</span>
                <button className="small" onClick={() => setOpenSlot(slot.id)}>➕ Open location {slot.id}</button>
              </div>
            ) : (
              <>
                <b className="small">🛰 Open location {slot.id}</b>
                <div className="faint small mt4">Another set of doors under your name. Same rules: you stock it, a manager runs the till — and a cheap one sometimes runs it for themselves.</div>
                <div className="row mt10" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input className="input" style={{ width: 220 }} placeholder="Location name — e.g. Eastgate" value={d.name} maxLength={40} onChange={(e) => setDraft(slot.id, { name: e.target.value })} />
                  <select className="input" style={{ width: 190 }} value={d.tier} onChange={(e) => setDraft(slot.id, { tier: e.target.value })}>
                    {slot.tiers.map((t) => <option key={t.id} value={t.id}>{t.label} — {fmtUsd(t.rent)}/day</option>)}
                  </select>
                </div>
                {slot.internal.length > 0 && (
                  <>
                    <b className="small mt10" style={{ display: 'block' }}>⬆ Promote from within</b>
                    <div className="grid cols3 mt8" style={{ gap: 8 }}>
                      {slot.internal.map((c) => (
                        <div key={c.employeeId} className="conv-booth" style={{ cursor: 'pointer', borderColor: d.viaInternal && picked?.employeeId === c.employeeId ? 'var(--accent)' : undefined }} onClick={() => setDraft(slot.id, { viaInternal: true, internal: c })}>
                          <div className="row" style={{ justifyContent: 'space-between' }}>
                            <b className="small">{c.name} <span className="badge" style={{ fontSize: 9 }}>counter · {c.salesLift} sales</span></b>
                            <span className="price">{fmtUsd(c.counterWage)}→{fmtUsd(c.wage)}/d</span>
                          </div>
                          <Stars n={c.quality} />
                          <div className="faint small mt4" style={{ minHeight: 28 }}>{c.blurb}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <b className="small mt10" style={{ display: 'block' }}>…or hire a manager</b>
                <div className="grid cols3 mt8" style={{ gap: 8 }}>
                  {slot.candidates.map((c) => (
                    <div key={c.name + c.quality} className="conv-booth" style={{ cursor: 'pointer', borderColor: !d.viaInternal && chosen.quality === c.quality ? 'var(--accent)' : undefined }} onClick={() => setDraft(slot.id, { viaInternal: false, manager: c })}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <b className="small">{c.name}</b>
                        <span className="price">{fmtUsd(c.wage)}/d</span>
                      </div>
                      <Stars n={c.quality} />
                      <div className="faint small mt4" style={{ minHeight: 28 }}>{c.blurb}</div>
                    </div>
                  ))}
                </div>
                <div className="row mt10" style={{ justifyContent: 'space-between' }}>
                  <span className="faint small">
                    {d.viaInternal && picked
                      ? `${picked.name} steps up: no signing fee — due at signing is just the ${fmtUsd(promoteDown)} deposit. They leave a gap at the flagship counter.`
                      : `Due at signing: ${fmtUsd(down)} (deposit + one week of ${chosen.name}'s wage)`}
                  </span>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="small" onClick={() => setOpenSlot(null)}>Cancel</button>
                    {d.viaInternal && picked ? (
                      <button className="primary" disabled={busy || !d.name.trim()} onClick={async () => {
                        setBusy(true)
                        try {
                          const r = await api.franchisePromote(picked.employeeId, d.name.trim(), d.tier, slot.id)
                          if (r.ok) { toast(`${r.managerName ?? picked.name} got the keys — no signing fee, and they already know the regulars.`, 'good'); setOpenSlot(null); load(); refreshState() }
                          else toast(r.error ?? 'Failed', 'bad')
                        } finally { setBusy(false) }
                      }}>Promote {picked.name}</button>
                    ) : (
                      <button className="primary" disabled={busy || !d.name.trim()} onClick={async () => {
                        setBusy(true)
                        try {
                          const r = await api.franchiseOpen(d.name.trim(), d.tier, chosen.name, chosen.quality, chosen.wage, slot.id)
                          if (r.ok) { toast('Location leased — stock the shelves to open the doors.', 'good'); setOpenSlot(null); load(); refreshState() }
                          else toast(r.error ?? 'Failed', 'bad')
                        } finally { setBusy(false) }
                      }}>Sign the lease</button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )
      })}
      {lockedSlots.map((slot) => (
        <div key={slot.id} className="panel faint small" style={{ marginTop: 10 }}>
          🔒 Location {slot.id}: {slot.lockReason}
        </div>
      ))}

      {/* ---- Shared pool picker ------------------------------------------- */}
      <div className="panel" style={{ marginTop: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <b className="small">📦 Shared shelf pool</b>
            <div className="faint small">Ship from your collection to any store — or move stock between stores (a day on the truck, and cheap managers lose crates).</div>
          </div>
          <button className="small" onClick={togglePool}>{poolOpen ? 'Close' : 'Ship / transfer'}</button>
        </div>
        {poolOpen && poolRows && (
          <div style={{ marginTop: 10 }}>
            {poolRows.length === 0 ? <div className="faint small">No eligible cards — everything else is listed, cased, sold, or on a shelf already.</div> : (
              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                <table className="table" style={{ width: '100%' }}>
                  <tbody>
                    {poolRows.map((r) => (
                      <tr key={r.id}>
                        <td style={{ textAlign: 'left' }}><b className="small">{r.name}</b>{r.quantity > 1 && <span className="badge">×{r.quantity}</span>}<span className="faint small"> · {r.set_name} · {r.condition}</span></td>
                        <td className="faint small">mkt {fmtUsd(r.anchor)}</td>
                        <td>
                          <input className="input" style={{ width: 90 }} inputMode="decimal" placeholder={r.suggestedAsk.toFixed(2)} value={ask[r.id] ?? ''} onChange={(e) => setAsk((a) => ({ ...a, [r.id]: e.target.value }))} />
                        </td>
                        <td>
                          {stores.length === 0 ? <span className="faint small">no stores yet</span> : stores.length === 1 ? (
                            <button className="small" disabled={busy} onClick={() => ship(r.id, stores[0].id, stores[0].name)}>Ship</button>
                          ) : (
                            <select className="input" style={{ width: 150 }} defaultValue="" disabled={busy} onChange={(e) => { const store = Number(e.target.value); if (store) ship(r.id, store, stores.find((s) => s.id === store)?.name ?? `store ${store}`); e.currentTarget.value = '' }}>
                              <option value="" disabled>Send to…</option>
                              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chain pricing intel — the advisory that reads each floor's foot traffic
// (reputation, manager, counter staff) plus your ask-vs-market, and routes
// every listed card to the storefront where it sells fastest.
// ---------------------------------------------------------------------------

function IntelPanel(props: { reload: () => void; toast: (msg: string, kind?: 'good' | 'bad') => void }) {
  const { reload, toast } = props
  const [data, setData] = useState<IntelStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = () => api.franchiseIntel().then((d) => { if (d.ok) setData(d) }).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  if (!data || data.cards.length === 0) return null // nothing listed anywhere — no advice to give

  const moveCount = data.cards.filter((c) => c.verdict === 'move').length

  const transfer = async (c: IntelCard) => {
    if (!c.best) return
    setBusy(true)
    try {
      const r = await api.franchiseIntelTransfer(c.inventoryId, c.best.kind, c.best.id)
      if (r.ok) {
        toast(r.lost ? `The truck lost ${c.name} between stores — written off.` : `${c.name} is headed to ${r.to ?? c.best.name}.`, r.lost ? 'bad' : 'good')
        load(); reload()
      } else toast(r.error ?? 'Transfer failed', 'bad')
    } finally { setBusy(false) }
  }

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <b className="small">🧭 Pricing intel</b>
          <div className="faint small">
            {moveCount > 0
              ? `${moveCount} of ${data.summary.total} listed card${data.summary.total === 1 ? '' : 's'} would move faster on another floor.`
              : `${data.summary.total} listed card${data.summary.total === 1 ? '' : 's'} — every one is already on its best floor.`}
          </div>
        </div>
        <button className="small" onClick={() => setOpen(!open)}>{open ? 'Close' : `Review${moveCount > 0 ? ` (${moveCount})` : ''}`}</button>
      </div>
      {open && (
        <div style={{ marginTop: 10, maxHeight: 360, overflowY: 'auto' }}>
          <table className="table" style={{ width: '100%' }}>
            <tbody>
              {data.cards.map((c) => {
                const isHome = !!c.here && !!c.best && c.here.kind === c.best.kind && c.here.id === c.best.id
                const etaLabel = (h: number) => (h > 1e12 ? 'no buyers at this ask' : `~${h}h to sell`)
                return (
                  <tr key={c.inventoryId} style={{ opacity: c.verdict === 'move' ? 1 : 0.7 }}>
                    <td style={{ textAlign: 'left' }}>
                      <b className="small">{c.name}</b>{c.quantity > 1 && <span className="badge">×{c.quantity}</span>}
                      <span className="faint small"> · {c.setName} · {c.condition}</span>
                      <div className="faint small">ask {fmtUsd(c.ask)} · mkt {fmtUsd(c.anchor)}{c.transferNote ? ` · ${c.transferNote}` : ''}</div>
                    </td>
                    <td className="faint small">
                      {c.here ? <>{c.here.name}<br />{c.here.score > 0 && c.here.etaHours > 0 ? etaLabel(c.here.etaHours) : 'mid-transfer'}</> : '—'}
                    </td>
                    <td className="faint small">
                      {c.best && !isHome ? (
                        <>→ {c.best.name}<br />{c.best.etaHours <= 1e12 ? etaLabel(c.best.etaHours) : ''}{c.gainHours != null && c.gainHours > 0 ? ` (+${c.gainHours}h saved)` : ''}</>
                      ) : c.best ? c.best.note : ''}
                    </td>
                    <td>
                      {c.verdict === 'move' && c.best ? (
                        <button className="small" disabled={busy} onClick={() => transfer(c)}>Move → {c.best.name}</button>
                      ) : c.verdict === 'leave' ? (
                        <span className="badge" style={{ fontSize: 9 }}>best floor</span>
                      ) : (
                        <span className="faint small">no market data</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="faint small" style={{ marginTop: 6 }}>
            Speeds model each floor's walk-in traffic — reputation, manager, counter staff — against your ask vs market. Cross-store moves ride the truck for a day and cheap managers lose crates.
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The accountant — retained bookkeeper: weekly report, waste flags, auto-estimates.
// ---------------------------------------------------------------------------

function AccountantPanel() {
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<import('../api').AccountantStatus | null>(null)

  const load = () => api.accountant().then(setData).catch(() => {})
  useEffect(() => { load() }, [])
  if (!data) return null

  if (!data.hired) {
    return (
      <div className="panel" style={{ marginTop: 10 }}>
        <b className="small">🧮 Hire an accountant</b>
        <div className="faint small mt8">A retained bookkeeper files a Monday report on the real books, flags wasteful spend, auto-pays suggested estimates so safe-harbor fines never bite, and finds ~5% extra legitimate deductions at filing. ${data.weeklyFee}/week, drafted Mondays.</div>
        <div className="grid cols3 mt10">
          {data.applicants.map((a) => (
            <div key={a.name} className="conv-booth" style={{ cursor: 'default' }}>
              <b className="small">{a.name}</b>
              <div className="faint" style={{ fontSize: 10, color: 'var(--gold)' }}>{'★'.repeat(a.quality)}{'☆'.repeat(5 - a.quality)}</div>
              <div className="faint small mt8" style={{ minHeight: 42 }}>{a.blurb}</div>
              <button className="primary small mt8" style={{ width: '100%' }} onClick={async () => {
                const r = await api.hireAccountant(a.name, a.quality).catch(() => null)
                if (r?.ok) { toast(`${a.name} is on retainer — report lands Monday`, 'good'); load(); refreshState() }
                else toast('Hire failed', 'bad')
              }}>Retain · ${data.weeklyFee}/wk</button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const usd = (n: number) => (n < 0 ? '−' : '+') + '$' + Math.abs(n).toFixed(2)
  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <b className="small">🧮 {data.name} — accountant on retainer</b>
          <div className="faint" style={{ fontSize: 10, color: 'var(--gold)' }}>{'★'.repeat(data.quality)}{'☆'.repeat(5 - data.quality)} · ${data.weeklyFee}/week, drafted Mondays</div>
        </div>
        <button className="small ghost" onClick={async () => {
          const r = await api.fireAccountant().catch(() => null)
          if (r?.ok) { toast('Retainer ended — the books are all yours', 'good'); load(); refreshState() }
          else toast((r && 'error' in r && r.error) || 'Failed', 'bad')
        }}>End retainer</button>
      </div>

      <div className="grid cols3 mt10">
        <div className="kpi"><div className="lbl">This week revenue</div><div className="val" style={{ fontSize: 15 }}>{fmtUsd(data.thisWeek.revenue)}</div></div>
        <div className="kpi"><div className="lbl">This week net</div><div className="val" style={{ fontSize: 15, color: data.thisWeek.net >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtUsd(data.thisWeek.net)}</div></div>
        <div className="kpi"><div className="lbl">Filing bonus</div><div className="val" style={{ fontSize: 15 }}>+{Math.round(data.deductionBonusPct * 100)}% deductions</div><div className="note">legit write-offs found in the shoebox</div></div>
      </div>

      <b className="small mt14" style={{ display: 'block' }}>Waste flags {data.flags.length === 0 && <span className="faint small" style={{ fontWeight: 400 }}>— nothing. Enjoy it, it won't last.</span>}</b>
      {data.flags.length > 0 && (
        <div className="stack mt8">
          {data.flags.map((f) => (
            <div key={f.title} className="conv-booth" style={{ cursor: 'default' }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <b className="small">{f.icon} {f.title}</b>
                {f.atStake > 0 && <span className="badge" style={{ fontSize: 10 }}>{fmtUsd(f.atStake)} at stake</span>}
              </div>
              <div className="faint small mt8">{f.detail}</div>
            </div>
          ))}
        </div>
      )}

      <div className="faint small mt10">
        Auto-pays suggested quarterly estimates when cash allows · files honest books even if you switch strategies · every report lands in the feed on Monday.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Manager loyalty — trust meter + raise-demand banner + interim rehire.
// ---------------------------------------------------------------------------

function LoyaltyMeter(props: { l: LoyaltyView; compact?: boolean }) {
  const { l, compact } = props
  const pct = Math.round(l.loyalty)
  const color = l.interim ? 'rgba(18,39,95,.35)' : pct >= 65 ? 'var(--good, #16a34a)' : pct >= 45 ? '#d97706' : '#dc2626'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ width: compact ? 64 : 90, height: 8, background: 'rgba(18,39,95,.12)', borderRadius: 4, overflow: 'hidden', display: 'inline-block' }}>
        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: color, transition: 'width .4s' }} />
      </span>
      <span className="faint small">{l.interim ? 'interim cover' : `${l.mood} · ${pct}`}{!l.interim && l.drawBonus != null && l.drawBonus > 0 ? ` · +${l.drawBonus}% draw` : ''}</span>
    </span>
  )
}

function DemandBanner(props: { name: string; wage: number; l: LoyaltyView; busy: boolean; onResolve: (a: 'grant' | 'refuse') => void }) {
  const { name, wage, l, busy, onResolve } = props
  const d = l.demand!
  return (
    <div className="conv-booth mt10" style={{ borderColor: 'rgba(245,197,24,.45)' }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <b className="small">📣 {name} wants +{fmtUsd(d.asked)}/day</b>
          <div className="faint small">
            makes {fmtUsd(wage)}/day · market is {fmtUsd(l.marketWage)} for their stars
            {l.tenureDays >= 60 ? ` · ${Math.floor(l.tenureDays / 30)} months of service` : ''} · walks in {d.walksInDays} day{d.walksInDays === 1 ? '' : 's'} if held
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="small" disabled={busy} onClick={() => onResolve('grant')}>🤝 Grant the raise</button>
          <button className="small" disabled={busy} onClick={() => onResolve('refuse')}>Hold the line</button>
        </div>
      </div>
    </div>
  )
}

function InterimCover(props: { s: FranchiseStore; busy: boolean; reload: () => void; toast: (msg: string, kind?: 'good' | 'bad') => void }) {
  const { s, busy, reload, toast } = props
  const [pick, setPick] = useState('')
  // Names repeat on the applicant list — match on the full triple.
  const cand = s.interimCandidates.find((c) => `${c.name}|${c.quality}|${c.wage}` === pick)
  return (
    <div className="conv-booth mt10" style={{ borderColor: 'rgba(248,113,113,.4)' }}>
      <b className="small">🚪 {s.managerName} is minding the store</b>
      <div className="faint small">Interim cover holds the keys but draws no wage, draws fewer regulars, and the till leaks. Hire a real manager from this week's applicants:</div>
      <div className="row mt8" style={{ gap: 6, flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 260 }} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">This week's applicants…</option>
          {s.interimCandidates.map((c) => (
            <option key={`${c.name}|${c.quality}|${c.wage}`} value={`${c.name}|${c.quality}|${c.wage}`}>{c.name} — {c.quality}★ · {fmtUsd(c.wage)}/day</option>
          ))}
        </select>
        {cand && (
          <button className="small" disabled={busy} onClick={async () => {
            if (!confirm(`Hire ${cand.name} (${cand.quality}★) to run ${s.name} at ${fmtUsd(cand.wage)}/day? Fresh start, fresh trust.`)) return
            try {
              const r = await api.franchiseLoyaltyRehire({ store: s.id, name: cand.name, quality: cand.quality, wage: cand.wage })
              if (r.ok) { toast(`${cand.name} takes the keys to ${s.name}`, 'good'); setPick(''); reload() }
              else toast(r.error ?? 'Failed', 'bad')
            } catch { toast('Failed', 'bad') }
          }}>Hire — {fmtUsd(cand.wage)}/day</button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The rival across the street — their board, their wars, and the buyout.
// ---------------------------------------------------------------------------

function RivalPanel() {
  const { toast, refreshState: reload } = useStore()
  const [data, setData] = useState<RivalStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [offer, setOffer] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api.rival().then(setData).catch(() => {})
  useEffect(() => { load() }, [])

  if (!data) return null
  if (!data.exists && !data.closed) return null // no rival yet — the block is quiet

  const buyout = async () => {
    const amount = Number(offer)
    if (!amount || amount <= 0) { setOffer(String(Math.ceil(data.buyoutPrice))) ; return }
    setBusy(true)
    try {
      const r = await api.rivalBuyout(amount)
      if (r.ok) { toast(`Deal — the rival sign comes down. $${r.paid?.toFixed(2)}`, 'good'); setOffer(''); load(); reload() }
      else if (r.refused) { toast(`Refused. Their price is now $${r.ask?.toFixed(2)}`, 'bad'); load() }
      else toast(r.error ?? 'Offer failed', 'bad')
    } finally { setBusy(false) }
  }

  const match = async () => {
    setBusy(true)
    try {
      const r = await api.rivalMatch()
      if (r.ok && r.matched) { toast(`Matched ${r.matched} case${r.matched === 1 ? '' : 's'} — $${r.surrendered?.toFixed(2)} of margin conceded. The war is over.`, 'good'); load(); reload() }
      else if (r.ok) toast("They aren't undercutting anything of yours — the war is already moot.", 'bad')
      else toast(r.error ?? 'Match failed', 'bad')
    } finally { setBusy(false) }
  }

  if (!data.exists) {
    return (
      <div className="panel" style={{ marginTop: 10 }}>
        <b className="small">🏪 Across the street</b>
        <div className="faint small mt4">You bought out the last shop on this block. The windows are papered over, the rent is quietly for sale, and for once nobody is undercutting you. <b>No successor opens — the block is yours.</b></div>
      </div>
    )
  }

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <b className="small">🏪 {data.name}</b> <span className="badge" style={{ fontSize: 9 }}>rival · {data.quality}★ staff</span>
          {data.war && <span className="badge" style={{ fontSize: 9, marginLeft: 6, borderColor: 'var(--red)', color: 'var(--red)' }}>⚔️ price war thru {data.war.until}</span>}
          {data.humbled && !data.war && <span className="badge" style={{ fontSize: 9, marginLeft: 6, borderColor: 'var(--amber)', color: 'var(--amber)' }}>🩹 humbled — no new wars until its rep recovers</span>}
          <div className="faint small">rep {data.reputation} · till {data.cashHint} · your walk-ins ×{data.poach.toFixed(2)} while they're open</div>
        </div>
        <button className="small" onClick={() => setOpen(!open)}>{open ? 'Close' : `Peek at their cases (${data.stock.length})`}</button>
      </div>

      {data.war && (
        <div className="conv-booth mt10" style={{ borderColor: 'rgba(248,113,113,.45)' }}>
          <b className="small">⚔️ They're undercutting you</b>
          <div className="faint small">Their till isn't bottomless — starve it and they'll blink first, match the cuts and meet them in the mud, or buy the block. Ask vs market tells you who's bleeding more.</div>
          <div className="row mt8" style={{ gap: 6 }}>
            <button className="small" disabled={busy} onClick={match}>⚔️ Match their price</button>
            <span className="faint small">reprices every contested case to their number — the margin goes, the walk-ins stay</span>
          </div>
        </div>
      )}

      {open && (
        <div style={{ marginTop: 10 }}>
          <table className="table" style={{ width: '100%' }}>
            <tbody>
              {data.stock.map((s, i) => (
                <tr key={`${s.card_id}-${i}`} style={{ opacity: s.undercutsYou ? 1 : 0.75 }}>
                  <td style={{ textAlign: 'left' }}>
                    <b className="small">{s.name}</b>
                    {s.undercutsYou && <span className="badge" style={{ fontSize: 9, marginLeft: 6, borderColor: 'var(--red)', color: 'var(--red)' }}>undercuts you</span>}
                    <div className="faint small">{s.set_name} · case {s.case_no}</div>
                  </td>
                  <td className="price">{fmtUsd(s.ask)}</td>
                  <td className="faint small">mkt {fmtUsd(s.anchor)} {s.delta != null && <span className={`badge ${s.delta < -0.05 ? 'below' : s.delta > 0.15 ? 'above' : 'at'}`} style={{ fontSize: 9 }}>{s.delta > 0 ? '+' : ''}{Math.round(s.delta * 100)}%</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.recent.length > 0 && (
            <div className="faint small mt8">Their counter just rang: {data.recent.slice(0, 3).map((r) => `${r.name} → ${r.buyer} (${fmtUsd(r.price)})`).join(' · ')}</div>
          )}
        </div>
      )}

      <div className="conv-booth mt10">
        <b className="small">🔑 Buy them out</b>
        <div className="faint small">Their price: <b>{fmtUsd(data.buyoutPrice)}</b> — fixtures, stock at their asking rates, and their pride{data.bump > 1 ? ` (×${data.bump.toFixed(2)} after your last offer was refused)` : ''}. Once bought, the rival never reopens.</div>
        <div className="row mt8" style={{ gap: 6 }}>
          <input className="input" style={{ width: 130 }} placeholder={String(Math.ceil(data.buyoutPrice))} value={offer} onChange={(e) => setOffer(e.target.value)} />
          <button className="small" disabled={busy} onClick={buyout}>Make an offer</button>
          <button className="small" disabled={busy} onClick={async () => { setOffer(String(Math.ceil(data.buyoutPrice))); setBusy(true); try { const r = await api.rivalBuyout(Math.ceil(data.buyoutPrice)); if (r.ok) { toast(`Deal — $${r.paid?.toFixed(2)}. The block is yours.`, 'good'); load(); reload() } else if (r.refused) toast(`Refused — now $${r.ask?.toFixed(2)}`, 'bad'); else toast(r.error ?? 'Failed', 'bad') } finally { setBusy(false) } }}>Pay their price</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One satellite in the chain — per-store books, shelf, transfers, audit.
// ---------------------------------------------------------------------------

function StoreCard(props: {
  s: FranchiseStore
  dm: FranchiseDm | null
  siblings: FranchiseStore[]
  busy: boolean
  setBusy: (v: boolean) => void
  reload: () => void
  refreshState: () => void
  transfer: (inventoryId: number, from: string, to: number, toName: string, suggested: number) => Promise<void>
  toast: (msg: string, kind?: 'good' | 'bad') => void
}) {
  const { s, dm, siblings, busy, setBusy, reload, refreshState, transfer, toast } = props

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <b className="small">🛰 {s.name}</b> <span className="badge" style={{ fontSize: 9 }}>store #{s.id}</span>
          <div className="faint small">{s.tierLabel} · {fmtUsd(s.rent)}/day rent · run by {s.managerName} <Stars n={s.managerQuality} />{s.managerWage > 0 ? <> at {fmtUsd(s.managerWage)}/day</> : ''}{s.promoted && <span className="badge" style={{ fontSize: 9, marginLeft: 6 }}>⬆ from the flagship counter</span>}</div>
          <div className="mt4"><LoyaltyMeter l={s.loyalty} compact /></div>
        </div>
        <div className="right">
          <RepBadge rep={s.reputation} />
          <div className="faint small mt8">Today: {s.todayCustomers} sales · {fmtUsd(s.todayRevenue)}</div>
        </div>
      </div>

      {s.loyalty.demand && s.managerWage > 0 && (
        <DemandBanner name={s.managerName} wage={s.managerWage} l={s.loyalty} busy={busy} onResolve={async (action) => {
          setBusy(true)
          try {
            const r = await api.franchiseLoyaltyResolve({ store: s.id, action })
            if (r.ok && r.granted != null) toast(`${s.managerName} stays — +${fmtUsd(r.granted)}/day`, 'good')
            else if (r.ok) toast(`${s.managerName} takes it professionally — loyalty −${r.loyaltyHit}`, 'bad')
            else toast(r.error ?? 'Failed', 'bad')
            reload()
          } finally { setBusy(false) }
        }} />
      )}

      {s.loyalty.interim && <InterimCover s={s} busy={busy} reload={reload} toast={toast} />}

      <div className="grid cols3 mt10">
        <div className="panel" style={{ margin: 0 }}>
          <div className="faint small">This week's books (store #{s.id})</div>
          <div className="price" style={{ color: s.pnl.net >= 0 ? 'var(--good, var(--green))' : 'var(--red)' }}>{s.pnl.net >= 0 ? '+' : ''}{fmtUsd(s.pnl.net)}</div>
          <div className="faint small">{fmtUsd(s.pnl.revenue)} revenue − {fmtUsd(s.pnl.costs)} rent & wages</div>
        </div>
        <div className="panel" style={{ margin: 0 }}>
          <div className="faint small">Till honesty</div>
          <div className="price" style={{ color: s.leakChance > 0.2 ? 'var(--red)' : 'var(--good, var(--green))' }}>{Math.round(s.leakChance * 100)}% leak risk</div>
          <div className="faint small">{s.skimStreak > 0 ? `${s.skimStreak} clean audit${s.skimStreak === 1 ? '' : 's'} — trust building${dm ? ' · DM watching' : ''}` : `audit to keep them honest${dm ? ' · DM watching' : ''}`}</div>
        </div>
        <div className="panel" style={{ margin: 0 }}>
          <div className="faint small">Lifetime at this location</div>
          <div className="price">{fmtUsd(s.lifetimeRevenue - s.lifetimeCost)}</div>
          <div className="faint small">{s.customerCount} sales · {s.shelfRows}/{s.shelfCap} rows{s.inTransit > 0 ? ` · ${s.inTransit} on the truck` : ''}</div>
        </div>
      </div>

      <div className="row mt10" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="small" disabled={busy} onClick={async () => {
          setBusy(true)
          try {
            const r = await api.franchiseAudit(s.id)
            if (r.ok) { toast(r.message ?? 'Audit complete', r.clean ? 'good' : 'bad'); reload() }
            else toast(r.error ?? 'Audit failed', 'bad')
          } finally { setBusy(false) }
        }} title="Show up unannounced and reconcile the till">
          🔍 Audit the till
        </button>
        <button className="small" disabled={busy} onClick={async () => {
          if (!confirm(`Close ${s.name}? ${s.promoted ? `${s.managerName} returns to the flagship counter if you haven't filled it — otherwise they move on` : `${s.managerName} moves on`} and all shelf stock comes home.`)) return
          setBusy(true)
          try {
            const r = await api.franchiseClose(s.id)
            if (r.ok) { toast(`${s.name} closed`, 'good'); reload(); refreshState() }
            else toast(r.error ?? 'Failed', 'bad')
          } finally { setBusy(false) }
        }}>Shut it down</button>
      </div>

      {s.shelves.length === 0 ? (
        <div className="faint small mt8">Empty shelves — the doors stay dark until you ship stock over (use the shared pool below the stores).</div>
      ) : (
        <table className="table mt10" style={{ width: '100%' }}>
          <thead><tr><th style={{ textAlign: 'left' }}>On the shelf</th><th>Set</th><th>Ask</th><th>Market</th><th></th></tr></thead>
          <tbody>
            {s.shelves.map((r: FranchiseShelfRow) => (
              <tr key={r.id}>
                <td style={{ textAlign: 'left' }}><b className="small">{r.name}</b>{r.quantity > 1 && ` ×${r.quantity}`}</td>
                <td className="faint small">{r.set_name}</td>
                <td className="price">{fmtUsd(r.ask)}</td>
                <td className="faint small">{fmtUsd(r.anchor)} {r.delta != null && <span className={`badge ${r.delta < -0.1 ? 'below' : r.delta > 0.15 ? 'above' : 'at'}`} style={{ fontSize: 9 }}>{r.delta > 0 ? '+' : ''}{Math.round(r.delta * 100)}%</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <StoreRowActions r={r} s={s} siblings={siblings} busy={busy} reload={reload} transfer={transfer} toast={toast} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {s.recent.length > 0 && (
        <div className="mt10">
          <b className="small">Recent sales at {s.name}</b>
          <table className="table mt8" style={{ width: '100%' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Card</th><th>Buyer</th><th>Booked</th><th>Skimmed</th><th>When</th></tr></thead>
            <tbody>
              {s.recent.slice(0, 8).map((r) => (
                <tr key={r.id}>
                  <td style={{ textAlign: 'left' }}><b className="small">{r.name}</b>{r.quantity > 1 && ` ×${r.quantity}`}</td>
                  <td className="faint small">{r.buyer}</td>
                  <td className="price">{fmtUsd(r.price)}</td>
                  <td className={r.skimmed > 0 ? 'bad small' : 'faint small'}>{r.skimmed > 0 ? `−${fmtUsd(r.skimmed)}` : '—'}</td>
                  <td className="faint small">{new Date(r.sold_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shelf row actions: move to a sibling store (a day on the truck) or recall.
// ---------------------------------------------------------------------------

function StoreRowActions(props: { r: FranchiseShelfRow; s: FranchiseStore; siblings: FranchiseStore[]; busy: boolean; reload: () => void; transfer: (inventoryId: number, from: string, to: number, toName: string, suggested: number) => Promise<void>; toast: (msg: string, kind?: 'good' | 'bad') => void }) {
  const { r, s, siblings, busy, reload, transfer, toast } = props
  return (
    <>
      {siblings.length > 0 && (
        <select className="input" style={{ width: 130, marginRight: 6 }} defaultValue="" disabled={busy} title="Move to another store (arrives tomorrow)" onChange={(e) => {
          const to = Number(e.target.value)
          const dest = siblings.find((x) => x.id === to)
          if (to && dest) transfer(r.id, s.name, to, dest.name, Math.max(0.01, r.ask))
          e.currentTarget.value = ''
        }}>
          <option value="" disabled>Move to…</option>
          {siblings.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      )}
      <button className="small" disabled={busy} onClick={async () => {
        const res = await api.franchiseUnstock(r.id)
        if (res.ok) { toast(`${r.name} recalled home`, 'good'); reload() } else toast(res.error ?? 'Failed', 'bad')
      }}>Recall</button>
    </>
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
          <div className="sub">{s.tierLabel} · {propertyHeadline(s.property)} · {s.displayedUnits} {s.displayedUnits === 1 ? 'card' : 'cards'} on display</div>
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
          <div className="price" style={{ color: s.lifetimeRevenue - s.lifetimeCost >= 0 ? 'var(--good, var(--green))' : 'var(--red)' }}>
            {fmtUsd(s.lifetimeRevenue - s.lifetimeCost)}
          </div>
          <div className="faint small">goods sold at {fmtUsd(s.lifetimeCost)} basis</div>
        </div>
        <div className="panel" style={{ margin: 0 }}>
          <div className="faint small">{s.property.owned ? 'Daily mortgage' : 'Daily rent'}</div>
          <div className="price">{fmtUsd(s.property.owned ? (s.property.mortgage && !s.property.mortgage.paidOff ? s.property.mortgage.daily : 0) : s.rent)}</div>
          <div className="faint small">
            {s.property.owned
              ? (s.property.mortgage && !s.property.mortgage.paidOff
                  ? `${fmtUsd(s.property.mortgage.balance)} left on the deed`
                  : 'paid off — the building is yours')
              : 'charged while cases are stocked'}
          </div>
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
            { id: 'franchise', label: '🛰 The Chain' },
          ]}
        />
      </div>

      {tab === 'floor' && (
        <>
          <ConsignmentPanel />
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
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b className="small">Recent walk-in sales</b>
                {data.shop.reputation !== undefined && data.roundUps && (data.roundUps.donors > 0 || data.roundUpsEnabled) && (
                  <span className="faint small" title="Customers round the total up to the next dollar for the cause — the full spare change goes there, and donors talk">
                    🕊️ {data.roundUps.donors} round-up{data.roundUps.donors === 1 ? '' : 's'} · {fmtUsd(data.roundUps.total)} donated
                  </span>
                )}
              </div>
              <table className="table mt8" style={{ width: '100%' }}>
                <thead>
                  <tr><th style={{ textAlign: 'left' }}>Card</th><th>Buyer</th><th>Price</th><th>Profit</th><th>When</th></tr>
                </thead>
                <tbody>
                  {data.recent.slice(0, 8).map((r) => (
                    <tr key={r.id}>
                      <td style={{ textAlign: 'left' }}><b className="small">{r.name}</b>{r.quantity > 1 && ` ×${r.quantity}`}</td>
                      <td className="faint small">{r.buyer}</td>
                      <td className="price">{fmtUsd(r.price)}{r.roundup > 0 && <span className="faint small" style={{ marginLeft: 4 }}>+{fmtUsd(r.roundup)} 🕊️</span>}</td>
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
          <PropertyPanel prop={data.shop.property} onChanged={load} />
          <PnlPanel />
          <AccountantPanel />
          <FinancePanel />
          <TaxPanel />
          <SalesTaxPanel />
        </>
      )}

      {tab === 'office' && <><StaffPanel /><RivalPanel /></>}

      {tab === 'franchise' && <FranchisePanel />}
    </div>
  )
}
