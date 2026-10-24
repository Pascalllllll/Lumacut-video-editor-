import type { Command } from './commands'
import { assetFrames } from './media'
import {
  createClip,
  createId,
  createSequence,
  createTrack,
  generatorAsset,
  sequenceAsset,
  type Transition,
  type Clip,
  type MediaAsset,
  type Project,
  type Sequence,
  type Track,
} from './model'
import { secondsToFrames, secondsToWholeFrames } from './time'
import { clipAt, clipEnd, companions, primaryTrack, trackOf } from './timeline'

/** Images land on the timeline with this length. */
export const IMAGE_SECONDS = 5

export class EditError extends Error {}

function targetTrack(seq: Sequence, kind: Track['kind']): Track | undefined {
  const preferred = kind === 'video' ? seq.targets.video : seq.targets.audio
  return (
    (preferred ? trackOf(seq, preferred) : undefined) ?? seq.tracks.find((t) => t.kind === kind)
  )
}

/** Source in and out, in sequence frames, from the item's marks or its whole length. */
export function sourceRange(
  project: Project,
  seq: Sequence,
  asset: MediaAsset,
): { start: number; end: number; marked: boolean } {
  const length =
    assetFrames(project, asset, seq.fps) ?? secondsToWholeFrames(IMAGE_SECONDS, seq.fps)
  const inF = asset.marks.in === null ? null : Math.max(0, secondsToFrames(asset.marks.in, seq.fps))
  const outF =
    asset.marks.out === null ? null : Math.min(length, secondsToFrames(asset.marks.out, seq.fps))
  const start = inF ?? 0
  const end = Math.max(start + 1, outF ?? length)
  return { start, end, marked: inF !== null && outF !== null }
}

/**
 * Clips for placing a media item: the picture on the target video track and
 * the sound on the target audio track, linked so they edit together.
 */
export function placementClips(
  project: Project,
  seq: Sequence,
  asset: MediaAsset,
  start: number,
  opts: {
    sourceIn?: number
    duration?: number
    videoTrackId?: string
    audioTrackId?: string
    speed?: number
  } = {},
): Clip[] {
  const range = sourceRange(project, seq, asset)
  const sourceIn = opts.sourceIn ?? (asset.kind === 'image' ? 0 : range.start)
  const duration =
    opts.duration ??
    (asset.kind === 'image' ? secondsToWholeFrames(IMAGE_SECONDS, seq.fps) : range.end - sourceIn)
  if (duration <= 0) throw new EditError('The source range is empty. Check the in and out marks.')
  const nested =
    asset.kind === 'sequence' && asset.sequenceId ? project.sequences[asset.sequenceId] : undefined
  const base = { mediaId: asset.id, start, duration, sourceIn, speed: opts.speed ?? 1 }
  const clips: Clip[] = []
  const linkId = asset.kind !== 'audio' && asset.hasAudio && asset.hasVideo ? createId('lnk') : null
  if (asset.kind !== 'audio') {
    const track = opts.videoTrackId ? trackOf(seq, opts.videoTrackId) : targetTrack(seq, 'video')
    if (!track) throw new EditError('This sequence has no video track.')
    clips.push(
      createClip({ ...base, trackId: track.id, linkId, angle: nested?.multicam ? 0 : null }),
    )
  }
  if (asset.hasAudio && asset.kind !== 'image') {
    const track = opts.audioTrackId ? trackOf(seq, opts.audioTrackId) : targetTrack(seq, 'audio')
    if (track) clips.push(createClip({ ...base, trackId: track.id, linkId }))
  }
  if (clips.length === 0) throw new EditError('This sequence has no track for that kind of media.')
  return clips
}

/** Overwrite placement, with the first video into an empty sequence setting its size and frame rate. */
export function placeCommand(
  project: Project,
  seq: Sequence,
  asset: MediaAsset,
  start: number,
  opts: Parameters<typeof placementClips>[4] = {},
): Command {
  const adopt =
    Object.keys(seq.clips).length === 0 &&
    asset.kind === 'video' &&
    asset.width &&
    asset.height &&
    asset.fps &&
    !seq.multicam
  const target = adopt
    ? { ...seq, width: asset.width!, height: asset.height!, fps: asset.fps! }
    : seq
  const add: Command = {
    type: 'clip.add',
    sequenceId: seq.id,
    clips: placementClips(project, target, asset, start, opts),
  }
  if (!adopt) return add
  return {
    type: 'batch',
    label: 'Add clip',
    commands: [
      {
        type: 'sequence.settings',
        sequenceId: seq.id,
        width: asset.width!,
        height: asset.height!,
        fps: asset.fps!,
      },
      add,
    ],
  }
}

