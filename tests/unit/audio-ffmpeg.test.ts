import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clipGainAt, createAudioEffect, panMatrix } from '@engine/audio'
import {
  activeSequence,
  createClip,
  createProject,
  defaultSound,
  type AudioEffect,
  type AudioEffectType,
  type ClipSound,
  type MediaAsset,
} from '@engine/model'
import { createProcessor } from '../../src/audio/dsp'
import { LoudnessMeter } from '../../src/audio/loudness'
import { busSound, clipSound, effectChain, type AudioGraph } from '../../src/media/audio-filters'
import {
  buildExportPlan,
  buildLoudnessArgs,
  defaultExportSettings,
  loudnessGain,
  parseLoudness,
} from '../../src/media/export-plan'
import { writeImpulses } from '../../src/media/impulses'

const ffmpeg = join(
  'resources',
  'bin',
  `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
)
const RATE = 48000

/** A filter graph collector with no reverb support (reverb is checked end to end). */
function collector() {
  let n = 0
  const filters: string[] = []
  const graph: AudioGraph = {
    label: (p) => `${p}${n++}`,
    push: (f) => filters.push(f),
    reverbInput: () => {
      throw new Error('not used here')
    },
  }
  return { graph, filters }
}

describe.skipIf(!existsSync(ffmpeg))('sound processing matches FFmpeg', () => {
  // Vitest still runs a skipped suite's body to collect its tests; the setup below needs FFmpeg.
  if (!existsSync(ffmpeg)) return
  const dir = mkdtempSync(join(tmpdir(), 'lumacut-audio-'))
  const input = join(dir, 'in.f32')
  // Loud and quiet bursts, a different tone on each side, so dynamics have something to do.
  execFileSync(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=exprs='0.8*sin(2*PI*220*t)*(0.05+0.95*lt(mod(t\\,0.5)\\,0.25))|0.6*sin(2*PI*5300*t+1)*(0.05+0.95*gte(mod(t\\,0.5)\\,0.25))':s=${RATE}:d=2`,
    '-f',
    'f32le',
    input,
  ])
  const raw = new Float32Array(
    execFileSync(
      ffmpeg,
      [
        '-v',
        'error',
        '-f',
        'f32le',
        '-ar',
        String(RATE),
        '-ac',
        '2',
        '-i',
        input,
        '-f',
        'f32le',
        '-',
      ],
      {
        maxBuffer: 64 << 20,
      },
    ).buffer.slice(0),
  )
  const frames = raw.length / 2
  const split = () => {
    const l = new Float32Array(frames)
    const r = new Float32Array(frames)
    for (let i = 0; i < frames; i++) {
      l[i] = raw[i * 2]!
      r[i] = raw[i * 2 + 1]!
    }
    return [l, r] as const
  }

  /** Runs a filter graph over the test signal and returns the result, split by channel. */
  function throughFfmpeg(build: (graph: AudioGraph, input: string) => string) {
    const { graph, filters } = collector()
    const out = build(graph, '0:a')
    filters.push(`[${out}]aformat=sample_fmts=flt:channel_layouts=stereo[o]`)
    const res = spawnSync(
      ffmpeg,
      [
        '-v',
        'error',
        '-f',
        'f32le',
        '-ar',
        String(RATE),
        '-ch_layout',
        'stereo',
        '-i',
        input,
        '-filter_complex',
        filters.join(';'),
        '-map',
        '[o]',
        '-f',
        'f32le',
        '-',
      ],
      { maxBuffer: 64 << 20 },
    )
    if (res.status !== 0) throw new Error(String(res.stderr))
    const data = new Float32Array(
      res.stdout.buffer.slice(res.stdout.byteOffset, res.stdout.byteOffset + res.stdout.byteLength),
    )
    const l = new Float32Array(frames)
    const r = new Float32Array(frames)
    for (let i = 0; i < frames; i++) {
      l[i] = data[i * 2] ?? 0
      r[i] = data[i * 2 + 1] ?? 0
    }
    return [l, r] as const
  }

  function compare(a: readonly Float32Array[], b: readonly Float32Array[]) {
    let err = 0
    let ref = 0
    for (let c = 0; c < 2; c++)
      for (let i = 0; i < frames; i++) {
        const d = a[c]![i]! - b[c]![i]!
        err += d * d
        ref += b[c]![i]! * b[c]![i]!
      }
    return Math.sqrt(err / ref)
  }

  const cases: [AudioEffectType, Record<string, number>][] = [
    [
      'eq',
      {
        lowCut: 80,
        lowGain: 6,
        midGain: -4,
        midFreq: 2500,
        midQ: 1.5,
        highGain: 3,
        highCut: 15000,
      },
    ],
    ['compressor', { threshold: -20, ratio: 6, attack: 5, release: 120, knee: 6, makeup: 3 }],
    ['limiter', { ceiling: -6, release: 80 }],
    ['gate', { threshold: -12, range: -30, ratio: 3, attack: 2, release: 100 }],
    ['deesser', { frequency: 4000, threshold: -24, ratio: 6 }],
  ]

  for (const [type, params] of cases) {
    it(`${type} matches within 1%`, () => {
      const fx: AudioEffect = { ...createAudioEffect(type), params }
      const ours = split()
      const proc = createProcessor(fx, RATE)!
      // Worklets work in 128-sample blocks.
      for (let i = 0; i < frames; i += 128) {
        const n = Math.min(128, frames - i)
        proc.process(ours[0].subarray(i, i + n), ours[1].subarray(i, i + n), n)
      }
      const theirs = throughFfmpeg((g, inp) => effectChain(g, [fx], inp))
      expect(compare(ours, theirs)).toBeLessThan(0.01)
    })
  }

  it('the level curve, fades and pan follow the engine', () => {
    const fps = 25
    const sound: ClipSound = {
      gain: -3,
      volume: {
        value: 0,
        keys: [
          { frame: 5, value: 0, ease: 'linear' },
          { frame: 20, value: -18, ease: 'ease-in-out' },
        ],
      },
      pan: -0.4,
      fadeIn: 4,
      fadeOut: 8,
      effects: [],
    }
    const duration = 50
    const theirs = throughFfmpeg((g, inp) => {
      const n = g.label('n')
      g.push(`[${inp}]asetnsamples=n=240[${n}]`)
      return clipSound(g, sound, n, duration, fps)
    })
    const [l0, r0] = split()
    const [[ll, lr], [rl, rr]] = panMatrix(sound.pan)
    const clip = { duration, sound } as Parameters<typeof clipGainAt>[0]
    let worst = 0
    // Check the middle of each 5 ms block, away from the block edges where FFmpeg steps.
    for (let i = 120; i < Math.min(frames, (duration / fps) * RATE); i += 240) {
      const g = clipGainAt(clip, (i / RATE) * fps)
      const el = g * (ll * l0[i]! + lr * r0[i]!)
      const er = g * (rl * l0[i]! + rr * r0[i]!)
      worst = Math.max(worst, Math.abs(el - theirs[0][i]!), Math.abs(er - theirs[1][i]!))
    }
    expect(worst).toBeLessThan(0.02)
  })

  it('a track fader and pan act on the whole track', () => {
    const theirs = throughFfmpeg((g, inp) =>
      busSound(g, { volume: -6, pan: 0.5, effects: [] }, inp),
    )
    const [l0, r0] = split()
    const [[ll, lr], [rl, rr]] = panMatrix(0.5)
    const k = Math.pow(10, -6 / 20)
    for (const i of [1000, 30000, 70000]) {
      expect(theirs[0][i]!).toBeCloseTo(k * (ll * l0[i]! + lr * r0[i]!), 4)
      expect(theirs[1][i]!).toBeCloseTo(k * (rl * l0[i]! + rr * r0[i]!), 4)
    }
  })

  it('integrated loudness matches ebur128 within 0.1 LU', () => {
    const res = spawnSync(
      ffmpeg,
      [
        '-hide_banner',
        '-nostats',
        '-f',
        'f32le',
        '-ar',
        String(RATE),
        '-ch_layout',
        'stereo',
        '-i',
        input,
        '-af',
        'ebur128=framelog=quiet',
        '-f',
        'null',
        '-',
      ],
      { encoding: 'utf8' },
    )
    const match = /I:\s+(-?[\d.]+) LUFS/.exec(res.stderr)
    expect(match).not.toBeNull()
    const meter = new LoudnessMeter(RATE)
    const [l, r] = split()
    for (let i = 0; i < frames; i += 128)
      meter.push(l.subarray(i, i + 128), r.subarray(i, i + 128), Math.min(128, frames - i))
    expect(Math.abs(meter.read().integrated - Number(match![1]))).toBeLessThan(0.1)
  })
})

