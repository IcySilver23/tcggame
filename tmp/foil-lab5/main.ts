// Phase 5 harness: a card you can tip, whose foil picks up colour as it turns;
// the stills it corresponds to; and counting tests over every pixel, including
// the hue of the light itself.
import { foilMaskFor, drawFoilMask, maskValue, type FoilMaskSpec } from '../../src/foil/mask'
import { applyReflection, FACE_ON, tiltForPointer, type FoilTilt } from '../../src/foil/reflection'
import { applyIridescence, chromaAt, hueOf } from '../../src/foil/iridescence'
import { patternModulator } from '../../src/foil/pattern'

type Card = { label: string; id: string; rarity: string; variant?: string; src: string }

const CARDS: Card[] = [
  { label: 'Flareon-EX RC6 (full bleed)', id: 'g1-RC6', rarity: 'Rare Holo EX', src: '/tmp/ref/RC6_hires.png' },
  { label: 'Yveltal RC16 (art window)', id: 'g1-RC16', rarity: 'Uncommon', src: '/tmp/ref/RC16_hires.png' },
  { label: 'Charizard base1-4 (art window)', id: 'base1-4', rarity: 'Rare Holo', variant: 'holofoil', src: '/tmp/ref/base1-4.png' },
]

const W = 200
const H = 279
const ASPECT = W / H
const AXIS = Math.PI / 4
const T30: FoilTilt = { deg: 30, axis: AXIS }
const T60: FoilTilt = { deg: 60, axis: AXIS }
const MOD = patternModulator(ASPECT)

const LW = 300
const LH = 419
const LIVE_MOD = patternModulator(LW / LH)

const canvases = {
  base: document.getElementById('base') as HTMLCanvasElement,
  zero: document.getElementById('zero') as HTMLCanvasElement,
  t30: document.getElementById('t30') as HTMLCanvasElement,
  t60: document.getElementById('t60') as HTMLCanvasElement,
  mask: document.getElementById('mask') as HTMLCanvasElement,
  live: document.getElementById('live') as HTMLCanvasElement,
}
const report = document.getElementById('report') as HTMLElement
const cardBar = document.getElementById('cards') as HTMLElement

const ctxOf = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image failed: ' + src))
    img.src = src
  })
}

function lines(title: string, rows: { ok: boolean; text: string }[]) {
  const width = Math.max(title.length + 4, ...rows.map((r) => r.text.length))
  const head = '── ' + title + ' ' + '─'.repeat(Math.max(0, width - title.length - 3))
  return head + '\n' + rows.map((r) => (r.ok ? '✓ ' : '✗ ') + r.text).join('\n')
}

// --- the live card ---------------------------------------------------------------
let liveBase: Uint8ClampedArray | null = null
let liveSpec: FoilMaskSpec | null = null
let wanted: FoilTilt = FACE_ON
let held: FoilTilt = FACE_ON
let liveDrawn = -1

function paintLive(deg: number, axis: number) {
  if (!liveBase || !liveSpec) return
  const data = new Uint8ClampedArray(liveBase)
  applyIridescence(data, LW, LH, liveSpec, { deg, axis }, LIVE_MOD)
  const out = new ImageData(LW, LH)
  out.data.set(data)
  ctxOf(canvases.live).putImageData(out, 0, 0)
}

function frame() {
  held = {
    deg: held.deg + (wanted.deg - held.deg) * 0.18,
    axis: held.axis + (wanted.axis - held.axis) * 0.18,
  }
  if (Math.abs(held.deg - liveDrawn) > 0.05) {
    liveDrawn = held.deg
    paintLive(held.deg, held.axis)
  }
  requestAnimationFrame(frame)
}

canvases.live.addEventListener('pointermove', (e) => {
  const r = canvases.live.getBoundingClientRect()
  const nx = ((e.clientX - r.left) / r.width) * 2 - 1
  const ny = ((e.clientY - r.top) / r.height) * 2 - 1
  wanted = tiltForPointer(nx, ny)
})
canvases.live.addEventListener('pointerleave', () => {
  wanted = FACE_ON
})