export type SourceEdit = 'insert' | 'overwrite' | 'replace' | 'fit'

/**
 * Three- and four-point editing. Marks on the source item and the sequence
 * decide what goes where; whichever mark is missing is worked out from the
 * others, and the playhead stands in for a missing sequence in point.
 */
export function sourceEditCommand(
  project: Project,
  seq: Sequence,
  asset: MediaAsset,
  mode: SourceEdit,
  playhead: number,
): Command {
  const src = sourceRange(project, seq, asset)
  const srcLength = src.end - src.start
  const seqIn = seq.inPoint
  const seqOut =
    seq.outPoint !== null && (seqIn === null || seq.outPoint > seqIn) ? seq.outPoint : null

  if (mode === 'replace') {
    const track = targetTrack(seq, asset.kind === 'audio' ? 'audio' : 'video')
    const existing = track ? clipAt(seq, track.id, playhead) : undefined
    if (!existing)
      throw new EditError('Put the playhead over a clip on the target track to replace it.')
    const group = [...companions(seq, [existing.id])].map((id) => seq.clips[id]!)
    const start = Math.min(...group.map((c) => c.start))
    const end = Math.max(...group.map(clipEnd))
    const clips = placementClips(project, seq, asset, start, {
      sourceIn: src.start,
      duration: Math.min(end - start, asset.kind === 'image' ? end - start : srcLength),
    })
    return {
      type: 'batch',
      label: 'Replace',
      commands: [
        { type: 'clip.remove', sequenceId: seq.id, clipIds: group.map((c) => c.id) },
        { type: 'clip.add', sequenceId: seq.id, clips },
      ],
    }
  }

  let at = seqIn ?? playhead
  let duration = srcLength
  let speed = 1
  if (seqIn !== null && seqOut !== null) {
    const span = seqOut - seqIn
    if (mode === 'fit' && src.marked && asset.kind !== 'image') speed = srcLength / span
    duration = asset.kind === 'image' || mode === 'fit' ? span : Math.min(span, srcLength)
  } else if (seqIn === null && seqOut !== null) {
    // Only an out point: the clip ends there.
    at = Math.max(0, seqOut - srcLength)
  }
  if (mode === 'fit' && (seqIn === null || seqOut === null)) {
    throw new EditError('Fit to fill needs an in and an out point on the timeline.')
  }
  if (speed < 0.05 || speed > 20)
    throw new EditError('Fitting this clip would need a speed below 5% or above 2000%.')

  const clips = placementClips(project, seq, asset, at, { sourceIn: src.start, duration, speed })
  if (mode === 'insert') {
    return {
      type: 'clip.insert',
      sequenceId: seq.id,
      clips,
      at,
      shiftTrackIds: seq.tracks.map((t) => t.id),
    }
  }
  return { type: 'clip.add', sequenceId: seq.id, clips }
}

/**
 * Splits clips at several frames (beat markers, for instance). Working from the
 * last frame back keeps each clip's id on its first piece, so every later split
 * still finds it.
 */
export function cutAtFrames(seq: Sequence, clipIds: string[], frames: number[]): Command | null {
  const commands = [...new Set(frames)]
    .sort((a, b) => b - a)
    .map((f) => bladeCommand(seq, clipIds, f))
    .filter((c): c is Command => c !== null)
  return commands.length ? { type: 'batch', label: 'Cut at markers', commands } : null
}

/** Splits clips at a frame. Linked halves get a shared new link so they still edit together. */
export function bladeCommand(seq: Sequence, clipIds: string[], frame: number): Command | null {
  const targets = clipIds
    .map((id) => seq.clips[id])
    .filter((c): c is Clip => Boolean(c) && c!.start < frame && clipEnd(c!) > frame)
  if (targets.length === 0) return null
  const newLinks = new Map<string, string>()
  return {
    type: 'batch',
    label: 'Split',
    commands: targets.map((c) => {
      let newLinkId: string | undefined
      if (c.linkId) {
        newLinkId = newLinks.get(c.linkId) ?? createId('lnk')
        newLinks.set(c.linkId, newLinkId)
      }
      return {
        type: 'clip.split',
        sequenceId: seq.id,
        clipId: c.id,
        frame,
        newClipId: createId('clp'),
        ...(newLinkId ? { newLinkId } : {}),
      }
    }),
  }
}

