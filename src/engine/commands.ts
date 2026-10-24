import { z } from 'zod'
import { assetFrames } from './media'
import {
  busSchema,
  captionTrackSchema,
  clipSchema,
  markerSchema,
  mediaAssetSchema,
  rationalSchema,
  sequenceSchema,
  speedPointSchema,
  trackSchema,
  transitionSchema,
  interpolationSchema,
  type CaptionTrack,
  type Transition,
  type Clip,
  type MediaAsset,
  type Project,
  type Sequence,
} from './model'
import { extractFromCaptions } from './captions'
import { shiftClipKeys } from './keys'
import { sourceSpan, scaleRamp } from './speed'
import {
  clearRange,
  clipEnd,
  clipsOnTrack,
  nearestBoundary,
  nestedSequenceIds,
  portion,
  primaryTrack,
  shiftFrom,
  trackOf,
} from './timeline'

const id = z.string()
const frame = z.number().int().nonnegative()

const trackPatch = trackSchema
  .pick({
    name: true,
    locked: true,
    muted: true,
    solo: true,
    hidden: true,
    height: true,
    bus: true,
    role: true,
  })
  .partial()
const clipPatch = clipSchema
  .pick({ angle: true, groupId: true, linkId: true, mediaId: true })
  .partial()
const lookPatch = clipSchema
  .pick({
    transform: true,
    blend: true,
    effects: true,
    masks: true,
    title: true,
    color: true,
    grade: true,
    sound: true,
  })
  .partial()
// Path and size change when a missing file is relinked or files are collected.
const mediaPatch = mediaAssetSchema
  .pick({ name: true, marks: true, rating: true, tags: true, path: true, size: true })
  .partial()
const markerPatch = markerSchema
  .pick({ frame: true, name: true, note: true, color: true })
  .partial()
const settingsPatch = z.object({
  name: z.string().min(1).max(200).optional(),
  width: z.number().int().min(16).max(16384).optional(),
  height: z.number().int().min(16).max(16384).optional(),
  fps: rationalSchema.optional(),
  magnetic: z.boolean().optional(),
  colorSpace: z.enum(['rec709', 'p3', 'rec2020']).optional(),
  hdr: z.enum(['sdr', 'pq', 'hlg']).optional(),
  inPoint: frame.nullable().optional(),
  outPoint: frame.nullable().optional(),
  targets: z.object({ video: id.nullable(), audio: id.nullable() }).optional(),
  master: busSchema.optional(),
  loudnessTarget: z.number().min(-40).max(-5).nullable().optional(),
})

/**
 * Every project change is one of these plain objects, so a change can be
 * logged, sent over IPC, replayed, or produced by the AI tools, and all of
 * them undo the same way.
 */
export const commandSchema: z.ZodType<Command> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('media.add'), assets: z.array(mediaAssetSchema) }),
    z.object({ type: z.literal('media.remove'), mediaIds: z.array(id) }),
    z.object({ type: z.literal('media.update'), mediaId: id, patch: mediaPatch }),
    z.object({
      type: z.literal('sequence.add'),
      sequence: sequenceSchema,
      asset: mediaAssetSchema,
    }),
    z.object({ type: z.literal('sequence.settings'), sequenceId: id, ...settingsPatch.shape }),
    z.object({
      type: z.literal('track.add'),
      sequenceId: id,
      track: trackSchema,
      index: z.number().int().nonnegative().optional(),
    }),
    z.object({ type: z.literal('track.remove'), sequenceId: id, trackId: id }),
    z.object({ type: z.literal('track.update'), sequenceId: id, trackId: id, patch: trackPatch }),
    z.object({ type: z.literal('clip.add'), sequenceId: id, clips: z.array(clipSchema).min(1) }),
    z.object({
      type: z.literal('clip.insert'),
      sequenceId: id,
      clips: z.array(clipSchema).min(1),
      at: frame,
      shiftTrackIds: z.array(id),
    }),
    z.object({
      type: z.literal('clip.remove'),
      sequenceId: id,
      clipIds: z.array(id),
      ripple: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('clip.move'),
      sequenceId: id,
      moves: z.array(z.object({ clipId: id, start: frame, trackId: id.optional() })).min(1),
    }),
    z.object({
      type: z.literal('clip.trim'),
      sequenceId: id,
      clipId: id,
      edge: z.enum(['start', 'end']),
      frame,
      ripple: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('clip.split'),
      sequenceId: id,
      clipId: id,
      frame: z.number().int().positive(),
      newClipId: id.optional(),
      newLinkId: id.optional(),
    }),
    z.object({ type: z.literal('clip.roll'), sequenceId: id, leftId: id, rightId: id, frame }),
    z.object({ type: z.literal('clip.slip'), sequenceId: id, clipId: id, delta: z.number().int() }),
    z.object({
      type: z.literal('clip.slide'),
      sequenceId: id,
      clipId: id,
      delta: z.number().int(),
    }),
    z.object({
      type: z.literal('clip.rateStretch'),
      sequenceId: id,
      clipId: id,
      edge: z.enum(['start', 'end']),
      frame,
    }),
    z.object({
      type: z.literal('clip.speed'),
      sequenceId: id,
      clipId: id,
      speed: z.number().min(0).max(20),
      reverse: z.boolean(),
      ramp: z.array(speedPointSchema).min(2).nullable(),
      interpolation: interpolationSchema,
      ripple: z.boolean(),
    }),
    z.object({
      type: z.literal('clip.update'),
      sequenceId: id,
      clipIds: z.array(id),
      patch: clipPatch,
    }),
    z.object({
      type: z.literal('clip.look'),
      sequenceId: id,
      clipIds: z.array(id).min(1),
      patch: lookPatch,
    }),
    z.object({ type: z.literal('transition.add'), sequenceId: id, transition: transitionSchema }),
    z.object({
      type: z.literal('transition.update'),
      sequenceId: id,
      transitionId: id,
      patch: transitionSchema.pick({ type: true, duration: true, ease: true }).partial(),
    }),
    z.object({ type: z.literal('transition.remove'), sequenceId: id, transitionIds: z.array(id) }),
    z.object({
      type: z.literal('range.lift'),
      sequenceId: id,
      start: frame,
      end: frame,
      trackIds: z.array(id),
    }),
    z.object({
      type: z.literal('range.extract'),
      sequenceId: id,
      start: frame,
      end: frame,
      trackIds: z.array(id),
    }),
    z.object({ type: z.literal('marker.add'), sequenceId: id, marker: markerSchema }),
    z.object({
      type: z.literal('marker.update'),
      sequenceId: id,
      markerId: id,
      patch: markerPatch,
    }),
    z.object({ type: z.literal('marker.remove'), sequenceId: id, markerIds: z.array(id) }),
    z.object({
      type: z.literal('restore'),
      sequences: z.record(id, sequenceSchema.nullable()),
      media: z.record(id, mediaAssetSchema.nullable()),
    }),
    z.object({
      type: z.literal('captions.set'),
      sequenceId: id,
      captions: captionTrackSchema,
    }),
    z.object({ type: z.literal('batch'), label: z.string(), commands: z.array(commandSchema) }),
  ]),
) as z.ZodType<Command>

