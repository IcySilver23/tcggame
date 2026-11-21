// One Cosmos card, every stage, through the shipping renderer.
//
// The panels call paintFoil() from src/foil/stages.ts — the same function the
// overlay uses — so this page cannot show a nicer result than the game.
import { foilMaskFor, maskValue } from '../../src/foil/mask'
import { DEFAULT_FOIL_SETTINGS, paintFoil, type FoilMode } from '../../src/foil/stages'
import { loadCosmosField } from '../../src/foil/cosmos'
import { FACE_ON, type FoilTilt } from '../../src/foil/reflection'

const q = new URLSearchParams(location.search)
const CARD = q.get('card') ?? 'base4-4'
const SET = CARD.slice(0, CARD.lastIndexOf('-'))
const NUMBER = CARD.slice(CARD.lastIndexOf('-') + 1)
const RARITY = q.get('rarity') ?? 'Rare Holo'

const W = 200
const H = 279
const row = document.getElementById('row') as HTMLElement
const meta = document.getElementById('meta') as HTMLElement

function panel(label: string, note: string): CanvasRenderingContext2D {
  const fig = document.createElement('figure')
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const cap = document.createElement('figcaption')
  cap.innerHTML = `<b>${label}</b>${note}`
  fig.append(c, cap)
  row.append(fig)
  return c.getContext('2d', { willReadFrequently: true })!
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(src))
    img.src = src
  })
}

async function scan(): Promise<HTMLImageElement> {
  // Same-origin art first (the API passes the CDN image through); the cached
  // copy the validator uses is the fallback.
  for (const src of [`/api/art/${SET}/${NUMBER}`, `/api/art/${SET}/${NUMBER}_hires.png`, `/tmp/art/${CARD}.png`]) {
    try {
      return await load(src)
    } catch {
      /* try the next */
    }
  }
  throw new Error('no artwork')
}

function put(ctx: CanvasRenderingContext2D, frame: Uint8ClampedArray) {
  const img = new ImageData(W, H)
  img.data.set(frame)
  ctx.putImageData(img, 0, 0)
}

async function run() {
  const spec = foilMaskFor({ cardId: CARD, rarity: RARITY })
  const field = await loadCosmosField(CARD)
  if (!field) {
    meta.textContent = 'the Cosmos texture did not load — nothing to show'
    return
  }
  const img = await scan()
  const off = document.createElement('canvas')
  off.width = W
  off.height = H
  const octx = off.getContext('2d', { willReadFrequently: true })!
  octx.drawImage(img, 0, 0, W, H)
  const base = new Uint8ClampedArray(octx.getImageData(0, 0, W, H).data)

  const frame = new Uint8ClampedArray(W * H * 4)
  const draw = (ctx: CanvasRenderingContext2D, mode: FoilMode, tilt: FoilTilt) => {
    paintFoil(frame, base, W, H, spec, tilt, { mode, settings: DEFAULT_FOIL_SETTINGS, map: null, field })
    put(ctx, frame)
  }

  // The artwork itself, so every later panel is judged against it.
  draw(panel('Base card', 'The scan, untouched. Nothing else may alter it.'), 'base', FACE_ON)
  draw(panel('Coverage mask', 'White = foil exists. The art window, and nothing outside it.'), 'mask', FACE_ON)
  draw(panel('Pattern', 'The Cosmos sheet as ink, before light or mask. No colour of its own.'), 'pattern', FACE_ON)
  draw(panel('Pattern alpha', 'The same marks as opacity — what the reflection is multiplied by.'), 'alpha', FACE_ON)
  draw(panel('Reflection only', 'Neutral light at 55°, no motif. No rainbow, no glow.'), 'reflection', { deg: 55, axis: Math.PI / 4 })
  draw(panel('Composite · 0°', 'Face-on: byte-identical to the scan.'), 'composite', FACE_ON)
  draw(panel('Composite · 35°', 'The sweep is coming up; marks glint at their own positions.'), 'composite', { deg: 35, axis: Math.PI / 4 })
  draw(panel('Composite · 60°', 'Full pastel-to-tint sweep inside the window. Text and frame stay matte.'), 'composite', { deg: 60, axis: Math.PI / 4 })
  draw(panel('Composite · 75°', 'Near edge-on. Still no light outside the mask.'), 'composite', { deg: 75, axis: Math.PI / 4 })

  // Count what the mask actually lets through, so the claim is measurable.
  let foilPx = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (spec && maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, W / H) === 255) foilPx++
    }
  }
  const m = field.meta
  meta.innerHTML = [
    `<b>${CARD}</b> · mask <code>${spec ? spec.kind : 'none'}</code> `,
    spec ? `<span class="${spec.verified ? 'ok' : 'mod'}">${spec.verified ? 'verified' : 'MODELLED'}</span>` : '',
    ` · foil area ${((foilPx / (W * H)) * 100).toFixed(1)}% of the card`,
    ` · texture <span class="mod">${String(m.reproduction)}</span>`,
    `<br />sheet <code>${String(m.variant)}</code> · cut <code>${String(m.rotation ? 90 : 0)}°</code>`,
    ` · offset <code>${String(m.offsetU)}, ${String(m.offsetV)}</code> · zoom <code>${String(m.zoom)}</code>`,
    `<br />${spec ? spec.evidence : ''}`,
  ].join('')
  document.title = `${CARD} — Cosmos lab ready`
}

run().catch((err) => {
  meta.textContent = `failed: ${String(err)}`
})
