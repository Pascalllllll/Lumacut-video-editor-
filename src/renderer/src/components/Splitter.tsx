import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { t } from '../i18n'
import { useSettings } from '../state/settings'
import styles from './Splitter.module.css'

/** Default panel sizes, in percent, by workspace and handle. */
export const LAYOUT_DEFAULTS: Record<string, Record<string, number>> = {
  edit: { left: 22, right: 22, top: 58 },
  color: { right: 38, top: 52 },
  audio: { right: 26, top: 30 },
  captions: { right: 32, top: 55 },
  export: { right: 30, top: 62 },
}

/** CSS variables for a workspace's grid, from the saved sizes. */
export function useLayout(workspace: string): Record<string, string> {
  const saved = useSettings((s) => s.settings.layouts[workspace])
  const sizes = { ...LAYOUT_DEFAULTS[workspace], ...saved }
  return Object.fromEntries(Object.entries(sizes).map(([k, v]) => [`--${k}`, `${v}%`]))
}

type Handle = 'left' | 'right' | 'top'

/**
 * A drag handle on a panel edge. It sets the workspace's size variable live
 * while dragging and saves it on release; arrow keys move it, double-click
 * puts it back.
 */
export function Splitter({
  workspace,
  handle,
  span = 'full',
}: {
  workspace: string
  handle: Handle
  /** A side handle that only runs beside the top row. */
  span?: 'full' | 'top'
}) {
  const layouts = useSettings((s) => s.settings.layouts)
  const update = useSettings((s) => s.update)
  const value = layouts[workspace]?.[handle] ?? LAYOUT_DEFAULTS[workspace]?.[handle] ?? 25
  const save = (v: number | null) => {
    const current = { ...layouts[workspace] }
    if (v === null) delete current[handle]
    else
      current[handle] = Math.round(Math.min(handle === 'top' ? 80 : 50, Math.max(12, v)) * 10) / 10
    void update({ layouts: { ...layouts, [workspace]: current } })
  }
  const measure = (container: HTMLElement, x: number, y: number) => {
    const r = container.getBoundingClientRect()
    if (handle === 'left') return ((x - r.left) / r.width) * 100
    if (handle === 'right') return ((r.right - x) / r.width) * 100
    return ((y - r.top) / r.height) * 100
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const container = e.currentTarget.parentElement!
    let last = value
    const move = (ev: PointerEvent) => {
      last = Math.min(
        handle === 'top' ? 80 : 50,
        Math.max(12, measure(container, ev.clientX, ev.clientY)),
      )
      container.style.setProperty(`--${handle}`, `${last}%`)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      container.style.removeProperty(`--${handle}`)
      save(last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const grow = handle === 'left' ? 'ArrowRight' : handle === 'right' ? 'ArrowLeft' : 'ArrowDown'
    const shrink = handle === 'left' ? 'ArrowLeft' : handle === 'right' ? 'ArrowRight' : 'ArrowUp'
    if (e.key !== grow && e.key !== shrink) return
    e.preventDefault()
    e.stopPropagation()
    save(value + (e.key === grow ? 2 : -2))
  }
  return (
    <div
      className={styles.splitter}
      data-handle={handle}
      data-span={span}
      role="separator"
      tabIndex={0}
      aria-orientation={handle === 'top' ? 'horizontal' : 'vertical'}
      aria-valuenow={Math.round(value)}
      aria-valuemin={12}
      aria-valuemax={handle === 'top' ? 80 : 50}
      aria-label={t(`layout.${handle}`)}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => save(null)}
    />
  )
}
