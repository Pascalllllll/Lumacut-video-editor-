import type { Clip, MediaAsset, Project, Sequence, Track } from '@engine/model'
import { sourceSpan, speedAt } from '@engine/speed'
import { framesToSeconds, secondsToFrames } from '@engine/time'
import { clipEnd, clipsOnTrack, portion, sequenceDuration } from '@engine/timeline'
import { join } from 'node:path'
import { dbToGain } from '@engine/audio'
import { busSound, clipSound, type AudioGraph } from './audio-filters'
import { defaultExportOptions, type ExportOptions } from '@shared/export'
import { defaultTransform } from '@engine/model'
import { encodeColor } from './colorspace'
import {
  audioEncode,
  containerArgs,
  gifFilter,
  NO_HARDWARE,
  outputSize,
  videoEncode,
  type HardwareEncoders,
} from './encode'

export type ExportSettings = {
  options: ExportOptions
  hardware: HardwareEncoders
  /** Fastest encoder settings, for tests and quick checks. */
  draft?: boolean
  /** Folder for reverb impulse files the graph reads. */
  irDir: string
  /** Gain from a loudness measurement, with a peak limit at -1 dBFS when the gain would clip. */
  loudness: { gainDb: number; limit: boolean } | null
}

export const defaultExportSettings: ExportSettings = {
  options: defaultExportOptions(),
  hardware: NO_HARDWARE,
  irDir: '',
  loudness: null,
}

/** A reverb impulse the graph reads; the caller writes it before running FFmpeg. */
export type ImpulseFile = { path: string; decay: number; predelay: number; sampleRate: number }

export type ExportPlan = { args: string[]; durationSeconds: number; impulses: ImpulseFile[] }

const MAX_DEPTH = 8
const sec = (n: number) => Math.max(0, n).toFixed(6)

/** Splits a speed change into atempo steps, each within the filter's 0.5 to 2 range. */
function atempo(speed: number): string[] {
  const steps: string[] = []
  let s = speed
  while (s > 2) {
    steps.push('atempo=2')
    s /= 2
  }
  while (s < 0.5) {
    steps.push('atempo=0.5')
    s /= 0.5
  }
  if (Math.abs(s - 1) > 1e-6) steps.push(`atempo=${s.toFixed(6)}`)
  return steps
}

/**
 * A ramped clip is exported as short pieces of constant speed (about a fifth
 * of a second each), which follows the curve closely without one FFmpeg input
 * per frame.
 */
function rampPieces(clip: Clip, fps: number): Clip[] {
  if (!clip.ramp) return [clip]
  const step = Math.max(2, Math.round(fps / 5))
  const pieces: Clip[] = []
  for (let from = 0; from < clip.duration; from += step) {
    const to = Math.min(clip.duration, from + step)
    const part = portion(clip, from, to)
    const speed = speedAt(clip, (from + to) / 2)
    pieces.push({ ...part, ramp: null, speed })
  }
  return pieces
}

class GraphBuilder implements AudioGraph {
  inputs: string[] = []
  filters: string[] = []
  impulses: ImpulseFile[] = []
  private inputCount: number
  private labelCount = 0

  constructor(
    private readonly project: Project,
    private readonly out: {
      width: number
      height: number
      rate: string
      fps: number
      sampleRate: number
    },
    /** Inputs already on the command line before the clips (the piped picture). */
    firstInput = 0,
    private readonly irDir = '',
  ) {
    this.inputCount = firstInput
  }

  label(prefix: string) {
    return `${prefix}${this.labelCount++}`
  }

  push(filter: string) {
    this.filters.push(filter)
  }

  reverbInput(decay: number, predelay: number): string {
    const sampleRate = this.out.sampleRate
    const name = `reverb-${decay.toFixed(2)}-${Math.round(predelay)}-${sampleRate}.wav`
    const path = join(this.irDir, name)
    if (!this.impulses.some((i) => i.path === path))
      this.impulses.push({ path, decay, predelay, sampleRate })
    return `${this.input(['-i', path])}:a`
  }

  input(args: string[]): number {
    this.inputs.push(...args)
    return this.inputCount++
  }

