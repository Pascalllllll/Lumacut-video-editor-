import { ChevronLeft, ChevronRight, Diamond } from 'lucide-react'
import { evaluate } from '@engine/animation'
import {
  adjacentKey,
  getAnimated,
  samePath,
  setParam,
  toggleKey,
  type ParamPath,
} from '@engine/look'
import type { Clip, Sequence } from '@engine/model'
import { t } from '../../i18n'
import { NumberField } from '../../components/NumberField'
import { useEditor } from '../../state/editor'
import { usePlayhead } from '../../state/playhead'
import { useProject } from '../../state/project'
import styles from './Look.module.css'

/** Clip-relative frame under the playhead, kept inside the clip. */
export function useClipFrame(clip: Clip): number {
  const frame = usePlayhead((s) => s.frame)
  return Math.min(Math.max(frame - clip.start, 0), clip.duration - 1)
}

type Props = {
  clip: Clip
  sequence: Sequence
  path: ParamPath
  label: string
  min?: number
  max?: number
  step?: number
  unit?: string
  display?: number
  precision?: number
}

/** One animatable number: keyframe button, value, and jumps to the previous and next key. */
export function ParamRow({ clip, sequence, path, label, ...field }: Props) {
  const frame = useClipFrame(clip)
  const anim = getAnimated(clip, path)
  const selected = useEditor(
    (s) =>
      s.selectedParam && s.selectedParam.clipId === clip.id && samePath(s.selectedParam.path, path),
  )
  if (!anim) return null
  const animated = anim.keys.length > 0
  const onKey = anim.keys.some((k) => k.frame === frame)
  const dispatch = (patch: object) =>
    useProject
      .getState()
      .dispatch({ type: 'clip.look', sequenceId: sequence.id, clipIds: [clip.id], patch })
  const jump = (dir: 1 | -1) => {
    const k = adjacentKey(anim, frame, dir)
    if (k !== null) usePlayhead.getState().seek(clip.start + k)
  }

  return (
    <div className={styles.param} data-selected={selected}>
      <button
        type="button"
        className={styles.keyButton}
        data-state={onKey ? 'on' : animated ? 'animated' : 'off'}
        aria-pressed={onKey}
        aria-label={
          animated
            ? onKey
              ? t('look.removeKey', { name: label })
              : t('look.addKey', { name: label })
            : t('look.animate', { name: label })
        }
        title={
          animated
            ? onKey
              ? t('look.removeKey', { name: label })
              : t('look.addKey', { name: label })
            : t('look.animate', { name: label })
        }
        onClick={() => {
          dispatch(toggleKey(clip, path, frame))
          useEditor.setState({ selectedParam: { clipId: clip.id, path } })
        }}
      >
        <Diamond size={11} strokeWidth={2} />
      </button>
      <button
        type="button"
        className={styles.paramLabel}
        onClick={() => useEditor.setState({ selectedParam: { clipId: clip.id, path } })}
        title={t('look.showGraph')}
      >
        {label}
      </button>
      {animated ? (
        <span className={styles.nav}>
          <button type="button" aria-label={t('look.prevKey')} onClick={() => jump(-1)}>
            <ChevronLeft size={12} strokeWidth={2} />
          </button>
          <button type="button" aria-label={t('look.nextKey')} onClick={() => jump(1)}>
            <ChevronRight size={12} strokeWidth={2} />
          </button>
        </span>
      ) : null}
      <NumberField
        label={label}
        value={evaluate(anim, frame)}
        onChange={(v) => dispatch(setParam(clip, path, frame, v))}
        {...field}
      />
    </div>
  )
}