// --- the strip and the counts ----------------------------------------------------
async function show(card: Card) {
  for (const b of cardBar.querySelectorAll('button')) b.classList.toggle('on', (b as HTMLElement).dataset.id === card.id)

  const img = await loadImg(card.src)
  const baseCtx = ctxOf(canvases.base)
  baseCtx.clearRect(0, 0, W, H)
  baseCtx.drawImage(img, 0, 0, W, H)
  const base = baseCtx.getImageData(0, 0, W, H)

  const liveCtx = ctxOf(canvases.live)
  liveCtx.clearRect(0, 0, LW, LH)
  liveCtx.drawImage(img, 0, 0, LW, LH)
  liveBase = new Uint8ClampedArray(liveCtx.getImageData(0, 0, LW, LH).data)

  const spec = foilMaskFor({ cardId: card.id, rarity: card.rarity, variant: card.variant })
  liveSpec = spec
  held = FACE_ON
  wanted = FACE_ON
  liveDrawn = -1
  paintLive(0, AXIS)

  drawFoilMask(ctxOf(canvases.mask), spec, W, H)

  const composite = (tilt: FoilTilt, target: HTMLCanvasElement, opts: { pattern: boolean; neutral?: boolean }) => {
    const data = new Uint8ClampedArray(base.data)
    const changed = opts.neutral
      ? applyReflection(data, W, H, spec, tilt, opts.pattern ? MOD : null)
      : applyIridescence(data, W, H, spec, tilt, opts.pattern ? MOD : null)
    const out = new ImageData(W, H)
    out.data.set(data)
    ctxOf(target).putImageData(out, 0, 0)
    return { data, changed }
  }

  const zero = composite(FACE_ON, canvases.zero, { pattern: true })
  const t30 = composite(T30, canvases.t30, { pattern: true })
  const t60 = composite(T60, canvases.t60, { pattern: true })
  const plain30 = composite(T30, document.createElement('canvas'), { pattern: false, neutral: true })
  const plain60 = composite(T60, document.createElement('canvas'), { pattern: false, neutral: true })

  let zeroDiff = 0
  for (let i = 0; i < base.data.length; i += 4) {
    if (base.data[i] !== zero.data[i] || base.data[i + 1] !== zero.data[i + 1] || base.data[i + 2] !== zero.data[i + 2]) zeroDiff++
  }

  const audit = (data: Uint8ClampedArray, plain: Uint8ClampedArray) => {
    let outsideMask = 0
    let darkChannel = 0
    let wrapped = 0
    let over = 0
    let sum = 0
    let weight = 0
    let sx = 0
    let sy = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const dr = data[i] - base.data[i]
        const dg = data[i + 1] - base.data[i + 1]
        const db = data[i + 2] - base.data[i + 2]
        if (dr === 0 && dg === 0 && db === 0) continue
        if (maskValue(spec!, (x + 0.5) / W, (y + 0.5) / H, ASPECT) !== 255) outsideMask++
        if (dr < 0 || dg < 0 || db < 0) darkChannel++
        if (data[i] > 255 || data[i + 1] > 255 || data[i + 2] > 255) wrapped++
        const added = lum(dr, dg, db)
        if (added > plain[i] - base.data[i] + 1.6) over++
        const hue = hueOf(dr, dg, db)
        if (!Number.isNaN(hue)) {
          sx += added * Math.cos((hue * Math.PI) / 180)
          sy += added * Math.sin((hue * Math.PI) / 180)
        }
        sum += added * (((x + 0.5) / W) * 0.7071 + ((y + 0.5) / H) * 0.7071)
        weight += added
      }
    }
    const meanHue = ((((Math.atan2(sy, sx) * 180) / Math.PI) % 360) + 360) % 360
    return { outsideMask, darkChannel, wrapped, over, meanHue, centroid: weight > 0 ? sum / weight : 0 }
  }

  const a30 = audit(t30.data, plain30.data)
  const a60 = audit(t60.data, plain60.data)
  const gap = (() => {
    const d = Math.abs(a30.meanHue - a60.meanHue) % 360
    return d > 180 ? 360 - d : d
  })()

  // How much of the coloured light the pattern removes, so the two layers are
  // demonstrably still working together and not one overwriting the other.
  let lit = 0
  let dimmed = 0
  for (let i = 0; i < base.data.length; i += 4) {
    const plain = lum(plain30.data[i] - base.data[i], plain30.data[i + 1] - base.data[i + 1], plain30.data[i + 2] - base.data[i + 2])
    const pat = lum(t30.data[i] - base.data[i], t30.data[i + 1] - base.data[i + 1], t30.data[i + 2] - base.data[i + 2])
    if (plain > 0) lit++
    if (plain > 0 && pat < plain - 0.5) dimmed++
  }

  const rows = [
    { ok: zeroDiff === 0, text: `0° face-on is the artwork exactly (${zeroDiff} differing pixels)` },
    { ok: zero.changed === 0, text: `0° adds light to ${zero.changed} pixels` },
    { ok: t30.changed > 0 && t60.changed > 0, text: `tilt adds colour (30°: ${t30.changed} px, 60°: ${t60.changed} px)` },
    { ok: chromaAt(FACE_ON) === 0 && chromaAt(T30) < chromaAt(T60), text: `colour arrives with tilt (chroma 0.00 → ${chromaAt(T30).toFixed(2)} → ${chromaAt(T60).toFixed(2)})` },
    { ok: gap >= 20, text: `the hue slides as the card tips (${a30.meanHue.toFixed(0)}° → ${a60.meanHue.toFixed(0)}°, Δ ${gap.toFixed(0)}°)` },
    { ok: a30.outsideMask === 0 && a60.outsideMask === 0, text: `colour never leaves the mask (30°: ${a30.outsideMask}, 60°: ${a60.outsideMask})` },
    { ok: a30.darkChannel === 0 && a60.darkChannel === 0, text: `no channel darkens (${a30.darkChannel + a60.darkChannel} px)` },
    { ok: a30.wrapped === 0 && a60.wrapped === 0, text: `no channel wraps (${a30.wrapped + a60.wrapped} px)` },
    { ok: a30.over === 0 && a60.over === 0, text: `colour never out-shines the neutral reflection (${a30.over + a60.over} px)` },
    { ok: dimmed > lit * 0.15, text: `the pattern still shapes the coloured light (${dimmed} of ${lit} lit px, ${((dimmed / lit) * 100).toFixed(0)}%)` },
    { ok: a60.centroid > a30.centroid + 0.02, text: `the band still sweeps (centroid ${a30.centroid.toFixed(3)} → ${a60.centroid.toFixed(3)})` },
  ]
  report.innerHTML = lines(card.label, rows).replace(/✓/g, '<span class="pass">✓</span>').replace(/✗/g, '<span class="fail">✗</span>')
  report.dataset.ok = String(rows.every((r) => r.ok))
}

for (const card of CARDS) {
  const b = document.createElement('button')
  b.textContent = card.label
  b.dataset.id = card.id
  b.onclick = () => { void show(card) }
  cardBar.appendChild(b)
}

const wantedCard = new URLSearchParams(location.search).get('card')
void show(CARDS.find((c) => c.id === wantedCard) ?? CARDS[0])
requestAnimationFrame(frame)
