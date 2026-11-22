import { create } from 'zustand'
import { api } from './api'
import { installClientClock } from './lib/clock'
import type { CardDetailResponse, GameStateResponse } from './types'

export type Toast = { id: number; text: string; kind: 'info' | 'good' | 'bad' }

/**
 * The weekly catalog delta runs on a server timer, so the client learns about
 * new releases through the state poll. Track the last-announced run in
 * localStorage so a single run is toasted exactly once, even across reloads
 * or multiple tabs — without permanently silencing future runs.
 */
const LAST_RELEASE_ANNOUNCED_KEY = 'tcglife.lastReleaseAnnouncedAt'

function announceNewReleases(state: GameStateResponse | null) {
  if (!state) return
  const delta = state.sync.delta
  const s = delta?.lastSummary
  if (!s || (s.newSets.length === 0 && s.updatedSets.length === 0)) return
  if (delta.running) return
  const announcedAt = localStorage.getItem(LAST_RELEASE_ANNOUNCED_KEY)
  if (announcedAt && announcedAt >= s.at) return
  localStorage.setItem(LAST_RELEASE_ANNOUNCED_KEY, s.at)
  const n = s.newSets.length
  const u = s.updatedSets.length
  const names = s.newSets.slice(0, 2).map((x) => x.name).join(' & ')
  useStore.getState().toast(
    `🆕 ${n > 0 ? `New release${n > 1 ? 's' : ''}: ${names}${n > 2 ? ` +${n - 2} more` : ''}` : `Catalog update: ${s.updatedSets[0].name}${u > 1 ? ` +${u - 1} more` : ''} gained new cards`}`,
    'good',
  )
}

/** How card grids render — persisted across sessions. */
export type Density = 'comfortable' | 'compact' | 'list'
const DENSITY_KEY = 'tcglife.density'
export function loadDensity(): Density {
  const v = localStorage.getItem(DENSITY_KEY)
  return v === 'compact' || v === 'list' ? v : 'comfortable'
}

/**
 * Pack Shop → ceremony handoff: "BUY 1 & OPEN" opens the pack server-side
 * (which writes pull history — records can fall right there) and hands the
 * opened session to Pack Opening so the reveal runs through the full
 * ceremony, record chases included.
 */
export type OpeningHandoff = { session: import('./types').OpenSession; productId: string }
let openingHandoff: OpeningHandoff | null = null
export function setOpeningHandoff(h: OpeningHandoff | null) { openingHandoff = h }
export function takeOpeningHandoff(): OpeningHandoff | null {
  const h = openingHandoff
  openingHandoff = null
  return h
}

/** How a card list is laid out — one flat grid, or sections grouped by set. */
export type BrowseMode = 'flat' | 'byset'
const BROWSE_KEY = 'tcglife.browse'
export function loadBrowseMode(): BrowseMode {
  return localStorage.getItem(BROWSE_KEY) === 'byset' ? 'byset' : 'flat'
}

/**
 * Advanced card foil effects: pointer tilt, iridescence and embossed relief. The
 * card's basic paper is always rendered by FoilOverlay; this switch only decides
 * whether the advanced treatment joins it. Persisted per browser.
 */
const FOIL_KEY = 'tcglife.foil'
function loadFoil(): boolean {
  return localStorage.getItem(FOIL_KEY) === 'on'
}

/** Chrome darkness. Dark is the default; light is the paper TCG look. */
export type Theme = 'dark' | 'light'
const THEME_KEY = 'tcglife.theme'
function loadTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' ? 'light' : 'dark'
}
/** Applied at store-creation so the very first paint is already correct. */
function initTheme(): Theme {
  const t = loadTheme()
  document.documentElement.dataset.theme = t
  return t
}

type Store = {
  state: GameStateResponse | null
  toasts: Toast[]
  theme: Theme
  setTheme: (t: Theme) => void
  /** Advanced foil treatment. Basic paper rendering is independent of this. */
  foil: boolean
  setFoil: (v: boolean) => void
  density: Density
  setDensity: (d: Density) => void
  browse: BrowseMode
  setBrowse: (b: BrowseMode) => void
  detailCardId: string | null
  detail: CardDetailResponse | null
  detailLoading: boolean
  /** One-shot: Home's PSA-rush shortcut asks Grading to pre-filter to rush-eligible cards. */
  rushShortcut: boolean
  setRushShortcut: (v: boolean) => void
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
  theme: initTheme(),
  setTheme: (t) => {
    localStorage.setItem(THEME_KEY, t)
    document.documentElement.dataset.theme = t
    set({ theme: t })
  },
  foil: loadFoil(),
  setFoil: (v) => {
    localStorage.setItem(FOIL_KEY, v ? 'on' : 'off')
    set({ foil: v })
  },
  density: loadDensity(),
  setDensity: (d) => {
    localStorage.setItem(DENSITY_KEY, d)
    set({ density: d })
  },
  browse: loadBrowseMode(),
  setBrowse: (b) => {
    localStorage.setItem(BROWSE_KEY, b)
    set({ browse: b })
  },
  detailCardId: null as string | null,
  detail: null,
  detailLoading: false,
  rushShortcut: false,
  setRushShortcut: (v) => set({ rushShortcut: v }),

  refreshState: async () => {
    try {
      const s = await api.state()
      // A day pass leaves this save's clock ahead of the machine's; every
      // countdown here is measured against the server's timestamps, so the page
      // adopts the same shift before it renders them.
      installClientClock(s.day.offsetMs ?? 0)
      set({ state: s })
      announceNewReleases(s)
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
