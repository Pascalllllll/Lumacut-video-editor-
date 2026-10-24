import { describe, expect, it } from 'vitest'
import { envelopeOffset } from '../../src/media/sync'

function envelope(length: number, seed: number) {
  let x = seed
  return Array.from({ length }, () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return (x / 2147483648) * 255
  })
}

describe('envelopeOffset', () => {
  it('finds a shift between two recordings of the same sound', () => {
    const sound = envelope(3000, 7)
    const camA = sound.slice(0, 2500)
    const camB = sound.slice(340, 2840).map((v) => v * 0.6 + 10)
    const { lag } = envelopeOffset(camA, camB, 600)
    expect(lag).toBe(340)
  })
  it('finds a negative shift', () => {
    const sound = envelope(3000, 3)
    const { lag } = envelopeOffset(sound.slice(200, 2200), sound.slice(0, 2400), 500)
    expect(lag).toBe(-200)
  })
})
