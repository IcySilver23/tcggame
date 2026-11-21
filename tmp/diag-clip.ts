import { ALPHA_FLOOR, patternAlpha, patternTexture } from '../src/foil/pattern'
const ASPECT = 200 / 279
const S: { u: number; v: number }[] = []
for (let j = 1; j < 40; j++) for (let i = 1; i < 40; i++) S.push({ u: i / 41, v: j / 41 })
let shown = 0
for (let n = 0; n < 600 && shown < 8; n++) {
  const a = S[(n * 7) % S.length]
  const b = S[(n * 13 + 5) % S.length]
  const ta = patternTexture(a.u, a.v, ASPECT)
  const tb = patternTexture(b.u, b.v, ASPECT)
  const aa = patternAlpha(a.u, a.v, ASPECT)
  const ab = patternAlpha(b.u, b.v, ASPECT)
  const strictBad = Math.max(ta, tb) <= 1 - ALPHA_FLOOR - 1e-6 && (ta > tb ? !(aa > ab) : ta < tb ? !(aa < ab) : true)
  if (strictBad) {
    shown++
    console.log(`bad: ta=${ta} tb=${tb} aa=${aa} ab=${ab} diffT=${ta - tb} diffA=${aa - ab} clipAt=${1 - ALPHA_FLOOR}`)
  }
}
console.log('floor', ALPHA_FLOOR, 'clipAt', 1 - ALPHA_FLOOR, 'checked')
