import { describe, expect, it } from 'vitest'
import { clipGainAt, createAudioEffect, dbToGain, levelBreakpoints, panMatrix } from '@engine/audio'
import { duckCommand, duckedVolume, speechRanges } from '@engine/ducking'
import { execute, type HistoryState } from '@engine/history'
import { migrateProject } from '@engine/migrations'
import {
  activeSequence,
  createClip,
  createProject,
  defaultSound,
  type Clip,
  type MediaAsset,
} from '@engine/model'
import { findBeats } from '../../src/audio/beats'
import { reverbImpulse } from '../../src/audio/dsp'
import { LoudnessMeter } from '../../src/audio/loudness'
import { loudnessGain, parseLoudness } from '../../src/media/export-plan'

const clipWith = (sound: Partial<Clip['sound']>, duration = 100): Clip =>
  createClip({
    mediaId: 'm',
    trackId: 't',
    start: 0,
    duration,
    sourceIn: 0,
    sound: { ...defaultSound(), ...sound },
  })

describe('clip levels', () => {
  it('adds gain and volume in dB and fades linearly', () => {
    const clip = clipWith({ gain: -6, fadeIn: 10, fadeOut: 20 })
    expect(clipGainAt(clip, 50)).toBeCloseTo(dbToGain(-6), 6)
    expect(clipGainAt(clip, 5)).toBeCloseTo(dbToGain(-6) * 0.5, 6)
    expect(clipGainAt(clip, 90)).toBeCloseTo(dbToGain(-6) * 0.5, 6)
    expect(clipGainAt(clip, 0)).toBe(0)
  })

  it('turns eased volume keys into straight segments for export', () => {
    const clip = clipWith({
      volume: {
        value: 0,
        keys: [
          { frame: 10, value: 0, ease: 'ease-in' },
          { frame: 30, value: -20, ease: 'linear' },
        ],
      },
    })
    const pts = levelBreakpoints(clip.sound, clip.duration)
    expect(pts[0]).toEqual([0, 0])
    expect(pts[pts.length - 1]).toEqual([100, -20])
    expect(pts.length).toBe(1 + 1 + 7 + 1 + 1)
  })

  it('pans like a stereo panner: centre passes through, full left folds right in', () => {
    panMatrix(0)
      .flat()
      .forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 1][i]!, 9))
    const [[ll, lr], [rl, rr]] = panMatrix(-1)
    expect([ll, lr, rl]).toEqual([1, 1, 0])
    expect(rr).toBeCloseTo(0, 9)
  })
})

describe('sound through edits', () => {
  function setup() {
    const project = createProject('p')
    const seq = activeSequence(project)
    const a1 = seq.tracks.find((t) => t.kind === 'audio')!
    const asset: MediaAsset = {
      id: 'm1',
      name: 'a.wav',
      path: '/a.wav',
      kind: 'audio',
      duration: 100,
      width: null,
      height: null,
      fps: null,
      vfr: false,
      hasVideo: false,
      hasAudio: true,
      videoCodec: null,
      audioCodec: 'pcm_s16le',
      sampleRate: 48000,
      channels: 2,
      size: 1,
      importedAt: '',
      sequenceId: null,
      color: null,
      alpha: false,
      rating: 0,
      tags: [],
      generator: null,
      marks: { in: null, out: null },
    }
    const clip = createClip({
      mediaId: 'm1',
      trackId: a1.id,
      start: 0,
      duration: 100,
      sourceIn: 0,
      sound: {
        ...defaultSound(),
        fadeIn: 10,
        fadeOut: 10,
        volume: { value: 0, keys: [{ frame: 40, value: -6, ease: 'linear' }] },
      },
    })
    let state: HistoryState = { project, past: [], future: [] }
    state = execute(state, { type: 'media.add', assets: [asset] })
    state = execute(state, { type: 'clip.add', sequenceId: seq.id, clips: [clip] })
    return { state, seq, clip }
  }

  it('a split keeps the fades on the outer ends', () => {
    const { state, seq, clip } = setup()
    const after = execute(state, {
      type: 'clip.split',
      sequenceId: seq.id,
      clipId: clip.id,
      frame: 50,
    })
    const clips = Object.values(activeSequence(after.project).clips).sort(
      (a, b) => a.start - b.start,
    )
    expect(clips.map((c) => [c.sound.fadeIn, c.sound.fadeOut])).toEqual([
      [10, 0],
      [0, 10],
    ])
    // Keys count from each piece's start.
    expect(clips[1]!.sound.volume.keys[0]!.frame).toBe(-10)
  })

  it('trimming the start moves volume keys with the sound', () => {
    const { state, seq, clip } = setup()
    const after = execute(state, {
      type: 'clip.trim',
      sequenceId: seq.id,
      clipId: clip.id,
      edge: 'start',
      frame: 20,
    })
    const c = activeSequence(after.project).clips[clip.id]!
    expect(c.sound.volume.keys[0]!.frame).toBe(20)
    expect(c.sound.fadeIn).toBe(10)
  })

  it('older projects open with neutral sound settings', () => {
    const project = createProject('old')
    const raw = JSON.parse(JSON.stringify(project)) as Record<string, unknown>
    raw['schemaVersion'] = 4
    const seq = (raw['sequences'] as Record<string, Record<string, unknown>>)[
      project.activeSequenceId
    ]!
    delete seq['master']
    delete seq['loudnessTarget']
    for (const t of seq['tracks'] as Record<string, unknown>[]) {
      delete t['bus']
      delete t['role']
    }
    const migrated = migrateProject(raw)
    const s = activeSequence(migrated)
    expect(s.master).toEqual({ volume: 0, pan: 0, effects: [] })
    expect(s.loudnessTarget).toBeNull()
    expect(s.tracks[1]!.bus.volume).toBe(0)
  })
})

