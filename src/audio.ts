// ---------------------------------------------------------------------------
// Ceremony sound — pure WebAudio synthesis, no audio assets.
//
// Three voices, all built from oscillators and filtered noise:
//   • crinkle  — foil friction while the tear line is being pulled
//   • ripChime — the foil giving way, then a two-note chime as the burst fires
//   • hitStinger — scaled to the pull's value: a ding for hits, a fanfare
//     for huge pulls, the full boom-and-arpeggio for a MASSIVE one
//
// The mute switch lives in localStorage ('tcglife.sound') so it survives
// reloads without a server round-trip; every entry point no-ops when muted.
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null
let muted: boolean | null = null // null = not yet read from storage

export function soundEnabled(): boolean {
  if (muted == null) muted = localStorage.getItem('tcglife.sound') === 'off'
  return !muted
}

export function setSoundEnabled(on: boolean): void {
  muted = !on
  localStorage.setItem('tcglife.sound', on ? 'on' : 'off')
}

function ensure(): AudioContext | null {
  if (!soundEnabled()) return null
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    try { ctx = new AC() } catch { return null }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return buf
}

interface BurstOpts { dur: number; f0: number; f1?: number; q?: number; gain: number; delay?: number }
/** A bandpassed noise swell — the raw material of foil. */
function burst(c: AudioContext, o: BurstOpts): void {
  const t0 = c.currentTime + (o.delay ?? 0)
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, o.dur)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(o.f0, t0)
  if (o.f1) bp.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur)
  bp.Q.value = o.q ?? 0.9
  const g = c.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(o.gain, t0 + Math.min(0.02, o.dur * 0.2))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur)
  src.connect(bp).connect(g).connect(c.destination)
  src.start(t0)
  src.stop(t0 + o.dur + 0.02)
}

function tone(c: AudioContext, freq: number, delay: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  const t0 = c.currentTime + delay
  const osc = c.createOscillator()
  osc.type = type
  osc.frequency.value = freq
  const g = c.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.03)
}

/** Foil friction while the tear line moves. intensity 0..1. */
export function crinkle(intensity = 0.5): void {
  const c = ensure()
  if (!c) return
  burst(c, { dur: 0.1 + intensity * 0.08, f0: 2200 + intensity * 1600, f1: 1100, q: 0.7, gain: 0.05 + intensity * 0.1 })
}

/** The rip gives way, then the chime rings under the spark burst. */
export function ripChime(): void {
  const c = ensure()
  if (!c) return
  // The rip: two fast overlapping noise sweeps, bright → dull.
  burst(c, { dur: 0.16, f0: 3400, f1: 1400, q: 0.8, gain: 0.22 })
  burst(c, { dur: 0.22, f0: 1600, f1: 500, q: 0.9, gain: 0.16, delay: 0.05 })
  // The chime: E5 + B5 (a ringing fifth), plus a G#6 sparkle a beat later.
  tone(c, 659.25, 0.12, 0.55, 0.1, 'triangle')
  tone(c, 987.77, 0.16, 0.6, 0.08, 'triangle')
  tone(c, 1661.22, 0.3, 0.4, 0.05, 'sine')
}

/** The card turns over — a short airy sweep that lands with a soft tick.
 * `big` gives epic+ pulls a deeper, wider sweep that lands heavier. */
export function flipSwish(big = false): void {
  const c = ensure()
  if (!c) return
  burst(c, { dur: big ? 0.32 : 0.18, f0: big ? 500 : 900, f1: big ? 4600 : 3400, q: 1.1, gain: big ? 0.09 : 0.05 })
  tone(c, big ? 261.63 : 587.33, big ? 0.26 : 0.14, 0.14, big ? 0.06 : 0.035, 'triangle')
}

/** Hit stinger scaled to the pull. Small hits ding; huge pulls erupt. */
export function hitStinger(value: number, isHit = false): void {
  const c = ensure()
  if (!c) return
  if (value >= 150) {
    // MASSIVE: the boom, then a rising arpeggio, then shimmer.
    tone(c, 110, 0, 0.5, 0.24)
    tone(c, 523.25, 0.08, 0.3, 0.1, 'triangle')
    tone(c, 659.25, 0.18, 0.3, 0.1, 'triangle')
    tone(c, 783.99, 0.28, 0.3, 0.1, 'triangle')
    tone(c, 1046.5, 0.38, 0.6, 0.12, 'triangle')
    burst(c, { dur: 0.5, f0: 6000, f1: 9000, q: 0.4, gain: 0.05, delay: 0.38 })
  } else if (value >= 60) {
    // HUGE: a softer boom and a two-note fanfare.
    tone(c, 146.83, 0, 0.35, 0.16)
    tone(c, 523.25, 0.06, 0.3, 0.1, 'triangle')
    tone(c, 783.99, 0.16, 0.5, 0.11, 'triangle')
  } else if (isHit || value >= 8) {
    // HIT: one bright ding.
    tone(c, 880, 0, 0.28, 0.09, 'sine')
    tone(c, 1318.51, 0.03, 0.2, 0.05, 'sine')
  }
  // Ordinary commons stay silent — the reveal stays calm.
}
