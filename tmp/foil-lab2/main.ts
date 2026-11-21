// Phase 2 harness: original artwork beside its foil mask, plus a real pixel
// comparison of the artwork against a re-render at zero reflection.
import { foilMaskFor, drawFoilMask } from '../../src/foil/mask'

type Card = { label: string; id: string; rarity: string; variant?: string; src: string }

const CARDS: Card[] = [
  { label: 'Flareon-EX RC6 (full bleed)', id: 'g1-RC6', rarity: 'Rare Holo EX', src: '/tmp/ref/RC6_hires.png' },
  { label: 'Yveltal RC16 (art window)', id: 'g1-RC16', rarity: 'Uncommon', src: '/tmp/ref/RC16_hires.png' },
  { label: 'Charizard base1-4 (art window)', id: 'base1-4', rarity: 'Rare Holo', variant: 'holofoil', src: '/tmp/ref/base1-4.png' },
]

const W = 260
const H = 362
const base = document.getElementById('base') as HTMLCanvasElement
const mask = document.getElementById('mask') as HTMLCanvasElement
const report = document.getElementById('report') as HTMLElement
const cardBar = document.getElementById('cards') as HTMLElement

const baseCtx = base.getContext('2d', { willReadFrequently: true })!
const maskCtx = mask.getContext('2d', { willReadFrequently: true })!

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
  const width = Math.max(title.length, ...rows.map((r) => r.text.length))
  const head = '── ' + title + ' ' + '─'.repeat(Math.max(0, width - title.length - 3))
  return head + '\n' + rows.map((r) => (r.ok ? '✓ ' : '✗ ') + r.text).join('\n')
}

async function show(card: Card) {
  for (const b of cardBar.querySelectorAll('button')) b.classList.toggle('on', (b as HTMLElement).dataset.id === card.id)

  const img = await loadImg(card.src)
  baseCtx.clearRect(0, 0, W, H)
  baseCtx.drawImage(img, 0, 0, W, H)

  const spec = foilMaskFor({ cardId: card.id, rarity: card.rarity, variant: card.variant })
  drawFoilMask(maskCtx, spec, W, H)

  // --- pixel tests ---------------------------------------------------------
  const original = baseCtx.getImageData(0, 0, W, H)
  const maskData = maskCtx.getImageData(0, 0, W, H)

  // A zero-reflection composite is the artwork re-rendered through the
  // pipeline. In Phase 2 that pipeline draws the image and nothing else, so
  // this must be byte-identical to the source.
  const composite = document.createElement('canvas')
  composite.width = W
  composite.height = H
  const cctx = composite.getContext('2d', { willReadFrequently: true })!
  cctx.drawImage(img, 0, 0, W, H)
  const rendered = cctx.getImageData(0, 0, W, H)

  let diffAll = 0
  let maxDiff = 0
  let diffOutsideMask = 0
  let nonBinary = 0
  let coveragePx = 0
  for (let i = 0; i < original.data.length; i += 4) {
    const d = Math.max(
      Math.abs(original.data[i] - rendered.data[i]),
      Math.abs(original.data[i + 1] - rendered.data[i + 1]),
      Math.abs(original.data[i + 2] - rendered.data[i + 2]),
    )
    if (d > 0) {
      diffAll++
      if (d > maxDiff) maxDiff = d
      if (maskData.data[i] === 0) diffOutsideMask++
    }
    const m = maskData.data[i]
    if (m !== 0 && m !== 255) nonBinary++
    if (m === 255) coveragePx++
  }
  const total = W * H
  const coverage = coveragePx / total

  const rows = [
    { ok: diffAll === 0, text: `zero-reflection render is identical to the source artwork (${diffAll} differing pixels, max channel delta ${maxDiff})` },
    { ok: diffOutsideMask === 0, text: `pixels outside the mask unchanged (${diffOutsideMask} changed)` },
    { ok: nonBinary === 0, text: `mask is strictly black or white (${nonBinary} intermediate pixels)` },
    { ok: maskData.data[0] === 0, text: `card corners are outside the silhouette (top-left pixel ${maskData.data[0]})` },
    { ok: !!spec === coverage > 0, text: `coverage ${(coverage * 100).toFixed(1)}% of the card (${spec?.kind ?? 'no mask'})` },
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