type TrackPatch = z.infer<typeof trackPatch>
type SettingsPatch = z.infer<typeof settingsPatch>

export type Command =
  | { type: 'media.add'; assets: MediaAsset[] }
  | { type: 'media.remove'; mediaIds: string[] }
  | { type: 'media.update'; mediaId: string; patch: z.infer<typeof mediaPatch> }
  | { type: 'sequence.add'; sequence: Sequence; asset: MediaAsset }
  | ({ type: 'sequence.settings'; sequenceId: string } & SettingsPatch)
  | { type: 'track.add'; sequenceId: string; track: z.infer<typeof trackSchema>; index?: number }
  | { type: 'track.remove'; sequenceId: string; trackId: string }
  | { type: 'track.update'; sequenceId: string; trackId: string; patch: TrackPatch }
  | { type: 'clip.add'; sequenceId: string; clips: Clip[] }
  | { type: 'clip.insert'; sequenceId: string; clips: Clip[]; at: number; shiftTrackIds: string[] }
  | { type: 'clip.remove'; sequenceId: string; clipIds: string[]; ripple?: boolean }
  | {
      type: 'clip.move'
      sequenceId: string
      moves: { clipId: string; start: number; trackId?: string }[]
    }
  | {
      type: 'clip.trim'
      sequenceId: string
      clipId: string
      edge: 'start' | 'end'
      frame: number
      ripple?: boolean
    }
  | {
      type: 'clip.split'
      sequenceId: string
      clipId: string
      frame: number
      newClipId?: string
      newLinkId?: string
    }
  | { type: 'clip.roll'; sequenceId: string; leftId: string; rightId: string; frame: number }
  | { type: 'clip.slip'; sequenceId: string; clipId: string; delta: number }
  | { type: 'clip.slide'; sequenceId: string; clipId: string; delta: number }
  | {
      type: 'clip.rateStretch'
      sequenceId: string
      clipId: string
      edge: 'start' | 'end'
      frame: number
    }
  | {
      type: 'clip.speed'
      sequenceId: string
      clipId: string
      speed: number
      reverse: boolean
      ramp: z.infer<typeof speedPointSchema>[] | null
      interpolation: z.infer<typeof interpolationSchema>
      ripple: boolean
    }
  | { type: 'clip.update'; sequenceId: string; clipIds: string[]; patch: z.infer<typeof clipPatch> }
  | { type: 'clip.look'; sequenceId: string; clipIds: string[]; patch: z.infer<typeof lookPatch> }
  | { type: 'transition.add'; sequenceId: string; transition: Transition }
  | {
      type: 'transition.update'
      sequenceId: string
      transitionId: string
      patch: Partial<Pick<Transition, 'type' | 'duration' | 'ease'>>
    }
  | { type: 'transition.remove'; sequenceId: string; transitionIds: string[] }
  | { type: 'range.lift'; sequenceId: string; start: number; end: number; trackIds: string[] }
  | { type: 'range.extract'; sequenceId: string; start: number; end: number; trackIds: string[] }
  | { type: 'marker.add'; sequenceId: string; marker: z.infer<typeof markerSchema> }
  | {
      type: 'marker.update'
      sequenceId: string
      markerId: string
      patch: z.infer<typeof markerPatch>
    }
  | { type: 'marker.remove'; sequenceId: string; markerIds: string[] }
  | {
      type: 'restore'
      sequences: Record<string, Sequence | null>
      media: Record<string, MediaAsset | null>
    }
  | { type: 'captions.set'; sequenceId: string; captions: CaptionTrack }
  | { type: 'batch'; label: string; commands: Command[] }