  private media(id: string): MediaAsset {
    const asset = this.project.media[id]
    if (!asset) throw new Error(`A clip points at media that is no longer in the project (${id}).`)
    return asset
  }

  private get conformVideo() {
    const { width: W, height: H, rate } = this.out
    return `fps=${rate},scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=bicubic,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1`
  }

  private get conformAudio() {
    return `aresample=${this.out.sampleRate},aformat=sample_fmts=fltp:channel_layouts=stereo`
  }

  private gapVideo(seconds: number, opaque: boolean): string {
    const { width: W, height: H, rate } = this.out
    const l = this.label('g')
    this.filters.push(
      `color=c=black${opaque ? '' : '@0'}:s=${W}x${H}:r=${rate}:d=${sec(seconds)},format=yuva420p[${l}]`,
    )
    return l
  }

  private gapAudio(seconds: number): string {
    const l = this.label('s')
    this.filters.push(
      `anullsrc=r=${this.out.sampleRate}:cl=stereo,atrim=duration=${sec(seconds)},${this.conformAudio}[${l}]`,
    )
    return l
  }

  /** Speed, direction and interpolation for a picture stream that has been cut to the clip's source range. */
  private videoTiming(clip: Clip, inLabel: string, seconds: number): string {
    const parts: string[] = ['setpts=PTS-STARTPTS']
    const frozen = clip.speed === 0
    if (frozen) {
      parts.push('trim=end_frame=1', 'loop=loop=-1:size=1:start=0', 'setpts=N/FRAME_RATE/TB')
    } else {
      if (clip.reverse) parts.push('reverse')
      if (Math.abs(clip.speed - 1) > 1e-6) parts.push(`setpts=PTS/${clip.speed.toFixed(6)}`)
      if (clip.speed < 1 && clip.interpolation !== 'none') {
        parts.push(
          clip.interpolation === 'blend'
            ? `minterpolate=fps=${this.out.rate}:mi_mode=blend`
            : `minterpolate=fps=${this.out.rate}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`,
        )
      }
    }
    parts.push(
      this.conformVideo,
      'format=yuva420p',
      'tpad=stop_mode=clone:stop_duration=1',
      `trim=duration=${sec(seconds)}`,
      'setpts=PTS-STARTPTS',
    )
    const l = this.label('c')
    this.filters.push(`[${inLabel}]${parts.join(',')}[${l}]`)
    return l
  }

  private audioTiming(clip: Clip, inLabel: string, seconds: number): string {
    const parts: string[] = ['asetpts=PTS-STARTPTS', this.conformAudio]
    if (clip.reverse) parts.push('areverse')
    parts.push(...atempo(clip.speed))
    parts.push(
      `apad=whole_dur=${sec(seconds)}`,
      `atrim=duration=${sec(seconds)}`,
      'asetpts=PTS-STARTPTS',
    )
    const l = this.label('d')
    this.filters.push(`[${inLabel}]${parts.join(',')}[${l}]`)
    return l
  }

  /** One clip's picture over its timeline range, as a labelled stream. */
  private clipVideo(seq: Sequence, clip: Clip, depth: number): string[] {
    const asset = this.media(clip.mediaId)
    return rampPieces(clip, this.out.fps).map((piece) => {
      const seconds = framesToSeconds(piece.duration, seq.fps)
      if (piece.speed === 0 && asset.kind !== 'image') {
        // A freeze needs only the one frame; take a short slice around it.
        const i = this.input([
          '-ss',
          sec(framesToSeconds(piece.sourceIn, seq.fps)),
          '-t',
          sec(1),
          '-i',
          asset.path,
        ])
        return this.videoTiming(piece, `${i}:v`, seconds)
      }
      if (asset.kind === 'image') {
        const i = this.input([
          '-loop',
          '1',
          '-framerate',
          this.out.rate,
          '-t',
          sec(seconds),
          '-i',
          asset.path,
        ])
        return this.videoTiming({ ...piece, speed: 1, reverse: false }, `${i}:v`, seconds)
      }
      const srcStart = framesToSeconds(piece.sourceIn, seq.fps)
      const srcLength = framesToSeconds(sourceSpan(piece), seq.fps)
      if (asset.kind === 'sequence') {
        const inner = asset.sequenceId ? this.project.sequences[asset.sequenceId] : undefined
        if (!inner) return this.gapVideo(seconds, false)
        const innerFrom = secondsToFrames(srcStart, inner.fps)
        const innerLength = Math.max(1, secondsToFrames(srcLength, inner.fps))
        const nested = this.sequenceVideo(inner, innerFrom, innerLength, depth + 1, clip.angle)
        return this.videoTiming(piece, nested, seconds)
      }
      if (!asset.hasVideo) return this.gapVideo(seconds, false)
      const i = this.input(['-ss', sec(srcStart), '-t', sec(srcLength), '-i', asset.path])
      return this.videoTiming(piece, `${i}:v`, seconds)
    })
  }

