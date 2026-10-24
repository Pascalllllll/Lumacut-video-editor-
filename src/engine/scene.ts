import { applyEase, evaluate, evaluateVector } from './animation'
import { EFFECTS_BY_TYPE, paramOf } from './effects'
import { assetFrames } from './media'
import { cueAt } from './captions'
import type {
  BlendMode,
  CaptionCue,
  CaptionStyle,
  Clip,
  GradeLayer,
  MediaAsset,
  Project,
  Sequence,
  Title,
  Transition,
} from './model'
import { sourceFrameAt, speedAt } from './speed'
import { framesToSeconds, secondsToFrames } from './time'
import { clipAt, clipEnd } from './timeline'

/** Where a layer's picture comes from. */
export type LayerSource =
  | {
      kind: 'media'
      asset: MediaAsset
      time: number
      rate: number
      interpolation: Clip['interpolation']
      /** Earliest source second this clip can show, for decoders that read backwards. */
      rangeStart: number
    }
  | { kind: 'title'; title: Title; frame: number; duration: number }
  | { kind: 'color'; color: string }
  | { kind: 'nested'; scene: Scene }
  /** The sequence's caption on screen; `frame` places the karaoke highlight. */
  | { kind: 'caption'; cue: CaptionCue; style: CaptionStyle; frame: number }

export type EvaluatedTransform = {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  anchorX: number
  anchorY: number
  opacity: number
  cropLeft: number
  cropRight: number
  cropTop: number
  cropBottom: number
}

export type EvaluatedEffect = { type: string; params: Record<string, number | string | boolean> }
export type EvaluatedMask = {
  shape: 'rectangle' | 'ellipse' | 'path'
  geometry: number[]
  feather: number
  expansion: number
  opacity: number
  invert: boolean
  mode: 'add' | 'subtract' | 'intersect'
}

export type Layer = {
  kind: 'layer'
  /** Stable while the same clip shows, so players can keep its decoder. */
  key: string
  source: LayerSource
  /** Natural size of the picture in pixels. */
  width: number
  height: number
  /** Scale that fits the picture inside the frame before the clip's own transform. */
  fit: number
  transform: EvaluatedTransform
  blend: BlendMode
  effects: EvaluatedEffect[]
  masks: EvaluatedMask[]
  /** Enabled grade layers, applied before effects. */
  grade: GradeLayer[]
}

export type TransitionItem = {
  kind: 'transition'
  type: Transition['type']
  progress: number
  from: Layer | null
  to: Layer | null
}
export type AdjustmentItem = {
  kind: 'adjustment'
  key: string
  effects: EvaluatedEffect[]
  opacity: number
  masks: EvaluatedMask[]
}
export type SceneItem = Layer | TransitionItem | AdjustmentItem

export type Scene = { width: number; height: number; items: SceneItem[] }

const MAX_DEPTH = 8

function evalTransform(clip: Clip, f: number): EvaluatedTransform {
  const t = clip.transform
  return {
    x: evaluate(t.x, f),
    y: evaluate(t.y, f),
    scaleX: evaluate(t.scaleX, f),
    scaleY: evaluate(t.scaleY, f),
    rotation: evaluate(t.rotation, f),
    anchorX: evaluate(t.anchorX, f),
    anchorY: evaluate(t.anchorY, f),
    opacity: Math.min(1, Math.max(0, evaluate(t.opacity, f))),
    cropLeft: evaluate(t.cropLeft, f),
    cropRight: evaluate(t.cropRight, f),
    cropTop: evaluate(t.cropTop, f),
    cropBottom: evaluate(t.cropBottom, f),
  }
}

/**
 * Stabilization works on placement, not pixels: the measured shake for this
 * frame becomes an opposite shift and turn, with a little zoom to hide edges.
 */
function stabilized(
  clip: Clip,
  t: EvaluatedTransform,
  f: number,
  width: number,
  height: number,
  fit: number,
): EvaluatedTransform {
  const fx = clip.effects.find((e) => e.enabled && e.type === 'stabilize' && e.data.length >= 3)
  if (!fx) return t
  const frames = fx.data.length / 3
  const i = Math.min(frames - 1, Math.max(0, Math.round(f))) * 3
  const zoomParam = fx.params['zoom']
  const zoom = typeof zoomParam === 'object' ? evaluate(zoomParam, f) : 1.05
  return {
    ...t,
    x: t.x + fx.data[i]! * width * fit * t.scaleX,
    y: t.y + fx.data[i + 1]! * height * fit * t.scaleY,
    rotation: t.rotation + (fx.data[i + 2]! * 180) / Math.PI,
    scaleX: t.scaleX * zoom,
    scaleY: t.scaleY * zoom,
  }
}

function evalEffects(clip: Clip, f: number): EvaluatedEffect[] {
  return clip.effects
    .filter((e) => e.enabled && e.type !== 'stabilize')
    .map((e) => {
      const params: EvaluatedEffect['params'] = {}
      const ids = [
        ...(EFFECTS_BY_TYPE.get(e.type)?.params.map((p) => p.id) ?? []),
        ...Object.keys(e.params),
      ]
      for (const id of new Set(ids)) {
        const v = paramOf(e, id)
        if (v === undefined) continue
        params[id] = typeof v === 'object' ? evaluate(v, f) : v
      }
      return { type: e.type, params }
    })
}