export class CommandError extends Error {}

// ---------------------------------------------------------------- helpers

function seqOf(project: Project, sequenceId: string): Sequence {
  const seq = project.sequences[sequenceId]
  if (!seq) throw new CommandError(`Sequence ${sequenceId} doesn't exist`)
  return seq
}

function clipOf(seq: Sequence, clipId: string): Clip {
  const clip = seq.clips[clipId]
  if (!clip) throw new CommandError(`Clip ${clipId} doesn't exist`)
  return clip
}

function assertUnlocked(seq: Sequence, trackId: string) {
  const track = trackOf(seq, trackId)
  if (!track) throw new CommandError('Track not found')
  if (track.locked)
    throw new CommandError(`Track ${track.name} is locked. Unlock it to edit its clips.`)
}

/**
 * Ids for clip halves created by splits. They derive from the clip being split
 * and the current state, so replaying a command on the same project always
 * produces the same ids.
 */
function splitIds(seq: Sequence): (baseId: string) => string {
  return (baseId) => {
    const root = baseId.split('~')[0]!
    let n = 1
    while (seq.clips[`${root}~${n}`]) n++
    return `${root}~${n}`
  }
}

/** Frames of source available to a clip, or null if unlimited (stills). */
function mediaLimit(project: Project, seq: Sequence, clip: Clip): number | null {
  const asset = project.media[clip.mediaId]
  if (!asset) throw new CommandError('A clip points at media that is no longer in the project')
  return assetFrames(project, asset, seq.fps)
}

function checkSourceRange(project: Project, seq: Sequence, clip: Clip) {
  const limit = mediaLimit(project, seq, clip)
  if (limit !== null && clip.sourceIn + sourceSpan(clip) > limit) {
    throw new CommandError('That would use more of the source than the file has.')
  }
}

/** Puts primary-track clips back to back in the given order, carrying linked clips along. */
function relayoutPrimary(seq: Sequence, order: Clip[]) {
  const primary = primaryTrack(seq)
  if (!primary) return
  let cursor = 0
  const ids = splitIds(seq)
  for (const clip of order) {
    const delta = cursor - clip.start
    clip.start = cursor
    cursor = clipEnd(clip)
    if (delta === 0 || !clip.linkId) continue
    for (const other of Object.values(seq.clips)) {
      if (other.linkId !== clip.linkId || other.trackId === primary.id) continue
      other.start = Math.max(0, other.start + delta)
      clearRange(seq, other.trackId, other.start, clipEnd(other), new Set([other.id]), ids)
    }
  }
}

function magneticOrder(seq: Sequence): Clip[] {
  const primary = primaryTrack(seq)
  return primary ? clipsOnTrack(seq, primary.id) : []
}

function isMagneticPrimary(seq: Sequence, trackId: string) {
  return seq.magnetic && primaryTrack(seq)?.id === trackId
}

function placeClips(project: Project, seq: Sequence, clips: Clip[]) {
  const ids = splitIds(seq)
  for (const clip of clips) {
    const track = trackOf(seq, clip.trackId)
    if (!track) throw new CommandError('Track not found')
    assertUnlocked(seq, clip.trackId)
    const asset = project.media[clip.mediaId]
    if (!asset) throw new CommandError('Media not found')
    // Video tracks take pictures; audio tracks take any media with sound (the sound half of a video).
    const fits = track.kind === 'video' ? asset.kind !== 'audio' : asset.hasAudio
    if (!fits)
      throw new CommandError(
        track.kind === 'audio'
          ? 'Only media with sound can go on an audio track.'
          : 'Audio files go on an audio track.',
      )
    if (asset.kind === 'sequence') {
      const nested = nestedSequenceIds(project.sequences, project.media, asset.sequenceId ?? '')
      if (nested.has(seq.id)) throw new CommandError("A sequence can't contain itself.")
    }
    if (seq.clips[clip.id]) throw new CommandError(`Clip ${clip.id} already exists`)
    checkSourceRange(project, seq, clip)

    if (isMagneticPrimary(seq, clip.trackId)) {
      const at = nearestBoundary(seq, clip.start)
      const order = magneticOrder(seq)
      const index = order.findIndex((c) => c.start >= at)
      const placed = { ...clip, start: at }
      seq.clips[clip.id] = placed
      order.splice(index === -1 ? order.length : index, 0, seq.clips[clip.id]!)
      relayoutPrimary(seq, order)
    } else {
      clearRange(seq, clip.trackId, clip.start, clipEnd(clip), new Set(), ids)
      seq.clips[clip.id] = { ...clip }
    }
  }
}

/** A transition can't be longer than the clips it joins. */
function maxTransition(seq: Sequence, left: Clip | null, right: Clip | null): number {
  const lengths = [left?.duration, right?.duration].filter((n): n is number => n !== undefined)
  return Math.max(2, Math.min(...lengths) * (left && right ? 2 : 1))
}

