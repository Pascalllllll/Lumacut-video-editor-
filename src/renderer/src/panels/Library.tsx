import { useMemo, useState } from 'react'
import { createEffect, EFFECTS } from '@engine/effects'
import { generatorCommand, nearestCut, transitionCommand } from '@engine/edits'
import {
  activeSequence,
  createTrack,
  titleSchema,
  TRANSITIONS,
  type Clip,
  type Title,
  type Transform,
} from '@engine/model'
import { clipEnd, videoTracks } from '@engine/timeline'
import { fpsValue } from '@engine/time'
import { t, td } from '../i18n'
import { notify } from '../state/notices'
import { usePlayhead } from '../state/playhead'
import { useProject } from '../state/project'
import styles from './Library.module.css'

export const EFFECT_DRAG = 'application/x-lumacut-effect'
export const TRANSITION_DRAG = 'application/x-lumacut-transition'
export const GENERATOR_DRAG = 'application/x-lumacut-generator'

export type GeneratorItem = { kind: 'title' | 'color' | 'adjustment'; template: string }

/** Ready-made title looks; position offsets are fractions of the frame. */
const TITLE_TEMPLATES: Record<string, { title: Partial<Title>; x?: number; y?: number }> = {
  basic: { title: {} },
  headline: {
    title: { size: 160, weight: 800, animateIn: 'rise', animateOut: 'fade', animateBy: 'word' },
  },
  'lower-third': {
    title: {
      size: 54,
      weight: 600,
      align: 'left',
      box: { enabled: true, color: '#000000', opacity: 0.6, padding: 20, radius: 6 },
      animateIn: 'fade',
      animateOut: 'fade',
      animateBy: 'all',
    },
    x: -0.22,
    y: 0.33,
  },
  subtitle: {
    title: {
      size: 46,
      weight: 500,
      box: { enabled: true, color: '#000000', opacity: 0.5, padding: 12, radius: 4 },
    },
    y: 0.38,
  },
  typewriter: {
    title: {
      size: 72,
      weight: 500,
      font: 'Courier New',
      animateIn: 'typewriter',
      animateBy: 'character',
      animateFrames: 40,
    },
  },
  outline: {
    title: {
      size: 140,
      weight: 900,
      fill: { kind: 'solid', color: '#ffffff', color2: '#ffffff', angle: 90 },
      stroke: { width: 6, color: '#111111' },
      animateIn: 'scale',
      animateBy: 'character',
    },
  },
  gradient: {
    title: {
      size: 140,
      weight: 800,
      fill: { kind: 'gradient', color: '#ffd37a', color2: '#ff6a88', angle: 90 },
      animateIn: 'blur',
      animateBy: 'all',
    },
  },
}

const GENERATORS: GeneratorItem[] = [
  ...Object.keys(TITLE_TEMPLATES).map((template) => ({ kind: 'title' as const, template })),
  { kind: 'color', template: 'black' },
  { kind: 'color', template: 'white' },
  { kind: 'adjustment', template: 'adjustment' },
]

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** Builds the command that places a generator item on a track at a frame. */
export function generatorPlacement(item: GeneratorItem, trackId: string, start: number) {
  const state = useProject.getState()
  const project = state.history.project
  const seq = activeSequence(project)
  const tpl = TITLE_TEMPLATES[item.template]
  const cmd = generatorCommand(project, seq, item.kind, start, trackId, {
    name: td(`generator.kind.${item.kind}`),
    ...(item.kind === 'title'
      ? { title: titleSchema.parse({ text: t('generator.sampleText'), ...(tpl?.title ?? {}) }) }
      : {}),
    ...(item.kind === 'color' ? { color: item.template === 'white' ? '#ffffff' : '#000000' } : {}),
  })
  // Templates that sit somewhere other than the centre get a position.
  if (tpl && (tpl.x || tpl.y)) {
    const add =
      cmd.type === 'clip.add'
        ? cmd
        : cmd.type === 'batch'
          ? cmd.commands.find((c) => c.type === 'clip.add')
          : undefined
    if (add?.type === 'clip.add') {
      const clip = add.clips[0]!
      const transform: Transform = {
        ...clip.transform,
        x: { value: (tpl.x ?? 0) * seq.width, keys: [] },
        y: { value: (tpl.y ?? 0) * seq.height, keys: [] },
      }
      add.clips[0] = { ...clip, transform }
    }
  }
  return cmd
}

