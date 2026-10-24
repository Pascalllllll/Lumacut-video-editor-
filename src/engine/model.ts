import { z } from 'zod'
import { animatedSchema, animatedVectorSchema, still } from './animation'

/** Frame rate as a fraction, e.g. 30000/1001 for 29.97 fps. */
export const rationalSchema = z.object({
  num: z.number().int().positive(),
  den: z.number().int().positive(),
})
export type Rational = z.infer<typeof rationalSchema>

/**
 * `generator` items make their own picture: titles, solid colors and
 * adjustment layers (which apply their effects to everything below).
 */
export const mediaKindSchema = z.enum(['video', 'audio', 'image', 'sequence', 'generator'])
export type MediaKind = z.infer<typeof mediaKindSchema>

/**
 * A full path on this computer: /..., C:\... or \\server\share. Never a URL, which
 * FFmpeg would fetch, so a shared project can't make Lumacut reach the network.
 */
export const isLocalPath = (p: string) =>
  (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')) && !p.includes('\0')

export const mediaAssetSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Empty for sequence items, which have no file. */
  path: z
    .string()
    .max(4096)
    .refine((p) => p === '' || isLocalPath(p), 'Media must be a file on this computer.'),
  kind: mediaKindSchema,
  /** Seconds. Images have no natural length; sequence items take theirs from the sequence. */
  duration: z.number().nonnegative().nullable(),
  width: z.number().int().nonnegative().nullable(),
  height: z.number().int().nonnegative().nullable(),
  fps: rationalSchema.nullable(),
  /** The file's frame timing varies (common in phone recordings); export conforms it. */
  vfr: z.boolean().default(false),
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  sampleRate: z.number().int().nullable(),
  channels: z.number().int().nullable(),
  size: z.number().nonnegative(),
  importedAt: z.string(),
  /** For kind 'sequence': the sequence this item stands for. */
  sequenceId: z.string().nullable().default(null),
  /** How the file's picture is encoded, as ffprobe reports it; null when unknown. */
  color: z
    .object({
      primaries: z.string().nullable(),
      transfer: z.string().nullable(),
      matrix: z.string().nullable(),
      range: z.enum(['tv', 'pc']).nullable(),
      bitDepth: z.number().int(),
    })
    .nullable()
    .default(null),
  /** 0 to 5 stars. */
  rating: z.number().int().min(0).max(5).default(0),
  tags: z.array(z.string().max(60)).max(50).default([]),
  /** The picture has its own transparency (VP9 with alpha, from background removal). */
  alpha: z.boolean().default(false),
  /** For kind 'generator': what it makes. */
  generator: z.enum(['title', 'color', 'adjustment']).nullable().default(null),
  /** Source in and out marks, in seconds, used by three- and four-point edits. */
  marks: z
    .object({ in: z.number().nullable(), out: z.number().nullable() })
    .default({ in: null, out: null }),
})
export type MediaAsset = z.infer<typeof mediaAssetSchema>

export const trackKindSchema = z.enum(['video', 'audio'])
export type TrackKind = z.infer<typeof trackKindSchema>

export const AUDIO_EFFECTS = ['eq', 'compressor', 'limiter', 'gate', 'deesser', 'reverb'] as const
export type AudioEffectType = (typeof AUDIO_EFFECTS)[number]

/** A sound effect on a clip, a track or the master; parameters are plain numbers (see engine/audio.ts). */
export const audioEffectSchema = z.object({
  id: z.string(),
  type: z.enum(AUDIO_EFFECTS),
  enabled: z.boolean().default(true),
  params: z.record(z.string(), z.number()).default({}),
})
export type AudioEffect = z.infer<typeof audioEffectSchema>

/** Track or master bus: level in dB, pan from -1 (left) to 1 (right), and insert effects. */
export const busSchema = z.object({
  volume: z.number().min(-96).max(12).default(0),
  pan: z.number().min(-1).max(1).default(0),
  effects: z.array(audioEffectSchema).default([]),
})
export type Bus = z.infer<typeof busSchema>
export const defaultBus = (): Bus => ({ volume: 0, pan: 0, effects: [] })

