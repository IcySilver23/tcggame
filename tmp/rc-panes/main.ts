// Phase 3 proof: Flareon-EX RC6 with the concept pack's own texture, one layer
// at a time, drawn by the same composer the game uses (src/foil/stages.ts).
import { foilMaskFor, maskValue, type FoilMaskSpec } from '../../src/foil/mask'
import { DEFAULT_FOIL_SETTINGS, meanLift, paintFoil, type FoilMode } from '../../src/foil/stages'
import { loadPatternMap, type PatternMap } from '../../src/foil/radiant'

const W = 200
const H = 279
const TILT = { deg: 55, axis: Math.PI / 4 }

const SHORT: Record<FoilMode, [string, string]> = {
  base: ['1 · base', 'the scan, untouched'],
  pattern: ['2 · pattern', 'RC6 motif, no light'],
  alpha: ['3 · pattern alpha', 'what light is multiplied by'],
  mask: ['4 · coverage', 'white = foil exists'],
  reflection: ['5 · reflection', 'neutral light only'],
  composite: ['6 · composite', 'what the card shows'],
}

const panes = document.getElementById('panes') as HTMLElement
const tiltRow = document.getElementById('tilt') as HTMLElement
const othersRow = document.getElementById('others') as HTMLElement
const report = document.getElementById('report') as HTMLElement

function canvas(where: HTMLElement, title: string, hint: string): CanvasRenderingContext2D {
  const wrap = document.createElement('div')
  wrap.className = 'panel'
  const tag = document.createElement('span')
  tag.innerHTML = `<b>${title}</b><br />${hint}`
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  wrap.append(tag, c)
  where.append(wrap)
  return c.getContext('2d', { willReadFrequently: true })!
}

function put(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray) {
  const img = new ImageData(W, H)
  img.data.set(data)
  ctx.putImageData(img, 0, 0)
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('art failed: ' + src))
    img.src = src
  })
}

async function artwork(src: string): Promise<Uint8ClampedArray> {
  const img = await loadImg(src)
  const off = document.createElement('canvas')
  off.width = W
  off.height = H
  const ctx = off.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, W, H)
  return new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data)
}

const render = (base: Uint8ClampedArray, spec: FoilMaskSpec | null, map: PatternMap | null, mode: FoilMode, tilt = TILT) => {
  const buf = new Uint8ClampedArray(W * H * 4)
  paintFoil(buf, base, W, H, spec, tilt, { mode, settings: DEFAULT_FOIL_SETTINGS, map })
  return buf
}

function countDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0
  for (let i = 0; i < b.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++
  }
  return n
}

function maskPixelShare(spec: FoilMaskSpec | null): number {
  if (!spec) return 0
  let n = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, W / H) === 255) n++
  }
  return n / (W * H)
}

async function run() {
  const base = await artwork('/tmp/ref/RC6_hires.png')
  const spec = foilMaskFor({ cardId: 'g1-RC6', rarity: 'Rare Holo EX' }) as FoilMaskSpec
  const map = await loadPatternMap('g1-RC6')

  for (const mode of ['base', 'pattern', 'alpha', 'mask', 'reflection', 'composite'] as FoilMode[]) {
    const [title, hint] = SHORT[mode]
    put(canvas(panes, title, hint), render(base, spec, map, mode))
  }

  for (const deg of [20, 40, 60, 78]) {
    put(canvas(tiltRow, `${deg}°`, 'same texture'), render(base, spec, map, 'composite', { deg, axis: Math.PI / 4 }))
  }

  // Two other printings through the identical pipeline.
  for (const card of [
    { id: 'g1-RC16', rarity: 'Uncommon', src: '/tmp/ref/RC16_hires.png', title: 'RC16 · art window' },
    { id: 'g1-RC1', rarity: 'Common', src: 'https://images.pokemontcg.io/g1/RC1_hires.png', title: 'RC1 · no foil' },
  ]) {
    try {
      const art = await artwork(card.src)
      const otherSpec = foilMaskFor({ cardId: card.id, rarity: card.rarity })
      const otherMap = await loadPatternMap(card.id)
      put(canvas(othersRow, card.title, otherSpec ? `${otherSpec.kind}${otherSpec.verified ? '' : ' (modelled)'}` : 'plain printing'),
        render(art, otherSpec, otherMap, otherSpec ? 'composite' : 'base'))
      put(canvas(othersRow, 'coverage', otherSpec ? (otherSpec.verified ? 'verified' : 'MODELLED') : 'none — not foil'),
        render(art, otherSpec, otherMap, 'mask'))
    } catch (e) {
      canvas(othersRow, card.title, 'art failed to load')
    }
  }

  // --- live checks, in the browser, on this card -----------------------------
  const drift = countDiff(base, render(base, spec, map, 'composite', { deg: 0, axis: Math.PI / 4 }))
  const composite = render(base, spec, map, 'composite')
  let outside = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, W / H) !== 0) continue
      const i = (y * W + x) * 4
      if (composite[i] !== base[i] || composite[i + 1] !== base[i + 1] || composite[i + 2] !== base[i + 2]) outside++
    }
  }
  const white = new Uint8ClampedArray(W * H * 4).fill(255)
  const whiteAdd = countDiff(white, render(white, spec, map, 'composite', { deg: 60, axis: Math.PI / 4 }))
  const lift = meanLift(base, composite, W, H, spec)

  const lines = [
    `card          g1-RC6  (${map ? map.asset.folder : 'NO TEXTURE'})`,
    `texture       ${map ? `${map.size}² grid · ${(map.coverage * 100).toFixed(1)}% of its area marked · peak ${map.peak.toFixed(2)}` : 'missing'}`,
    `mask          ${spec.kind} · ${spec.verified ? 'verified printing' : 'MODELLED, unverified'} · ${(maskPixelShare(spec) * 100).toFixed(0)}% of the card`,
    `0° drift      ${drift} px   ${drift === 0 ? '✓ the resting card is the scan' : '✗ ARTWORK CHANGED'}`,
    `outside mask  ${outside} px  ${outside === 0 ? '✓ no light outside coverage' : '✗ FOIL LEAKED'}`,
    `over white    ${whiteAdd} px   ${whiteAdd === 0 ? '✓ a mark cannot double printed brights' : '✗ DUPLICATED DECORATION'}`,
    `mean lift     +${lift.toFixed(1)}/255 at 55°`,
  ]
  report.innerHTML = lines
    .map((l) => (l.includes('✓') ? `<span class="ok">${l}</span>` : l.includes('✗') ? `<span class="warn">${l}</span>` : l))
    .join('\n')
}

void run()
