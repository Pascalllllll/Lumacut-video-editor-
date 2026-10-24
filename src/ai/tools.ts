import { produce } from 'immer'
import { z } from 'zod'
import { audioParams, createAudioEffect } from '@engine/audio'
import {
  cuesFromWords,
  fillerRanges,
  removeRangesCommand,
  wordsForSequence,
  type SourceWord,
} from '@engine/captions'
import { matchColor, type FrameStats } from '@engine/color'
import { applyCommand, commandSchema, pruneTransitions, type Command } from '@engine/commands'
import { duckCommand, DEFAULT_DUCK, type Envelope } from '@engine/ducking'
import { bladeCommand, generatorCommand, placementClips, transitionCommand } from '@engine/edits'
import { createEffect, EFFECTS } from '@engine/effects'
import { LOOK_IDS } from '@engine/looks'
import {
  activeSequence,
  AUDIO_EFFECTS,
  CAPTION_TEMPLATES,
  createId,
  MARKER_COLORS,
  TRANSITIONS,
  titleSchema,
  type Clip,
  type MediaAsset,
  type Project,
  type Sequence,
  type Track,
} from '@engine/model'
import { resolveVideo } from '@engine/resolve'
import { fpsValue } from '@engine/time'
import { clipEnd, companions, sequenceDuration } from '@engine/timeline'

/**
 * The tools the copilot and the MCP server share. Read tools describe the
 * project; edit tools turn into ordinary engine commands applied to a working
 * copy, so a whole run can be shown as a diff and applied as one undo step.
 * Times are seconds on the sequence, tracks are named like V1 or A2.
 */

/** Slow or system work the tools ask the host to do. */
export type ToolServices = {
  transcribe(asset: MediaAsset, language: string | null): Promise<SourceWord[]>
  /** Quiet stretches of the mix, in seconds. */
  silences(
    project: Project,
    sequenceId: string,
    thresholdDb: number,
    minSeconds: number,
  ): Promise<[number, number][]>
  /** A JPEG of the file at a time, base64. */
  frame(asset: MediaAsset, seconds: number): Promise<string>
  stats(asset: MediaAsset, seconds: number): Promise<FrameStats>
  waveform(asset: MediaAsset): Promise<Envelope>
  /** Starts an export of the given project to `path`; MCP only. */
  exportTo?: (project: Project, sequenceId: string, path: string) => Promise<string>
}

export type ToolSession = {
  project: Project
  sequenceId: string
  commands: Command[]
  services: ToolServices
  /** The copilot defers exports until its changes are applied. */
  exportAfterApply: boolean
}

export type ToolResult = { text: string; images?: string[] }

type ToolDef<S extends z.ZodObject = z.ZodObject> = {
  name: string
  description: string
  schema: S
  edits: boolean
  run: (s: ToolSession, args: z.infer<S>) => Promise<ToolResult> | ToolResult
}

export class ToolError extends Error {}

const seqOf = (s: ToolSession): Sequence => {
  const seq = s.project.sequences[s.sequenceId] ?? activeSequence(s.project)
  return seq
}
const fpsOf = (s: ToolSession) => fpsValue(seqOf(s).fps)
const toFrames = (s: ToolSession, seconds: number) => Math.max(0, Math.round(seconds * fpsOf(s)))
const toSeconds = (s: ToolSession, frames: number) => Math.round((frames / fpsOf(s)) * 1000) / 1000
const json = (v: unknown): ToolResult => ({ text: JSON.stringify(v) })
const done = (text: string): ToolResult => ({ text })

/** Applies a command to the working copy and records it. */
export function apply(s: ToolSession, cmd: Command) {
  const checked = commandSchema.parse(cmd)
  s.project = produce(s.project, (draft) => {
    applyCommand(draft, checked)
    pruneTransitions(draft)
  })
  s.commands.push(checked)
}

function trackByName(seq: Sequence, name: string): Track {
  const t = seq.tracks.find((tr) => tr.name.toLowerCase() === name.toLowerCase() || tr.id === name)
  if (!t)
    throw new ToolError(
      `No track named ${name}. Tracks: ${seq.tracks.map((tr) => tr.name).join(', ')}.`,
    )
  return t
}

function clipById(seq: Sequence, id: string): Clip {
  const c = seq.clips[id]
  if (!c) throw new ToolError(`No clip with id ${id}. Call get_timeline for clip ids.`)
  return c
}

function mediaOf(s: ToolSession, clip: Clip): MediaAsset {
  const m = s.project.media[clip.mediaId]
  if (!m) throw new ToolError('That clip points at missing media.')
  return m
}