function evalMasks(clip: Clip, f: number): EvaluatedMask[] {
  return clip.masks.map((m) => ({
    shape: m.shape,
    geometry: evaluateVector(m.geometry, f),
    feather: evaluate(m.feather, f),
    expansion: evaluate(m.expansion, f),
    opacity: evaluate(m.opacity, f),
    invert: m.invert,
    mode: m.mode,
  }))
}

type Ctx = { project: Project; depth: number; prefix: string }

/** A clip's layer at `frame`, which may lie a little outside the clip when a transition borrows frames. */
function clipLayer(
  ctx: Ctx,
  seq: Sequence,
  clip: Clip,
  frame: number,
): Layer | AdjustmentItem | null {
  const asset = ctx.project.media[clip.mediaId]
  if (!asset) return null
  const offset = frame - clip.start
  const key = `${ctx.prefix}${clip.id}`
  const transform = evalTransform(clip, offset)
  const effects = evalEffects(clip, offset)
  const masks = evalMasks(clip, offset)
  const grade = clip.grade.filter((g) => g.enabled)
  const base = { kind: 'layer' as const, key, transform, blend: clip.blend, effects, masks, grade }
  const fitFor = (w: number, h: number) =>
    w > 0 && h > 0 ? Math.min(seq.width / w, seq.height / h) : 1

  if (asset.kind === 'generator') {
    if (asset.generator === 'adjustment')
      return { kind: 'adjustment', key, effects, opacity: transform.opacity, masks }
    if (asset.generator === 'title' && clip.title) {
      return {
        ...base,
        source: { kind: 'title', title: clip.title, frame: offset, duration: clip.duration },
        width: seq.width,
        height: seq.height,
        fit: 1,
      }
    }
    return {
      ...base,
      source: { kind: 'color', color: clip.color ?? '#000000' },
      width: seq.width,
      height: seq.height,
      fit: 1,
    }
  }

  const sourceFrame = sourceFrameAt(clip, offset)
  const speed = clip.ramp ? speedAt(clip, Math.min(Math.max(offset, 0), clip.duration)) : clip.speed
  const rate = clip.reverse ? -speed : speed

  if (asset.kind === 'sequence') {
    const inner = asset.sequenceId ? ctx.project.sequences[asset.sequenceId] : undefined
    if (!inner || ctx.depth >= MAX_DEPTH) return null
    const innerFrame = secondsToFrames(framesToSeconds(sourceFrame, seq.fps), inner.fps)
    const scene = buildScene(ctx.project, inner, innerFrame, {
      depth: ctx.depth + 1,
      prefix: `${key}/`,
      angle: clip.angle,
    })
    return {
      ...base,
      source: { kind: 'nested', scene },
      width: inner.width,
      height: inner.height,
      fit: fitFor(inner.width, inner.height),
    }
  }

  if (asset.kind === 'audio' || !asset.hasVideo) return null
  const width = asset.width ?? seq.width
  const height = asset.height ?? seq.height
  // Borrowed frames beyond the media's ends hold its first or last frame.
  const limit = assetFrames(ctx.project, asset, seq.fps)
  const clamped = limit === null ? 0 : Math.min(Math.max(sourceFrame, 0), Math.max(0, limit - 1))
  const time = asset.kind === 'image' ? 0 : framesToSeconds(clamped, seq.fps)
  const rangeStart = Math.max(0, framesToSeconds(clip.sourceIn - clip.duration, seq.fps))
  const fit = fitFor(width, height)
  return {
    ...base,
    transform: stabilized(clip, transform, offset, width, height, fit),
    source: { kind: 'media', asset, time, rate, interpolation: clip.interpolation, rangeStart },
    width,
    height,
    fit,
  }
}

/** The transition window on a track covering `frame`, if any. */
function activeTransition(
  seq: Sequence,
  trackId: string,
  frame: number,
): { tr: Transition; start: number } | null {
  for (const tr of Object.values(seq.transitions)) {
    if (tr.trackId !== trackId) continue
    const left = tr.leftClipId ? seq.clips[tr.leftClipId] : undefined
    const right = tr.rightClipId ? seq.clips[tr.rightClipId] : undefined
    let start: number
    if (left && right) start = right.start - Math.floor(tr.duration / 2)
    else if (right) start = right.start
    else if (left) start = clipEnd(left) - tr.duration
    else continue
    if (frame >= start && frame < start + tr.duration) return { tr, start }
  }
  return null
}

/**
 * Everything visible at `frame`, bottom to top. Hidden tracks are skipped;
 * with `angle` set (multicam), only that video track shows.
 */