  /** One clip's sound over its timeline range: timed pieces joined, then its own effects, level, fades and pan. */
  private clipAudio(seq: Sequence, clip: Clip, depth: number): string {
    const asset = this.media(clip.mediaId)
    const pieces = rampPieces(clip, this.out.fps).map((piece) => {
      const seconds = framesToSeconds(piece.duration, seq.fps)
      if (piece.speed === 0 || !asset.hasAudio || asset.kind === 'image')
        return this.gapAudio(seconds)
      const srcStart = framesToSeconds(piece.sourceIn, seq.fps)
      const srcLength = framesToSeconds(sourceSpan(piece), seq.fps)
      if (asset.kind === 'sequence') {
        const inner = asset.sequenceId ? this.project.sequences[asset.sequenceId] : undefined
        if (!inner) return this.gapAudio(seconds)
        const nested = this.sequenceAudio(
          inner,
          secondsToFrames(srcStart, inner.fps),
          Math.max(1, secondsToFrames(srcLength, inner.fps)),
          depth + 1,
        )
        return this.audioTiming(piece, nested, seconds)
      }
      const i = this.input(['-ss', sec(srcStart), '-t', sec(srcLength), '-i', asset.path])
      let source = `${i}:a`
      if (asset.channels === 1) {
        // Players send mono to both sides at full level; FFmpeg's default upmix is 3 dB quieter.
        const l = this.label('mono')
        this.filters.push(`[${source}]pan=stereo|c0=c0|c1=c0[${l}]`)
        source = l
      }
      return this.audioTiming(piece, source, seconds)
    })
    let joined = pieces[0]!
    if (pieces.length > 1) {
      joined = this.label('p')
      this.filters.push(
        `${pieces.map((s) => `[${s}]`).join('')}concat=n=${pieces.length}:v=0:a=1[${joined}]`,
      )
    }
    return clipSound(this, clip.sound, joined, clip.duration, this.out.fps)
  }

  /** Clips of a track inside [from, from + length), cut to that window, in order. */
  private window(seq: Sequence, track: Track, from: number, length: number): Clip[] {
    const end = from + length
    return clipsOnTrack(seq, track.id)
      .filter((c) => clipEnd(c) > from && c.start < end)
      .map((c) => {
        const a = Math.max(from, c.start) - c.start
        const b = Math.min(end, clipEnd(c)) - c.start
        return a === 0 && b === c.duration ? c : portion(c, a, b)
      })
  }

  private track(
    seq: Sequence,
    track: Track,
    from: number,
    length: number,
    depth: number,
    opaque: boolean,
  ): string {
    const segments: string[] = []
    let cursor = from
    for (const clip of this.window(seq, track, from, length)) {
      if (clip.start > cursor)
        segments.push(this.gapVideo(framesToSeconds(clip.start - cursor, seq.fps), opaque))
      segments.push(...this.clipVideo(seq, clip, depth))
      cursor = clipEnd(clip)
    }
    if (cursor < from + length)
      segments.push(this.gapVideo(framesToSeconds(from + length - cursor, seq.fps), opaque))
    if (segments.length === 1) return segments[0]!
    const l = this.label('t')
    this.filters.push(
      `${segments.map((s) => `[${s}]`).join('')}concat=n=${segments.length}:v=1:a=0[${l}]`,
    )
    return l
  }