function describeClip(s: ToolSession, seq: Sequence, c: Clip) {
  const m = s.project.media[c.mediaId]
  return {
    id: c.id,
    media: m?.name ?? null,
    start: toSeconds(s, c.start),
    end: toSeconds(s, clipEnd(c)),
    source_in: toSeconds(s, c.sourceIn),
    ...(c.speed !== 1 || c.ramp ? { speed: c.ramp ? 'ramp' : c.speed } : {}),
    ...(c.reverse ? { reverse: true } : {}),
    ...(c.linkId ? { linked: true } : {}),
    ...(c.title ? { title: c.title.text } : {}),
    ...(c.effects.length ? { effects: c.effects.map((e) => e.type) } : {}),
    ...(c.grade.length ? { graded: true } : {}),
    ...(seq.tracks.find((t) => t.id === c.trackId)?.kind === 'audio'
      ? {
          gain_db: c.sound.gain,
          volume_db: c.sound.volume.value,
          ...(c.sound.volume.keys.length ? { volume_keyframes: c.sound.volume.keys.length } : {}),
          ...(c.sound.effects.length ? { sound_effects: c.sound.effects.map((e) => e.type) } : {}),
        }
      : {}),
  }
}

const t = <S extends z.ZodObject>(def: ToolDef<S>) => def as unknown as ToolDef
const seconds = z.number().min(0).describe('Seconds from the start of the sequence')

