import { describe, expect, it } from 'vitest'
import { frameMotion, stabilizeCorrections, trackPoint, type Gray } from '../../src/media/track'

/** A textured test frame: smooth noise, shifted by (ox, oy). */
function frame(w: number, h: number, ox: number, oy: number): Gray {
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x - ox
      const v = y - oy
      const n =
        Math.sin(u * 0.21) * Math.cos(v * 0.17) +
        Math.sin((u + v) * 0.09) +
        Math.cos(u * 0.05 - v * 0.13) * 0.5
      data[y * w + x] = Math.max(0, Math.min(255, Math.round(128 + n * 50)))
    }
  }
  return { data, width: w, height: h }
}

describe('tracking', () => {
  it('follows a patch that moves 3 px right and 2 px down per frame', () => {
    const frames = Array.from({ length: 8 }, (_, i) => frame(240, 160, i * 3, i * 2))
    const track = trackPoint(frames, 100, 70)
    expect(track).toHaveLength(8)
    expect(track[7]!.x - track[0]!.x).toBe(21)
    expect(track[7]!.y - track[0]!.y).toBe(14)
  })

  it('measures camera shift between frames', () => {
    const m = frameMotion(frame(320, 180, 0, 0), frame(320, 180, 5, -3))
    expect(m.dx).toBe(5)
    expect(m.dy).toBe(-3)
    expect(Math.abs(m.angle)).toBeLessThan(0.01)
  })

  it('smoothing cancels shake but keeps a steady pan', () => {
    // A pan of 2 px per frame plus a ±4 px wobble.
    const motions = Array.from({ length: 60 }, (_, i) => ({
      dx: 2 + (i % 2 === 0 ? 4 : -4),
      dy: 0,
      angle: 0,
    }))
    const c = stabilizeCorrections(motions, 10)
    const residual: number[] = []
    let pos = 0
    for (let i = 0; i < motions.length; i++) {
      pos += motions[i]!.dx
      residual.push(pos + c[(i + 1) * 3]!)
    }
    // After correction, frame-to-frame steps (away from the ends) are close to the pan speed.
    for (let i = 10; i < 50; i++)
      expect(Math.abs(residual[i + 1]! - residual[i]! - 2)).toBeLessThan(1)
  })
})
