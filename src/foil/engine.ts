// The renderer's entry point: a card, a tilt, and one or more foil regions.
//
// Phase 1 asks for a single engine that every later pattern plugs into. The
// layers below it already existed (mask → pattern → reflection → iridescence);
// what was missing was the thing that puts MORE THAN ONE of them on one card and
// lets each region have its own brightness.
//
// Three rules this module keeps:
//
//   - `composeFrameInto` starts from the scan, so a frame at rest (or with no
//     layers) is byte-identical to the base image. The engine can add light; it
//     can never quietly recolour or dim the card it was handed.
//   - every foil layer is gated by its OWN coverage mask, and every relief by its
//     own. The two may differ: a special ball reverse carries the ball foil
//     outside the art while its full-card etch is allowed to cross it. Neither
//     may escape the mask it was given, and a layer with no foil and no surface
//     is no layer at all rather than an unmasked one.
//   - layer order is the caller's, and it only matters where masks overlap: two
//     foils on the same pixel stack (each adds its own light). Disjoint regions —
//     the normal case — compose identically in either order, which the suite
//     checks.
//
// This is the CPU fallback path, and it is the shipped one: the game renders at
// 200x279 with a 2D context. A GPU path would slot in here without changing the
// layer description, which is why layers are data and not canvas calls.

import { DEFAULT_FOIL_SETTINGS, applyFoilLayer, type FoilSettings } from './stages'
import { applySurface, type NormalMap } from './surface'
import type { FoilMaskSpec } from './mask'
import type { MarkField } from './mark-field'
import type { FoilTilt } from './reflection'

/** A normal map plus the light it is lit by, for one embossed region. */
export type FoilSurface = {
  map: NormalMap
  /** How deep the relief reads, 0..1 of the available headroom. */
  strength?: number
  /** Direction the raking light comes from, in card space. */
  light?: [number, number, number]
}

export type FoilLayer = {
  /** Stable identity, for debugging and for future cache keys. */
  id: string
  /** Where this layer's foil physically is. Null means no foil on this layer. */
  spec: FoilMaskSpec | null
  field?: MarkField | null
  settings?: Partial<FoilSettings>
  /** Per-region reflectivity on top of the settings' intensity; 1 = as configured. */
  reflectivity?: number
  /** Embossing for textured printings; absent on smooth cards and on reverse printings. */
  surface?: FoilSurface | null
  /**
   * Where the relief may shade. Defaults to `spec`. A special ball reverse
   * passes a full-card mask here so its etch can cross the artwork while its
   * ball foil stays outside the art; the two claims stay separate.
   */
  surfaceSpec?: FoilMaskSpec | null
}

export type FoilFrameSpec = {
  tilt: FoilTilt
  layers: readonly FoilLayer[]
}

/**
 * The settings a layer actually runs with. Reflectivity multiplies the shared
 * intensity rather than replacing it, so a region can be dimmer than the card
 * average without losing the calibration the inspector set.
 */
export function layerSettings(layer: FoilLayer): FoilSettings {
  const merged = { ...DEFAULT_FOIL_SETTINGS, ...(layer.settings ?? {}) }
  const k = layer.reflectivity ?? 1
  return { ...merged, intensity: merged.intensity * (k > 0 ? k : 0) }
}

/**
 * Add every layer to pixels that are already there (the scan, or a frame a
 * caller has drawn into). Returns how many pixels any layer changed.
 */
export function addLayers(
  target: Uint8ClampedArray,
  w: number,
  h: number,
  frame: FoilFrameSpec,
): number {
  // Relief reads when the light rakes across the card and disappears head-on, so
  // the surface fades in with tilt. That is also what keeps the engine's oldest
  // promise: a frame at rest is still the scan, byte for byte.
  const reliefGain = Math.min(1, Math.abs(frame.tilt.deg) / 25)
  let changed = 0
  for (const layer of frame.layers) {
    const settings = layerSettings(layer)
    const surfaceSpec = layer.surfaceSpec === undefined ? layer.spec : layer.surfaceSpec
    const foil = !!layer.spec && settings.intensity > 0
    const surface = layer.surface
    const relief = !!surface && !!surfaceSpec && reliefGain > 0
    if (!foil && !relief) continue
    if (foil) {
      changed += applyFoilLayer(target, w, h, layer.spec, frame.tilt, settings, layer.field ?? null, null)
    }
    if (relief && surface && surfaceSpec) {
      const strength = (surface.strength ?? 0.5) * reliefGain
      changed += applySurface(target, w, h, surfaceSpec, surface.map, {
        strength,
        light: surface.light,
      })
    }
  }
  return changed
}

/** Draw a frame from the scan into `target`; the caller owns the buffer. */
export function composeFrameInto(
  target: Uint8ClampedArray,
  base: Uint8ClampedArray,
  w: number,
  h: number,
  frame: FoilFrameSpec,
): number {
  target.set(base)
  return addLayers(target, w, h, frame)
}

/** Convenience for tests and the inspector: a fresh RGBA frame. */
export function composeFrame(
  base: Uint8ClampedArray,
  w: number,
  h: number,
  frame: FoilFrameSpec,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(base.length)
  composeFrameInto(out, base, w, h, frame)
  return out
}
