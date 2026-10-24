import { memo, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Sequence } from '@engine/model'
import { formatTimecode, fpsValue } from '@engine/time'
import { t } from '../../i18n'
import { usePlayhead } from '../../state/playhead'
import { useProject } from '../../state/project'
import { RULER_H } from './geometry'
import styles from './Timeline.module.css'

export const Ruler = memo(function Ruler({
  pxPerFrame,
  sequence,
  width,
  onPointerDown,
}: {
  pxPerFrame: number
  sequence: Sequence
  width: number
  onPointerDown: (e: ReactPointerEvent) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const selectedMarker = useProject((s) => s.selectedMarker)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.min(32000, Math.ceil(width * dpr))
    canvas.height = RULER_H * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    const css = getComputedStyle(canvas)
    ctx.strokeStyle = css.getPropertyValue('--separator-strong')
    ctx.fillStyle = css.getPropertyValue('--text-tertiary')
    ctx.font = `11px ${css.getPropertyValue('--font-ui')}`
    ctx.textBaseline = 'top'
    const fps = fpsValue(sequence.fps)
    const pxPerSecond = pxPerFrame * fps
    const steps = [
      1 / fps,
      2 / fps,
      5 / fps,
      10 / fps,
      0.5,
      1,
      2,
      5,
      10,
      15,
      30,
      60,
      120,
      300,
      600,
      1800,
    ]
    const major = steps.find((s) => s * pxPerSecond >= 90) ?? 3600
    const minor = major / (major >= 1 ? 5 : 2)
    ctx.beginPath()
    for (let s = 0; s * pxPerSecond < width; s += minor) {
      const x = Math.round(s * pxPerSecond) + 0.5
      const isMajor = Math.abs(s / major - Math.round(s / major)) < 1e-6
      ctx.moveTo(x, isMajor ? 14 : 21)
      ctx.lineTo(x, RULER_H)
      if (isMajor) {
        const frames = Math.round(s * fps)
        const label =
          major < 1
            ? formatTimecode(frames, sequence.fps).slice(3)
            : formatTimecode(frames, sequence.fps).slice(0, 8)
        ctx.fillText(label, x + 4, 3)
      }
    }
    ctx.stroke()
  }, [pxPerFrame, sequence.fps, width])

  const range =
    sequence.inPoint !== null || sequence.outPoint !== null
      ? {
          left: (sequence.inPoint ?? 0) * pxPerFrame,
          right: (sequence.outPoint ?? width / pxPerFrame) * pxPerFrame,
        }
      : null

  return (
    <div className={styles.rulerWrap} style={{ width, height: RULER_H }}>
      <canvas
        ref={ref}
        className={styles.ruler}
        style={{ width, height: RULER_H }}
        onPointerDown={onPointerDown}
      />
      {range ? (
        <div
          className={styles.rangeBar}
          style={{ left: range.left, width: Math.max(1, range.right - range.left) }}
          aria-label={t('timeline.range', {
            from: formatTimecode(sequence.inPoint ?? 0, sequence.fps),
            to:
              sequence.outPoint === null
                ? t('timeline.rangeOpen')
                : formatTimecode(sequence.outPoint, sequence.fps),
          })}
        />
      ) : null}
      {Object.values(sequence.markers).map((m) => (
        <button
          key={m.id}
          type="button"
          className={styles.marker}
          data-color={m.color}
          data-selected={selectedMarker === m.id}
          style={{ left: m.frame * pxPerFrame }}
          aria-label={t('timeline.markerLabel', {
            name: m.name,
            at: formatTimecode(m.frame, sequence.fps),
          })}
          title={m.note ? `${m.name}: ${m.note}` : m.name}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            useProject.setState({ selectedMarker: m.id, selection: [] })
            usePlayhead.getState().seek(m.frame)
          }}
        />
      ))}
    </div>
  )
})
