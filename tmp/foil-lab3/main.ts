// Phase 3 harness: the artwork, the same artwork face-on, two tilts, and the
// mask that bounds the light — plus counting tests over every pixel.
import { foilMaskFor, drawFoilMask, maskValue } from '../../src/foil/mask'
import { applyReflection, FACE_ON, type FoilTilt } from '../../src/foil/reflection'

type Card = { label: string; id: string; rarity: string; variant?: string; src: string }

const CARDS: Card[] = [
  { label: 'Flareon-EX RC6 (full bleed)', id: 'g1-RC6', rarity: 'Rare Holo EX', src: '/tmp/ref/RC6_hires.png' },
  { label: 'Yveltal RC16 (art window)', id: 'g1-RC16', rarity: 'Uncommon', src: '/tmp/ref/RC16_hires.png' },
  { label: 'Charizard base1-4 (art window)', id: 'base1-4', rarity: 'Rare Holo', variant: 'holofoil', src: '/tmp/ref/base1-4.png' },
]

const W = 200
const H = 279
const AXIS = Math.PI / 4
const T30: FoilTilt = { deg: 30, axis: AXIS }
const T60: FoilTilt = { deg: 60, axis: AXIS }

const canvases = {
  base: document.getElementById('base') as HTMLCanvasElement,
  zero: document.getElementById('zero') as HTMLCanvasElement,
  t30: document.getElementById('t30') as HTMLCanvasElement,
  t60: document.getElementById('t60') as HTMLCanvasElement,
  mask: document.getElementById('mask') as HTMLCanvasElement,
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

async function show(card: Card) {
  for (const b of cardBar.querySelectorAll('button')) b.classList.toggle('on', (b as HTMLElement).dataset.id === card.id)

  const img = await loadImg(card.src)
  const baseCtx = ctxOf(canvases.base)
  baseCtx.clearRect(0, 0, W, H)
  baseCtx.drawImage(img, 0, 0, W, H)
  const base = baseCtx.getImageData(0, 0, W, H)

  const spec = foilMaskFor({ cardId: card.id, rarity: card.rarity, variant: card.variant })
  drawFoilMask(ctxOf(canvases.mask), spec, W, H)
  const maskData = ctxOf(canvases.mask).getImageData(0, 0, W, H)

  const composite = (tilt: FoilTilt, target: HTMLCanvasElement) => {
    const data = new Uint8ClampedArray(base.data)
    const changed = applyReflection(data, W, H, spec, tilt)
    const out = new ImageData(W, H)
    out.data.set(data)
    ctxOf(target).putImageData(out, 0, 0)
    return { data, changed }
  }

  const zero = composite(FACE_ON, canvases.zero)
  const t30 = composite(T30, canvases.t30)
  const t60 = composite(T60, canvases.t60)

  // --- tests ---------------------------------------------------------------
  let zeroDiff = 0
  for (let i = 0; i < base.data.length; i += 4) {
    if (base.data[i] !== zero.data[i] || base.data[i + 1] !== zero.data[i + 1] || base.data[i + 2] !== zero.data[i + 2]) zeroDiff++
  }

  const audit = (data: Uint8ClampedArray) => {
    let outsideMask = 0
    let hueShift = 0
    let darkened = 0
    let sum = 0
    let weight = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const dr = data[i] - base.data[i]
        const dg = data[i + 1] - base.data[i + 1]
        const db = data[i + 2] - base.data[i + 2]
        if (dr === 0 && dg === 0 && db === 0) continue
        const foil = maskValue(spec!, (x + 0.5) / W, (y + 0.5) / H, W / H) === 255
        if (!foil) outsideMask++
        if (dr !== dg || dg !== db) hueShift++
        if (dr < 0 || dg < 0 || db < 0) darkened++
        sum += dr * (((x + 0.5) / W) * 0.7071 + ((y + 0.5) / H) * 0.7071)
        weight += dr
      }
    }
    return { outsideMask, hueShift, darkened, centroid: weight > 0 ? sum / weight : 0 }
  }

  const a30 = audit(t30.data)
  const a60 = audit(t60.data)
  const nonBinary = (() => {
    let n = 0
    for (let i = 0; i < maskData.data.length; i += 4) if (maskData.data[i] !== 0 && maskData.data[i] !== 255) n++
    return n
  })()

  const rows = [
    { ok: zeroDiff === 0, text: `0° face-on is the artwork exactly (${zeroDiff} differing pixels)` },
    { ok: zero.changed === 0, text: `0° adds light to ${zero.changed} pixels` },
    { ok: t30.changed > 0 && t60.changed > 0, text: `tilt adds light (30°: ${t30.changed} px, 60°: ${t60.changed} px)` },
    { ok: a30.outsideMask === 0 && a60.outsideMask === 0, text: `no light outside the mask (30°: ${a30.outsideMask}, 60°: ${a60.outsideMask})` },
    { ok: a30.hueShift === 0 && a60.hueShift === 0, text: `reflection is neutral — R, G and B move together (${a30.hueShift + a60.hueShift} hue-shifted pixels)` },
    { ok: a30.darkened === 0 && a60.darkened === 0, text: `reflection only brightens (${a30.darkened + a60.darkened} darkened pixels)` },
    { ok: nonBinary === 0, text: `mask is strictly black or white (${nonBinary} intermediate pixels)` },
    { ok: a60.centroid > a30.centroid + 0.02, text: `the band sweeps with tilt (centroid ${a30.centroid.toFixed(3)} → ${a60.centroid.toFixed(3)})` },
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
