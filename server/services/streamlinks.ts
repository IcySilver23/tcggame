// Tiny link registry so streaming.ts can settle breaks without a static
// import cycle (breaks.ts imports streaming helpers). breaks.ts registers its
// settler at module load; server/index.ts imports both, so registration always
// runs at boot.
export type BreakSettleResult = {
  breakId: number
  spotsSold: number
  spotsTotal: number
  gross: number
  productCost: number
  net: number
  houseCards: number
  best: { name: string; value: number; team: string | null; holder: string | null } | null
}

type SettleFn = (streamId: number) => BreakSettleResult | null
type LinkFn = (streamId: number) => unknown

let settler: SettleFn | null = null
let linker: LinkFn | null = null

export function registerBreakSettler(fn: SettleFn) {
  settler = fn
}

export function registerBreakLinker(fn: LinkFn) {
  linker = fn
}

export function settleBreakFor(streamId: number): BreakSettleResult | null {
  return settler ? settler(streamId) : null
}

/** Synchronously bind a pending break to a starting stream (or null). */
export function linkBreakFor(streamId: number): unknown {
  return linker ? linker(streamId) : null
}
