// The rebuild, one layer at a time, on one card.
//
// Each panel is the same 200x279 render of the same scan with one more module
// switched on, so the difference between two panels is exactly one layer. The
// bottom row is the same five at 0°, where phases 3-5 must add nothing at all.
import { foilMaskFor, maskValue, type FoilMaskSpec } from '../../src/foil/mask'
import { applyReflection, FACE_ON, type FoilTilt } from '../../src/foil/reflection'
import { applyIridescence, hueOf } from '../../src/foil/iridescence'
import { patternModulator } from '../../src/foil/pattern'

type Card = { label: string; id: string; rarity: string; variant?: string; src: string }

const CARDS: Card[] = [
  { label: 'Flareon-EX RC6 (full bleed)', id: 'g1-RC6', rarity: 'Rare Holo EX', src: '/tmp/ref/RC6_hires.png' },
  { label: 'Yveltal RC16 (art window)', id: 'g1-RC16', rarity: 'Uncommon', src: '/tmp/ref/RC16_hires.png' },
  { label: 'Charizard base1-4 (art window)', id: 'base1-4', rarity: 'Rare Holo', variant: 'holofoil', src: '/tmp/ref/base1-4.png' },
]

const W = 200
const H = 279
const MOD = patternModulator(W / H)
const T60: FoilTilt = { deg: 60, axis: Math.PI / 4 }

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

function put(id: string, data: Uint8ClampedArray) {
  const out = new ImageData(W, H)
  out.data.set(data)
  ctxOf(document.getElementById(id) as HTMLCanvasElement).putImageData(out, 0, 0)
}

/** Difference from the artwork, in pixels. */
function diff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0
  for (let i = 0; i < b.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++
  }
  return n
}

async function show(card: Card) {
  for (const b of cardBar.querySelectorAll('button')) b.classList.toggle('on', (b as HTMLElement).dataset.id === card.id)

  const img = await loadImg(card.src)
  const baseCtx = ctxOf(document.getElementById('a1') as HTMLCanvasElement)
  baseCtx.clearRect(0, 0, W, H)
  baseCtx.drawImage(img, 0, 0, W, H)
  const base = baseCtx.getImageData(0, 0, W, H).data

  const spec = foilMaskFor({ cardId: card.id, rarity: card.rarity, variant: card.variant }) as FoilMaskSpec

  // --- 60°: one more layer per panel ------------------------------------------
  put('a1', base)

  // Phase 2 is coverage only, so there is no render to show — dim what is not
  // foil, which is exactly the information the mask carries.
  const masked = new Uint8ClampedArray(base)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, W / H) === 0) {
        const i = (y * W + x) * 4
        masked[i] *= 0.3
        masked[i + 1] *= 0.3
        masked[i + 2] *= 0.3
      }
    }
  }
  put('a2', masked)

  const neutral = new Uint8ClampedArray(base)
  applyReflection(neutral, W, H, spec, T60)
  put('a3', neutral)

  const patterned = new Uint8ClampedArray(base)
  applyReflection(patterned, W, H, spec, T60, MOD)
  put('a4', patterned)

  const iridescent = new Uint8ClampedArray(base)
  applyIridescence(iridescent, W, H, spec, T60, MOD)
  put('a5', iridescent)

  // --- 0°: every phase, and every one must be the scan -------------------------
  const rest = [1, 2, 3, 4, 5].map((n) => {
    const d = new Uint8ClampedArray(base)
    if (n >= 3) applyReflection(d, W, H, spec, FACE_ON, n >= 4 ? MOD : null)
    if (n === 5) applyIridescence(d, W, H, spec, FACE_ON, MOD)
    put('b' + n, d)
    return d
  })
  void rest

  const meanAdded = (d: Uint8ClampedArray) => {
    let sum = 0
    let n = 0
    for (let i = 0; i < base.length; i += 4) {
      const dr = d[i] - base[i]
      const dg = d[i + 1] - base[i + 1]
      const db = d[i + 2] - base[i + 2]
      if (!dr && !dg && !db) continue
      sum += 0.2126 * dr + 0.7152 * dg + 0.0722 * db
      n++
    }
    return n ? sum / n : 0
  }
  const meanHueOf = (d: Uint8ClampedArray) => {
    let sx = 0
    let sy = 0
    for (let i = 0; i < base.length; i += 4) {
      const dr = d[i] - base[i]
      const dg = d[i + 1] - base[i + 1]
      const db = d[i + 2] - base[i + 2]
      if (!dr && !dg && !db) continue
      const h = hueOf(dr, dg, db)
      if (Number.isNaN(h)) continue
      const w = 0.2126 * dr + 0.7152 * dg + 0.0722 * db
      sx += w * Math.cos((h * Math.PI) / 180)
      sy += w * Math.sin((h * Math.PI) / 180)
    }
    return ((((Math.atan2(sy, sx) * 180) / Math.PI) % 360) + 360) % 360
  }

  const lines = [
    `── ${card.label} ${'─'.repeat(Math.max(0, 44 - card.label.length))}`,
    `60°  · 3 neutral light   ${diff(neutral, base).toString().padStart(6)} px, mean +${meanAdded(neutral).toFixed(1)}/255`,
    `60°  · 4 + pattern       ${diff(patterned, base).toString().padStart(6)} px, mean +${meanAdded(patterned).toFixed(1)}/255  (the tile takes light away)`,
    `60°  · 5 + colour        ${diff(iridescent, base).toString().padStart(6)} px, mean +${meanAdded(iridescent).toFixed(1)}/255, hue ${meanHueOf(iridescent).toFixed(0)}°`,
    `60°  · 2 mask leaves ${diff(masked, base)} px of the card unfoiled`,
    `0°   · all five panes vs the artwork   ${[2, 3, 4, 5].map((n) => diff(rest[n - 1], base)).reduce((a, b) => a + b, 0)} differing pixels`,
  ]
  report.innerHTML = lines.map((l) => (l.startsWith('0°') ? `<span class="pass">${l}</span>` : l)).join('\n')
}

for (const card of CARDS) {
  const b = document.createElement('button')
  b.textContent = card.label
  b.dataset.id = card.id
  b.onclick = () => { void show(card) }
  cardBar.appendChild(b)
}

void show(CARDS[0])