/** Puts a generator at the playhead on the lowest video track above V1 with room for it, adding a track if needed. */
export function addGenerator(item: GeneratorItem) {
  const state = useProject.getState()
  const seq = activeSequence(state.history.project)
  const at = usePlayhead.getState().frame
  const length = Math.round(5 * fpsValue(seq.fps))
  const free = (trackId: string) =>
    !Object.values(seq.clips).some(
      (c) => c.trackId === trackId && c.start < at + length && clipEnd(c) > at,
    )
  const tracks = videoTracks(seq)
  let track =
    tracks.slice(1).find((tr) => !tr.locked && free(tr.id)) ??
    (tracks.length === 1 && free(tracks[0]!.id) && item.kind !== 'adjustment'
      ? tracks[0]
      : undefined)
  try {
    if (!track) {
      track = createTrack('video', `V${tracks.length + 1}`)
      state.dispatch({
        type: 'batch',
        label: t('history.addGenerator'),
        commands: [
          { type: 'track.add', sequenceId: seq.id, track },
          generatorPlacement(item, track.id, at),
        ],
      })
    } else {
      state.dispatch(generatorPlacement(item, track.id, at))
    }
  } catch (error) {
    notify('error', message(error))
  }
}

/** Adds an effect to every selected clip on a video track. */
export function applyEffectToSelection(type: string) {
  const state = useProject.getState()
  const seq = activeSequence(state.history.project)
  const clips = state.selection
    .map((id) => seq.clips[id])
    .filter(
      (c): c is Clip =>
        Boolean(c) && seq.tracks.find((tr) => tr.id === c!.trackId)?.kind === 'video',
    )
  if (clips.length === 0) {
    notify('error', t('library.selectClip'))
    return
  }
  state.dispatch({
    type: 'batch',
    label: t('history.addEffect'),
    commands: clips.map((c) => ({
      type: 'clip.look',
      sequenceId: seq.id,
      clipIds: [c.id],
      patch: { effects: [...c.effects, createEffect(type)] },
    })),
  })
}

/** Adds a transition at the cut nearest the playhead on the target video track (Ctrl+D uses cross dissolve). */
export function applyTransitionAtPlayhead(type: (typeof TRANSITIONS)[number] = 'cross-dissolve') {
  const state = useProject.getState()
  const seq = activeSequence(state.history.project)
  const trackId = seq.targets.video ?? videoTracks(seq)[0]?.id
  if (!trackId) return
  const cut = nearestCut(seq, trackId, usePlayhead.getState().frame)
  if (!cut) {
    notify('error', t('library.noCut'))
    return
  }
  try {
    state.dispatch(
      transitionCommand(seq, cut.clipId, cut.edge, type, Math.round(fpsValue(seq.fps))),
    )
  } catch (error) {
    notify('error', message(error))
  }
}

export function Library({ kind }: { kind: 'effects' | 'transitions' | 'generators' }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const items = useMemo(() => {
    if (kind === 'effects')
      return EFFECTS.map((e) => ({
        id: e.type,
        name: td(`effect.${e.type}`),
        group: td(`effectGroup.${e.category}`),
      }))
    if (kind === 'transitions')
      return TRANSITIONS.map((tr) => ({ id: tr, name: td(`transition.name.${tr}`), group: '' }))
    return GENERATORS.map((g) => ({
      id: `${g.kind}:${g.template}`,
      name: td(`generator.${g.kind}.${g.template}`),
      group: td(`generator.kind.${g.kind}`),
    }))
  }, [kind])
  const shown = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items
  const groups = [...new Set(shown.map((i) => i.group))]

  return (
    <div className={styles.library}>
      <input
        type="search"
        className={styles.search}
        placeholder={td(`library.search.${kind}`)}
        aria-label={td(`library.search.${kind}`)}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className={styles.hint}>{td(`library.hint.${kind}`)}</p>
      {shown.length === 0 ? <p className={styles.hint}>{t('media.noMatch', { query })}</p> : null}
      {groups.map((group) => (
        <div key={group || 'all'}>
          {group ? <h3 className={styles.group}>{group}</h3> : null}
          <ul className={styles.list} aria-label={group || td(`library.tab.${kind}`)}>
            {shown
              .filter((i) => i.group === group)
              .map((item) => (
                <li
                  key={item.id}
                  className={styles.item}
                  tabIndex={0}
                  draggable
                  aria-label={item.name}
                  onDragStart={(e) => {
                    const type =
                      kind === 'effects'
                        ? EFFECT_DRAG
                        : kind === 'transitions'
                          ? TRANSITION_DRAG
                          : GENERATOR_DRAG
                    const [genKind, template] = item.id.split(':')
                    e.dataTransfer.setData(
                      type,
                      kind === 'generators' ? JSON.stringify({ kind: genKind, template }) : item.id,
                    )
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onDoubleClick={() => activate(kind, item.id)}
                  onKeyDown={(e) => e.key === 'Enter' && activate(kind, item.id)}
                >
                  <span className={styles.swatch} data-kind={kind} aria-hidden="true" />
                  {item.name}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function activate(kind: 'effects' | 'transitions' | 'generators', id: string) {
  if (kind === 'effects') return applyEffectToSelection(id)
  if (kind === 'transitions') return applyTransitionAtPlayhead(id as (typeof TRANSITIONS)[number])
  const [genKind, template] = id.split(':') as [GeneratorItem['kind'], string]
  addGenerator({ kind: genKind, template })
}
