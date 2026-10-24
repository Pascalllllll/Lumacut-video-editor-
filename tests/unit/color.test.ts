import { describe, expect, it } from 'vitest'
import {
  applyPrimary,
  autoExposure,
  autoWhiteBalance,
  frameStats,
  matchColor,
  neutralPrimary,
  parseCube,
  rgbToWheel,
  sampleCurve,
  sampleHueCurve,
  wheelToRgb,
  writeCube,
} from '@engine/color'
import { bakeLook } from '@engine/looks'

describe('curves', () => {
  it('a straight curve is the identity', () => {
    const c = sampleCurve([0, 0, 1, 1])
    expect(c[0]).toBe(0)
    expect(c[128]).toBeCloseTo(128 / 255)
    expect(c[255]).toBe(1)
  })
  it('an S curve stays monotone and passes through its points', () => {
    const c = sampleCurve([0, 0, 0.25, 0.15, 0.75, 0.85, 1, 1])
    for (let i = 1; i < 256; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]! - 1e-6)
    expect(c[Math.round(0.25 * 255)]).toBeCloseTo(0.15, 1)
  })
  it('hue curves wrap around red', () => {
    const h = sampleHueCurve([0.0, 0.7, 0.5, 0.5])
    expect(h[0]).toBeCloseTo(h[255]!, 1)
    expect(sampleHueCurve([])[100]).toBe(0.5)
  })
})

describe('primary', () => {
  it('neutral settings change nothing', () => {
    const out = applyPrimary([0.2, 0.5, 0.8], neutralPrimary())
    expect(out[0]).toBeCloseTo(0.2)
    expect(out[1]).toBeCloseTo(0.5)
    expect(out[2]).toBeCloseTo(0.8)
  })
  it('lift raises blacks, gain scales whites, saturation 0 is gray', () => {
    const p = { ...neutralPrimary(), lift: [0, 0, 0, 0.1] as [number, number, number, number] }
    expect(applyPrimary([0, 0, 0], p)[0]).toBeCloseTo(0.1)
    const q = { ...neutralPrimary(), gain: [0, 0, 0, -0.5] as [number, number, number, number] }
    expect(applyPrimary([1, 1, 1], q)[0]).toBeCloseTo(0.5)
    const g = applyPrimary([1, 0, 0], { ...neutralPrimary(), saturation: 0 })
    expect(g[0]).toBeCloseTo(g[1])
  })
  it('wheel offsets are neutral on average and round-trip', () => {
    const c = wheelToRgb(0.3, -0.4)
    expect(c[0] + c[1] + c[2]).toBeCloseTo(0)
    const w = rgbToWheel(c)
    expect(w.x).toBeCloseTo(0.3)
    expect(w.y).toBeCloseTo(-0.4)
  })
})

describe('auto tools', () => {
  const frame = (r: number, g: number, b: number, n = 100) =>
    Uint8Array.from({ length: n * 3 }, (_, i) => [r, g, b][i % 3]!)
  it('white balance neutralises a blue cast', () => {
    const stats = frameStats(frame(100, 120, 160))
    const p = autoWhiteBalance(stats)
    const out = applyPrimary([100 / 255, 120 / 255, 160 / 255], p)
    expect(Math.abs(out[0] - out[2])).toBeLessThan(0.01)
  })
  it('exposure stretches a dim, flat frame', () => {
    const rgb = new Uint8Array(300)
    for (let i = 0; i < 100; i++) rgb.set([30 + i, 30 + i, 30 + i], i * 3)
    const p = autoExposure(frameStats(rgb))
    expect(applyPrimary([30 / 255, 30 / 255, 30 / 255], p)[0]).toBeLessThan(0.08)
    expect(applyPrimary([129 / 255, 129 / 255, 129 / 255], p)[0]).toBeGreaterThan(0.9)
  })
  it('match moves a shot toward the reference average', () => {
    const p = matchColor(frameStats(frame(80, 80, 80)), frameStats(frame(150, 120, 90)))
    const out = applyPrimary([80 / 255, 80 / 255, 80 / 255], p)
    expect(out[0] * 255).toBeCloseTo(150, 0)
    expect(out[2] * 255).toBeCloseTo(90, 0)
  })
})

describe('LUTs', () => {
  it('parses a .cube it wrote, and built-in looks bake to the right size', () => {
    const text = writeCube('Swap', 2, ([r, g, b]) => [b, g, r])
    const cube = parseCube(text)
    expect(cube.size).toBe(2)
    // Entry for red=1, green=0, blue=0 is index 1 (red changes fastest).
    expect(Array.from(cube.data.slice(3, 6))).toEqual([0, 0, 1])
    expect(bakeLook('mono', 17)).toHaveLength(17 ** 3 * 3)
  })
  it('refuses something that is not a LUT', () => {
    expect(() => parseCube('hello')).toThrow(/not a .cube LUT/)
  })
})
