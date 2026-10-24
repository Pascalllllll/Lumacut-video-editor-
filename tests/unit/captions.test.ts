import { describe, expect, it } from 'vitest'
import {
  cuesFromWords,
  cueLines,
  fillerRanges,
  parseSubtitles,
  removeRangesCommand,
  toAss,
  toSrt,
  toVtt,
  wordsForSequence,
} from '@engine/captions'
import { execute, type HistoryState } from '@engine/history'
import { migrateProject } from '@engine/migrations'
import {
  activeSequence,
  createClip,
  createProject,
  emptyCaptions,
  type CaptionTrack,
  type CaptionWord,
  type MediaAsset,
} from '@engine/model'
import { buildScene, needsCompositor } from '@engine/scene'
import { parseSilences } from '../../src/media/export-plan'

const FPS = 25
const w = (text: string, s: number, e: number): CaptionWord => ({
  text,
  start: s * FPS,
  end: e * FPS,
})

describe('caption cues', () => {
  it('breaks at pauses, at sentence ends and at the length limit', () => {
    const words = [
      w('Hello', 0, 0.4),
      w('there.', 0.4, 0.8),
      w('This', 2, 2.2),
      w('is', 2.2, 2.3),
      w('a', 2.3, 2.4),
      w('caption', 2.4, 2.9),
      w('that', 2.9, 3.1),
      w('keeps', 3.1, 3.4),
      w('going', 3.4, 3.7),
      w('and', 3.7, 3.8),
      w('going', 3.8, 4.1),
      w('for', 4.1, 4.2),
      w('a', 4.2, 4.3),
      w('while', 4.3, 4.7),
    ]
    const cues = cuesFromWords(words, FPS)
    expect(cues[0]!.text).toBe('Hello there.')
    expect(cues.length).toBeGreaterThanOrEqual(3)
    for (const c of cues) expect(c.text.length).toBeLessThanOrEqual(42)
    for (let i = 1; i < cues.length; i++)
      expect(cues[i]!.start).toBeGreaterThanOrEqual(cues[i - 1]!.end)
  })

  it('puts punctuation against the word before it', () => {
    expect(
      cuesFromWords([w('Yes', 0, 0.3), w(',', 0.3, 0.35), w('sir', 0.4, 0.6)], FPS)[0]!.text,
    ).toBe('Yes, sir')
  })

  it('splits long text into two balanced lines', () => {
    const [a, b] = cueLines('And so my fellow Americans ask not what your country can do for you')
    expect(Math.abs(a!.length - b!.length)).toBeLessThan(12)
  })
})

describe('subtitle files', () => {
  const track: CaptionTrack = {
    ...emptyCaptions(),
    cues: cuesFromWords(
      [w('First', 1, 1.5), w('line.', 1.5, 2), w('Second', 4, 4.4), w('one', 4.4, 5)],
      FPS,
    ),
  }

  it('SRT and WebVTT read back the same text and times', () => {
    for (const text of [toSrt(track, FPS), toVtt(track, FPS)]) {
      const back = parseSubtitles(text, FPS)
      expect(back.map((c) => [c.start, c.end, c.text])).toEqual(
        track.cues.map((c) => [c.start, c.end, c.text]),
      )
    }
    expect(toSrt(track, FPS)).toContain('00:00:01,000 --> 00:00:02,000')
    expect(toVtt(track, FPS).startsWith('WEBVTT')).toBe(true)
  })

  it('ASS keeps the karaoke timing and reads back', () => {
    const ass = toAss({ ...track, style: { ...track.style, template: 'karaoke' } }, FPS, 1920, 1080)
    expect(ass).toContain('PlayResY: 1080')
    expect(ass).toMatch(/\{\\k50\}First/)
    expect(parseSubtitles(ass, FPS).map((c) => c.text)).toEqual(['First line.', 'Second one'])
  })
})

