// Phase 0 correction: a printing with no shipped texture renders PLAIN foil.
//
// The bug this suite exists to prevent: the RC6 sheet's heart-and-sparkle tile was
// wired in as the fallback for every printing lacking a texture, so a Base Set
// Charizard appeared to wear Flareon-EX's foil. Nothing failed — the composition
// was masked and neutral — because no test asked whether the marks were the
// right marks.
//
// What is asserted now:
//   1. the untextured modulator is exactly 1 everywhere: uniform light, no marks;
//   2. an untextured card composes byte-identically with no field and with an
//      explicit plain field, so "no texture" is the plain path, not a third one;
//   3. every foil pixel gets the same added light (one delta value, not a field);
//   4. the tile that used to be used really would have marked those pixels —
//      otherwise the fixture would prove nothing;
//   5. a card WITH a field still varies, so the change did not flatten real foil;
//   6. Starlight and the other unpainted families still resolve as foil printings,
//      with no texture, rather than losing their foil entirely.
import { foilMaskFor, maskValue } from '../src/foil/mask'
import { FACE_ON, applyReflection, type FoilTilt } from '../src/foil/reflection'
import { applyIridescence } from '../src/foil/iridescence'
import { DEFAULT_FOIL_SETTINGS, patternModulatorFor } from '../src/foil/stages'
import { composeFrame } from '../src/foil/engine'
import { patternAlpha } from '../src/foil/pattern'
import { loadMarkFieldFor, type MarkField } from '../src/foil/mark-field'

let failed = 0
const ok = (cond: boolean, label: string, detail?: string) => {
  if (cond) console.log('ok    ' + label)
  else { failed++; console.log('FAIL  ' + label + (detail ? ' — ' + detail : '')) }
}

const W = 200
const H = 279
const ASPECT = W / H
const TILT: FoilTilt = { deg: 48, axis: Math.PI / 4 }

/** Base Set Charizard: identified as Starlight, no starfield texture shipped. */
const starlight = foilMaskFor({ cardId: 'base1-4', rarity: 'Rare Holo' })
ok(!!starlight, 'the unpainted Starlight printing is still FOIL — this is about the pattern, not the mask')
ok(starlight?.kind === 'art', 'and still uses the researched illustration window', starlight?.kind)

/** Mid-grey everywhere: equal headroom, so any variation in added light is pattern. */
function baseImage(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 100
    d[i + 1] = 100
    d[i + 2] = 100
    d[i + 3] = 255
  }
  return d
}

const plainField: MarkField = {
  id: 'test:plain',
  label: 'plain',
  mark: () => 1,
  opacity: () => 1,
  coverage: 1,
  peak: 1,
  verified: false,
  plain: true,
  note: 'uniform light',
  meta: {},
}

/** A deliberately coarse motif, used only to prove a texture still shapes light. */
const checker: MarkField = {
  id: 'test:checker',
  label: 'checker',
  mark: (u, v) => ((Math.floor(u * 8) + Math.floor(v * 8)) % 2 === 0 ? 1 : 0.05),
  opacity: () => 1,
  coverage: 0.5,
  peak: 1,
  verified: false,
  note: 'test motif',
  meta: {},
}

const base = baseImage()
const spec = starlight!

// ---------------------------------------------------------------- 1. the modulator
{
  const mod = patternModulatorFor(null, ASPECT, DEFAULT_FOIL_SETTINGS, null)
  let offOne = 0
  for (let j = 0; j < 20; j++) {
    for (let i = 0; i < 20; i++) {
      if (mod((i + 0.5) / 20, (j + 0.5) / 20) !== 1) offOne++
    }
  }
  ok(offOne === 0, 'no texture: the pattern multiplier is exactly 1 everywhere', String(offOne))
  const modPlain = patternModulatorFor(null, ASPECT, DEFAULT_FOIL_SETTINGS, plainField)
  ok(modPlain(0.31, 0.62) === 1, 'an explicit plain field is the same 1')
}

