import { describe, expect, it } from 'vitest'
import { commandSchema, type Command } from '@engine/commands'
import { execute, redo, undo, type HistoryState } from '@engine/history'
import { migrateProject } from '@engine/migrations'
import {
  activeSequence,
  createClip,
  createProject,
  createTrack,
  type Clip,
  type MediaAsset,
  type Project,
} from '@engine/model'
import { sourceFrameAt, sourceOffsetAt, sourceSpan } from '@engine/speed'
import { clipsOnTrack, sequenceDuration } from '@engine/timeline'
import { formatTimecode, normalizeFps, secondsToWholeFrames } from '@engine/time'

const asset: MediaAsset = {
  id: 'm1',
  name: 'clip.mp4',
  path: '/tmp/clip.mp4',
  kind: 'video',
  duration: 10,
  width: 3840,
  height: 2160,
  fps: { num: 30, den: 1 },
  vfr: false,
  hasVideo: true,
  hasAudio: true,
  videoCodec: 'h264',
  audioCodec: 'aac',
  sampleRate: 48000,
  channels: 2,
  size: 1000,
  importedAt: '2026-10-24T00:00:00.000Z',
  sequenceId: null,
  color: null,
  alpha: false,
  rating: 0,
  tags: [],
  generator: null,
  marks: { in: null, out: null },
}

function setup(duration = 300) {
  const project = createProject('Test')
  const seq = activeSequence(project)
  const v1 = seq.tracks[0]!.id
  const a1 = seq.tracks[1]!.id
  let state: HistoryState = { project, past: [], future: [] }
  state = execute(state, { type: 'media.add', assets: [asset] })
  const clip = createClip({ id: 'c1', mediaId: 'm1', trackId: v1, start: 0, duration, sourceIn: 0 })
  state = execute(state, { type: 'clip.add', sequenceId: seq.id, clips: [clip] })
  return { state, seqId: seq.id, v1, a1 }
}

const seqOf = (s: HistoryState) => activeSequence(s.project)
const clipsOf = (s: HistoryState, track: string) => clipsOnTrack(seqOf(s), track)
const layout = (s: HistoryState, track: string) =>
  clipsOf(s, track).map((c) => [c.id, c.start, c.duration, c.sourceIn])

describe('time', () => {
  it('formats timecode', () => {
    expect(formatTimecode(0, { num: 30, den: 1 })).toBe('00:00:00:00')
    expect(formatTimecode(30 * 3661 + 7, { num: 30, den: 1 })).toBe('01:01:01:07')
  })
  it('recognises common NTSC rates', () => {
    expect(normalizeFps(29.97003)).toEqual({ num: 30000, den: 1001 })
    expect(normalizeFps(25)).toEqual({ num: 25, den: 1 })
  })
  it('counts whole frames', () => {
    expect(secondsToWholeFrames(10, { num: 30, den: 1 })).toBe(300)
    expect(secondsToWholeFrames(10.01, { num: 30, den: 1 })).toBe(300)
  })
})

