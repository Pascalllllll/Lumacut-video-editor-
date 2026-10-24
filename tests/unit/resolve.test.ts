import { describe, expect, it } from 'vitest'
import { multicamCommand, placeCommand } from '@engine/edits'
import { execute, type HistoryState } from '@engine/history'
import {
  activeSequence,
  createClip,
  createProject,
  createTrack,
  type MediaAsset,
} from '@engine/model'
import { resolveAudio, resolveVideo } from '@engine/resolve'

const video = (id: string): MediaAsset => ({
  id,
  name: id,
  path: `/m/${id}`,
  kind: 'video',
  duration: 10,
  width: 1920,
  height: 1080,
  fps: { num: 30, den: 1 },
  vfr: false,
  hasVideo: true,
  hasAudio: true,
  videoCodec: 'h264',
  audioCodec: 'aac',
  sampleRate: 48000,
  channels: 2,
  size: 1,
  importedAt: 'x',
  sequenceId: null,
  color: null,
  alpha: false,
  rating: 0,
  tags: [],
  generator: null,
  marks: { in: null, out: null },
})

function base() {
  let state: HistoryState = { project: createProject('t'), past: [], future: [] }
  state = execute(state, { type: 'media.add', assets: [video('a'), video('b')] })
  return state
}

describe('resolve', () => {
  it('shows the top visible track and skips hidden ones', () => {
    let state = base()
    const seq = activeSequence(state.project)
    const v2 = createTrack('video', 'V2')
    state = execute(state, { type: 'track.add', sequenceId: seq.id, track: v2 })
    state = execute(state, {
      type: 'clip.add',
      sequenceId: seq.id,
      clips: [
        createClip({
          mediaId: 'a',
          trackId: seq.tracks[0]!.id,
          start: 0,
          duration: 100,
          sourceIn: 0,
        }),
        createClip({
          mediaId: 'b',
          trackId: v2.id,
          start: 10,
          duration: 20,
          sourceIn: 30,
          speed: 2,
        }),
      ],
    })
    const s = activeSequence(state.project)
    expect(resolveVideo(state.project, s, 5)?.asset.id).toBe('a')
    const top = resolveVideo(state.project, s, 15)!
    expect(top.asset.id).toBe('b')
    expect(top.time).toBeCloseTo((30 + 5 * 2) / 30)
    expect(top.rate).toBe(2)
    state = execute(state, {
      type: 'track.update',
      sequenceId: s.id,
      trackId: v2.id,
      patch: { hidden: true },
    })
    expect(resolveVideo(state.project, activeSequence(state.project), 15)?.asset.id).toBe('a')
  })

  it('looks through a multicam clip to the chosen angle and mutes other angles', () => {
    let state = base()
    const { command, asset } = multicamCommand(
      state.project,
      [state.project.media['a']!, state.project.media['b']!],
      [0, 0],
      'MC',
    )
    state = execute(state, command)
    state = execute(state, placeCommand(state.project, activeSequence(state.project), asset, 0))
    const seq = activeSequence(state.project)
    expect(resolveVideo(state.project, seq, 10)?.asset.id).toBe('a')
    const clip = Object.values(seq.clips).find((c) => c.angle !== null)!
    state = execute(state, {
      type: 'clip.update',
      sequenceId: seq.id,
      clipIds: [clip.id],
      patch: { angle: 1 },
    })
    expect(resolveVideo(state.project, activeSequence(state.project), 10)?.asset.id).toBe('b')
    expect(
      resolveAudio(state.project, activeSequence(state.project), 10).map((l) => l.asset.id),
    ).toEqual(['a'])
  })
})
