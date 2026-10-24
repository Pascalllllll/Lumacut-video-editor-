import { z } from 'zod'

export const VIDEO_CODECS = [
  'h264',
  'hevc',
  'av1',
  'prores',
  'dnxhr',
  'vp9',
  'gif',
  'png',
  'none',
] as const
export const AUDIO_CODECS = ['aac', 'opus', 'pcm', 'mp3', 'flac', 'none'] as const
export const CONTAINERS = [
  'mp4',
  'mov',
  'mkv',
  'webm',
  'gif',
  'wav',
  'm4a',
  'mp3',
  'flac',
  'png',
] as const

export type VideoCodec = (typeof VIDEO_CODECS)[number]
export type AudioCodec = (typeof AUDIO_CODECS)[number]
export type Container = (typeof CONTAINERS)[number]

export const exportOptionsSchema = z.object({
  preset: z.string().default('youtube'),
  container: z.enum(CONTAINERS).default('mp4'),
  video: z.enum(VIDEO_CODECS).default('h264'),
  audio: z.enum(AUDIO_CODECS).default('aac'),
  /** Output size; null keeps the sequence size. */
  width: z.number().int().min(16).max(7680).nullable().default(null),
  height: z.number().int().min(16).max(4320).nullable().default(null),
  /** Frames per second; null keeps the sequence rate. */
  fps: z.number().min(1).max(240).nullable().default(null),
  quality: z.enum(['high', 'balanced', 'small']).default('high'),
  /** Use a hardware encoder when one is available for the codec. */
  hardware: z.boolean().default(true),
  /** Keep transparency (ProRes 4444, VP9, PNG). */
  alpha: z.boolean().default(false),
  /** When the output shape differs from the sequence: fit inside with bars, or fill and crop. */
  fit: z.enum(['fit', 'fill']).default('fit'),
  range: z.enum(['all', 'inout', 'selection']).default('all'),
  /** Copy the source untouched when the sequence is one unchanged clip in a matching format. */
  smart: z.boolean().default(true),
})
export type ExportOptions = z.infer<typeof exportOptionsSchema>

export const defaultExportOptions = (): ExportOptions => exportOptionsSchema.parse({})

/** Which codecs each container holds. */
export const CONTAINER_CODECS: Record<Container, { video: VideoCodec[]; audio: AudioCodec[] }> = {
  mp4: { video: ['h264', 'hevc', 'av1'], audio: ['aac', 'opus', 'mp3', 'none'] },
  mov: { video: ['h264', 'hevc', 'prores', 'dnxhr'], audio: ['pcm', 'aac', 'none'] },
  mkv: {
    video: ['h264', 'hevc', 'av1', 'vp9', 'prores'],
    audio: ['flac', 'opus', 'aac', 'pcm', 'none'],
  },
  webm: { video: ['vp9', 'av1'], audio: ['opus', 'none'] },
  gif: { video: ['gif'], audio: ['none'] },
  wav: { video: ['none'], audio: ['pcm'] },
  m4a: { video: ['none'], audio: ['aac'] },
  mp3: { video: ['none'], audio: ['mp3'] },
  flac: { video: ['none'], audio: ['flac'] },
  png: { video: ['png'], audio: ['none'] },
}

export const ALPHA_CODECS: VideoCodec[] = ['prores', 'vp9', 'png']
export const HDR_CODECS: VideoCodec[] = ['hevc', 'av1', 'prores']

type Preset = { id: string; options: Partial<ExportOptions> }

/**
 * Starting points named after where the video is going. Sizes follow each
 * platform's recommended upload; anything set here can be changed after.
 */
export const EXPORT_PRESETS: Preset[] = [
  { id: 'youtube', options: { container: 'mp4', video: 'h264', audio: 'aac', quality: 'high' } },
  {
    id: 'youtube-shorts',
    options: {
      container: 'mp4',
      video: 'h264',
      audio: 'aac',
      width: 1080,
      height: 1920,
      fit: 'fill',
    },
  },
  {
    id: 'tiktok',
    options: {
      container: 'mp4',
      video: 'h264',
      audio: 'aac',
      width: 1080,
      height: 1920,
      fit: 'fill',
      quality: 'balanced',
    },
  },
  {
    id: 'reels',
    options: {
      container: 'mp4',
      video: 'h264',
      audio: 'aac',
      width: 1080,
      height: 1920,
      fit: 'fill',
      quality: 'balanced',
    },
  },
  {
    id: 'x',
    options: {
      container: 'mp4',
      video: 'h264',
      audio: 'aac',
      width: 1920,
      height: 1080,
      quality: 'balanced',
    },
  },
  {
    id: 'linkedin',
    options: {
      container: 'mp4',
      video: 'h264',
      audio: 'aac',
      width: 1920,
      height: 1080,
      quality: 'balanced',
    },
  },
  { id: 'vimeo', options: { container: 'mp4', video: 'h264', audio: 'aac', quality: 'high' } },
  {
    id: 'master',
    options: { container: 'mov', video: 'prores', audio: 'pcm', quality: 'high', hardware: false },
  },
  { id: 'web-small', options: { container: 'mp4', video: 'hevc', audio: 'aac', quality: 'small' } },
  {
    id: 'gif',
    options: { container: 'gif', video: 'gif', audio: 'none', width: 480, height: null, fps: 15 },
  },
  { id: 'audio', options: { container: 'wav', video: 'none', audio: 'pcm' } },
  { id: 'png', options: { container: 'png', video: 'png', audio: 'none', alpha: true } },
]

export function presetOptions(id: string): ExportOptions {
  const preset = EXPORT_PRESETS.find((p) => p.id === id) ?? EXPORT_PRESETS[0]!
  return exportOptionsSchema.parse({ ...preset.options, preset: preset.id })
}

/** The file extension an export gets; image sequences go in a folder of PNGs. */
export const extensionOf = (o: ExportOptions) => o.container

/**
 * Keeps choices consistent after a change: a codec the container can't hold
 * is swapped for the container's first one, alpha only where the codec has it.
 */
export function normalizeOptions(o: ExportOptions): ExportOptions {
  const allowed = CONTAINER_CODECS[o.container]
  const video = allowed.video.includes(o.video) ? o.video : allowed.video[0]!
  const audio = allowed.audio.includes(o.audio) ? o.audio : allowed.audio[0]!
  return { ...o, video, audio, alpha: o.alpha && ALPHA_CODECS.includes(video) }
}

/**
 * HDR needs a 10-bit codec that carries HDR tags. An HDR sequence exported
 * with any other video codec gets HEVC in an MP4 instead; GIF and PNG stay
 * as they are (they hold no HDR).
 */
export function forSequence(o: ExportOptions, hdr: boolean): ExportOptions {
  if (
    !hdr ||
    o.video === 'none' ||
    o.video === 'gif' ||
    o.video === 'png' ||
    HDR_CODECS.includes(o.video)
  )
    return o
  return normalizeOptions({
    ...o,
    video: 'hevc',
    container: o.container === 'mov' || o.container === 'mkv' ? o.container : 'mp4',
  })
}
