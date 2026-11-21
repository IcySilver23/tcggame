import { SPECIAL_PRODUCTS } from '../server/catalog/sealed-evidence'

type ApiProduct = { id: string; name: string; image_url: string | null }
const products = await fetch('http://127.0.0.1:8787/api/shop/products').then((r) => r.json()) as ApiProduct[]
const specials = new Map(SPECIAL_PRODUCTS.map((p) => [p.id, p]))
const missing = products.filter((p) => !p.image_url && specials.has(p.id))

function meta(html: string, key: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, 'i'),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) return m[1]
  }
  return null
}

for (const p of missing) {
  const s = specials.get(p.id)!
  if (!s.source.url) {
    console.log(`${p.id}\tNO SOURCE URL`)
    continue
  }
  try {
    const res = await fetch(s.source.url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; TCG-Life product-image audit)' },
      signal: AbortSignal.timeout(20_000),
    })
    const html = await res.text()
    const og = meta(html, 'og:image')
    const tw = meta(html, 'twitter:image')
    console.log(`${p.id}\t${res.status}\t${og ?? '-'}\t${tw ?? '-'}\t${s.source.url}`)
  } catch (e) {
    console.log(`${p.id}\tERROR\t${e instanceof Error ? e.message : e}\t${s.source.url}`)
  }
}