  /** The composited picture of a sequence window. `angle` shows only that video track (multicam). */
  sequenceVideo(
    seq: Sequence,
    from: number,
    length: number,
    depth: number,
    angle: number | null = null,
  ): string {
    if (depth > MAX_DEPTH) throw new Error('Sequences are nested too deeply to export.')
    const visible = seq.tracks
      .filter((t) => t.kind === 'video')
      .filter((t, i) => (angle === null ? !t.hidden : i === angle))
      .filter((t) => this.window(seq, t, from, length).length > 0)
    if (visible.length === 0) return this.gapVideo(framesToSeconds(length, seq.fps), true)
    let base = this.track(seq, visible[0]!, from, length, depth, true)
    for (const t of visible.slice(1)) {
      const layer = this.track(seq, t, from, length, depth, false)
      const l = this.label('o')
      this.filters.push(`[${base}][${layer}]overlay=format=auto:eof_action=pass[${l}]`)
      base = l
    }
    return base
  }

  sequenceAudio(seq: Sequence, from: number, length: number, depth: number): string {
    if (depth > MAX_DEPTH) throw new Error('Sequences are nested too deeply to export.')
    const audio = seq.tracks.filter((t) => t.kind === 'audio')
    const soloed = audio.some((t) => t.solo)
    const audible = audio
      .filter((t) => (soloed ? t.solo : !t.muted))
      .filter((t) => this.window(seq, t, from, length).length > 0)
    const seconds = framesToSeconds(length, seq.fps)
    if (audible.length === 0) return this.gapAudio(seconds)
    const trackLabels = audible.map((track) => {
      const segments: string[] = []
      let cursor = from
      for (const clip of this.window(seq, track, from, length)) {
        if (clip.start > cursor)
          segments.push(this.gapAudio(framesToSeconds(clip.start - cursor, seq.fps)))
        segments.push(this.clipAudio(seq, clip, depth))
        cursor = clipEnd(clip)
      }
      if (cursor < from + length)
        segments.push(this.gapAudio(framesToSeconds(from + length - cursor, seq.fps)))
      let joined = segments[0]!
      if (segments.length > 1) {
        joined = this.label('u')
        this.filters.push(
          `${segments.map((s) => `[${s}]`).join('')}concat=n=${segments.length}:v=0:a=1[${joined}]`,
        )
      }
      return busSound(this, track.bus, joined)
    })
    let mix = trackLabels[0]!
    if (trackLabels.length > 1) {
      mix = this.label('m')
      this.filters.push(
        `${trackLabels.map((s) => `[${s}]`).join('')}amix=inputs=${trackLabels.length}:duration=longest:normalize=0,atrim=duration=${sec(seconds)}[${mix}]`,
      )
    }
    return busSound(this, seq.master, mix)
  }
}

/** Loudness gain and the safety limiter at the end of the mix. */
function finishAudio(settings: ExportSettings): string {
  const l = settings.loudness
  if (!l || (Math.abs(l.gainDb) < 0.005 && !l.limit)) return 'anull'
  const parts = [`volume=${l.gainDb.toFixed(3)}dB`]
  if (l.limit) parts.push(`alimiter=limit=${dbToGain(-1).toFixed(6)}:attack=5:release=50:level=0`)
  return parts.join(',')
}

/**
 * An audio-only pass that measures the mix's loudness with FFmpeg's loudnorm
 * filter; the JSON summary arrives on stderr.
 */
export function buildLoudnessArgs(
  project: Project,
  sequence: Sequence,
  irDir: string,
  range?: { start: number; end: number },
): ExportPlan {
  return buildMixAnalysisArgs(project, sequence, irDir, 'loudnorm=print_format=json', range)
}

