import { create } from 'zustand'
import { api } from './api'
import type { CardDetailResponse, GameStateResponse } from './types'

export type Toast = { id: number; text: string; kind: 'info' | 'good' | 'bad' }

/** How card grids render — persisted across sessions. */
export type Density = 'comfortable' | 'compact' | 'list'
const DENSITY_KEY = 'tcglife.density'
export function loadDensity(): Density {
  const v = localStorage.getItem(DENSITY_KEY)
  return v === 'compact' || v === 'list' ? v : 'comfortable'
}

type Store = {
  state: GameStateResponse | null
  toasts: Toast[]
  density: Density
  setDensity: (d: Density) => void
  detailCardId: string | null
  detail: CardDetailResponse | null
  detailLoading: boolean
  refreshState: () => Promise<void>
  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void
  openCard: (cardId: string) => Promise<void>
  closeCard: () => void
  refreshDetail: () => Promise<void>
}

let toastId = 0

export const useStore = create<Store>((set, get) => ({
  state: null,
  toasts: [],
  density: loadDensity(),
  setDensity: (d) => {
    localStorage.setItem(DENSITY_KEY, d)
    set({ density: d })
  },
  detailCardId: null as string | null,
  detail: null,
  detailLoading: false,

  refreshState: async () => {
    try {
      const s = await api.state()
      set({ state: s })
    } catch {
      /* server offline; keep last state */
    }
  },

  toast: (text, kind = 'info') => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 4200)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  openCard: async (cardId) => {
    set({ detailCardId: cardId, detail: null, detailLoading: true })
    try {
      const d = await api.cardDetail(cardId)
      if (get().detailCardId === cardId) set({ detail: d, detailLoading: false })
    } catch {
      if (get().detailCardId === cardId) set({ detailLoading: false })
    }
  },

  closeCard: () => set({ detailCardId: null, detail: null, detailLoading: false }),

  refreshDetail: async () => {
    const id = get().detailCardId
    if (!id) return
    try {
      const d = await api.cardDetail(id)
      set({ detail: d })
    } catch { /* keep old */ }
  },
}))
