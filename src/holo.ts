// Which foil a card actually wears.
//
// Real cards are not "shiny"; each printing has a specific pattern, and the
// pattern changed with the era. The mapping follows Bulbapedia's Holofoil
// table: Starlight for Base/Jungle/Fossil, Cosmos from Base Set 2 through Call
// of Legends, Tinsel for Black & White, Sheen for XY, Water Web for Sun & Moon,
// Line for Sword & Shield, Mirage from Scarlet & Violet, Pixel/Confetti for the
// McDonald's sets and the Celebrations Classic Collection, Cracked Ice for the
// Rising Rivals Frost Rotom printing, and Radiant for the RC subset. Reverse holo is the same
// printing's foil with the art window masked out.

import { nonHoloFor, printingFor } from './foil/printing-db'
import { energyReverseFor } from './foil/reverse-energy-large-db'
import { reverseConfigFor, reverseEligible } from './foil/reverse-db'
import { specialReverseFor } from './foil/reverse-special'
import { BALL_STAMPS, ascendedStampFor } from './foil/ball-stamps'
import type { FoilPatternId } from './foil/patterns'

export type HoloStyle =
  | 'starfoil' | 'cosmos' | 'tinsel' | 'sheen' | 'waterweb' | 'line' | 'mirage'
  | 'confetti' | 'crackedice' | 'radiant' | 'anniversary'
  | 'etched' | 'starlight' | 'shiny' | 'rainbow'

export type HoloArt = {
  style: HoloStyle
  reverse: boolean
  /** The database pattern, when the printing database resolved this card. */
  pattern?: FoilPatternId | null
}

