// The layer stack, in one place, with the debug modes as first-class outputs.
//
// BASE → COVERAGE MASK → PATTERN → REFLECTION → COMPOSITE is the contract, and
// this module is the only place that knows the order. The overlay and the debug
// panel both come through here, so what a player sees and what a developer
// inspects cannot drift apart.
//
// Nothing here decides where foil is (mask.ts), what the pattern looks like
// (radiant.ts / pattern.ts) or how the light behaves (reflection.ts,
// iridescence.ts). It composes them and can show each stage alone.

import { maskValue, type FoilMaskSpec } from './mask'
import { applyReflection, type FoilTilt } from './reflection'
import { applyIridescence } from './iridescence'
import { ALPHA_FLOOR, PATTERN_GAMMA, PATTERN_SCALE } from './pattern'
import { samplePattern, type PatternMap } from './radiant'
import type { MarkField } from './mark-field'

/** Every stage the debug panel can draw alone, plus the final composite. */
export type FoilMode = 'base' | 'pattern' | 'alpha' | 'mask' | 'reflection' | 'composite'

export const FOIL_MODES: { id: FoilMode; label: string; hint: string }[] = [
  { id: 'base', label: 'Base card', hint: 'The scan, untouched. Every other mode must be explainable from this.' },
  { id: 'pattern', label: 'Pattern', hint: 'The card\'s own motif; a flat white field means no texture ships for this printing.' },
  { id: 'alpha', label: 'Pattern alpha', hint: 'The motif as opacity: what the reflection is multiplied by.' },
  { id: 'mask', label: 'Coverage mask', hint: 'White = foil exists here. The texture can never paint outside this.' },
  { id: 'reflection', label: 'Reflection', hint: 'Neutral light only — no motif, no colour.' },
  { id: 'composite', label: 'Composite', hint: 'What the card actually shows.' },
]

/**
 * Knobs for calibration. Defaults are the shipped look; the panel moves them to
 * find out what each layer contributes, not to let players re-skin cards.
 */
export type FoilSettings = {
  /** Multiplier on the light the reflection emits. */
  intensity: number
  /** 0 = ignore the motif, 1 = full pattern shaping. */
  patternOpacity: number
  /** Colour strength of the iridescence layer; 0 leaves neutral light. */
  iridescence: number
  /** Motif copies across the card width. */
  patternScale: number
}

