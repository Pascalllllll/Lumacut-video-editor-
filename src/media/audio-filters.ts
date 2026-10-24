import { audioParams, dbToGain, levelBreakpoints, panMatrix } from '@engine/audio'
import type { AudioEffect, Bus, ClipSound } from '@engine/model'
import {
  compressorOptions,
  deesserCompressor,
  gateOptions,
  limiterOptions,
  type DynamicsOptions,
} from '../audio/dsp'

/** What the filter builders need from the export graph. */
export interface AudioGraph {
  label(prefix: string): string
  push(filter: string): void
  /** Adds a reverb impulse file as an input and returns its stream label. */
  reverbInput(decay: number, predelayMs: number): string
}

const num = (n: number) => (Math.abs(n) < 1e-9 ? '0' : n.toFixed(6).replace(/\.?0+$/, ''))
const Q = Math.SQRT1_2

function dynamics(o: DynamicsOptions): string {
  return [
    `acompressor=threshold=${num(Math.max(0.000976563, o.threshold))}`,
    `ratio=${num(o.ratio)}`,
    `attack=${num(o.attackMs)}`,
    `release=${num(o.releaseMs)}`,
    `knee=${num(Math.min(8, o.knee))}`,
    `makeup=${num(Math.min(64, o.makeup))}`,
    `detection=${o.detection}`,
    `link=${o.link}`,
  ].join(':')
}

/** The FFmpeg filters for one effect; matches `createProcessor` in src/audio/dsp.ts. */
function effect(graph: AudioGraph, fx: AudioEffect, input: string): string {
  const p = audioParams(fx)
  const out = graph.label('fx')
  const chain = (filters: string[]) => {
    graph.push(`[${input}]${filters.length ? filters.join(',') : 'anull'}[${out}]`)
    return out
  }
  switch (fx.type) {
    case 'eq': {
      const f: string[] = []
      if (p['lowCut']! > 0) f.push(`highpass=f=${num(p['lowCut']!)}:t=q:w=${num(Q)}`)
      if (p['lowGain'] !== 0)
        f.push(`lowshelf=f=${num(p['lowFreq']!)}:g=${num(p['lowGain']!)}:t=s:w=1`)
      if (p['midGain'] !== 0)
        f.push(`equalizer=f=${num(p['midFreq']!)}:t=q:w=${num(p['midQ']!)}:g=${num(p['midGain']!)}`)
      if (p['highGain'] !== 0)
        f.push(`highshelf=f=${num(p['highFreq']!)}:g=${num(p['highGain']!)}:t=s:w=1`)
      if (p['highCut']! > 0) f.push(`lowpass=f=${num(p['highCut']!)}:t=q:w=${num(Q)}`)
      return chain(f)
    }
    case 'compressor':
      return chain([dynamics(compressorOptions(p))])
    case 'limiter':
      return chain([dynamics(limiterOptions(p['ceiling']!, p['release']!))])
    case 'gate': {
      const o = gateOptions(p)
      return chain([
        [
          `agate=threshold=${num(o.threshold)}`,
          `range=${num(o.range)}`,
          `ratio=${num(o.ratio)}`,
          `attack=${num(o.attackMs)}`,
          `release=${num(o.releaseMs)}`,
          `knee=${num(o.knee)}`,
          'detection=rms',
          'link=average',
        ].join(':'),
      ])
    }
    case 'deesser': {
      const lo = graph.label('lo')
      const hi = graph.label('hi')
      const hc = graph.label('hc')
      graph.push(`[${input}]acrossover=split=${num(p['frequency']!)}:order=4th[${lo}][${hi}]`)
      graph.push(`[${hi}]${dynamics(deesserCompressor(p['threshold']!, p['ratio']!))}[${hc}]`)
      graph.push(`[${lo}][${hc}]amix=inputs=2:normalize=0[${out}]`)
      return out
    }
    case 'reverb': {
      const mix = p['mix']! / 100
      const dry = graph.label('dry')
      const send = graph.label('send')
      const wet = graph.label('wet')
      const ir = graph.reverbInput(p['decay']!, p['predelay']!)
      graph.push(`[${input}]asplit=2[${dry}][${send}]`)
      graph.push(`[${send}][${ir}]afir=irnorm=-1:irgain=1,volume=${num(mix)}[${wet}]`)
      const dryOut = graph.label('dryv')
      graph.push(`[${dry}]volume=${num(1 - mix)}[${dryOut}]`)
      graph.push(`[${dryOut}][${wet}]amix=inputs=2:normalize=0:duration=first[${out}]`)
      return out
    }
  }
}

