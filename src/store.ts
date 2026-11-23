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

/**
 * Chrome palettes. Dark is the default; light is the paper TCG look. Ember and
 * Tide are a warm dark and a deep-sea dark; Forest, Nebula and Graphite are a
 * green, a violet and a neutral dark. Daylight and Sakura are the paper looks,
 * with Frost and Parchment beside them. A theme is a colour swap only — the CSS
 * reads the same tokens for every palette.
 * `light` marks the palettes that count as light so the handful of light-only
 * rules (the What's New card) can follow without naming a palette: the store
 * stamps data-light="1" on <html> alongside data-theme.
 */
export type Theme = 'dark' | 'light' | 'ember' | 'tide' | 'sakura' | 'forest' | 'nebula' | 'graphite' | 'frost' | 'parchment'
export type ThemeInfo = { id: Theme; label: string; blurb: string; light: boolean; swatch: string[] }
export const THEMES: ThemeInfo[] = [
  { id: 'dark', label: 'Midnight', blurb: 'the night chrome: card art carries the colour.', light: false, swatch: ['#0d1230', '#1a2247', '#6f9bff'] },
  { id: 'light', label: 'Daylight', blurb: 'the paper TCG look: white cards on a blue-checked playmat.', light: true, swatch: ['#e8f0fd', '#ffffff', '#2e6ad1'] },
  { id: 'ember', label: 'Ember', blurb: 'a warm dark: charcoal shelves under amber lamps.', light: false, swatch: ['#1a1110', '#2a1c1a', '#ffb066'] },
  { id: 'tide', label: 'Tide', blurb: 'a deep-sea dark: teal boards under a cold shop light.', light: false, swatch: ['#071c22', '#0f2c33', '#5fe0cf'] },
  { id: 'forest', label: 'Forest', blurb: 'a green dark: pine shelves, moss boards, a lantern glow.', light: false, swatch: ['#0b1a12', '#14301f', '#6fe0a0'] },
  { id: 'nebula', label: 'Nebula', blurb: 'a violet dark: deep-space boards with a lilac shine.', light: false, swatch: ['#120d26', '#1e1740', '#b39dff'] },
  { id: 'graphite', label: 'Graphite', blurb: 'a neutral dark: gunmetal chrome, no tint in the boards.', light: false, swatch: ['#101012', '#1b1b1f', '#8fa8d8'] },
  { id: 'sakura', label: 'Sakura', blurb: 'a warm light: pink shelves, plum ink, white cards.', light: true, swatch: ['#fdf1f3', '#ffffff', '#c0437a'] },
  { id: 'frost', label: 'Frost', blurb: 'a cool light: ice-blue boards, steel ink, white cards.', light: true, swatch: ['#eaf3f7', '#ffffff', '#0f7a9e'] },
  { id: 'parchment', label: 'Parchment', blurb: 'a warm light: cream paper, sepia ink, an old-shop feel.', light: true, swatch: ['#f6efe2', '#fffdf8', '#a86a12'] },
]
export function isLightTheme(t: Theme): boolean {
  return THEMES.find((x) => x.id === t)?.light ?? false
}
const THEME_KEY = 'tcglife.theme'
function loadTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY)
  return THEMES.some((t) => t.id === v) ? (v as Theme) : 'dark'
}
/** The palette attribute, plus the light marker some CSS keys off. */
function applyTheme(t: Theme) {
  const el = document.documentElement
  el.dataset.theme = t
  if (isLightTheme(t)) el.dataset.light = '1'
  else delete el.dataset.light
}
/** Applied at store-creation so the very first paint is already correct. */
function initTheme(): Theme {
  const t = loadTheme()
  applyTheme(t)
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
    applyTheme(t)
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
