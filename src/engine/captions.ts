import type { Command } from './commands'
import {
  createId,
  type CaptionCue,
  type CaptionTrack,
  type CaptionWord,
  type Project,
  type Sequence,
} from './model'
import { fpsValue } from './time'
import { clipEnd } from './timeline'

/** A word as the transcriber gives it: seconds into the media file. */
export type SourceWord = { text: string; start: number; end: number }

export type CueOptions = { maxChars: number; maxSeconds: number; pauseSeconds: number }
export const DEFAULT_CUES: CueOptions = { maxChars: 42, maxSeconds: 6, pauseSeconds: 0.7 }

/**
 * Groups words into captions: a new caption starts at a pause, when the text
 * would pass `maxChars`, when it would last longer than `maxSeconds`, or after
 * a sentence ends.
 */
export function cuesFromWords(
  words: CaptionWord[],
  fps: number,
  opts: CueOptions = DEFAULT_CUES,
): CaptionCue[] {
  const cues: CaptionCue[] = []
  let cur: CaptionWord[] = []
  const flush = () => {
    if (!cur.length) return
    const start = Math.max(0, Math.floor(cur[0]!.start))
    const end = Math.max(start + 1, Math.ceil(cur[cur.length - 1]!.end))
    cues.push({ id: createId('cap'), start, end, text: joinWords(cur), words: cur })
    cur = []
  }
  for (const w of words) {
    const prev = cur[cur.length - 1]
    if (prev) {
      const text = joinWords([...cur, w])
      const pause = (w.start - prev.end) / fps > opts.pauseSeconds
      const long = (w.end - cur[0]!.start) / fps > opts.maxSeconds
      const sentence = /[.?!]$/.test(prev.text) && text.length > opts.maxChars / 2
      if (pause || long || text.length > opts.maxChars || sentence) flush()
    }
    cur.push(w)
  }
  flush()
  // Captions don't overlap; one ends where the next begins.
  for (let i = 0; i + 1 < cues.length; i++)
    cues[i]!.end = Math.min(cues[i]!.end, cues[i + 1]!.start)
  return cues.filter((c) => c.end > c.start)
}

export function joinWords(words: { text: string }[]): string {
  return words
    .map((w) => w.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.?!;:%)])/g, '$1')
}

export function cueAt(track: CaptionTrack, frame: number): CaptionCue | null {
  return track.cues.find((c) => frame >= c.start && frame < c.end) ?? null
}

/** Caption lines for a cue, broken near the middle when it is long. */
export function cueLines(text: string, maxChars = 42): string[] {
  if (text.length <= maxChars) return [text]
  const words = text.split(' ')
  let best = 1
  let bestDiff = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length
    const b = words.slice(i).join(' ').length
    if (Math.abs(a - b) < bestDiff) {
      bestDiff = Math.abs(a - b)
      best = i
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')]
}

// ---------------------------------------------------------------- formats

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0')

function clock(seconds: number, sep: ',' | '.') {
  const ms = Math.round(seconds * 1000)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`
}

export function toSrt(track: CaptionTrack, fps: number): string {
  return track.cues
    .map(
      (c, i) =>
        `${i + 1}\n${clock(c.start / fps, ',')} --> ${clock(c.end / fps, ',')}\n${cueLines(c.text).join('\n')}\n`,
    )
    .join('\n')
}

export function toVtt(track: CaptionTrack, fps: number): string {
  const body = track.cues
    .map(
      (c) =>
        `${clock(c.start / fps, '.')} --> ${clock(c.end / fps, '.')}\n${cueLines(c.text).join('\n')}\n`,
    )
    .join('\n')
  return `WEBVTT\n\n${body}`
}

function assTime(seconds: number) {
  const cs = Math.round(seconds * 100)
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs % 100)}`
}

/** ASS colours are &HAABBGGRR. */
function assColor(hex: string) {
  const v = hex.replace('#', '').padEnd(6, '0')
  return `&H00${v.slice(4, 6)}${v.slice(2, 4)}${v.slice(0, 2)}`.toUpperCase()
}

/** ASS keeps the look: font, size, colour, position, and the karaoke highlight as \k timing. */
export function toAss(track: CaptionTrack, fps: number, width: number, height: number): string {
  const s = track.style
  const size = Math.round((s.size * height) / 1080)
  const marginV = Math.round((1 - s.position) * height - size / 2)
  const boxed = s.template === 'boxed' ? 3 : 1
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${s.font.replace(/,/g, ' ')},${size},${assColor(s.template === 'karaoke' ? s.highlight : s.color)},${assColor(s.color)},&H00000000,&H99000000,${s.template === 'bold' ? -1 : 0},0,0,0,100,100,0,0,${boxed},2,0,2,40,40,${Math.max(0, marginV)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  const lines = track.cues.map((c) => {
    let text: string
    if (s.template === 'karaoke' && c.words.length) {
      text = c.words
        .map((w, i) => {
          const next = c.words[i + 1]
          const cs = Math.max(1, Math.round((((next?.start ?? w.end) - w.start) / fps) * 100))
          return `{\\k${cs}}${s.uppercase ? w.text.toUpperCase() : w.text}`
        })
        .join(' ')
    } else {
      text = cueLines(s.uppercase ? c.text.toUpperCase() : c.text).join('\\N')
    }
    return `Dialogue: 0,${assTime(c.start / fps)},${assTime(c.end / fps)},Default,,0,0,0,,${text}`
  })
  return `${header.join('\n')}\n${lines.join('\n')}\n`
}

function parseClock(t: string): number {
  const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(t.trim())
  if (!m) return NaN
  const frac = Number(`0.${m[4]}`)
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac
}

/** Reads SRT, WebVTT or ASS text into captions at the sequence's frame rate. */
export function parseSubtitles(text: string, fps: number): CaptionCue[] {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const cues: CaptionCue[] = []
  const add = (start: number, end: number, body: string) => {
    const clean = body
      .replace(/\{[^}]*\}/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\\N/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!clean || !(end > start)) return
    const s = Math.round(start * fps)
    const e = Math.max(s + 1, Math.round(end * fps))
    cues.push({ id: createId('cap'), start: s, end: e, text: clean, words: [] })
  }
  if (/^\[Script Info\]/m.test(src)) {
    for (const line of src.split('\n')) {
      if (!line.startsWith('Dialogue:')) continue
      const parts = line.slice(9).split(',')
      add(parseClock(parts[1] ?? ''), parseClock(parts[2] ?? ''), parts.slice(9).join(','))
    }
  } else {
    for (const block of src.split(/\n\s*\n/)) {
      const lines = block.split('\n').filter((l) => l.trim() !== '')
      const at = lines.findIndex((l) => l.includes('-->'))
      if (at < 0) continue
      const [a, b] = lines[at]!.split('-->')
      add(
        parseClock(a ?? ''),
        parseClock((b ?? '').trim().split(/\s+/)[0] ?? ''),
        lines.slice(at + 1).join(' '),
      )
    }
  }
  return cues.sort((a, b) => a.start - b.start)
}

// ---------------------------------------------------------------- editing

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'erm', 'er', 'ah', 'hmm', 'mm', 'mhm'])

