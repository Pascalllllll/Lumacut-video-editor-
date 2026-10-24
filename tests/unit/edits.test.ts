import { describe, expect, it } from 'vitest'
import {
  angleCommand,
  bladeCommand,
  compoundCommand,
  multicamCommand,
  placeCommand,
  sourceEditCommand,
} from '@engine/edits'
import { execute, undo, type HistoryState } from '@engine/history'
import { activeSequence, createProject, type MediaAsset } from '@engine/model'
import { clipsOnTrack, sequenceDuration } from '@engine/timeline'

const video = (id: string, duration = 10): MediaAsset => ({
  id,
  name: `${id}.mp4`,
  path: `/tmp/${id}.mp4`,
  kind: 'video',
  duration,
  width: 1920,
  height: 1080,
  fps: { num: 25, den: 1 },
  vfr: false,
  hasVideo: true,
  hasAudio: true,
  videoCodec: 'h264',
  audioCodec: 'aac',
  sampleRate: 48000,
  channels: 2,
  size: 1,
  importedAt: 'now',
  sequenceId: null,
  color: null,
  alpha: false,
  rating: 0,
  tags: [],
  generator: null,
  marks: { in: null, out: null },
})

function start(...assets: MediaAsset[]) {
  const project = createProject('t')
  let state: HistoryState = { project, past: [], future: [] }
  state = execute(state, { type: 'media.add', assets })
  return state
}
const seq = (s: HistoryState) => activeSequence(s.project)

describe('placing media', () => {
  it('puts picture and sound on linked clips and adopts the format', () => {
    let state = start(video('a'))
    state = execute(state, placeCommand(state.project, seq(state), state.project.media['a']!, 0))
    const clips = Object.values(seq(state).clips)
    expect(clips).toHaveLength(2)
    expect(clips[0]!.linkId).toBeTruthy()
    expect(clips[0]!.linkId).toBe(clips[1]!.linkId)
    expect(seq(state).fps).toEqual({ num: 25, den: 1 })
    expect(sequenceDuration(seq(state))).toBe(250)
  })
})

describe('three- and four-point edits', () => {
  function withClip() {
    let state = start(video('a'), video('b'))
    state = execute(state, placeCommand(state.project, seq(state), state.project.media['a']!, 0))
    state = execute(state, {
      type: 'media.update',
      mediaId: 'b',
      patch: { marks: { in: 2, out: 4 } },
    })
    return state
  }

  it('overwrite at the playhead uses the source marks', () => {
    let state = withClip()
    state = execute(
      state,
      sourceEditCommand(state.project, seq(state), state.project.media['b']!, 'overwrite', 100),
    )
    const v1 = seq(state).tracks[0]!.id
    expect(
      clipsOnTrack(seq(state), v1).map((c) => [c.mediaId, c.start, c.duration, c.sourceIn]),
    ).toEqual([
      ['a', 0, 100, 0],
      ['b', 100, 50, 50],
      ['a', 150, 100, 150],
    ])
    expect(sequenceDuration(seq(state))).toBe(250)
  })

  it('insert pushes the rest of the sequence', () => {
    let state = withClip()
    state = execute(
      state,
      sourceEditCommand(state.project, seq(state), state.project.media['b']!, 'insert', 100),
    )
    expect(sequenceDuration(seq(state))).toBe(300)
    expect(sequenceDuration(seq(undo(state)))).toBe(250)
  })

  it('a timeline out point alone places the clip so it ends there', () => {
    let state = withClip()
    state = execute(state, { type: 'sequence.settings', sequenceId: seq(state).id, outPoint: 200 })
    state = execute(
      state,
      sourceEditCommand(state.project, seq(state), state.project.media['b']!, 'overwrite', 0),
    )
    const b = Object.values(seq(state).clips).find((c) => c.mediaId === 'b')!
    expect([b.start, b.duration]).toEqual([150, 50])
  })

  it('fit to fill changes speed to fill the timeline range', () => {
    let state = withClip()
    state = execute(state, {
      type: 'sequence.settings',
      sequenceId: seq(state).id,
      inPoint: 0,
      outPoint: 100,
    })
    state = execute(
      state,
      sourceEditCommand(state.project, seq(state), state.project.media['b']!, 'fit', 0),
    )
    const b = Object.values(seq(state).clips).find((c) => c.mediaId === 'b')!
    expect(b.duration).toBe(100)
    expect(b.speed).toBeCloseTo(0.5)
  })

  it('replace swaps the clip under the playhead and keeps its length', () => {
    let state = withClip()
    state = execute(
      state,
      sourceEditCommand(state.project, seq(state), state.project.media['b']!, 'replace', 10),
    )
    const clips = Object.values(seq(state).clips)
    expect(clips.every((c) => c.mediaId === 'b')).toBe(true)
    expect(clips[0]!.duration).toBe(50)
  })
})

