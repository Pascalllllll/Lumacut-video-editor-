import { describe, expect, it } from 'vitest'
import { applyEase, cubicBezier, evaluate, setAt, toggleAnimation } from '@engine/animation'
import { createEffect } from '@engine/effects'
import { placeCommand } from '@engine/edits'
import { execute, type HistoryState } from '@engine/history'
import {
  activeSequence,
  createClip,
  createProject,
  createTrack,
  type MediaAsset,
} from '@engine/model'
import { buildScene, type Layer } from '@engine/scene'

const video = (id: string, w = 1920, h = 1080): MediaAsset => ({
  id,
  name: id,
  path: `/m/${id}`,
  kind: 'video',
  duration: 10,
  width: w,
  height: h,
  fps: { num: 30, den: 1 },
  vfr: false,
  hasVideo: true,
  hasAudio: false,
  videoCodec: 'h264',
  audioCodec: null,
  sampleRate: null,
  channels: null,
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

describe('animation', () => {
  it('interpolates linearly and holds', () => {
    let a = toggleAnimation({ value: 0, keys: [] }, 0)
    a = setAt(a, 10, 100)
    expect(evaluate(a, 5)).toBe(50)
    expect(evaluate(a, -5)).toBe(0)
    expect(evaluate(a, 20)).toBe(100)
    a = { ...a, keys: a.keys.map((k, i) => (i === 0 ? { ...k, ease: 'hold' as const } : k)) }
    expect(evaluate(a, 9)).toBe(0)
  })
  it('eases with cubic curves like CSS', () => {
    expect(cubicBezier(0.42, 0, 0.58, 1, 0.5)).toBeCloseTo(0.5, 3)
    expect(applyEase('ease-in', 0.25)).toBeLessThan(0.25)
    expect(applyEase('ease-out', 0.25)).toBeGreaterThan(0.25)
  })
})

describe('scene', () => {
  function base() {
    let state: HistoryState = { project: createProject('t'), past: [], future: [] }
    state = execute(state, {
      type: 'media.add',
      assets: [video('a'), video('b', 1280, 720), video('v', 1080, 1920)],
    })
    state = execute(
      state,
      placeCommand(state.project, activeSequence(state.project), state.project.media['a']!, 0),
    )
    return state
  }

  it('stacks visible tracks bottom to top and fits pictures in the frame', () => {
    let state = base()
    const seq = activeSequence(state.project)
    const v2 = createTrack('video', 'V2')
    state = execute(state, { type: 'track.add', sequenceId: seq.id, track: v2 })
    state = execute(state, {
      type: 'clip.add',
      sequenceId: seq.id,
      clips: [createClip({ mediaId: 'v', trackId: v2.id, start: 10, duration: 20, sourceIn: 0 })],
    })
    const scene = buildScene(state.project, activeSequence(state.project), 15)
    expect(scene.items).toHaveLength(2)
    const top = scene.items[1] as Layer
    expect(top.source.kind).toBe('media')
    expect(top.fit).toBeCloseTo(1080 / 1920)
  })

  it('evaluates keyframed transforms and effects', () => {
    let state = base()
    const seq = activeSequence(state.project)
    const clip = Object.values(seq.clips)[0]!
    const fx = createEffect('gaussian-blur')
    fx.params['radius'] = {
      value: 0,
      keys: [
        { frame: 0, value: 0, ease: 'linear' },
        { frame: 10, value: 20, ease: 'linear' },
      ],
    }
    state = execute(state, {
      type: 'clip.look',
      sequenceId: seq.id,
      clipIds: [clip.id],
      patch: {
        transform: {
          ...clip.transform,
          x: {
            value: 0,
            keys: [
              { frame: 0, value: 0, ease: 'linear' },
              { frame: 10, value: 100, ease: 'linear' },
            ],
          },
        },
        effects: [fx],
      },
    })
    const layer = buildScene(state.project, activeSequence(state.project), 5).items[0] as Layer
    expect(layer.transform.x).toBe(50)
    expect(layer.effects[0]).toEqual({ type: 'gaussian-blur', params: { radius: 10 } })
  })

  it('keeps keyframes on the same picture after a split', () => {
    let state = base()
    const seq = activeSequence(state.project)
    const clip = Object.values(seq.clips).find((c) => c.trackId === seq.tracks[0]!.id)!
    state = execute(state, {
      type: 'clip.look',
      sequenceId: seq.id,
      clipIds: [clip.id],
      patch: {
        transform: {
          ...clip.transform,
          opacity: {
            value: 1,
            keys: [
              { frame: 0, value: 0, ease: 'linear' },
              { frame: 100, value: 1, ease: 'linear' },
            ],
          },
        },
      },
    })
    const before = (buildScene(state.project, activeSequence(state.project), 75).items[0] as Layer)
      .transform.opacity
    state = execute(state, { type: 'clip.split', sequenceId: seq.id, clipId: clip.id, frame: 50 })
    const after = (buildScene(state.project, activeSequence(state.project), 75).items[0] as Layer)
      .transform.opacity
    expect(after).toBeCloseTo(before)
  })

  it('a cross dissolve mixes the clips on both sides of a cut', () => {
    let state = base()
    const seq = activeSequence(state.project)
    const v1 = seq.tracks[0]!.id
    state = execute(state, {
      type: 'clip.add',
      sequenceId: seq.id,
      clips: [
        createClip({ id: 'b1', mediaId: 'b', trackId: v1, start: 300, duration: 60, sourceIn: 30 }),
      ],
    })
    const left = Object.values(activeSequence(state.project).clips).find(
      (c) => c.mediaId === 'a' && c.trackId === v1,
    )!
    state = execute(state, {
      type: 'transition.add',
      sequenceId: seq.id,
      transition: {
        id: 't',
        trackId: v1,
        leftClipId: left.id,
        rightClipId: 'b1',
        type: 'cross-dissolve',
        duration: 20,
        ease: 'linear',
      },
    })
    const mid = buildScene(state.project, activeSequence(state.project), 300).items[0]!
    expect(mid.kind).toBe('transition')
    if (mid.kind !== 'transition') return
    expect(mid.progress).toBeCloseTo(10.5 / 20)
    expect(mid.from?.source.kind).toBe('media')
    // The incoming clip borrows frames from before its in point.
    if (mid.to?.source.kind === 'media') expect(mid.to.source.time).toBeCloseTo(30 / 30)
    // Removing a clip removes its transition.
    state = execute(state, { type: 'clip.remove', sequenceId: seq.id, clipIds: ['b1'] })
    expect(Object.keys(activeSequence(state.project).transitions)).toHaveLength(0)
  })
})