export function effectChain(graph: AudioGraph, effects: AudioEffect[], input: string): string {
  let cur = input
  for (const fx of effects) if (fx.enabled) cur = effect(graph, fx, cur)
  return cur
}

function panFilter(pan: number): string | null {
  if (Math.abs(pan) < 1e-6) return null
  const [[ll, lr], [rl, rr]] = panMatrix(pan)
  return `pan=stereo|c0=${num(ll)}*c0+${num(lr)}*c1|c1=${num(rl)}*c0+${num(rr)}*c1`
}

/**
 * The level curve as one FFmpeg expression of t (seconds from the clip start):
 * a sum of straight dB segments, converted to a gain.
 */
export function levelExpression(sound: ClipSound, duration: number, fps: number): string {
  const pts = levelBreakpoints(sound, duration).map(([f, db]) => [f / fps, db] as const)
  if (pts.length === 1) return num(dbToGain(pts[0]![1]))
  const terms: string[] = [`lt(t,${num(pts[0]![0])})*${num(pts[0]![1])}`]
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, va] = pts[i]!
    const [b, vb] = pts[i + 1]!
    if (b <= a) continue
    terms.push(
      `gte(t,${num(a)})*lt(t,${num(b)})*(${num(va)}+${num(vb - va)}*(t-${num(a)})/${num(b - a)})`,
    )
  }
  const [last, vl] = pts[pts.length - 1]!
  terms.push(`gte(t,${num(last)})*${num(vl)}`)
  // dB at or below -96 is silence.
  return `if(lte(${terms.join('+')},-96),0,pow(10,(${terms.join('+')})/20))`
}

/** A clip's sound after its picture timing: effects, level, fades, pan. */
export function clipSound(
  graph: AudioGraph,
  sound: ClipSound,
  input: string,
  duration: number,
  fps: number,
): string {
  let cur = effectChain(graph, sound.effects, input)
  const filters: string[] = []
  const expr = levelExpression(sound, duration, fps)
  const animated = sound.volume.keys.length > 0
  if (animated) filters.push(`volume='${expr}':eval=frame`)
  else if (expr !== '1') filters.push(`volume=${expr}`)
  if (sound.fadeIn > 0) filters.push(`afade=t=in:st=0:d=${num(sound.fadeIn / fps)}:curve=tri`)
  if (sound.fadeOut > 0)
    filters.push(
      `afade=t=out:st=${num((duration - sound.fadeOut) / fps)}:d=${num(sound.fadeOut / fps)}:curve=tri`,
    )
  const pan = panFilter(sound.pan)
  if (pan) filters.push(pan)
  if (filters.length) {
    const out = graph.label('cs')
    graph.push(`[${cur}]${filters.join(',')}[${out}]`)
    cur = out
  }
  return cur
}

/** A track or the master: effects, then fader, then pan. */
export function busSound(graph: AudioGraph, bus: Bus, input: string): string {
  let cur = effectChain(graph, bus.effects, input)
  const filters: string[] = []
  if (Math.abs(bus.volume) > 1e-6) filters.push(`volume=${num(dbToGain(bus.volume))}`)
  const pan = panFilter(bus.pan)
  if (pan) filters.push(pan)
  if (filters.length) {
    const out = graph.label('bs')
    graph.push(`[${cur}]${filters.join(',')}[${out}]`)
    cur = out
  }
  return cur
}
