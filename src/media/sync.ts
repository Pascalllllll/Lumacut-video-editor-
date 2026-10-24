/**
 * Finds how far `other` is shifted against `reference` by cross-correlating
 * their loudness envelopes (peak levels at a fixed rate). Returns the offset
 * in samples of the envelope: a positive value means `other` started
 * recording later, so its content appears earlier in its own file.
 */
export function envelopeOffset(
  reference: ArrayLike<number>,
  other: ArrayLike<number>,
  maxLag: number,
): { lag: number; score: number } {
  const a = normalise(reference)
  const b = normalise(other)
  let best = { lag: 0, score: -Infinity }
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    // Compare reference[i] with other[i - lag].
    const start = Math.max(0, lag)
    const end = Math.min(a.length, b.length + lag)
    const n = end - start
    if (n < Math.min(a.length, b.length) * 0.2 || n < 50) continue
    let sum = 0
    for (let i = start; i < end; i++) sum += a[i]! * b[i - lag]!
    const score = sum / n
    if (score > best.score) best = { lag, score }
  }
  return best
}

function normalise(values: ArrayLike<number>): Float32Array {
  const out = new Float32Array(values.length)
  let mean = 0
  for (let i = 0; i < values.length; i++) mean += values[i]!
  mean /= values.length || 1
  let variance = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]! - mean
    out[i] = v
    variance += v * v
  }
  const sd = Math.sqrt(variance / (values.length || 1)) || 1
  for (let i = 0; i < out.length; i++) out[i]! /= sd
  return out
}
