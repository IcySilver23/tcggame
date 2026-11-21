import { SPECIAL_PRODUCTS } from '../server/catalog/sealed-evidence'

type ApiProduct = { id: string; set_id: string; name: string; kind: string; image_url: string | null }

const products = await fetch('http://127.0.0.1:8787/api/shop/products').then((r) => r.json()) as ApiProduct[]
const specials = new Map(SPECIAL_PRODUCTS.map((p) => [p.id, p]))
const missing = products.filter((p) => !p.image_url)

console.log(`total=${products.length} missing=${missing.length}`)
for (const p of missing) {
  const s = specials.get(p.id)
  console.log(`\n${p.id} | ${p.kind} | ${p.name}`)
  if (!s) {
    console.log('  no SPECIAL_PRODUCTS row')
    continue
  }
  console.log(`  image=${s.image ?? 'NONE'}`)
  console.log(`  source=${s.source.label} | ${s.source.url ?? 'no url'}`)
  console.log(`  note=${s.note}`)
}
