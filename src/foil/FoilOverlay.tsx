// The foil, on a real card, in the game.
//
// Layers 1-5 live in mask.ts / radiant.ts / pattern.ts / reflection.ts /
// iridescence.ts and are composed by stages.ts; this file only connects them to
// a DOM node. Two rules keep it from ever making a card worse than the scan:
//
//   - the artwork is the <img> underneath, untouched. The foil is a canvas on
//     top that is not drawn until the pointer is over the card, so a card at
//     rest is the scan, pixel for pixel — not a dimmed or tinted version of it;
//   - anything that could fail leaves the plain artwork alone instead of drawing
//     a broken overlay: a CDN without CORS, a missing 2D context, a user who
//     asked for reduced motion, a thumbnail too small to read, a decode error.
//
// A Radiant Collection card draws its OWN motif from the concept pack. Until that
// texture is decoded it shows an unpatterned reflection rather than a stand-in —
// the wrong motif is worse than a plain sheen. A printing with no shipped
// texture renders plain foil — uniform light, no marks — because using another
// card's motif would be a claim about a card we have not researched.
//
// It also refuses to be expensive. The foil is computed at a fixed 200x279 no
// matter how large the card is on screen, at most ~30 times a second, only for
// the card under the pointer, and textures are decoded once per card.

import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { foilMaskFor } from './mask'
import { reverseSettingsFor } from './reverse-db'
import { setIdOf } from '../holo'
import { FACE_ON, tiltForPointer, type FoilTilt } from './reflection'
import { DEFAULT_FOIL_SETTINGS } from './stages'
import { composeFrameInto } from './engine'
import { loadMarkFieldFor, type MarkField } from './mark-field'
import { loadSurface, surfaceFor } from './surface-textures'
import type { FoilSurface } from './engine'
import {
  SPECIAL_REVERSE_ETCH_STRENGTH,
  SPECIAL_REVERSE_ETCH_SURFACE,
  specialReverseEtchFor,
  specialReverseEtchMaskFor,
} from './reverse-etch'

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
/** ~30 fps. The sweep is a slow ease; anything faster is wasted frames. */
const FRAME_MS = 32
/** How quickly the card eases toward the pointer. */
const EASE = 0.22

type Props = {
  wrapRef: React.RefObject<HTMLDivElement | null>
  src: string | null
  cardId?: string | null
  rarity?: string | null
  variant?: string | null
}

export function FoilOverlay({ wrapRef, src, cardId, rarity, variant }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Foil is parked behind a switch (Settings → Appearance). Off means the card is
  // its scan: no reflection, no sheet fetch, no pointer listeners. Flipping the
  // switch re-runs this effect, so nothing else has to know.
  const foil = useStore((s) => s.foil)

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!foil || !wrap || !canvas || !src) return

    // Not foil at all? Nothing to load, nothing to draw.
    const spec = foilMaskFor({ cardId, rarity, variant })
    // A modern ball reverse has two different coverages: the ball foil is on the
    // frame and text box, while the printed etch crosses the artwork too. Keep
    // them separate rather than widening the foil mask.
    const etch = specialReverseEtchFor(setIdOf(cardId), variant)
    const etchSpec = etch ? specialReverseEtchMaskFor(cardId ?? null) : undefined
    // Reverse printings carry their own reflection profile: a plain foil is
    // uniform, while a patterned one lets the marks shape the light.
    const foilSettings = { ...DEFAULT_FOIL_SETTINGS, ...(reverseSettingsFor(setIdOf(cardId)) ?? {}) }
    if (!spec) return

    // Motion is the point of this effect, so a reduced-motion request gets the
    // artwork and nothing else.
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const frame = new Uint8ClampedArray(W * H * 4)
    const out = new ImageData(W, H)

    let base: Uint8ClampedArray | null = null
    let field: MarkField | null = null
    let surface: FoilSurface | null = null
    let wanted: FoilTilt = FACE_ON
    let held: FoilTilt = FACE_ON
    let raf = 0
    let last = 0
    let armed = false
    let dead = false

    const paint = (tilt: FoilTilt) => {
      if (!base) return
      // One layer today. The engine exists so a printing that needs a second
      // foil region, or an embossed surface, plugs in without a second path. The
      // ball reverse uses that: `spec` is the foil, `surfaceSpec` the full-card etch.
      composeFrameInto(frame, base, W, H, {
        tilt,
        layers: [{ id: 'printing', spec, field, settings: foilSettings, surface, surfaceSpec: etchSpec }],
      })
      out.data.set(frame)
      ctx.putImageData(out, 0, 0)
    }

    const loop = (t: number) => {
      if (t - last < FRAME_MS) {
        raf = requestAnimationFrame(loop)
        return
      }
      last = t
      held = {
        deg: held.deg + (wanted.deg - held.deg) * EASE,
        axis: held.axis + (wanted.axis - held.axis) * EASE,
      }
      // Back at rest with nobody pointing at it: show the scan and stop working.
      if (!armed && held.deg < 0.4) {
        held = FACE_ON
        canvas.style.opacity = '0'
        raf = 0
        return
      }
      paint(held)
      raf = requestAnimationFrame(loop)
    }

    const start = () => {
      if (!raf && base) raf = requestAnimationFrame(loop)
    }

    const aim = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect()
      const nx = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1
      const ny = ((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1
      wanted = tiltForPointer(nx, ny)
    }

    const enter = (e: PointerEvent) => {
      if (dead) return
      if (wrap.clientWidth < MIN_WIDTH) return
      armed = true
      aim(e)
      if (!base) return
      canvas.style.opacity = '1'
      start()
    }
    const move = (e: PointerEvent) => {
      if (armed && !dead) aim(e)
    }
    const leave = () => {
      armed = false
      wanted = FACE_ON
      start()
    }

    wrap.addEventListener('pointerenter', enter)
    wrap.addEventListener('pointermove', move)
    wrap.addEventListener('pointerleave', leave)

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
      if (armed) {
        canvas.style.opacity = '1'
        start()
      }
      // The printing's own pattern, if it has one: a Radiant motif, the Cosmos
      // sheet, or nothing (generic tile). Arriving late simply repaints.
      void loadMarkFieldFor({ cardId, rarity, variant }).then((f) => {
        if (!f || dead) return
        field = f
        if (armed) start()
      })
      // Textured tiers and the special ball papers load an etched normal map. It
      // arrives only at tilt, so the artwork at rest is untouched; a failed load
      // simply means smooth foil. A reverse is never routed by rarity; its etch
      // comes from the explicit ball variant instead.
      const surfaceId = surfaceFor({ rarity, variant, cardId }) ?? (etch ? SPECIAL_REVERSE_ETCH_SURFACE : null)
      if (surfaceId) {
        void loadSurface(surfaceId).then((s2) => {
          if (!s2 || dead) return
          surface = etch ? { ...s2, strength: SPECIAL_REVERSE_ETCH_STRENGTH } : s2
          if (armed) start()
        })
      }
    }

    if (img.complete && img.naturalWidth > 0) ready()
    else {
      img.addEventListener('load', ready, { once: true })
      img.addEventListener('error', () => { dead = true }, { once: true })
    }

    return () => {
      wrap.removeEventListener('pointerenter', enter)
      wrap.removeEventListener('pointermove', move)
      wrap.removeEventListener('pointerleave', leave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [foil, wrapRef, src, cardId, rarity, variant])

  return <canvas ref={canvasRef} className="foil-canvas" width={W} height={H} aria-hidden="true" />
}