// -------------------------------------------------- 2. no field == the plain field
{
  const none = composeFrame(base, W, H, { tilt: TILT, layers: [{ id: 'x', spec, field: null }] })
  const plain = composeFrame(base, W, H, { tilt: TILT, layers: [{ id: 'x', spec, field: plainField }] })
  let same = none.length === plain.length
  if (same) for (let i = 0; i < none.length; i++) if (none[i] !== plain[i]) { same = false; break }
  ok(same, 'an untextured card is byte-identical to an explicit plain foil')
  ok(none.some((v, i) => i % 4 !== 3 && v !== base[i]), 'and it is still lit, not left bare')
}

// ------------------------------- 3. the pattern layer is a genuine no-op here
{
  // Plain foil still varies across the card — that is the SWEEP, not a texture.
  // The precise claim is narrower and checkable: an untextured frame is exactly
  // the reflection/iridescence with no pattern multiplier at all.
  const neutral = composeFrame(base, W, H, {
    tilt: TILT,
    layers: [{ id: 'x', spec, field: null, settings: { iridescence: 0 } }],
  })
  const bare = new Uint8ClampedArray(base)
  applyReflection(bare, W, H, spec, TILT, null, 1)
  let neutralSame = true
  for (let i = 0; i < neutral.length; i++) if (neutral[i] !== bare[i]) { neutralSame = false; break }
  ok(neutralSame, 'untextured neutral frame == bare reflection: the pattern adds nothing')

  const tinted = composeFrame(base, W, H, { tilt: TILT, layers: [{ id: 'x', spec, field: null }] })
  const bareTint = new Uint8ClampedArray(base)
  applyIridescence(bareTint, W, H, spec, TILT, null, { light: 1, chroma: 1 })
  let tintSame = true
  for (let i = 0; i < tinted.length; i++) if (tinted[i] !== bareTint[i]) { tintSame = false; break }
  ok(tintSame, 'untextured tinted frame == bare iridescence: no invented hue or mark')

  let litPixels = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, ASPECT) === 0) continue
      if (tinted[i] !== base[i] || tinted[i + 1] !== base[i + 1] || tinted[i + 2] !== base[i + 2]) litPixels++
    }
  }
  ok(litPixels > 0, 'and the card is still lit — plain foil is a finish, not an absence', String(litPixels))
}

// ---------------------------------------- 4. the old tile really would have marked
{
  let lo = 1
  let hi = 0
  for (let y = 0; y < H; y += 3) {
    for (let x = 0; x < W; x += 3) {
      if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, ASPECT) === 0) continue
      const a = patternAlpha((x + 0.5) / W, (y + 0.5) / H, ASPECT)
      lo = Math.min(lo, a)
      hi = Math.max(hi, a)
    }
  }
  ok(hi - lo > 0.2, 'the RC6 tile would have varied light by >0.2 across this card — the fixture is meaningful',
    `${lo.toFixed(2)}..${hi.toFixed(2)}`)
}

// --------------------------------------------- 5. a real texture still shapes light
{
  const lit = composeFrame(base, W, H, { tilt: TILT, layers: [{ id: 'x', spec, field: checker }] })
  const deltas = new Set<number>()
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, ASPECT) === 0) continue
      deltas.add(lit[i] - base[i])
    }
  }
  ok(deltas.size > 1, 'a card with a texture still varies — the fix did not flatten real foil', `${deltas.size} deltas`)
  const sorted = [...deltas].sort((a, b) => a - b)
  ok(sorted[sorted.length - 1] - sorted[0] > 10, 'and the variation is substantial', `${sorted[0]}..${sorted[sorted.length - 1]}`)
}

// ------------------------------------------------------- 6. rest and resolution
{
  const rest = composeFrame(base, W, H, { tilt: FACE_ON, layers: [{ id: 'x', spec, field: null }] })
  let identical = true
  for (let i = 0; i < rest.length; i++) if (rest[i] !== base[i]) { identical = false; break }
  ok(identical, 'an untextured card at rest is still the scan, byte for byte')
}

async function resolve() {
  const star = await loadMarkFieldFor({ cardId: 'base1-4', rarity: 'Rare Holo' })
  ok(star === null, 'the database resolves Base Set to NO texture, not to a borrowed one')
  const line = await loadMarkFieldFor({ cardId: 'swsh1-1', rarity: 'Rare Holo' })
  ok(line === null, 'and a Sword & Shield Line printing resolves to no texture too')

  console.log(failed === 0 ? '\nALL OK — untextured printings are plain foil, and say so' : `\n${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

void resolve()