export const trackSchema = z.object({
  id: z.string(),
  kind: trackKindSchema,
  name: z.string(),
  locked: z.boolean().default(false),
  /** Audio tracks: silent. Video tracks: use `hidden`. */
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  hidden: z.boolean().default(false),
  /** Pixels; null uses the default for the track kind. */
  height: z.number().int().min(24).max(240).nullable().default(null),
  /** Audio tracks: fader, pan and effects. */
  bus: busSchema.default(defaultBus),
  /** Audio tracks: what the track holds, used by ducking. */
  role: z.enum(['dialogue', 'music', 'effects']).nullable().default(null),
})
export type Track = z.infer<typeof trackSchema>

/** A point on a speed ramp: `at` is a frame offset inside the clip, `speed` a multiplier. */
export const speedPointSchema = z.object({
  at: z.number().nonnegative(),
  speed: z.number().min(0.05).max(20),
})
export type SpeedPoint = z.infer<typeof speedPointSchema>

export const interpolationSchema = z.enum(['none', 'blend', 'optical-flow'])
export type Interpolation = z.infer<typeof interpolationSchema>

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'add',
  'subtract',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const
export const blendModeSchema = z.enum(BLEND_MODES)
export type BlendMode = z.infer<typeof blendModeSchema>

/**
 * Where a clip's picture sits. Position is in sequence pixels from the frame
 * centre; anchor is in source pixels from the picture centre; crop is a
 * fraction of each edge.
 */
export const transformSchema = z.object({
  x: animatedSchema.default(still(0)),
  y: animatedSchema.default(still(0)),
  scaleX: animatedSchema.default(still(1)),
  scaleY: animatedSchema.default(still(1)),
  rotation: animatedSchema.default(still(0)),
  anchorX: animatedSchema.default(still(0)),
  anchorY: animatedSchema.default(still(0)),
  opacity: animatedSchema.default(still(1)),
  cropLeft: animatedSchema.default(still(0)),
  cropRight: animatedSchema.default(still(0)),
  cropTop: animatedSchema.default(still(0)),
  cropBottom: animatedSchema.default(still(0)),
})
export type Transform = z.infer<typeof transformSchema>
export const defaultTransform = (): Transform => transformSchema.parse({})

export const paramValueSchema = z.union([animatedSchema, z.string(), z.boolean()])
export type ParamValue = z.infer<typeof paramValueSchema>

/** An effect instance on a clip; `type` names an entry in the effect library. */
export const effectSchema = z.object({
  id: z.string(),
  type: z.string(),
  enabled: z.boolean().default(true),
  params: z.record(z.string(), paramValueSchema).default({}),
  /** Analysis results some effects need (stabilization: dx, dy, angle per clip frame). */
  data: z.array(z.number()).default([]),
})
export type Effect = z.infer<typeof effectSchema>

/**
 * A mask limits where a clip shows. Shapes are in picture coordinates from
 * 0 to 1: rectangles and ellipses are [x, y, width, height]; paths are
 * [x, y, inX, inY, outX, outY] per point, handles relative to the point.
 */
export const maskSchema = z.object({
  id: z.string(),
  shape: z.enum(['rectangle', 'ellipse', 'path']),
  geometry: animatedVectorSchema,
  feather: animatedSchema.default(still(0)),
  expansion: animatedSchema.default(still(0)),
  opacity: animatedSchema.default(still(1)),
  invert: z.boolean().default(false),
  mode: z.enum(['add', 'subtract', 'intersect']).default('add'),
  /** Motion found by tracking: picture positions (0 to 1) from clip frame `start` on, one x, y pair per frame. */
  track: z
    .object({ start: z.number().int(), points: z.array(z.number()) })
    .nullable()
    .default(null),
})
export type Mask = z.infer<typeof maskSchema>

