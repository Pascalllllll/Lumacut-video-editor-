/**
 * Beat finding on mono samples: an onset curve from the rise in band energy
 * (spectral flux), a tempo from its autocorrelation, then beats placed one
 * period apart, each nudged to the strongest onset nearby.
 */
export type Beats = { bpm: number; times: number[] }

const FRAME = 1024
const HOP = 256

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const xr = re[b]! * cr - im[b]! * ci
        const xi = re[b]! * ci + im[b]! * cr
        re[b] = re[a]! - xr
        im[b] = im[a]! - xi
        re[a] = re[a]! + xr
        im[a] = im[a]! + xi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

/** Onset strength per hop: the summed rise of log magnitude across frequency. */
export function onsetCurve(samples: Float32Array): Float32Array {
  const frames = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1)
  const out = new Float32Array(frames)
  const window = new Float64Array(FRAME)
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME)
  let prev = new Float64Array(FRAME / 2)
  const re = new Float64Array(FRAME)
  const im = new Float64Array(FRAME)
  for (let f = 0; f < frames; f++) {
    const off = f * HOP
    for (let i = 0; i < FRAME; i++) {
      re[i] = samples[off + i]! * window[i]!
      im[i] = 0
    }
    fft(re, im)
    const mag = new Float64Array(FRAME / 2)
    let flux = 0
    for (let k = 1; k < FRAME / 2; k++) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k]!, im[k]!))
      const d = mag[k]! - prev[k]!
      if (d > 0) flux += d
    }
    out[f] = flux
    prev = mag
  }
  // Remove the slow level so only sudden rises count.
  const smooth = new Float32Array(frames)
  const r = 8
  for (let f = 0; f < frames; f++) {
    let s = 0
    let n = 0
    for (let k = Math.max(0, f - r); k <= Math.min(frames - 1, f + r); k++) {
      s += out[k]!
      n++
    }
    smooth[f] = Math.max(0, out[f]! - s / n)
  }
  return smooth
}

/** Tempo in hops per beat, between 60 and 200 BPM, leaning towards 120. */
function period(onsets: Float32Array, hopsPerSecond: number): number {
  const minLag = Math.floor((hopsPerSecond * 60) / 200)
  const maxLag = Math.ceil((hopsPerSecond * 60) / 60)
  let best = minLag
  let bestScore = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0
    for (let i = lag; i < onsets.length; i++) s += onsets[i]! * onsets[i - lag]!
    s /= onsets.length - lag || 1
    const bpm = (60 * hopsPerSecond) / lag
    const weight = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.0, 2))
    if (s * weight > bestScore) {
      bestScore = s * weight
      best = lag
    }
  }
  // Refine to a fractional lag with a parabola through the neighbours.
  const score = (lag: number) => {
    let s = 0
    for (let i = lag; i < onsets.length; i++) s += onsets[i]! * onsets[i - lag]!
    return s / (onsets.length - lag || 1)
  }
  const a = score(best - 1)
  const b = score(best)
  const c = score(best + 1)
  const d = a - 2 * b + c
  return d < 0 ? best + (0.5 * (a - c)) / d : best
}

export function findBeats(samples: Float32Array, sampleRate: number): Beats {
  const onsets = onsetCurve(samples)
  const hopsPerSecond = sampleRate / HOP
  if (onsets.length < hopsPerSecond * 2) return { bpm: 0, times: [] }
  const p = period(onsets, hopsPerSecond)
  // The phase whose comb of beats collects the most onset strength.
  let bestPhase = 0
  let bestSum = -1
  for (let phase = 0; phase < p; phase++) {
    let s = 0
    for (let t = phase; t < onsets.length; t += p) s += onsets[Math.round(t)] ?? 0
    if (s > bestSum) {
      bestSum = s
      bestPhase = phase
    }
  }
  const times: number[] = []
  const slack = Math.max(1, Math.round(p * 0.08))
  for (let t = bestPhase; t < onsets.length; t += p) {
    let at = Math.round(t)
    let peak = onsets[at] ?? 0
    for (let k = at - slack; k <= at + slack; k++) {
      if (k >= 0 && k < onsets.length && onsets[k]! > peak) {
        peak = onsets[k]!
        at = k
      }
    }
    // The onset curve is centred on each analysis frame.
    times.push((at * HOP + FRAME / 2) / sampleRate)
  }
  return { bpm: Math.round(((60 * hopsPerSecond) / p) * 10) / 10, times }
}
