import type { Primary } from './model'

export type RGB = [number, number, number]

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Rec. 709 luma weights; the grade and the scopes use the same ones. */
export const LUMA: RGB = [0.2126, 0.7152, 0.0722]
export const luma = (c: RGB) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2]

/**
 * Samples a curve given as x, y pairs with a monotone cubic (Fritsch–Carlson),
 * so the curve never overshoots between points and stays smooth.
 */
export function sampleCurve(points: number[], n = 256): Float32Array {
  const pts: [number, number][] = []
  for (let i = 0; i + 1 < points.length; i += 2) pts.push([points[i]!, points[i + 1]!])
  pts.sort((a, b) => a[0] - b[0])
  const out = new Float32Array(n)
  if (pts.length === 0) {
    for (let i = 0; i < n; i++) out[i] = i / (n - 1)
    return out
  }
  if (pts.length === 1) return out.fill(pts[0]![1])
  const m = pts.length
  const d: number[] = []
  const slope: number[] = []
  for (let i = 0; i < m - 1; i++) {
    const dx = pts[i + 1]![0] - pts[i]![0] || 1e-6
    d.push((pts[i + 1]![1] - pts[i]![1]) / dx)
  }
  slope.push(d[0]!)
  for (let i = 1; i < m - 1; i++) slope.push(d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2)
  slope.push(d[m - 2]!)
  for (let i = 0; i < m - 1; i++) {
    if (d[i] === 0) {
      slope[i] = 0
      slope[i + 1] = 0
      continue
    }
    const a = slope[i]! / d[i]!
    const b = slope[i + 1]! / d[i]!
    const h = a * a + b * b
    if (h > 9) {
      const tau = 3 / Math.sqrt(h)
      slope[i] = tau * a * d[i]!
      slope[i + 1] = tau * b * d[i]!
    }
  }
  for (let k = 0; k < n; k++) {
    const x = k / (n - 1)
    let i = 0
    while (i < m - 2 && x > pts[i + 1]![0]) i++
    const [x0, y0] = pts[i]!
    const [x1, y1] = pts[i + 1]!
    if (x <= x0) {
      out[k] = y0
      continue
    }
    if (x >= x1 && i === m - 2) {
      out[k] = y1
      continue
    }
    const h = x1 - x0 || 1e-6
    const t = (x - x0) / h
    const t2 = t * t
    const t3 = t2 * t
    out[k] =
      (2 * t3 - 3 * t2 + 1) * y0 +
      (t3 - 2 * t2 + t) * h * slope[i]! +
      (-2 * t3 + 3 * t2) * y1 +
      (t3 - t2) * h * slope[i + 1]!
  }
  return out
}

/** A hue curve (hue, y pairs where 0.5 is no change) sampled around the color wheel, wrapping at the ends. */
export function sampleHueCurve(points: number[], n = 256): Float32Array {
  if (points.length < 2) return new Float32Array(n).fill(0.5)
  const pts: [number, number][] = []
  for (let i = 0; i + 1 < points.length; i += 2) pts.push([points[i]!, points[i + 1]!])
  pts.sort((a, b) => a[0] - b[0])
  // Repeat the points one turn either side so the curve is continuous through red.
  const wrapped = [
    ...pts.map(([x, y]) => [x - 1, y]),
    ...pts,
    ...pts.map(([x, y]) => [x + 1, y]),
  ].flat()
  const wide = sampleCurve(
    wrapped.map((v, i) => (i % 2 === 0 ? (v + 1) / 3 : v)),
    n * 3,
  )
  return wide.slice(n, n * 2)
}

/** A colour wheel puck (x, y in -1..1) to channel offsets that keep brightness. */
export function wheelToRgb(x: number, y: number): RGB {
  const angle = Math.atan2(y, x)
  const amount = Math.min(1, Math.hypot(x, y))
  // Hue 0 (red) points right, as on most grading wheels.
  const r = Math.cos(angle)
  const g = Math.cos(angle - (2 * Math.PI) / 3)
  const b = Math.cos(angle + (2 * Math.PI) / 3)
  return [r * amount, g * amount, b * amount]
}

