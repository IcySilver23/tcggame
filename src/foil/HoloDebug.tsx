// Development-only holofoil inspector.
//
// It draws the SAME layer stack the cards draw — stages.ts — one stage at a time,
// so a claim like "the foil never leaves the mask" can be checked by eye against
// the mask view rather than trusted. It is mounted only in dev builds (see
// App.tsx) and deliberately has no player-facing entrance.
//
// What it is for: calibration and evidence. Each card shows the aspect it came
// from, the motif the pack calls it, and whether its foil COVERAGE is verified
// against a real printing or merely modelled.

import { useEffect, useMemo, useRef, useState } from 'react'
import { foilMaskFor } from './mask'
import { maskValue } from './mask'
import { RADIANT_ASSETS, RADIANT_CARD_IDS } from './radiant-index'
import { COSMOS_SHOWCASE } from './cosmos-index'
import { REVERSE_SHOWCASE } from './reverse-index'
import { STARLIGHT_SHOWCASE } from './starlight-index'
import { CRACKEDICE_SHOWCASE } from './crackedice-index'
import { printingFor } from './printing-db'
import { patternLabel } from './patterns'
import { DELTA_SPECIES_HOLO_RARES } from './delta-species-index'
import { loadMarkFieldFor, type MarkField } from './mark-field'
import { DEFAULT_FOIL_SETTINGS, FOIL_MODES, meanLift, paintFoil, type FoilMode, type FoilSettings } from './stages'
import { loadSurface, surfaceFor, SURFACE_SHOWCASE, SURFACE_TEXTURES } from './surface-textures'
import { SPECIAL_REVERSE_SHOWCASE } from './reverse-special-index'
import { ENERGY_REVERSE_SHOWCASE } from './reverse-energy-large-index'
import type { FoilSurface } from './engine'
import {
  SPECIAL_REVERSE_ETCH_STRENGTH,
  SPECIAL_REVERSE_ETCH_SURFACE,
  specialReverseEtchFor,
  specialReverseEtchMaskFor,
} from './reverse-etch'
import { applyRelief, renderDiffPreview, renderNormalPreview, renderReliefPreview, type DiffStats } from './surface-preview'
import { referenceCaption, referenceFor } from './reference'

const W = 260
const H = 363

/** Every card the inspector can draw: the Radiant pack plus the Cosmos showcase. */
type DebugCard = {
  cardId: string; setId: string; number: string; name: string; rarity: string
  motif?: string; group: string; variant?: string | null
  types?: string | null; supertype?: string | null
}
const DEBUG_CARDS: DebugCard[] = [
  ...RADIANT_CARD_IDS.map((id) => {
    const a = RADIANT_ASSETS[id]
    return { cardId: id, setId: a.setId, number: a.number, name: a.name, rarity: a.rarity, motif: a.motif, group: 'Radiant Collection' }
  }),
  ...COSMOS_SHOWCASE.map((c) => ({ ...c, group: 'Cosmos' })),
  ...REVERSE_SHOWCASE.map((c) => ({ ...c, group: 'Reverse' })),
  ...STARLIGHT_SHOWCASE.map((c) => ({ ...c, group: 'Starlight' })),
  ...CRACKEDICE_SHOWCASE.map((c) => ({ ...c, group: 'Cracked Ice' })),
  ...SPECIAL_REVERSE_SHOWCASE,
  ...ENERGY_REVERSE_SHOWCASE.map((c) => ({ ...c, group: 'Energy reverse' })),
  ...SURFACE_SHOWCASE,
  // The δ Delta Species paper is plain foil: there is no sheet to decode, so the
  // inspector is where "no marks" has to be visible rather than inferred. Three of the
  // 50 indexed cards, one per expansion shape.
  ...DELTA_SPECIES_HOLO_RARES.slice(0, 3).map((c) => ({
    cardId: c.cardId, setId: c.setId, number: c.number, name: c.name, rarity: 'Rare Holo', group: 'Delta (plain foil)',
  })),
].filter((c, i, all) => all.findIndex((o) => o.cardId === c.cardId) === i)
const DEBUG_BY_ID = new Map(DEBUG_CARDS.map((c) => [c.cardId, c]))

const baseCache = new Map<string, Uint8ClampedArray | null>()

