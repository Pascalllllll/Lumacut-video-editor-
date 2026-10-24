import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { levelAt } from '@engine/audio'
import type { Clip, ClipSound, Sequence } from '@engine/model'
import { t } from '../../i18n'
import { useProject } from '../../state/project'
import styles from './Timeline.module.css'

/** The volume line spans +12 dB at the top of the clip to -60 dB at the bottom. */
const TOP_DB = 12
const BOTTOM_DB = -60
const yOf = (db: number, h: number) =>
  ((TOP_DB - Math.min(TOP_DB, Math.max(BOTTOM_DB, db))) / (TOP_DB - BOTTOM_DB)) * h
const dbOf = (y: number, h: number) => TOP_DB - (y / h) * (TOP_DB - BOTTOM_DB)

type Draft = Partial<Pick<ClipSound, 'fadeIn' | 'fadeOut'>> & { level?: number }

/**
 * Fades and level drawn over an audio clip: drag a top corner to fade in or
 * out, drag the line to change the clip's volume. While the volume has
 * keyframes the line follows them and is edited in the inspector.
 */
export function SoundOverlay({
  clip,
  sequence,
  name,
  width,
  height,
  visibleFrom,
  pxPerFrame,
  locked,
}: {
  clip: Clip
  sequence: Sequence
  name: string
  width: number
  height: number
  /** Clip frame at the overlay's left edge (non-zero while a trim is previewed). */
  visibleFrom: number
  pxPerFrame: number
  locked: boolean
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const sound: ClipSound = { ...clip.sound, ...draft }
  if (draft?.level !== undefined) sound.volume = { value: draft.level, keys: [] }
  const animated = clip.sound.volume.keys.length > 0
  const fadeInPx = sound.fadeIn * pxPerFrame
  const fadeOutPx = sound.fadeOut * pxPerFrame

  const commit = (patch: Partial<ClipSound>) =>
    useProject.getState().dispatch({
      type: 'clip.look',
      sequenceId: sequence.id,
      clipIds: [clip.id],
      patch: { sound: { ...clip.sound, ...patch } },
    })

  const dragFade = (edge: 'in' | 'out') => (e: ReactPointerEvent) => {
    if (e.button !== 0 || locked) return
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const startFrames = edge === 'in' ? clip.sound.fadeIn : clip.sound.fadeOut
    const other = edge === 'in' ? clip.sound.fadeOut : clip.sound.fadeIn
    const max = Math.max(0, clip.duration - other)
    let value = startFrames
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / pxPerFrame
      value = Math.round(Math.min(max, Math.max(0, startFrames + (edge === 'in' ? dx : -dx))))
      setDraft(edge === 'in' ? { fadeIn: value } : { fadeOut: value })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDraft(null)
      if (value !== startFrames) commit(edge === 'in' ? { fadeIn: value } : { fadeOut: value })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Arrow-key nudges show at once and land as one change when the keys go quiet.
  const nudge = useRef<{ timer: number; patch: Partial<ClipSound> | null }>({
    timer: 0,
    patch: null,
  })
  const onFadeKey = (e: KeyboardEvent<SVGRectElement>) => {
    const edge = e.currentTarget.dataset['edge'] === 'out' ? 'out' : 'in'
    const step = e.shiftKey ? 10 : 1
    const cur = edge === 'in' ? sound.fadeIn : sound.fadeOut
    const other = edge === 'in' ? clip.sound.fadeOut : clip.sound.fadeIn
    const grow = edge === 'in' ? 'ArrowRight' : 'ArrowLeft'
    const shrink = edge === 'in' ? 'ArrowLeft' : 'ArrowRight'
    if (e.key !== grow && e.key !== shrink) return
    e.preventDefault()
    e.stopPropagation()
    const next = Math.min(clip.duration - other, Math.max(0, cur + (e.key === grow ? step : -step)))
    const patch = edge === 'in' ? { fadeIn: next } : { fadeOut: next }
    setDraft(patch)
    nudge.current.patch = patch
    window.clearTimeout(nudge.current.timer)
    nudge.current.timer = window.setTimeout(() => {
      const pending = nudge.current.patch
      nudge.current.patch = null
      setDraft(null)
      if (pending) commit(pending)
    }, 400)
  }

  const dragLevel = (e: ReactPointerEvent) => {
    if (e.button !== 0 || locked || animated) return
    e.stopPropagation()
    e.preventDefault()
    const box = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect()
    let value = clip.sound.volume.value
    const move = (ev: PointerEvent) => {
      value =
        Math.round(Math.max(BOTTOM_DB, Math.min(TOP_DB, dbOf(ev.clientY - box.top, height))) * 2) /
        2
      setDraft({ level: value })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDraft(null)
      if (value !== clip.sound.volume.value) commit({ volume: { value, keys: [] } })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // The level line, sampled every few pixels so keyframed curves read as curves.
  const points: string[] = []
  const step = Math.max(2, Math.min(12, width / 60))
  for (let x = 0; x <= width + 0.01; x += step) {
    const f = visibleFrom + Math.min(width, x) / pxPerFrame
    points.push(`${Math.min(width, x).toFixed(1)},${yOf(levelAt(sound, f), height).toFixed(1)}`)
  }
  const level = levelAt(sound, visibleFrom)
  const inEnd = fadeInPx - visibleFrom * pxPerFrame
  const outStart = width - fadeOutPx

  return (
    <svg className={styles.sound} width={width} height={height} aria-hidden={false}>
      {sound.fadeIn > 0 && inEnd > 0 ? (
        <path
          className={styles.fadeShade}
          d={`M0,0 L${inEnd},0 L0,${height} Z`}
          transform={visibleFrom ? `translate(${-visibleFrom * pxPerFrame},0)` : undefined}
        />
      ) : null}
      {sound.fadeOut > 0 ? (
        <path className={styles.fadeShade} d={`M${outStart},0 L${width},0 L${width},${height} Z`} />
      ) : null}
      <polyline className={styles.levelLine} points={points.join(' ')} />
      {!animated ? (
        <polyline
          className={styles.levelHit}
          points={points.join(' ')}
          onPointerDown={dragLevel}
          role="img"
          aria-label={t('timeline.volumeLine', { name })}
        >
          <title>{`${level >= 0 ? '+' : ''}${level.toFixed(1)} dB`}</title>
        </polyline>
      ) : null}
      {draft?.level !== undefined ? (
        <text className={styles.levelText} x={6} y={Math.max(10, yOf(level, height) - 4)}>
          {`${level >= 0 ? '+' : ''}${level.toFixed(1)} dB`}
        </text>
      ) : null}
      {width > 24 ? (
        <>
          <rect
            className={styles.fadeHandle}
            x={Math.max(0, Math.min(width - 8, inEnd - 4))}
            y={0}
            width={8}
            height={8}
            tabIndex={locked ? -1 : 0}
            role="slider"
            aria-label={t('timeline.fadeIn', { name })}
            aria-valuemin={0}
            aria-valuemax={clip.duration}
            aria-valuenow={sound.fadeIn}
            onPointerDown={dragFade('in')}
            data-edge="in"
            onKeyDown={onFadeKey}
          />
          <rect
            className={styles.fadeHandle}
            x={Math.max(0, Math.min(width - 8, outStart - 4))}
            y={0}
            width={8}
            height={8}
            tabIndex={locked ? -1 : 0}
            role="slider"
            aria-label={t('timeline.fadeOut', { name })}
            aria-valuemin={0}
            aria-valuemax={clip.duration}
            aria-valuenow={sound.fadeOut}
            onPointerDown={dragFade('out')}
            data-edge="out"
            onKeyDown={onFadeKey}
          />
        </>
      ) : null}
    </svg>
  )
}