/** An audio-only pass over the mix through one analysis filter, which reports on stderr. */
export function buildMixAnalysisArgs(
  project: Project,
  sequence: Sequence,
  irDir: string,
  filter: string,
  range?: { start: number; end: number },
): ExportPlan {
  const total = sequenceDuration(sequence)
  const from = range ? Math.max(0, range.start) : 0
  const to = range ? Math.min(range.end, total) : total
  if (to - from <= 0) throw new Error('The sequence is empty, so there is nothing to analyze.')
  const { width, height, fps, sampleRate } = sequence
  const graph = new GraphBuilder(
    project,
    { width, height, rate: `${fps.num}/${fps.den}`, fps: fps.num / fps.den, sampleRate },
    0,
    irDir,
  )
  const audio = graph.sequenceAudio(sequence, from, to - from, 0)
  graph.filters.push(`[${audio}]${filter}[aout]`)
  const durationSeconds = framesToSeconds(to - from, fps)
  return {
    durationSeconds,
    impulses: graph.impulses,
    args: [
      '-hide_banner',
      '-nostdin',
      ...graph.inputs,
      '-filter_complex',
      graph.filters.join(';'),
      '-map',
      '[aout]',
      '-t',
      sec(durationSeconds),
      '-f',
      'null',
      '-',
    ],
  }
}

/** Silences from silencedetect's log, in seconds. */
export function parseSilences(stderr: string, total: number): [number, number][] {
  const out: [number, number][] = []
  let open: number | null = null
  for (const line of stderr.split('\n')) {
    const s = /silence_start: (-?[\d.]+)/.exec(line)
    if (s) open = Math.max(0, Number(s[1]))
    const e = /silence_end: ([\d.]+)/.exec(line)
    if (e && open !== null) {
      out.push([open, Number(e[1])])
      open = null
    }
  }
  // Silence running to the end has no end line.
  if (open !== null && total > open) out.push([open, total])
  return out
}

export type LoudnessSummary = { integrated: number; truePeak: number; range: number }

/** Reads loudnorm's JSON summary from FFmpeg's stderr. */
export function parseLoudness(stderr: string): LoudnessSummary | null {
  const start = stderr.lastIndexOf('{')
  const end = stderr.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    const j = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>
    if (!('input_i' in j)) return null
    // A silent mix reports -inf.
    const value = (v: string | undefined) => {
      const n = Number(v)
      return Number.isNaN(n) ? -Infinity : n
    }
    return {
      integrated: value(j['input_i']),
      truePeak: value(j['input_tp']),
      range: Math.max(0, value(j['input_lra'])),
    }
  } catch {
    return null
  }
}

/** The gain that brings a measured mix to `target` LUFS, limiting peaks above -1 dBTP. */
export function loudnessGain(summary: LoudnessSummary, target: number) {
  const gainDb = target - summary.integrated
  return { gainDb, limit: summary.truePeak + gainDb > -1 }
}

/** Output options shared by both export paths. */
function outputArgs(
  settings: ExportSettings,
  sequence: Sequence,
  graph: GraphBuilder,
  picture: string | null,
  from: 'graph' | 'rgba',
  sound: string | null,
  durationSeconds: number,
  output: string,
): string[] {
  const o = settings.options
  const rate = `${sequence.fps.num}/${sequence.fps.den}`
  const maps: string[] = []
  const global: string[] = []
  const codec: string[] = []
  if (picture && o.video !== 'none') {
    const v = videoEncode(
      o,
      { width: sequence.width, height: sequence.height, fps: rate },
      sequence,
      settings.hardware,
      from,
    )
    if (v.gif) graph.filters.push(gifFilter(picture, v.filter, 'vout'))
    else graph.filters.push(`[${picture}]${v.filter}[vout]`)
    maps.push('-map', '[vout]')
    global.push(...v.global)
    // Drafts (tests, previews) trade size for speed.
    const enc =
      settings.draft && v.codec[1] === 'libx264'
        ? [...v.codec.slice(0, 2), '-preset', 'ultrafast', '-crf', '28']
        : v.codec
    codec.push(...enc, ...v.tags, '-r', outputSize(o, { width: 0, height: 0, fps: rate }).fps)
  }
  if (sound && o.audio !== 'none') {
    graph.filters.push(`[${sound}]${finishAudio(settings)}[aout]`)
    maps.push('-map', '[aout]')
    codec.push(...audioEncode(o), '-ar', String(sequence.sampleRate))
  }
  if (!maps.length)
    throw new Error('This export has neither picture nor sound. Choose a video or audio format.')
  const target = o.container === 'png' ? join(output, 'frame_%05d.png') : output
  return [
    ...global,
    '|',
    '-filter_complex',
    graph.filters.join(';'),
    ...maps,
    ...codec,
    '-t',
    sec(durationSeconds),
    ...containerArgs(o),
    target,
  ]
}