/** Where filler words are, as [start, end) sequence frames. */
export function fillerRanges(track: CaptionTrack): [number, number][] {
  const out: [number, number][] = []
  for (const cue of track.cues)
    for (const w of cue.words) {
      const t = w.text.toLowerCase().replace(/[^a-z]/g, '')
      if (FILLERS.has(t)) out.push([Math.floor(w.start), Math.ceil(w.end)])
    }
  return out
}

/**
 * Where the sequence's speech comes from: words of each transcribed file,
 * placed where its clips sit on audio tracks. Dialogue tracks are used when
 * any are marked; otherwise every audible audio track. Clips at changed speed
 * or playing backwards are skipped.
 */
export function wordsForSequence(
  project: Project,
  seq: Sequence,
  transcripts: Map<string, SourceWord[]>,
): CaptionWord[] {
  const fps = fpsValue(seq.fps)
  const audio = seq.tracks.filter((t) => t.kind === 'audio')
  const dialogue = audio.filter((t) => t.role === 'dialogue')
  const soloed = audio.some((t) => t.solo)
  const use = new Set(
    (dialogue.length ? dialogue : audio)
      .filter((t) => (soloed ? t.solo : !t.muted))
      .map((t) => t.id),
  )
  const words: CaptionWord[] = []
  for (const clip of Object.values(seq.clips)) {
    if (!use.has(clip.trackId) || clip.speed !== 1 || clip.ramp || clip.reverse) continue
    const list = transcripts.get(clip.mediaId)
    if (!list || !project.media[clip.mediaId]) continue
    const from = clip.sourceIn / fps
    const to = from + clip.duration / fps
    for (const w of list) {
      const mid = (w.start + w.end) / 2
      if (mid < from || mid >= to) continue
      words.push({
        text: w.text,
        start: Math.max(clip.start, clip.start + (w.start - from) * fps),
        end: Math.min(clipEnd(clip), clip.start + (w.end - from) * fps),
      })
    }
  }
  words.sort((a, b) => a.start - b.start)
  // Two tracks carrying the same take would repeat every word.
  return words.filter(
    (w, i) =>
      i === 0 || !(w.text === words[i - 1]!.text && Math.abs(w.start - words[i - 1]!.start) < 1),
  )
}

/** Merges touching or overlapping ranges, sorted. */
export function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = ranges.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const [a, b] of sorted) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** One undoable change that takes the ranges out of every track, closing the gaps. */
export function removeRangesCommand(
  seq: Sequence,
  ranges: [number, number][],
  label: string,
): Command | null {
  const merged = mergeRanges(ranges)
  if (!merged.length) return null
  const trackIds = seq.tracks.map((t) => t.id)
  // From the end backwards, so earlier ranges keep their frames.
  const commands: Command[] = merged
    .reverse()
    .map(([start, end]) => ({ type: 'range.extract', sequenceId: seq.id, start, end, trackIds }))
  return { type: 'batch', label, commands }
}

/** Captions after time is taken out: words inside go, later ones move back. */
export function extractFromCaptions(track: CaptionTrack, start: number, end: number): CaptionTrack {
  const len = end - start
  const move = (f: number) => (f >= end ? f - len : f > start ? start : f)
  const cues: CaptionCue[] = []
  for (const c of track.cues) {
    const words = c.words
      .filter((w) => (w.start + w.end) / 2 < start || (w.start + w.end) / 2 >= end)
      .map((w) => ({ ...w, start: move(w.start), end: move(w.end) }))
    const s = move(c.start)
    const e = move(c.end)
    if (e <= s) continue
    const text = c.words.length ? joinWords(words) : c.text
    if (!text) continue
    cues.push({ ...c, start: s, end: e, words, text })
  }
  return { ...track, cues }
}
