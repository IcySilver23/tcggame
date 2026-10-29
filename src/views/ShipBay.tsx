import { useEffect, useState } from 'react'
import { api, type ShipmentRow, type ShipMethodInfo, type PackLevelInfo, type SuppliesStatus } from '../api'
import { useStore } from '../store'
import { CardImg, FirstUseTip, fmtUsd } from '../components'

// ---------------------------------------------------------------------------
// 📮 To-ship & disputes — a BidBay sale isn't money until the envelope lands.
// Pick postage, burn real packing supplies (or ship bare and gamble), take
// pack-out photos, and pray the arrival dice are kind. Lost disputes refund
// the buyer IN FULL and the card never comes back.
// ---------------------------------------------------------------------------

export function ShipSection() {
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<import('../api').ShipmentsSection | null>(null)
  const [supplies, setSupplies] = useState<SuppliesStatus | null>(null)
  const [shipFor, setShipFor] = useState<ShipmentRow | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    api.shipments().then(setData).catch(() => {})
    api.supplies().then(setSupplies).catch(() => {})
  }
  useEffect(() => { load() }, [])
  // Poll: sales can land while the player sits on this page — without a poll
  // the To-ship queue stayed stale until a full navigate away and back.
  useEffect(() => {
    const t = setInterval(() => { api.shipments().then(setData).catch(() => {}) }, 8000)
    return () => clearInterval(t)
  }, [])

  const stock = (kind: string) => supplies?.stock.find((s) => s.kind === kind)?.quantity ?? 0

  const ship = async (method: string, pack: string, photos: boolean) => {
    if (!shipFor) return
    setBusy(true)
    try {
      const r = await api.shipOrder(shipFor.kind, shipFor.ref_id, method, pack, photos)
      if (r.ok) {
        toast(`Shipped — postage ${fmtUsd(r.postage ?? 0)} booked`, 'good')
        setShipFor(null)
        refreshState()
      } else toast(r.error ?? 'Ship failed', 'bad')
      load()
    } finally { setBusy(false) }
  }

  const resolve = async (sh: ShipmentRow) => {
    setBusy(true)
    try {
      const r = await api.resolveDispute(sh.kind, sh.ref_id)
      if (r.ok) {
        toast(r.message ?? (r.outcome === 'won' ? 'Dispute won' : 'Dispute lost'), r.outcome === 'won' ? 'good' : 'bad')
        refreshState()
      } else toast(r.error ?? 'Failed', 'bad')
      load()
    } finally { setBusy(false) }
  }

  const toShip = data?.toShip ?? []
  const disputes = (data?.inFlight ?? []).filter((s) => s.status === 'disputed')
  const transit = (data?.inFlight ?? []).filter((s) => s.status === 'in_transit')
  const history = data?.history ?? []

  return (
    <div>
      <FirstUseTip surface="shipping">
        <b>📮 Every sale needs shipping now.</b> A sold order isn't money yet — it waits in <b>To-ship</b>. Pick a postage speed, pack the card from your real supplies stock (or ship it bare and gamble), and snap pack-out photos. When it lands, a damaged-arrival dispute may hit: your <b>photos and packing</b> are the evidence. Lose one and the refund comes out of your pocket — and the card is gone for good.
      </FirstUseTip>

      {toShip.length > 0 && (
        <>
          <h2 style={{ margin: '18px 0 8px' }}>📦 To-ship ({toShip.length})</h2>
          {toShip.map((sh) => (
            <div key={sh.id} className="panel" style={{ marginBottom: 10, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', borderColor: 'var(--yellow)' }}>
              <CardImg src={sh.image_small ?? null} alt={sh.name ?? ''} className="row-thumb" cardId={sh.card_id} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b className="small">{sh.quantity > 1 ? `${sh.quantity}× ` : ''}{sh.name}</b>
                <div className="faint small">{sh.buyer} · gross {fmtUsd(sh.gross)} · fee −{fmtUsd(sh.fee)} → escrowed <b style={{ color: 'var(--gold)' }}>{fmtUsd(sh.net)}</b></div>
                <div className="faint small">sleeves {stock('sleeve')} · toploaders {stock('toploader')} · one-touches {stock('one_touch')} · mailers {stock('mailer')}</div>
              </div>
              <button className="primary small" onClick={() => setShipFor(sh)}>Pack & ship</button>
            </div>
          ))}
        </>
      )}

      {disputes.length > 0 && (
        <>
          <h2 style={{ margin: '18px 0 8px', color: 'var(--red)' }}>⚖️ Disputes ({disputes.length})</h2>
          {disputes.map((sh) => (
            <div key={sh.id} className="panel" style={{ marginBottom: 10, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', borderColor: 'var(--red)' }}>
              <CardImg src={sh.image_small ?? null} alt={sh.name ?? ''} className="row-thumb" cardId={sh.card_id} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b className="small">{sh.quantity > 1 ? `${sh.quantity}× ` : ''}{sh.name}</b>
                <div className="faint small">{sh.buyer} claims it arrived damaged · pack: <b>{sh.pack}</b> · {sh.photos ? '📷 photos attached' : <b style={{ color: 'var(--red)' }}>no photos</b>} · {fmtUsd(sh.net)} at stake</div>
              </div>
              <button className="small" style={{ borderColor: 'var(--red)' }} disabled={busy} onClick={() => resolve(sh)}>Present evidence</button>
            </div>
          ))}
        </>
      )}

      {transit.length > 0 && (
        <>
          <h2 style={{ margin: '18px 0 8px' }}>🚚 In transit</h2>
          {transit.map((sh) => (
            <div key={sh.id} className="panel" style={{ marginBottom: 10, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
              <CardImg src={sh.image_small ?? null} alt={sh.name ?? ''} className="row-thumb" cardId={sh.card_id} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b className="small">{sh.quantity > 1 ? `${sh.quantity}× ` : ''}{sh.name}</b>
                <div className="faint small">{sh.buyer} · {sh.method} · {sh.pack}{sh.photos ? ' · 📷' : ''} · arrives shortly</div>
              </div>
              <span className="faint small">{fmtUsd(sh.net)} on arrival</span>
            </div>
          ))}
        </>
      )}

      {history.length > 0 && (
        <>
          <h2 style={{ margin: '18px 0 8px' }}>📚 Shipment history</h2>
          {history.map((sh) => (
            <div key={sh.id} className="panel" style={{ marginBottom: 8, padding: '8px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
              <CardImg src={sh.image_small ?? null} alt={sh.name ?? ''} className="row-thumb" cardId={sh.card_id} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b className="small">{sh.quantity > 1 ? `${sh.quantity}× ` : ''}{sh.name}</b>
                <div className="faint small">{sh.buyer} · {sh.method} · {sh.pack}{sh.photos ? ' · 📷' : ''} · postage {fmtUsd(sh.postage)}</div>
              </div>
              <ShipmentBadge sh={sh} />
            </div>
          ))}
        </>
      )}

      {shipFor && (
        <ShipModal
          sh={shipFor}
          methods={data?.methods ?? []}
          packs={data?.packs ?? []}
          stock={stock}
          busy={busy}
          onClose={() => setShipFor(null)}
          onShip={ship}
        />
      )}
    </div>
  )
}

function ShipmentBadge({ sh }: { sh: ShipmentRow }) {
  if (sh.outcome === 'won_dispute') return <span className="badge at" style={{ fontSize: 10, padding: '2px 8px' }}>⚖️ dispute won</span>
  if (sh.outcome === 'refund') return <span className="badge above" style={{ fontSize: 10, padding: '2px 8px' }}>💸 refunded</span>
  if (sh.status === 'lost') return <span className="badge above" style={{ fontSize: 10, padding: '2px 8px' }}>📬 lost</span>
  return <span className="badge below" style={{ fontSize: 10, padding: '2px 8px' }}>delivered {fmtUsd(sh.net)}</span>
}

function ShipModal({ sh, methods, packs, stock, busy, onClose, onShip }: {
  sh: ShipmentRow
  methods: ShipMethodInfo[]
  packs: PackLevelInfo[]
  stock: (kind: string) => number
  busy: boolean
  onClose: () => void
  onShip: (method: string, pack: string, photos: boolean) => void
}) {
  const [method, setMethod] = useState('standard')
  const [pack, setPack] = useState('sleeved')
  const [photos, setPhotos] = useState(true)
  const est = sh.est_postage?.[method] ?? 0
  const chosenPack = packs.find((p) => p.id === pack)

  const shortOf = (lvl: PackLevelInfo | undefined) => {
    if (!lvl) return null
    if (stock('mailer') < 1) return 'bubble mailer'
    for (const pc of lvl.perCard) if (stock(pc.kind) < pc.n * sh.quantity) return pc.kind === 'sleeve' ? 'penny sleeves' : pc.kind === 'toploader' ? 'toploaders' : 'one-touches'
    return null
  }
  const short = shortOf(chosenPack)

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(560px, 94vw)', maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="modal-head">
          <div>
            <h2 style={{ margin: 0 }}>📮 Pack & ship — {sh.quantity > 1 ? `${sh.quantity}× ` : ''}{sh.name}</h2>
            <div className="faint small">{sh.buyer} · escrowed {fmtUsd(sh.net)} after fee {fmtUsd(sh.fee)}</div>
          </div>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>

        <b className="small">Postage</b>
        <div className="grid cols3 mt8">
          {methods.map((m) => (
            <div key={m.id} className="panel" style={{ margin: 0, cursor: 'pointer', padding: 10, borderColor: method === m.id ? 'var(--yellow)' : undefined }} onClick={() => setMethod(m.id)}>
              <b className="small">{m.icon} {m.label}</b>
              <div className="faint small" style={{ marginTop: 4 }}>{fmtUsd(m.base + sh.gross * m.pct)}</div>
              <div className="faint small" style={{ marginTop: 4 }}>{m.blurb}</div>
            </div>
          ))}
        </div>

        <b className="small" style={{ display: 'block', marginTop: 14 }}>Packing</b>
        <div className="grid cols2 mt8">
          {packs.map((p) => {
            const missing = shortOf(p)
            return (
              <div key={p.id} className="panel" style={{ margin: 0, cursor: 'pointer', padding: 10, borderColor: pack === p.id ? 'var(--yellow)' : undefined, opacity: missing ? 0.55 : 1 }} onClick={() => !missing && setPack(p.id)}>
                <b className="small">{p.icon} {p.label}</b>
                <div className="faint small" style={{ marginTop: 4 }}>{p.blurb}</div>
                <div className="faint small" style={{ marginTop: 4, color: missing ? 'var(--red)' : undefined }}>
                  {p.perCard.length === 0 ? 'uses nothing' : p.perCard.map((pc) => `${pc.n * sh.quantity}× ${pc.kind}`).join(' + ')} + 1 mailer{missing ? ` — short ${missing}!` : ''}
                </div>
              </div>
            )
          })}
        </div>

        <label className="row mt14" style={{ gap: 8, cursor: 'pointer', alignItems: 'center' }}>
          <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} />
          <span className="small">📷 Take pack-out photos <span className="faint">(free — your evidence in any dispute)</span></span>
        </label>

        <div className="row mt14" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="small">Postage due: <b style={{ color: 'var(--gold)' }}>{fmtUsd(est)}</b> · net on delivery <b>{fmtUsd(sh.gross - sh.fee - est)}</b></span>
          <button className="primary" disabled={busy || !!short} onClick={() => onShip(method, pack, photos)}>
            {short ? `Restock ${short}` : `Ship it ${method === 'priority' ? '🚚' : method === 'standard' ? '📦' : '📬'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