/** Splits outputArgs around the inputs: global options go before them. */
function splitGlobal(args: string[]): [string[], string[]] {
  const at = args.indexOf('|')
  return [args.slice(0, at), args.slice(at + 1)]
}

/**
 * Turns a sequence (or the part between `range.start` and `range.end`) into
 * one FFmpeg command. Each clip becomes an input seeked with -ss/-t, timed for
 * its speed, conformed to the sequence size and rate, and joined per track
 * with transparent gaps; tracks are overlaid bottom to top. Audio tracks are
 * joined with silence and mixed. Nested sequences are built the same way,
 * recursively.
 */
export function buildExportPlan(
  project: Project,
  sequence: Sequence,
  output: string,
  settings: ExportSettings = defaultExportSettings,
  range?: { start: number; end: number },
): ExportPlan {
  const total = sequenceDuration(sequence)
  const from = range ? Math.max(0, range.start) : 0
  const to = range ? Math.min(range.end, total) : total
  if (to - from <= 0) throw new Error('The sequence is empty, so there is nothing to export.')
  const { width, height, fps, sampleRate } = sequence
  const rate = `${fps.num}/${fps.den}`
  const graph = new GraphBuilder(
    project,
    { width, height, rate, fps: fps.num / fps.den, sampleRate },
    0,
    settings.irDir,
  )
  const o = settings.options
  const video = o.video !== 'none' ? graph.sequenceVideo(sequence, from, to - from, 0) : null
  const audio = o.audio !== 'none' ? graph.sequenceAudio(sequence, from, to - from, 0) : null
  const durationSeconds = framesToSeconds(to - from, fps)
  const [global, rest] = splitGlobal(
    outputArgs(settings, sequence, graph, video, 'graph', audio, durationSeconds, output),
  )
  return {
    durationSeconds,
    impulses: graph.impulses,
    args: [
      '-hide_banner',
      '-nostdin',
      '-y',
      ...global,
      ...graph.inputs,
      ...rest.slice(0, -1),
      '-progress',
      'pipe:1',
      '-nostats',
      rest[rest.length - 1]!,
    ],
  }
}

/**
 * Encoder command for compositor exports: the picture arrives as raw RGBA
 * frames on stdin, the sound is mixed from the clips as in the FFmpeg-only path.
 */
export function buildEncodeArgs(
  project: Project,
  sequence: Sequence,
  output: string,
  settings: ExportSettings = defaultExportSettings,
  range?: { start: number; end: number },
): ExportPlan & { frames: number; start: number } {
  const total = sequenceDuration(sequence)
  const from = range ? Math.max(0, range.start) : 0
  const to = range ? Math.min(range.end, total) : total
  if (to - from <= 0) throw new Error('The sequence is empty, so there is nothing to export.')
  const { width, height, fps, sampleRate } = sequence
  const rate = `${fps.num}/${fps.den}`
  const graph = new GraphBuilder(
    project,
    { width, height, rate, fps: fps.num / fps.den, sampleRate },
    1,
    settings.irDir,
  )
  const o = settings.options
  const audio = o.audio !== 'none' ? graph.sequenceAudio(sequence, from, to - from, 0) : null
  const durationSeconds = framesToSeconds(to - from, fps)
  // RGBA from the compositor is full-range RGB in the sequence's colour space.
  const color = encodeColor(sequence)
  const [global, rest] = splitGlobal(
    outputArgs(settings, sequence, graph, '0:v', 'rgba', audio, durationSeconds, output),
  )
  return {
    frames: to - from,
    start: from,
    durationSeconds,
    impulses: graph.impulses,
    args: [
      '-hide_banner',
      '-nostdin',
      '-y',
      ...global,
      '-f',
      'rawvideo',
      '-pix_fmt',
      color.inputPixFmt,
      '-s',
      `${width}x${height}`,
      '-framerate',
      rate,
      '-i',
      'pipe:0',
      ...graph.inputs,
      ...rest,
    ],
  }
}

