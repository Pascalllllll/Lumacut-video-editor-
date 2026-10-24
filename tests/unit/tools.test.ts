import { describe, expect, it } from 'vitest'
import { execute, undo, type HistoryState } from '@engine/history'
import { activeSequence, createClip, createProject, type MediaAsset } from '@engine/model'
import { sequenceDuration } from '@engine/timeline'
import { runTool, toolSpecs, TOOLS, type ToolServices, type ToolSession } from '../../src/ai/tools'

function project() {
  const p = createProject('t')
  const seq = activeSequence(p)
  seq.fps = { num: 25, den: 1 }
  const a1 = seq.tracks.find((t) => t.kind === 'audio')!
  const asset = {
    id: 'voice',
    name: 'voice.wav',
    kind: 'audio',
    hasAudio: true,
    hasVideo: false,
    path: '/voice.wav',
    duration: 10,
  } as MediaAsset
  p.media = { voice: asset }
  const clip = createClip({
    mediaId: 'voice',
    trackId: a1.id,
    start: 0,
    duration: 250,
    sourceIn: 0,
  })
  seq.clips = { [clip.id]: clip }
  return p
}

const services: ToolServices = {
  // Speech from 0 to 3 s and from 6 to 10 s; silence between.
  transcribe: async () => [
    { text: 'Hello', start: 0.5, end: 1 },
    { text: 'there.', start: 1, end: 1.6 },
    { text: 'Back', start: 6.5, end: 7 },
    { text: 'again.', start: 7, end: 7.6 },
  ],
  silences: async () => [[3, 6]],
  frame: async () => '',
  stats: async () => ({ mean: [0.5, 0.5, 0.5], std: [0.2, 0.2, 0.2], low: 0, high: 1 }),
  waveform: async () => ({ rate: 100, peaks: new Uint8Array(1000) }),
}

describe('copilot tools', () => {
  it('every tool has a JSON Schema object for its parameters', () => {
    const specs = toolSpecs()
    expect(specs).toHaveLength(TOOLS.length)
    for (const s of specs) expect(s.parameters['type']).toBe('object')
    expect(specs.map((s) => s.name)).toEqual(
      expect.arrayContaining(['get_timeline', 'remove_silences', 'generate_captions', 'export']),
    )
  })

  it('"remove silences longer than 0.7 s and add captions" lands as one undo step', async () => {
    const p = project()
    const s: ToolSession = {
      project: p,
      sequenceId: activeSequence(p).id,
      commands: [],
      services,
      exportAfterApply: false,
    }
    expect((await runTool(s, 'remove_silences', { min_seconds: 0.7 })).text).toMatch(
      /^Silences removed: 1,/,
    )
    expect((await runTool(s, 'generate_captions', {})).text).toBe('Made 2 captions.')
    const after = activeSequence(s.project)
    expect(sequenceDuration(after)).toBe(
      250 - Math.round((6 - 0.12) * 25) + Math.round((3 + 0.12) * 25),
    )
    // The second caption moved back with the cut.
    expect(after.captions.cues[1]!.start).toBeLessThan(6.5 * 25)

    let state: HistoryState = { project: p, past: [], future: [] }
    state = execute(state, { type: 'batch', label: 'Copilot', commands: s.commands })
    expect(activeSequence(state.project).captions.cues).toHaveLength(2)
    state = undo(state)
    expect(state.project).toEqual(p)
  })

  it('bad arguments come back as readable errors, not exceptions', async () => {
    const p = project()
    const s: ToolSession = {
      project: p,
      sequenceId: activeSequence(p).id,
      commands: [],
      services,
      exportAfterApply: false,
    }
    const r = await runTool(s, 'trim_clip', { clip_id: 'nope', edge: 'middle', to: -1 })
    expect(r.error).toBe(true)
    expect(r.text).toContain('arguments were not valid')
    expect((await runTool(s, 'get_clip', { clip_id: 'nope' })).text).toContain('Call get_timeline')
  })

  it('read tools describe the timeline in seconds', async () => {
    const p = project()
    const s: ToolSession = {
      project: p,
      sequenceId: activeSequence(p).id,
      commands: [],
      services,
      exportAfterApply: false,
    }
    const timeline = JSON.parse((await runTool(s, 'get_timeline', {})).text) as {
      tracks: { name: string; clips: { end: number }[] }[]
    }
    expect(timeline.tracks.find((t) => t.name === 'A1')!.clips[0]!.end).toBe(10)
  })
})