describe.skipIf(!existsSync(ffmpeg))('exported sound', () => {
  // Vitest still runs a skipped suite's body to collect its tests; the setup below needs FFmpeg.
  if (!existsSync(ffmpeg)) return
  const dir = mkdtempSync(join(tmpdir(), 'lumacut-mix-'))
  const voice = join(dir, 'voice.wav')
  const music = join(dir, 'music.wav')
  const make = (expr: string, out: string, channels = 2) =>
    execFileSync(ffmpeg, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `${expr}:d=6`,
      '-ac',
      String(channels),
      '-ar',
      '48000',
      out,
    ])
  make("aevalsrc=exprs='0.3*sin(2*PI*180*t)*(0.5+0.5*sin(2*PI*3*t))':s=48000", voice, 1)
  make('anoisesrc=c=pink:a=0.05:r=48000', music)

  function project(target: number | null) {
    const p = createProject('mix')
    const seq = activeSequence(p)
    seq.fps = { num: 25, den: 1 }
    seq.sampleRate = 48000
    seq.loudnessTarget = target
    const a1 = seq.tracks.find((t) => t.kind === 'audio')!
    const a2 = {
      ...a1,
      id: 'trk_a2',
      name: 'A2',
      bus: { volume: -3, pan: 0.2, effects: [createAudioEffect('compressor')] },
    }
    seq.tracks.push(a2)
    const asset = (id: string, path: string, channels: number): MediaAsset => ({
      id,
      name: id,
      path,
      kind: 'audio',
      duration: 6,
      width: null,
      height: null,
      fps: null,
      vfr: false,
      hasVideo: false,
      hasAudio: true,
      videoCodec: null,
      audioCodec: 'pcm_s16le',
      sampleRate: 48000,
      channels,
      size: 1,
      importedAt: '',
      sequenceId: null,
      color: null,
      alpha: false,
      rating: 0,
      tags: [],
      generator: null,
      marks: { in: null, out: null },
    })
    p.media = { v: asset('v', voice, 1), m: asset('m', music, 2) }
    const reverb = createAudioEffect('reverb')
    const eq = {
      ...createAudioEffect('eq'),
      params: { ...createAudioEffect('eq').params, lowCut: 100, highGain: 4 },
    }
    const v = createClip({
      mediaId: 'v',
      trackId: a1.id,
      start: 0,
      duration: 150,
      sourceIn: 0,
      sound: { ...defaultSound(), fadeIn: 10, fadeOut: 25, effects: [eq, reverb] },
    })
    const m = createClip({
      mediaId: 'm',
      trackId: a2.id,
      start: 0,
      duration: 150,
      sourceIn: 0,
      sound: {
        ...defaultSound(),
        volume: {
          value: 0,
          keys: [
            { frame: 0, value: 0, ease: 'linear' },
            { frame: 75, value: -10, ease: 'ease-out' },
          ],
        },
      },
    })
    seq.clips = { [v.id]: v, [m.id]: m }
    return { p, seq }
  }

  const loudness = (file: string) => {
    const res = spawnSync(
      ffmpeg,
      ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'],
      { encoding: 'utf8' },
    )
    return Number(/I:\s+(-?[\d.]+) LUFS/.exec(res.stderr)![1])
  }

  for (const target of [-14, -16, -23]) {
    it(`a mix with effects and reverb exports at ${target} LUFS within 0.5 LU`, async () => {
      const { p, seq } = project(target)
      const measure = buildLoudnessArgs(p, seq, dir)
      await writeImpulses(measure.impulses)
      const res = spawnSync(ffmpeg, measure.args, { encoding: 'utf8' })
      expect(res.status).toBe(0)
      const summary = parseLoudness(res.stderr)!
      const out = join(dir, `mix${target}.mp4`)
      const plan = buildExportPlan(p, seq, out, {
        ...defaultExportSettings,
        draft: true,
        irDir: dir,
        loudness: loudnessGain(summary, target),
      })
      const args = plan.args.filter(
        (a, i, all) => !(a === '-progress' || all[i - 1] === '-progress' || a === '-nostats'),
      )
      execFileSync(ffmpeg, ['-v', 'error', ...args.slice(1)], { stdio: 'pipe' })
      expect(Math.abs(loudness(out) - target)).toBeLessThanOrEqual(0.5)
    }, 60_000)
  }
})
