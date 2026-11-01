const fs = require('fs')
const eol = (s) => (s.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s)

function patch(file, from, to) {
  let src = fs.readFileSync(file, 'utf8')
  if (!src.includes(eol(from))) throw new Error('anchor missing in ' + file + ': ' + from.slice(0, 90))
  src = src.replace(eol(from), eol(to))
  fs.writeFileSync(file, src)
  console.log('ok', file)
}

/* ---------------- server: hand the client the card, not just its name ------ */

patch(
  'server/services/yardsale.ts',
  `): { ok: true; accepted: boolean; paid?: number; counter?: number | null; card?: string; message?: string } | { ok: false; error: string } {`,
  `): {
  ok: true
  accepted: boolean
  paid?: number
  counter?: number | null
  card?: string
  /** What actually came off the table — the client shows the card, not a toast. */
  cardId?: string
  condition?: string
  qty?: number
  value?: number
  message?: string
} | { ok: false; error: string } {`,
)

patch(
  'server/services/yardsale.ts',
  `    .get(cardRowId) as ( { card_id: string; condition: Condition; qty: number; ask: number; status: string; sale_id: number; sale_status: string; rigidity: number; seller_counters: number; seller: string; name: string } ) | undefined`,
  `    .get(cardRowId) as ( { card_id: string; condition: Condition; qty: number; ask: number; status: string; sale_id: number; sale_status: string; rigidity: number; seller_counters: number; seller: string; name: string; true_market: number } ) | undefined`,
)

patch(
  'server/services/yardsale.ts',
  `    return { ok: true as const, accepted: true, paid: bid, card: row.name }`,
  `    return {
      ok: true as const,
      accepted: true,
      paid: bid,
      card: row.name,
      cardId: row.card_id,
      condition: row.condition,
      qty: row.qty,
      value: round2(row.true_market),
    }`,
)

patch(
  'server/services/yardsale.ts',
  `export function buyAtAsk(cardRowId: number): { ok: true; paid: number; card: string } | { ok: false; error: string } {`,
  `export function buyAtAsk(cardRowId: number):
  | { ok: true; paid: number; card: string; cardId: string; condition: string; qty: number; value: number }
  | { ok: false; error: string } {`,
)

patch(
  'server/services/yardsale.ts',
  `    .get(cardRowId) as ({ card_id: string; condition: Condition; qty: number; ask: number; status: string; sale_id: number; sale_status: string; seller: string; name: string } | undefined)`,
  `    .get(cardRowId) as ({ card_id: string; condition: Condition; qty: number; ask: number; status: string; sale_id: number; sale_status: string; seller: string; name: string; true_market: number } | undefined)`,
)

patch(
  'server/services/yardsale.ts',
  `  return { ok: true, paid: row.ask, card: row.name }`,
  `  return {
    ok: true,
    paid: row.ask,
    card: row.name,
    cardId: row.card_id,
    condition: row.condition,
    qty: row.qty,
    value: round2(row.true_market),
  }`,
)

/* ---------------- api types ------------------------------------------------ */

patch(
  'src/api.ts',
  `  yardBuy: (rowId: number) => post<{ ok: boolean; paid?: number; card?: string; error?: string }>(\`/api/yard/buy/\${rowId}\`),`,
  `  yardBuy: (rowId: number) => post<YardPickResult>(\`/api/yard/buy/\${rowId}\`),`,
)

patch(
  'src/api.ts',
  `export type YardOfferResult = {
  ok: boolean
  accepted?: boolean
  paid?: number
  counter?: number | null
  card?: string
  message?: string
  error?: string
}`,
  `export type YardOfferResult = {
  ok: boolean
  accepted?: boolean
  paid?: number
  counter?: number | null
  card?: string
  cardId?: string
  condition?: string
  qty?: number
  value?: number
  message?: string
  error?: string
}

/** What a yard-sale pile actually hands you. */
export type YardPickResult = {
  ok: boolean
  paid?: number
  card?: string
  cardId?: string
  condition?: string
  qty?: number
  value?: number
  error?: string
}`,
)

/* ---------------- client: the reveal --------------------------------------- */

