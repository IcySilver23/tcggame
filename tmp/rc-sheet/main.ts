// Every Radiant Collection card, composited at ~35° with its own texture.
// Uses the same pitches the game uses; the scans were cached by the validator.
import { RADIANT_ASSETS, RADIANT_CARD_IDS } from '../../src/foil/radiant-index'
import { foilMaskFor } from '../../src/foil/mask'
import { DEFAULT_FOIL_SETTINGS, paintFoil } from '../../src/foil/stages'
import { loadPatternMap } from '../../src/foil/radiant'

const W = 200
const H = 279
const grid = document.getElementById('grid') as HTMLElement

// Compact mode for a single-viewport capture: ?w=58&cols=9&labels=0
const q = new URLSearchParams(location.search)
const cellW = q.get('w')
const cols = q.get('cols')
if (cellW) document.documentElement.style.setProperty('--w', cellW + 'px')
if (cols) document.documentElement.style.setProperty('--cols', cols)
if (q.get('labels') === '0') document.body.classList.add('terse')

function cell(cardId: string): CanvasRenderingContext2D {
  const asset = RADIANT_ASSETS[cardId]
  const spec = foilMaskFor({ cardId, rarity: asset.rarity })
  const wrap = document.createElement('div')
  wrap.className = 'cell'
  const tag = document.createElement('span')
  const status = !spec ? '<span class="plain">plain</span>' : spec.verified ? '<span class="ok">verified</span>' : '<span class="mod">modelled</span>'
  tag.innerHTML = `<b>${asset.number.replace('RC', 'RC ')}</b> ${asset.name}<br />${status} · ${spec ? spec.kind : 'no foil'}`
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  wrap.append(c, tag)
  grid.append(wrap)
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

async function run() {
  const from = Number(q.get('from') ?? 0)
  const count = Number(q.get('count') ?? RADIANT_CARD_IDS.length)
  const page = RADIANT_CARD_IDS.slice(from, from + count)
  for (const id of page) {
    const asset = RADIANT_ASSETS[id]
    const ctx = cell(id)
    const img = await load(`/tmp/art/${id}.png`)
    const off = document.createElement('canvas')
    off.width = W
    off.height = H
    const octx = off.getContext('2d', { willReadFrequently: true })!
    octx.drawImage(img, 0, 0, W, H)
    const base = new Uint8ClampedArray(octx.getImageData(0, 0, W, H).data)
    const spec = foilMaskFor({ cardId: id, rarity: asset.rarity })
    const map = await loadPatternMap(id)
    const out = new Uint8ClampedArray(W * H * 4)
    paintFoil(out, base, W, H, spec, { deg: 35, axis: Math.PI / 4 }, { mode: spec ? 'composite' : 'base', settings: DEFAULT_FOIL_SETTINGS, map })
    const frame = new ImageData(W, H)
    frame.data.set(out)
    ctx.putImageData(frame, 0, 0)
  }
  document.title = `Radiant cards ${from + 1}–${from + page.length} — ready`
}

void run()