describe('basic edits and history', () => {
  it('cuts a clip in three, reorders, and undoes back to one clip', () => {
    const { state: s0, seqId, v1 } = setup()
    let state = execute(s0, {
      type: 'clip.split',
      sequenceId: seqId,
      clipId: 'c1',
      frame: 100,
      newClipId: 'c2',
    })
    state = execute(state, {
      type: 'clip.split',
      sequenceId: seqId,
      clipId: 'c2',
      frame: 200,
      newClipId: 'c3',
    })
    expect(layout(state, v1)).toEqual([
      ['c1', 0, 100, 0],
      ['c2', 100, 100, 100],
      ['c3', 200, 100, 200],
    ])
    const swap: Command = {
      type: 'batch',
      label: 'Swap clips',
      commands: [
        { type: 'clip.move', sequenceId: seqId, moves: [{ clipId: 'c1', start: 300 }] },
        { type: 'clip.move', sequenceId: seqId, moves: [{ clipId: 'c3', start: 0 }] },
        { type: 'clip.move', sequenceId: seqId, moves: [{ clipId: 'c1', start: 200 }] },
      ],
    }
    state = execute(state, swap)
    expect(layout(state, v1).map((r) => r[0])).toEqual(['c3', 'c2', 'c1'])
    expect(sequenceDuration(seqOf(state))).toBe(300)
    state = undo(state)
    expect(layout(state, v1).map((r) => r[0])).toEqual(['c1', 'c2', 'c3'])
    state = undo(undo(state))
    expect(layout(state, v1)).toEqual([['c1', 0, 300, 0]])
    state = redo(redo(redo(state)))
    expect(layout(state, v1).map((r) => r[0])).toEqual(['c3', 'c2', 'c1'])
  })

  it('overwrites: a dropped clip splits the clip underneath with derived ids', () => {
    const { state: s0, seqId, v1 } = setup()
    const drop = createClip({
      id: 'c9',
      mediaId: 'm1',
      trackId: v1,
      start: 100,
      duration: 50,
      sourceIn: 0,
    })
    const state = execute(s0, { type: 'clip.add', sequenceId: seqId, clips: [drop] })
    expect(layout(state, v1)).toEqual([
      ['c1', 0, 100, 0],
      ['c9', 100, 50, 0],
      ['c1~1', 150, 150, 150],
    ])
    expect(layout(undo(state), v1)).toEqual([['c1', 0, 300, 0]])
    // Redo produces the same ids.
    expect(layout(redo(undo(state)), v1)).toEqual(layout(state, v1))
  })

  it('trims within the media and never past its ends', () => {
    const { state: s0, seqId, v1 } = setup()
    let state = execute(s0, {
      type: 'clip.trim',
      sequenceId: seqId,
      clipId: 'c1',
      edge: 'end',
      frame: 900,
    })
    expect(clipsOf(state, v1)[0]!.duration).toBe(300)
    state = execute(state, {
      type: 'clip.trim',
      sequenceId: seqId,
      clipId: 'c1',
      edge: 'start',
      frame: 60,
    })
    expect(clipsOf(state, v1)[0]).toMatchObject({ start: 60, sourceIn: 60, duration: 240 })
    state = execute(state, {
      type: 'clip.trim',
      sequenceId: seqId,
      clipId: 'c1',
      edge: 'start',
      frame: 0,
    })
    expect(clipsOf(state, v1)[0]).toMatchObject({ start: 0, sourceIn: 0, duration: 300 })
  })

  it('removing media removes its clips, and undo brings both back', () => {
    const { state: s0, v1 } = setup()
    let state = execute(s0, { type: 'media.remove', mediaIds: ['m1'] })
    expect(state.project.media['m1']).toBeUndefined()
    expect(clipsOf(state, v1)).toHaveLength(0)
    state = undo(state)
    expect(state.project.media['m1']).toBeDefined()
    expect(clipsOf(state, v1)).toHaveLength(1)
  })

  it('rejects invalid commands without changing state', () => {
    const { state, seqId } = setup()
    expect(() =>
      execute(state, { type: 'clip.split', sequenceId: seqId, clipId: 'c1', frame: 0 }),
    ).toThrow()
    expect(() =>
      execute(state, {
        type: 'clip.move',
        sequenceId: seqId,
        moves: [{ clipId: 'nope', start: 0 }],
      }),
    ).toThrow()
  })

  it('commands round-trip through the schema', () => {
    const cmd: Command = {
      type: 'batch',
      label: 'x',
      commands: [{ type: 'clip.remove', sequenceId: 's', clipIds: ['a'] }],
    }
    expect(commandSchema.parse(JSON.parse(JSON.stringify(cmd)))).toEqual(cmd)
  })
})

