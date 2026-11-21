import { composeFrame } from '../src/foil/engine'
import { foilMaskFor } from '../src/foil/mask'
import { DEFAULT_FOIL_SETTINGS } from '../src/foil/stages'
import { loadMarkFieldFor } from '../src/foil/mark-field'

const W = 200, H = 279
const base = new Uint8ClampedArray(W * H * 4)
for (let i = 0; i < base.length; i += 4) { base[i] = 128; base[i + 1] = 128; base[i + 2] = 128; base[i + 3] = 255 }

const cards: [string, string, string | null][] = [
  ['base1-4', 'Rare Holo', null],
  ['swsh12pt5-1', 'Common', null],
  ['swsh12pt5tg-1', 'Trainer Gallery Rare Holo', null],
  ['sv1-1', 'Common', 'reverseHolofoil'],
]

const stat = (out: Uint8ClampedArray) => {
  let n = 0, sum = 0, max = 0
  for (let i = 0; i < out.length; i += 4) {
    const d = out[i] - 128
    if (d !== 0) { n++; sum += d; if (d > max) max = d }
  }
  return { touched: n, meanAddAmongTouched: n ? +(sum / n / 255).toFixed(3) : 0, maxAdd: +(max / 255).toFixed(3), coverage: +(n / (W * H) * 100).toFixed(1) }
}

for (const [cardId, rarity, variant] of cards) {
  const spec = foilMaskFor({ cardId, rarity, variant })
  const field = await loadMarkFieldFor({ cardId, rarity, variant }).catch(() => null)
  if (!spec) { console.log(cardId, '-> not foil (no mask)'); continue }
  const rest = composeFrame(base, W, H, { tilt: { deg: 22, axis: Math.PI / 4 }, layers: [{ id: 'p', spec, field, settings: { ...DEFAULT_FOIL_SETTINGS, intensity: 0.6, iridescence: 0 } }] })
  const hover = composeFrame(base, W, H, { tilt: { deg: 60, axis: Math.PI / 4 }, layers: [{ id: 'p', spec, field, settings: DEFAULT_FOIL_SETTINGS }] })
  console.log(cardId, 'mask', spec.kind, '| rest', JSON.stringify(stat(rest)), '| hover', JSON.stringify(stat(hover)))
}