/** Same resolution the cards use, so the panel shows what the game shows. */
async function loadBase(cardId: string): Promise<Uint8ClampedArray | null> {
  if (baseCache.has(cardId)) return baseCache.get(cardId) ?? null
  const card = DEBUG_BY_ID.get(cardId)
  if (!card) return null
  const asset = { setId: card.setId, number: card.number }
  // Same-origin art (the CDN refuses cross-origin pixel reads). The full-size
  // scan is not published for every set — Generations RC has none — so fall back
  // to the standard one.
  const urls = [
    `/api/art/${asset.setId}/${asset.number}_hires.png`,
    `/api/art/${asset.setId}/${asset.number}.png`,
  ]
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((ok, fail) => {
      let i = 0
      const next = () => {
        if (i >= urls.length) { fail(new Error('art did not load')); return }
        img.src = urls[i++]
      }
      img.onload = () => ok()
      img.onerror = next
      next()
    })
    const off = document.createElement('canvas')
    off.width = W
    off.height = H
    const ctx = off.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, W, H)
    const data = new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data)
    baseCache.set(cardId, data)
    return data
  } catch {
    baseCache.set(cardId, null)
    return null
  }
}

function Slider({ label, value, min, max, step, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr 52px', gap: 8, alignItems: 'center', fontSize: 12 }}>
      <span className="faint">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value.toFixed(2)}</span>
    </label>
  )
}

