// Which generic finish a card wears, and the odds the pack slot rolls for it.
//
// This is the coarse layer, not the printing database. It answers three things:
//
//   holoFinishFor(setId)      the era's holo paper family for a foil card
//   isFoilRare(setId, rarity) whether a rare-slot card is foil at all
//   rareVariantFor(...)       the price key a pulled copy gets ('holofoil' or
//                             'normal'), which is what makes a holo rare worth
//                             what it is worth instead of the plain card's price
//
// The era row is sourced, and deliberately one row per era: a card has ONE
// finish, so the "odds" live in the slot (the rare split decides how often a
// rare is foil, the reverse slot is always reverse) rather than in a per-card
// distribution. Nothing here claims which exact sheet a specific card prints;
// `src/foil/printing-db.ts` keeps that record.
//
// Sources: Bulbapedia's Holofoil page — Starlight for Base, Jungle and Fossil;
// Cosmos from Base Set 2 (2000) to Call of Legends (2011); Tinsel for every
// Generation V set; Water Web from Sun & Moon to Cosmic Eclipse; Line from
// Sword & Shield to Crown Zenith; Sheen/Mirror for the XY run; Mirage for
// Scarlet & Violet onward. "All cards with a rarity of Rare or higher are
// Holofoil cards by definition" is its Scarlet & Violet sentence.

import { db } from '../lib/db'
import type { FinishId } from '../../src/foil/finishes'

const dateCache = new Map<string, string>()

/** Release date as 'YYYY/MM/DD' ('' when the catalog has no date). */
export function finishDateFor(setId: string): string {
  const hit = dateCache.get(setId)
  if (hit !== undefined) return hit
  const row = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(setId) as { release_date: string | null } | undefined
  const date = (row?.release_date ?? '').slice(0, 10)
  dateCache.set(setId, date)
  return date
}

/** Release year for a set (0 when the catalog has no date). */
export function finishYearFor(setId: string): number {
  return Number(finishDateFor(setId).slice(0, 4)) || 0
}

/**
 * The era paper a foil card wears. Base, Jungle and Fossil are Starlight.
 *
 * The boundaries are dates, not years, because 2011 holds two papers: Call of
 * Legends (February) is the last Cosmos set and Black & White (April) is the
 * first Tinsel one. A year-only rule put BW on Cosmos.
 */
export function holoFinishFor(setId: string): FinishId {
  const date = finishDateFor(setId)
  if (!date) return 'mirage'
  if (date < '2000/01/01') return 'starlight'
  if (date < '2011/04/01') return 'cosmos'
  if (date < '2014/01/01') return 'tinsel'
  if (date < '2017/01/01') return 'mirror'
  if (date < '2020/01/01') return 'waterweb'
  if (date < '2023/01/01') return 'line'
  return 'mirage'
}

/**
 * Whether a rare-slot card is printed as a foil card.
 *
 * Scarlet & Violet retired non-holo rares, so every Rare-or-higher is foil
 * there; before it, only the named holo/ultra/secret tiers are. A plain "Rare"
 * in an older set is a non-holo rare and keeps the plain price.
 */
export function isFoilRare(setId: string, rarity: string | null | undefined): boolean {
  if (!rarity) return false
  // Dragon Vault is the all-Holofoil set: every card is foil even when its
  // rarity label is only "Rare".
  if (setId === 'dv1') return true
  if (finishDateFor(setId) >= '2023/01/01') return true
  return /holo|ultra|secret|rainbow|prime|legend|shiny|illustration|double rare|hyper|ace spec|gold|promo/i.test(rarity)
}

/** The generic finish a rare-slot card wears once it is drawn. */
export function rareFinishFor(setId: string, rarity: string | null | undefined): FinishId {
  return isFoilRare(setId, rarity) ? holoFinishFor(setId) : 'plain'
}

/** The price key a rare-slot pull stores: foil cards are 'holofoil'. */
export function rareVariantFor(setId: string, rarity: string | null | undefined): 'holofoil' | 'normal' {
  // Dragon Vault's shelf is five Holofoil cards, so the price key is foil even
  // for a row whose rarity string says "Rare".
  if (setId === 'dv1') return 'holofoil'
  return isFoilRare(setId, rarity) ? 'holofoil' : 'normal'
}
