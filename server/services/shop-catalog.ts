// The Pack Shop used to answer with every product's price, EV, Sequin odds and
// slot plan in one payload. Pricing and pack estimates dominated the first
// paint, and most of those rows were never looked at. The shelf now has two
// halves:
//
//   listProducts()    catalogue rows, daily-deal terms and cheap OOP/source
//                     badges — no EV, slots, Sequin odds or price model
//   productDetail()   one product's price, EV, Sequin odds and slot plan
//
// The detail endpoint is called for the selected product and for shelf items
// as they come into view. An explicit EV/price sort asks for the visible list's
// details in one batch.
import { db } from '../lib/db'
import { SEALED_EVIDENCE } from '../catalog/sealed-evidence'
import { miniPackFor } from '../catalog/general-mills'
import * as dailydeals from './dailydeals'
import * as gmpacks from './gmpacks'
import * as packs from './packs'
import * as sealed from './sealed'

export type ShopProductRow = Record<string, unknown>

export type ShopProductDetail = {
  id: string
  market: number
  price_source: 'pricecharting' | 'tcgplayer' | 'pokeinvest' | 'estimated'
  oopMonths: number
  oop: boolean
  status: 'in print' | 'out of print'
  est: ReturnType<typeof packs.estimatePackValue>
  mini: ReturnType<typeof gmpacks.miniSequinOdds>
  slots: ReturnType<typeof packs.packSlots> | undefined
}

/** The fast half: no price model, no EV, no slot plan. */
export function listProducts(): ShopProductRow[] {
  const daily = dailydeals.dealsForToday()
  const rows = db.prepare(`
    SELECT p.*, s.name AS set_name, s.symbol_url AS set_symbol, s.logo_url AS set_logo
    FROM pack_products p JOIN sets s ON s.id = p.set_id
    ORDER BY s.release_date DESC,
      CASE p.kind WHEN 'booster' THEN 1 WHEN 'bundle' THEN 2 WHEN 'etb' THEN 3 WHEN 'display' THEN 4 ELSE 5 END
  `).all() as Record<string, unknown>[]

  return rows
    .filter((r) => sealed.sellsProduct(String(r.id), String(r.set_id)))
    .map((r) => {
      const id = String(r.id)
      const deal = daily.get(id)
      const evidence = SEALED_EVIDENCE[id]
      const facts = sealed.shelfFacts(id)
      return {
        ...r,
        // Price and EV arrive from productDetail(); the list only carries the
        // cheap facts the shelf can paint immediately.
        deal: deal
          ? { discountPct: deal.discountPct, endsAt: deal.endsAt, claimed: deal.claimed }
          : undefined,
        price_source: facts.source,
        oop: facts.oop,
        oop_months: facts.oopMonths,
        oop_status: facts.status,
        promos: evidence?.promos.length ? evidence.promos : undefined,
        promoPolicy: evidence?.promos.length ? (evidence.promoPolicy ?? 'one-of') : undefined,
      }
    })
}

/** One product's expensive half: actual shelf price, EV and pack contents. */
export function productDetail(productId: string): ShopProductDetail | null {
  const row = db
    .prepare('SELECT set_id, cards_per_pack FROM pack_products WHERE id = ?')
    .get(productId) as { set_id: string; cards_per_pack: number } | undefined
  if (!row) return null
  const detail = sealed.priceDetail(productId)
  const mini = miniPackFor(productId)
  return {
    id: productId,
    market: detail.market,
    price_source: detail.source,
    oopMonths: Math.round(detail.oopMonths),
    oop: detail.oop,
    status: detail.status,
    est: mini ? gmpacks.estimateMiniPack(productId) : packs.estimatePackValue(row.set_id),
    mini: mini ? gmpacks.miniSequinOdds(productId) : null,
    slots: mini ? undefined : packs.packSlots(row.set_id, row.cards_per_pack),
  }
}

/** Batch form for an EV/price sort; unknown ids are skipped. */
export function productDetails(ids: string[]): ShopProductDetail[] {
  const out: ShopProductDetail[] = []
  for (const id of [...new Set(ids.map(String))]) {
    const detail = productDetail(id)
    if (detail) out.push(detail)
  }
  return out
}
