import { api } from '../api'

/**
 * Ask before a rip that would leave pulled cards behind.
 *
 * The shelf is a hard limit and the ceremony never mentioned it: with no room,
 * the cards that do not fit stay in the wrapper (lost under the refuse policy)
 * and the activity line only told you afterwards. Every way into a rip calls
 * this first, so the deal is on screen before the deck is cut. A failed preview
 * never blocks a rip — the server still has the last word.
 */
export async function confirmRip(
  productId: string,
  opts: { units?: number; packs?: number } = {},
): Promise<boolean> {
  try {
    const p = await api.ripPreview(productId, opts)
    if (!p || !p.warning) return true
    return confirm(`${p.warning}\n\nOpen anyway?`)
  } catch {
    return true
  }
}
