import type { MediaAsset, Project, Rational } from './model'
import { framesToSeconds, secondsToWholeFrames } from './time'
import { sequenceDuration } from './timeline'

/**
 * Length of a media item in frames at the given rate, or null when it has no
 * natural length (still images). Sequence items take the nested sequence's length.
 */
export function assetFrames(
  project: Pick<Project, 'sequences'>,
  asset: MediaAsset,
  fps: Rational,
): number | null {
  if (asset.kind === 'sequence') {
    const seq = asset.sequenceId ? project.sequences[asset.sequenceId] : undefined
    if (!seq) return 0
    return Math.max(1, secondsToWholeFrames(framesToSeconds(sequenceDuration(seq), seq.fps), fps))
  }
  if (asset.duration === null) return null
  return Math.max(1, secondsToWholeFrames(asset.duration, fps))
}

/** Seconds of a media item, including sequence items. */
export function assetSeconds(
  project: Pick<Project, 'sequences'>,
  asset: MediaAsset,
): number | null {
  if (asset.kind === 'sequence') {
    const seq = asset.sequenceId ? project.sequences[asset.sequenceId] : undefined
    return seq ? framesToSeconds(sequenceDuration(seq), seq.fps) : 0
  }
  return asset.duration
}
