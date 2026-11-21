// Phase 3 validation lab: the two reverse batches, stage by stage.
//
// Each card gets the panels requirement 8 asks for — original artwork, coverage
// mask, isolated pattern, final rendering at a tilt, and a reference panel that
// is honest about what we do and do not have.

import { foilMaskFor, maskValue } from '../../src/foil/mask'
import { loadMarkFieldFor } from '../../src/foil/mark-field'
import { REVERSE_ASSETS, REVERSE_SHOWCASE } from '../../src/foil/reverse-index'
import { reverseConfigFor } from '../../src/foil/reverse-db'
import { DEFAULT_FOIL_SETTINGS, FOIL_MODES, meanLift, paintFoil, type FoilMode } from '../../src/foil/stages'
import { setIdOf } from '../../src/holo'

const W = 200
const H = 279

const PANELS: { id: FoilMode | 'reference'; label: string }[] = [
  { id: 'base', label: 'Original artwork' },
  { id: 'mask', label: 'Coverage mask' },
  { id: 'pattern', label: 'Isolated pattern' },
  { id: 'composite', label: 'Final at 55°' },
  { id: 'reference', label: 'Physical reference' },
]

async function artFor(setId: string, number: string): Promise<Uint8ClampedArray | null> {
  const urls = [`/api/art/${setId}/${number}_hires.png`, `/api/art/${setId}/${number}.png`]
  const img = new Image()
  img.crossOrigin = 'anonymous'
  try {
    await new Promise<void>((ok, fail) => {
      let i = 0
      const next = () => {
        if (i >= urls.length) return fail(new Error('art'))
        img.src = urls[i++]
      }
      img.onload = () => ok()
      img.onerror = next
      next()
    })
  } catch {
    return null
  }
  const off = document.createElement('canvas')
  off.width = W
  off.height = H
  const ctx = off.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, W, H)
  return new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data)
}

function canvas(w = W, h = H): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.style.width = `${w}px`
  c.style.height = `${h}px`
  c.style.borderRadius = '6px'
  c.style.background = '#0d1117'
  return c
}

async function main() {
  const root = document.getElementById('root')!
  for (const card of REVERSE_SHOWCASE) {
    const setId = setIdOf(card.cardId) ?? card.setId
    const config = reverseConfigFor(setId)
    const spec = foilMaskFor({ cardId: card.cardId, rarity: card.rarity, variant: card.variant })
    const field = await loadMarkFieldFor({ cardId: card.cardId, rarity: card.rarity, variant: card.variant })
    const base = await artFor(card.setId, card.number)

    const row = document.createElement('section')
    row.className = 'row'
    const head = document.createElement('header')
    const asset = config ? REVERSE_ASSETS[config.pattern] : null
    const badge = config?.status === 'verified' ? 'verified' : config?.status === 'approximated' ? 'approximation' : 'unresolved'
    head.innerHTML = `
      <h2>${card.name} <span class="dim">· ${card.setId} ${card.number} · reverse holo</span></h2>
      <div class="meta">
        <span>${config?.name ?? setId}</span>
        <span>${asset ? asset.label : config?.pattern ?? 'no pattern'}</span>
        <span class="badge ${badge}">${badge}</span>
        <span>${spec?.kind === 'outsideArt' ? 'foil: card body' : spec?.kind === 'art' ? 'foil: artwork window' : 'foil: none'}</span>
        <span>${asset?.approximation ? 'texture: procedural reconstruction' : ''}</span>
      </div>`
    row.appendChild(head)

    const grid = document.createElement('div')
    grid.className = 'grid'
    for (const panel of PANELS) {
      const cell = document.createElement('figure')
      const c = canvas()
      cell.appendChild(c)
      const cap = document.createElement('figcaption')
      cap.textContent = panel.label
      cell.appendChild(cap)
      grid.appendChild(cell)

      const ctx = c.getContext('2d')
      if (!ctx) continue
      if (!base) {
        ctx.fillStyle = '#1b2230'
        ctx.fillRect(0, 0, W, H)
        ctx.fillStyle = '#8892a6'
        ctx.font = '12px system-ui'
        ctx.fillText('art unavailable', 12, 20)
        continue
      }
      if (panel.id === 'reference') {
        ctx.putImageData(new ImageData(new Uint8ClampedArray(base), W, H), 0, 0)
        ctx.fillStyle = 'rgba(5,8,12,0.78)'
        ctx.fillRect(0, H - 58, W, 58)
        ctx.fillStyle = '#e8ecf4'
        ctx.font = '11px system-ui'
        ctx.fillText('Flat scan — foil not visible.', 8, H - 36)
        ctx.fillStyle = '#e6b95e'
        ctx.fillText('Pattern is a reconstruction.', 8, H - 20)
        continue
      }
      const frame = new Uint8ClampedArray(W * H * 4)
      const tilt = panel.id === 'composite' ? { deg: 55, axis: 45 } : { deg: 0, axis: 0 }
      paintFoil(frame, base, W, H, spec, tilt, {
        mode: panel.id as FoilMode,
        settings: DEFAULT_FOIL_SETTINGS,
        map: null,
        field,
      })
      ctx.putImageData(new ImageData(frame, W, H), 0, 0)

      if (panel.id === 'composite') {
        let maskArea = 0
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (spec && maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, W / H) === 255) maskArea++
          }
        }
        const cap2 = document.createElement('div')
        cap2.className = 'readout'
        cap2.textContent = `mask ${((maskArea / (W * H)) * 100).toFixed(1)}% · lift ${meanLift(base, frame, W, H, spec).toFixed(1)}/255`
        cell.appendChild(cap2)
      }
    }
    row.appendChild(grid)
    root.appendChild(row)
  }
  document.getElementById('loading')?.remove()
}

void main()