/**
 * Smart render: when the sequence is one clip playing a file unchanged from its
 * start, in a format the export would produce anyway, the streams are copied
 * instead of encoded. Returns null when anything would differ.
 */
export function buildCopyPlan(
  project: Project,
  sequence: Sequence,
  output: string,
  settings: ExportSettings,
  sourceCodec: { video: string | null; audio: string | null },
): ExportPlan | null {
  const o = settings.options
  if (!o.smart || settings.loudness) return null
  const clips = Object.values(sequence.clips)
  const pictures = clips.filter(
    (c) => sequence.tracks.find((t) => t.id === c.trackId)?.kind === 'video',
  )
  if (pictures.length !== 1) return null
  const clip = pictures[0]!
  const asset = project.media[clip.mediaId]
  if (!asset || asset.kind !== 'video' || !asset.fps || asset.vfr) return null
  // Only the clip and its own linked sound, untouched, from the first frame.
  const others = clips.filter((c) => c.id !== clip.id)
  if (
    others.some(
      (c) =>
        c.linkId !== clip.linkId ||
        c.mediaId !== clip.mediaId ||
        c.start !== clip.start ||
        c.duration !== clip.duration ||
        c.sourceIn !== clip.sourceIn,
    )
  )
    return null
  const plain = (c: Clip) =>
    c.start === 0 &&
    c.sourceIn === 0 &&
    c.speed === 1 &&
    !c.ramp &&
    !c.reverse &&
    c.effects.length === 0 &&
    c.masks.length === 0 &&
    c.grade.length === 0 &&
    c.blend === 'normal' &&
    JSON.stringify(c.transform) === JSON.stringify(defaultTransform())
  const plainSound = (c: Clip) =>
    c.sound.gain === 0 &&
    c.sound.volume.value === 0 &&
    c.sound.volume.keys.length === 0 &&
    c.sound.pan === 0 &&
    c.sound.fadeIn === 0 &&
    c.sound.fadeOut === 0 &&
    c.sound.effects.length === 0
  if (!plain(clip) || !others.every((c) => plain(c) && plainSound(c))) return null
  if (
    sequence.tracks.some(
      (t) => t.kind === 'audio' && (t.bus.volume !== 0 || t.bus.pan !== 0 || t.bus.effects.length),
    ) ||
    sequence.master.effects.length ||
    sequence.master.volume !== 0
  )
    return null
  if (
    Object.keys(sequence.transitions).length ||
    (sequence.captions.show && sequence.captions.cues.length)
  )
    return null
  if (
    sequence.width !== asset.width ||
    sequence.height !== asset.height ||
    sequence.fps.num * asset.fps.den !== asset.fps.num * sequence.fps.den
  )
    return null
  if (o.width || o.height || o.fps || o.alpha) return null
  const videoMatch = {
    h264: 'h264',
    hevc: 'hevc',
    av1: 'av1',
    prores: 'prores',
    vp9: 'vp9',
  } as Record<string, string>
  const audioMatch = { aac: 'aac', opus: 'opus', mp3: 'mp3', flac: 'flac' } as Record<
    string,
    string
  >
  if (videoMatch[o.video] !== sourceCodec.video) return null
  const withSound = o.audio !== 'none' && others.length > 0
  if (withSound && audioMatch[o.audio] !== sourceCodec.audio) return null
  const durationSeconds = framesToSeconds(clip.duration, sequence.fps)
  return {
    durationSeconds,
    impulses: [],
    args: [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i',
      asset.path,
      '-map',
      '0:v:0',
      ...(withSound ? ['-map', '0:a:0'] : []),
      '-c',
      'copy',
      '-t',
      sec(durationSeconds),
      ...containerArgs(o),
      '-progress',
      'pipe:1',
      '-nostats',
      output,
    ],
  }
}
