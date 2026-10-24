import type { Command } from '@engine/commands'
import { execute } from '@engine/history'
import type { Clip, Project, Sequence } from '@engine/model'
import { sequenceDuration } from '@engine/timeline'

export type ClipChange = {
  clip: Clip
  status: 'added' | 'removed' | 'changed'
  /** What changed, for a changed clip. */
  what: ('timing' | 'track' | 'look' | 'sound' | 'speed')[]
}

export type SequenceDiff = {
  before: Sequence
  after: Sequence
  clips: ClipChange[]
  captions: { before: number; after: number; changed: boolean }
  markers: number
  settings: string[]
  durationBefore: number
  durationAfter: number
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** What a set of commands would change in the open sequence, without touching the project. */
export function previewCommands(project: Project, sequenceId: string, commands: Command[]) {
  const next = execute(
    { project, past: [], future: [] },
    { type: 'batch', label: 'Preview', commands },
  )
  return diffSequence(project.sequences[sequenceId]!, next.project.sequences[sequenceId]!)
}

export function diffSequence(before: Sequence, after: Sequence): SequenceDiff {
  const clips: ClipChange[] = []
  for (const c of Object.values(after.clips)) {
    const old = before.clips[c.id]
    if (!old) {
      clips.push({ clip: c, status: 'added', what: [] })
      continue
    }
    const what: ClipChange['what'] = []
    if (old.start !== c.start || old.duration !== c.duration || old.sourceIn !== c.sourceIn)
      what.push('timing')
    if (old.trackId !== c.trackId) what.push('track')
    if (
      !same(
        [old.transform, old.effects, old.masks, old.grade, old.blend, old.title],
        [c.transform, c.effects, c.masks, c.grade, c.blend, c.title],
      )
    )
      what.push('look')
    if (!same(old.sound, c.sound)) what.push('sound')
    if (old.speed !== c.speed || old.reverse !== c.reverse || !same(old.ramp, c.ramp))
      what.push('speed')
    if (what.length) clips.push({ clip: c, status: 'changed', what })
  }
  for (const c of Object.values(before.clips))
    if (!after.clips[c.id]) clips.push({ clip: c, status: 'removed', what: [] })
  const settings: string[] = []
  if (before.width !== after.width || before.height !== after.height)
    settings.push(`${after.width}x${after.height}`)
  if (before.loudnessTarget !== after.loudnessTarget) settings.push('loudness')
  if (before.tracks.length !== after.tracks.length || !same(before.tracks, after.tracks))
    settings.push('tracks')
  return {
    before,
    after,
    clips: clips.sort((a, b) => a.clip.start - b.clip.start),
    captions: {
      before: before.captions.cues.length,
      after: after.captions.cues.length,
      changed: !same(before.captions, after.captions),
    },
    markers: Object.keys(after.markers).length - Object.keys(before.markers).length,
    settings,
    durationBefore: sequenceDuration(before),
    durationAfter: sequenceDuration(after),
  }
}

export const isEmptyDiff = (d: SequenceDiff) =>
  d.clips.length === 0 && !d.captions.changed && d.markers === 0 && d.settings.length === 0
