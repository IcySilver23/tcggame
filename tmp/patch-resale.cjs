const fs = require('fs')
const eol = (s) => (s.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s)

function patch(file, from, to) {
  let src = fs.readFileSync(file, 'utf8')
  if (!src.includes(eol(from))) throw new Error('anchor missing in ' + file + ': ' + from.slice(0, 90))
  src = src.replace(eol(from), eol(to))
  fs.writeFileSync(file, src)
  console.log('ok', file)
}

/* Flip stock carries its own name, art and condition — the shelf used to fire
   one /card-detail request per row just to print a name. */
patch(
  'server/services/resale.ts',
  `  const rows = db
    .prepare(\`SELECT id, card_id, variant, condition, quantity, graded_grade, cost_basis, acquired_at, acquired_ref FROM inventory WHERE status = 'collection' AND acquired_via = 'resale' ORDER BY acquired_at DESC\`)
    .all() as { id: number; card_id: string; variant: string; condition: string; quantity: number; graded_grade: string | null; cost_basis: number; acquired_at: string; acquired_ref: string | null }[]`,
  `  const rows = db
    .prepare(
      \`SELECT i.id, i.card_id, i.variant, i.condition, i.quantity, i.graded_grade, i.cost_basis, i.acquired_at, i.acquired_ref,
              c.name AS name, c.image_small AS image
       FROM inventory i JOIN cards c ON c.id = i.card_id
       WHERE i.status = 'collection' AND i.acquired_via = 'resale'
       ORDER BY i.acquired_at DESC\`,
    )
    .all() as { id: number; card_id: string; variant: string; condition: string; quantity: number; graded_grade: string | null; cost_basis: number; acquired_at: string; acquired_ref: string | null; name: string; image: string | null }[]`,
)

patch(
  'server/services/resale.ts',
  `    return {
      inventoryId: r.id,
      cardId: r.card_id,
      costBasis: basis,
      market,
      offer,
      marginPct: market > 0 ? Math.round(((offer - basis) / Math.max(basis, 0.01)) * 100) : 0,
      heldSince: r.acquired_at,
    }`,
  `    return {
      inventoryId: r.id,
      cardId: r.card_id,
      name: r.name,
      image: r.image,
      condition: r.condition,
      quantity: r.quantity,
      costBasis: basis,
      market,
      offer,
      marginPct: market > 0 ? Math.round(((offer - basis) / Math.max(basis, 0.01)) * 100) : 0,
      heldSince: r.acquired_at,
    }`,
)

patch(
  'src/api.ts',
  `  lots: {
    inventoryId: number
    cardId: string
    costBasis: number`,
  `  lots: {
    inventoryId: number
    cardId: string
    name: string
    image: string | null
    condition: string
    quantity: number
    costBasis: number`,
)

