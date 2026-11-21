// Phase 4 harness: a card you can tip with the pointer, the artwork beside its
// face-on and two fixed tilts, the mask that bounds the light, the tile itself,
// and counting tests over every pixel.
import { foilMaskFor, drawFoilMask, maskValue, type FoilMaskSpec } from '../../src/foil/mask'
import { applyReflection, FACE_ON, tiltForPointer, type FoilTilt } from '../../src/foil/reflection'
import { drawPattern, patternCoverage, patternModulator, patternTexture, PATTERN_SCALE } from '../../src/foil/pattern'

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

// The live card is rendered larger than the strip, so the pattern is legible
// while it moves.
const LW = 300
const LH = 419
const LIVE_MOD = patternModulator(LW / LH)

const canvases = {
  base: document.getElementById('base') as HTMLCanvasElement,
  zero: document.getElementById('zero') as HTMLCanvasElement,
  t30: document.getElementById('t30') as HTMLCanvasElement,
  t60: document.getElementById('t60') as HTMLCanvasElement,
  mask: document.getElementById('mask') as HTMLCanvasElement,
  tile: document.getElementById('tile') as HTMLCanvasElement,
  alpha: document.getElementById('alpha') as HTMLCanvasElement,
  live: document.getElementById('live') as HTMLCanvasElement,
}
const report = document.getElementById('report') as HTMLElement
const cardBar = document.getElementById('cards') as HTMLElement

const ctxOf = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!

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
  applyReflection(data, LW, LH, liveSpec, { deg, axis }, LIVE_MOD)
  const out = new ImageData(LW, LH)
  out.data.set(data)
  ctxOf(canvases.live).putImageData(out, 0, 0)
}

function frame() {
  // Ease toward the pointer, so the sweep has a little weight instead of
  // snapping: a card in the hand does not teleport.
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
  // Off the card, it comes back to rest — which is the artwork, exactly.
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

  // The live card, at its own size, from the same scan.
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
  drawPattern(ctxOf(canvases.tile), W, H, { scale: 8, mode: 'texture' })
  drawPattern(ctxOf(canvases.alpha), W, H, { scale: 8, mode: 'alpha' })

  const composite = (tilt: FoilTilt, target: HTMLCanvasElement, pattern: boolean) => {
    const data = new Uint8ClampedArray(base.data)
    const changed = applyReflection(data, W, H, spec, tilt, pattern ? MOD : null)
    const out = new ImageData(W, H)
    out.data.set(data)
    ctxOf(target).putImageData(out, 0, 0)
    return { data, changed }
  }

  const zero = composite(FACE_ON, canvases.zero, true)
  const t30 = composite(T30, canvases.t30, true)
  const t60 = composite(T60, canvases.t60, true)
  // Unpatterned references, per tilt, only so the report can count how much light
  // the pattern takes away. Each tilt must be compared with its own.
  const plain30 = composite(T30, document.createElement('canvas'), false)
  const plain60 = composite(T60, document.createElement('canvas'), false)

  let zeroDiff = 0
  for (let i = 0; i < base.data.length; i += 4) {
    if (base.data[i] !== zero.data[i] || base.data[i + 1] !== zero.data[i + 1] || base.data[i + 2] !== zero.data[i + 2]) zeroDiff++
  }

  const audit = (data: Uint8ClampedArray, plain: Uint8ClampedArray) => {
    let outsideMask = 0
    let hueShift = 0
    let darkened = 0
    let brighterThanPlain = 0
    let sum = 0
    let weight = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const dr = data[i] - base.data[i]
        const dg = data[i + 1] - base.data[i + 1]
        const db = data[i + 2] - base.data[i + 2]
        if (dr === 0 && dg === 0 && db === 0) continue
        const foil = maskValue(spec!, (x + 0.5) / W, (y + 0.5) / H, ASPECT) === 255
        if (!foil) outsideMask++
        if (dr !== dg || dg !== db) hueShift++
        if (dr < 0 || dg < 0 || db < 0) darkened++
        if (dr > plain.data[i] - base.data[i]) brighterThanPlain++
        sum += dr * (((x + 0.5) / W) * 0.7071 + ((y + 0.5) / H) * 0.7071)
        weight += dr
      }
    }
    return { outsideMask, hueShift, darkened, brighterThanPlain, centroid: weight > 0 ? sum / weight : 0 }
  }

  const a30 = audit(t30.data, plain30.data)
  const a60 = audit(t60.data, plain60.data)

  let lit = 0
  let dimmed = 0
  for (let i = 0; i < base.data.length; i += 4) {
    const plain = plain30.data[i] - base.data[i]
    const pat = t30.data[i] - base.data[i]
    if (plain > 0) lit++
    if (plain > 0 && pat < plain) dimmed++
  }

  // The seam: the tile's right edge must equal its left, or the repeat shows as a
  // grid. Checked on the value field itself, at both scales.
  let seamH = 0
  let seamV = 0
  for (let n = 0; n < H; n++) {
    const v = (n + 0.5) / H
    seamH = Math.max(seamH, Math.abs(patternTexture(1, v, ASPECT) - patternTexture(0, v, ASPECT)))
  }
  for (let n = 0; n < W; n++) {
    const u = (n + 0.5) / W
    seamV = Math.max(seamV, Math.abs(patternTexture(u, ASPECT / PATTERN_SCALE, ASPECT) - patternTexture(u, 0, ASPECT)))
  }

  const coverage = patternCoverage(spec, W, H)

  const rows = [
    { ok: zeroDiff === 0, text: `0° face-on is the artwork exactly (${zeroDiff} differing pixels)` },
    { ok: zero.changed === 0, text: `0° adds light to ${zero.changed} pixels` },
    { ok: t30.changed > 0 && t60.changed > 0, text: `tilt lights the pattern (30°: ${t30.changed} px, 60°: ${t60.changed} px)` },
    { ok: dimmed > lit * 0.15, text: `the tile shapes the light (${dimmed} of ${lit} lit px dimmed vs no pattern, ${((dimmed / lit) * 100).toFixed(0)}%)` },
    { ok: coverage > 0.05 && coverage < 0.75, text: `marks cover ${(coverage * 100).toFixed(1)}% of the foil — dots and sparkles, no hearts` },
    { ok: seamH < 1e-9 && seamV < 1e-9, text: `the tile is seamless (edge jump ${seamH.toExponential(0)} / ${seamV.toExponential(0)})` },
    { ok: a30.outsideMask === 0 && a60.outsideMask === 0, text: `no light outside the mask (30°: ${a30.outsideMask}, 60°: ${a60.outsideMask})` },
    { ok: a30.hueShift === 0 && a60.hueShift === 0, text: `still neutral — R, G and B move together (${a30.hueShift + a60.hueShift} hue-shifted pixels)` },
    { ok: a30.darkened === 0 && a60.darkened === 0, text: `still brightens, never darkens (${a30.darkened + a60.darkened} darkened pixels)` },
    { ok: a30.brighterThanPlain === 0 && a60.brighterThanPlain === 0, text: `the pattern never adds light of its own (${a30.brighterThanPlain + a60.brighterThanPlain} px)` },
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

void show(CARDS[0])
requestAnimationFrame(frame)
