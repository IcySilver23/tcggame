import { foilMaskFor } from '../src/foil/mask'
const res = await fetch('http://localhost:8787/api/cards/search?owned=1&limit=500')
const j: any = await res.json()
const cards = j.cards ?? j
const inv = await (await fetch('http://localhost:8787/api/inventory')).json() as any[]
const variant = new Map<string, string>()
for (const r of inv) if (!variant.has(r.card_id)) variant.set(r.card_id, r.variant)
const kinds: Record<string, string[]> = {}
for (const c of cards) {
  const m = foilMaskFor({ cardId: c.id, rarity: c.rarity, variant: variant.get(c.id) ?? 'normal' }) as any
  const k = m ? m.kind : 'none'
  ;(kinds[k] ??= []).push(`${c.id}(${c.rarity})`)
}
for (const [k, v] of Object.entries(kinds)) console.log(k, v.length, v.slice(0, 8).join(' '))
