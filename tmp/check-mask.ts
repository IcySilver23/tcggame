// Mask tests — Phase 2 (redone against the RC6 asset sheet).
//
// The mask is allowed to claim one thing: where foil exists. The sheet fixes two
// details these tests now pin down:
//   - the mask is a card SHAPE (rounded silhouette), so the cut-away corners are
//     black even on a full-bleed printing;
//   - it is grayscale only, 0 or 255, and never touches the artwork.
import { foilMaskFor, maskValue, coverageFraction, CARD_AREA } from '../src/foil/mask'

let failed = 0
const ok = (cond: boolean, label: string, detail?: string) => {
  if (cond) console.log('ok    ' + label)
  else { failed++; console.log('FAIL  ' + label + (detail ? ' — ' + detail : '')) }
}

// --- Flareon-EX RC6: full-bleed foil -----------------------------------------
const rc6 = foilMaskFor({ cardId: 'g1-RC6', rarity: 'Rare Holo EX' })
ok(!!rc6, 'RC6 has a mask')
ok(rc6?.kind === 'full', 'RC6 mask is full-bleed', rc6?.kind)
ok(maskValue(rc6!, 0.5, 0.5) === 255, 'RC6 centre is foil')
ok(maskValue(rc6!, 0.5, 0.02) === 255, 'RC6 top edge is foil')
ok(maskValue(rc6!, 0.5, 0.98) === 255, 'RC6 bottom edge is foil')
ok(maskValue(rc6!, 0.02, 0.5) === 255, 'RC6 left edge is foil')
// The sheet's mask panel has rounded corners; foil stops where the card stops.
ok(maskValue(rc6!, 0.002, 0.002) === 0, 'RC6 top-left corner is outside the card')
ok(maskValue(rc6!, 0.998, 0.998) === 0, 'RC6 bottom-right corner is outside the card')
ok(Math.abs(coverageFraction(rc6) - CARD_AREA) < 1e-12, 'RC6 coverage is the card silhouette')
ok(coverageFraction(rc6) > 0.998 && coverageFraction(rc6) < 1,
  'RC6 silhouette is ~99.85% of the card box', String(coverageFraction(rc6)))

// --- Yveltal RC16: art window only -------------------------------------------
const rc16 = foilMaskFor({ cardId: 'g1-RC16', rarity: 'Uncommon' })
ok(rc16?.kind === 'art', 'RC16 foils the art window', rc16?.kind)
ok(maskValue(rc16!, 0.5, 0.3) === 255, 'RC16 art centre is foil')
ok(maskValue(rc16!, 0.5, 0.05) === 0, 'RC16 name bar is not foil')
ok(maskValue(rc16!, 0.5, 0.63) === 0, 'RC16 text panel is not foil')
ok(maskValue(rc16!, 0.02, 0.3) === 0, 'RC16 left frame is not foil')
ok(maskValue(rc16!, 0.002, 0.002) === 0, 'RC16 corner is outside the card')
ok(Math.abs(coverageFraction(rc16) - 0.838 * 0.448) < 1e-9, 'RC16 coverage matches the art rect')

// --- Reverse holo: everything but the art window ------------------------------
const rev = foilMaskFor({ cardId: 'base6-1', rarity: 'Rare Holo', variant: 'reverseHolofoil' })
ok(rev?.kind === 'outsideArt', 'reverse holo inverts the art window', rev?.kind)
ok(maskValue(rev!, 0.5, 0.3) === 0, 'reverse: art centre has no foil')
ok(maskValue(rev!, 0.05, 0.05) === 255, 'reverse: border has foil')
ok(maskValue(rev!, 0.5, 0.95) === 255, 'reverse: text panel has foil')
ok(maskValue(rev!, 0.002, 0.002) === 0, 'reverse: corner is outside the card')
ok(Math.abs(coverageFraction(rev) - (CARD_AREA - 0.838 * 0.448)) < 1e-9,
  'reverse coverage is the card minus the art rect')

// --- Non-holo cards get nothing ----------------------------------------------
ok(foilMaskFor({ cardId: 'base1-1', rarity: 'Common' }) === null, 'plain common has no mask')
ok(foilMaskFor({ cardId: null, rarity: null }) === null, 'no id and no rarity has no mask')

// --- Geometry stays inside the card -------------------------------------------
const rects = [rc6, rc16, rev].filter(Boolean) as NonNullable<typeof rc6>[]
ok(rects.every((m) => m.rect.x >= 0 && m.rect.y >= 0 && m.rect.x + m.rect.w <= 1.0001 && m.rect.y + m.rect.h <= 1.0001),
  'every mask rectangle is inside the card box')
ok(rects.every((m) => m.evidence.length > 20), 'every mask carries its evidence')

console.log(failed === 0 ? '\nALL OK — masks cover exactly what the printing foils' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