export const TEXT_ANIMATIONS = [
  'none',
  'fade',
  'rise',
  'drop',
  'scale',
  'typewriter',
  'blur',
] as const
export const titleSchema = z.object({
  text: z.string().default('Title'),
  font: z.string().default('Inter Variable'),
  weight: z.number().int().min(100).max(900).default(700),
  italic: z.boolean().default(false),
  /** Pixels at a 1080-pixel-tall frame; scaled to the sequence. */
  size: z.number().min(4).max(800).default(96),
  /** Letter spacing in thousandths of an em. */
  tracking: z.number().min(-200).max(1000).default(0),
  leading: z.number().min(0.5).max(3).default(1.15),
  align: z.enum(['left', 'center', 'right']).default('center'),
  fill: z
    .object({
      kind: z.enum(['solid', 'gradient']).default('solid'),
      color: z.string().default('#ffffff'),
      color2: z.string().default('#9ec5ff'),
      angle: z.number().default(90),
    })
    .default({ kind: 'solid', color: '#ffffff', color2: '#9ec5ff', angle: 90 }),
  stroke: z
    .object({ width: z.number().min(0).max(40).default(0), color: z.string().default('#000000') })
    .default({ width: 0, color: '#000000' }),
  shadow: z
    .object({
      enabled: z.boolean().default(false),
      x: z.number().default(0),
      y: z.number().default(4),
      blur: z.number().min(0).default(12),
      color: z.string().default('#000000'),
      opacity: z.number().min(0).max(1).default(0.5),
    })
    .default({ enabled: false, x: 0, y: 4, blur: 12, color: '#000000', opacity: 0.5 }),
  box: z
    .object({
      enabled: z.boolean().default(false),
      color: z.string().default('#000000'),
      opacity: z.number().min(0).max(1).default(0.6),
      padding: z.number().min(0).default(24),
      radius: z.number().min(0).default(8),
    })
    .default({ enabled: false, color: '#000000', opacity: 0.6, padding: 24, radius: 8 }),
  animateIn: z.enum(TEXT_ANIMATIONS).default('none'),
  animateOut: z.enum(TEXT_ANIMATIONS).default('none'),
  /** What each step of a text animation moves: one character, word or line at a time. */
  animateBy: z.enum(['character', 'word', 'line', 'all']).default('character'),
  /** Frames each in or out animation lasts. */
  animateFrames: z.number().int().min(1).max(600).default(18),
})
export type Title = z.infer<typeof titleSchema>

/** Red, green, blue and an all-channel (master) amount. */
const rgbm = z.tuple([z.number(), z.number(), z.number(), z.number()])

/**
 * Primary correction. Wheel values are offsets from neutral (0): lift moves
 * shadows, gamma midtones, gain highlights and offset everything.
 */
export const primarySchema = z.object({
  lift: rgbm.default([0, 0, 0, 0]),
  gamma: rgbm.default([0, 0, 0, 0]),
  gain: rgbm.default([0, 0, 0, 0]),
  offset: rgbm.default([0, 0, 0, 0]),
  exposure: z.number().default(0),
  contrast: z.number().default(1),
  pivot: z.number().default(0.435),
  saturation: z.number().default(1),
  /** Warmer above 0, cooler below. */
  temperature: z.number().default(0),
  /** Magenta above 0, green below. */
  tint: z.number().default(0),
})
export type Primary = z.infer<typeof primarySchema>

/** Curve points as x, y pairs from 0 to 1. Hue curves hold hue, y pairs where 0.5 means no change. */
export const curvesSchema = z.object({
  master: z.array(z.number()).default([0, 0, 1, 1]),
  red: z.array(z.number()).default([0, 0, 1, 1]),
  green: z.array(z.number()).default([0, 0, 1, 1]),
  blue: z.array(z.number()).default([0, 0, 1, 1]),
  hueHue: z.array(z.number()).default([]),
  hueSat: z.array(z.number()).default([]),
  hueLuma: z.array(z.number()).default([]),
})
export type Curves = z.infer<typeof curvesSchema>

/** Limits a grade to colors in a range of hue, saturation and lightness. */
export const qualifierSchema = z.object({
  hueCenter: z.number().default(0.08),
  hueWidth: z.number().min(0).max(1).default(0.1),
  satLow: z.number().default(0.15),
  satHigh: z.number().default(1),
  lumLow: z.number().default(0.1),
  lumHigh: z.number().default(0.95),
  softness: z.number().min(0).max(0.5).default(0.08),
  invert: z.boolean().default(false),
  /** Show the selected area as white in the viewer while adjusting. */
  show: z.boolean().default(false),
})
export type Qualifier = z.infer<typeof qualifierSchema>