/** Every clip under a frame on unlocked tracks. */
export function clipsUnder(seq: Sequence, frame: number): string[] {
  return seq.tracks
    .filter((t) => !t.locked)
    .flatMap((t) => {
      const c = clipAt(seq, t.id, frame)
      return c ? [c.id] : []
    })
}

export function markerCommand(seq: Sequence, frame: number): Command {
  const n = Object.keys(seq.markers).length + 1
  return {
    type: 'marker.add',
    sequenceId: seq.id,
    marker: { id: createId('mrk'), frame, name: `Marker ${n}`, note: '', color: 'blue' },
  }
}

export function newSequenceCommand(project: Project, name: string, base?: Sequence): Command {
  const seq = createSequence(
    name,
    base ? { width: base.width, height: base.height, fps: base.fps } : undefined,
  )
  return { type: 'sequence.add', sequence: seq, asset: sequenceAsset(seq) }
}

/**
 * Turns selected clips into one compound clip: they move into a new sequence
 * (keeping their tracks and spacing) and a single clip of that sequence takes
 * their place.
 */
export function compoundCommand(
  project: Project,
  seq: Sequence,
  clipIds: string[],
  name: string,
): Command {
  const clips = [...companions(seq, clipIds)].map((id) => seq.clips[id]!).filter(Boolean)
  if (clips.length === 0) throw new EditError('Select the clips to combine first.')
  const start = Math.min(...clips.map((c) => c.start))
  const end = Math.max(...clips.map(clipEnd))
  const inner = createSequence(name, { width: seq.width, height: seq.height, fps: seq.fps })
  // Mirror the outer tracks that hold selected clips, keeping their order.
  const used = seq.tracks.filter((t) => clips.some((c) => c.trackId === t.id))
  const mapping = new Map<string, string>()
  const videos = used.filter((t) => t.kind === 'video')
  const audios = used.filter((t) => t.kind === 'audio')
  inner.tracks = [
    ...(videos.length ? videos : [{ kind: 'video' as const, name: 'V1', id: '' }]).map((t, i) => {
      const nt = createTrack('video', `V${i + 1}`)
      if (t.id) mapping.set(t.id, nt.id)
      return nt
    }),
    ...(audios.length ? audios : [{ kind: 'audio' as const, name: 'A1', id: '' }]).map((t, i) => {
      const nt = createTrack('audio', `A${i + 1}`)
      if (t.id) mapping.set(t.id, nt.id)
      return nt
    }),
  ]
  inner.targets = {
    video: inner.tracks[0]!.id,
    audio: inner.tracks.find((t) => t.kind === 'audio')!.id,
  }
  for (const c of clips) {
    const copy = {
      ...c,
      id: createId('clp'),
      trackId: mapping.get(c.trackId)!,
      start: c.start - start,
    }
    inner.clips[copy.id] = copy
  }
  const asset = sequenceAsset(inner)
  asset.hasVideo = videos.length > 0
  asset.hasAudio = audios.length > 0
  const project2 = { ...project, sequences: { ...project.sequences, [inner.id]: inner } }
  const outerVideo = videos[0]?.id
  const outerAudio = audios[0]?.id
  const replacement = placementClips(project2, seq, asset, start, {
    sourceIn: 0,
    duration: end - start,
    ...(outerVideo ? { videoTrackId: outerVideo } : {}),
    ...(outerAudio ? { audioTrackId: outerAudio } : {}),
  })
  return {
    type: 'batch',
    label: 'Make compound clip',
    commands: [
      { type: 'sequence.add', sequence: inner, asset },
      { type: 'clip.remove', sequenceId: seq.id, clipIds: clips.map((c) => c.id) },
      { type: 'clip.add', sequenceId: seq.id, clips: replacement },
    ],
  }
}

/**
 * A multicam clip: each angle on its own video and audio track of a new
 * sequence, lined up by `offsets` (seconds each file started after the first).
 */
