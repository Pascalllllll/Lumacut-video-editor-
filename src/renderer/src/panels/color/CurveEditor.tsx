import { useRef, useState, type PointerEvent } from 'react'
import { sampleCurve, sampleHueCurve } from '@engine/color'
import type { Curves } from '@engine/model'
import { t, td } from '../../i18n'
import styles from './Grade.module.css'

type Channel = keyof Curves
const CHANNELS: Channel[] = ['master', 'red', 'green', 'blue', 'hueHue', 'hueSat', 'hueLuma']
const STROKE: Record<Channel, string> = {
  master: 'var(--text-primary)',
  red: '#e5554f',
  green: '#3aa874',
  blue: '#4d8dfa',
  hueHue: 'var(--accent)',
  hueSat: 'var(--accent)',
  hueLuma: 'var(--accent)',
}

/**
 * Tone curves (master, red, green, blue) and hue curves. Click to add a
 * point, drag to move it, double-click to remove it. Hue curves are flat at
 * the middle line, which means no change.
 */
export function CurveEditor({
  curves,
  onChange,
}: {
  curves: Curves
  onChange: (c: Curves) => void
}) {
  const [channel, setChannel] = useState<Channel>('master')
  const ref = useRef<SVGSVGElement>(null)
  const hue = channel.startsWith('hue')
  const points = curves[channel]
  const pairs: [number, number][] = []
  for (let i = 0; i + 1 < points.length; i += 2) pairs.push([points[i]!, points[i + 1]!])
  const sampled = hue ? sampleHueCurve(points, 128) : sampleCurve(points, 128)
  const path = Array.from(
    sampled,
    (v, i) => `${i ? 'L' : 'M'}${((i / 127) * 100).toFixed(2)},${(100 - v * 100).toFixed(2)}`,
  ).join(' ')

  const set = (next: [number, number][]) =>
    onChange({ ...curves, [channel]: next.sort((a, b) => a[0] - b[0]).flat() })
  const at = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect()
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)),
    ] as [number, number]
  }
  const drag = (index: number, start: [number, number][]) => {
    const move = (ev: globalThis.PointerEvent) => {
      const p = at(ev)
      const next = start.map((q, i) => (i === index ? p : q))
      // Tone curve ends stay on the left and right edges.
      if (!hue && (index === 0 || index === start.length - 1))
        next[index] = [start[index]![0], p[1]]
      set(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onBackground = (e: PointerEvent<SVGSVGElement>) => {
    const p = at(e)
    const base = pairs.length
      ? pairs
      : hue
        ? []
        : ([
            [0, 0],
            [1, 1],
          ] as [number, number][])
    const next = [...base, p].sort((a, b) => a[0] - b[0])
    set(next)
    drag(
      next.findIndex((q) => q === p),
      next,
    )
  }

  return (
    <div className={styles.curves}>
      <div className={styles.channelTabs} role="tablist" aria-label={t('grade.curveChannel')}>
        {CHANNELS.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={channel === c}
            className={styles.channelTab}
            data-channel={c}
            onClick={() => setChannel(c)}
          >
            {td(`grade.channel.${c}`)}
          </button>
        ))}
      </div>
      <svg
        ref={ref}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className={styles.curveGraph}
        onPointerDown={onBackground}
        role="group"
        aria-label={td(`grade.channel.${channel}`)}
      >
        {[25, 50, 75].map((v) => (
          <g key={v}>
            <line x1={v} x2={v} y1={0} y2={100} className={styles.curveGrid} />
            <line x1={0} x2={100} y1={v} y2={v} className={styles.curveGrid} />
          </g>
        ))}
        {hue ? (
          <rect x="0" y="98" width="100" height="2" className={styles.hueStrip} />
        ) : (
          <line x1="0" y1="100" x2="100" y2="0" className={styles.curveGrid} />
        )}
        <path d={path} className={styles.curveLine} style={{ stroke: STROKE[channel] }} />
        {pairs.map(([x, y], i) => (
          <circle
            key={i}
            cx={x * 100}
            cy={100 - y * 100}
            r={2.2}
            className={styles.curvePoint}
            onPointerDown={(e) => {
              e.stopPropagation()
              drag(i, pairs)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (!hue && (i === 0 || i === pairs.length - 1)) return
              set(pairs.filter((_, j) => j !== i))
            }}
          />
        ))}
      </svg>
      <p className={styles.hint}>{hue ? t('grade.hueHint') : t('grade.curveHint')}</p>
      <button
        type="button"
        className={styles.reset}
        onClick={() => onChange({ ...curves, [channel]: hue ? [] : [0, 0, 1, 1] })}
      >
        {t('grade.resetCurve')}
      </button>
    </div>
  )
}