export const DEFAULT_FOIL_SETTINGS: FoilSettings = {
  intensity: 1,
  patternOpacity: 1,
  iridescence: 1,
  patternScale: PATTERN_SCALE,
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

/**
 * The pattern's opacity at a point, 0..1, already blended with the opacity
 * slider. This is the multiplier the reflection sees.
 *
 * The duplicate-decoration rule lives here: where the print is already near
 * white, a mark has nothing to add — it would only double a bright shape that is
 * already drawn. The curve fades the motif out over the last quarter of the
 * range instead of letting it clip into the same white.
 */
export function patternModulatorFor(
  map: PatternMap | null,
  aspect: number,
  settings: FoilSettings = DEFAULT_FOIL_SETTINGS,
  field: MarkField | null = null,
): (u: number, v: number, baseLuma?: number) => number {
  const shaped = (u: number, v: number): number => {
    // A plain foil has no marks: the light is uniform, and the duplicate-decoration
    // guard does not apply because there is no mark to duplicate.
    if (field?.plain) return 1
    if (field) {
      // A pack texture supplies its own ink (Radiant motif, Cosmos sheet).
      return clamp01(ALPHA_FLOOR + (1 - ALPHA_FLOOR) * Math.pow(field.mark(u, v, settings.patternScale), PATTERN_GAMMA))
    }
    if (map) {
      const { mark } = samplePattern(map, u, v, settings.patternScale)
      return clamp01(ALPHA_FLOOR + (1 - ALPHA_FLOOR) * Math.pow(mark, PATTERN_GAMMA))
    }
    // No shipped texture for this printing: PLAIN foil. Borrowing another
    // card's motif would draw a pattern this card does not have, so the only
    // honest fallback is uniform light with no marks. The inspector names the
    // state; the roadmap tracks the missing texture.
    return 1
  }
  return (u: number, v: number, baseLuma = 0) => {
    const bare = shaped(u, v)
    // patternOpacity 0 must mean "the motif is not shaping anything".
    const opacity = clamp01(settings.patternOpacity)
    const mixed = 1 - opacity * (1 - bare)
    // Above 0.75 the print is already carrying a bright decoration here, so a
    // mark would only double it. Scaled by the same opacity slider, so
    // "pattern opacity 0" still means the motif is entirely out of the way.
    const t = clamp01((baseLuma - 0.75) / 0.25)
    const guard = 1 - t * t * (3 - 2 * t)
    return mixed * (1 - opacity * (1 - guard))
  }
}

/**
 * One foil layer over pixels that are already drawn. This is the composite
 * tail of paintFoil, pulled out so the engine (engine.ts) can stack several
 * regions on one card without copying the layer order a second time.
 *
 * `map` is the older Radiant PatternMap hook; `field` is the MarkField the
 * shipped cards use. Both may be null. Returns how many pixels changed.
 */
export function applyFoilLayer(
  target: Uint8ClampedArray,
  w: number,
  h: number,
  spec: FoilMaskSpec | null,
  tilt: FoilTilt,
  settings: FoilSettings = DEFAULT_FOIL_SETTINGS,
  field: MarkField | null = null,
  map: PatternMap | null = null,
): number {
  const modulate = patternModulatorFor(map, w / h, settings, field)
  return applyIridescence(target, w, h, spec, tilt, modulate, {
    light: settings.intensity,
    chroma: settings.iridescence,
  })
}

/** The motif alone, as a grey image, for the pattern/alpha debug views. */
export function paintPattern(
  target: Uint8ClampedArray,
  w: number,
  h: number,
  map: PatternMap | null,
  settings: FoilSettings,
  alpha: boolean,
  field: MarkField | null = null,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w
      const v = (y + 0.5) / h
      let g: number
      if (alpha) {
        // The raw alpha map, not the guarded one: this view is about the texture.
        if (field?.plain) g = 1
        else if (field) {
          g = clamp01(ALPHA_FLOOR + (1 - ALPHA_FLOOR) * Math.pow(field.mark(u, v, settings.patternScale), PATTERN_GAMMA))
        } else if (map) {
          const { mark } = samplePattern(map, u, v, settings.patternScale)
          g = clamp01(ALPHA_FLOOR + (1 - ALPHA_FLOOR) * Math.pow(mark, PATTERN_GAMMA))
        } else g = 1
      } else if (field) {
        g = field.mark(u, v, settings.patternScale)
      } else if (map) {
        g = samplePattern(map, u, v, settings.patternScale).mark
      } else {
        // No texture: a flat field, not another card's artwork.
        g = 1
      }
      const c = Math.round(clamp01(g) * 255)
      const i = (y * w + x) * 4
      target[i] = c
      target[i + 1] = c
      target[i + 2] = c
      target[i + 3] = 255
    }
  }
}

/**
 * Draw one stage of the stack into `target`, which must already be sized w*h*4.
 * The base pixels are copied in first, so a mode that adds nothing (base, or any
 * stage at rest) is byte-identical to the scan.
 */
export function paintFoil(
  target: Uint8ClampedArray,
  base: Uint8ClampedArray,
  w: number,
  h: number,
  spec: FoilMaskSpec | null,
  tilt: FoilTilt,
  opts: { mode: FoilMode; settings: FoilSettings; map: PatternMap | null; field?: MarkField | null },
): void {
  target.set(base)
  const { mode, settings } = opts
  const map = opts.map
  const field = opts.field ?? null

  if (mode === 'base') return
  if (mode === 'pattern' || mode === 'alpha') {
    paintPattern(target, w, h, map, settings, mode === 'alpha', field)
    return
  }
  if (mode === 'mask') {
    const aspect = w / h
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = spec ? maskValue(spec, (x + 0.5) / w, (y + 0.5) / h, aspect) : 0
        const i = (y * w + x) * 4
        target[i] = v
        target[i + 1] = v
        target[i + 2] = v
        target[i + 3] = 255
      }
    }
    return
  }
  if (mode === 'reflection') {
    applyReflection(target, w, h, spec, tilt, null, settings.intensity)
    return
  }

  applyFoilLayer(target, w, h, spec, tilt, settings, field, map)
}

/** Mean added light over the foil area, for the panel's readout and the tests. */
export function meanLift(
  base: Uint8ClampedArray,
  composed: Uint8ClampedArray,
  w: number,
  h: number,
  spec: FoilMaskSpec | null,
): number {
  if (!spec) return 0
  const aspect = w / h
  let sum = 0
  let n = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (maskValue(spec, (x + 0.5) / w, (y + 0.5) / h, aspect) === 0) continue
      const i = (y * w + x) * 4
      const a = (base[i] + base[i + 1] + base[i + 2]) / 3
      sum += (composed[i] + composed[i + 1] + composed[i + 2]) / 3 - a
      n++
    }
  }
  return n ? sum / n : 0
}
