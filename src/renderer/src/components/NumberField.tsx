import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import styles from './NumberField.module.css'

type Props = {
  label: string
  value: number
  onChange: (value: number) => void
  /** Called once when a drag or edit begins, so a caller can group changes. */
  min?: number
  max?: number
  step?: number
  /** Shown after the number. */
  unit?: string
  /** Display multiplier, e.g. 100 to show 0.5 as 50 (%). */
  display?: number
  precision?: number
  id?: string
}

/**
 * A number you can type into or drag sideways to scrub. Shift drags faster,
 * Alt slower. Up and down arrows step; Enter commits; Escape reverts.
 */
export function NumberField({
  label,
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  unit = '',
  display = 1,
  precision = 2,
  id,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const shown = Number((value * display).toFixed(precision))

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = () => {
    setEditing(false)
    const n = Number(draft)
    if (Number.isFinite(n)) onChange(clamp(n / display))
  }

  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const start = value
    let moved = false
    const move = (ev: globalThis.PointerEvent) => {
      const dx = ev.clientX - startX
      if (!moved && Math.abs(dx) < 3) return
      moved = true
      const speed = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1
      onChange(clamp(start + (Math.round(dx) * step * speed) / display))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!moved) {
        setDraft(String(shown))
        setEditing(true)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      const dir = e.key === 'ArrowUp' ? 1 : -1
      onChange(clamp(value + (dir * step * (e.shiftKey ? 10 : 1)) / display))
    } else if (e.key === 'Enter' && !editing) {
      setDraft(String(shown))
      setEditing(true)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        id={id}
        className={styles.input}
        aria-label={label}
        value={draft}
        inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }
  return (
    <span
      id={id}
      className={`${styles.field} tabular`}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={shown}
      aria-valuemin={Number.isFinite(min) ? min * display : undefined}
      aria-valuemax={Number.isFinite(max) ? max * display : undefined}
      onPointerDown={onPointerDown}
      onKeyDown={onKey}
      title={label}
    >
      {shown}
      {unit ? <span className={styles.unit}>{unit}</span> : null}
    </span>
  )
}