export const TOOLS: ToolDef[] = [
  t({
    name: 'get_project_summary',
    description:
      'The project at a glance: sequences, the open sequence, its size, frame rate, length, tracks and media count.',
    schema: z.object({}),
    edits: false,
    run: (s) => {
      const seq = seqOf(s)
      return json({
        project: s.project.name,
        sequences: Object.values(s.project.sequences).map((q) => ({ id: q.id, name: q.name })),
        open_sequence: {
          id: seq.id,
          name: seq.name,
          width: seq.width,
          height: seq.height,
          fps: fpsOf(s),
          duration: toSeconds(s, sequenceDuration(seq)),
          tracks: seq.tracks.map((tr) => ({
            name: tr.name,
            kind: tr.kind,
            clips: Object.values(seq.clips).filter((c) => c.trackId === tr.id).length,
            ...(tr.role ? { role: tr.role } : {}),
          })),
          captions: seq.captions.cues.length,
          loudness_target: seq.loudnessTarget,
        },
        media: Object.keys(s.project.media).length,
      })
    },
  }),
  t({
    name: 'get_timeline',
    description:
      'Every track and clip of the open sequence with times in seconds and clip ids, plus markers and transitions.',
    schema: z.object({}),
    edits: false,
    run: (s) => {
      const seq = seqOf(s)
      return json({
        duration: toSeconds(s, sequenceDuration(seq)),
        fps: fpsOf(s),
        tracks: seq.tracks.map((tr) => ({
          name: tr.name,
          kind: tr.kind,
          ...(tr.muted ? { muted: true } : {}),
          ...(tr.locked ? { locked: true } : {}),
          ...(tr.role ? { role: tr.role } : {}),
          clips: Object.values(seq.clips)
            .filter((c) => c.trackId === tr.id)
            .sort((a, b) => a.start - b.start)
            .map((c) => describeClip(s, seq, c)),
        })),
        markers: Object.values(seq.markers).map((m) => ({
          time: toSeconds(s, m.frame),
          name: m.name,
        })),
        transitions: Object.values(seq.transitions).map((tr) => ({
          type: tr.type,
          between: [tr.leftClipId, tr.rightClipId],
        })),
      })
    },
  }),
  t({
    name: 'get_clip',
    description: 'Everything about one clip: timing, transform, effects, grade and sound settings.',
    schema: z.object({ clip_id: z.string() }),
    edits: false,
    run: (s, { clip_id }) => {
      const seq = seqOf(s)
      const c = clipById(seq, clip_id)
      return json({
        ...describeClip(s, seq, c),
        track: seq.tracks.find((tr) => tr.id === c.trackId)?.name,
        transform: c.transform,
        effects: c.effects,
        grade: c.grade,
        sound: c.sound,
      })
    },
  }),
  t({
    name: 'get_transcript',
    description:
      'The captions of the open sequence with their times. Empty until generate_captions runs or captions are imported.',
    schema: z.object({}),
    edits: false,
    run: (s) => {
      const seq = seqOf(s)
      if (!seq.captions.cues.length)
        return done('There are no captions yet. Call generate_captions first.')
      return json(
        seq.captions.cues.map((c) => ({
          id: c.id,
          start: toSeconds(s, c.start),
          end: toSeconds(s, c.end),
          text: c.text,
        })),
      )
    },
  }),
  t({
    name: 'search_media',
    description:
      'Media in the project whose name contains the query (empty query lists everything), with ids for add_clip.',
    schema: z.object({ query: z.string().default('') }),
    edits: false,
    run: (s, { query }) => {
      const q = query.toLowerCase()
      return json(
        Object.values(s.project.media)
          .filter((m) => m.name.toLowerCase().includes(q))
          .slice(0, 100)
          .map((m) => ({
            id: m.id,
            name: m.name,
            kind: m.kind,
            duration: m.duration,
            has_audio: m.hasAudio,
            size: m.width ? `${m.width}x${m.height}` : null,
          })),
      )
    },
  }),
  t({
    name: 'sample_frames',
    description: 'Pictures of the sequence at up to six times, to see what is on screen.',
    schema: z.object({ times: z.array(seconds).min(1).max(6) }),
    edits: false,
    run: async (s, { times }) => {
      const seq = seqOf(s)
      const images: string[] = []
      const notes: string[] = []
      for (const time of times) {
        const leaf = resolveVideo(s.project, seq, toFrames(s, time))
        if (!leaf || leaf.asset.kind === 'generator') {
          notes.push(`${time}s: no video picture`)
          continue
        }
        images.push(await s.services.frame(leaf.asset, leaf.time))
        notes.push(`${time}s: ${leaf.asset.name}`)
      }
      return { text: notes.join('\n'), images }
    },
  }),
  t({
    name: 'add_clip',
    description:
      'Places media on the timeline at a time, overwriting what is there. Video brings its linked sound.',
    schema: z.object({
      media_id: z.string(),
      at: seconds,
      source_in: z.number().min(0).optional().describe('Seconds into the media to start from'),
      duration: z
        .number()
        .positive()
        .optional()
        .describe('Seconds; defaults to the rest of the media'),
      video_track: z.string().optional(),
      audio_track: z.string().optional(),
    }),
    edits: true,
    run: (s, a) => {
      const seq = seqOf(s)
      const asset = s.project.media[a.media_id]
      if (!asset) throw new ToolError(`No media with id ${a.media_id}. Call search_media.`)
      const clips = placementClips(s.project, seq, asset, toFrames(s, a.at), {
        ...(a.source_in !== undefined ? { sourceIn: toFrames(s, a.source_in) } : {}),
        ...(a.duration !== undefined ? { duration: Math.max(1, toFrames(s, a.duration)) } : {}),
        ...(a.video_track ? { videoTrackId: trackByName(seq, a.video_track).id } : {}),
        ...(a.audio_track ? { audioTrackId: trackByName(seq, a.audio_track).id } : {}),
      })
      apply(s, { type: 'clip.add', sequenceId: seq.id, clips })
      return done(`Added ${asset.name} at ${a.at}s as ${clips.map((c) => c.id).join(', ')}.`)
    },
  }),
  t({
    name: 'move_clip',
    description:
      'Moves a clip (and its linked clips) to start at a new time, optionally onto another track.',
    schema: z.object({ clip_id: z.string(), to: seconds, track: z.string().optional() }),
    edits: true,
    run: (s, { clip_id, to, track }) => {
      const seq = seqOf(s)
      const clip = clipById(seq, clip_id)
      const delta = toFrames(s, to) - clip.start
      const moves = [...companions(seq, [clip_id])].map((id) => ({
        clipId: id,
        start: Math.max(0, seq.clips[id]!.start + delta),
        ...(id === clip_id && track ? { trackId: trackByName(seq, track).id } : {}),
      }))
      apply(s, { type: 'clip.move', sequenceId: seq.id, moves })
      return done(`Moved the clip to ${to}s.`)
    },
  }),
  t({
    name: 'trim_clip',
    description:
      'Moves the start or end edge of a clip to a time. With ripple, later clips follow.',
    schema: z.object({
      clip_id: z.string(),
      edge: z.enum(['start', 'end']),
      to: seconds,
      ripple: z.boolean().default(false),
    }),
    edits: true,
    run: (s, { clip_id, edge, to, ripple }) => {
      const seq = seqOf(s)
      clipById(seq, clip_id)
      apply(s, {
        type: 'clip.trim',
        sequenceId: seq.id,
        clipId: clip_id,
        edge,
        frame: toFrames(s, to),
        ripple,
      })
      return done(`Trimmed the ${edge} to ${to}s.`)
    },
  }),
  t({
    name: 'split_at',
    description: 'Cuts clips in two at a time: the given clips, or every clip under that time.',
    schema: z.object({ time: seconds, clip_ids: z.array(z.string()).optional() }),
    edits: true,
    run: (s, { time, clip_ids }) => {
      const seq = seqOf(s)
      const frame = toFrames(s, time)
      const ids =
        clip_ids ??
        Object.values(seq.clips)
          .filter((c) => c.start < frame && clipEnd(c) > frame)
          .map((c) => c.id)
      const cmd = bladeCommand(seq, [...companions(seq, ids)], frame)
      if (!cmd) return done('No clip crosses that time.')
      apply(s, cmd)
      return done(`Split at ${time}s.`)
    },
  }),
  t({
    name: 'delete_range',
    description:
      'Removes a stretch of time from every track. With ripple (the default) later material moves back to close the gap.',
    schema: z.object({ start: seconds, end: seconds, ripple: z.boolean().default(true) }),
    edits: true,
    run: (s, { start, end, ripple }) => {
      const seq = seqOf(s)
      if (end <= start) throw new ToolError('end must be after start.')
      apply(s, {
        type: ripple ? 'range.extract' : 'range.lift',
        sequenceId: seq.id,
        start: toFrames(s, start),
        end: toFrames(s, end),
        trackIds: seq.tracks.map((tr) => tr.id),
      })
      return done(`Removed ${start}s to ${end}s.`)
    },
  }),
  t({
    name: 'ripple_delete',
    description: 'Deletes clips (with their linked clips) and closes the gaps they leave.',
    schema: z.object({ clip_ids: z.array(z.string()).min(1) }),
    edits: true,
    run: (s, { clip_ids }) => {
      const seq = seqOf(s)
      clip_ids.forEach((id) => clipById(seq, id))
      apply(s, {
        type: 'clip.remove',
        sequenceId: seq.id,
        clipIds: [...companions(seq, clip_ids)],
        ripple: true,
      })
      return done(`Deleted ${clip_ids.length} clips.`)
    },
  }),
  t({
    name: 'set_speed',
    description:
      "Changes a clip's speed (1 is normal, 0.5 half speed, 2 double) and direction; later clips move to fit.",
    schema: z.object({
      clip_id: z.string(),
      speed: z.number().min(0.05).max(20),
      reverse: z.boolean().default(false),
    }),
    edits: true,
    run: (s, { clip_id, speed, reverse }) => {
      const seq = seqOf(s)
      for (const id of companions(seq, [clip_id])) {
        const c = clipById(seq, id)
        apply(s, {
          type: 'clip.speed',
          sequenceId: seq.id,
          clipId: id,
          speed,
          reverse,
          ramp: null,
          interpolation: c.interpolation,
          ripple: true,
        })
      }
      return done(`Speed set to ${Math.round(speed * 100)}%.`)
    },
  }),
  t({
    name: 'add_transition',
    description:
      'Adds a transition at the start or end of a clip: between it and a touching neighbour, or a fade from or to black.',
    schema: z.object({
      clip_id: z.string(),
      edge: z.enum(['start', 'end']).default('end'),
      type: z.enum(TRANSITIONS).default('cross-dissolve'),
      duration: z.number().min(0.1).max(10).default(1),
    }),
    edits: true,
    run: (s, { clip_id, edge, type, duration }) => {
      const seq = seqOf(s)
      clipById(seq, clip_id)
      apply(s, transitionCommand(seq, clip_id, edge, type, Math.max(2, toFrames(s, duration))))
      return done(`Added a ${type} transition.`)
    },
  }),
  t({
    name: 'apply_effect',
    description: `Adds a picture effect to clips. Effects: ${EFFECTS.map((e) => e.type).join(', ')}. Number parameters are optional.`,
    schema: z.object({
      clip_ids: z.array(z.string()).min(1),
      effect: z.enum(EFFECTS.map((e) => e.type) as [string, ...string[]]),
      params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
    }),
    edits: true,
    run: (s, { clip_ids, effect, params }) => {
      const seq = seqOf(s)
      for (const id of clip_ids) {
        const c = clipById(seq, id)
        const fx = createEffect(effect)
        for (const [k, v] of Object.entries(params))
          fx.params[k] = typeof v === 'number' ? { value: v, keys: [] } : v
        apply(s, {
          type: 'clip.look',
          sequenceId: seq.id,
          clipIds: [id],
          patch: { effects: [...c.effects, fx] },
        })
      }
      return done(`Added ${effect} to ${clip_ids.length} clips.`)
    },
  }),
  t({
    name: 'set_keyframes',
    description:
      'Animates a clip property with keyframes. Times are seconds from the clip start. Properties: x, y, scaleX, scaleY, rotation, opacity (0 to 1), volume (dB, audio clips).',
    schema: z.object({
      clip_id: z.string(),
      property: z.enum(['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'volume']),
      keys: z
        .array(
          z.object({
            time: z.number().min(0),
            value: z.number(),
            ease: z
              .enum(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'])
              .default('linear'),
          }),
        )
        .min(1),
    }),
    edits: true,
    run: (s, { clip_id, property, keys }) => {
      const seq = seqOf(s)
      const c = clipById(seq, clip_id)
      const anim = {
        value: keys[0]!.value,
        keys: keys
          .map((k) => ({ frame: toFrames(s, k.time), value: k.value, ease: k.ease }))
          .sort((a, b) => a.frame - b.frame),
      }
      const patch =
        property === 'volume'
          ? { sound: { ...c.sound, volume: anim } }
          : { transform: { ...c.transform, [property]: anim } }
      apply(s, { type: 'clip.look', sequenceId: seq.id, clipIds: [clip_id], patch })
      return done(`Animated ${property} with ${keys.length} keyframes.`)
    },
  }),
  t({
    name: 'add_title',
    description: 'Adds a text title above the picture.',
    schema: z.object({
      text: z.string().min(1),
      at: seconds,
      duration: z.number().positive().default(4),
      size: z.number().min(8).max(400).optional(),
      track: z.string().optional(),
    }),
    edits: true,
    run: (s, { text, at, duration, size, track }) => {
      const seq = seqOf(s)
      const videos = seq.tracks.filter((tr) => tr.kind === 'video')
      const frame = toFrames(s, at)
      const end = frame + toFrames(s, duration)
      const free = videos
        .slice(1)
        .find(
          (tr) =>
            !Object.values(seq.clips).some(
              (c) => c.trackId === tr.id && c.start < end && clipEnd(c) > frame,
            ),
        )
      let target = track ? trackByName(seq, track) : free
      if (!target) {
        target = {
          id: createId('trk'),
          kind: 'video',
          name: `V${videos.length + 1}`,
          locked: false,
          muted: false,
          solo: false,
          hidden: false,
          height: null,
          bus: { volume: 0, pan: 0, effects: [] },
          role: null,
        }
        apply(s, { type: 'track.add', sequenceId: seq.id, track: target })
      }
      const title = titleSchema.parse({
        text,
        ...(size ? { size } : {}),
        animateIn: 'fade',
        animateOut: 'fade',
        animateBy: 'all',
      })
      apply(
        s,
        generatorCommand(s.project, seqOf(s), 'title', frame, target.id, {
          title,
          name: 'Title',
          seconds: duration,
        }),
      )
      return done(`Added the title on ${target.name} at ${at}s.`)
    },
  }),
  t({
    name: 'generate_captions',
    description:
      'Transcribes the speech on the audio tracks with the local model and replaces the captions.',
    schema: z.object({ language: z.string().min(2).max(8).nullable().default(null) }),
    edits: true,
    run: async (s, { language }) => {
      const seq = seqOf(s)
      const audio = new Set(seq.tracks.filter((tr) => tr.kind === 'audio').map((tr) => tr.id))
      const transcripts = new Map<string, SourceWord[]>()
      for (const c of Object.values(seq.clips)) {
        const m = s.project.media[c.mediaId]
        if (!audio.has(c.trackId) || !m?.hasAudio || m.kind === 'sequence' || transcripts.has(m.id))
          continue
        transcripts.set(m.id, await s.services.transcribe(m, language))
      }
      const cues = cuesFromWords(wordsForSequence(s.project, seq, transcripts), fpsOf(s))
      apply(s, {
        type: 'captions.set',
        sequenceId: seq.id,
        captions: { ...seq.captions, cues, language },
      })
      return done(`Made ${cues.length} captions.`)
    },
  }),
  t({
    name: 'style_captions',
    description: 'Changes how captions look and whether they show in the viewer and exports.',
    schema: z.object({
      template: z.enum(CAPTION_TEMPLATES).optional(),
      size: z.number().min(12).max(200).optional(),
      position: z.number().min(0).max(1).optional().describe('0 top, 1 bottom'),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      highlight: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      uppercase: z.boolean().optional(),
      show: z.boolean().optional(),
    }),
    edits: true,
    run: (s, a) => {
      const seq = seqOf(s)
      const { show, ...style } = a
      const clean = Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined))
      apply(s, {
        type: 'captions.set',
        sequenceId: seq.id,
        captions: {
          ...seq.captions,
          style: { ...seq.captions.style, ...clean },
          ...(show !== undefined ? { show } : {}),
        },
      })
      return done('Caption style updated.')
    },
  }),
  t({
    name: 'set_caption_text',
    description:
      'Rewrites the text of captions by id, for corrections or translation. Timing stays.',
    schema: z.object({
      captions: z.array(z.object({ id: z.string(), text: z.string().min(1) })).min(1),
      language: z.string().optional(),
    }),
    edits: true,
    run: (s, { captions, language }) => {
      const seq = seqOf(s)
      const map = new Map(captions.map((c) => [c.id, c.text]))
      const cues = seq.captions.cues.map((c) =>
        map.has(c.id) ? { ...c, text: map.get(c.id)!, words: [] } : c,
      )
      apply(s, {
        type: 'captions.set',
        sequenceId: seq.id,
        captions: { ...seq.captions, cues, ...(language ? { language } : {}) },
      })
      return done(`Updated ${map.size} captions.`)
    },
  }),
  t({
    name: 'apply_color_preset',
    description: `Applies a built-in look to clips as a grade layer. Looks: ${LOOK_IDS.join(', ')}.`,
    schema: z.object({
      clip_ids: z.array(z.string()).min(1),
      look: z.enum(LOOK_IDS as [string, ...string[]]),
      intensity: z.number().min(0).max(1).default(1),
    }),
    edits: true,
    run: (s, { clip_ids, look, intensity }) => {
      const seq = seqOf(s)
      for (const id of clip_ids) {
        const c = clipById(seq, id)
        const layer = {
          id: createId('grd'),
          kind: 'lut' as const,
          enabled: true,
          mix: 1,
          primary: null,
          curves: null,
          lut: { source: `bundled:${look}`, intensity },
          qualifier: null,
        }
        apply(s, {
          type: 'clip.look',
          sequenceId: seq.id,
          clipIds: [id],
          patch: { grade: [...c.grade, layer] },
        })
      }
      return done(`Applied ${look}.`)
    },
  }),
  t({
    name: 'match_color',
    description: 'Matches the colour of a clip to a reference clip, as a primary grade layer.',
    schema: z.object({ clip_id: z.string(), reference_clip_id: z.string() }),
    edits: true,
    run: async (s, { clip_id, reference_clip_id }) => {
      const seq = seqOf(s)
      const c = clipById(seq, clip_id)
      const r = clipById(seq, reference_clip_id)
      const mid = (x: Clip) => (x.sourceIn + x.duration / 2) / fpsOf(s)
      const [target, ref] = [
        await s.services.stats(mediaOf(s, c), mid(c)),
        await s.services.stats(mediaOf(s, r), mid(r)),
      ]
      const layer = {
        id: createId('grd'),
        kind: 'primary' as const,
        enabled: true,
        mix: 1,
        primary: matchColor(target, ref),
        curves: null,
        lut: null,
        qualifier: null,
      }
      apply(s, {
        type: 'clip.look',
        sequenceId: seq.id,
        clipIds: [clip_id],
        patch: { grade: [...c.grade, layer] },
      })
      return done('Matched the colour.')
    },
  }),
  t({
    name: 'adjust_audio',
    description: `Sound of a clip (gain, volume, pan, fades in seconds, effects) or of a track (volume, pan, role). Sound effects: ${AUDIO_EFFECTS.join(', ')}.`,
    schema: z.object({
      clip_id: z.string().optional(),
      track: z.string().optional(),
      gain_db: z.number().min(-96).max(24).optional(),
      volume_db: z.number().min(-96).max(12).optional(),
      pan: z.number().min(-1).max(1).optional(),
      fade_in: z.number().min(0).optional(),
      fade_out: z.number().min(0).optional(),
      add_effects: z
        .array(
          z.object({
            type: z.enum(AUDIO_EFFECTS),
            params: z.record(z.string(), z.number()).default({}),
          }),
        )
        .optional(),
      role: z.enum(['dialogue', 'music', 'effects']).optional(),
    }),
    edits: true,
    run: (s, a) => {
      const seq = seqOf(s)
      const effects = (a.add_effects ?? []).map((e) => {
        const fx = createAudioEffect(e.type)
        return { ...fx, params: audioParams({ ...fx, params: { ...fx.params, ...e.params } }) }
      })
      if (a.track) {
        const tr = trackByName(seq, a.track)
        if (tr.kind !== 'audio') throw new ToolError(`${tr.name} is not an audio track.`)
        apply(s, {
          type: 'track.update',
          sequenceId: seq.id,
          trackId: tr.id,
          patch: {
            bus: {
              ...tr.bus,
              ...(a.volume_db !== undefined ? { volume: a.volume_db } : {}),
              ...(a.pan !== undefined ? { pan: a.pan } : {}),
              effects: [...tr.bus.effects, ...effects],
            },
            ...(a.role ? { role: a.role } : {}),
          },
        })
        return done(`Updated ${tr.name}.`)
      }
      if (!a.clip_id) throw new ToolError('Give clip_id or track.')
      let c = clipById(seq, a.clip_id)
      if (seq.tracks.find((tr) => tr.id === c.trackId)?.kind !== 'audio') {
        const sound = [...companions(seq, [c.id])]
          .map((id) => seq.clips[id]!)
          .find((x) => seq.tracks.find((tr) => tr.id === x.trackId)?.kind === 'audio')
        if (!sound) throw new ToolError('That clip has no sound.')
        c = sound
      }
      const fps = fpsOf(s)
      apply(s, {
        type: 'clip.look',
        sequenceId: seq.id,
        clipIds: [c.id],
        patch: {
          sound: {
            ...c.sound,
            ...(a.gain_db !== undefined ? { gain: a.gain_db } : {}),
            ...(a.volume_db !== undefined ? { volume: { value: a.volume_db, keys: [] } } : {}),
            ...(a.pan !== undefined ? { pan: a.pan } : {}),
            ...(a.fade_in !== undefined ? { fadeIn: Math.round(a.fade_in * fps) } : {}),
            ...(a.fade_out !== undefined ? { fadeOut: Math.round(a.fade_out * fps) } : {}),
            effects: [...c.sound.effects, ...effects],
          },
        },
      })
      return done('Updated the clip sound.')
    },
  }),
  t({
    name: 'duck_audio',
    description:
      'Lowers clips on music tracks while dialogue tracks speak. Names the tracks for each role first if given.',
    schema: z.object({
      dialogue_tracks: z.array(z.string()).optional(),
      music_tracks: z.array(z.string()).optional(),
      amount_db: z.number().min(-40).max(-1).default(-12),
    }),
    edits: true,
    run: async (s, { dialogue_tracks, music_tracks, amount_db }) => {
      const seq0 = seqOf(s)
      for (const [names, role] of [
        [dialogue_tracks, 'dialogue'],
        [music_tracks, 'music'],
      ] as const)
        for (const n of names ?? [])
          apply(s, {
            type: 'track.update',
            sequenceId: seq0.id,
            trackId: trackByName(seq0, n).id,
            patch: { role },
          })
      const seq = seqOf(s)
      const env = new Map<string, Envelope>()
      for (const c of Object.values(seq.clips)) {
        const tr = seq.tracks.find((x) => x.id === c.trackId)
        const m = s.project.media[c.mediaId]
        if (tr?.role === 'dialogue' && m?.hasAudio && !env.has(m.id))
          env.set(m.id, await s.services.waveform(m))
      }
      const cmd = duckCommand(s.project, seq, (id) => env.get(id), {
        ...DEFAULT_DUCK,
        amount: amount_db,
      })
      if (!cmd) return done('Nothing to duck: set a Dialogue and a Music track.')
      apply(s, cmd)
      return done('Ducked the music under the dialogue.')
    },
  }),
  t({
    name: 'normalize_loudness',
    description:
      'Sets the loudness exports are brought to: -14 (streaming), -16 (podcast), -23 (broadcast), or null to leave the mix as it is.',
    schema: z.object({ target_lufs: z.number().min(-40).max(-5).nullable() }),
    edits: true,
    run: (s, { target_lufs }) => {
      apply(s, { type: 'sequence.settings', sequenceId: seqOf(s).id, loudnessTarget: target_lufs })
      return done(
        target_lufs === null
          ? 'Loudness left as mixed.'
          : `Exports will be at ${target_lufs} LUFS.`,
      )
    },
  }),
  t({
    name: 'remove_silences',
    description:
      'Finds stretches quieter than a level for at least a length and removes them from every track, closing the gaps.',
    schema: z.object({
      min_seconds: z.number().min(0.1).max(10).default(0.7),
      threshold_db: z.number().min(-80).max(-15).default(-40),
    }),
    edits: true,
    run: async (s, { min_seconds, threshold_db }) => {
      const seq = seqOf(s)
      const found = await s.services.silences(s.project, seq.id, threshold_db, min_seconds)
      const total = sequenceDuration(seq) / fpsOf(s)
      const pad = 0.12
      const ranges = found
        .map(([a, b]): [number, number] => [
          toFrames(s, a <= 0.01 ? 0 : a + pad),
          toFrames(s, b >= total - 0.01 ? total : b - pad),
        ])
        .filter(([a, b]) => b > a)
      const cmd = removeRangesCommand(seq, ranges, 'Remove silences')
      if (!cmd) return done('No silences that long were found.')
      apply(s, cmd)
      return done(
        `Silences removed: ${ranges.length}, ${toSeconds(
          s,
          ranges.reduce((n, [a, b]) => n + b - a, 0),
        )} s in all.`,
      )
    },
  }),
  t({
    name: 'remove_filler_words',
    description: 'Removes um, uh and similar words found in the captions, from every track.',
    schema: z.object({}),
    edits: true,
    run: (s) => {
      const seq = seqOf(s)
      const ranges = fillerRanges(seq.captions)
      const cmd = removeRangesCommand(seq, ranges, 'Remove filler words')
      if (!cmd)
        return done('No filler words in the captions. Generate captions first if there are none.')
      apply(s, cmd)
      return done(`Filler words removed: ${ranges.length}.`)
    },
  }),
  t({
    name: 'add_marker',
    description: 'Adds a named marker at a time.',
    schema: z.object({
      time: seconds,
      name: z.string().default(''),
      color: z.enum(MARKER_COLORS).default('blue'),
      note: z.string().default(''),
    }),
    edits: true,
    run: (s, { time, name, color, note }) => {
      apply(s, {
        type: 'marker.add',
        sequenceId: seqOf(s).id,
        marker: { id: createId('mrk'), frame: toFrames(s, time), name, note, color },
      })
      return done(`Marker added at ${time}s.`)
    },
  }),
  t({
    name: 'reframe',
    description:
      'Changes the sequence to another shape (9:16, 1:1, 4:5, 16:9) and scales every video clip to fill it, centred.',
    schema: z.object({ aspect: z.enum(['9:16', '1:1', '4:5', '16:9']) }),
    edits: true,
    run: (s, { aspect }) => {
      const seq = seqOf(s)
      const [aw, ah] = aspect.split(':').map(Number) as [number, number]
      const long = Math.max(seq.width, seq.height)
      const width = aw >= ah ? long : Math.round((long * aw) / ah / 2) * 2
      const height = aw >= ah ? Math.round((long * ah) / aw / 2) * 2 : long
      apply(s, { type: 'sequence.settings', sequenceId: seq.id, width, height })
      const next = seqOf(s)
      for (const c of Object.values(next.clips)) {
        const m = s.project.media[c.mediaId]
        if (
          next.tracks.find((tr) => tr.id === c.trackId)?.kind !== 'video' ||
          !m?.width ||
          !m.height
        )
          continue
        // Clips fit inside the frame by default; scale up so they cover it instead.
        const fit = Math.min(width / m.width, height / m.height)
        const cover = Math.max(width / m.width, height / m.height)
        const k = cover / fit
        apply(s, {
          type: 'clip.look',
          sequenceId: next.id,
          clipIds: [c.id],
          patch: {
            transform: {
              ...c.transform,
              scaleX: { value: k, keys: [] },
              scaleY: { value: k, keys: [] },
            },
          },
        })
      }
      return done(`The sequence is now ${width}x${height}.`)
    },
  }),
  t({
    name: 'export',
    description:
      'Exports the sequence to an MP4 file. In the editor this starts once the changes are applied.',
    schema: z.object({ path: z.string().optional().describe('Where to save; required over MCP') }),
    edits: false,
    run: async (s, { path }) => {
      if (s.services.exportTo) {
        if (!path) throw new ToolError('Give a path ending in .mp4.')
        return done(`Exporting to ${await s.services.exportTo(s.project, seqOf(s).id, path)}.`)
      }
      s.exportAfterApply = true
      return done('The export will start when the changes are applied.')
    },
  }),
]

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]))

/** Tool definitions with JSON Schema parameters, for model APIs and MCP. */
export function toolSpecs(): {
  name: string
  description: string
  parameters: Record<string, unknown>
}[] {
  return TOOLS.map((tool) => {
    const schema = z.toJSONSchema(tool.schema, { io: 'input' }) as Record<string, unknown>
    delete schema['$schema']
    return { name: tool.name, description: tool.description, parameters: schema }
  })
}

export const isEditTool = (name: string) => BY_NAME.get(name)?.edits ?? false

/** Runs a tool; bad arguments and refused edits come back as text for the model to read. */
export async function runTool(
  s: ToolSession,
  name: string,
  args: unknown,
): Promise<ToolResult & { error?: boolean }> {
  const tool = BY_NAME.get(name)
  if (!tool) return { text: `There is no tool named ${name}.`, error: true }
  const parsed = tool.schema.safeParse(args ?? {})
  if (!parsed.success)
    return {
      text: `The arguments were not valid: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`,
      error: true,
    }
  try {
    return await tool.run(s, parsed.data)
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), error: true }
  }
}