/** Drops transitions whose clips are gone or no longer touch. */
export function pruneTransitions(project: Project) {
  for (const seq of Object.values(project.sequences)) {
    for (const tr of Object.values(seq.transitions)) {
      const left = tr.leftClipId ? seq.clips[tr.leftClipId] : null
      const right = tr.rightClipId ? seq.clips[tr.rightClipId] : null
      const valid =
        (tr.leftClipId === null || left) &&
        (tr.rightClipId === null || right) &&
        (!left ||
          !right ||
          (left.trackId === right.trackId &&
            clipEnd(left) === right.start &&
            left.trackId === tr.trackId))
      if (!valid) delete seq.transitions[tr.id]
    }
  }
}

// ---------------------------------------------------------------- apply

/** Mutates a draft project. Callers wrap this in Immer's produce. */
export function applyCommand(project: Project, cmd: Command): void {
  switch (cmd.type) {
    case 'media.add':
      for (const asset of cmd.assets) project.media[asset.id] = asset
      return

    case 'media.remove': {
      const ids = new Set(cmd.mediaIds)
      for (const mediaId of ids) {
        const asset = project.media[mediaId]
        if (asset?.kind === 'sequence' && asset.sequenceId) {
          if (asset.sequenceId === project.activeSequenceId) {
            throw new CommandError(
              "The open sequence can't be removed. Open another sequence first.",
            )
          }
          delete project.sequences[asset.sequenceId]
        }
        delete project.media[mediaId]
      }
      for (const seq of Object.values(project.sequences)) {
        const removed = Object.values(seq.clips).filter((c) => ids.has(c.mediaId))
        for (const clip of removed) delete seq.clips[clip.id]
        if (seq.magnetic && removed.length) relayoutPrimary(seq, magneticOrder(seq))
      }
      return
    }

    case 'media.update': {
      const asset = project.media[cmd.mediaId]
      if (!asset) throw new CommandError('Media not found')
      Object.assign(asset, cmd.patch)
      if (cmd.patch.name && asset.kind === 'sequence' && asset.sequenceId) {
        const seq = project.sequences[asset.sequenceId]
        if (seq) seq.name = cmd.patch.name
      }
      return
    }

    case 'sequence.add':
      if (project.sequences[cmd.sequence.id]) throw new CommandError('Sequence already exists')
      project.sequences[cmd.sequence.id] = cmd.sequence
      project.media[cmd.asset.id] = cmd.asset
      return

    case 'sequence.settings': {
      const seq = seqOf(project, cmd.sequenceId)
      if (cmd.width !== undefined) seq.width = cmd.width
      if (cmd.height !== undefined) seq.height = cmd.height
      if (cmd.fps && (cmd.fps.num !== seq.fps.num || cmd.fps.den !== seq.fps.den)) {
        // Clip positions are counted in frames, so the rate can only change while the sequence is empty.
        if (Object.keys(seq.clips).length > 0)
          throw new CommandError('The frame rate can only change while the sequence is empty.')
        seq.fps = { ...cmd.fps }
      }
      if (cmd.name !== undefined) {
        seq.name = cmd.name
        for (const m of Object.values(project.media))
          if (m.kind === 'sequence' && m.sequenceId === seq.id) m.name = cmd.name
      }
      if (cmd.colorSpace !== undefined) seq.colorSpace = cmd.colorSpace
      if (cmd.hdr !== undefined) {
        seq.hdr = cmd.hdr
        // HDR delivery is defined in Rec. 2020.
        if (cmd.hdr !== 'sdr') seq.colorSpace = 'rec2020'
      }
      if (cmd.master !== undefined) seq.master = cmd.master
      if (cmd.loudnessTarget !== undefined) seq.loudnessTarget = cmd.loudnessTarget
      if (cmd.inPoint !== undefined) seq.inPoint = cmd.inPoint
      if (cmd.outPoint !== undefined) seq.outPoint = cmd.outPoint
      if (cmd.targets !== undefined) seq.targets = { ...cmd.targets }
      if (cmd.magnetic !== undefined) {
        seq.magnetic = cmd.magnetic
        if (seq.magnetic) relayoutPrimary(seq, magneticOrder(seq))
      }
      return
    }

    case 'track.add': {
      const seq = seqOf(project, cmd.sequenceId)
      if (seq.tracks.some((t) => t.id === cmd.track.id))
        throw new CommandError('Track already exists')
      const index =
        cmd.index ??
        seq.tracks.filter((t) => t.kind === cmd.track.kind).length +
          (cmd.track.kind === 'audio' ? seq.tracks.filter((t) => t.kind === 'video').length : 0)
      seq.tracks.splice(Math.min(index, seq.tracks.length), 0, { ...cmd.track })
      return
    }

    case 'track.remove': {
      const seq = seqOf(project, cmd.sequenceId)
      const track = trackOf(seq, cmd.trackId)
      if (!track) throw new CommandError('Track not found')
      if (seq.tracks.filter((t) => t.kind === track.kind).length === 1) {
        throw new CommandError(`A sequence needs at least one ${track.kind} track.`)
      }
      seq.tracks = seq.tracks.filter((t) => t.id !== cmd.trackId)
      for (const clip of Object.values(seq.clips))
        if (clip.trackId === cmd.trackId) delete seq.clips[clip.id]
      if (seq.targets.video === cmd.trackId)
        seq.targets.video = seq.tracks.find((t) => t.kind === 'video')?.id ?? null
      if (seq.targets.audio === cmd.trackId)
        seq.targets.audio = seq.tracks.find((t) => t.kind === 'audio')?.id ?? null
      return
    }

    case 'track.update': {
      const seq = seqOf(project, cmd.sequenceId)
      const track = trackOf(seq, cmd.trackId)
      if (!track) throw new CommandError('Track not found')
      Object.assign(track, cmd.patch)
      return
    }

    case 'clip.add':
      placeClips(project, seqOf(project, cmd.sequenceId), cmd.clips)
      return

    case 'clip.insert': {
      const seq = seqOf(project, cmd.sequenceId)
      const length = Math.max(...cmd.clips.map((c) => c.duration))
      const shift = new Set(cmd.shiftTrackIds.filter((tid) => !trackOf(seq, tid)?.locked))
      if (seq.magnetic) {
        // The primary track handles its own ripple through the magnetic layout.
        const primary = primaryTrack(seq)
        if (primary) shift.delete(primary.id)
      }
      const ids = splitIds(seq)
      shiftFrom(seq, shift, cmd.at, length, ids)
      placeClips(
        project,
        seq,
        cmd.clips.map((c) => ({ ...c, start: cmd.at })),
      )
      return
    }

    case 'clip.remove': {
      const seq = seqOf(project, cmd.sequenceId)
      const removed = cmd.clipIds.map((cid) => clipOf(seq, cid))
      for (const clip of removed) assertUnlocked(seq, clip.trackId)
      for (const clip of removed) delete seq.clips[clip.id]
      if (cmd.ripple) {
        // Close each removed clip's gap on its own track, latest first so earlier shifts don't move later gaps.
        for (const clip of removed.sort((a, b) => b.start - a.start)) {
          if (isMagneticPrimary(seq, clip.trackId)) continue
          const blocked = clipsOnTrack(seq, clip.trackId).some(
            (c) => c.start < clipEnd(clip) && clipEnd(c) > clip.start,
          )
          if (!blocked)
            shiftFrom(seq, new Set([clip.trackId]), clipEnd(clip), -clip.duration, splitIds(seq))
        }
      }
      if (seq.magnetic) relayoutPrimary(seq, magneticOrder(seq))
      return
    }

    case 'clip.move': {
      const seq = seqOf(project, cmd.sequenceId)
      const moving = new Set(cmd.moves.map((m) => m.clipId))
      const ids = splitIds(seq)
      const primary = primaryTrack(seq)
      for (const move of cmd.moves) {
        const clip = clipOf(seq, move.clipId)
        const trackId = move.trackId ?? clip.trackId
        const from = trackOf(seq, clip.trackId)
        const to = trackOf(seq, trackId)
        if (!from || !to) throw new CommandError('Track not found')
        if (from.kind !== to.kind)
          throw new CommandError('Clips can only move between tracks of the same kind')
        assertUnlocked(seq, clip.trackId)
        assertUnlocked(seq, trackId)
      }
      // Magnetic primary-track moves reorder the storyline instead of overwriting.
      const magneticMove =
        seq.magnetic &&
        primary &&
        cmd.moves.find(
          (m) =>
            seq.clips[m.clipId]!.trackId === primary.id && (m.trackId ?? primary.id) === primary.id,
        )
      for (const move of cmd.moves) {
        if (magneticMove && move === magneticMove) continue
        const clip = seq.clips[move.clipId]!
        clip.start = move.start
        clip.trackId = move.trackId ?? clip.trackId
      }
      for (const move of cmd.moves) {
        if (magneticMove && move === magneticMove) continue
        const clip = seq.clips[move.clipId]!
        if (isMagneticPrimary(seq, clip.trackId)) continue
        clearRange(seq, clip.trackId, clip.start, clipEnd(clip), moving, ids)
      }
      if (magneticMove) {
        const clip = seq.clips[magneticMove.clipId]!
        const order = magneticOrder(seq).filter((c) => c.id !== clip.id)
        const at = nearestBoundary(
          seq,
          magneticMove.start + (magneticMove.start > clip.start ? clip.duration : 0),
          new Set([clip.id]),
        )
        let cursor = 0
        let index = order.length
        for (let i = 0; i < order.length; i++) {
          if (cursor >= at) {
            index = i
            break
          }
          cursor += order[i]!.duration
        }
        order.splice(index, 0, clip)
        // Linked clips of the moved clip were already shifted above; relayout handles the rest.
        relayoutPrimary(seq, order)
      } else if (seq.magnetic) {
        relayoutPrimary(seq, magneticOrder(seq))
      }
      return
    }

    case 'clip.trim': {
      const seq = seqOf(project, cmd.sequenceId)
      const clip = clipOf(seq, cmd.clipId)
      assertUnlocked(seq, clip.trackId)
      const limit = mediaLimit(project, seq, clip)
      const oldEnd = clipEnd(clip)
      const oldStart = clip.start
      if (cmd.edge === 'start') {
        // Extending to the left can't go before the media's first frame.
        const speed = clip.ramp ? 1 : Math.max(clip.speed, 1e-9)
        const room = clip.reverse
          ? limit === null
            ? Infinity
            : limit - clip.sourceIn - sourceSpan(clip)
          : clip.sourceIn
        const earliest = Math.max(
          0,
          clip.start - (clip.speed === 0 && !clip.ramp ? Infinity : Math.floor(room / speed)),
        )
        const target = Math.min(Math.max(cmd.frame, earliest), oldEnd - 1)
        const delta = target - clip.start
        if (delta >= 0) {
          Object.assign(clip, portion(clip, delta, clip.duration))
        } else {
          const extra = -delta
          const grown = {
            ...clip,
            start: target,
            duration: clip.duration + extra,
            ramp: clip.ramp
              ? [
                  { at: 0, speed: clip.ramp[0]!.speed },
                  ...clip.ramp.map((p) => ({ ...p, at: p.at + extra })),
                ]
              : null,
          }
          if (!clip.reverse && !(clip.speed === 0 && !clip.ramp))
            grown.sourceIn = Math.max(0, clip.sourceIn - Math.round(extra * speed))
          // Keys keep their pictures: the clip now starts `extra` frames earlier.
          Object.assign(clip, shiftClipKeys(grown, -extra))
        }
      } else {
        const speed = clip.ramp ? 1 : clip.speed
        const room = clip.reverse
          ? clip.sourceIn
          : limit === null
            ? Infinity
            : limit - clip.sourceIn - sourceSpan(clip)
        const latest =
          speed === 0 ? Infinity : clip.start + clip.duration + Math.floor(room / speed)
        const target = Math.max(Math.min(cmd.frame, latest), clip.start + 1)
        const newDuration = target - clip.start
        if (newDuration <= clip.duration) {
          Object.assign(clip, portion(clip, 0, newDuration))
        } else {
          const extra = newDuration - clip.duration
          if (clip.ramp)
            clip.ramp = [
              ...clip.ramp,
              { at: newDuration, speed: clip.ramp[clip.ramp.length - 1]!.speed },
            ]
          if (clip.reverse && speed !== 0)
            clip.sourceIn = Math.max(0, clip.sourceIn - Math.round(extra * speed))
          clip.duration = newDuration
        }
      }
      checkSourceRange(project, seq, clip)
      if (isMagneticPrimary(seq, clip.trackId)) {
        relayoutPrimary(seq, magneticOrder(seq))
        return
      }
      if (cmd.ripple) {
        // Ripple: the clip keeps its place and everything after it on the track takes up the change.
        const change = cmd.edge === 'end' ? clipEnd(clip) - oldEnd : -(clip.start - oldStart)
        clip.start = oldStart
        for (const other of Object.values(seq.clips)) {
          if (other.trackId === clip.trackId && other.id !== clip.id && other.start >= oldEnd)
            other.start = Math.max(0, other.start + change)
        }
        return
      }
      clearRange(seq, clip.trackId, clip.start, clipEnd(clip), new Set([clip.id]), () => {
        throw new CommandError('A trim never splits another clip')
      })
      return
    }

    case 'clip.split': {
      const seq = seqOf(project, cmd.sequenceId)
      const clip = clipOf(seq, cmd.clipId)
      assertUnlocked(seq, clip.trackId)
      if (cmd.frame <= clip.start || cmd.frame >= clipEnd(clip))
        throw new CommandError('The split point is outside the clip')
      const offset = cmd.frame - clip.start
      const rightId = cmd.newClipId ?? splitIds(seq)(clip.id)
      if (seq.clips[rightId]) throw new CommandError(`Clip ${rightId} already exists`)
      const right = { ...portion(clip, offset, clip.duration), id: rightId }
      // A cut is not an edge: fades stay on the outer ends.
      right.sound = { ...right.sound, fadeIn: 0 }
      if (clip.linkId) right.linkId = cmd.newLinkId ?? `${clip.linkId}~${rightId}`
      seq.clips[rightId] = right
      const left = portion(clip, 0, offset)
      Object.assign(clip, { ...left, sound: { ...left.sound, fadeOut: 0 } })
      return
    }

    case 'clip.roll': {
      const seq = seqOf(project, cmd.sequenceId)
      const left = clipOf(seq, cmd.leftId)
      const right = clipOf(seq, cmd.rightId)
      if (left.trackId !== right.trackId || clipEnd(left) !== right.start)
        throw new CommandError('Rolling needs two clips that touch')
      assertUnlocked(seq, left.trackId)
      const leftLimit = mediaLimit(project, seq, left)
      const leftSpeed = left.ramp ? 1 : left.speed
      const rightSpeed = right.ramp ? 1 : right.speed
      const maxRight =
        leftLimit === null || leftSpeed === 0
          ? Infinity
          : clipEnd(left) + Math.floor((leftLimit - left.sourceIn - sourceSpan(left)) / leftSpeed)
      const minLeft =
        rightSpeed === 0 ? -Infinity : right.start - Math.floor(right.sourceIn / rightSpeed)
      const target = Math.min(
        Math.max(cmd.frame, left.start + 1, minLeft),
        clipEnd(right) - 1,
        maxRight,
      )
      const delta = target - right.start
      if (delta === 0) return
      if (delta > 0) {
        left.duration += delta
        Object.assign(right, portion(right, delta, right.duration))
      } else {
        Object.assign(left, portion(left, 0, left.duration + delta))
        right.start += delta
        right.duration -= delta
        if (rightSpeed !== 0)
          right.sourceIn = Math.max(0, right.sourceIn + Math.round(delta * rightSpeed))
      }
      return
    }

    case 'clip.slip': {
      const seq = seqOf(project, cmd.sequenceId)
      const clip = clipOf(seq, cmd.clipId)
      assertUnlocked(seq, clip.trackId)
      const limit = mediaLimit(project, seq, clip)
      const max = limit === null ? clip.sourceIn + cmd.delta : limit - sourceSpan(clip)
      clip.sourceIn = Math.max(0, Math.min(clip.sourceIn + cmd.delta, max))
      return
    }

    case 'clip.slide': {
      const seq = seqOf(project, cmd.sequenceId)
      const clip = clipOf(seq, cmd.clipId)
      assertUnlocked(seq, clip.trackId)
      const neighbours = clipsOnTrack(seq, clip.trackId)
      const i = neighbours.findIndex((c) => c.id === clip.id)
      const prev =
        neighbours[i - 1] && clipEnd(neighbours[i - 1]!) === clip.start ? neighbours[i - 1]! : null
      const next =
        neighbours[i + 1] && neighbours[i + 1]!.start === clipEnd(clip) ? neighbours[i + 1]! : null
      let delta = cmd.delta
      // The neighbours give and take frames; neither may vanish or run past its media.
      if (prev) {
        const limit = mediaLimit(project, seq, prev)
        const speed = prev.ramp ? 1 : prev.speed
        delta = Math.max(delta, -(prev.duration - 1))
        if (limit !== null && speed > 0)
          delta = Math.min(delta, Math.floor((limit - prev.sourceIn - sourceSpan(prev)) / speed))
      } else {
        delta = Math.max(delta, -clip.start)
      }
      if (next) {
        const speed = next.ramp ? 1 : next.speed
        delta = Math.min(delta, next.duration - 1)
        if (speed > 0) delta = Math.max(delta, -Math.floor(next.sourceIn / speed))
      }
      if (delta === 0) return
      if (prev) {
        if (delta > 0) prev.duration += delta
        else Object.assign(prev, portion(prev, 0, prev.duration + delta))
      }
      if (next) {
        if (delta > 0) Object.assign(next, portion(next, delta, next.duration))
        else {
          const speed = next.ramp ? 1 : next.speed
          next.start += delta
          next.duration -= delta
          next.sourceIn = Math.max(0, next.sourceIn + Math.round(delta * speed))
        }
      }
      clip.start += delta
      if (!prev || !next) {
        clearRange(
          seq,
          clip.trackId,
          clip.start,
          clipEnd(clip),
          new Set([clip.id, prev?.id ?? '', next?.id ?? '']),
          splitIds(seq),
        )
      }
      return
    }

    case 'clip.rateStretch': {
      const seq = seqOf(project, cmd.sequenceId)
      const clip = clipOf(seq, cmd.clipId)
      assertUnlocked(seq, clip.trackId)
      const span = sourceSpan(clip)
      const oldDuration = clip.duration
      const end = clipEnd(clip)
      const target =
        cmd.edge === 'end' ? Math.max(clip.start + 1, cmd.frame) : Math.min(end - 1, cmd.frame)
      const duration = cmd.edge === 'end' ? target - clip.start : end - target
      // Same source frames over a new length: speed = span / duration, kept within 5% to 2000%.
      const clamped = Math.min(Math.max(duration, Math.ceil(span / 20)), Math.floor(span / 0.05))
      if (clip.ramp) clip.ramp = scaleRamp(clip.ramp, oldDuration, clamped)
      else if (clip.speed !== 0) clip.speed = span / clamped
      clip.duration = clamped
      if (cmd.edge === 'start') clip.start = end - clamped
      if (isMagneticPrimary(seq, clip.trackId)) relayoutPrimary(seq, magneticOrder(seq))
      else
        clearRange(seq, clip.trackId, clip.start, clipEnd(clip), new Set([clip.id]), splitIds(seq))
      return
    }

    case 'clip.speed': {
      const seq = seqOf(project, cmd.sequenceId)
      const clip = clipOf(seq, cmd.clipId)
      assertUnlocked(seq, clip.trackId)
      const span = sourceSpan(clip)
      const oldEnd = clipEnd(clip)
      clip.reverse = cmd.reverse
      clip.interpolation = cmd.interpolation
      if (cmd.ramp) {
        // A ramp keeps the clip's length; the source range it covers follows the curve.
        const ramp = [...cmd.ramp].sort((a, b) => a.at - b.at)
        clip.ramp = ramp
        checkSourceRange(project, seq, clip)
      } else {
        clip.ramp = null
        clip.speed = cmd.speed
        // A freeze frame keeps the clip's length; other speeds keep the source range.
        if (cmd.speed > 0) clip.duration = Math.max(1, Math.round(span / cmd.speed))
      }
      const delta = clipEnd(clip) - oldEnd
      if (isMagneticPrimary(seq, clip.trackId)) relayoutPrimary(seq, magneticOrder(seq))
      else if (cmd.ripple) {
        for (const other of Object.values(seq.clips)) {
          if (other.trackId === clip.trackId && other.id !== clip.id && other.start >= oldEnd)
            other.start = Math.max(0, other.start + delta)
        }
      } else
        clearRange(seq, clip.trackId, clip.start, clipEnd(clip), new Set([clip.id]), splitIds(seq))
      return
    }

    case 'clip.update': {
      const seq = seqOf(project, cmd.sequenceId)
      if (cmd.patch.mediaId && !project.media[cmd.patch.mediaId])
        throw new CommandError('Media not found')
      for (const cid of cmd.clipIds) Object.assign(clipOf(seq, cid), cmd.patch)
      return
    }

    case 'clip.look': {
      const seq = seqOf(project, cmd.sequenceId)
      for (const cid of cmd.clipIds) {
        const clip = clipOf(seq, cid)
        assertUnlocked(seq, clip.trackId)
        Object.assign(clip, cmd.patch)
      }
      return
    }

    case 'transition.add': {
      const seq = seqOf(project, cmd.sequenceId)
      const tr = cmd.transition
      const left = tr.leftClipId ? clipOf(seq, tr.leftClipId) : null
      const right = tr.rightClipId ? clipOf(seq, tr.rightClipId) : null
      if (!left && !right) throw new CommandError('A transition needs a clip on at least one side.')
      if (left && right && (left.trackId !== right.trackId || clipEnd(left) !== right.start)) {
        throw new CommandError('Transitions go between two clips that touch on the same track.')
      }
      assertUnlocked(seq, (left ?? right)!.trackId)
      // One transition per cut: a new one replaces what was there.
      for (const other of Object.values(seq.transitions)) {
        if (
          other.trackId === tr.trackId &&
          other.leftClipId === tr.leftClipId &&
          other.rightClipId === tr.rightClipId
        )
          delete seq.transitions[other.id]
      }
      seq.transitions[tr.id] = {
        ...tr,
        duration: Math.max(2, Math.min(tr.duration, maxTransition(seq, left, right))),
      }
      return
    }

    case 'transition.update': {
      const seq = seqOf(project, cmd.sequenceId)
      const tr = seq.transitions[cmd.transitionId]
      if (!tr) throw new CommandError('Transition not found')
      Object.assign(tr, cmd.patch)
      const left = tr.leftClipId ? (seq.clips[tr.leftClipId] ?? null) : null
      const right = tr.rightClipId ? (seq.clips[tr.rightClipId] ?? null) : null
      tr.duration = Math.max(2, Math.min(tr.duration, maxTransition(seq, left, right)))
      return
    }

    case 'transition.remove': {
      const seq = seqOf(project, cmd.sequenceId)
      for (const tid of cmd.transitionIds) delete seq.transitions[tid]
      return
    }

    case 'range.lift':
    case 'range.extract': {
      const seq = seqOf(project, cmd.sequenceId)
      if (cmd.end <= cmd.start)
        throw new CommandError('Set an in point before the out point first.')
      const tracks = new Set(cmd.trackIds.filter((tid) => !trackOf(seq, tid)?.locked))
      const ids = splitIds(seq)
      for (const tid of tracks) clearRange(seq, tid, cmd.start, cmd.end, new Set(), ids)
      if (cmd.type === 'range.extract') {
        shiftFrom(seq, tracks, cmd.end, -(cmd.end - cmd.start), splitIds(seq))
        seq.captions = extractFromCaptions(seq.captions, cmd.start, cmd.end)
        seq.inPoint = null
        seq.outPoint = null
      }
      if (seq.magnetic) relayoutPrimary(seq, magneticOrder(seq))
      return
    }

    case 'marker.add': {
      const seq = seqOf(project, cmd.sequenceId)
      seq.markers[cmd.marker.id] = { ...cmd.marker }
      return
    }

    case 'marker.update': {
      const seq = seqOf(project, cmd.sequenceId)
      const marker = seq.markers[cmd.markerId]
      if (!marker) throw new CommandError('Marker not found')
      Object.assign(marker, cmd.patch)
      return
    }

    case 'marker.remove': {
      const seq = seqOf(project, cmd.sequenceId)
      for (const mid of cmd.markerIds) delete seq.markers[mid]
      return
    }

    case 'restore':
      for (const [sid, seq] of Object.entries(cmd.sequences)) {
        if (seq) project.sequences[sid] = seq
        else delete project.sequences[sid]
      }
      for (const [mid, asset] of Object.entries(cmd.media)) {
        if (asset) project.media[mid] = asset
        else delete project.media[mid]
      }
      return

    case 'captions.set':
      seqOf(project, cmd.sequenceId).captions = cmd.captions
      return

    case 'batch':
      for (const sub of cmd.commands) applyCommand(project, sub)
      return
  }
}