describe('sequence settings', () => {
  it('changes size any time and undoes', () => {
    const { state: s0, seqId } = setup()
    const state = execute(s0, {
      type: 'sequence.settings',
      sequenceId: seqId,
      width: 1080,
      height: 1920,
    })
    expect(seqOf(state)).toMatchObject({ width: 1080, height: 1920 })
    expect(seqOf(undo(state))).toMatchObject({ width: 1920, height: 1080 })
  })
  it('only changes frame rate while empty', () => {
    const { state, seqId } = setup()
    expect(() =>
      execute(state, { type: 'sequence.settings', sequenceId: seqId, fps: { num: 25, den: 1 } }),
    ).toThrow(/empty/)
  })
})

describe('tracks', () => {
  it('adds, locks and removes tracks', () => {
    const { state: s0, seqId, v1 } = setup()
    const v2 = createTrack('video', 'V2')
    let state = execute(s0, { type: 'track.add', sequenceId: seqId, track: v2 })
    expect(seqOf(state).tracks.map((t) => t.name)).toEqual(['V1', 'V2', 'A1'])
    state = execute(state, {
      type: 'track.update',
      sequenceId: seqId,
      trackId: v1,
      patch: { locked: true },
    })
    expect(() =>
      execute(state, { type: 'clip.split', sequenceId: seqId, clipId: 'c1', frame: 10 }),
    ).toThrow(/locked/)
    state = execute(state, { type: 'track.remove', sequenceId: seqId, trackId: v2.id })
    expect(seqOf(state).tracks).toHaveLength(2)
    expect(() => execute(state, { type: 'track.remove', sequenceId: seqId, trackId: v1 })).toThrow(
      /at least one/,
    )
  })
})