/**
 * One layer of a grade. Layers apply from first to last; each blends into the
 * result by `mix` and can be limited by a qualifier.
 */
export const gradeLayerSchema = z.object({
  id: z.string(),
  kind: z.enum(['primary', 'curves', 'lut']),
  enabled: z.boolean().default(true),
  mix: z.number().min(0).max(1).default(1),
  qualifier: qualifierSchema.nullable().default(null),
  primary: primarySchema.nullable().default(null),
  curves: curvesSchema.nullable().default(null),
  /** Bundled LUT id (`bundled:<name>`) or a file path. */
  lut: z
    .object({ source: z.string(), intensity: z.number().min(0).max(1).default(1) })
    .nullable()
    .default(null),
})
export type GradeLayer = z.infer<typeof gradeLayerSchema>

/**
 * A clip's sound, in the order it is applied: effects, then gain plus the
 * (keyframable) volume, both in dB, then fades, then pan.
 */
export const clipSoundSchema = z.object({
  gain: z.number().min(-96).max(24).default(0),
  volume: animatedSchema.default(still(0)),
  pan: z.number().min(-1).max(1).default(0),
  /** Frames of fade from and to silence at the clip's start and end. */
  fadeIn: z.number().int().nonnegative().default(0),
  fadeOut: z.number().int().nonnegative().default(0),
  effects: z.array(audioEffectSchema).default([]),
})
export type ClipSound = z.infer<typeof clipSoundSchema>
export const defaultSound = (): ClipSound => clipSoundSchema.parse({})

/**
 * Clip positions are whole frames at the sequence frame rate, so cuts land on
 * exact frames and never drift. `sourceIn` is the first source frame used,
 * also counted at the sequence rate.
 */
export const clipSchema = z.object({
  id: z.string(),
  mediaId: z.string(),
  trackId: z.string(),
  start: z.number().int().nonnegative(),
  duration: z.number().int().positive(),
  sourceIn: z.number().int().nonnegative(),
  /** Playback speed; 0 holds the frame at sourceIn (freeze frame). Ignored while a ramp is set. */
  speed: z.number().min(0).max(20).default(1),
  reverse: z.boolean().default(false),
  ramp: z.array(speedPointSchema).min(2).nullable().default(null),
  interpolation: interpolationSchema.default('none'),
  /** Video and audio from the same file share a linkId and edit together. */
  linkId: z.string().nullable().default(null),
  groupId: z.string().nullable().default(null),
  /** Multicam clips: which angle (video track index in the multicam sequence) is shown. */
  angle: z.number().int().nonnegative().nullable().default(null),
  transform: transformSchema.default(defaultTransform),
  blend: blendModeSchema.default('normal'),
  effects: z.array(effectSchema).default([]),
  masks: z.array(maskSchema).default([]),
  /** Title clips: what the title says and how it looks. */
  title: titleSchema.nullable().default(null),
  /** Solid-color clips: the color. */
  color: z.string().nullable().default(null),
  /** Color grade, applied before the clip's effects. */
  grade: z.array(gradeLayerSchema).default([]),
  sound: clipSoundSchema.default(defaultSound),
})
export type Clip = z.infer<typeof clipSchema>

export const TRANSITIONS = [
  'cross-dissolve',
  'dip-black',
  'dip-white',
  'wipe-left',
  'wipe-right',
  'wipe-up',
  'wipe-down',
  'wipe-clock',
  'slide-left',
  'slide-right',
  'push-left',
  'push-right',
  'zoom-in',
  'zoom-out',
  'blur',
  'glitch',
  'light-leak',
  'iris',
] as const
export const transitionTypeSchema = z.enum(TRANSITIONS)

/**
 * A transition sits on the cut between two touching clips on one track, or
 * on the open start or end of a single clip (fade from or to nothing). It is
 * centred on the cut and borrows frames from beyond each clip's edge.
 */
