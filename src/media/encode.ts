import type { ExportOptions } from '@shared/export'
import { encodeColor, type ColorTarget } from './colorspace'

/** Hardware encoders that passed a test encode on this machine, by codec. */
export type HardwareEncoders = {
  h264: string | null
  hevc: string | null
  av1: string | null
  /** VAAPI encoders need the render device. */
  vaapiDevice: string | null
}

export const NO_HARDWARE: HardwareEncoders = {
  h264: null,
  hevc: null,
  av1: null,
  vaapiDevice: null,
}

type Quality = ExportOptions['quality']
const pick = (q: Quality, high: number, balanced: number, small: number) =>
  String(q === 'high' ? high : q === 'balanced' ? balanced : small)

export type OutputSize = { width: number; height: number; fps: string }

/** The frame size and rate an export comes out at. */
export function outputSize(
  o: ExportOptions,
  seq: { width: number; height: number; fps: string },
): OutputSize {
  let width = o.width ?? seq.width
  let height = o.height ?? seq.height
  if (o.width && !o.height) height = Math.round((seq.height * o.width) / seq.width / 2) * 2
  if (o.height && !o.width) width = Math.round((seq.width * o.height) / seq.height / 2) * 2
  return {
    width: width - (width % 2),
    height: height - (height % 2),
    fps: o.fps ? String(o.fps) : seq.fps,
  }
}

export type VideoEncode = {
  /** Filters from the composited picture to the encoder's input (size, rate, pixel format). */
  filter: string
  /** Encoder and its settings. */
  codec: string[]
  /** Colour tags and similar output options. */
  tags: string[]
  /** Options that go before the inputs (a hardware device). */
  global: string[]
  /** Whether the GIF palette pass is needed. */
  gif: boolean
  hardware: string | null
}

/**
 * How the picture is encoded. `from` says what arrives: the FFmpeg graph's
 * YUV with alpha, or the compositor's RGBA (which still needs the colour
 * matrix applied). HDR always uses the software encoders, which carry the
 * HDR metadata reliably.
 */