/** Stable FNV-1a hash of a key — the seed every card's foil is derived from. */
export function hashKey(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** The set id inside a pokemontcg.io card id ('sv8-25' -> 'sv8'). */
export function setIdOf(cardId: string | null | undefined): string | null {
  if (!cardId) return null
  const cut = cardId.lastIndexOf('-')
  return cut > 0 ? cardId.slice(0, cut) : null
}

function startsWithAny(id: string, prefixes: string[]): boolean {
  return prefixes.some((p) => id.startsWith(p))
}

/** The standard-holo pattern of a printing era. */
function eraPattern(setId: string): HoloStyle {
  // Starlight — Base, Jungle, Fossil.
  if (/^base[123]$/.test(setId)) return 'starfoil'
  // Everything else in the base line (Base Set 2, Team Rocket, Legendary
  // Collection, promos) is Cosmos.
  if (setId.startsWith('base')) return 'cosmos'
  // Cosmos — Base Set 2 all the way through Call of Legends.
  if (startsWithAny(setId, ['gym', 'neo', 'si', 'ecard', 'ex', 'pop', 'dp', 'pl', 'hgss', 'hsp', 'col', 'dv', 'bp', 'ru', 'np'])) return 'cosmos'
  // Tinsel — Black & White through Legendary Treasures.
  if (startsWithAny(setId, ['bw'])) return 'tinsel'
  // Sheen — XY and Generations.
  if (startsWithAny(setId, ['xy', 'g1', 'dc'])) return 'sheen'
  // Water Web — Sun & Moon through Cosmic Eclipse.
  if (startsWithAny(setId, ['sm', 'det1'])) return 'waterweb'
  // Line — Sword & Shield through Crown Zenith.
  if (startsWithAny(setId, ['swsh', 'pgo', 'fut'])) return 'line'
  // Mirage — Scarlet & Violet onward.
  if (startsWithAny(setId, ['sv', 'sve', 'rsv', 'zsv', 'me'])) return 'mirage'
  return 'mirage'
}

/** Printings whose foil is the printing, regardless of era or rarity. */
function printingPattern(setId: string, number: string, rarity: string): HoloStyle | null {
  // Radiant Collection: every RC-numbered card is foil, commons included.
  if (number.startsWith('RC')) return 'radiant'
  // Pixel / Confetti — McDonald's Collection, and the Celebrations Classic
  // Collection (Bulbapedia lists both under the pixel/confetti pattern).
  if (setId.startsWith('mcd')) return 'confetti'
  if (setId === 'cel25' || setId === 'cel25c') return 'confetti'
  // EX Trainer Kits (tk1a/tk1b/tk2a/tk2b) were once assigned Cracked Ice by this
  // prefix rule. They shipped in 2004–2005, before the pattern existed, and no
  // source read here documents their foil, so the rule is gone: no claim.
  // 30th anniversary: the main set beyond the plain commons, and the Classic
  // Collection reprints, whose shared paper Bulbapedia names — a textured confetti
  // holofoil. This used to say cosmos, which was this build's guess.
  if (setId === 'me55c') return 'confetti'
  if (setId === 'me55' && rarity !== '' && rarity !== 'Common') return 'anniversary'
  return null
}

/** Chase tiers get their own modern texture over whatever era they sit in. */
function chasePattern(rarity: string): HoloStyle | null {
  if (/special illustration/i.test(rarity)) return 'starlight'
  if (/illustration rare/i.test(rarity)) return 'etched'
  if (/shiny/i.test(rarity)) return 'shiny'
  if (/hyper|rainbow|gold|secret/i.test(rarity)) return 'rainbow'
  // LEGEND is deliberately absent: those cards are printed entirely in Cosmos
  // foil, so the era/printing decides for them (see cosmos-masks.ts).
  if (/double rare|ultra rare|rare ultra|vmax|vstar|break|prime|lv\.x|prism star|radiant|amazing|ace spec|trainer gallery|classic collection|shining/i.test(rarity)) return 'etched'
  return null
}

/**
 * Generations Radiant Collection commons are NOT foil.
 *
 * The subset is not uniform: Bulbapedia and RC pull-sheet data both say the
 * Generations RC COMMONS are printed plain and the uncommons and up are foil
 * ("The Common Radiant Collection cards found in Generations are ALL Non-Foil.
 * The Uncommon are Foil." — elitefourum, citing the two RC print sheets, SPa and
 * SPb). Foiling all 32 g1 RC cards was therefore wrong for thirteen of them.
 *
 * https://www.elitefourum.com/t/generations-radiant-collection-some-non-holo-radiant/14203
 */
export function isRadiantPlain(setId: string | null, number: string, rarity: string): boolean {
  return setId === 'g1' && number.startsWith('RC') && /^common$/i.test(rarity)
}

/**
 * The foil for a card, or null when it is not foil at all.
 * The owned copy's variant wins when present; otherwise rarity and the printing
 * decide, which is what browsing an unowned card shows.
 */
export function holoFor(input: { variant?: string | null; rarity?: string | null; cardId?: string | null }): HoloArt | null {
  const variant = (input.variant ?? '').toLowerCase()
  const rarity = input.rarity ?? ''
  const setId = setIdOf(input.cardId)
  const number = setId && input.cardId ? input.cardId.slice(setId.length + 1).toUpperCase() : ''
  const reverse = variant.includes('reverse')

  // No foil beats every rule below — including reverse, which the Radiant
  // Collection never had. Marketplaces flag RC rows "Reverse Holo" loosely; a
  // flag must not be able to invent a foil printing that does not exist.
  if (setId && isRadiantPlain(setId, number, rarity)) return null

  // Ascended Heroes' Energy-pattern reverse is its own explicit variant. It has
  // the set's body mask but a different stamp, so it must not fall through to the
  // set's ordinary reverse paper.
  const energy = energyReverseFor(setId, input.variant)
  if (energy) {
    if (setId && !reverseEligible({ setId, number, rarity })) return null
    return { style: setId ? eraPattern(setId) : 'mirage', reverse: true, pattern: energy.pattern }
  }

  // Balls, and Ascended Heroes' Team Rocket mark, are explicit variants of one
  // set: only a caller passing that variant gets them. A plain 'reverseHolofoil'
  // of the same card keeps the set's ordinary paper, and a set id alone never
  // implies a stamp.
  const special = specialReverseFor(setId, input.variant)
  if (special) {
    if (setId && !reverseEligible({ setId, number, rarity })) return null
    // Ascended Heroes prints one assigned stamp per regular Pokémon, so the card
    // decides which paper is on it: a stale or mismatched token cannot paint a
    // ball that card never wore, and Team Rocket's cards keep their R.
    const assigned = ascendedStampFor(input.cardId)
    const assignedRow = assigned
      ? specialReverseFor(setId, BALL_STAMPS[assigned].variant)
      : null
    return {
      style: setId ? eraPattern(setId) : 'mirage',
      reverse: true,
      pattern: assignedRow?.pattern ?? special.pattern,
    }
  }

  // Reverse holos did not exist before Legendary Collection, so a reverse flag
  // on Base, Jungle, Fossil, Base Set 2 or Team Rocket cannot conjure a printing
  // that was never made. (Legendary Collection, base6, is the first set that had
  // them and is deliberately not excluded.)
  if (reverse) {
    if (setId && /^base[1-5]$/.test(setId)) return null
    // In sets that did have reverse holos, only the regular cards got one: the
    // H-numbered Aquapolis/Skyridge holos and every ultra/secret tier are
    // excluded, so a marketplace flag cannot invent those either.
    const revCfg = setId ? reverseConfigFor(setId) : null
    if (revCfg && setId && !reverseEligible({ setId, number, rarity })) return null
  }

  // The printing database answers first, and its answers carry evidence.
  const dbPrinting = printingFor({ cardId: input.cardId, rarity, variant: input.variant })
  if (dbPrinting) {
    // A special treatment can still be a REVERSE finish — the BW39 Battle City
    // promo is a Poké Ball reverse — so the record's own variant decides.
    if (dbPrinting.pattern === 'special-treatment') {
      return { style: 'etched', reverse: dbPrinting.variant === 'reverse', pattern: dbPrinting.pattern }
    }
    if (dbPrinting.pattern.startsWith('reverse-')) return { style: setId ? eraPattern(setId) : 'mirage', reverse: true, pattern: dbPrinting.pattern }
    if (dbPrinting.pattern === 'cosmos-retro' || dbPrinting.pattern === 'cosmos-hd') {
      // Southern Islands and Best of Game wear the Cosmos paper as a REVERSE
      // finish, so the record's variant decides here too.
      return { style: 'cosmos', reverse: dbPrinting.variant === 'reverse', pattern: dbPrinting.pattern }
    }
    // Pixel / Confetti is identified for the Classic Collection reprints; the era
    // style would otherwise call a 2026 card Scarlet & Violet's mirage paper.
    if (dbPrinting.pattern === 'confetti') {
      return { style: 'confetti', reverse: false, pattern: dbPrinting.pattern }
    }
    // Starlight is its own pattern, and the database already verified the
    // printing: Base, Jungle and Fossil holo rares only. Carry the pattern id so
    // mark-field.ts can load the starfield instead of falling back to plain foil.
    if (dbPrinting.pattern === 'starlight') {
      return { style: 'starfoil', reverse: false, pattern: dbPrinting.pattern }
    }
    if (dbPrinting.pattern === 'crackedice') {
      // Cracked Ice is normally a holo card's paper, but POP Series 8's named
      // versions are Cracked Ice applied as a REVERSE finish; the printing record
      // says which this copy is.
      return { style: 'crackedice', reverse: dbPrinting.variant === 'reverse', pattern: dbPrinting.pattern }
    }
    // Tinsel is the Generation V paper. The database verified the printing; carry
    // the pattern id so mark-field.ts loads the stripe sheet.
    if (dbPrinting.pattern === 'tinsel') {
      return { style: 'tinsel', reverse: false, pattern: dbPrinting.pattern }
    }
    // Every other identified pattern still resolves. The printing database named
    // it from a source, so the card IS foil; an unimplemented sheet (mirror,
    // crosshatch, a textured full art) renders plain foil through mark-field.ts
    // rather than borrowing another paper. Falling through here instead would
    // hand a foil promo back as "not foil" because no rarity label says so.
    return { style: setId ? eraPattern(setId) : 'mirage', reverse: dbPrinting.variant === 'reverse', pattern: dbPrinting.pattern }
  }

  // A POP Series base card is a verified NON-HOLO printing: a marketplace
  // "holofoil" flag on it cannot conjure a foil. Its holographic versions are
  // separate named products, and those already answered above.
  if (nonHoloFor({ cardId: input.cardId, rarity, variant: input.variant })) return null

  const printing = setId ? printingPattern(setId, number, rarity) : null
  const chase = chasePattern(rarity)
  const era = setId ? eraPattern(setId) : 'mirage'

  // A reverse holo is still the printing's foil — just applied around the art.
  if (reverse) return { style: printing ?? chase ?? era, reverse: true }
  if (printing) return { style: printing, reverse: false }
  if (chase) return { style: chase, reverse: false }

  // Base holo-ness. Scarlet & Violet made every plain Rare holofoil, so those
  // count even with no variant and no "Holo" in the rarity label.
  const svRare = /^rare$/i.test(rarity) && startsWithAny(setId ?? '', ['sv', 'me'])
  // LEGEND cards are "entirely holofoil" even though their rarity label never
  // says so, so the label alone cannot decide foil-ness for them.
  const foil = variant.includes('holofoil') || variant.includes('holo') || /holo/i.test(rarity) || /legend/i.test(rarity) || svRare
  return foil ? { style: era, reverse: false } : null
}
