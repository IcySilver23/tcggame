// What one card looks like with the reference sheet's tile, at a size you can
// actually judge: the real 734x1024 scan, the shipped modules, 400x558 of work
// shown at 300px. Nothing here is a mock-up — if this looks wrong, the game looks
// wrong.
import { foilMaskFor, type FoilMaskSpec } from '../../src/foil/mask'
import { applyIridescence, hueOf } from '../../src/foil/iridescence'
import { drawPattern, patternModulator } from '../../src/foil/pattern'
import { tiltForPointer, type FoilTilt } from '../../src/foil/reflection'

const W = 400
const H = 558
const SRC = '/tmp/ref/RC6_hires.png'
const MOD = patternModulator(W / H)

const ctxOf = (id: string) =>
  (document.getElementById(id) as HTMLCanvasElement).getContext('2d', { willReadFrequently: true })!

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
  ctxOf(id).putImageData(out, 0, 0)
}

const report = document.getElementById('report') as HTMLElement

async function boot() {
  const img = await loadImg(SRC)
  const spec = foilMaskFor({ cardId: 'g1-RC6', rarity: 'Rare Holo EX' }) as FoilMaskSpec

  const baseCtx = ctxOf('rest')
  baseCtx.drawImage(img, 0, 0, W, H)
  const base = baseCtx.getImageData(0, 0, W, H).data

  const paint = (deg: number, axis: number) => {
    const d = new Uint8ClampedArray(base)
    if (deg > 0) applyIridescence(d, W, H, spec, { deg, axis }, MOD)
    return d
  }

  put('mid', paint(30, Math.PI / 4))

  const stats = (d: Uint8ClampedArray) => {
    let n = 0
    let sum = 0
    let sx = 0
    let sy = 0
    for (let i = 0; i < base.length; i += 4) {
      const dr = d[i] - base[i]
      const dg = d[i + 1] - base[i + 1]
      const db = d[i + 2] - base[i + 2]
      if (!dr && !dg && !db) continue
      n++
      const l = 0.2126 * dr + 0.7152 * dg + 0.0722 * db
      sum += l
      const h = hueOf(dr, dg, db)
      if (!Number.isNaN(h)) { sx += l * Math.cos((h * Math.PI) / 180); sy += l * Math.sin((h * Math.PI) / 180) }
    }
    const hue = ((((Math.atan2(sy, sx) * 180) / Math.PI) % 360) + 360) % 360
    return { px: n, mean: n ? sum / n : 0, hue }
  }

  const sixty = paint(60, Math.PI / 4)
  const s60 = stats(sixty)
  put('big', sixty)

  // The tile itself, at the same size, so the marks can be read on their own.
  drawPattern(ctxOf('tile'), W, H, { mode: 'alpha' })

  // Face-on must be the scan: say so with a number rather than a claim.
  let differing = 0
  const faces = [0, 30, 60].map((deg) => paint(deg === 0 ? 0 : deg, Math.PI / 4))
  const zero = new Uint8ClampedArray(base)
  applyIridescence(zero, W, H, spec, { deg: 0, axis: 0 }, MOD)
  for (let i = 0; i < base.length; i += 4) {
    if (zero[i] !== base[i] || zero[i + 1] !== base[i + 1] || zero[i + 2] !== base[i + 2]) differing++
  }
  void faces

  report.textContent = [
    `60°  ${s60.px} px lit, mean +${s60.mean.toFixed(1)}/255 of the scan, hue ${s60.hue.toFixed(0)}°`,
    `0°   ${differing} pixels differ from the scan (must be 0)`,
  ].join('\n')

  // Live tilt on the big card.
  const big = document.getElementById('big') as HTMLCanvasElement
  const wrap = big
  let raf = 0
  let wanted: FoilTilt = { deg: 35, axis: Math.PI / 4 }
  let held: FoilTilt = { ...wanted }
  const loop = () => {
    held = {
      deg: held.deg + (wanted.deg - held.deg) * 0.2,
      axis: held.axis + (wanted.axis - held.axis) * 0.2,
    }
    put('big', paint(Math.max(0, held.deg), held.axis))
    raf = requestAnimationFrame(loop)
  }
  wrap.addEventListener('pointermove', (e) => {
    const r = wrap.getBoundingClientRect()
    const nx = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1
    const ny = ((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1
    wanted = tiltForPointer(nx, ny)
  })
  wrap.addEventListener('pointerleave', () => { wanted = { deg: 35, axis: Math.PI / 4 } })
  if (!raf) raf = requestAnimationFrame(loop)
}

void boot()
