import { applyEase, evaluate } from './animation'
import {
  createId,
  type AudioEffect,
  type AudioEffectType,
  type Clip,
  type ClipSound,
} from './model'

export type AudioParamSpec = {
  id: string
  default: number
  min: number
  max: number
  step: number
  unit: 'dB' | 'Hz' | 'ms' | 's' | '%' | ':1' | ''
}

const p = (
  id: string,
  def: number,
  min: number,
  max: number,
  step: number,
  unit: AudioParamSpec['unit'],
): AudioParamSpec => ({ id, default: def, min, max, step, unit })

/**
 * The sound effect library. Labels come from `audioEffect.<type>` and
 * `audioParam.<id>`. Processing lives in `src/audio/dsp.ts` (preview) and
 * `src/media/audio-filters.ts` (export), which are tested against each other.
 * A cut filter at 0 Hz is off.
 */
export const AUDIO_EFFECT_SPECS: Record<AudioEffectType, AudioParamSpec[]> = {
  eq: [
    p('lowCut', 0, 0, 1000, 1, 'Hz'),
    p('lowGain', 0, -24, 24, 0.5, 'dB'),
    p('lowFreq', 120, 20, 1000, 1, 'Hz'),
    p('midGain', 0, -24, 24, 0.5, 'dB'),
    p('midFreq', 1000, 100, 10000, 10, 'Hz'),
    p('midQ', 1, 0.1, 10, 0.1, ''),
    p('highGain', 0, -24, 24, 0.5, 'dB'),
    p('highFreq', 8000, 1000, 18000, 10, 'Hz'),
    p('highCut', 0, 0, 20000, 10, 'Hz'),
  ],
  compressor: [
    p('threshold', -18, -60, 0, 0.5, 'dB'),
    p('ratio', 4, 1, 20, 0.1, ':1'),
    p('attack', 20, 0.01, 2000, 0.1, 'ms'),
    p('release', 250, 0.01, 9000, 1, 'ms'),
    p('knee', 9, 0, 18, 0.5, 'dB'),
    p('makeup', 0, 0, 36, 0.5, 'dB'),
  ],
  limiter: [p('ceiling', -1, -24, 0, 0.1, 'dB'), p('release', 50, 1, 2000, 1, 'ms')],
  gate: [
    p('threshold', -40, -80, 0, 0.5, 'dB'),
    p('range', -40, -80, 0, 1, 'dB'),
    p('ratio', 4, 1, 20, 0.1, ':1'),
    p('attack', 5, 0.01, 2000, 0.1, 'ms'),
    p('release', 200, 0.01, 9000, 1, 'ms'),
  ],
  deesser: [
    p('frequency', 6000, 2000, 12000, 50, 'Hz'),
    p('threshold', -30, -60, 0, 0.5, 'dB'),
    p('ratio', 4, 1, 20, 0.1, ':1'),
  ],
  reverb: [
    p('decay', 1.5, 0.1, 8, 0.1, 's'),
    p('predelay', 20, 0, 200, 1, 'ms'),
    p('mix', 25, 0, 100, 1, '%'),
  ],
}

export function createAudioEffect(type: AudioEffectType): AudioEffect {
  const params: Record<string, number> = {}
  for (const spec of AUDIO_EFFECT_SPECS[type]) params[spec.id] = spec.default
  return { id: createId('afx'), type, enabled: true, params }
}

/** Every parameter of an effect, with defaults filled in and values kept in range. */
export function audioParams(effect: AudioEffect): Record<string, number> {
  const out: Record<string, number> = {}
  for (const spec of AUDIO_EFFECT_SPECS[effect.type]) {
    const v = effect.params[spec.id]
    out[spec.id] =
      typeof v === 'number' && Number.isFinite(v)
        ? Math.min(spec.max, Math.max(spec.min, v))
        : spec.default
  }
  return out
}

export const dbToGain = (db: number) => (db <= -96 ? 0 : Math.pow(10, db / 20))
export const gainToDb = (gain: number) => (gain <= 1e-5 ? -96 : 20 * Math.log10(gain))

/** Linear fade factor at a clip frame (fractional frames allowed). */
export function fadeAt(sound: ClipSound, duration: number, offset: number): number {
  let k = 1
  if (sound.fadeIn > 0 && offset < sound.fadeIn) k *= Math.max(0, offset / sound.fadeIn)
  const fromEnd = duration - offset
  if (sound.fadeOut > 0 && fromEnd < sound.fadeOut) k *= Math.max(0, fromEnd / sound.fadeOut)
  return k
}

/** The clip's level at a clip frame in dB, before fades: gain plus the volume curve. */
export function levelAt(sound: ClipSound, offset: number): number {
  return sound.gain + evaluate(sound.volume, offset)
}

/** Linear gain applied to a clip's sound at a clip frame. */
export function clipGainAt(clip: Clip, offset: number): number {
  return dbToGain(levelAt(clip.sound, offset)) * fadeAt(clip.sound, clip.duration, offset)
}

/**
 * Stereo pan as Web Audio's StereoPannerNode does it for stereo input: the
 * far side folds into the near one with an equal-power law. Returns the 2x2
 * matrix [[lFromL, lFromR], [rFromL, rFromR]].
 */
export function panMatrix(pan: number): [[number, number], [number, number]] {
  const v = Math.min(1, Math.max(-1, pan))
  const x = v <= 0 ? v + 1 : v
  const gl = Math.cos((x * Math.PI) / 2)
  const gr = Math.sin((x * Math.PI) / 2)
  return v <= 0
    ? [
        [1, gl],
        [0, gr],
      ]
    : [
        [gl, 0],
        [gr, 1],
      ]
}

/**
 * The volume curve as straight dB segments, for export: [frame, dB] points
 * from the clip start to its end. Eased keys are split into eight steps.
 */
export function levelBreakpoints(sound: ClipSound, duration: number): [number, number][] {
  const keys = sound.volume.keys
  if (keys.length === 0) return [[0, sound.gain + sound.volume.value]]
  const points: [number, number][] = []
  const push = (f: number, db: number) => {
    const last = points[points.length - 1]
    if (last && Math.abs(last[0] - f) < 1e-9) last[1] = db
    else points.push([f, db])
  }
  push(Math.min(0, keys[0]!.frame), sound.gain + keys[0]!.value)
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i]!
    push(a.frame, sound.gain + a.value)
    const b = keys[i + 1]
    if (!b) break
    if (a.ease === 'hold') {
      push(b.frame - 1e-3, sound.gain + a.value)
    } else if (a.ease !== 'linear') {
      for (let s = 1; s < 8; s++) {
        const k = s / 8
        push(
          a.frame + (b.frame - a.frame) * k,
          sound.gain + a.value + (b.value - a.value) * applyEase(a.ease, k),
        )
      }
    }
  }
  const last = keys[keys.length - 1]!
  push(Math.max(duration, last.frame), sound.gain + last.value)
  return points
}