patch(
  'src/views/YardSales.tsx',
  `import type { YardCard, YardOfferResult, YardSaleRow, YardSection, YardBoxResult } from '../api'`,
  `import type { YardCard, YardOfferResult, YardPickResult, YardSaleRow, YardSection, YardBoxResult } from '../api'`,
)

patch(
  'src/views/YardSales.tsx',
  `import { EmptyState, FirstUseTip, fmtUsd, TipList } from '../components'`,
  `import { CardImg, EmptyState, FirstUseTip, fmtUsd, TipList } from '../components'`,
)

patch(
  'src/views/YardSales.tsx',
  `  const [reveal, setReveal] = useState<YardBoxResult | null>(null)`,
  `  const [reveal, setReveal] = useState<YardBoxResult | null>(null)
  // A table buy used to end in a toast, which is not an answer to "what did I
  // just carry home?" — this is the card, its condition, and what it is worth.
  const [pick, setPick] = useState<YardPickResult | null>(null)`,
)

patch(
  'src/views/YardSales.tsx',
  `    if (r.accepted) {
      setSays((s) => { const n = { ...s }; delete n[rowId]; return n })
      setOffers((o) => ({ ...o, [rowId]: '' }))
      return
    }`,
  `    if (r.accepted) {
      setSays((s) => { const n = { ...s }; delete n[rowId]; return n })
      setOffers((o) => ({ ...o, [rowId]: '' }))
      setPick(r)
      return
    }`,
)

patch(
  'src/views/YardSales.tsx',
  `  const buy = (rowId: number) =>
    run(() => api.yardBuy(rowId), (r) => \`Paid \${fmtUsd(r.paid ?? 0)} — \${r.card} is yours.\`)`,
  `  const buy = async (rowId: number) => {
    // No toast: the reveal is the receipt.
    const r = (await run(() => api.yardBuy(rowId), () => '')) as YardPickResult | null
    if (r && r.ok) setPick(r)
  }`,
)

patch(
  'src/views/YardSales.tsx',
  `      {reveal && reveal.ok && reveal.cards && (`,
  `      {pick && (
        <div className="ys-reveal-back" onClick={() => setPick(null)}>
          <div className="ys-reveal" role="dialog" aria-label="What you carried home" onClick={(e) => e.stopPropagation()}>
            <div className="ys-reveal-head">
              <b>🛗 What you carried home</b>
              <button className="ghost small" onClick={() => setPick(null)}>close</button>
            </div>
            <div className="ys-pick">
              <CardImg src={null} alt={pick.card ?? 'the pile'} cardId={pick.cardId} className="ys-pick-art" />
              <div className="ys-pick-info">
                <b>{pick.card}</b>
                <span className="faint small">
                  {pick.condition}{pick.qty && pick.qty > 1 ? \` ×\${pick.qty}\` : ''} · off a driveway table
                </span>
                <span className="faint small">Paid at the sticker, no haggling.</span>
              </div>
            </div>
            <div className="ys-reveal-tally">
              <span>paid <b>{fmtUsd(pick.paid ?? 0)}</b></span>
              <span>worth <b>{fmtUsd(pick.value ?? 0)}</b></span>
              <span className={(pick.value ?? 0) >= (pick.paid ?? 0) ? 'pw-ok' : 'pw-bad'}>
                {(pick.value ?? 0) >= (pick.paid ?? 0) ? '+' : '−'}
                {fmtUsd(Math.abs((pick.value ?? 0) - (pick.paid ?? 0)))}
                {(pick.value ?? 0) >= (pick.paid ?? 0) ? ' under market' : ' over market'}
              </span>
            </div>
            <div className="faint small">It's in your binder now — acquired at a yard sale.</div>
          </div>
        </div>
      )}

      {reveal && reveal.ok && reveal.cards && (`,
)

fs.appendFileSync(
  'src/styles.css',
  `
/* Yard sale: the pile you bought — the peek finally turns into a card. */
.ys-pick{display:flex;gap:12px;align-items:center;margin-bottom:10px;min-width:0}
.ys-pick-art{width:92px;flex:0 0 92px;border-radius:8px}
.ys-pick-info{display:flex;flex-direction:column;gap:3px;min-width:0}
.ys-pick-info b{font-size:15px}
`,
)
console.log('ok src/styles.css (appended)')