fs.appendFileSync(
  'src/styles.css',
  `
/* ===== Resale desk =========================================================
   Three lanes over one ledger: notes on the desk, the shelf, the statement.
   Built for the narrow window — no tables, nothing that wraps a button onto a
   second line. */
.rd-top{display:flex;flex-direction:column;gap:10px;margin-bottom:2px}
.rd-id{display:flex;gap:10px;align-items:center}
.rd-mark{width:38px;height:38px;flex:none;display:grid;place-items:center;font-size:19px;background:var(--panel2);border:2px solid var(--edge);border-radius:11px;box-shadow:0 3px 0 var(--edge)}
.rd-id h1{margin:0;font-size:23px;letter-spacing:-.4px;line-height:1.1}
.rd-tag{font-size:11.5px;color:var(--text-dim);line-height:1.4;margin-top:2px}
.rd-tabs{display:flex;gap:6px;flex-wrap:wrap}
.rd-tab{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;font-size:11.5px;font-weight:750;color:var(--text-dim);background:var(--panel2);border:1.5px solid var(--border-soft);border-radius:9px;cursor:pointer}
.rd-tab:hover{border-color:var(--border);color:var(--text)}
.rd-tab.on{background:var(--yellow);color:var(--on-yellow);border-color:var(--yellow-line);box-shadow:0 2px 0 rgba(4,8,26,.45)}
.rd-tab i{font-style:normal;font-size:9.5px;font-weight:850;padding:0 4px;border-radius:5px;background:rgba(0,0,0,.12);min-width:14px;text-align:center}
.rd-tape{display:flex;margin:12px 0 14px;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--panel2)}
.rd-cell{flex:1 1 0;min-width:0;padding:7px 8px;border-right:1px dashed var(--border-soft);display:flex;flex-direction:column;gap:0}
.rd-cell:last-child{border-right:none}
.rd-cell span{font-size:8px;letter-spacing:.9px;text-transform:uppercase;color:var(--text-faint);font-weight:850}
.rd-cell b{font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.35}
.rd-cell em{font-style:normal;font-size:9px;color:var(--text-faint)}
.rd-pos{color:var(--green)}
.rd-neg{color:var(--red)}
.rd-list{display:flex;flex-direction:column;gap:11px}
.rd-deal{background:var(--panel);border:1px solid var(--border);border-left:4px solid var(--border-soft);border-radius:11px;padding:10px 11px}
.rd-deal.hot{border-left-color:var(--green)}
.rd-deal.cold{border-left-color:var(--red)}
.rd-deal-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.rd-seller b{font-size:13.5px}
.rd-kind{margin-left:6px;font-size:8px;letter-spacing:.7px;text-transform:uppercase;color:var(--text-faint);border:1px solid var(--border-soft);border-radius:5px;padding:1px 4px;font-weight:800}
.rd-clock{font-size:9.5px;color:var(--text-faint);white-space:nowrap;font-weight:700}
.rd-clock.urgent{color:var(--red);font-weight:850}
.rd-quote{margin:5px 0 8px;font-size:11.5px;font-style:italic;color:var(--text-dim);line-height:1.45}
.rd-fan{display:flex;gap:4px;margin-bottom:8px;cursor:pointer;align-items:center}
.rd-fan .card-img-wrap{width:40px;flex:none;border-radius:5px;overflow:hidden}
.rd-fan-more{font-size:10px;font-weight:800;color:var(--text-faint);padding-left:2px}
.rd-metrics{display:flex;gap:12px;margin-bottom:7px}
.rd-metrics div{display:flex;flex-direction:column;min-width:0}
.rd-metrics span{font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--text-faint);font-weight:850}
.rd-metrics b{font-size:12.5px}
.rd-meter{position:relative;height:7px;border-radius:4px;background:var(--track);overflow:hidden}
.rd-meter i{position:absolute;top:0;bottom:0;left:0;background:linear-gradient(90deg,var(--green),var(--yellow));border-radius:4px}
.rd-meter u{position:absolute;top:-2px;bottom:-2px;left:50%;width:2px;background:var(--text-faint);opacity:.65}
.rd-edge{display:flex;justify-content:space-between;gap:8px;font-size:9.5px;color:var(--text-faint);margin:3px 0 9px}
.rd-edge b{font-size:10.5px}
.rd-actions{display:flex;gap:6px;flex-wrap:wrap}
.rd-actions button{flex:1 1 auto;min-width:0}
.rd-lot{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--border-soft)}
.rd-lot-card{display:flex;flex-direction:column;gap:2px;cursor:pointer;min-width:0}
.rd-lot-card .card-img-wrap{border-radius:5px;overflow:hidden}
.rd-lot-card span{display:flex;justify-content:space-between;gap:3px;font-size:9px}
.rd-lot-card span b{font-weight:800;color:var(--text-dim)}
.rd-banner{display:flex;flex-direction:column;gap:8px;padding:9px 11px;margin-bottom:11px;background:var(--panel2);border:1px solid var(--border-soft);border-radius:11px;font-size:11.5px;line-height:1.45;color:var(--text-dim)}
.rd-banner b{color:var(--text)}
.rd-shelf{display:flex;flex-direction:column;gap:9px}
.rd-flip{display:flex;gap:10px;padding:9px;background:var(--panel);border:1px solid var(--border);border-radius:11px}
.rd-flip-art{width:60px;flex:none;cursor:pointer}
.rd-flip-art .card-img-wrap{border-radius:5px;overflow:hidden}
.rd-flip-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.rd-flip-name{font-size:12.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rd-flip-meta{font-size:8.5px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.7px;font-weight:850}
.rd-flip-nums{display:flex;gap:9px;font-size:10.5px;color:var(--text-dim)}
.rd-flip-offer{display:flex;align-items:baseline;gap:5px}
.rd-flip-offer b{font-size:14px}
.rd-flip-offer em{font-style:normal;font-size:10.5px;font-weight:850}
.rd-flip .primary{align-self:flex-start;margin-top:4px}
.rd-statement{background:var(--panel);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.rd-st-head{display:flex;justify-content:space-between;padding:8px 12px;background:var(--panel2);border-bottom:1px solid var(--border-soft);font-size:9px;letter-spacing:1.4px;text-transform:uppercase;color:var(--text-faint);font-weight:850}
.rd-line{display:flex;justify-content:space-between;gap:10px;padding:7px 12px;font-size:12px;border-bottom:1px dotted var(--border-soft)}
.rd-line span{color:var(--text-dim);min-width:0}
.rd-line b{white-space:nowrap}
.rd-total{display:flex;justify-content:space-between;padding:10px 12px;background:var(--panel2);border-top:1px solid var(--border);font-size:13px;font-weight:850}
.rd-note{padding:10px 12px;font-size:10.5px;color:var(--text-faint);line-height:1.5;border-top:1px dashed var(--border-soft)}
`,
)
console.log('ok src/styles.css (appended)')