describe('editing by text', () => {
  function project() {
    const p = createProject('t')
    const seq = activeSequence(p)
    seq.fps = { num: FPS, den: 1 }
    const a1 = seq.tracks.find((t) => t.kind === 'audio')!
    const asset = {
      id: 'm',
      kind: 'audio',
      hasAudio: true,
      path: '/m.wav',
      duration: 20,
    } as MediaAsset
    p.media = { m: asset }
    // The clip starts at 2 s on the timeline and uses the file from 1 s.
    const clip = createClip({
      mediaId: 'm',
      trackId: a1.id,
      start: 50,
      duration: 250,
      sourceIn: 25,
    })
    seq.clips = { [clip.id]: clip }
    return { p, seq }
  }

  it('places transcript words where the clip plays them', () => {
    const { p, seq } = project()
    const words = wordsForSequence(
      p,
      seq,
      new Map([
        [
          'm',
          [
            { text: 'early', start: 0.2, end: 0.6 },
            { text: 'hi', start: 2, end: 2.4 },
          ],
        ],
      ]),
    )
    expect(words).toEqual([{ text: 'hi', start: 75, end: 85 }])
  })

  it('finds filler words', () => {
    const track = {
      ...emptyCaptions(),
      cues: cuesFromWords([w('So', 0, 0.2), w('um,', 0.3, 0.6), w('yes', 0.7, 1)], FPS),
    }
    expect(fillerRanges(track)).toEqual([[7, 15]])
  })

  it('removing words takes the time out and moves the captions with it', () => {
    const { p, seq } = project()
    seq.captions = {
      ...emptyCaptions(),
      cues: cuesFromWords([w('keep', 2, 2.5), w('cut', 3, 3.5), w('later', 6, 6.5)], FPS),
    }
    let state: HistoryState = { project: p, past: [], future: [] }
    const cmd = removeRangesCommand(seq, [[75, 88]], 'Remove words')!
    state = execute(state, cmd)
    const s = activeSequence(state.project)
    expect(Object.values(s.clips).reduce((a, c) => a + c.duration, 0)).toBe(250 - 13)
    const words = s.captions.cues.flatMap((c) => c.words.map((x) => x.text))
    expect(words).toEqual(['keep', 'later'])
    expect(s.captions.cues.at(-1)!.start).toBe(150 - 13)
  })

  it('older projects open with no captions', () => {
    const raw = JSON.parse(JSON.stringify(createProject('old'))) as Record<string, unknown>
    raw['schemaVersion'] = 5
    const seqs = raw['sequences'] as Record<string, Record<string, unknown>>
    for (const s of Object.values(seqs)) delete s['captions']
    expect(activeSequence(migrateProject(raw)).captions.cues).toEqual([])
  })
})

describe('captions in the picture', () => {
  it('a caption on screen becomes the top layer and sends exports through the compositor', () => {
    const p = createProject('c')
    const seq = activeSequence(p)
    seq.captions = {
      ...emptyCaptions(),
      cues: [{ id: 'c1', start: 10, end: 20, text: 'Hi', words: [] }],
    }
    expect(needsCompositor(p, seq)).toBe(true)
    const items = buildScene(p, seq, 12).items
    expect(items.at(-1)).toMatchObject({ kind: 'layer', source: { kind: 'caption' } })
    expect(buildScene(p, seq, 25).items).toHaveLength(0)
    expect(
      buildScene(p, { ...seq, captions: { ...seq.captions, show: false } }, 12).items,
    ).toHaveLength(0)
  })
})

describe('silence detection', () => {
  it('reads silencedetect output, including silence that runs to the end', () => {
    const log = `[silencedetect @ 0x1] silence_start: 1.5\n[silencedetect @ 0x1] silence_end: 2.75 | silence_duration: 1.25\n[silencedetect @ 0x1] silence_start: 8.2\n`
    expect(parseSilences(log, 10)).toEqual([
      [1.5, 2.75],
      [8.2, 10],
    ])
  })
})
