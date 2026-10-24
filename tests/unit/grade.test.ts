import { describe, expect, it } from 'vitest'
import { applyPrimary, neutralPrimary, parseCube, writeCube, type RGB } from '@engine/color'
import { gradeFunction } from '@engine/grade'
import { bakeLook } from '@engine/looks'
import { curvesSchema, qualifierSchema, type GradeLayer } from '@engine/model'

const layer = (patch: Partial<GradeLayer>): GradeLayer => ({
  id: 'g',
  kind: 'primary',
  enabled: true,
  mix: 1,
  qualifier: null,
  primary: null,
  curves: null,
  lut: null,
  ...patch,
})

describe('baking a grade', () => {
  const samples: RGB[] = [
    [0.1, 0.2, 0.3],
    [0.5, 0.5, 0.5],
    [0.9, 0.4, 0.1],
  ]

  it('an empty stack changes nothing; a primary layer matches the primary math', () => {
    for (const c of samples) expect(gradeFunction([], () => null)(c)).toEqual(c)
    const p = {
      ...neutralPrimary(),
      gain: [0.1, 0, -0.1, 0.05] as [number, number, number, number],
      saturation: 1.3,
    }
    const f = gradeFunction([layer({ primary: p })], () => null)
    for (const c of samples) expect(f(c)).toEqual(applyPrimary(c, p))
  })

  it('half mix lands halfway; a disabled layer does nothing', () => {
    const p = { ...neutralPrimary(), exposure: 1 }
    const full = gradeFunction([layer({ primary: p })], () => null)([0.2, 0.2, 0.2])
    const half = gradeFunction([layer({ primary: p, mix: 0.5 })], () => null)([0.2, 0.2, 0.2])
    expect(half[0]).toBeCloseTo((0.2 + full[0]) / 2, 6)
    expect(
      gradeFunction([layer({ primary: p, enabled: false })], () => null)([0.2, 0.2, 0.2]),
    ).toEqual([0.2, 0.2, 0.2])
  })

  it('curves and LUTs read back as the same colours', () => {
    const curves = curvesSchema.parse({ master: [0, 0.1, 1, 0.9] })
    const f = gradeFunction([layer({ kind: 'curves', curves })], () => null)
    expect(f([0, 0, 0])[0]).toBeCloseTo(0.1, 2)
    expect(f([1, 1, 1])[0]).toBeCloseTo(0.9, 2)

    const look = {
      size: 33,
      data: bakeLook('warm', 33),
      domainMin: [0, 0, 0] as RGB,
      domainMax: [1, 1, 1] as RGB,
    }
    const g = gradeFunction(
      [layer({ kind: 'lut', lut: { source: 'bundled:warm', intensity: 1 } })],
      () => look,
    )
    // A LUT baked from a LUT reproduces it at its own grid points.
    const cube = parseCube(writeCube('t', 33, g))
    for (let i = 0; i < cube.data.length; i += 997)
      expect(cube.data[i]).toBeCloseTo(look.data[i]!, 5)
  })

  it('a qualifier limits the layer to the chosen colours', () => {
    const q = qualifierSchema.parse({
      hueCenter: 0,
      hueWidth: 0.1,
      satLow: 0.2,
      lumLow: 0.1,
      lumHigh: 0.9,
    })
    const p = { ...neutralPrimary(), exposure: 1 }
    const f = gradeFunction([layer({ primary: p, qualifier: q })], () => null)
    expect(f([0.6, 0.1, 0.1])[0]).toBeGreaterThan(0.6)
    expect(f([0.1, 0.1, 0.6])).toEqual([0.1, 0.1, 0.6])
  })
})
