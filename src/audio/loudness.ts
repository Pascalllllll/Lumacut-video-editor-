/**
 * Loudness after ITU-R BS.1770-4 / EBU R128 for stereo: K-weighting, 400 ms
 * momentary and 3 s short-term windows, and integrated loudness with the
 * absolute (-70 LUFS) and relative (-10 LU) gates. Fed in blocks of any size.
 */
type Stage = { b0: number; b1: number; b2: number; a1: number; a2: number }

/** The two K-weighting stages for any sample rate (the formulas libebur128 uses). */
export function kWeighting(sampleRate: number): [Stage, Stage] {
  let f0 = 1681.974450955533
  const G = 3.999843853973347
  let Q = 0.7071752369554196
  let K = Math.tan((Math.PI * f0) / sampleRate)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.4996667741545416)
  let a0 = 1 + K / Q + K * K
  const shelf: Stage = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  }
  f0 = 38.13547087602444
  Q = 0.5003270373238773
  K = Math.tan((Math.PI * f0) / sampleRate)
  a0 = 1 + K / Q + K * K
  const highpass: Stage = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  }
  return [shelf, highpass]
}

const toLufs = (power: number) => (power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity)

export type LoudnessReading = {
  momentary: number
  shortTerm: number
  integrated: number
  /** Highest sample value seen, in dBFS. */
  peak: number
}

export class LoudnessMeter {
  private readonly stages: [Stage, Stage]
  /** Filter state: per channel, per stage, x1 x2 y1 y2. */
  private readonly state = [new Float64Array(8), new Float64Array(8)]
  private readonly subLength: number
  private subSum = 0
  private subCount = 0
  /** Mean-square power of each finished 100 ms piece. */
  private readonly recent: number[] = []
  /** Power of each 400 ms block (75% overlap) that passed the absolute gate. */
  private readonly blocks: number[] = []
  private maxPeak = 0

  constructor(sampleRate: number) {
    this.stages = kWeighting(sampleRate)
    this.subLength = Math.round(sampleRate / 10)
  }

  reset() {
    this.state.forEach((s) => s.fill(0))
    this.subSum = 0
    this.subCount = 0
    this.recent.length = 0
    this.blocks.length = 0
    this.maxPeak = 0
  }

  private filter(x: number, st: Float64Array): number {
    let v = x
    for (let k = 0; k < 2; k++) {
      const s = this.stages[k]!
      const o = k * 4
      const y = s.b0 * v + s.b1 * st[o]! + s.b2 * st[o + 1]! - s.a1 * st[o + 2]! - s.a2 * st[o + 3]!
      st[o + 1] = st[o]!
      st[o] = v
      st[o + 3] = st[o + 2]!
      st[o + 2] = y
      v = y
    }
    return v
  }

  push(left: Float32Array, right: Float32Array, n = left.length) {
    const [sl, sr] = this.state as [Float64Array, Float64Array]
    for (let i = 0; i < n; i++) {
      const l = left[i]!
      const r = right[i]!
      const al = Math.abs(l)
      const ar = Math.abs(r)
      if (al > this.maxPeak) this.maxPeak = al
      if (ar > this.maxPeak) this.maxPeak = ar
      const fl = this.filter(l, sl)
      const fr = this.filter(r, sr)
      this.subSum += fl * fl + fr * fr
      if (++this.subCount === this.subLength) this.finishPiece()
    }
  }

  private finishPiece() {
    this.recent.push(this.subSum / this.subLength)
    if (this.recent.length > 30) this.recent.shift()
    this.subSum = 0
    this.subCount = 0
    if (this.recent.length >= 4) {
      const power = this.windowPower(4)
      if (toLufs(power) > -70) this.blocks.push(power)
    }
  }

  private windowPower(pieces: number): number {
    const take = this.recent.slice(-pieces)
    if (take.length < pieces) return 0
    return take.reduce((a, b) => a + b, 0) / pieces
  }

  integrated(): number {
    if (this.blocks.length === 0) return -Infinity
    const mean = this.blocks.reduce((a, b) => a + b, 0) / this.blocks.length
    const gate = toLufs(mean) - 10
    const kept = this.blocks.filter((p) => toLufs(p) > gate)
    if (kept.length === 0) return -Infinity
    return toLufs(kept.reduce((a, b) => a + b, 0) / kept.length)
  }

  read(): LoudnessReading {
    return {
      momentary: toLufs(this.windowPower(4)),
      shortTerm: toLufs(this.windowPower(30)),
      integrated: this.integrated(),
      peak: this.maxPeak > 0 ? 20 * Math.log10(this.maxPeak) : -Infinity,
    }
  }
}
