import { applyPrimary, sampleCurve, sampleHueCurve, type Cube, type RGB } from './color'
import type { GradeLayer } from './model'

/*
 * The grade shader (src/render/shaders.ts, GRADE) on the CPU, for baking a
 * clip's grade into a LUT file. Same order and formulas: each layer's result
 * is limited by its qualifier and blended by its mix.
 */

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
const fract = (v: number) => v - Math.floor(v)
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

function rgb2hsl([r, g, b]: RGB): RGB {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  const d = mx - mn
  let h = 0
  let s = 0
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return [h, s, l]
}

function hue2rgb(p: number, q: number, t: number) {
  t = fract(t)
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 0.5) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hsl2rgb([h, s, l]: RGB): RGB {
  if (s < 1e-6) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)]
}

/** Reads a 256-entry table the way the shader's linear texture lookup does. */
function table(t: Float32Array, v: number) {
  const x = clamp(v) * 255
  const i = Math.min(254, Math.floor(x))
  const f = x - i
  return t[i]! * (1 - f) + t[i + 1]! * f
}

function sampleCube(cube: Cube, c: RGB): RGB {
  const n = cube.size
  const p = c.map(
    (v, k) => clamp((v - cube.domainMin[k]!) / (cube.domainMax[k]! - cube.domainMin[k]!)) * (n - 1),
  )
  const i0 = p.map((v) => Math.min(n - 2, Math.floor(v)))
  const f = p.map((v, k) => v - i0[k]!)
  const at = (r: number, g: number, b: number, ch: number) =>
    cube.data[((b * n + g) * n + r) * 3 + ch]!
  const out: number[] = []
  for (let ch = 0; ch < 3; ch++) {
    let v = 0
    for (let dz = 0; dz < 2; dz++)
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const w = (dx ? f[0]! : 1 - f[0]!) * (dy ? f[1]! : 1 - f[1]!) * (dz ? f[2]! : 1 - f[2]!)
          v += w * at(i0[0]! + dx, i0[1]! + dy, i0[2]! + dz, ch)
        }
    out.push(v)
  }
  return out as RGB
}

type Prepared = {
  layer: GradeLayer
  channels?: Float32Array[]
  hue?: Float32Array[] | null
  cube?: Cube | null
}

function prepare(layers: GradeLayer[], lut: (source: string) => Cube | null): Prepared[] {
  return layers
    .filter((l) => l.enabled)
    .map((layer) => {
      if (layer.kind === 'curves' && layer.curves) {
        const c = layer.curves
        const master = sampleCurve(c.master)
        const channels = [c.red, c.green, c.blue].map((pts) => {
          const curve = sampleCurve(pts)
          return Float32Array.from(master, (m) => table(curve, m))
        })
        const hasHue = c.hueHue.length + c.hueSat.length + c.hueLuma.length > 0
        return {
          layer,
          channels,
          hue: hasHue
            ? [sampleHueCurve(c.hueHue), sampleHueCurve(c.hueSat), sampleHueCurve(c.hueLuma)]
            : null,
        }
      }
      if (layer.kind === 'lut' && layer.lut) return { layer, cube: lut(layer.lut.source) }
      return { layer }
    })
}

function applyLayer(p: Prepared, c: RGB): RGB {
  const { layer } = p
  let g: RGB = c
  if (layer.kind === 'primary' && layer.primary) g = applyPrimary(c, layer.primary)
  else if (layer.kind === 'curves' && p.channels) {
    g = [table(p.channels[0]!, c[0]), table(p.channels[1]!, c[1]), table(p.channels[2]!, c[2])]
    if (p.hue) {
      const h = rgb2hsl(g)
      const k = p.hue.map((t) => table(t, h[0]))
      h[0] = fract(h[0] + (k[0]! - 0.5))
      h[1] = clamp(h[1] * k[1]! * 2)
      h[2] = clamp(h[2] + (k[2]! - 0.5) * 0.5)
      g = hsl2rgb(h)
    }
  } else if (layer.kind === 'lut' && p.cube && layer.lut) {
    const looked = sampleCube(p.cube, c)
    const k = layer.lut.intensity
    g = c.map((v, i) => v + (looked[i]! - v) * k) as RGB
  } else return c
  let key = 1
  const q = layer.qualifier
  if (q) {
    const [h, s, l] = rgb2hsl(c)
    const dh = Math.abs(fract(h - q.hueCenter + 0.5) - 0.5)
    const soft = Math.max(q.softness, 1e-4)
    const band = (v: number, lo: number, hi: number) =>
      smoothstep(lo - soft, lo, v) * (1 - smoothstep(hi, hi + soft, v))
    key =
      (1 - smoothstep(q.hueWidth / 2, q.hueWidth / 2 + soft, dh)) *
      band(s, q.satLow, q.satHigh) *
      band(l, q.lumLow, q.lumHigh)
    if (q.invert) key = 1 - key
  }
  const m = key * layer.mix
  return c.map((v, i) => v + (g[i]! - v) * m) as RGB
}

/** A function that grades one colour the way the clip's grade stack does. */
export function gradeFunction(
  layers: GradeLayer[],
  lut: (source: string) => Cube | null,
): (c: RGB) => RGB {
  const prepared = prepare(layers, lut)
  return (c) => prepared.reduce((acc, p) => applyLayer(p, acc), c)
}
