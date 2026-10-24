import { basename, extname } from 'node:path'
import type { MediaAsset, MediaKind } from '@engine/model'
import { normalizeFps } from '@engine/time'

type ProbeStream = {
  color_primaries?: string
  color_transfer?: string
  color_space?: string
  color_range?: string
  pix_fmt?: string
  bits_per_raw_sample?: string
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  sample_rate?: string
  channels?: number
  duration?: string
  nb_frames?: string
  disposition?: { attached_pic?: number }
  tags?: Record<string, string>
}

export type ProbeOutput = {
  streams?: ProbeStream[]
  format?: { duration?: string; format_name?: string; size?: string }
}

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.gif',
  '.svg',
  '.avif',
  '.heic',
])
const IMAGE_CODECS = new Set([
  'png',
  'mjpeg',
  'webp',
  'bmp',
  'tiff',
  'gif',
  'svg',
  'jpegxl',
  'av1_image',
])

function ratio(value: string | undefined): number | null {
  if (!value) return null
  const [n, d] = value.split('/').map(Number)
  if (!n || !d) return null
  return n / d
}

export class UnsupportedMediaError extends Error {}

export function assetFromProbe(
  probe: ProbeOutput,
  file: { id: string; path: string; size: number; now: string },
): MediaAsset {
  const streams = probe.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const audio = streams.find((s) => s.codec_type === 'audio')
  if (!video && !audio) {
    throw new UnsupportedMediaError(
      `${basename(file.path)} has no video or audio Lumacut can read.`,
    )
  }

  const ext = extname(file.path).toLowerCase()
  const isImage =
    Boolean(video) &&
    !audio &&
    (IMAGE_EXTENSIONS.has(ext) || IMAGE_CODECS.has(video?.codec_name ?? '')) &&
    (video?.nb_frames === undefined || Number(video.nb_frames) <= 1 || ext !== '.gif')

  const kind: MediaKind = isImage ? 'image' : video ? 'video' : 'audio'
  const formatDuration = Number(probe.format?.duration)
  const duration =
    kind === 'image'
      ? null
      : Number.isFinite(formatDuration) && formatDuration > 0
        ? formatDuration
        : Number(video?.duration ?? audio?.duration ?? 0)

  const avg = ratio(video?.avg_frame_rate)
  const nominal = ratio(video?.r_frame_rate)
  const rate = avg ?? nominal
  // Phones often record with uneven frame timing; the average and nominal rates then disagree.
  const vfr =
    kind === 'video' && avg !== null && nominal !== null && Math.abs(avg - nominal) / nominal > 0.01

  return {
    id: file.id,
    name: basename(file.path),
    path: file.path,
    kind,
    duration,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: kind === 'video' && rate ? normalizeFps(rate) : null,
    vfr,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    channels: audio?.channels ?? null,
    size: file.size,
    importedAt: file.now,
    sequenceId: null,
    color: video && kind === 'video' ? colorOf(video) : null,
    alpha: video?.tags?.['alpha_mode'] === '1' || video?.tags?.['ALPHA_MODE'] === '1',
    rating: 0,
    tags: [],
    generator: null,
    marks: { in: null, out: null },
  }
}

const known = (v: string | undefined) => (v && v !== 'unknown' && v !== 'reserved' ? v : null)

function colorOf(s: ProbeStream): MediaAsset['color'] {
  const depth =
    Number(s.bits_per_raw_sample) || Number(/p(\d+)(le|be)$/.exec(s.pix_fmt ?? '')?.[1]) || 8
  return {
    primaries: known(s.color_primaries),
    transfer: known(s.color_transfer),
    matrix: known(s.color_space),
    range: s.color_range === 'pc' ? 'pc' : s.color_range === 'tv' ? 'tv' : null,
    bitDepth: depth,
  }
}