export function multicamCommand(
  project: Project,
  assets: MediaAsset[],
  offsets: number[],
  name: string,
): { command: Command; asset: MediaAsset } {
  if (assets.length < 2) throw new EditError('A multicam clip needs at least two angles.')
  const first = assets.find((a) => a.kind === 'video') ?? assets[0]!
  const seq = createSequence(name, {
    width: first.width ?? 1920,
    height: first.height ?? 1080,
    fps: first.fps ?? { num: 30, den: 1 },
  })
  seq.multicam = true
  const min = Math.min(...offsets)
  const videos = assets.map((_, i) => createTrack('video', `Angle ${i + 1}`))
  const audios = assets.map((_, i) => createTrack('audio', `Angle ${i + 1}`))
  seq.tracks = [...videos, ...audios]
  seq.targets = { video: videos[0]!.id, audio: audios[0]!.id }
  assets.forEach((asset, i) => {
    const start = secondsToFrames((offsets[i] ?? 0) - min, seq.fps)
    const length =
      assetFrames(project, asset, seq.fps) ?? secondsToWholeFrames(IMAGE_SECONDS, seq.fps)
    const linkId = createId('lnk')
    if (asset.kind !== 'audio')
      seq.clips[`mc${i}v`] = createClip({
        id: createId('clp'),
        mediaId: asset.id,
        trackId: videos[i]!.id,
        start,
        duration: length,
        sourceIn: 0,
        linkId,
      })
    if (asset.hasAudio)
      seq.clips[`mc${i}a`] = createClip({
        id: createId('clp'),
        mediaId: asset.id,
        trackId: audios[i]!.id,
        start,
        duration: length,
        sourceIn: 0,
        linkId,
      })
  })
  // Clips are keyed by their ids.
  seq.clips = Object.fromEntries(Object.values(seq.clips).map((c) => [c.id, c]))
  // Only the first angle's sound plays by default; the others are there to switch to.
  audios.slice(1).forEach((t) => (t.muted = true))
  const asset = sequenceAsset(seq)
  return { command: { type: 'sequence.add', sequence: seq, asset }, asset }
}

/** Shows another angle of a multicam clip, cutting at `frame` when it falls inside the clip. */
export function angleCommand(
  seq: Sequence,
  clipId: string,
  angle: number,
  frame: number,
): Command | null {
  const clip = seq.clips[clipId]
  if (!clip || clip.angle === null || clip.angle === angle) return null
  if (frame <= clip.start || frame >= clipEnd(clip)) {
    return { type: 'clip.update', sequenceId: seq.id, clipIds: [clip.id], patch: { angle } }
  }
  const newId = createId('clp')
  return {
    type: 'batch',
    label: 'Switch angle',
    commands: [
      { type: 'clip.split', sequenceId: seq.id, clipId: clip.id, frame, newClipId: newId },
      { type: 'clip.update', sequenceId: seq.id, clipIds: [newId], patch: { angle } },
    ],
  }
}

/** The multicam clip on the primary track under a frame, if any. */
export function multicamAt(project: Project, seq: Sequence, frame: number): Clip | undefined {
  const primary = primaryTrack(seq)
  for (const track of seq.tracks.filter((t) => t.kind === 'video').reverse()) {
    const c = clipAt(seq, track.id, frame)
    if (c && c.angle !== null) return c
    if (track === primary) break
  }
  return undefined
}

export function linkCommand(seq: Sequence, clipIds: string[], link: boolean): Command {
  return {
    type: 'clip.update',
    sequenceId: seq.id,
    clipIds,
    patch: { linkId: link ? createId('lnk') : null },
  }
}

export function groupCommand(seq: Sequence, clipIds: string[], group: boolean): Command {
  return {
    type: 'clip.update',
    sequenceId: seq.id,
    clipIds,
    patch: { groupId: group ? createId('grp') : null },
  }
}

/**
 * Dropping media on a track: the matching track of the other kind takes the
 * other half (V2 pairs with A2), and is created if the sequence doesn't have
 * it yet, so a drop never lands on unrelated sound or picture.
 */
