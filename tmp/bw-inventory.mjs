import Database from 'better-sqlite3'
const db = new Database('data/tcglife.db', { readonly: true, fileMustExist: true })
const sets = db.prepare("SELECT id, name, series, release_date FROM sets WHERE series LIKE '%Black%White%' OR id IN ('dv1','bw1','bw2','bw3','bw4','bw5','bw6','bw7','bw8','bw9','bw10','bw11') ORDER BY release_date").all()
for (const s of sets) {
  console.log(`\n## ${s.id} | ${s.name} | ${s.series} | ${s.release_date}`)
  const rows = db.prepare('SELECT id, kind, packs, cards_per_pack, msrp FROM pack_products WHERE set_id = ? ORDER BY id').all(s.id)
  for (const p of rows) console.log(`  ${p.id} | ${p.kind} | ${p.packs} packs | ${p.cards_per_pack} cards | msrp ${p.msrp}`)
}