export const transitionSchema = z.object({
  id: z.string(),
  trackId: z.string(),
  leftClipId: z.string().nullable(),
  rightClipId: z.string().nullable(),
  type: transitionTypeSchema,
  duration: z.number().int().min(2),
  ease: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']).default('linear'),
})
export type Transition = z.infer<typeof transitionSchema>

export const MARKER_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const
export const markerSchema = z.object({
  id: z.string(),
  frame: z.number().int().nonnegative(),
  name: z.string(),
  note: z.string(),
  color: z.enum(MARKER_COLORS),
})
export type Marker = z.infer<typeof markerSchema>

/** A word in a caption, timed in sequence frames (fractions allowed). */
export const captionWordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
})
export type CaptionWord = z.infer<typeof captionWordSchema>

/** One caption on screen: [start, end) in sequence frames. */
export const captionCueSchema = z.object({
  id: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  text: z.string(),
  words: z.array(captionWordSchema).default([]),
})
export type CaptionCue = z.infer<typeof captionCueSchema>

export const CAPTION_TEMPLATES = ['clean', 'boxed', 'bold', 'karaoke'] as const
export const captionStyleSchema = z.object({
  template: z.enum(CAPTION_TEMPLATES).default('clean'),
  font: z.string().default('Inter Variable'),
  /** Pixels at a 1080-pixel-tall frame. */
  size: z.number().min(12).max(200).default(52),
  color: z.string().default('#ffffff'),
  /** The word being spoken, in the karaoke template. */
  highlight: z.string().default('#ffd34d'),
  /** Vertical centre of the caption, 0 (top) to 1 (bottom). */
  position: z.number().min(0).max(1).default(0.86),
  uppercase: z.boolean().default(false),
})
export type CaptionStyle = z.infer<typeof captionStyleSchema>
export const defaultCaptionStyle = (): CaptionStyle => captionStyleSchema.parse({})

export const captionTrackSchema = z.object({
  cues: z.array(captionCueSchema).default([]),
  style: captionStyleSchema.default(defaultCaptionStyle),
  /** Shown in the viewer and burned into exports. */
  show: z.boolean().default(true),
  language: z.string().nullable().default(null),
})
export type CaptionTrack = z.infer<typeof captionTrackSchema>
export const emptyCaptions = (): CaptionTrack => captionTrackSchema.parse({})

export const sequenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: rationalSchema,
  sampleRate: z.number().int().positive(),
  /** Bottom to top for video; audio tracks follow in their own order. */
  tracks: z.array(trackSchema),
  clips: z.record(z.string(), clipSchema),
  markers: z.record(z.string(), markerSchema).default({}),
  inPoint: z.number().int().nonnegative().nullable().default(null),
  outPoint: z.number().int().nonnegative().nullable().default(null),
  /** Magnetic mode keeps the first video track free of gaps. */
  magnetic: z.boolean().default(false),
  /** Tracks that source edits (insert, overwrite) land on. */
  targets: z
    .object({ video: z.string().nullable(), audio: z.string().nullable() })
    .default({ video: null, audio: null }),
  multicam: z.boolean().default(false),
  transitions: z.record(z.string(), transitionSchema).default({}),
  /** Color primaries the sequence is graded and exported in. */
  colorSpace: z.enum(['rec709', 'p3', 'rec2020']).default('rec709'),
  /** High dynamic range output: PQ (HDR10) or HLG. HDR sequences use Rec. 2020. */
  hdr: z.enum(['sdr', 'pq', 'hlg']).default('sdr'),
  master: busSchema.default(defaultBus),
  /** Exports are brought to this integrated loudness (LUFS); null leaves the mix as it is. */
  loudnessTarget: z.number().min(-40).max(-5).nullable().default(null),
  captions: captionTrackSchema.default(emptyCaptions),
})
export type Sequence = z.infer<typeof sequenceSchema>

export const PROJECT_SCHEMA_VERSION = 7

export const projectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  media: z.record(z.string(), mediaAssetSchema),
  sequences: z.record(z.string(), sequenceSchema),
  activeSequenceId: z.string(),
  createdAt: z.string(),
})
export type Project = z.infer<typeof projectSchema>

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
}

