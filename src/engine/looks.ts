import { luma, type RGB } from './color'

const mix = (a: number, b: number, k: number) => a + (b - a) * k
const smooth = (x: number) => x * x * (3 - 2 * x)
const clamp = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Built-in looks, written as color functions and baked into LUTs when used.
 * Being code, they ship with the app under its own license.
 */
export const LOOKS: Record<string, (c: RGB) => RGB> = {
  warm: ([r, g, b]) => [clamp(r * 1.06 + 0.02), clamp(g * 1.01), clamp(b * 0.9)],
  cool: ([r, g, b]) => [clamp(r * 0.92), clamp(g * 1.0), clamp(b * 1.08 + 0.02)],
  'teal-orange': (c) => {
    // Shadows lean teal, highlights lean orange; skin tones (mid orange) stay put.
    const y = luma(c)
    const k = smooth(y)
    return [
      clamp(c[0] + mix(-0.05, 0.06, k)),
      clamp(c[1] + mix(0.02, 0.01, k)),
      clamp(c[2] + mix(0.06, -0.07, k)),
    ]
  },
  'film-fade': (c) =>
    c.map((v) => clamp(0.06 + v * 0.86)).map((v, i) => clamp(v + (i === 2 ? 0.01 : 0))) as RGB,
  'bleach-bypass': (c) => {
    const y = luma(c)
    const desat = c.map((v) => mix(v, y, 0.55))
    return desat.map((v) => clamp(smooth(v) * 1.05 - 0.02)) as RGB
  },
  mono: (c) => {
    const y = luma(c)
    return [y, y, y]
  },
  'high-contrast': (c) => c.map((v) => clamp(smooth(smooth(v) * 0.6 + v * 0.4))) as RGB,
  vintage: (c) => {
    const y = luma(c)
    const sepia: RGB = [y * 1.07 + 0.04, y * 0.95 + 0.02, y * 0.78]
    return sepia.map((v, i) => clamp(mix(c[i]!, v, 0.6) * 0.92 + 0.04)) as RGB
  },
}

export const LOOK_IDS = Object.keys(LOOKS)

/** A look baked into LUT data (red fastest), `size` points per side. */
export function bakeLook(id: string, size = 33): Float32Array {
  const fn = LOOKS[id]
  if (!fn) throw new Error(`Unknown look ${id}`)
  const data = new Float32Array(size ** 3 * 3)
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const o = ((b * size + g) * size + r) * 3
        const out = fn([r / (size - 1), g / (size - 1), b / (size - 1)])
        data[o] = out[0]
        data[o + 1] = out[1]
        data[o + 2] = out[2]
      }
  return data
}