export function rgbToWheel(c: RGB): { x: number; y: number } {
  const mean = (c[0] + c[1] + c[2]) / 3
  const r = c[0] - mean
  const g = c[1] - mean
  const b = c[2] - mean
  // Inverse of wheelToRgb for zero-mean offsets.
  const x = (2 / 3) * (r - 0.5 * g - 0.5 * b)
  const y = (2 / 3) * ((Math.sqrt(3) / 2) * (g - b))
  return { x, y }
}

/** White balance as channel gains: temperature trades blue for red, tint trades green for magenta. */
export function balanceGains(temperature: number, tint: number): RGB {
  return [1 + temperature * 0.3 + tint * 0.1, 1 - tint * 0.25, 1 - temperature * 0.3 + tint * 0.1]
}

/**
 * The primary correction on one straight-alpha color, 0 to 1. The shader in
 * the compositor does the same steps; tests and auto tools use this copy.
 */
export function applyPrimary(c: RGB, p: Primary): RGB {
  const wb = balanceGains(p.temperature, p.tint)
  const ex = 2 ** p.exposure
  const out: number[] = []
  for (let i = 0; i < 3; i++) {
    let v = c[i]! * ex * wb[i]!
    v = v * (1 + p.gain[i]! + p.gain[3])
    v = v + (p.lift[i]! + p.lift[3]) * (1 - v)
    v = Math.pow(Math.max(v, 0), 1 / Math.max(1 + p.gamma[i]! + p.gamma[3], 0.05))
    v = v + p.offset[i]! + p.offset[3]
    v = (v - p.pivot) * p.contrast + p.pivot
    out.push(v)
  }
  const y = luma(out as RGB)
  return out.map((v) => clamp01(y + (v - y) * p.saturation)) as RGB
}

export type FrameStats = { mean: RGB; std: RGB; low: number; high: number }

/** Mean and spread per channel, plus the 1st and 99th percentile of luma, from RGB bytes. */
export function frameStats(rgb: Uint8Array): FrameStats {
  const n = Math.floor(rgb.length / 3)
  const sum: RGB = [0, 0, 0]
  const sq: RGB = [0, 0, 0]
  const hist = new Uint32Array(256)
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3]! / 255
    const g = rgb[i * 3 + 1]! / 255
    const b = rgb[i * 3 + 2]! / 255
    sum[0] += r
    sum[1] += g
    sum[2] += b
    sq[0] += r * r
    sq[1] += g * g
    sq[2] += b * b
    hist[Math.round(luma([r, g, b]) * 255)]!++
  }
  const mean = sum.map((s) => s / Math.max(1, n)) as RGB
  const std = sq.map((s, i) => Math.sqrt(Math.max(0, s / Math.max(1, n) - mean[i]! ** 2))) as RGB
  const at = (q: number) => {
    let acc = 0
    for (let i = 0; i < 256; i++) {
      acc += hist[i]!
      if (acc >= q * n) return i / 255
    }
    return 1
  }
  return { mean, std, low: at(0.01), high: at(0.99) }
}

export const neutralPrimary = (): Primary => ({
  lift: [0, 0, 0, 0],
  gamma: [0, 0, 0, 0],
  gain: [0, 0, 0, 0],
  offset: [0, 0, 0, 0],
  exposure: 0,
  contrast: 1,
  pivot: 0.435,
  saturation: 1,
  temperature: 0,
  tint: 0,
})

/** Gray-world white balance: per-channel gains that make the average color neutral. */
export function autoWhiteBalance(stats: FrameStats, base: Primary = neutralPrimary()): Primary {
  const m = (stats.mean[0] + stats.mean[1] + stats.mean[2]) / 3
  const gain = stats.mean.map((c) => (c > 1e-3 ? m / c - 1 : 0))
  return { ...base, gain: [gain[0]!, gain[1]!, gain[2]!, base.gain[3]] }
}