describe('trim tools', () => {
  function threeClips() {
    const { state: s0, seqId, v1 } = setup()
    let state = execute(s0, {
      type: 'clip.split',
      sequenceId: seqId,
      clipId: 'c1',
      frame: 100,
      newClipId: 'c2',
    })
    state = execute(state, {
      type: 'clip.split',
      sequenceId: seqId,
      clipId: 'c2',
      frame: 200,
      newClipId: 'c3',
    })
    // Leave source room on both sides of the middle clip.
    state = execute(state, { type: 'clip.slip', sequenceId: seqId, clipId: 'c3', delta: 0 })
    return { state, seqId, v1 }
  }

  it('ripple delete closes the gap', () => {
    const { state: s0, seqId, v1 } = threeClips()
    const state = execute(s0, {
      type: 'clip.remove',
      sequenceId: seqId,
      clipIds: ['c2'],
      ripple: true,
    })
    expect(layout(state, v1)).toEqual([
      ['c1', 0, 100, 0],
      ['c3', 100, 100, 200],
    ])
  })

  it('ripple trim moves the clips after it', () => {
    const { state: s0, seqId, v1 } = threeClips()
    let state = execute(s0, {
      type: 'clip.trim',
      sequenceId: seqId,
      clipId: 'c1',
      edge: 'end',
      frame: 70,
      ripple: true,
    })
    expect(layout(state, v1)).toEqual([
      ['c1', 0, 70, 0],
      ['c2', 70, 100, 100],
      ['c3', 170, 100, 200],
    ])
    state = execute(state, {
      type: 'clip.trim',
      sequenceId: seqId,
      clipId: 'c2',
      edge: 'start',
      frame: 90,
      ripple: true,
    })
    expect(layout(state, v1)).toEqual([
      ['c1', 0, 70, 0],
      ['c2', 70, 80, 120],
      ['c3', 150, 100, 200],
    ])
  })

  it('roll moves the edit point between two clips', () => {
    const { state: s0, seqId, v1 } = threeClips()
    let state = execute(s0, {
      type: 'clip.roll',
      sequenceId: seqId,
      leftId: 'c1',
      rightId: 'c2',
      frame: 130,
    })
    expect(layout(state, v1).slice(0, 2)).toEqual([
      ['c1', 0, 130, 0],
      ['c2', 130, 70, 130],
    ])
    state = execute(state, {
      type: 'clip.roll',
      sequenceId: seqId,
      leftId: 'c1',
      rightId: 'c2',
      frame: 50,
    })
    expect(layout(state, v1).slice(0, 2)).toEqual([
      ['c1', 0, 50, 0],
      ['c2', 50, 150, 50],
    ])
    expect(sequenceDuration(seqOf(state))).toBe(300)
  })

  it('slip changes the source range without moving the clip', () => {
    const { state: s0, seqId, v1 } = threeClips()
    let state = execute(s0, { type: 'clip.slip', sequenceId: seqId, clipId: 'c2', delta: 40 })
    expect(layout(state, v1)[1]).toEqual(['c2', 100, 100, 140])
    state = execute(state, { type: 'clip.slip', sequenceId: seqId, clipId: 'c2', delta: 1000 })
    expect(layout(state, v1)[1]).toEqual(['c2', 100, 100, 200])
    state = execute(state, { type: 'clip.slip', sequenceId: seqId, clipId: 'c2', delta: -1000 })
    expect(layout(state, v1)[1]).toEqual(['c2', 100, 100, 0])
  })

  it('slide moves a clip between its neighbours, which give and take frames', () => {
    const { state: s0, seqId, v1 } = threeClips()
    const state = execute(s0, { type: 'clip.slide', sequenceId: seqId, clipId: 'c2', delta: 30 })
    expect(layout(state, v1)).toEqual([
      ['c1', 0, 130, 0],
      ['c2', 130, 100, 100],
      ['c3', 230, 70, 230],
    ])
  })

  it('rate stretch keeps the source frames and changes the speed', () => {
    const { state: s0, seqId, v1 } = setup(100)
    const state = execute(s0, {
      type: 'clip.rateStretch',
      sequenceId: seqId,
      clipId: 'c1',
      edge: 'end',
      frame: 200,
    })
    const clip = clipsOf(state, v1)[0]!
    expect(clip.duration).toBe(200)
    expect(clip.speed).toBeCloseTo(0.5)
    expect(sourceSpan(clip)).toBe(100)
  })

  it('blade all splits every track at one frame', () => {
    const { state: s0, seqId, v1, a1 } = setup(100)
    const audio = createClip({
      id: 'a',
      mediaId: 'm1',
      trackId: a1,
      start: 0,
      duration: 100,
      sourceIn: 0,
    })
    let state = execute(s0, { type: 'clip.add', sequenceId: seqId, clips: [audio] })
    state = execute(state, {
      type: 'batch',
      label: 'Blade all',
      commands: [
        { type: 'clip.split', sequenceId: seqId, clipId: 'c1', frame: 40 },
        { type: 'clip.split', sequenceId: seqId, clipId: 'a', frame: 40 },
      ],
    })
    expect(clipsOf(state, v1)).toHaveLength(2)
    expect(clipsOf(state, a1)).toHaveLength(2)
  })
})

