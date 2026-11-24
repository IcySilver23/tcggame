// The foil, on a real card, in the game.
//
// Layers 1-5 live in mask.ts / radiant.ts / pattern.ts / reflection.ts /
// iridescence.ts and are composed by stages.ts; this file only connects them to
// a DOM node. Two rules keep it from ever making a card worse than the scan:
//
//   - the artwork is the <img> underneath, untouched. The foil is a canvas on
//     top; its paper renders at one fixed neutral tilt — never a filter over the
//     scan, and never a pointer-driven sweep;
//   - anything that could fail leaves the plain artwork alone instead of drawing
//     a broken overlay: a CDN without CORS, a missing 2D context, a browser that
//     asks for reduced motion (the paper stays still), a thumbnail too small to
//     read, a decode error.
//
// There is no switch and no advanced mode. The pointer sweep, the iridescent
// colour and the embossed relief ran behind Settings → Appearance and were
// removed: Cosmos, reverse, Cracked Ice and every other resolved paper render at
// rest, at the paper tilt, exactly as they did with that switch off.
//
// A Radiant Collection card draws its OWN motif from the concept pack. Until that
// texture is decoded it shows an unpatterned reflection rather than a stand-in —
// the wrong motif is worse than a plain sheen. A printing with no shipped
// texture renders plain foil — uniform light, no marks — because using another
// card's motif would be a claim about a card we have not researched.
//
// It also refuses to be expensive. The foil is computed at a fixed 200x279, at
// most ~30 times a second, only when the card is visible and large enough to read.
// The paper paints one static frame and stops.

import { useEffect, useRef } from 'react'
import { foilMaskFor } from './mask'
import { reverseSettingsFor } from './reverse-db'
import { setIdOf } from '../holo'
import type { FoilTilt } from './reflection'
import { DEFAULT_FOIL_SETTINGS, type FoilSettings } from './stages'
import { composeFrameInto } from './engine'
import { loadMarkFieldFor, type MarkField } from './mark-field'

/**
 * Same-origin source for the pixel copy of a card: /api/art/<set>/<number>. The
 * card CDN sends no CORS header, so reading its pixels into a canvas is refused;
 * the server passes the same image through its own origin instead.
 */
function artPixelUrl(cardId: string, fallback: string): string {
  const cut = cardId.lastIndexOf('-')
  return cut > 0 ? `/api/art/${cardId.slice(0, cut)}/${cardId.slice(cut + 1)}` : fallback
}

/** Resolution the foil is computed at. The canvas is stretched by CSS. */
const W = 200
const H = 279
/** Below this width on screen a card is a thumbnail: no foil, no work. */
const MIN_WIDTH = 96
/** The one tilt every card's paper is lit at. */
const PAPER_TILT: FoilTilt = { deg: 22, axis: Math.PI / 4 }
/** The paper is lit quieter than a tilt would light it. */
const PAPER_INTENSITY = 0.6

/**
 * A zero-to-seven-second stagger, derived from the card id so it is stable.
 * A shelf of holos that swept in lockstep would read as one blinking panel.
 */
function shineDelayFor(cardId?: string | null): number {
  let h = 0
  const s = cardId ?? ''
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 7000
}

type Props = {
  wrapRef: React.RefObject<HTMLDivElement | null>
  src: string | null
  cardId?: string | null
  rarity?: string | null
  variant?: string | null
}

export function FoilOverlay({ wrapRef, src, cardId, rarity, variant }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas || !src) return
    canvas.style.opacity = '0'

    // Not foil at all? Nothing to load, nothing to draw.
    const spec = foilMaskFor({ cardId, rarity, variant })
    // Reverse printings carry their own reflection profile: a plain foil is
    // uniform, while a patterned one lets the marks shape the light.
    const reverseSettings: Partial<FoilSettings> = reverseSettingsFor(setIdOf(cardId)) ?? {}
    // The paper is lit at one fixed neutral tilt: no pointer sweep, no colour,
    // no relief. This is the frame a card drew with the old advanced switch off,
    // which is now the only way a card is drawn.
    const foilSettings = {
      ...DEFAULT_FOIL_SETTINGS,
      ...reverseSettings,
      intensity: (reverseSettings.intensity ?? DEFAULT_FOIL_SETTINGS.intensity) * PAPER_INTENSITY,
      iridescence: 0,
    }
    if (!spec) { canvas.style.opacity = '0'; delete wrap.dataset.foil; return }

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const frame = new Uint8ClampedArray(W * H * 4)
    const out = new ImageData(W, H)

    let base: Uint8ClampedArray | null = null
    let field: MarkField | null = null
    let dead = false

    const paint = () => {
      if (!base) return
      // One layer: the printing's own mask and pattern, lit at the paper tilt.
      composeFrameInto(frame, base, W, H, {
        tilt: PAPER_TILT,
        layers: [{ id: 'printing', spec, field, settings: foilSettings }],
      })
      out.data.set(frame)
      ctx.putImageData(out, 0, 0)
    }

    const show = () => {
      if (dead || !base) return
      if (wrap.clientWidth < MIN_WIDTH) return
      // The shine (styles.css) hangs off this flag, so only a card whose paper
      // actually exists sweeps — and only at a size where the paper is drawn.
      wrap.dataset.foil = '1'
      wrap.style.setProperty('--shine-delay', `${shineDelayFor(cardId)}ms`)
      canvas.style.opacity = '1'
      paint()
    }

    // A card can mount in a hidden tab at width 0. Watch the wrapper so the paper
    // appears once the card is large enough, and disappears on real thumbnails.
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          if (dead) return
          if (wrap.clientWidth >= MIN_WIDTH) show()
          else { canvas.style.opacity = '0'; delete wrap.dataset.foil }
        })
      : null
    observer?.observe(wrap)

    // A second, CORS-clean copy of the same artwork. The visible <img> keeps its
    // own request, so a CDN hiccup here can never blank a card.
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = cardId ? artPixelUrl(cardId, src) : src

    const ready = () => {
      const off = document.createElement('canvas')
      off.width = W
      off.height = H
      const octx = off.getContext('2d', { willReadFrequently: true })
      if (!octx) return
      octx.drawImage(img, 0, 0, W, H)
      try {
        base = new Uint8ClampedArray(octx.getImageData(0, 0, W, H).data)
      } catch {
        // Tainted canvas: the CDN refused CORS. Plain artwork it is.
        dead = true
        return
      }
      show()
      // The printing's own pattern, if it has one: a Radiant motif, the Cosmos
      // sheet, or nothing (generic tile). Arriving late simply repaints.
      void loadMarkFieldFor({ cardId, rarity, variant }).then((f) => {
        if (!f || dead) return
        field = f
        paint()
      })
    }

    if (img.complete && img.naturalWidth > 0) ready()
    else {
      img.addEventListener('load', ready, { once: true })
      img.addEventListener('error', () => { dead = true }, { once: true })
    }

    return () => {
      observer?.disconnect()
      delete wrap.dataset.foil
    }
  }, [wrapRef, src, cardId, rarity, variant])

  return <canvas ref={canvasRef} className="foil-canvas" width={W} height={H} aria-hidden="true" />
}
