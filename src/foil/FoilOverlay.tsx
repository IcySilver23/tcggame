// The foil, on a real card, in the game.
//
// Layers 1-5 live in mask.ts / radiant.ts / pattern.ts / reflection.ts /
// iridescence.ts and are composed by stages.ts; this file only connects them to
// a DOM node. Two rules keep it from ever making a card worse than the scan:
//
//   - the artwork is the <img> underneath, untouched. The foil is a canvas on
//     top; its paper renders at a fixed neutral tilt, and the advanced mode adds
//     pointer tilt plus the iridescent/relief treatment — never a filter over the
//     scan;
//   - anything that could fail leaves the plain artwork alone instead of drawing
//     a broken overlay: a CDN without CORS, a missing 2D context, a browser that
//     asks for reduced motion (the paper stays still), a thumbnail too small to
//     read, a decode error.
//
// The Settings switch is not a gate on the paper: it turns the advanced treatment
// on and off. Cosmos, reverse, Cracked Ice and every other resolved paper render
// at rest whether that switch is on or off.
//
// A Radiant Collection card draws its OWN motif from the concept pack. Until that
// texture is decoded it shows an unpatterned reflection rather than a stand-in —
// the wrong motif is worse than a plain sheen. A printing with no shipped
// texture renders plain foil — uniform light, no marks — because using another
// card's motif would be a claim about a card we have not researched.
//
// It also refuses to be expensive. The foil is computed at a fixed 200x279, at
// most ~30 times a second, only when the card is visible and large enough to read.
// The paper paints one static frame; the animation loop only runs while the
// advanced treatment has the pointer.

import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { foilMaskFor } from './mask'
import { reverseSettingsFor } from './reverse-db'
import { setIdOf } from '../holo'
import { tiltForPointer, type FoilTilt } from './reflection'
import { DEFAULT_FOIL_SETTINGS, type FoilSettings } from './stages'
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
/** Fixed neutral tilt for the always-on paper fallback. */
const PAPER_TILT: FoilTilt = { deg: 22, axis: Math.PI / 4 }
/** The paper fallback is quieter than the advanced hover treatment. */
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
  // Settings → Appearance controls the ADVANCED treatment, not whether foil
  // exists. The paper fallback always renders; this switch adds the pointer tilt,
  // iridescence and relief. Flipping it re-runs the effect.
  const foil = useStore((s) => s.foil)

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas || !src) return
    const advanced = foil
    canvas.style.opacity = '0'

    // Not foil at all? Nothing to load, nothing to draw.
    const spec = foilMaskFor({ cardId, rarity, variant })
    // A modern ball reverse has two different coverages: the ball foil is on the
    // frame and text box, while the printed etch crosses the artwork too. Keep
    // them separate rather than widening the foil mask.
    const etch = specialReverseEtchFor(setIdOf(cardId), variant)
    const etchSpec = etch ? specialReverseEtchMaskFor(cardId ?? null) : undefined
    // Reverse printings carry their own reflection profile: a plain foil is
    // uniform, while a patterned one lets the marks shape the light.
    const reverseSettings: Partial<FoilSettings> = reverseSettingsFor(setIdOf(cardId)) ?? {}
    // The paper is always lit. With advanced foil off it sits at a fixed neutral
    // tilt, quieter than the hover treatment; the switch only owns the pointer
    // sweep, colour and relief below.
    const foilSettings = advanced
      ? { ...DEFAULT_FOIL_SETTINGS, ...reverseSettings }
      : {
          ...DEFAULT_FOIL_SETTINGS,
          ...reverseSettings,
          intensity: (reverseSettings.intensity ?? DEFAULT_FOIL_SETTINGS.intensity) * PAPER_INTENSITY,
          iridescence: 0,
        }
    if (!spec) { canvas.style.opacity = '0'; delete wrap.dataset.foil; return }

    // Reduced motion keeps the paper but removes the pointer treatment. The
    // fallback is static, so it is still safe to draw.
    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const animated = advanced && !reducedMotion

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const frame = new Uint8ClampedArray(W * H * 4)
    const out = new ImageData(W, H)

    let base: Uint8ClampedArray | null = null
    let field: MarkField | null = null
    let surface: FoilSurface | null = null
    let wanted: FoilTilt = PAPER_TILT
    let held: FoilTilt = PAPER_TILT
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
      // The paper is the resting state. Once the pointer has left and the card
      // has eased back to it, paint one final frame and stop the loop; the canvas
      // stays visible.
      const settled = !armed
        && Math.abs(held.deg - PAPER_TILT.deg) < 0.05
        && Math.abs(held.axis - PAPER_TILT.axis) < 0.01
      if (settled) {
        held = PAPER_TILT
        paint(held)
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

    const show = () => {
      if (dead || !base) return
      if (wrap.clientWidth < MIN_WIDTH) return
      // The shine (styles.css) hangs off this flag, so only a card whose paper
      // actually exists sweeps — and only at a size where the paper is drawn.
      wrap.dataset.foil = '1'
      wrap.style.setProperty('--shine-delay', `${shineDelayFor(cardId)}ms`)
      canvas.style.opacity = '1'
      start()
    }

    const enter = (e: PointerEvent) => {
      if (dead || !animated) return
      if (wrap.clientWidth < MIN_WIDTH) return
      armed = true
      aim(e)
      show()
    }
    const move = (e: PointerEvent) => {
      if (animated && armed && !dead) aim(e)
    }
    const leave = () => {
      if (!animated) return
      armed = false
      wanted = PAPER_TILT
      start()
    }

    if (animated) {
      wrap.addEventListener('pointerenter', enter)
      wrap.addEventListener('pointermove', move)
      wrap.addEventListener('pointerleave', leave)
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
        start()
      })
      // Textured tiers and the special ball papers load an etched normal map. It
      // arrives only at tilt, so the artwork at rest is untouched; a failed load
      // simply means smooth foil. A reverse is never routed by rarity; its etch
      // comes from the explicit ball variant instead.
      const surfaceId = animated
        ? surfaceFor({ rarity, variant, cardId }) ?? (etch ? SPECIAL_REVERSE_ETCH_SURFACE : null)
        : null
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
      if (animated) {
        wrap.removeEventListener('pointerenter', enter)
        wrap.removeEventListener('pointermove', move)
        wrap.removeEventListener('pointerleave', leave)
      }
      observer?.disconnect()
      if (raf) cancelAnimationFrame(raf)
      delete wrap.dataset.foil
    }
  }, [foil, wrapRef, src, cardId, rarity, variant])

  return <canvas ref={canvasRef} className="foil-canvas" width={W} height={H} aria-hidden="true" />
}