export function videoEncode(
  o: ExportOptions,
  seq: { width: number; height: number; fps: string },
  target: ColorTarget,
  hw: HardwareEncoders,
  from: 'graph' | 'rgba',
): VideoEncode {
  const out = outputSize(o, seq)
  const steps: string[] = []
  if (out.width !== seq.width || out.height !== seq.height) {
    const W = out.width
    const H = out.height
    steps.push(
      o.fit === 'fill'
        ? `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}`
        : `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`,
    )
  }
  if (o.fps) steps.push(`fps=${o.fps}`)
  const hdr = target.hdr !== 'sdr'
  const color = encodeColor(target)
  // Converting RGBA to YUV needs the matrix; the graph already delivers YUV.
  const matrix = (fmt: string) =>
    from === 'rgba'
      ? `scale=out_color_matrix=${target.colorSpace === 'rec2020' || hdr ? 'bt2020' : 'bt709'}:out_range=tv,format=${fmt}`
      : `format=${fmt}`
  const result = (
    codec: string[],
    fmt: string | null,
    extra: Partial<VideoEncode> = {},
  ): VideoEncode => ({
    filter: [...steps, ...(fmt ? [fmt] : [])].join(',') || 'null',
    codec,
    tags: color.args,
    global: [],
    gif: false,
    hardware: null,
    ...extra,
  })
  const q = o.quality
  const hwName =
    !hdr && o.hardware
      ? o.video === 'h264' || o.video === 'hevc' || o.video === 'av1'
        ? hw[o.video]
        : null
      : null

  if (hwName) {
    const base = { hardware: hwName }
    if (hwName.endsWith('_vaapi'))
      return result(['-c:v', hwName, '-qp', pick(q, 20, 24, 28)], `${matrix('nv12')},hwupload`, {
        ...base,
        global: ['-vaapi_device', hw.vaapiDevice ?? '/dev/dri/renderD128'],
      })
    if (hwName.endsWith('_nvenc'))
      return result(
        ['-c:v', hwName, '-preset', 'p5', '-rc', 'vbr', '-cq', pick(q, 19, 23, 28), '-b:v', '0'],
        matrix('yuv420p'),
        base,
      )
    if (hwName.endsWith('_qsv'))
      return result(['-c:v', hwName, '-global_quality', pick(q, 20, 24, 28)], matrix('nv12'), base)
    if (hwName.endsWith('_amf'))
      return result(
        ['-c:v', hwName, '-rc', 'cqp', '-qp_i', pick(q, 20, 24, 28), '-qp_p', pick(q, 22, 26, 30)],
        matrix('yuv420p'),
        base,
      )
    if (hwName.endsWith('_videotoolbox'))
      return result(['-c:v', hwName, '-q:v', pick(q, 75, 60, 45)], matrix('yuv420p'), base)
  }

  switch (o.video) {
    case 'h264':
      return result(
        ['-c:v', 'libx264', '-preset', 'medium', '-crf', pick(q, 18, 21, 25), '-profile:v', 'high'],
        matrix('yuv420p'),
      )
    case 'hevc':
      return result(
        [
          '-c:v',
          'libx265',
          '-preset',
          'medium',
          '-crf',
          pick(q, 20, 24, 28),
          '-tag:v',
          'hvc1',
          ...(hdr
            ? color.codec.slice(
                color.codec.indexOf('-x265-params'),
                color.codec.indexOf('-x265-params') + 2,
              )
            : []),
        ],
        matrix(hdr ? 'yuv420p10le' : 'yuv420p'),
      )
    case 'av1':
      return result(
        ['-c:v', 'libsvtav1', '-preset', '8', '-crf', pick(q, 26, 32, 38)],
        matrix(hdr ? 'yuv420p10le' : 'yuv420p'),
      )
    case 'prores':
      return result(
        [
          '-c:v',
          'prores_ks',
          '-profile:v',
          o.alpha ? '4' : q === 'small' ? '2' : '3',
          '-vendor',
          'apl0',
        ],
        matrix(o.alpha ? 'yuva444p10le' : 'yuv422p10le'),
      )
    case 'dnxhr':
      return result(
        ['-c:v', 'dnxhd', '-profile:v', q === 'small' ? 'dnxhr_sq' : 'dnxhr_hq'],
        matrix('yuv422p'),
      )
    case 'vp9':
      return result(
        [
          '-c:v',
          'libvpx-vp9',
          '-crf',
          pick(q, 28, 33, 38),
          '-b:v',
          '0',
          '-row-mt',
          '1',
          '-deadline',
          'good',
          '-cpu-used',
          '4',
        ],
        matrix(o.alpha ? 'yuva420p' : 'yuv420p'),
      )
    case 'gif':
      return { ...result(['-loop', '0'], null), tags: [], gif: true }
    case 'png':
      return { ...result(['-c:v', 'png'], `format=${o.alpha ? 'rgba' : 'rgb24'}`), tags: [] }
    case 'none':
      return result([], null)
  }
}

export function audioEncode(o: ExportOptions): string[] {
  const q = o.quality
  switch (o.audio) {
    case 'aac':
      return ['-c:a', 'aac', '-b:a', pick(q, 320, 192, 128) + 'k']
    case 'opus':
      return ['-c:a', 'libopus', '-b:a', pick(q, 192, 128, 96) + 'k']
    case 'pcm':
      return ['-c:a', 'pcm_s24le']
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', pick(q, 320, 192, 128) + 'k']
    case 'flac':
      return ['-c:a', 'flac']
    case 'none':
      return []
  }
}

/** Container options: fast start for MP4 and MOV so players can begin before the file is read. */
export function containerArgs(o: ExportOptions): string[] {
  if (o.container === 'mp4' || o.container === 'mov' || o.container === 'm4a')
    return ['-movflags', '+faststart']
  if (o.container === 'png') return ['-f', 'image2']
  return []
}

/** The GIF palette pass: one palette per export, dithered for small files. */
export function gifFilter(input: string, pre: string, output: string): string {
  return `[${input}]${pre === 'null' ? 'null' : pre},split[gifa][gifb];[gifa]palettegen=stats_mode=full[gifp];[gifb][gifp]paletteuse=dither=bayer:bayer_scale=4[${output}]`
}
