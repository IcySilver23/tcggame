import path from 'node:path'
process.env.TCGLIFE_HOME = path.resolve('tmp/thumb-home')
const { db } = await import('../server/lib/db')
const totals = db
  .prepare(
    `SELECT COUNT(*) n, SUM(CASE WHEN p.image_url IS NOT NULL THEN 1 ELSE 0 END) with_art,
            SUM(CASE WHEN s.logo_url IS NOT NULL THEN 1 ELSE 0 END) with_logo
     FROM pack_products p LEFT JOIN sets s ON s.id = p.set_id`,
  )
  .get() as { n: number; with_art: number; with_logo: number }
console.log('products:', totals.n, '· with wrapper art:', totals.with_art, '· with set logo:', totals.with_logo)
for (const r of db
  .prepare(
    `SELECT p.id, p.name, substr(coalesce(p.image_url,'(none)'),1,58) art,
            (s.logo_url IS NOT NULL) logo, (s.symbol_url IS NOT NULL) symbol
     FROM pack_products p LEFT JOIN sets s ON s.id = p.set_id
     WHERE p.image_url IS NOT NULL ORDER BY RANDOM() LIMIT 4`,
  )
  .all() as { id: string; name: string; art: string; logo: number; symbol: number }[]) {
  console.log(` ${r.id.padEnd(22)} ${String(r.logo).padEnd(2)}${String(r.symbol).padEnd(2)} art=${r.art}`)
}
db.close()
