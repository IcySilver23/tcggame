// Why is the coloured highlight dimmer than the neutral one at 60°?
import { foilMaskFor } from '../src/foil/mask'
import { applyReflection, reflectionAt, type FoilTilt } from '../src/foil/reflection'
import { applyIridescence, tintAt } from '../src/foil/iridescence'

const W = 200
const H = 279
const ASPECT = W / H
const T = (deg: number): FoilTilt => ({ deg, axis: Math.PI / 4 })
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

// A card-shaped mid-dark field: the case where colour is supposed to have room.
function darkImage() {
  const d = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      d[i] = 30
      d[i + 1] = 26
      d[i + 2] = 34
      d[i + 3] = 255
    }
  }
  return d
}

const spec = foilMaskFor({ cardId: 'g1-RC6', rarity: 'Rare Holo EX' })
const tilt = T(60)

const base = darkImage()
const plain = darkImage()
applyReflection(plain, W, H, spec, tilt)
const irid = darkImage()
applyIridescence(irid, W, H, spec, tilt)

let worst = 0
let worstAt = -1
let clipped = 0
let total = 0
for (let p = 0; p < W * H; p++) {
  const i = p * 4
  const d = [irid[i] - base[i], irid[i + 1] - base[i + 1], irid[i + 2] - base[i + 2]]
  if (d[0] === 0 && d[1] === 0 && d[2] === 0) continue
  total++
  const neutral = plain[i] - base[i]
  const delta = Math.abs(lum(d[0], d[1], d[2]) - neutral)
  if (delta > 1.6) clipped++
  if (delta > worst) {
    worst = delta
    worstAt = p
  }
}

const x = worstAt % W
const y = Math.floor(worstAt / W)
const u = (x + 0.5) / W
const v = (y + 0.5) / H
const t = tintAt(u, v, tilt)
const light = reflectionAt(u, v, tilt)
const i = worstAt * 4
console.log({
  worstAt: `x=${x} y=${y}`,
  base: [base[i], base[i + 1], base[i + 2]],
  neutralAdd: plain[i] - base[i],
  tint: [t.r.toFixed(2), t.g.toFixed(2), t.b.toFixed(2)],
  lightTimes255: (light * 255).toFixed(1),
  iridDelta: [irid[i] - base[i], irid[i + 1] - base[i + 1], irid[i + 2] - base[i + 2]],
  worstDelta: worst.toFixed(2),
  pixelsOverTolerance: `${clipped} of ${total}`,
})
