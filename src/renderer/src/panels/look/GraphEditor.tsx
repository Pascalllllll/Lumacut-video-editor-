import { useState, type PointerEvent } from 'react'
import { evaluate, NAMED_EASES, type Ease } from '@engine/animation'
import { getAnimated, moveKey, setKeyEase, stopAnimating, type ParamPath } from '@engine/look'
import type { Clip, Sequence } from '@engine/model'
import { formatTimecode } from '@engine/time'
import { t, td } from '../../i18n'
import { usePlayhead } from '../../state/playhead'
import { useProject } from '../../state/project'
import { useEditor } from '../../state/editor'
import { useClipFrame } from './ParamRow'
import styles from './Look.module.css'

const W = 260
const H = 120
const PAD = 10
const EASES = ['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out', 'custom'] as const

function easeName(e: Ease): (typeof EASES)[number] {
  return typeof e === 'string' ? e : 'custom'
}

/**
 * Value over time for one animated parameter. Drag keys to change when and
 * what; pick a key to change how it eases into the next one; custom eases
 * get two handles to shape the curve.
 */
export function GraphEditor({
  clip,
  sequence,
  path,
}: {
  clip: Clip
  sequence: Sequence
  path: ParamPath
}) {
  const anim = getAnimated(clip, path)
  const frame = useClipFrame(clip)
  const [selected, setSelected] = useState<number | null>(null)
  const [draft, setDraft] = useState<{ from: number; frame: number; value: number } | null>(null)
  if (!anim) return null
  const dispatch = (patch: object) =>
    useProject
      .getState()
      .dispatch({ type: 'clip.look', sequenceId: sequence.id, clipIds: [clip.id], patch })

  const keys = anim.keys
    .map((k) =>
      draft && k.frame === draft.from ? { ...k, frame: draft.frame, value: draft.value } : k,
    )
    .sort((a, b) => a.frame - b.frame)
  const values = keys.length ? keys.map((k) => k.value) : [anim.value]
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (hi - lo < 1e-6) {
    lo -= 1
    hi += 1
  }
  const span = hi - lo
  lo -= span * 0.1
  hi += span * 0.1
  const d = Math.max(1, clip.duration - 1)
  const x = (f: number) => PAD + (f / d) * (W - PAD * 2)
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - PAD * 2)
  const fromX = (px: number) => Math.round(((px - PAD) / (W - PAD * 2)) * d)
  const fromY = (py: number) => lo + ((H - PAD - py) / (H - PAD * 2)) * (hi - lo)

  const curve: string[] = []
  const steps = 120
  for (let i = 0; i <= steps; i++) {
    const f = (i / steps) * d
    curve.push(`${i ? 'L' : 'M'}${x(f).toFixed(1)},${y(evaluate({ ...anim, keys }, f)).toFixed(1)}`)
  }

  const local = (e: PointerEvent<SVGElement>) => {
    const svg = (e.currentTarget.ownerSVGElement ?? e.currentTarget) as SVGSVGElement
    const r = svg.getBoundingClientRect()
    return (ev: { clientX: number; clientY: number }) => ({
      px: ((ev.clientX - r.left) / r.width) * W,
      py: ((ev.clientY - r.top) / r.height) * H,
    })
  }

  const dragKey = (e: PointerEvent<SVGCircleElement>, keyFrame: number) => {
    e.stopPropagation()
    setSelected(keyFrame)
    const toLocal = local(e)
    let last = {
      from: keyFrame,
      frame: keyFrame,
      value: anim.keys.find((k) => k.frame === keyFrame)!.value,
    }
    const move = (ev: globalThis.PointerEvent) => {
      const p = toLocal(ev)
      last = {
        from: keyFrame,
        frame: Math.min(clip.duration - 1, Math.max(0, fromX(p.px))),
        value: ev.shiftKey ? last.value : fromY(p.py),
      }
      setDraft(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDraft(null)
      if (
        last.frame !== keyFrame ||
        last.value !== anim.keys.find((k) => k.frame === keyFrame)!.value
      ) {
        dispatch(moveKey(clip, path, keyFrame, last.frame, last.value))
        setSelected(last.frame)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const selectedKey = keys.find((k) => k.frame === selected)
  const nextKey = selectedKey ? keys.find((k) => k.frame > selectedKey.frame) : undefined
  const bezier: [number, number, number, number] | null =
    selectedKey && nextKey
      ? typeof selectedKey.ease === 'object'
        ? selectedKey.ease.bezier
        : selectedKey.ease === 'linear' || selectedKey.ease === 'hold'
          ? null
          : NAMED_EASES[selectedKey.ease]
      : null

  /** Drags one of the two bezier handles of the selected segment. */
  const dragHandle = (e: PointerEvent<SVGCircleElement>, which: 0 | 1) => {
    if (!selectedKey || !nextKey || !bezier) return
    e.stopPropagation()
    const toLocal = local(e)
    const x0 = x(selectedKey.frame)
    const x1 = x(nextKey.frame)
    const y0 = y(selectedKey.value)
    const y1 = y(nextKey.value)
    let b = [...bezier] as [number, number, number, number]
    const move = (ev: globalThis.PointerEvent) => {
      const p = toLocal(ev)
      const bx = Math.min(1, Math.max(0, (p.px - x0) / Math.max(1e-6, x1 - x0)))
      const by = Math.abs(y1 - y0) < 1e-6 ? 0 : (p.py - y0) / (y1 - y0)
      b = which === 0 ? [bx, by, b[2], b[3]] : [b[0], b[1], bx, by]
      dispatch(setKeyEase(clip, path, selectedKey.frame, { bezier: b }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const label = (() => {
    if (path.kind === 'transform') return td(`look.${path.key}`)
    if (path.kind === 'effect') return td(`param.${path.param}`)
    return td(`look.${path.param}`)
  })()

  return (
    <section className={styles.section} aria-label={t('graph.title', { name: label })}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{t('graph.title', { name: label })}</h3>
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => useEditor.setState({ selectedParam: null })}
        >
          {t('graph.close')}
        </button>
      </div>
      {keys.length < 2 ? (
        <p className={styles.hint}>{t('graph.needKeys')}</p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={styles.graph}
          role="img"
          aria-label={t('graph.title', { name: label })}
        >
          <line x1={x(frame)} x2={x(frame)} y1={0} y2={H} className={styles.graphPlayhead} />
          <path d={curve.join(' ')} className={styles.graphLine} />
          {bezier && selectedKey && nextKey ? (
            <g>
              {([0, 1] as const).map((which) => {
                const hx =
                  x(selectedKey.frame) +
                  bezier[which * 2]! * (x(nextKey.frame) - x(selectedKey.frame))
                const hy =
                  y(selectedKey.value) +
                  bezier[which * 2 + 1]! * (y(nextKey.value) - y(selectedKey.value))
                const anchor = which === 0 ? selectedKey : nextKey
                return (
                  <g key={which}>
                    <line
                      x1={x(anchor.frame)}
                      y1={y(anchor.value)}
                      x2={hx}
                      y2={hy}
                      className={styles.graphHandleLine}
                    />
                    <circle
                      cx={hx}
                      cy={hy}
                      r={4}
                      className={styles.graphHandle}
                      onPointerDown={(e) => dragHandle(e, which)}
                      aria-label={t('graph.handle', { n: which + 1 })}
                    />
                  </g>
                )
              })}
            </g>
          ) : null}
          {keys.map((k) => (
            <circle
              key={k.frame}
              cx={x(k.frame)}
              cy={y(k.value)}
              r={5}
              className={styles.graphKey}
              data-selected={k.frame === selected}
              tabIndex={0}
              role="button"
              aria-label={t('graph.key', {
                at: formatTimecode(k.frame, sequence.fps),
                value: Number(k.value.toFixed(3)),
              })}
              onPointerDown={(e) => dragKey(e, k.frame)}
              onDoubleClick={() => usePlayhead.getState().seek(clip.start + k.frame)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSelected(k.frame)
              }}
            />
          ))}
        </svg>
      )}
      {selectedKey && nextKey ? (
        <div className={styles.inline}>
          <label htmlFor="graph-ease">{t('graph.ease')}</label>
          <select
            id="graph-ease"
            value={easeName(selectedKey.ease)}
            onChange={(e) => {
              const v = e.target.value as (typeof EASES)[number]
              const ease: Ease = v === 'custom' ? { bezier: bezier ?? [0.33, 0, 0.67, 1] } : v
              dispatch(setKeyEase(clip, path, selectedKey.frame, ease))
            }}
          >
            {EASES.map((e) => (
              <option key={e} value={e}>
                {td(`ease.${e}`)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {keys.length ? (
        <button
          type="button"
          className={styles.wideButton}
          onClick={() => dispatch(stopAnimating(clip, path, frame))}
        >
          {t('graph.stop')}
        </button>
      ) : null}
    </section>
  )
}
