import { useEffect, useState } from 'react'
import { api } from '../api'
import type { SealedBackfillStatus, SaveBackupRow } from '../api'
import { useStore } from '../store'
import { fmtDate, fmtUsd } from '../components'
import { soundEnabled, setSoundEnabled } from '../audio'

type SettingsData = Awaited<ReturnType<typeof api.settings>>

export function SettingsView() {
  const { toast, refreshState, state: st, theme, setTheme, foil, setFoil } = useStore()
  const replayTutorial = async () => {
    await api.tutorialReplay()
    await refreshState()
    toast('Welcome walkthrough armed — back it comes', 'good')
  }
  const setDayLength = async (hours: 12 | 24) => {
    if ((st?.day?.lengthHours ?? 12) === hours) return
    if (!confirm(hours === 12
      ? 'Switch game days to 12 real hours? The daily heartbeat (rent, wear, snapshots, grading) fires twice per real day from the next boundary.'
      : 'Switch game days to 24 real hours? The daily heartbeat returns to one pass per real day.')) return
    try {
      await api.setDayLength(hours)
      toast(hours === 12 ? 'Game days are 12 real hours now' : 'Game days are 24 real hours now', 'good')
    } catch {
      toast('Could not change day length', 'bad')
    }
    refreshState()
  }
  const [data, setData] = useState<SettingsData | null>(null)
  const [key, setKey] = useState('')
  const [pc, setPc] = useState('')
  const [ebayId, setEbayId] = useState('')
  const [ebaySecret, setEbaySecret] = useState('')
  const [fx, setFx] = useState('')
  const [sealedBf, setSealedBf] = useState<SealedBackfillStatus | null>(null)
  const [sound, setSound] = useState(soundEnabled())
  const [backups, setBackups] = useState<SaveBackupRow[] | null>(null)
  const [lastBackupDay, setLastBackupDay] = useState<string | null>(null)
  const [shopInfo, setShopInfo] = useState<{ rent: number; tierLabel: string } | null>(null)
  // Live numbers for the pace panel — your actual rent and your last snapshot
  // moment, so the table shows YOUR day rather than a generic one.
  useEffect(() => {
    api.shop().then((d) => { if (d.open) setShopInfo({ rent: d.shop.rent, tierLabel: d.shop.tierLabel }) }).catch(() => {})
  }, [])
  const pace = {
    rent: shopInfo ? `${fmtUsd(shopInfo.rent)}/day at ${shopInfo.tierLabel}` : '',
    snapshot: lastBackupDay && lastBackupDay.length >= 10 ? lastBackupDay.slice(0, 10) : '',
  }
  const [restoring, setRestoring] = useState<string | null>(null)

  const load = () => {
    api.settings().then(setData).catch(() => {})
    api.sealedStatus().then(setSealedBf).catch(() => {})
    api.saveBackups().then((r) => { setBackups(r.backups); setLastBackupDay(r.daily.lastDay) }).catch(() => {})
  }
  useEffect(() => { load() }, [])

  // A backfill pass takes ~40 minutes for ~900 cards at PriceCharting's 1 req/sec —
  // keep the progress line live while it runs.
  useEffect(() => {
    if (!data?.backfill.running) return
    const t = setInterval(() => {
      api.priceBackfillStatus().then((b) => setData((d) => (d ? { ...d, backfill: b } : d))).catch(() => {})
    }, 5000)
    return () => clearInterval(t)
  }, [data?.backfill.running])

  // A weekly catalog delta runs on a server timer — reflect its live state here.
  useEffect(() => {
    if (!data?.delta?.running) return
    const t = setInterval(() => {
      api.catalogDelta().then((d) => setData((prev) => (prev ? { ...prev, delta: d } : prev))).catch(() => {})
    }, 5000)
    return () => clearInterval(t)
  }, [data?.delta?.running])

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

  const saveFx = async () => {
    const v = Number(fx)
    if (!(Number.isFinite(v) && v >= 0.5 && v <= 3)) {
      toast('Rate must be a number between 0.5 and 3', 'bad')
      return
    }
    try {
      const r = await api.setPriceSources({ eurUsdRate: v })
      if (!r.ok || r.error) toast(r.error || 'Rate rejected — previous value kept', 'bad')
      else {
        toast(`Cardmarket FX rate updated — €1 = $${r.eurUsdRate}`, 'good')
        setFx('')
        load()
      }
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
    try {
      const res = await api.priceBackfill()
      toast(res.started ? 'Backfill started — free TCGplayer mirror first, then PriceCharting/eBay within their daily quotas' : res.reason || 'Backfill not started', res.started ? 'good' : 'bad')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Backfill failed to start', 'bad')
    }
    load()
  }

  const runMirror = async () => {
    try {
      const r = await api.tcgcsvSync()
      if (r.ok) toast(r.cardsPriced > 0 ? `Free mirror sync done — ${r.cardsPriced} cards priced across ${r.setsSynced} set(s)` : 'Mirror sync done — nothing new to price', 'good')
      else toast(r.error || 'Mirror sync did not run', 'bad')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Mirror sync failed', 'bad')
    }
    load()
  }

  const restartSync = async () => {
    await fetch('/api/sync/restart', { method: 'POST' })
    toast('Sync restarted from the beginning')
    refreshState()
  }

  const runDelta = async () => {
    try {
      const r = await api.runCatalogDelta()
      if (!r.ran) toast(r.reason || 'Delta sync did not run', 'bad')
      else {
        const s = r.summary
        const n = s?.newSets.length ?? 0
        const u = s?.updatedSets.length ?? 0
        const f = s?.errors.length ?? 0
        toast(n + u > 0 ? `Catalog delta done — ${n} new set(s), ${u} updated${f ? `, ${f} failed` : ''}` : 'Catalog is already current — no new sets found', 'good')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delta sync failed', 'bad')
    }
    load()
  }

  const resetSave = async () => {
    if (!confirm('Reset your save? Everything starts fresh — $1,000, day 1, empty collection, no businesses, no events in flight, no records or achievements. The card database and your Settings (API keys, day length) are kept.')) return
    try {
      await api.resetSave()
      toast('Save reset', 'good')
    } catch (e) {
      // req() surfaces the server's {error} — show the exact statement that
      // broke the wipe instead of a generic "see the server log".
      const m = e instanceof Error ? e.message : ''
      toast(m && !m.startsWith('Request failed') ? `Reset failed — ${m}` : 'Reset failed — nothing was changed; see the server log', 'bad')
    }
    refreshState()
    load()
  }

  const backupNow = async () => {
    try {
      const r = await api.saveBackupNow()
      toast('Snapshot saved — the last 3 are kept below', 'good')
      setBackups([r.backup, ...(backups ?? [])].slice(0, 3))
      setLastBackupDay(new Date().toISOString().slice(0, 10))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Snapshot failed', 'bad')
    }
    load()
  }

  const restore = async (b: SaveBackupRow) => {
    const when = `${fmtDate(b.createdAt)} · ${new Date(b.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    if (!confirm(`Restore ${when}?\n\nThe game rewinds to this snapshot: cash ${b.cash != null ? fmtUsd(b.cash) : '—'} and ${b.inventory} cards in the collection. Everything since the snapshot is parked in a safety backup first, so a restore can itself be undone.`)) return
    setRestoring(b.file)
    try {
      const r = await api.saveRestore(b.file)
      if (r.safety) {
        toast(`Restored ${when} — your pre-restore state was kept as a safety backup`, 'good')
      } else {
        toast(`Restored ${when}`, 'good')
      }
      await refreshState()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Restore failed', 'bad')
    }
    setRestoring(null)
    load()
  }

  const bf = data?.backfill
  const fxNum = Number(fx)
  const fxValid = fx.trim() !== '' && Number.isFinite(fxNum) && fxNum >= 0.5 && fxNum <= 3

  return (
    <div>
      <div className="page-head desk">
        <div className="ph-id">
          <span className="ph-mark" aria-hidden>⚙️</span>
          <div>
            <h1>Settings</h1>
            <div className="sub">Data sources, sync management, and save controls.</div>
          </div>
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
              <tr><td>Last delta sync</td><td className="num">{fmtDate(data?.delta?.lastRunAt)}</td></tr>
              <tr><td>Last price snapshot</td><td className="num">{fmtDate(data?.lastSnapshotAt)}</td></tr>
            </tbody>
          </table>
          <p className="small muted mt14">
            Every week the game checks pokemontcg.io for new sets and cards and pulls just the delta, so new releases
            appear in the shop and pack pool automatically.
            {(() => {
              const s = data?.delta?.lastSummary
              if (!s) return null
              const n = s.newSets.length
              const u = s.updatedSets.length
              if (n + u === 0) return <> Last check: catalog already current.</>
              const names = [...s.newSets, ...s.updatedSets].slice(0, 3).map((x) => x.name)
              return <> Last check pulled {n} new and {u} updated set(s){names.length ? ` — ${names.join(', ')}${n + u > names.length ? '…' : ''}` : ''}.</>
            })()}
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={runDelta} disabled={data?.delta?.running}>
              {data?.delta?.running ? 'Checking for new releases…' : 'Check for new sets now'}
            </button>
            <button className="danger" onClick={restartSync}>Restart full sync</button>
          </div>
        </div>
      </div>

      <div className="panel mt14">
        <h2>External price sources <span className="badge">optional</span></h2>
        <p className="small muted mb14">
          Cards without TCGplayer data (2026 sets, novelty promos) are priced from these REAL marketplaces
          instead of an internal estimate. The <b>free TCGplayer mirror</b> (tcgcsv.com) runs first automatically —
          no key needed. <b>PriceCharting</b> supplies its tracked raw card price
          (paid API — token from your PriceCharting subscription page, 1,000 calls/day). <b>eBay</b> supplies the median of
          active US fixed-price listings (free app credentials from
          the <a href="https://developer.ebay.com" target="_blank" rel="noreferrer">eBay Developer Program</a> —
          production keys, 5,000 calls/day). When a daily quota runs out, unpriced cards fall back to a clearly-labeled
          simulated market price until the quota resets — real prices return automatically. Cardmarket's
          European trend prices are also a real fallback tier, converted from EUR with the rate below.
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
        <div className="mt14">
          <div className="faint small mb8">EUR→USD RATE <span className="badge">cardmarket</span></div>
          <div className="row" style={{ gap: 8 }}>
            <input
              type="text"
              inputMode="decimal"
              placeholder={data ? `Current: €1 = $${data.eurUsdRate.toFixed(2)} — enter a new rate` : 'e.g. 1.17'}
              value={fx}
              onChange={(e) => setFx(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="primary" onClick={saveFx} disabled={!fxValid}>Update rate</button>
          </div>
          <div className="small muted mt8">
            Cardmarket trend prices are European (EUR) — this rate converts them to the game's USD economy, and
            changes apply immediately to future price lookups.{' '}
            {fxValid ? <>You're setting €1 = <b>${fxNum.toFixed(3)}</b>.</> : <>Valid range: 0.5 – 3.</>}
          </div>
        </div>
        <div className="row mt14" style={{ gap: 8 }}>
          <button className="primary" onClick={savePriceSources} disabled={!pc && !ebayId && !ebaySecret}>Save sources</button>
          <button onClick={runMirror}>Sync free TCGplayer mirror now</button>
          <button onClick={runBackfill} disabled={bf?.running}>Price my unpriced cards now</button>
        </div>
        {bf && (bf.running || bf.done > 0) && (
          <div className="mt14">
            <div className="small muted mb8">
              {bf.running
                ? `Backfilling… ${bf.done}/${bf.total} cards checked, ${bf.priced} priced (${bf.lastSource ?? '…'}) — about ${Math.max(1, Math.ceil((bf.total - bf.done) * 2.2 / 60))} min remaining`
                : `Last backfill: ${bf.priced} of ${bf.total} cards priced from external sources${bf.lastError ? ` — stopped: ${bf.lastError}` : ''}`}
            </div>
            <div style={{ height: 6, background: 'var(--panel-border, #2a2a35)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${bf.total ? Math.round((bf.done / bf.total) * 100) : 0}%`, height: '100%', background: 'var(--accent, var(--blue))', transition: 'width 1s' }} />
            </div>
            {bf.running && bf.lastError && <div className="small muted mt8">⚠ {bf.lastError}</div>}
          </div>
        )}
        {bf && !bf.running && (data?.unpricedCount ?? 0) > 0 && (
          <div className="small muted mt14">
            {(data?.unpricedCount ?? 0).toLocaleString()} cards still have no REAL market price (mostly 2026 sets the upstream API doesn't price yet). They're priced automatically in this order: the <b>free TCGplayer mirror</b> (tcgcsv.com — no key, no quota) → <b>PriceCharting/eBay</b> within their daily quotas → a clearly-labeled <span className="badge sim">SIM · MARKET</span> simulated price until real data lands.
          </div>
        )}
        {data?.quota && (
          <div className="small muted mt8">
            Today's external-API budget — PriceCharting {data.quota.pc.budget}/{data.quota.pc.limit} · eBay {data.quota.ebay.budget}/{data.quota.ebay.limit}, resets {fmtDate(data.quota.resetsAt)}.
            {data.tcgcsv?.lastSync && <> Last free-mirror sync: {fmtDate(data.tcgcsv.lastSync)}.</>}
          </div>
        )}
      </div>

      <div className="panel mt14">
        <h2>S&P 500 benchmark feed {data?.benchmark && (
          <span className={`badge ${data.benchmark.mode === 'real' ? 'live' : 'est'}`} style={{ marginLeft: 8 }}>
            {data.benchmark.mode === 'real' ? 'real closes' : 'model ~10%/yr'}
          </span>
        )}</h2>
        <p className="small muted">
          The Portfolio view's index line and "if it had been the S&P" what-if run on real ^GSPC daily closes from
          Yahoo Finance's public chart endpoint — free, no key — cached here and topped up twice a day, with a
          five-minute retry after a failed fetch. When the feed is dry the portfolio says so and falls back to the
          labeled long-run model instead of pretending.
        </p>
        <div className="row small" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          <span><b>{(data?.benchmark.rows ?? 0).toLocaleString()}</b> <span className="muted">closes cached</span></span>
          {data?.benchmark.oldestDay && <span className="muted">{data.benchmark.oldestDay} → {data.benchmark.newestDay}</span>}
          <span><span className="muted">last attempt:</span> {data?.benchmark.lastFetchAt ? fmtDate(data.benchmark.lastFetchAt) : '—'}</span>
          <span><span className="muted">last success:</span> {data?.benchmark.lastSuccessAt ? fmtDate(data.benchmark.lastSuccessAt) : 'never'}</span>
          {data?.benchmark.lastHost && <span className="muted">via {data.benchmark.lastHost}</span>}
          <span className={`badge ${data?.benchmark.covered ? 'live' : 'est'}`}>{data?.benchmark.covered ? 'covers save span' : 'catching up'}</span>
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
        <h2>Tutorial</h2>
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <button className="ghost" onClick={replayTutorial}>Replay the welcome walkthrough</button>
          <span className="faint small">
            {st?.tutorials.start ? 'Not shown — you finished it on this save.' : 'Will open next time you leave Settings.'}
          </span>
        </div>
      </div>

      <div className="panel mt14">
        <h2>Game pace — what one game day means</h2>
        <div className="row small" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span>Game day length:</span>
          <span
            className={`chip ${(st?.day?.lengthHours ?? 12) === 12 ? 'on' : ''}`}
            onClick={() => setDayLength(12)}
            style={{ cursor: 'pointer' }}
          >12h — two game-days per real day</span>
          <span
            className={`chip ${(st?.day?.lengthHours ?? 12) === 24 ? 'on' : ''}`}
            onClick={() => setDayLength(24)}
            style={{ cursor: 'pointer' }}
          >24h — the classic cadence</span>
          <span className="faint small">takes effect at the next 00:00/12:00 UTC boundary</span>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          One game day is <b>{(st?.day?.lengthHours ?? 12) === 24 ? '24 real hours (rolling at 00:00 UTC)' : '12 real hours (rolling at 00:00 and 12:00 UTC)'}</b> — the header day clock counts down to the next
          boundary. Every daily system below lands at that boundary, and only the real-world data syncs ignore the game
          day (they mirror live market sources on their own schedules).
        </p>
        <table className="table">
          <thead><tr><th>System</th><th>Cadence</th><th className="right">When it lands</th></tr></thead>
          <tbody>
            <tr><td className="small">🏪 Shop rent + staff payroll</td><td className="small muted">every game day</td><td className="num small">00:00 / 12:00 UTC{pace.rent ? ` — ~${pace.rent}` : ''}</td></tr>
            <tr><td className="small">🏦 Loan interest</td><td className="small muted">accrues every game day</td><td className="num small">00:00 / 12:00 UTC</td></tr>
            <tr><td className="small">🀄 Condition wear + 🎲 disaster roll</td><td className="small muted">daily chances</td><td className="num small">rolled through the day, stamped at each boundary</td></tr>
            <tr><td className="small">💾 Save snapshot</td><td className="small muted">once per game day</td><td className="num small">first tick after each 00:00/12:00 boundary{pace.snapshot ? ` — last: ${pace.snapshot}` : ''}</td></tr>
            <tr><td className="small">🛡 Insurance, 🗝️ lockers, 🔐 vault</td><td className="small muted">weekly bills</td><td className="num small">their own next-draft clock (see Today panel)</td></tr>
            <tr><td className="small">⚖ Grading turnaround</td><td className="small muted">Express 1–2 days · Standard 3–6 · Premium 1</td><td className="num small">game-days (12h) — express is back overnight</td></tr>
            <tr><td className="small">🏢 Franchise stores</td><td className="small muted">rent + manager wage every game day</td><td className="num small">00:00 / 12:00 UTC</td></tr>
            <tr><td className="small">🌅 Day recap</td><td className="small muted">once per rollover</td><td className="num small">first tick after each boundary</td></tr>
            <tr><td className="small">🌐 Real-world syncs (prices, catalog)</td><td className="small muted muted">daily refresh · weekly delta</td><td className="num small">real-world schedule — NOT game days</td></tr>
          </tbody>
        </table>
        <div className="faint small" style={{ marginTop: 6 }}>
          Hover the header day clock any time for today's rolls and the known-out total.
        </div>
      </div>

      <div className="panel mt14">
        <h2>Appearance</h2>
        <div className="row" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="chip-row">
            <span className={`chip ${theme === 'dark' ? 'on' : ''}`} onClick={() => setTheme('dark')}>☾ Dark</span>
            <span className={`chip ${theme === 'light' ? 'on' : ''}`} onClick={() => setTheme('light')}>☀ Light</span>
          </span>
          <span className="faint small">
            {theme === 'dark'
              ? 'Dark — the night chrome: card art carries the colour.'
              : 'Light — the paper TCG look: white cards on a blue-checked playmat.'}
          </span>
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
          <button className={foil ? 'ghost' : 'primary'} onClick={() => setFoil(!foil)}>
            {foil ? 'Turn card foil off' : 'Turn card foil on'}
          </button>
          <span className="faint small">
            {foil
              ? 'On — holo cards shimmer, tint and tilt under the pointer.'
              : 'Off — every card shows its scan flat. The holofoil work is parked, not deleted: this switch is the whole of it, and this browser remembers your choice.'}
          </span>
        </div>
      </div>

      <div className="panel mt14">
        <h2>Ceremony sound</h2>
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <button className={sound ? 'ghost' : 'primary'} onClick={() => { const next = !sound; setSoundEnabled(next); setSound(next) }}>
            {sound ? '🔇 Mute ceremony sound' : '🔊 Unmute ceremony sound'}
          </button>
          <span className="faint small">
            {sound
              ? 'On — foil crinkles while you pull, a chime when the rip lands, stingers for the pulls that earn them.'
              : 'Muted — the ceremony stays visual only (this browser remembers your choice).'}
          </span>
        </div>
      </div>

      <div className="panel mt14">
        <h2>Save backups <span className="badge">last 3 · once per game day</span></h2>
        <p className="small muted mb14">
          The game photographs its entire save — cash, collection, sealed, every history — once per game day and keeps
          the last three. A mistake that would otherwise be permanent (a mispriced mass sale, a disaster, a bad bulk
          buy) only costs you back to yesterday. Restoring rewinds the whole save to the snapshot's moment and first
          parks a safety copy of the current world, so even a restore can be undone.
        </p>
        <div className="row mt8" style={{ gap: 8, alignItems: 'center' }}>
          <button onClick={backupNow}>📸 Snapshot now</button>
          <span className="faint small">
            {lastBackupDay ? `Last automatic snapshot: ${fmtDate(lastBackupDay)} (game day)` : 'No automatic snapshot yet — one lands on the first game day you play.'}
          </span>
        </div>
        <table className="table mt14">
          <thead>
            <tr><th>Snapshot</th><th>Cash</th><th>Cards</th><th>Sealed</th><th>Size</th><th></th></tr>
          </thead>
          <tbody>
            {(backups ?? []).map((b) => (
              <tr key={b.file}>
                <td>
                  <b>{new Date(b.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</b>{' '}
                  <span className="muted small">{new Date(b.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                </td>
                <td className="num">{b.cash != null ? fmtUsd(b.cash) : '—'}</td>
                <td className="num">{b.inventory.toLocaleString()}</td>
                <td className="num">{b.sealed.toLocaleString()}</td>
                <td className="num">{(b.bytes / 1024).toFixed(0)} KB</td>
                <td className="right">
                  <button
                    className="danger"
                    disabled={restoring === b.file}
                    onClick={() => restore(b)}
                  >
                    {restoring === b.file ? 'Restoring…' : 'Restore'}
                  </button>
                </td>
              </tr>
            ))}
            {backups != null && backups.length === 0 && (
              <tr><td colSpan={6} className="muted small">No snapshots yet — the first lands after a game day passes.</td></tr>
            )}
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