export function dropCommand(
  project: Project,
  seq: Sequence,
  asset: MediaAsset,
  start: number,
  trackId: string,
): Command {
  const track = trackOf(seq, trackId)
  if (!track) throw new EditError('Track not found')
  if (asset.kind === 'audio' && track.kind === 'video')
    throw new EditError('Audio files go on an audio track.')
  const sameKind = seq.tracks.filter((t) => t.kind === track.kind)
  const index = sameKind.indexOf(track)
  const otherKind = track.kind === 'video' ? 'audio' : 'video'
  const needsOther =
    track.kind === 'video' ? asset.hasAudio && asset.kind !== 'image' : asset.kind !== 'audio'
  const others = seq.tracks.filter((t) => t.kind === otherKind)
  const added: Track[] = []
  let otherId: string | undefined
  if (needsOther) {
    if (others[index]) otherId = others[index]!.id
    else {
      for (let i = others.length; i <= index; i++)
        added.push(createTrack(otherKind, `${otherKind === 'video' ? 'V' : 'A'}${i + 1}`))
      otherId = added[added.length - 1]!.id
    }
  }
  const withTracks = added.length ? { ...seq, tracks: [...seq.tracks, ...added] } : seq
  const ids =
    track.kind === 'video'
      ? { videoTrackId: track.id, audioTrackId: otherId }
      : { audioTrackId: track.id, videoTrackId: otherId }
  const place = placeCommand(
    project,
    withTracks,
    asset,
    start,
    Object.fromEntries(Object.entries(ids).filter(([, v]) => v)) as {
      videoTrackId?: string
      audioTrackId?: string
    },
  )
  if (!added.length) return place
  return {
    type: 'batch',
    label: 'Add clip',
    commands: [
      ...added.map((tr) => ({ type: 'track.add' as const, sequenceId: seq.id, track: tr })),
      place,
    ],
  }
}

/**
 * A transition on one edge of a clip: between it and a touching neighbour,
 * or a fade to or from nothing when there's no neighbour.
 */
export function transitionCommand(
  seq: Sequence,
  clipId: string,
  edge: 'start' | 'end',
  type: Transition['type'],
  duration: number,
): Command {
  const clip = seq.clips[clipId]
  if (!clip) throw new EditError('Clip not found')
  const neighbours = Object.values(seq.clips).filter((c) => c.trackId === clip.trackId)
  const other =
    edge === 'end'
      ? neighbours.find((c) => c.start === clipEnd(clip))
      : neighbours.find((c) => clipEnd(c) === clip.start)
  const left = edge === 'end' ? clip.id : (other?.id ?? null)
  const right = edge === 'end' ? (other?.id ?? null) : clip.id
  return {
    type: 'transition.add',
    sequenceId: seq.id,
    transition: {
      id: createId('trn'),
      trackId: clip.trackId,
      leftClipId: left,
      rightClipId: right,
      type,
      duration,
      ease: 'linear',
    },
  }
}

/** The cut on a track nearest a frame, as a clip and the edge it sits on. */
export function nearestCut(
  seq: Sequence,
  trackId: string,
  frame: number,
): { clipId: string; edge: 'start' | 'end' } | null {
  let best: { clipId: string; edge: 'start' | 'end'; d: number } | null = null
  for (const c of Object.values(seq.clips)) {
    if (c.trackId !== trackId) continue
    for (const [edge, at] of [
      ['start', c.start],
      ['end', clipEnd(c)],
    ] as const) {
      const d = Math.abs(at - frame)
      if (!best || d < best.d) best = { clipId: c.id, edge, d }
    }
  }
  return best ? { clipId: best.clipId, edge: best.edge } : null
}

/**
 * Places a title, solid color or adjustment layer at `start` on a video
 * track, creating the media-list item for that kind the first time.
 */
export function generatorCommand(
  project: Project,
  seq: Sequence,
  kind: 'title' | 'color' | 'adjustment',
  start: number,
  trackId: string,
  opts: { title?: Clip['title']; color?: string; name: string; seconds?: number },
): Command {
  const existing = Object.values(project.media).find(
    (m) => m.kind === 'generator' && m.generator === kind,
  )
  const asset = existing ?? generatorAsset(kind, opts.name)
  const duration = secondsToWholeFrames(opts.seconds ?? IMAGE_SECONDS, seq.fps)
  const clip = createClip({
    mediaId: asset.id,
    trackId,
    start,
    duration,
    sourceIn: 0,
    title: kind === 'title' ? (opts.title ?? null) : null,
    color: kind === 'color' ? (opts.color ?? '#000000') : null,
  })
  const add: Command = { type: 'clip.add', sequenceId: seq.id, clips: [clip] }
  return existing
    ? add
    : {
        type: 'batch',
        label: 'Add generator',
        commands: [{ type: 'media.add', assets: [asset] }, add],
      }
}