describe('speed', () => {
  it('constant speed changes length and keeps the source range', () => {
    const { state: s0, seqId, v1 } = setup(100)
    const state = execute(s0, {
      type: 'clip.speed',
      sequenceId: seqId,
      clipId: 'c1',
      speed: 2,
      reverse: false,
      ramp: null,
      interpolation: 'none',
      ripple: false,
    })
    expect(clipsOf(state, v1)[0]).toMatchObject({ duration: 50, speed: 2, sourceIn: 0 })
  })

  it('freeze frame holds one source frame', () => {
    const clip = createClip({
      mediaId: 'm',
      trackId: 't',
      start: 0,
      duration: 90,
      sourceIn: 42,
      speed: 0,
    })
    expect(sourceSpan(clip)).toBe(1)
    expect(sourceFrameAt(clip, 0)).toBe(42)
    expect(sourceFrameAt(clip, 80)).toBe(42)
  })

  it('reverse plays the source backwards', () => {
    const clip = createClip({
      mediaId: 'm',
      trackId: 't',
      start: 0,
      duration: 100,
      sourceIn: 10,
      reverse: true,
    })
    expect(sourceFrameAt(clip, 0)).toBe(109)
    expect(sourceFrameAt(clip, 99)).toBe(10)
  })

  it('a ramp from 1x to 3x covers twice its length in source frames', () => {
    const clip = createClip({
      mediaId: 'm',
      trackId: 't',
      start: 0,
      duration: 100,
      sourceIn: 0,
      ramp: [
        { at: 0, speed: 1 },
        { at: 100, speed: 3 },
      ],
    })
    expect(sourceOffsetAt(clip, 100)).toBeCloseTo(200)
    expect(sourceOffsetAt(clip, 50)).toBeCloseTo(75)
  })

  it('splitting a sped-up clip keeps the source frames continuous', () => {
    const { state: s0, seqId, v1 } = setup(200)
    let state = execute(s0, {
      type: 'clip.speed',
      sequenceId: seqId,
      clipId: 'c1',
      speed: 2,
      reverse: false,
      ramp: null,
      interpolation: 'none',
      ripple: false,
    })
    state = execute(state, { type: 'clip.split', sequenceId: seqId, clipId: 'c1', frame: 30 })
    expect(layout(state, v1)).toEqual([
      ['c1', 0, 30, 0],
      ['c1~1', 30, 70, 60],
    ])
  })
})

describe('insert, lift and extract', () => {
  it('insert pushes later clips on shifted tracks', () => {
    const { state: s0, seqId, v1, a1 } = setup(100)
    const clip = createClip({
      id: 'n',
      mediaId: 'm1',
      trackId: v1,
      start: 0,
      duration: 30,
      sourceIn: 0,
    })
    const state = execute(s0, {
      type: 'clip.insert',
      sequenceId: seqId,
      clips: [clip],
      at: 40,
      shiftTrackIds: [v1, a1],
    })
    expect(layout(state, v1)).toEqual([
      ['c1', 0, 40, 0],
      ['n', 40, 30, 0],
      ['c1~1', 70, 60, 40],
    ])
  })

  it('extract removes a range and closes it; lift leaves a gap', () => {
    const { state: s0, seqId, v1 } = setup(100)
    const lifted = execute(s0, {
      type: 'range.lift',
      sequenceId: seqId,
      start: 20,
      end: 50,
      trackIds: [v1],
    })
    expect(layout(lifted, v1)).toEqual([
      ['c1', 0, 20, 0],
      ['c1~1', 50, 50, 50],
    ])
    const extracted = execute(s0, {
      type: 'range.extract',
      sequenceId: seqId,
      start: 20,
      end: 50,
      trackIds: [v1],
    })
    expect(layout(extracted, v1)).toEqual([
      ['c1', 0, 20, 0],
      ['c1~1', 20, 50, 50],
    ])
  })
})

describe('magnetic mode', () => {
  it('deleting closes gaps and moving reorders', () => {
    const { state: s0, seqId, v1 } = setup(300)
    let state = execute(s0, {
      type: 'clip.split',
      sequenceId: seqId,
      clipId: 'c1',
      frame: 100,
      newClipId: 'c2',
    })
    state = execute(state, {
      type: 'clip.split',
      sequenceId: seqId,
      clipId: 'c2',
      frame: 200,
      newClipId: 'c3',
    })
    state = execute(state, { type: 'sequence.settings', sequenceId: seqId, magnetic: true })
    state = execute(state, { type: 'clip.remove', sequenceId: seqId, clipIds: ['c2'] })
    expect(layout(state, v1).map((r) => [r[0], r[1]])).toEqual([
      ['c1', 0],
      ['c3', 100],
    ])
    state = execute(state, {
      type: 'clip.move',
      sequenceId: seqId,
      moves: [{ clipId: 'c3', start: 0 }],
    })
    expect(layout(state, v1).map((r) => [r[0], r[1]])).toEqual([
      ['c3', 0],
      ['c1', 100],
    ])
  })

  it('linked audio follows its video', () => {
    const { state: s0, seqId, v1, a1 } = setup(100)
    let state = execute(s0, {
      type: 'clip.update',
      sequenceId: seqId,
      clipIds: ['c1'],
      patch: { linkId: 'L' },
    })
    const second = createClip({
      id: 'c2',
      mediaId: 'm1',
      trackId: v1,
      start: 100,
      duration: 50,
      sourceIn: 0,
      linkId: 'L2',
    })
    const secondAudio = createClip({
      id: 'a2',
      mediaId: 'm1',
      trackId: a1,
      start: 100,
      duration: 50,
      sourceIn: 0,
      linkId: 'L2',
    })
    state = execute(state, { type: 'clip.add', sequenceId: seqId, clips: [second, secondAudio] })
    state = execute(state, { type: 'sequence.settings', sequenceId: seqId, magnetic: true })
    state = execute(state, { type: 'clip.remove', sequenceId: seqId, clipIds: ['c1'] })
    expect(seqOf(state).clips['c2']!.start).toBe(0)
    expect(seqOf(state).clips['a2']!.start).toBe(0)
  })
})