export function createTrack(kind: TrackKind, name: string): Track {
  return {
    id: createId('trk'),
    kind,
    name,
    locked: false,
    muted: false,
    solo: false,
    hidden: false,
    height: null,
    bus: defaultBus(),
    role: null,
  }
}

export function createClip(
  fields: Pick<Clip, 'mediaId' | 'trackId' | 'start' | 'duration' | 'sourceIn'> & Partial<Clip>,
): Clip {
  return {
    id: createId('clp'),
    speed: 1,
    reverse: false,
    ramp: null,
    interpolation: 'none',
    linkId: null,
    groupId: null,
    angle: null,
    transform: defaultTransform(),
    blend: 'normal',
    effects: [],
    masks: [],
    title: null,
    color: null,
    grade: [],
    sound: defaultSound(),
    ...fields,
  }
}

export function createSequence(
  name: string,
  base?: Partial<Pick<Sequence, 'width' | 'height' | 'fps'>>,
): Sequence {
  const v1 = createTrack('video', 'V1')
  const a1 = createTrack('audio', 'A1')
  return {
    id: createId('seq'),
    name,
    width: base?.width ?? 1920,
    height: base?.height ?? 1080,
    fps: base?.fps ?? { num: 30, den: 1 },
    sampleRate: 48000,
    tracks: [v1, a1],
    clips: {},
    markers: {},
    inPoint: null,
    outPoint: null,
    magnetic: false,
    targets: { video: v1.id, audio: a1.id },
    multicam: false,
    transitions: {},
    colorSpace: 'rec709',
    hdr: 'sdr',
    master: defaultBus(),
    loudnessTarget: null,
    captions: emptyCaptions(),
  }
}

/** The media-list item that stands for a sequence, so it can be placed in another one. */
export function sequenceAsset(seq: Sequence, now = new Date().toISOString()): MediaAsset {
  return {
    id: createId('med'),
    name: seq.name,
    path: '',
    kind: 'sequence',
    duration: null,
    width: seq.width,
    height: seq.height,
    fps: seq.fps,
    vfr: false,
    hasVideo: true,
    hasAudio: true,
    videoCodec: null,
    audioCodec: null,
    sampleRate: seq.sampleRate,
    channels: 2,
    size: 0,
    importedAt: now,
    sequenceId: seq.id,
    color: null,
    rating: 0,
    tags: [],
    alpha: false,
    generator: null,
    marks: { in: null, out: null },
  }
}

export function createProject(name: string, now = new Date().toISOString()): Project {
  const sequence = createSequence('Sequence 1')
  const asset = sequenceAsset(sequence, now)
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: createId('prj'),
    name,
    media: { [asset.id]: asset },
    sequences: { [sequence.id]: sequence },
    activeSequenceId: sequence.id,
    createdAt: now,
  }
}

export function activeSequence(project: Project): Sequence {
  const seq = project.sequences[project.activeSequenceId]
  if (!seq) throw new Error(`Active sequence ${project.activeSequenceId} is missing`)
  return seq
}

export function sequenceItem(project: Project, sequenceId: string): MediaAsset | undefined {
  return Object.values(project.media).find(
    (m) => m.kind === 'sequence' && m.sequenceId === sequenceId,
  )
}

/** A media-list item that makes its own picture: a title, a solid color or an adjustment layer. */
export function generatorAsset(
  kind: 'title' | 'color' | 'adjustment',
  name: string,
  now = new Date().toISOString(),
): MediaAsset {
  return {
    id: createId('med'),
    name,
    path: '',
    kind: 'generator',
    duration: null,
    width: null,
    height: null,
    fps: null,
    vfr: false,
    hasVideo: true,
    hasAudio: false,
    videoCodec: null,
    audioCodec: null,
    sampleRate: null,
    channels: null,
    size: 0,
    importedAt: now,
    sequenceId: null,
    color: null,
    rating: 0,
    tags: [],
    alpha: false,
    generator: kind,
    marks: { in: null, out: null },
  }
}