export function HoloDebugPanel({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const referenceRef = useRef<HTMLCanvasElement | null>(null)
  const [cardId, setCardId] = useState('g1-RC6')
  const [mode, setMode] = useState<FoilMode>('composite')
  const [settings, setSettings] = useState<FoilSettings>(DEFAULT_FOIL_SETTINGS)
  const [tilt, setTilt] = useState({ deg: 55, axis: 45 })
  const [status, setStatus] = useState('loading art…')
  const [readout, setReadout] = useState({ lift: 0, coverage: 0, maskArea: 0, pattern: 'generic tile', surface: 'smooth' })
  const [surface, setSurface] = useState<FoilSurface | null>(null)
  const [view, setView] = useState<'composite' | 'relief' | 'normal' | 'diff' | 'reference'>('composite')
  const [diff, setDiff] = useState<DiffStats | null>(null)

  const asset = DEBUG_BY_ID.get(cardId)
  // Memoised: a fresh spec object each render would re-trigger the effect below,
  // which resets the status and reloads the art forever.
  const rarity = asset?.rarity ?? null
  const variant = asset?.variant ?? null
  const spec = useMemo(() => foilMaskFor({ cardId, rarity, variant }), [cardId, rarity, variant])
  // The database answer for this card, so the readout shows WHICH printing was
  // identified and how strong its evidence is, not just the mask shape.
  const printing = useMemo(() => printingFor({ cardId, rarity }), [cardId, rarity])
  const etch = useMemo(() => specialReverseEtchFor(asset?.setId, variant), [asset?.setId, variant])
  const surfaceId = useMemo(
    () => surfaceFor({ rarity, variant, cardId }) ?? (etch ? SPECIAL_REVERSE_ETCH_SURFACE : null),
    [rarity, variant, cardId, etch],
  )
  // The relief mask may be wider than the foil mask: the ball stays outside the
  // art, while the etched field is allowed to cross it.
  const reliefSpec = useMemo(
    () => (etch ? specialReverseEtchMaskFor(cardId) : spec),
    [etch, cardId, spec],
  )

  useEffect(() => {
    let live = true
    let field: MarkField | null = null
    setStatus('loading art…')
    void (async () => {
      const [base, loaded, loadedSurface] = await Promise.all([
        loadBase(cardId),
        loadMarkFieldFor({ cardId, rarity, variant, types: asset?.types, supertype: asset?.supertype }),
        surfaceId ? loadSurface(surfaceId) : Promise.resolve(null),
      ])
      field = loaded
      const effectiveSurface = loadedSurface && etch
        ? { ...loadedSurface, strength: SPECIAL_REVERSE_ETCH_STRENGTH }
        : loadedSurface
      setSurface(effectiveSurface)
      if (!live) return
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      if (!base) {
        setStatus('artwork failed to load (CORS or CDN) — nothing to inspect')
        return
      }
      const frame = new Uint8ClampedArray(W * H * 4)
      let diffStats: DiffStats | null = null
      // The relief fades in with tilt, exactly as the engine does it.
      const relief = effectiveSurface ? (effectiveSurface.strength ?? 0.45) * Math.min(1, Math.abs(tilt.deg) / 25) : 0
      if (view === 'normal' && effectiveSurface) {
        renderNormalPreview(frame, W, H, effectiveSurface.map)
      } else if (view === 'relief' && effectiveSurface) {
        renderReliefPreview(frame, base, W, H, reliefSpec, effectiveSurface.map, relief)
      } else if (view === 'diff') {
        paintFoil(frame, base, W, H, spec, tilt, { mode, settings, map: null, field })
        if (effectiveSurface && relief > 0) applyRelief(frame, W, H, reliefSpec, effectiveSurface.map, relief)
        diffStats = renderDiffPreview(frame, base, frame, W, H, reliefSpec)
      } else {
        paintFoil(frame, base, W, H, spec, tilt, { mode, settings, map: null, field })
        if (effectiveSurface && relief > 0) applyRelief(frame, W, H, reliefSpec, effectiveSurface.map, relief)
      }
      const img = new ImageData(W, H)
      img.data.set(frame)
      ctx.putImageData(img, 0, 0)
      if (view === 'diff') setDiff(diffStats)
      if (view === 'reference') {
        const rc = referenceRef.current
        const rctx = rc?.getContext('2d')
        if (rc && rctx) {
          const photo = referenceFor(cardId)
          if (photo) {
            const photoImg = new Image()
            photoImg.onload = () => { if (live) rctx.drawImage(photoImg, 0, 0, W, H) }
            photoImg.onerror = () => {
              if (!live) return
              const fallback = new ImageData(W, H)
              fallback.data.set(base)
              rctx.putImageData(fallback, 0, 0)
            }
            photoImg.src = photo.src
          } else {
            const scan = new ImageData(W, H)
            scan.data.set(base)
            rctx.putImageData(scan, 0, 0)
          }
        }
      }

      const composite = new Uint8ClampedArray(W * H * 4)
      paintFoil(composite, base, W, H, spec, tilt, { mode: 'composite', settings, map: null, field })
      if (effectiveSurface && relief > 0) applyRelief(composite, W, H, reliefSpec, effectiveSurface.map, relief)
      let maskArea = 0
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (spec && maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, W / H) === 255) maskArea++
        }
      }
      setReadout({
        lift: meanLift(base, composite, W, H, spec),
        coverage: field ? field.coverage : 0,
        maskArea: maskArea / (W * H),
        pattern: field ? `${field.label} — ${String(field.meta.paper ?? field.meta.reproduction ?? '')}` : 'plain foil — no texture shipped for this printing',
        surface: effectiveSurface
          ? `${etch ? 'full-card etch' : `${surfaceId} relief`} — ${SURFACE_TEXTURES[surfaceId!].verified ? 'verified' : 'MODELLED'}`
          : 'smooth — no relief for this card',
      })
      setStatus(field ? `${field.label} decoded${etch ? ' · full-card etch' : ''}` : 'no texture for this printing — plain foil, no marks')
    })()
    return () => { live = false }
  }, [cardId, mode, settings, tilt, spec, rarity, variant, surfaceId, reliefSpec, etch, view])

  const set = (patch: Partial<FoilSettings>) => setSettings((s) => ({ ...s, ...patch }))

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', gap: 18, padding: 18,
        background: 'rgba(6,8,12,0.92)', color: '#e8ecf4', overflow: 'auto', fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div>
          <canvas ref={canvasRef} width={W} height={H} style={{ borderRadius: 8, boxShadow: '0 10px 40px #000a', background: '#111' }} />
          <div className="faint small" style={{ marginTop: 6 }}>{status}</div>
        </div>
        {view === 'reference' && (
          <div>
            <canvas ref={referenceRef} width={W} height={H} style={{ borderRadius: 8, boxShadow: '0 10px 40px #000a', background: '#111' }} />
            <div className="faint small" style={{ marginTop: 6, maxWidth: W }}>{referenceCaption(cardId)}</div>
          </div>
        )}
      </div>

      <div style={{ flex: '1 1 360px', maxWidth: 560, display: 'grid', gap: 12, alignContent: 'start' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b>Holofoil inspector</b>
          <button className="btn sm" onClick={onClose}>Close (Shift+H)</button>
        </div>

        <select value={cardId} onChange={(e) => setCardId(e.target.value)} style={{ padding: 6, borderRadius: 6 }}>
          {['Radiant Collection', 'Cosmos', 'Delta (plain foil)', 'Reverse', 'Special reverse', 'Starlight', 'Cracked Ice', 'Textured'].map((group) => (
            <optgroup key={group} label={group}>
              {DEBUG_CARDS.filter((c) => c.group === group).map((c) => {
                const plain = !foilMaskFor({ cardId: c.cardId, rarity: c.rarity, variant: c.variant })
                const v = (c.variant ?? '').toLowerCase()
                const ball = v.includes('masterball') ? ' · Master Ball' : v.includes('pokeball') ? ' · Poké Ball' : ''
                return <option key={c.cardId} value={c.cardId}>{c.setId} {c.number} — {c.name} ({c.rarity}){ball}{plain ? ' · non-foil' : ''}</option>
              })}
            </optgroup>
          ))}
        </select>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {FOIL_MODES.map((m) => (
            <button
              key={m.id}
              className={`btn sm ${mode === m.id ? '' : 'ghost'}`}
              title={m.hint}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {surfaceId && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="faint small">Surface</span>
            {([['composite', 'With relief'], ['relief', 'Relief only'], ['normal', 'Normal map'], ['diff', 'Pixel diff'], ['reference', 'Reference']] as const).map(([id, label]) => (
              <button key={id} className={`btn sm ${view === id ? '' : 'ghost'}`} onClick={() => setView(id)}>{label}</button>
            ))}
            <span className="faint small">{surface ? `${surface.map.w}×${surface.map.h}` : 'loading…'}</span>
          </div>
        )}

        <div style={{ display: 'grid', gap: 6 }}>
          <Slider label="Reflection" value={settings.intensity} min={0} max={2} step={0.05} onChange={(v) => set({ intensity: v })} />
          <Slider label="Pattern opacity" value={settings.patternOpacity} min={0} max={1} step={0.05} onChange={(v) => set({ patternOpacity: v })} />
          <Slider label="Iridescence" value={settings.iridescence} min={0} max={1} step={0.05} onChange={(v) => set({ iridescence: v })} />
          <Slider label="Texture scale" value={settings.patternScale} min={0.25} max={3} step={0.05} onChange={(v) => set({ patternScale: v })} />
          <Slider label="Light angle°" value={tilt.axis} min={0} max={360} step={1} onChange={(v) => setTilt((t) => ({ ...t, axis: v }))} />
          <Slider label="Tilt°" value={tilt.deg} min={0} max={78} step={1} onChange={(v) => setTilt((t) => ({ ...t, deg: v }))} />
        </div>

        <div style={{ borderTop: '1px solid #2a3140', paddingTop: 10, display: 'grid', gap: 4 }}>
          <div>
            <b>{asset?.name}</b> · {asset?.setId} {asset?.number}{asset?.motif ? ` · motif “${asset.motif}”` : ''}
          </div>
          <div className="faint small">
            pattern: {readout.pattern}
          </div>
          <div className="small">
            Printing: <b>{printing ? patternLabel(printing.pattern) : 'no database claim'}</b>
            {printing && <span style={{ color: printing.status === 'verified' ? '#7fd68a' : printing.status === 'unresolved' ? '#e07a7a' : '#e6b95e' }}> · {printing.status}</span>}
            {printing && <span className="faint"> · {printing.product}{printing.paperVariants ? ` · papers: ${printing.paperVariants.join(' + ')}` : ''}</span>}
          </div>
          {printing && <div className="faint small">{printing.note} <a href={printing.source} target="_blank" rel="noreferrer" style={{ color: '#8fb4ff' }}>source</a></div>}
          <div className="small">
            Coverage mask: <b>{spec ? spec.kind : 'none — this printing is not foil'}</b>{' '}
            {spec && <span style={{ color: spec.verified ? '#7fd68a' : '#e6b95e' }}>{spec.verified ? 'verified against a printing' : 'MODELLED — not verified'}</span>}
          </div>
          {spec && <div className="faint small">{spec.evidence}</div>}
          <div className="small">
            Surface: <b>{readout.surface}</b>
          </div>
          {view === 'diff' && diff && (
            <div className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>
              Diff vs scan: <b>{diff.changed.toLocaleString()}</b> px changed · max Δ{diff.maxDelta} · mean Δ{diff.meanDelta.toFixed(1)}{' '}
              {diff.outside ? <span style={{ color: '#e07a7a' }}>· {diff.outside} px OUTSIDE the {etch ? 'etch mask' : 'foil'}</span> : <span style={{ color: '#7fd68a' }}>· none outside the {etch ? 'etch mask' : 'foil'}</span>}
            </div>
          )}
          <div className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>
            mask area {(readout.maskArea * 100).toFixed(1)}% · motif coverage {(readout.coverage * 100).toFixed(1)}% · mean added light {readout.lift >= 0 ? '+' : ''}{readout.lift.toFixed(1)}/255
          </div>
          <div className="faint small">
            Textures here are reconstructions — concept art for Radiant and Cosmos, procedural drawings for Starlight and the reverse papers, and a modelled normal map for the etched relief — never scanned factory stamps. These sliders exist to calibrate layers, not to re-skin cards.
          </div>
        </div>
      </div>
    </div>
  )
}

/** Dev-only mount: Shift+H toggles the inspector. */
export function HoloDebugLauncher() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === 'H' || e.key === 'h') && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return open ? <HoloDebugPanel onClose={() => setOpen(false)} /> : null
}
