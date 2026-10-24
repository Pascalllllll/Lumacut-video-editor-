import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Clip, SpeedPoint } from '@engine/model'
import { speedAt } from '@engine/speed'
import { t, td } from '../i18n'
import styles from './Inspector.module.css'

const W = 220
const H = 96
const PAD = 8
/** Vertical scale is logarithmic from 1/8x to 8x, so slow and fast get equal room. */
const toY = (speed: number) => PAD + ((3 - Math.log2(speed)) / 6) * (H - PAD * 2)
const fromY = (y: number) => 2 ** (3 - ((y - PAD) / (H - PAD * 2)) * 6)
const clampSpeed = (s: number) => Math.min(8, Math.max(0.125, s))

const PRESETS: {
  id: 'speedUp' | 'slowDown' | 'dip' | 'burst'
  points: (d: number) => SpeedPoint[]
}[] = [
  {
    id: 'speedUp',
    points: (d) => [
      { at: 0, speed: 1 },
      { at: d, speed: 4 },
    ],
  },
  {
    id: 'slowDown',
    points: (d) => [
      { at: 0, speed: 1 },
      { at: d, speed: 0.25 },
    ],
  },
  {
    id: 'dip',
    points: (d) => [
      { at: 0, speed: 1 },
      { at: d * 0.35, speed: 0.25 },
      { at: d * 0.65, speed: 0.25 },
      { at: d, speed: 1 },
    ],
  },
  {
    id: 'burst',
    points: (d) => [
      { at: 0, speed: 1 },
      { at: d * 0.5, speed: 4 },
      { at: d, speed: 1 },
    ],
  },
]

/** A speed curve: drag points, click the line to add one, double-click a middle point to remove it. */
export function RampEditor({
  clip,
  onChange,
}: {
  clip: Clip
  onChange: (ramp: SpeedPoint[]) => void
}) {
  const [draft, setDraft] = useState<SpeedPoint[] | null>(null)
  const points = draft ?? clip.ramp ?? []
  const d = clip.duration
  const toX = (at: number) => PAD + (at / d) * (W - PAD * 2)
  const fromX = (x: number) => Math.min(d, Math.max(0, ((x - PAD) / (W - PAD * 2)) * d))

  const svgPoint = (e: PointerEvent<SVGElement>) => {
    const svg = (e.currentTarget.ownerSVGElement ?? e.currentTarget) as SVGSVGElement
    const r = svg.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }

  const beginDrag = (e: PointerEvent<SVGElement>, index: number) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    let next = [...points]
    const move = (ev: globalThis.PointerEvent) => {
      const svg = (e.currentTarget as SVGElement).ownerSVGElement!
      const r = svg.getBoundingClientRect()
      const x = ((ev.clientX - r.left) / r.width) * W
      const y = ((ev.clientY - r.top) / r.height) * H
      const first = index === 0
      const last = index === points.length - 1
      const lo = first ? 0 : next[index - 1]!.at + 1
      const hi = last ? d : next[index + 1]!.at - 1
      const at = first ? 0 : last ? d : Math.min(hi, Math.max(lo, fromX(x)))
      next = next.map((p, i) => (i === index ? { at, speed: clampSpeed(fromY(y)) } : p))
      setDraft(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDraft(null)
      onChange(next)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const addPoint = (e: PointerEvent<SVGSVGElement>) => {
    const { x } = svgPoint(e)
    const at = fromX(x)
    if (points.some((p) => Math.abs(p.at - at) < 2)) return
    const next = [...points, { at, speed: speedAt(clip, at) }].sort((a, b) => a.at - b.at)
    onChange(next)
  }

  const onKey = (e: KeyboardEvent, index: number) => {
    const p = points[index]!
    let next: SpeedPoint | null = null
    if (e.key === 'ArrowUp') next = { ...p, speed: clampSpeed(p.speed * 1.1) }
    if (e.key === 'ArrowDown') next = { ...p, speed: clampSpeed(p.speed / 1.1) }
    if ((e.key === 'Delete' || e.key === 'Backspace') && index > 0 && index < points.length - 1) {
      e.preventDefault()
      e.stopPropagation()
      onChange(points.filter((_, i) => i !== index))
      return
    }
    if (next) {
      e.preventDefault()
      e.stopPropagation()
      onChange(points.map((q, i) => (i === index ? next! : q)))
    }
  }

  const path = points
    .map((p, i) => `${i ? 'L' : 'M'}${toX(p.at).toFixed(1)},${toY(p.speed).toFixed(1)}`)
    .join(' ')

  return (
    <div className={styles.ramp}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.rampGraph}
        onPointerDown={addPoint}
        role="group"
        aria-label={t('ramp.label')}
      >
        {[0.25, 1, 4].map((s) => (
          <g key={s}>
            <line
              x1={PAD}
              x2={W - PAD}
              y1={toY(s)}
              y2={toY(s)}
              className={s === 1 ? styles.rampNormal : styles.rampGrid}
            />
            <text x={W - PAD} y={toY(s) - 2} className={styles.rampLabel} textAnchor="end">
              {s * 100}%
            </text>
          </g>
        ))}
        <path d={path} className={styles.rampLine} />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={toX(p.at)}
            cy={toY(p.speed)}
            r={5}
            className={styles.rampPoint}
            tabIndex={0}
            role="slider"
            aria-label={t('ramp.point', { n: i + 1 })}
            aria-valuemin={12}
            aria-valuemax={800}
            aria-valuenow={Math.round(p.speed * 100)}
            aria-valuetext={`${Math.round(p.speed * 100)}%`}
            onPointerDown={(e) => beginDrag(e, i)}
            onDoubleClick={() =>
              i > 0 && i < points.length - 1 && onChange(points.filter((_, j) => j !== i))
            }
            onKeyDown={(e) => onKey(e, i)}
          />
        ))}
      </svg>
      <p className={styles.hint}>{t('ramp.hint')}</p>
      <div className={styles.presets}>
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={styles.chip}
            onClick={() => onChange(preset.points(d))}
          >
            {td(`ramp.${preset.id}`)}
          </button>
        ))}
      </div>
    </div>
  )
}
