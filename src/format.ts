// Formatting helpers the app shell needs. They live apart from components.tsx
// on purpose: components pulls the card image + foil renderer, and importing it
// from App would put that whole system back in the entry chunk (roadmap 16.0).

export function fmtUsd(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n == null) return '—'
  if (opts.compact && Math.abs(n) >= 10000) {
    return `$${(n / 1000).toFixed(1)}k`
  }
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
