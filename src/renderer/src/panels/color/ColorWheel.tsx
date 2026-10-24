import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { rgbToWheel, wheelToRgb } from '@engine/color'
import { t } from '../../i18n'
import { NumberField } from '../../components/NumberField'
import styles from './Grade.module.css'

type RGBM = [number, number, number, number]

/**
 * A grading wheel: drag the puck toward a hue to push that color in; the
 * slider below moves all channels together. `range` is how far the edge of
 * the wheel reaches.
 */
export function ColorWheel({
  label,
  value,
  range,
  onChange,
}: {
  label: string
  value: RGBM
  range: number
  onChange: (v: RGBM) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const puck = rgbToWheel([value[0] / range, value[1] / range, value[2] / range])
  const setFromPuck = (x: number, y: number) => {
    const len = Math.hypot(x, y)
    const k = len > 1 ? 1 / len : 1
    const rgb = wheelToRgb(x * k, y * k)
    onChange([rgb[0] * range, rgb[1] * range, rgb[2] * range, value[3]])
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const box = ref.current!.getBoundingClientRect()
    const at = (ev: { clientX: number; clientY: number }) => {
      const x = ((ev.clientX - box.left) / box.width) * 2 - 1
      const y = -(((ev.clientY - box.top) / box.height) * 2 - 1)
      // Shift moves the puck finely for small corrections.
      return { x, y }
    }
    const start = at(e)
    const origin = { ...puck }
    let fine = e.shiftKey
    const move = (ev: globalThis.PointerEvent) => {
      fine = ev.shiftKey
      const p = at(ev)
      const k = fine ? 0.2 : 1
      setFromPuck(origin.x + (p.x - start.x) * k, origin.y + (p.y - start.y) * k)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    if (!fine) setFromPuck(start.x, start.y)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }
    const m = moves[e.key]
    if (m) {
      e.preventDefault()
      e.stopPropagation()
      setFromPuck(puck.x + m[0], puck.y + m[1])
    }
  }

  return (
    <div className={styles.wheelBlock}>
      <div className={styles.wheelHead}>
        <span className={styles.wheelLabel}>{label}</span>
        <button
          type="button"
          className={styles.reset}
          onClick={() => onChange([0, 0, 0, 0])}
          aria-label={t('grade.resetWheel', { name: label })}
        >
          {t('grade.reset')}
        </button>
      </div>
      <div
        ref={ref}
        className={styles.wheel}
        role="slider"
        tabIndex={0}
        aria-label={t('grade.wheelLabel', { name: label })}
        aria-valuetext={t('grade.wheelValue', {
          r: value[0].toFixed(2),
          g: value[1].toFixed(2),
          b: value[2].toFixed(2),
        })}
        onPointerDown={onPointerDown}
        onKeyDown={onKey}
        onDoubleClick={() => onChange([0, 0, 0, value[3]])}
      >
        <div
          className={styles.puck}
          style={{ left: `${50 + puck.x * 50}%`, top: `${50 - puck.y * 50}%` }}
        />
      </div>
      <div className={styles.wheelMaster}>
        <NumberField
          label={t('grade.master', { name: label })}
          value={value[3]}
          step={0.005}
          min={-range * 2}
          max={range * 2}
          precision={3}
          onChange={(v) => onChange([value[0], value[1], value[2], v])}
        />
      </div>
    </div>
  )
}
