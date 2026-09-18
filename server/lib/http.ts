let lastRequestAt = 0
const MIN_INTERVAL_MS = 150 // ~6.6 req/s: well under the API's no-key limit of 30/min

export async function fetchJson<T>(url: string, headers: Record<string, string> = {}, opts: { attempts?: number; timeoutMs?: number } = {}): Promise<T> {
  const attempts = opts.attempts ?? 5
  const timeoutMs = opts.timeoutMs ?? 30000
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastRequestAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { headers, signal: controller.signal })
      if (res.status === 429 || res.status >= 500) {
        if (attempt === attempts) throw new Error(`HTTP ${res.status} for ${url}`)
        const retryAfter = Number(res.headers.get('retry-after'))
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(30000, 1000 * 2 ** attempt)
        console.warn(`[http] ${res.status} for ${url} — retry ${attempt}/${attempts} in ${Math.round(delay / 1000)}s`)
        await new Promise((r) => setTimeout(r, delay))
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return (await res.json()) as T
    } catch (err: unknown) {
      if (attempt === attempts) throw err
      await new Promise((r) => setTimeout(r, Math.min(10000, 500 * 2 ** attempt)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error('unreachable')
}
