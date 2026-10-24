import {
  memo,
  useEffect,
  useRef,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { EFFECT_DRAG, TRANSITION_DRAG } from '../Library'
import type { Clip, MediaAsset, Sequence } from '@engine/model'
import { averageSpeed } from '@engine/speed'
import { formatTimecode, framesToSeconds } from '@engine/time'
import { t } from '../../i18n'
import { useThumbnail, useWaveform } from '../../lib/media-cache'
import type { DragPreview } from './interactions'
import { SoundOverlay } from './SoundOverlay'
import styles from './Timeline.module.css'

/** Where a clip is drawn, with any drag preview applied. */
function previewed(clip: Clip, preview: DragPreview | null): { start: number; duration: number } {
  if (preview?.kind === 'move' && preview.ids.has(clip.id))
    return { start: Math.max(0, clip.start + preview.delta), duration: clip.duration }
  if (preview?.kind === 'trim' && preview.ids.has(clip.id)) {
    if (preview.edge === 'start')
      return { start: clip.start + preview.delta, duration: clip.duration - preview.delta }
    return { start: clip.start, duration: clip.duration + preview.delta }
  }
  return { start: clip.start, duration: clip.duration }
}

export const ClipView = memo(function ClipView({
  clip,
  asset,
  sequence,
  pxPerFrame,
  selected,
  preview,
  onPointerDown,
  onDropLook,
  keyFrames,
  laneHeight,
  locked = false,
}: {
  clip: Clip
  asset: MediaAsset | undefined
  sequence: Sequence
  pxPerFrame: number
  selected: boolean
  preview: DragPreview | null
  onPointerDown: (e: ReactPointerEvent, clip: Clip) => void
  /** Handles effects and transitions dropped on the clip; returns true if it took the drop. */
  onDropLook?: ((e: DragEvent, clip: Clip) => boolean) | undefined
  /** Keyframe positions (clip frames) to mark, for the selected clip. */
  keyFrames?: number[] | null
  /** Height of the track lane, for drawing fades and level over audio clips. */
  laneHeight?: number
  locked?: boolean
}) {
  const { start, duration } = previewed(clip, preview)
  const thumb = useThumbnail(asset?.kind === 'sequence' ? undefined : asset)
  const left = start * pxPerFrame
  const width = Math.max(2, duration * pxPerFrame)
  const kind = asset?.kind ?? 'video'
  const onAudioTrack = sequence.tracks.find((tr) => tr.id === clip.trackId)?.kind === 'audio'
  const speed = averageSpeed(clip)
  const badges: string[] = []
  if (clip.ramp) badges.push(t('timeline.badge.ramp'))
  else if (clip.speed === 0) badges.push(t('timeline.badge.hold'))
  else if (Math.abs(speed - 1) > 0.001) badges.push(`${Math.round(speed * 100)}%`)
  if (clip.reverse) badges.push(t('timeline.badge.reverse'))
  if (clip.angle !== null) badges.push(t('timeline.badge.angle', { n: clip.angle + 1 }))
  const label = preview?.kind === 'label' && preview.clipId === clip.id ? preview.text : null

  return (
    <div
      role="listitem"
      className={styles.clip}
      data-kind={onAudioTrack ? 'audio' : kind}
      data-selected={selected}
      data-dragging={preview !== null && 'ids' in preview && preview.ids.has(clip.id)}
      data-grouped={clip.groupId !== null}
      style={{ transform: `translateX(${left}px)`, width }}
      onPointerDown={(e) => onPointerDown(e, clip)}
      onDragOver={(e) => {
        if (
          onDropLook &&
          (e.dataTransfer.types.includes(EFFECT_DRAG) ||
            e.dataTransfer.types.includes(TRANSITION_DRAG))
        ) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      onDrop={(e) => onDropLook?.(e, clip)}
      aria-label={t('timeline.clipLabel', {
        name: asset?.name ?? '',
        start: formatTimecode(start, sequence.fps),
        duration: formatTimecode(duration, sequence.fps),
      })}
      aria-current={selected ? 'true' : undefined}
    >
      {thumb && !onAudioTrack ? (
        <div className={styles.filmstrip} style={{ backgroundImage: `url("${thumb}")` }} />
      ) : null}
      <span className={styles.clipName}>
        {clip.title ? clip.title.text.split('\n')[0] : (asset?.name ?? t('timeline.missingMedia'))}
        {badges.map((b) => (
          <span key={b} className={styles.badge}>
            {b}
          </span>
        ))}
      </span>
      {label ? <span className={`${styles.dragLabel} tabular`}>{label}</span> : null}
      {keyFrames?.length ? (
        <span className={styles.keys} aria-hidden="true">
          {keyFrames.map((k) => (
            <span
              key={k}
              className={styles.keyTick}
              style={{ left: (k - (start - clip.start)) * pxPerFrame }}
            />
          ))}
        </span>
      ) : null}
      {onAudioTrack && asset?.hasAudio && asset.kind !== 'sequence' ? (
        <Waveform asset={asset} clip={clip} duration={duration} width={width} sequence={sequence} />
      ) : null}
      {onAudioTrack && laneHeight ? (
        <SoundOverlay
          clip={clip}
          sequence={sequence}
          name={asset?.name ?? ''}
          width={width}
          height={laneHeight - 4}
          visibleFrom={start - clip.start}
          pxPerFrame={pxPerFrame}
          locked={locked}
        />
      ) : null}
    </div>
  )
})

function Waveform({
  asset,
  clip,
  duration,
  width,
  sequence,
}: {
  asset: MediaAsset
  clip: Clip
  duration: number
  width: number
  sequence: Sequence
}) {
  const wave = useWaveform(asset)
  const ref = useRef<HTMLCanvasElement>(null)
  const height = 30
  const drawWidth = Math.min(width, 8000)
  const span = duration * averageSpeed(clip)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !wave) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.ceil(drawWidth * dpr)
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.fillStyle = 'rgb(255 255 255 / 0.6)'
    const from = framesToSeconds(clip.sourceIn, sequence.fps) * wave.rate
    const count = framesToSeconds(span, sequence.fps) * wave.rate
    const mid = height / 2
    for (let x = 0; x < drawWidth; x++) {
      const k = clip.reverse ? 1 - (x + 1) / drawWidth : x / drawWidth
      const a = Math.floor(from + k * count)
      const b = Math.max(a + 1, Math.floor(from + (k + 1 / drawWidth) * count))
      let peak = 0
      for (let i = a; i < b && i < wave.peaks.length; i++) peak = Math.max(peak, wave.peaks[i]!)
      const h = Math.max(0.5, (peak / 255) * mid)
      ctx.fillRect(x, mid - h, 1, h * 2)
    }
  }, [wave, clip.sourceIn, clip.reverse, span, drawWidth, sequence.fps])

  return (
    <canvas
      ref={ref}
      className={styles.wave}
      style={{ width: drawWidth, height }}
      aria-hidden="true"
    />
  )
}
