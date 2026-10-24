import { describe, expect, it } from 'vitest'
import { frameToPicture, pictureToFrame } from '@engine/placement'

const base = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0,
  anchorY: 0,
  opacity: 1,
  cropLeft: 0,
  cropRight: 0,
  cropTop: 0,
  cropBottom: 0,
}

describe('placement', () => {
  it('centres a fitted picture in the frame', () => {
    const p = { width: 1280, height: 720, fit: 1.5, transform: base }
    expect(pictureToFrame(p, 1920, 1080, 0, 0)).toEqual({ x: 0, y: 0 })
    expect(pictureToFrame(p, 1920, 1080, 1, 1)).toEqual({ x: 1920, y: 1080 })
  })
  it('round-trips through move, scale, turn and anchor', () => {
    const p = {
      width: 1000,
      height: 500,
      fit: 1,
      transform: {
        ...base,
        x: 120,
        y: -40,
        scaleX: 0.5,
        scaleY: 0.8,
        rotation: 30,
        anchorX: 50,
        anchorY: -20,
      },
    }
    const f = pictureToFrame(p, 1920, 1080, 0.2, 0.7)
    const back = frameToPicture(p, 1920, 1080, f.x, f.y)
    expect(back.u).toBeCloseTo(0.2)
    expect(back.v).toBeCloseTo(0.7)
  })
})
