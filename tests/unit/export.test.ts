import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { execute, type HistoryState } from '@engine/history'
import {
  activeSequence,
  createClip,
  createProject,
  createSequence,
  createTrack,
  sequenceAsset,
} from '@engine/model'
import { secondsToWholeFrames } from '@engine/time'
import { assetFromProbe, type ProbeOutput } from '../../src/media/probe'
import { buildExportPlan, defaultExportSettings } from '../../src/media/export-plan'

const bin = join('resources', 'bin', `${process.platform}-${process.arch}`)
const ffmpeg = join(bin, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const ffprobe = join(bin, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
const haveFfmpeg = existsSync(ffmpeg) && existsSync(ffprobe)

function probe(path: string): ProbeOutput {
  return JSON.parse(
    execFileSync(
      ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
      { encoding: 'utf8' },
    ),
  ) as ProbeOutput
}

describe('probe parsing', () => {
  it('reads a video with audio', () => {
    const asset = assetFromProbe(
      {
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 3840,
            height: 2160,
            avg_frame_rate: '30000/1001',
          },
          { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
        ],
        format: { duration: '12.5' },
      },
      { id: 'm', path: '/x/a.mp4', size: 5, now: 'now' },
    )
    expect(asset).toMatchObject({
      kind: 'video',
      duration: 12.5,
      fps: { num: 30000, den: 1001 },
      hasAudio: true,
      name: 'a.mp4',
    })
  })
  it('treats a PNG as an image without duration', () => {
    const asset = assetFromProbe(
      {
        streams: [
          { codec_type: 'video', codec_name: 'png', width: 10, height: 10, nb_frames: '1' },
        ],
        format: {},
      },
      { id: 'm', path: '/x/a.png', size: 5, now: 'now' },
    )
    expect(asset).toMatchObject({ kind: 'image', duration: null, fps: null })
  })
  it('ignores cover art in audio files', () => {
    const asset = assetFromProbe(
      {
        streams: [
          { codec_type: 'audio', codec_name: 'mp3', sample_rate: '44100', channels: 2 },
          { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
        ],
        format: { duration: '200' },
      },
      { id: 'm', path: '/x/song.mp3', size: 5, now: 'now' },
    )
    expect(asset.kind).toBe('audio')
  })
  it('refuses files with no streams', () => {
    expect(() =>
      assetFromProbe({ streams: [] }, { id: 'm', path: '/x/a.txt', size: 1, now: 'now' }),
    ).toThrow(/no video or audio/)
  })
})

describe.skipIf(!haveFfmpeg)('export with FFmpeg', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumacut-export-'))
  const source = join(dir, 'source-4k.mp4')
  const small = join(dir, 'small.mp4')
  const grab = (file: string, at: number) =>
    execFileSync(ffmpeg, [
      '-v',
      'error',
      '-ss',
      String(at),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      'scale=64:36',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      '-',
    ])
  const diff = (a: Buffer, b: Buffer) =>
    a.reduce((sum, v, i) => sum + Math.abs(v - (b[i] ?? 0)), 0) / a.length
  const run = (args: string[]) =>
    execFileSync(
      ffmpeg,
      args.filter(
        (a, i, all) => !(a === '-progress' || all[i - 1] === '-progress' || a === '-nostats'),
      ),
      { stdio: 'pipe' },
    )
  const fast = { ...defaultExportSettings, draft: true }

  function project(path: string) {
    const p = createProject('Export test')
    const seq = activeSequence(p)
    const asset = assetFromProbe(probe(path), {
      id: 'm1',
      path,
      size: statSync(path).size,
      now: 'now',
    })
    let state: HistoryState = { project: p, past: [], future: [] }
    state = execute(state, { type: 'media.add', assets: [asset] })
    return { state, seq, asset, v1: seq.tracks[0]!.id, a1: seq.tracks[1]!.id }
  }

  it('cuts a 4K clip into three, reorders the parts, and exports the right length', () => {
    execFileSync(ffmpeg, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=3840x2160:rate=30:duration=6',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=6',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      source,
    ])
    const { state: s0, seq, asset, v1, a1 } = project(source)
    expect(asset).toMatchObject({ kind: 'video', width: 3840, height: 2160 })
    const frames = secondsToWholeFrames(asset.duration!, seq.fps)
    let state = execute(s0, {
      type: 'clip.add',
      sequenceId: seq.id,
      clips: [
        createClip({
          id: 'c1',
          mediaId: 'm1',
          trackId: v1,
          start: 0,
          duration: frames,
          sourceIn: 0,
          linkId: 'L',
        }),
        createClip({
          id: 'a1',
          mediaId: 'm1',
          trackId: a1,
          start: 0,
          duration: frames,
          sourceIn: 0,
          linkId: 'L',
        }),
      ],
    })
    state = execute(state, {
      type: 'clip.split',
      sequenceId: seq.id,
      clipId: 'c1',
      frame: 60,
      newClipId: 'c2',
    })
    state = execute(state, {
      type: 'clip.split',
      sequenceId: seq.id,
      clipId: 'c2',
      frame: 120,
      newClipId: 'c3',
    })
    state = execute(state, {
      type: 'batch',
      label: 'Reorder',
      commands: [
        { type: 'clip.move', sequenceId: seq.id, moves: [{ clipId: 'c1', start: frames }] },
        { type: 'clip.move', sequenceId: seq.id, moves: [{ clipId: 'c3', start: 0 }] },
        { type: 'clip.move', sequenceId: seq.id, moves: [{ clipId: 'c1', start: frames - 60 }] },
      ],
    })
    const output = join(dir, 'out.mp4')
    run(buildExportPlan(state.project, activeSequence(state.project), output, fast).args)
    const result = probe(output)
    expect(result.streams!.find((s) => s.codec_type === 'video')).toMatchObject({
      codec_name: 'h264',
      width: 1920,
      height: 1080,
    })
    expect(result.streams!.some((s) => s.codec_type === 'audio')).toBe(true)
    expect(Number(result.format!.duration)).toBeCloseTo(6, 1)
    // The first frame of the output comes from the source's last part (4 s onward).
    expect(diff(grab(output, 0), grab(source, 4))).toBeLessThan(
      diff(grab(output, 0), grab(source, 0)),
    )
  }, 120_000)

  it('stacks tracks, applies speed and reverse, honours mute and hide, and renders nested sequences', () => {
    execFileSync(ffmpeg, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=30:duration=4',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=500:sample_rate=48000:duration=4',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      small,
    ])
    const { state: s0, seq, v1, a1 } = project(small)
    const v2 = createTrack('video', 'V2')
    let state = execute(s0, { type: 'track.add', sequenceId: seq.id, track: v2 })
    state = execute(state, {
      type: 'clip.add',
      sequenceId: seq.id,
      clips: [
        createClip({
          id: 'base',
          mediaId: 'm1',
          trackId: v1,
          start: 0,
          duration: 120,
          sourceIn: 0,
        }),
        createClip({
          id: 'top',
          mediaId: 'm1',
          trackId: v2.id,
          start: 30,
          duration: 30,
          sourceIn: 0,
        }),
        createClip({ id: 'snd', mediaId: 'm1', trackId: a1, start: 0, duration: 120, sourceIn: 0 }),
      ],
    })
    state = execute(state, {
      type: 'clip.speed',
      sequenceId: seq.id,
      clipId: 'base',
      speed: 2,
      reverse: true,
      ramp: null,
      interpolation: 'none',
      ripple: false,
    })
    expect(activeSequence(state.project).clips['base']!.duration).toBe(60)

    // Nest the whole sequence into a second one and export that.
    const outer = createSequence('Outer', { width: 640, height: 360 })
    const item = Object.values(state.project.media).find(
      (m) => m.kind === 'sequence' && m.sequenceId === seq.id,
    )!
    state = execute(state, { type: 'sequence.add', sequence: outer, asset: sequenceAsset(outer) })
    state = execute(state, {
      type: 'clip.add',
      sequenceId: outer.id,
      clips: [
        createClip({
          id: 'n',
          mediaId: item.id,
          trackId: outer.tracks[0]!.id,
          start: 0,
          duration: 120,
          sourceIn: 0,
        }),
        createClip({
          id: 'na',
          mediaId: item.id,
          trackId: outer.tracks[1]!.id,
          start: 0,
          duration: 120,
          sourceIn: 0,
        }),
      ],
    })
    const output = join(dir, 'nested.mp4')
    const plan = buildExportPlan(state.project, state.project.sequences[outer.id]!, output, fast)
    expect(plan.args.join(' ')).toMatch(/overlay=/)
    expect(plan.args.join(' ')).toMatch(/reverse/)
    run(plan.args)
    expect(Number(probe(output).format!.duration)).toBeCloseTo(4, 1)
    // At 0.1 s the reversed 2x base shows the end of the source.
    expect(diff(grab(output, 0.1), grab(small, 3.8))).toBeLessThan(
      diff(grab(output, 0.1), grab(small, 0.2)),
    )

    // Hiding V2 and muting A1 changes the plan.
    state = execute(state, {
      type: 'track.update',
      sequenceId: seq.id,
      trackId: v2.id,
      patch: { hidden: true },
    })
    state = execute(state, {
      type: 'track.update',
      sequenceId: seq.id,
      trackId: a1,
      patch: { muted: true },
    })
    const quiet = buildExportPlan(
      state.project,
      activeSequence(state.project),
      join(dir, 'q.mp4'),
      fast,
    )
    expect(quiet.args.join(' ')).not.toMatch(/overlay=/)
    expect(quiet.args.join(' ')).toMatch(/anullsrc/)
  }, 120_000)
})