export function buildScene(
  project: Project,
  seq: Sequence,
  frame: number,
  opts: { depth?: number; prefix?: string; angle?: number | null } = {},
): Scene {
  const ctx: Ctx = { project, depth: opts.depth ?? 0, prefix: opts.prefix ?? '' }
  const angle = opts.angle ?? null
  const videos = seq.tracks.filter((t) => t.kind === 'video')
  const shown =
    angle === null ? videos.filter((t) => !t.hidden) : videos.filter((_, i) => i === angle)
  const items: SceneItem[] = []

  for (const track of shown) {
    const active = activeTransition(seq, track.id, frame)
    if (active) {
      const { tr, start } = active
      const left = tr.leftClipId ? seq.clips[tr.leftClipId] : undefined
      const right = tr.rightClipId ? seq.clips[tr.rightClipId] : undefined
      const from = left ? clipLayer(ctx, seq, left, frame) : null
      const to = right ? clipLayer(ctx, seq, right, frame) : null
      const linear = (frame - start + 0.5) / tr.duration
      items.push({
        kind: 'transition',
        type: tr.type,
        progress: applyEase(tr.ease, Math.min(1, Math.max(0, linear))),
        from: from?.kind === 'layer' ? from : null,
        to: to?.kind === 'layer' ? to : null,
      })
      continue
    }
    const clip = clipAt(seq, track.id, frame)
    if (!clip) continue
    const layer = clipLayer(ctx, seq, clip, frame)
    if (layer) items.push(layer)
  }
  // Captions sit above everything, only in the sequence being shown or exported.
  const cue = ctx.depth === 0 && seq.captions.show ? cueAt(seq.captions, frame) : null
  if (cue) items.push(captionLayer(seq, cue, frame))
  return { width: seq.width, height: seq.height, items }
}

function captionLayer(seq: Sequence, cue: CaptionCue, frame: number): Layer {
  return {
    kind: 'layer',
    key: 'captions',
    source: { kind: 'caption', cue, style: seq.captions.style, frame },
    width: seq.width,
    height: seq.height,
    fit: 1,
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0,
      anchorY: 0,
      opacity: 1,
      cropLeft: 0,
      cropRight: 0,
      cropTop: 0,
      cropBottom: 0,
    },
    blend: 'normal',
    effects: [],
    masks: [],
    grade: [],
  }
}

/** Every media leaf in a scene, for players that need a decoder per source. */
export function mediaLayers(scene: Scene): Layer[] {
  const out: Layer[] = []
  const visit = (item: SceneItem | null) => {
    if (!item || item.kind === 'adjustment') return
    if (item.kind === 'transition') {
      visit(item.from)
      visit(item.to)
      return
    }
    if (item.source.kind === 'media') out.push(item)
    else if (item.source.kind === 'nested') item.source.scene.items.forEach(visit)
  }
  scene.items.forEach(visit)
  return out
}

function isStill(anim: { value: number; keys: unknown[] }, value: number) {
  return anim.keys.length === 0 && anim.value === value
}

/**
 * Whether a sequence needs the compositor to export: anything beyond plain
 * cuts, speed and nesting (effects, transforms, masks, blend modes, titles,
 * colors, adjustment layers or transitions).
 */
export function needsCompositor(
  project: Project,
  seq: Sequence,
  seen = new Set<string>(),
): boolean {
  if (seen.has(seq.id)) return false
  seen.add(seq.id)
  if (seen.size === 1 && seq.captions.show && seq.captions.cues.length > 0) return true
  if (Object.keys(seq.transitions).length > 0) return true
  // Color-managed output (HDR, wide gamut) and footage that needs converting go through the compositor.
  if (seq.hdr !== 'sdr' || seq.colorSpace !== 'rec709') return true
  for (const clip of Object.values(seq.clips)) {
    const track = seq.tracks.find((t) => t.id === clip.trackId)
    if (track?.kind !== 'video') continue
    const asset = project.media[clip.mediaId]
    if (!asset) continue
    if (asset.kind === 'generator' || asset.alpha) return true
    const t = clip.transform
    const plain =
      isStill(t.x, 0) &&
      isStill(t.y, 0) &&
      isStill(t.scaleX, 1) &&
      isStill(t.scaleY, 1) &&
      isStill(t.rotation, 0) &&
      isStill(t.anchorX, 0) &&
      isStill(t.anchorY, 0) &&
      isStill(t.opacity, 1) &&
      isStill(t.cropLeft, 0) &&
      isStill(t.cropRight, 0) &&
      isStill(t.cropTop, 0) &&
      isStill(t.cropBottom, 0)
    if (
      !plain ||
      clip.blend !== 'normal' ||
      clip.effects.some((e) => e.enabled) ||
      clip.masks.length > 0
    )
      return true
    if (clip.grade.some((g) => g.enabled)) return true
    const c = asset.color
    const hdrSource = c?.transfer === 'smpte2084' || c?.transfer === 'arib-std-b67'
    const wideSource =
      Boolean(c?.primaries) && !['bt709', 'smpte170m', 'bt470bg'].includes(c!.primaries!)
    if (hdrSource || wideSource) return true
    if (asset.kind === 'sequence' && asset.sequenceId) {
      const inner = project.sequences[asset.sequenceId]
      if (inner && needsCompositor(project, inner, seen)) return true
    }
  }
  return false
}