/** Exposure and contrast that stretch the 1st–99th percentile of brightness to a full, safe range. */
export function autoExposure(stats: FrameStats, base: Primary = neutralPrimary()): Primary {
  const lo = stats.low
  const hi = Math.max(stats.high, lo + 0.05)
  // Map lo to 0.03 and hi to 0.95 with gain (as master) and offset.
  const k = (0.95 - 0.03) / (hi - lo)
  return {
    ...base,
    gain: [base.gain[0], base.gain[1], base.gain[2], k - 1],
    offset: [base.offset[0], base.offset[1], base.offset[2], 0.03 - lo * k],
  }
}

/**
 * Matches one shot to another by moving each channel's mean and spread to the
 * reference's (a simple Reinhard transfer in RGB), as gain and offset.
 */
export function matchColor(
  target: FrameStats,
  reference: FrameStats,
  base: Primary = neutralPrimary(),
): Primary {
  const gain: number[] = []
  const offset: number[] = []
  for (let i = 0; i < 3; i++) {
    const k =
      target.std[i]! > 1e-3 ? Math.min(3, Math.max(0.33, reference.std[i]! / target.std[i]!)) : 1
    gain.push(k - 1)
    offset.push(reference.mean[i]! - target.mean[i]! * k)
  }
  return {
    ...base,
    gain: [gain[0]!, gain[1]!, gain[2]!, 0],
    offset: [offset[0]!, offset[1]!, offset[2]!, 0],
  }
}

export type Cube = { size: number; data: Float32Array; domainMin: RGB; domainMax: RGB }

/** Reads a .cube LUT (3D, or 1D expanded to 3D). Values are listed red-fastest, as the format defines. */
export function parseCube(text: string): Cube {
  let size3 = 0
  let size1 = 0
  let domainMin: RGB = [0, 0, 0]
  let domainMax: RGB = [1, 1, 1]
  const values: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [key, ...rest] = line.split(/\s+/)
    if (key === 'LUT_3D_SIZE') size3 = Number(rest[0])
    else if (key === 'LUT_1D_SIZE') size1 = Number(rest[0])
    else if (key === 'DOMAIN_MIN') domainMin = rest.map(Number) as RGB
    else if (key === 'DOMAIN_MAX') domainMax = rest.map(Number) as RGB
    else if (key === 'TITLE' || key?.startsWith('LUT_')) continue
    else if (/^[-+.\d]/.test(key ?? '')) values.push(Number(key), Number(rest[0]), Number(rest[1]))
  }
  if (size3 >= 2) {
    if (values.length !== size3 ** 3 * 3)
      throw new Error(`The LUT says it has ${size3}³ entries but holds ${values.length / 3}.`)
    return { size: size3, data: Float32Array.from(values), domainMin, domainMax }
  }
  if (size1 >= 2) {
    if (values.length !== size1 * 3)
      throw new Error(`The LUT says it has ${size1} entries but holds ${values.length / 3}.`)
    // Expand to a 33-point 3D LUT so both kinds draw the same way.
    const n = 33
    const data = new Float32Array(n * n * n * 3)
    const look = (ch: number, v: number) => {
      const x = v * (size1 - 1)
      const i = Math.min(size1 - 2, Math.floor(x))
      const f = x - i
      return values[i * 3 + ch]! * (1 - f) + values[(i + 1) * 3 + ch]! * f
    }
    for (let b = 0; b < n; b++)
      for (let g = 0; g < n; g++)
        for (let r = 0; r < n; r++) {
          const o = ((b * n + g) * n + r) * 3
          data[o] = look(0, r / (n - 1))
          data[o + 1] = look(1, g / (n - 1))
          data[o + 2] = look(2, b / (n - 1))
        }
    return { size: n, data, domainMin, domainMax }
  }
  throw new Error('That file has no LUT_3D_SIZE or LUT_1D_SIZE line, so it is not a .cube LUT.')
}

/** Writes a 3D LUT as .cube text. */
export function writeCube(title: string, size: number, fn: (c: RGB) => RGB): string {
  const lines = [`TITLE "${title}"`, `LUT_3D_SIZE ${size}`]
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const out = fn([r / (size - 1), g / (size - 1), b / (size - 1)])
        lines.push(out.map((v) => clamp01(v).toFixed(6)).join(' '))
      }
  return `${lines.join('\n')}\n`
}
