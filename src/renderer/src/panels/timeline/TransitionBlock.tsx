import type { Sequence, Transition } from '@engine/model'
import { formatTimecode } from '@engine/time'
import { clipEnd } from '@engine/timeline'
import { t, td } from '../../i18n'
import { useProject } from '../../state/project'
import styles from './Timeline.module.css'

/** Where a transition sits: centred on its cut, or at the open end of a single clip. */
export function transitionSpan(
  seq: Sequence,
  tr: Transition,
): { start: number; duration: number } | null {
  const left = tr.leftClipId ? seq.clips[tr.leftClipId] : undefined
  const right = tr.rightClipId ? seq.clips[tr.rightClipId] : undefined
  if (left && right)
    return { start: right.start - Math.floor(tr.duration / 2), duration: tr.duration }
  if (right) return { start: right.start, duration: tr.duration }
  if (left) return { start: clipEnd(left) - tr.duration, duration: tr.duration }
  return null
}

export function TransitionBlock({
  transition,
  sequence,
  pxPerFrame,
}: {
  transition: Transition
  sequence: Sequence
  pxPerFrame: number
}) {
  const selected = useProject((s) => s.selectedTransition === transition.id)
  const span = transitionSpan(sequence, transition)
  if (!span) return null
  const name = td(`transition.name.${transition.type}`)
  return (
    <button
      type="button"
      className={styles.transition}
      data-selected={selected}
      style={{ left: span.start * pxPerFrame, width: Math.max(8, span.duration * pxPerFrame) }}
      aria-label={t('timeline.transitionLabel', {
        name,
        length: formatTimecode(span.duration, sequence.fps),
      })}
      title={name}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() =>
        useProject.setState({
          selectedTransition: transition.id,
          selection: [],
          selectedMarker: null,
        })
      }
    >
      <span className={styles.transitionName}>{name}</span>
    </button>
  )
}