describe('blade keeps links paired', () => {
  it('right halves of linked clips share a new link', () => {
    let state = start(video('a'))
    state = execute(state, placeCommand(state.project, seq(state), state.project.media['a']!, 0))
    const cmd = bladeCommand(seq(state), Object.keys(seq(state).clips), 100)!
    state = execute(state, cmd)
    const right = Object.values(seq(state).clips).filter((c) => c.start === 100)
    expect(right).toHaveLength(2)
    expect(right[0]!.linkId).toBe(right[1]!.linkId)
    const left = Object.values(seq(state).clips).filter((c) => c.start === 0)
    expect(left[0]!.linkId).not.toBe(right[0]!.linkId)
  })
})

describe('compound clips', () => {
  it('moves clips into a new sequence and leaves one clip in their place', () => {
    let state = start(video('a'))
    state = execute(state, placeCommand(state.project, seq(state), state.project.media['a']!, 0))
    const ids = Object.keys(seq(state).clips)
    state = execute(state, compoundCommand(state.project, seq(state), ids, 'Compound 1'))
    const outer = Object.values(seq(state).clips)
    expect(outer).toHaveLength(2)
    const item = state.project.media[outer[0]!.mediaId]!
    expect(item.kind).toBe('sequence')
    const inner = state.project.sequences[item.sequenceId!]!
    expect(Object.keys(inner.clips)).toHaveLength(2)
    expect(sequenceDuration(seq(state))).toBe(250)
  })
})

describe('multicam', () => {
  it('lines up angles by offset and switches angles with a cut', () => {
    let state = start(video('a'), video('b'))
    const { command, asset } = multicamCommand(
      state.project,
      [state.project.media['a']!, state.project.media['b']!],
      [0, 1.2],
      'Multicam',
    )
    state = execute(state, command)
    const mc = state.project.sequences[asset.sequenceId!]!
    expect(mc.multicam).toBe(true)
    const starts = Object.values(mc.clips)
      .filter((c) => c.trackId === mc.tracks[1]!.id)
      .map((c) => c.start)
    expect(starts).toEqual([30])
    state = execute(state, placeCommand(state.project, seq(state), asset, 0))
    const clip = Object.values(seq(state).clips).find((c) => c.angle !== null)!
    expect(clip.angle).toBe(0)
    state = execute(state, angleCommand(seq(state), clip.id, 1, 100)!)
    const angles = Object.values(seq(state).clips)
      .filter((c) => c.angle !== null)
      .sort((x, y) => x.start - y.start)
      .map((c) => c.angle)
    expect(angles).toEqual([0, 1])
  })
})

describe('dropping on a track', () => {
  it('sends the sound to the matching audio track and creates it if needed', async () => {
    const { dropCommand } = await import('@engine/edits')
    const { createTrack } = await import('@engine/model')
    let state = start(video('a'), video('b'))
    state = execute(state, placeCommand(state.project, seq(state), state.project.media['a']!, 0))
    const v2 = createTrack('video', 'V2')
    state = execute(state, { type: 'track.add', sequenceId: seq(state).id, track: v2 })
    state = execute(
      state,
      dropCommand(state.project, seq(state), state.project.media['b']!, 50, v2.id),
    )
    const s = seq(state)
    const a2 = s.tracks.find((t) => t.name === 'A2')!
    expect(a2).toBeDefined()
    // A1 still holds all of clip a's sound.
    expect(
      clipsOnTrack(s, s.tracks.find((t) => t.name === 'A1')!.id).map((c) => [
        c.mediaId,
        c.duration,
      ]),
    ).toEqual([['a', 250]])
    expect(clipsOnTrack(s, a2.id).map((c) => c.mediaId)).toEqual(['b'])
  })
})
