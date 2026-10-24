import { audioParams, dbToGain } from '@engine/audio'
import type { AudioEffect } from '@engine/model'

/**
 * Sound processing for preview, run inside an AudioWorklet. Each processor
 * follows the FFmpeg filter that export uses (biquads, acompressor, agate,
 * acrossover) closely enough that tests compare the two sample by sample.
 * Everything here is stereo: two Float32Arrays processed in place.
 */
export interface Processor {
  process(left: Float32Array, right: Float32Array, n: number): void
}

type Coeffs = { b0: number; b1: number; b2: number; a1: number; a2: number }

/** RBJ cookbook designs, the ones FFmpeg's biquad filters use. */
export function design(
  kind: 'lowpass' | 'highpass' | 'peaking' | 'lowshelf' | 'highshelf',
  sampleRate: number,
  freq: number,
  q: number,
  gainDb = 0,
): Coeffs {
  const w0 = (2 * Math.PI * Math.min(freq, sampleRate * 0.499)) / sampleRate
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const A = Math.pow(10, gainDb / 40)
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
  switch (kind) {
    case 'lowpass': {
      const alpha = sin / (2 * q)
      b0 = (1 - cos) / 2
      b1 = 1 - cos
      b2 = (1 - cos) / 2
      a0 = 1 + alpha
      a1 = -2 * cos
      a2 = 1 - alpha
      break
    }
    case 'highpass': {
      const alpha = sin / (2 * q)
      b0 = (1 + cos) / 2
      b1 = -(1 + cos)
      b2 = (1 + cos) / 2
      a0 = 1 + alpha
      a1 = -2 * cos
      a2 = 1 - alpha
      break
    }
    case 'peaking': {
      const alpha = sin / (2 * q)
      b0 = 1 + alpha * A
      b1 = -2 * cos
      b2 = 1 - alpha * A
      a0 = 1 + alpha / A
      a1 = -2 * cos
      a2 = 1 - alpha / A
      break
    }
    case 'lowshelf':
    case 'highshelf': {
      // q is the shelf slope S here.
      const alpha = (sin / 2) * Math.sqrt((A + 1 / A) * (1 / q - 1) + 2)
      const s = 2 * Math.sqrt(A) * alpha
      if (kind === 'lowshelf') {
        b0 = A * (A + 1 - (A - 1) * cos + s)
        b1 = 2 * A * (A - 1 - (A + 1) * cos)
        b2 = A * (A + 1 - (A - 1) * cos - s)
        a0 = A + 1 + (A - 1) * cos + s
        a1 = -2 * (A - 1 + (A + 1) * cos)
        a2 = A + 1 + (A - 1) * cos - s
      } else {
        b0 = A * (A + 1 + (A - 1) * cos + s)
        b1 = -2 * A * (A - 1 + (A + 1) * cos)
        b2 = A * (A + 1 + (A - 1) * cos - s)
        a0 = A + 1 - (A - 1) * cos + s
        a1 = 2 * (A - 1 - (A + 1) * cos)
        a2 = A + 1 - (A - 1) * cos - s
      }
      break
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/** Direct form I, one state per channel, as FFmpeg's default transform. */
export class Biquad implements Processor {
  private s = [new Float64Array(4), new Float64Array(4)]
  constructor(private readonly c: Coeffs) {}

  processChannel(x: Float32Array, n: number, st: Float64Array) {
    const { b0, b1, b2, a1, a2 } = this.c
    let x1 = st[0]!
    let x2 = st[1]!
    let y1 = st[2]!
    let y2 = st[3]!
    for (let i = 0; i < n; i++) {
      const xi = x[i]!
      const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = xi
      y2 = y1
      y1 = y
      x[i] = y
    }
    st[0] = x1
    st[1] = x2
    st[2] = y1
    st[3] = y2
  }

  process(left: Float32Array, right: Float32Array, n: number) {
    this.processChannel(left, n, this.s[0]!)
    this.processChannel(right, n, this.s[1]!)
  }
}

function hermite(
  x: number,
  x0: number,
  x1: number,
  p0: number,
  p1: number,
  m0: number,
  m1: number,
) {
  const width = x1 - x0
  const t = (x - x0) / width
  m0 *= width
  m1 *= width
  const t2 = t * t
  const t3 = t2 * t
  const ct0 = p0
  const ct1 = m0
  const ct2 = -3 * p0 - 2 * m0 + 3 * p1 - m1
  const ct3 = 2 * p0 + m0 - 2 * p1 + m1
  return t3 * ct3 + t2 * ct2 + t * ct1 + ct0
}

export type DynamicsOptions = {
  /** Linear threshold. */
  threshold: number
  ratio: number
  attackMs: number
  releaseMs: number
  /** Linear knee width factor, 1 for a hard knee. */
  knee: number
  /** Linear gain after compression. */
  makeup: number
  detection: 'rms' | 'peak'
  link: 'average' | 'maximum'
}

/** FFmpeg's acompressor (downward mode). */
export class Compressor implements Processor {
  private slope = 0
  private readonly thres: number
  private readonly kneeStart: number
  private readonly kneeStop: number
  private readonly detector: number
  private readonly attack: number
  private readonly release: number
  /** The gain applied to the last sample, for meters. */
  reduction = 1

  constructor(
    sampleRate: number,
    private readonly o: DynamicsOptions,
  ) {
    this.thres = Math.log(o.threshold)
    const linStart = o.threshold / Math.sqrt(o.knee)
    const linStop = o.threshold * Math.sqrt(o.knee)
    this.kneeStart = Math.log(linStart)
    this.kneeStop = Math.log(linStop)
    this.detector = o.detection === 'rms' ? linStart * linStart : linStart
    this.attack = Math.min(1, 1 / ((o.attackMs * sampleRate) / 4000))
    this.release = Math.min(1, 1 / ((o.releaseMs * sampleRate) / 4000))
  }

  private gain(lin: number): number {
    const { ratio, knee, detection } = this.o
    let slope = Math.log(lin)
    if (detection === 'rms') slope *= 0.5
    let gain = (slope - this.thres) / ratio + this.thres
    const delta = 1 / ratio
    if (knee > 1 && slope < this.kneeStop)
      gain = hermite(
        slope,
        this.kneeStart,
        this.kneeStop,
        this.thres + (this.kneeStart - this.thres) / ratio,
        this.kneeStop,
        delta,
        1,
      )
    return Math.exp(gain - slope)
  }

  process(left: Float32Array, right: Float32Array, n: number) {
    const { makeup, link, detection } = this.o
    let g = 1
    for (let i = 0; i < n; i++) {
      const l = Math.abs(left[i]!)
      const r = Math.abs(right[i]!)
      let s = link === 'maximum' ? Math.max(l, r) : (l + r) / 2
      if (detection === 'rms') s *= s
      this.slope += (s - this.slope) * (s > this.slope ? this.attack : this.release)
      g = this.slope > 0 && this.slope > this.detector ? this.gain(this.slope) : 1
      const k = g * makeup
      left[i] = left[i]! * k
      right[i] = right[i]! * k
    }
    this.reduction = g
  }
}

export type GateOptions = {
  threshold: number
  /** Linear floor the gate closes to. */
  range: number
  ratio: number
  attackMs: number
  releaseMs: number
  knee: number
}

/** FFmpeg's agate (downward mode, RMS detection, channels averaged). */
export class Gate implements Processor {
  private slope = 0
  private readonly thres: number
  private readonly kneeStart: number
  private readonly kneeStop: number
  private readonly linKneeStop: number
  private readonly attack: number
  private readonly release: number

  constructor(
    sampleRate: number,
    private readonly o: GateOptions,
  ) {
    const lin = o.threshold * o.threshold
    this.linKneeStop = lin * Math.sqrt(o.knee)
    const linKneeStart = lin / Math.sqrt(o.knee)
    this.thres = Math.log(lin)
    this.kneeStart = Math.log(linKneeStart)
    this.kneeStop = Math.log(this.linKneeStop)
    this.attack = Math.min(1, 1 / ((o.attackMs * sampleRate) / 4000))
    this.release = Math.min(1, 1 / ((o.releaseMs * sampleRate) / 4000))
  }

  private gain(lin: number): number {
    const { ratio, knee, range } = this.o
    const slope = Math.log(lin)
    let gain = (slope - this.thres) * ratio + this.thres
    if (knee > 1 && slope > this.kneeStart)
      gain = hermite(
        slope,
        this.kneeStart,
        this.kneeStop,
        (this.kneeStart - this.thres) * ratio + this.thres,
        this.kneeStop,
        ratio,
        1,
      )
    return Math.max(range, Math.exp(gain - slope))
  }

  process(left: Float32Array, right: Float32Array, n: number) {
    for (let i = 0; i < n; i++) {
      let s = (Math.abs(left[i]!) + Math.abs(right[i]!)) / 2
      s *= s
      this.slope += (s - this.slope) * (s > this.slope ? this.attack : this.release)
      const g = this.slope > 0 && this.slope < this.linKneeStop ? this.gain(this.slope) : 1
      left[i] = left[i]! * g
      right[i] = right[i]! * g
    }
  }
}

const BUTTERWORTH_Q = Math.SQRT1_2

/** A Linkwitz-Riley crossover (two Butterworth stages per band); the high band is compressed. */
export class DeEsser implements Processor {
  private readonly lows: Biquad[]
  private readonly highs: Biquad[]
  private readonly comp: Compressor
  private hiL = new Float32Array(128)
  private hiR = new Float32Array(128)

  constructor(sampleRate: number, frequency: number, threshold: number, ratio: number) {
    const lp = design('lowpass', sampleRate, frequency, BUTTERWORTH_Q)
    const hp = design('highpass', sampleRate, frequency, BUTTERWORTH_Q)
    this.lows = [new Biquad(lp), new Biquad(lp)]
    this.highs = [new Biquad(hp), new Biquad(hp)]
    this.comp = new Compressor(sampleRate, deesserCompressor(threshold, ratio))
  }

  process(left: Float32Array, right: Float32Array, n: number) {
    if (this.hiL.length < n) {
      this.hiL = new Float32Array(n)
      this.hiR = new Float32Array(n)
    }
    const hl = this.hiL
    const hr = this.hiR
    hl.set(left.subarray(0, n))
    hr.set(right.subarray(0, n))
    for (const f of this.lows) f.process(left, right, n)
    for (const f of this.highs) f.process(hl, hr, n)
    this.comp.process(hl, hr, n)
    for (let i = 0; i < n; i++) {
      left[i] = left[i]! + hl[i]!
      right[i] = right[i]! + hr[i]!
    }
  }
}

/** Compressor settings shared by the de-esser in preview and export. */
export function deesserCompressor(thresholdDb: number, ratio: number): DynamicsOptions {
  return {
    threshold: dbToGain(thresholdDb),
    ratio,
    attackMs: 0.5,
    releaseMs: 40,
    knee: 2,
    makeup: 1,
    detection: 'peak',
    link: 'maximum',
  }
}

/** Limiter settings shared by preview and export: a peak compressor with an instant attack. */
export function limiterOptions(ceilingDb: number, releaseMs: number): DynamicsOptions {
  return {
    threshold: dbToGain(ceilingDb),
    ratio: 20,
    attackMs: 0.01,
    releaseMs,
    knee: 1,
    makeup: 1,
    detection: 'peak',
    link: 'maximum',
  }
}

export function compressorOptions(p: Record<string, number>): DynamicsOptions {
  return {
    threshold: dbToGain(p['threshold']!),
    ratio: p['ratio']!,
    attackMs: p['attack']!,
    releaseMs: p['release']!,
    knee: Math.max(1, dbToGain(p['knee']!)),
    makeup: dbToGain(p['makeup']!),
    detection: 'rms',
    link: 'average',
  }
}

export function gateOptions(p: Record<string, number>): GateOptions {
  return {
    threshold: dbToGain(p['threshold']!),
    range: dbToGain(p['range']!),
    ratio: p['ratio']!,
    attackMs: p['attack']!,
    releaseMs: p['release']!,
    knee: 2.828427125,
  }
}

/** The biquads of an EQ effect, in order: low cut, low shelf, mid peak, high shelf, high cut. */
export function eqStages(p: Record<string, number>, sampleRate: number): Coeffs[] {
  const stages: Coeffs[] = []
  if (p['lowCut']! > 0) stages.push(design('highpass', sampleRate, p['lowCut']!, BUTTERWORTH_Q))
  if (p['lowGain'] !== 0)
    stages.push(design('lowshelf', sampleRate, p['lowFreq']!, 1, p['lowGain']))
  if (p['midGain'] !== 0)
    stages.push(design('peaking', sampleRate, p['midFreq']!, p['midQ']!, p['midGain']))
  if (p['highGain'] !== 0)
    stages.push(design('highshelf', sampleRate, p['highFreq']!, 1, p['highGain']))
  if (p['highCut']! > 0) stages.push(design('lowpass', sampleRate, p['highCut']!, BUTTERWORTH_Q))
  return stages
}

/** A processor for one effect; reverb has none here (preview convolves it natively). */
export function createProcessor(effect: AudioEffect, sampleRate: number): Processor | null {
  const p = audioParams(effect)
  switch (effect.type) {
    case 'eq': {
      const stages = eqStages(p, sampleRate).map((c) => new Biquad(c))
      return {
        process: (l, r, n) => {
          for (const s of stages) s.process(l, r, n)
        },
      }
    }
    case 'compressor':
      return new Compressor(sampleRate, compressorOptions(p))
    case 'limiter':
      return new Compressor(sampleRate, limiterOptions(p['ceiling']!, p['release']!))
    case 'gate':
      return new Gate(sampleRate, gateOptions(p))
    case 'deesser':
      return new DeEsser(sampleRate, p['frequency']!, p['threshold']!, p['ratio']!)
    case 'reverb':
      return null
  }
}

/** Small seeded generator so the same reverb settings always make the same impulse. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Reverb impulse: decaying noise that falls 60 dB over `decay` seconds after
 * `predelay`, a little darker as it fades, scaled to unit energy per channel.
 * Preview and export convolve with these same samples.
 */
export function reverbImpulse(
  decay: number,
  predelayMs: number,
  sampleRate: number,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const pre = Math.round((predelayMs / 1000) * sampleRate)
  const length = pre + Math.max(1, Math.round(decay * sampleRate))
  const out: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [
    new Float32Array(length),
    new Float32Array(length),
  ]
  out.forEach((ch, c) => {
    const rand = mulberry32(0x5eed + c * 7919)
    let lp = 0
    let energy = 0
    for (let i = pre; i < length; i++) {
      const t = (i - pre) / sampleRate
      const env = Math.exp((-6.907755 * t) / decay)
      // The one-pole low-pass closes as the tail decays, like air absorbing highs.
      const k = 0.15 + 0.85 * env
      lp += k * (rand() * 2 - 1 - lp)
      const v = lp * env
      ch[i] = v
      energy += v * v
    }
    const norm = energy > 0 ? 1 / Math.sqrt(energy) : 0
    for (let i = pre; i < length; i++) ch[i] = ch[i]! * norm
  })
  return out
}
