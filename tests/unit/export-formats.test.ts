import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { activeSequence, createClip, createProject, type MediaAsset } from '@engine/model'
import { normalizeOptions, presetOptions, type ExportOptions } from '@shared/export'
import { buildCopyPlan, buildExportPlan, defaultExportSettings } from '../../src/media/export-plan'

const bin = join('resources', 'bin', `${process.platform}-${process.arch}`)
const ffmpeg = join(bin, 'ffmpeg')
const ffprobe = join(bin, 'ffprobe')

describe.skipIf(!existsSync(ffmpeg))('export formats', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumacut-formats-'))
  const source = join(dir, 'source.mp4')
  execFileSync(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x180:r=25:d=1',
    '-f',
    'lavfi',
    '-i',
    'sine=f=440:r=48000:d=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '25',
    '-c:a',
    'aac',
    '-shortest',
    source,
  ])
  const asset: MediaAsset = {
    id: 'm',
    name: 'source.mp4',
    path: source,
    kind: 'video',
    duration: 1,
    width: 320,
    height: 180,
    fps: { num: 25, den: 1 },
    vfr: false,
    hasVideo: true,
    hasAudio: true,
    videoCodec: 'h264',
    audioCodec: 'aac',
    sampleRate: 48000,
    channels: 1,
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
  function project() {
    const p = createProject('f')
    const seq = activeSequence(p)
    Object.assign(seq, { width: 320, height: 180, fps: { num: 25, den: 1 }, sampleRate: 48000 })
    const v1 = seq.tracks.find((t) => t.kind === 'video')!
    const a1 = seq.tracks.find((t) => t.kind === 'audio')!
    p.media = { m: asset }
    const v = createClip({
      mediaId: 'm',
      trackId: v1.id,
      start: 0,
      duration: 25,
      sourceIn: 0,
      linkId: 'l',
    })
    const a = createClip({
      mediaId: 'm',
      trackId: a1.id,
      start: 0,
      duration: 25,
      sourceIn: 0,
      linkId: 'l',
    })
    seq.clips = { [v.id]: v, [a.id]: a }
    return { p, seq }
  }
  const probe = (file: string) =>
    JSON.parse(
      execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', file], {
        encoding: 'utf8',
      }),
    ) as {
      streams: {
        codec_type: string
        codec_name: string
        pix_fmt?: string
        width?: number
        height?: number
      }[]
    }
  const run = (options: ExportOptions, name: string) => {
    const { p, seq } = project()
    const out = join(dir, name)
    if (options.container === 'png') mkdirSync(out, { recursive: true })
    const plan = buildExportPlan(p, seq, out, {
      ...defaultExportSettings,
      options: normalizeOptions(options),
      draft: true,
    })
    execFileSync(
      ffmpeg,
      plan.args.filter(
        (a, i, all) => !(a === '-progress' || all[i - 1] === '-progress' || a === '-nostats'),
      ),
      { stdio: 'pipe' },
    )
    return out
  }

  const cases: [string, Partial<ExportOptions>, string, string | null][] = [
    ['youtube.mp4', presetOptions('youtube'), 'h264', 'aac'],
    ['small.mp4', presetOptions('web-small'), 'hevc', 'aac'],
    [
      'av1.webm',
      { ...presetOptions('youtube'), container: 'webm', video: 'av1', audio: 'opus' },
      'av1',
      'opus',
    ],
    ['master.mov', presetOptions('master'), 'prores', 'pcm_s24le'],
    ['dnx.mov', { ...presetOptions('master'), video: 'dnxhr' }, 'dnxhd', 'pcm_s24le'],
    [
      'web.webm',
      { ...presetOptions('youtube'), container: 'webm', video: 'vp9', audio: 'opus' },
      'vp9',
      'opus',
    ],
    ['song.mp3', { ...presetOptions('audio'), container: 'mp3', audio: 'mp3' }, 'mp3', null],
    ['sound.wav', presetOptions('audio'), 'pcm_s24le', null],
  ]
  for (const [name, opts, video, audio] of cases) {
    it(`${name}: ${video}${audio ? ` + ${audio}` : ''}`, () => {
      const out = run({ ...presetOptions('youtube'), ...opts } as ExportOptions, name)
      const streams = probe(out).streams
      expect(streams[0]!.codec_name).toBe(video)
      if (audio) expect(streams.find((s) => s.codec_type === 'audio')?.codec_name).toBe(audio)
    }, 60_000)
  }

  it('vertical presets fill a 9:16 frame', () => {
    const out = run(presetOptions('tiktok'), 'tiktok.mp4')
    expect(probe(out).streams[0]).toMatchObject({ width: 1080, height: 1920 })
  }, 60_000)

  it('GIF exports are palette-based and silent', () => {
    const streams = probe(run(presetOptions('gif'), 'clip.gif')).streams
    expect(streams).toHaveLength(1)
    expect(streams[0]).toMatchObject({ codec_name: 'gif', width: 480 })
  }, 60_000)

  it('image sequences write numbered PNGs', () => {
    const out = run({ ...presetOptions('png'), fps: 5 }, 'frames')
    expect(readdirSync(out).filter((f) => f.endsWith('.png')).length).toBe(5)
  }, 60_000)

  it('smart render copies an untouched clip and refuses anything else', () => {
    const { p, seq } = project()
    const settings = { ...defaultExportSettings, options: presetOptions('youtube') }
    const plan = buildCopyPlan(p, seq, join(dir, 'copy.mp4'), settings, {
      video: 'h264',
      audio: 'aac',
    })
    expect(plan?.args).toContain('copy')
    execFileSync(
      ffmpeg,
      plan!.args.filter(
        (a, i, all) => !(a === '-progress' || all[i - 1] === '-progress' || a === '-nostats'),
      ),
    )
    expect(probe(join(dir, 'copy.mp4')).streams.map((s) => s.codec_name)).toEqual(['h264', 'aac'])
    const moved = {
      ...seq,
      clips: Object.fromEntries(
        Object.entries(seq.clips).map(([k, c]) => [k, { ...c, sourceIn: 5 }]),
      ),
    }
    expect(
      buildCopyPlan(p, moved, join(dir, 'x.mp4'), settings, { video: 'h264', audio: 'aac' }),
    ).toBeNull()
    expect(
      buildCopyPlan(
        p,
        seq,
        join(dir, 'x.mp4'),
        { ...settings, options: presetOptions('web-small') },
        { video: 'h264', audio: 'aac' },
      ),
    ).toBeNull()
  })
})
