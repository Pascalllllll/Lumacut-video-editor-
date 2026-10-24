import {
  cuesFromWords,
  fillerRanges,
  removeRangesCommand,
  wordsForSequence,
  type SourceWord,
} from '@engine/captions'
import type { Command } from '@engine/commands'
import { cutAtFrames } from '@engine/edits'
import type { Clip, MediaAsset } from '@engine/model'
import { sourceFrameAt } from '@engine/speed'
import { fpsValue, framesToSeconds } from '@engine/time'
import { clipEnd, companions, sequenceDuration } from '@engine/timeline'
import { t, td } from '../i18n'
import { isModelReady, useModels, watchModels } from '../state/models'
import { notify } from '../state/notices'
import { selectProject, selectSequence, useProject } from '../state/project'

const state = () => useProject.getState()
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** True when the model is on disk; otherwise says where to get it. */
export async function needModel(id: string): Promise<boolean> {
  watchModels()
  await useModels.getState().refresh()
  if (isModelReady(id)) return true
  notify('info', t('models.missing', { name: td(`models.name.${id}`) }))
  return false
}

/**
 * Transcribes every file that sounds on the sequence's dialogue tracks (or all
 * audio tracks when none are marked) and replaces the captions with the result,
 * keeping their style.
 */
export async function transcribeSequence(model: string, language: string | null) {
  if (!(await needModel(model))) return 0
  const project = selectProject(state())
  const seq = selectSequence(state())
  const audioTracks = new Set(seq.tracks.filter((tr) => tr.kind === 'audio').map((tr) => tr.id))
  const assets = new Map<string, MediaAsset>()
  for (const c of Object.values(seq.clips)) {
    const a = project.media[c.mediaId]
    if (audioTracks.has(c.trackId) && a?.hasAudio && a.kind !== 'sequence') assets.set(a.id, a)
  }
  const transcripts = new Map<string, SourceWord[]>()
  for (const a of assets.values())
    transcripts.set(
      a.id,
      await window.lumacut.invoke('ai:transcribe', { path: a.path, model, language }),
    )
  const words = wordsForSequence(project, seq, transcripts)
  const cues = cuesFromWords(words, fpsValue(seq.fps))
  state().dispatch({
    type: 'captions.set',
    sequenceId: seq.id,
    captions: { ...seq.captions, cues, language },
  })
  return cues.length
}

/** Quiet stretches of the mix, in frames, with a little air left either side. */
export async function silenceRanges(threshold: number, minSeconds: number) {
  const project = selectProject(state())
  const seq = selectSequence(state())
  const fps = fpsValue(seq.fps)
  const found = await window.lumacut.invoke('ai:silences', {
    project,
    sequenceId: seq.id,
    threshold,
    minSeconds,
  })
  // Air either side of a cut, but none at the very start or end of the sequence.
  const pad = 0.12
  const total = sequenceDuration(seq) / fps
  return found
    .map(([a, b]): [number, number] => [
      Math.round((a <= 0.01 ? 0 : a + pad) * fps),
      Math.round((b >= total - 0.01 ? total : b - pad) * fps),
    ])
    .filter(([a, b]) => b > a)
}

export function fillerWordRanges() {
  return fillerRanges(selectSequence(state()).captions)
}

/** Takes the chosen ranges out of every track in one undoable step. */
export function removeRanges(ranges: [number, number][], label: string) {
  const seq = selectSequence(state())
  const cmd = removeRangesCommand(seq, ranges, label)
  if (cmd) state().dispatch(cmd)
}

/** Splits a clip (and its linked clips) wherever the picture cuts to a new shot. */
export async function detectScenes(clip: Clip) {
  const project = selectProject(state())
  const seq = selectSequence(state())
  const asset = project.media[clip.mediaId]
  if (!asset?.hasVideo || asset.kind !== 'video') return
  const start = framesToSeconds(sourceFrameAt(clip, 0), seq.fps)
  const times = await window.lumacut.invoke('ai:scenes', {
    path: asset.path,
    start,
    duration: framesToSeconds(clip.duration, seq.fps),
    threshold: 10,
  })
  const frames = times
    .map((s) => clip.start + Math.round(s * fpsValue(seq.fps)))
    .filter((f) => f > clip.start && f < clipEnd(clip))
  if (frames.length === 0) {
    notify('info', t('ai.noScenes'))
    return
  }
  const cmd = cutAtFrames(seq, [...companions(seq, [clip.id])], frames)
  if (cmd?.type === 'batch') state().dispatch({ ...cmd, label: t('history.scenes') })
  notify('info', t('ai.scenesFound', { count: frames.length + 1 }))
}

/** Imports a processed copy and points the clip at it, as one undoable step. */
async function swapMedia(clip: Clip, path: string, label: string) {
  const result = await window.lumacut.invoke('media:import', { paths: [path] })
  const asset = result.assets[0]
  if (!asset) throw new Error(result.errors[0] ?? t('ai.importFailed'))
  const seq = selectSequence(state())
  const commands: Command[] = [
    { type: 'media.add', assets: [asset] },
    { type: 'clip.update', sequenceId: seq.id, clipIds: [clip.id], patch: { mediaId: asset.id } },
  ]
  state().dispatch({ type: 'batch', label, commands })
  return asset
}

export async function cleanVoice(clip: Clip) {
  if (!(await needModel('rnnoise-speech'))) return
  const asset = selectProject(state()).media[clip.mediaId]
  if (!asset) return
  try {
    const { path } = await window.lumacut.invoke('ai:clean-voice', {
      asset,
      projectPath: state().path,
    })
    await swapMedia(clip, path, t('history.cleanVoice'))
    notify('info', t('ai.voiceCleaned'))
  } catch (error) {
    notify('error', message(error))
  }
}

export async function removeBackground(clip: Clip, onProgress: (fraction: number) => void) {
  if (!(await needModel('modnet'))) return
  const asset = selectProject(state()).media[clip.mediaId]
  if (!asset) return
  const jobId = crypto.randomUUID()
  const off = window.lumacut.on('ai:progress', (p) => {
    if (p.jobId === jobId) onProgress(p.fraction)
  })
  try {
    const { path } = await window.lumacut.invoke('ai:remove-background', {
      asset,
      projectPath: state().path,
      jobId,
    })
    await swapMedia(clip, path, t('history.removeBackground'))
    notify('info', t('ai.backgroundRemoved'))
  } catch (error) {
    notify('error', message(error))
  } finally {
    off()
  }
}
