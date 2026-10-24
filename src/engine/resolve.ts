import { clipGainAt } from './audio'
import type { Clip, MediaAsset, Project, Sequence } from './model'
import { sourceFrameAt, speedAt } from './speed'
import { framesToSeconds, secondsToFrames } from './time'
import { clipAt } from './timeline'

/** One media file to show or play at a moment of the timeline. */
export type Leaf = {
  /** Stable while the same clip keeps playing, so players can reuse an element. */
  key: string
  asset: MediaAsset
  /** Seconds into the media file. */
  time: number
  /** Playback speed; negative plays backwards, 0 holds the frame. */
  rate: number
}

const MAX_DEPTH = 8

/** The picture on top at `frame`, looking through nested sequences and multicam angles. */
export function resolveVideo(
  project: Project,
  seq: Sequence,
  frame: number,
  angle: number | null = null,
  depth = 0,
  prefix = '',
): Leaf | null {
  if (depth > MAX_DEPTH) return null
  const videos = seq.tracks.filter((t) => t.kind === 'video')
  const candidates =
    angle === null
      ? videos.filter((t) => !t.hidden).reverse()
      : videos.filter((_, i) => i === angle)
  for (const track of candidates) {
    const clip = clipAt(seq, track.id, frame)
    if (!clip) continue
    const asset = project.media[clip.mediaId]
    if (!asset) continue
    const offset = frame - clip.start
    const sourceFrame = sourceFrameAt(clip, offset)
    const speed = clip.ramp ? speedAt(clip, offset) : clip.speed
    const rate = clip.reverse ? -speed : speed
    if (asset.kind === 'sequence') {
      const inner = asset.sequenceId ? project.sequences[asset.sequenceId] : undefined
      if (!inner) continue
      const innerFrame = secondsToFrames(framesToSeconds(sourceFrame, seq.fps), inner.fps)
      const leaf = resolveVideo(
        project,
        inner,
        innerFrame,
        clip.angle,
        depth + 1,
        `${prefix}${clip.id}/`,
      )
      if (leaf) return { ...leaf, rate: leaf.rate * rate }
      continue
    }
    if (asset.kind === 'audio') continue
    return { key: `${prefix}${clip.id}`, asset, time: framesToSeconds(sourceFrame, seq.fps), rate }
  }
  return null
}

/** A sound to play, with where it goes in the mix. */
export type AudioLeaf = Leaf & {
  /** The top-level audio track the sound plays on. */
  trackId: string
  /** The clip that plays the file; its pan and effects apply. */
  clip: Clip
  /** Linear gain at this frame: the clip's level and fades, times those of any clips it is nested in. */
  gain: number
}

/** Everything audible at `frame`, honouring mute and solo, through nested sequences. */
export function resolveAudio(
  project: Project,
  seq: Sequence,
  frame: number,
  depth = 0,
  prefix = '',
): AudioLeaf[] {
  if (depth > MAX_DEPTH) return []
  const audio = seq.tracks.filter((t) => t.kind === 'audio')
  const soloed = audio.some((t) => t.solo)
  const leaves: AudioLeaf[] = []
  for (const track of audio) {
    if (soloed ? !track.solo : track.muted) continue
    const clip = clipAt(seq, track.id, frame)
    if (!clip) continue
    const asset = project.media[clip.mediaId]
    if (!asset?.hasAudio) continue
    const offset = frame - clip.start
    const sourceFrame = sourceFrameAt(clip, offset)
    const speed = clip.ramp ? speedAt(clip, offset) : clip.speed
    if (speed === 0) continue
    const rate = clip.reverse ? -speed : speed
    if (asset.kind === 'sequence') {
      const inner = asset.sequenceId ? project.sequences[asset.sequenceId] : undefined
      if (!inner) continue
      const innerFrame = secondsToFrames(framesToSeconds(sourceFrame, seq.fps), inner.fps)
      const outer = clipGainAt(clip, offset)
      for (const leaf of resolveAudio(
        project,
        inner,
        innerFrame,
        depth + 1,
        `${prefix}${clip.id}/`,
      ))
        leaves.push({ ...leaf, rate: leaf.rate * rate, trackId: track.id, gain: leaf.gain * outer })
      continue
    }
    leaves.push({
      key: `${prefix}${clip.id}`,
      asset,
      time: framesToSeconds(sourceFrame, seq.fps),
      rate,
      trackId: track.id,
      clip,
      gain: clipGainAt(clip, offset),
    })
  }
  return leaves
}
