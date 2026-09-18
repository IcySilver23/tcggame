import { useEffect, useState } from 'react'
import { api } from '../api'
import type { SealedBackfillStatus } from '../api'
import { useStore } from '../store'
import { fmtDate } from '../components'

type SettingsData = Awaited<ReturnType<typeof api.settings>>

export function SettingsView() {
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<SettingsData | null>(null)
  const [key, setKey] = useState('')
  const [pc, setPc] = useState('')
  const [ebayId, setEbayId] = useState('')
  const [ebaySecret, setEbaySecret] = useState('')
  const [sealedBf, setSealedBf] = useState<SealedBackfillStatus | null>(null)

  const load = () => {
    api.settings().then(setData).catch(() => {})
    api.sealedStatus().then(setSealedBf).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const saveKey = async () => {
    await api.setApiKey(key)
    toast('API key saved — future syncs use it (20,000 req/day)', 'good')
    setKey('')
    load()
  }

  const savePriceSources = async () => {
    try {
      await api.setPriceSources({
        ...(pc ? { pricechartingToken: pc } : {}),
        ...(ebayId ? { ebayClientId: ebayId } : {}),
        ...(ebaySecret ? { ebayClientSecret: ebaySecret } : {}),
      })
      toast(pc ? 'Price sources saved — backfilling cards AND real sealed prices now' : 'Price sources saved — backfilling unpriced cards now', 'good')
      setPc(''); setEbayId(''); setEbaySecret('')
      load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'bad')
    }
  }

  const runSealedBackfill = async () => {
    const r = await api.startSealedBackfill()
    if (r.ok && r.status.configured) {
      toast('Sealed backfill started — ~1 product/second, the shop converts to real prices as it runs', 'good')
      load()
    } else {
      toast('Add a PriceCharting token first — sealed backfill needs it', 'bad')
    }
  }

  const runBackfill = async () => {
    const res = await api.priceBackfill()
    toast(res.started ? 'Backfill started — unpriced cards are being priced from PriceCharting/eBay' : res.reason || 'Backfill not started', res.started ? 'good' : 'bad')
    load()
  }

  const restartSync = async () => {
    await fetch('/api/sync/restart', { method: 'POST' })
    toast('Sync restarted from the beginning')
    refreshState()
  }

  const resetSave = async () => {
    if (!confirm('Reset your save? Cash returns to $1,000 and inventory/sales history is wiped. Card database is kept.')) return
    await api.resetSave()
    toast('Save reset', 'good')
    refreshState()
    load()
  }

  const bf = data?.backfill
  const anySource = bf?.sources.pricecharting || bf?.sources.ebay

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">Data sources, sync management, and save controls.</div>
        </div>
      </div>

      <div className="grid cols2">
        <div className="panel" style={{ margin: 0 }}>
          <h2>Pokémon TCG API key <span className="badge">optional</span></h2>
          <p className="small muted mb14">
            The game syncs real card data from the official pokemontcg.io API. Without a key you get
            1,000 requests/day (fine — the sync is checkpointed and resumes). With a free API key you get
            20,000/day. Get one at <a href="https://pokemontcg.io" target="_blank" rel="noreferrer">pokemontcg.io</a>.
          </p>
          <div className="row">
            <input type="password" placeholder={data?.apiKeySet ? '•••••••• (saved)' : 'X-Api-Key'} value={key} onChange={(e) => setKey(e.target.value)} style={{ flex: 1 }} />
            <button className="primary" onClick={saveKey}>Save</button>
          </div>
        </div>

        <div className="panel" style={{ margin: 0 }}>
          <h2>Database status</h2>
          <table className="table">
            <tbody>
              <tr><td>Cards</td><td className="num">{(data?.cardCount ?? 0).toLocaleString()}</td></tr>
              <tr><td>Price records</td><td className="num">{(data?.priceRecordCount ?? 0).toLocaleString()}</td></tr>
              <tr><td>Sets synced</td><td className="num">{fmtDate(data?.setsSyncedAt)}</td></tr>
              <tr><td>Cards synced</td><td className="num">{fmtDate(data?.cardsSyncedAt)}</td></tr>
              <tr><td>Last price snapshot</td><td className="num">{fmtDate(data?.lastSnapshotAt)}</td></tr>
            </tbody>
          </table>
          <button className="mt14" onClick={restartSync}>Restart full sync</button>
        </div>
      </div>

      <div className="panel mt14">
        <h2>External price sources <span className="badge">optional</span></h2>
        <p className="small muted mb14">
          Cards without TCGplayer data (2026 sets, novelty promos) are priced from these REAL marketplaces
          instead of an internal estimate. <b>PriceCharting</b> supplies its tracked raw card price
          (paid API — token from your PriceCharting subscription page). <b>eBay</b> supplies the median of
          active US fixed-price listings (free app credentials from
          the <a href="https://developer.ebay.com" target="_blank" rel="noreferrer">eBay Developer Program</a> —
          production keys). Add either one; PriceCharting is preferred when available.
        </p>
        <div className="grid cols2">
          <div>
            <div className="faint small mb8">PRICECHARTING TOKEN {data?.pricechartingTokenSet && <span className="badge live">saved</span>}</div>
            <input type="password" placeholder={data?.pricechartingTokenSet ? '•••••••• (saved)' : '40-character API token'} value={pc} onChange={(e) => setPc(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <div className="faint small mb8">EBAY APP ID (CLIENT ID) {data?.ebayClientIdSet && <span className="badge live">saved</span>}</div>
            <input type="password" placeholder={data?.ebayClientIdSet ? '•••••••• (saved)' : 'Client ID'} value={ebayId} onChange={(e) => setEbayId(e.target.value)} style={{ width: '100%' }} />
            <div className="faint small mb8 mt14">EBAY CLIENT SECRET</div>
            <input type="password" placeholder={data?.ebayClientIdSet ? '•••••••• (saved)' : 'Client secret'} value={ebaySecret} onChange={(e) => setEbaySecret(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>
        <div className="row mt14" style={{ gap: 8 }}>
          <button className="primary" onClick={savePriceSources} disabled={!pc && !ebayId && !ebaySecret}>Save sources</button>
          <button onClick={runBackfill} disabled={!anySource}>Price my unpriced cards now</button>
          {bf && (bf.running || bf.done > 0) && (
            <span className="small muted">
              {bf.running
                ? `Backfilling… ${bf.done}/${bf.total} cards checked, ${bf.priced} priced (${bf.lastSource ?? '…'})`
                : `Last backfill: ${bf.priced} cards priced from external sources`}
            </span>
          )}
        </div>
      </div>

      <div className="panel mt14">
        <h2>Sealed product prices {sealedBf?.real != null && sealedBf.products != null && (
          <span className={`badge ${sealedBf.configured ? 'live' : 'est'}`} style={{ marginLeft: 8 }}>
            {sealedBf.real}/{sealedBf.products} from PriceCharting
          </span>
        )}</h2>
        <p className="small muted">
          The same PriceCharting token also prices <b>sealed product</b> — booster packs, bundles, ETBs, and displays
          for every synced set. Until a token is set, sealed prices are model estimates anchored to each set's real
          pull value (and they still appreciate out of print). Backfill runs at PriceCharting's 1 request/second pace,
          so the full catalog takes a few minutes; new products are priced as they're added.
        </p>
        <div className="row mt14" style={{ gap: 8 }}>
          <button className="primary" onClick={runSealedBackfill} disabled={!sealedBf?.configured || sealedBf.running}>
            {sealedBf?.running ? 'Backfilling…' : 'Price sealed products now'}
          </button>
          {!sealedBf?.configured && <span className="small muted">Save a PriceCharting token above to unlock this.</span>}
          {sealedBf && (sealedBf.running || sealedBf.total > 0) && (
            <span className="small muted">
              {sealedBf.running
                ? `Pricing… ${sealedBf.done}/${sealedBf.total} products checked, ${sealedBf.updated} matched on PriceCharting`
                : `Last run: ${sealedBf.updated}/${sealedBf.total} products matched`}
            </span>
          )}
        </div>
      </div>

      <div className="panel mt14">
        <h2>Data sources & attribution</h2>
        <p className="small muted">
          TCG Life does not generate card data or prices. Card identity, sets, and imagery come from the
          official Pokémon TCG API (pokemontcg.io); USD market prices are TCGplayer's, retrieved through that
          API with retrieval timestamps; EUR prices and sale averages are Cardmarket's. Optional PriceCharting
          and eBay prices are fetched live from those marketplaces and stored with retrieval timestamps.
          Images are loaded directly from the API's official image CDN — nothing is copied into this project.
          Card text and artwork © Pokémon / Nintendo / Creatures Inc. / GAME FREAK inc. This is a fan-made
          simulator and is not affiliated with or endorsed by The Pokémon Company.
        </p>
        <table className="table mt8">
          <thead><tr><th>Source</th><th>Provides</th><th></th></tr></thead>
          <tbody>
            {(data?.dataSources ?? []).map((s) => (
              <tr key={s.name}>
                <td><b>{s.name}</b></td>
                <td className="small muted">{s.role}</td>
                <td className="right"><a href={s.url} target="_blank" rel="noreferrer">visit</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel mt14">
        <h2>Danger zone</h2>
        <div className="row mt8">
          <button className="danger" onClick={resetSave}>Reset save (keeps card database)</button>
        </div>
      </div>
    </div>
  )
}