describe('markers and marks', () => {
  it('adds, edits and removes markers with undo', () => {
    const { state: s0, seqId } = setup()
    let state = execute(s0, {
      type: 'marker.add',
      sequenceId: seqId,
      marker: { id: 'k', frame: 10, name: 'Beat', note: '', color: 'blue' },
    })
    state = execute(state, {
      type: 'marker.update',
      sequenceId: seqId,
      markerId: 'k',
      patch: { note: 'Drop here' },
    })
    expect(seqOf(state).markers['k']).toMatchObject({ name: 'Beat', note: 'Drop here' })
    state = execute(state, { type: 'marker.remove', sequenceId: seqId, markerIds: ['k'] })
    expect(seqOf(state).markers['k']).toBeUndefined()
    expect(seqOf(undo(state)).markers['k']).toBeDefined()
  })
})

describe('nesting', () => {
  it('refuses to put a sequence inside itself', () => {
    const { state, seqId, v1 } = setup()
    const item = Object.values(state.project.media).find((m) => m.kind === 'sequence')!
    const clip = createClip({
      mediaId: item.id,
      trackId: v1,
      start: 400,
      duration: 10,
      sourceIn: 0,
    })
    expect(() => execute(state, { type: 'clip.add', sequenceId: seqId, clips: [clip] })).toThrow(
      /itself/,
    )
  })
})

describe('migration from version 1', () => {
  it('gives video clips with sound a linked audio clip on a new track', () => {
    const v1: Record<string, unknown> = {
      schemaVersion: 1,
      id: 'prj_1',
      name: 'Old',
      createdAt: '2026-10-01T00:00:00.000Z',
      activeSequenceId: 's',
      media: { m1: { ...asset, vfr: undefined, sequenceId: undefined, marks: undefined } },
      sequences: {
        s: {
          id: 's',
          name: 'Sequence 1',
          width: 1920,
          height: 1080,
          fps: { num: 30, den: 1 },
          sampleRate: 48000,
          tracks: [
            { id: 'v', kind: 'video', name: 'V1' },
            { id: 'a', kind: 'audio', name: 'A1' },
          ],
          clips: {
            c1: { id: 'c1', mediaId: 'm1', trackId: 'v', start: 0, duration: 90, sourceIn: 0 },
          },
        },
      },
    }
    const project: Project = migrateProject(v1)
    const seq = project.sequences['s']!
    expect(seq.tracks.map((t) => t.name)).toEqual(['V1', 'A1', 'A2'])
    const clips = Object.values(seq.clips) as Clip[]
    expect(clips).toHaveLength(2)
    expect(new Set(clips.map((c) => c.linkId)).size).toBe(1)
    expect(
      Object.values(project.media).some((m) => m.kind === 'sequence' && m.sequenceId === 's'),
    ).toBe(true)
  })
})