describe('ducking', () => {
  it('dips music under speech and ramps back', () => {
    const project = createProject('d')
    const seq = activeSequence(project)
    const dialogue = { ...seq.tracks.find((t) => t.kind === 'audio')!, role: 'dialogue' as const }
    const musicTrack = { ...dialogue, id: 'trk_music', name: 'A2', role: 'music' as const }
    seq.tracks = [...seq.tracks.filter((t) => t.kind === 'video'), dialogue, musicTrack]
    const asset = (id: string) =>
      ({ id, kind: 'audio', hasAudio: true, path: `/${id}`, duration: 10 }) as MediaAsset
    project.media = { voice: asset('voice'), song: asset('song') }
    const voice = createClip({
      mediaId: 'voice',
      trackId: dialogue.id,
      start: 0,
      duration: 250,
      sourceIn: 0,
    })
    const song = createClip({
      mediaId: 'song',
      trackId: musicTrack.id,
      start: 0,
      duration: 250,
      sourceIn: 0,
    })
    seq.clips = { [voice.id]: voice, [song.id]: song }
    // 25 fps sequence; speech from 2 s to 4 s.
    seq.fps = { num: 25, den: 1 }
    const peaks = new Uint8Array(1000)
    peaks.fill(200, 200, 400)
    const ranges = speechRanges(project, seq, (id) =>
      id === 'voice' ? { rate: 100, peaks } : undefined,
    )
    expect(ranges).toEqual([[50, 100]])
    const vol = duckedVolume(song, ranges, -12, 8)
    expect(vol.keys.map((k) => [k.frame, k.value])).toEqual([
      [42, 0],
      [50, -12],
      [100, -12],
      [108, 0],
    ])
    const cmd = duckCommand(project, seq, (id) =>
      id === 'voice' ? { rate: 100, peaks } : undefined,
    )
    expect(cmd?.type).toBe('batch')
  })
})

describe('beats', () => {
  it('finds a steady 120 BPM click and where it lands', () => {
    const rate = 22050
    const samples = new Float32Array(rate * 12)
    const first = 0.13
    let seed = 1
    for (let beat = first; beat < 12; beat += 0.5) {
      const at = Math.round(beat * rate)
      for (let i = 0; i < 400 && at + i < samples.length; i++) {
        seed = (seed * 16807) % 2147483647
        samples[at + i] = ((seed / 2147483647) * 2 - 1) * Math.exp(-i / 80)
      }
    }
    const { bpm, times } = findBeats(samples, rate)
    expect(Math.abs(bpm - 120)).toBeLessThan(1.5)
    expect(times.length).toBeGreaterThanOrEqual(22)
    for (const t of times) {
      const phase = (t - first) / 0.5
      expect(Math.abs(phase - Math.round(phase)) * 0.5).toBeLessThan(0.03)
    }
  })
})

describe('loudness', () => {
  it('reads a -20 dBFS 1 kHz tone on both channels as -20 LUFS', () => {
    const rate = 48000
    const n = rate * 5
    const l = new Float32Array(n)
    for (let i = 0; i < n; i++) l[i] = dbToGain(-20) * Math.sin((2 * Math.PI * 997 * i) / rate)
    const meter = new LoudnessMeter(rate)
    meter.push(l, l.slice())
    const r = meter.read()
    expect(r.integrated).toBeCloseTo(-20, 1)
    expect(r.momentary).toBeCloseTo(-20, 1)
    expect(r.peak).toBeCloseTo(-20, 1)
  })

  it('leaves silence unmeasured', () => {
    const meter = new LoudnessMeter(48000)
    meter.push(new Float32Array(48000), new Float32Array(48000))
    expect(meter.read().integrated).toBe(-Infinity)
  })

  it('reads loudnorm output and works out the gain', () => {
    const summary = parseLoudness(
      'stuff\n[Parsed_loudnorm_0 @ 0x1]\n{\n "input_i" : "-23.40",\n "input_tp" : "-4.10",\n "input_lra" : "6.00",\n "input_thresh" : "-33.5"\n}\n',
    )!
    expect(summary).toEqual({ integrated: -23.4, truePeak: -4.1, range: 6 })
    expect(loudnessGain(summary, -14)).toEqual({
      gainDb: expect.closeTo(9.4, 6) as number,
      limit: true,
    })
    expect(loudnessGain(summary, -23).limit).toBe(false)
    expect(
      parseLoudness('{ "input_i" : "-inf", "input_tp" : "-inf", "input_lra" : "0.00" }')
        ?.integrated,
    ).toBe(-Infinity)
  })
})

describe('reverb impulse', () => {
  it('is the same every time and has unit energy', () => {
    const [a] = reverbImpulse(1.2, 20, 48000)
    const [b] = reverbImpulse(1.2, 20, 48000)
    expect(a).toEqual(b)
    expect(a.slice(0, 960).every((v) => v === 0)).toBe(true)
    expect(a.reduce((s, v) => s + v * v, 0)).toBeCloseTo(1, 4)
  })
  it('makes every effect with defaults', () => {
    expect(createAudioEffect('compressor').params['ratio']).toBe(4)
  })
})
