import { create } from 'zustand'
import { assetFrames } from '@engine/media'
import { createClip, type Track } from '@engine/model'
import { t } from '../i18n'
import { notify } from '../state/notices'
import { usePlayhead } from '../state/playhead'
import { selectProject, selectSequence, useProject } from '../state/project'

type RecorderState = {
  /** The track being recorded onto, or null when idle. */
  trackId: string | null
  busy: boolean
}

export const useRecorder = create<RecorderState>(() => ({ trackId: null, busy: false }))

let recorder: MediaRecorder | null = null
let stream: MediaStream | null = null
let chunks: Blob[] = []
let startFrame = 0

/** The audio track a take lands on: the targeted one, or the first unlocked audio track. */
export function recordTrack(): Track | null {
  const seq = selectSequence(useProject.getState())
  const audio = seq.tracks.filter((tr) => tr.kind === 'audio' && !tr.locked)
  return audio.find((tr) => tr.id === seq.targets.audio) ?? audio[0] ?? null
}

/**
 * Records from the microphone while the timeline plays from the playhead; on
 * stop the take is saved next to the project and placed where recording began.
 */
export async function startRecording() {
  const track = recordTrack()
  if (!track) {
    notify('info', t('mixer.noAudioTrack'))
    return
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
  } catch (error) {
    stopStream()
    notify('error', t('mixer.recordFailed', { reason: reason(error) }))
    return
  }
  chunks = []
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  recorder.onstop = () => void finish(track.id)
  startFrame = usePlayhead.getState().frame
  recorder.start(250)
  useRecorder.setState({ trackId: track.id })
  usePlayhead.getState().setPlaying(true)
}

export function stopRecording() {
  usePlayhead.getState().setPlaying(false)
  if (recorder && recorder.state !== 'inactive') recorder.stop()
}

function stopStream() {
  stream?.getTracks().forEach((tr) => tr.stop())
  stream = null
}

function reason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.endsWith('.') ? text : `${text}.`
}

async function finish(trackId: string) {
  stopStream()
  recorder = null
  useRecorder.setState({ trackId: null, busy: true })
  try {
    const bytes = new Uint8Array(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer())
    chunks = []
    if (bytes.byteLength === 0) return
    const { path } = await window.lumacut.invoke('voiceover:save', {
      data: bytes,
      projectPath: useProject.getState().path,
    })
    const result = await window.lumacut.invoke('media:import', { paths: [path] })
    const asset = result.assets[0]
    if (!asset) throw new Error(result.errors[0] ?? "The recording couldn't be read.")
    const state = useProject.getState()
    const seq = selectSequence(state)
    const track = seq.tracks.find((tr) => tr.id === trackId)
    const duration = assetFrames(selectProject(state), asset, seq.fps) ?? 1
    state.dispatch({
      type: 'batch',
      label: t('history.voiceover'),
      commands: [
        { type: 'media.add', assets: [asset] },
        {
          type: 'clip.add',
          sequenceId: seq.id,
          clips: [
            createClip({ mediaId: asset.id, trackId, start: startFrame, duration, sourceIn: 0 }),
          ],
        },
      ],
    })
    notify('info', t('mixer.recordAdded', { track: track?.name ?? '' }))
  } catch (error) {
    notify('error', t('mixer.recordFailed', { reason: reason(error) }))
  } finally {
    useRecorder.setState({ busy: false })
  }
}
