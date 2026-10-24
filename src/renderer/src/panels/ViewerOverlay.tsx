import { useRef, useState, type PointerEvent } from 'react'
import { evaluateVector } from '@engine/animation'
import { setParam } from '@engine/look'
import { activeSequence, type Clip, type Mask } from '@engine/model'
import { frameToPicture, pictureToFrame, type Placement } from '@engine/placement'
import { buildScene, type Layer } from '@engine/scene'
import { clipEnd } from '@engine/timeline'
import { t } from '../i18n'
import { useEditor } from '../state/editor'
import { usePlayhead } from '../state/playhead'
import { useProject } from '../state/project'
import { newMask } from './look/LookInspector'
import styles from './ViewerOverlay.module.css'

type Pt = { x: number; y: number }

/**
 * On-picture controls for the selected clip: drag inside to move, corners to
 * scale (Shift for free scale), the top handle to turn. Masks show as
 * outlines with draggable points, and new masks can be drawn here.
 */
export function ViewerOverlay() {
  const project = useProject((s) => s.history.project)
  const selection = useProject((s) => s.selection)
  const frame = usePlayhead((s) => s.frame)
  const playing = usePlayhead((s) => s.playing)
  const maskTool = useEditor((s) => s.maskTool)
  const svgRef = useRef<SVGSVGElement>(null)
  const [draftPath, setDraftPath] = useState<Pt[]>([])
  const [draftBox, setDraftBox] = useState<{ a: Pt; b: Pt } | null>(null)

  const seq = activeSequence(project)
  const clip = selection
    .map((id) => seq.clips[id])
    .find(
      (c): c is Clip =>
        Boolean(c) && seq.tracks.find((tr) => tr.id === c!.trackId)?.kind === 'video',
    )
  if (!clip || playing || frame < clip.start || frame >= clipEnd(clip)) return null
  const scene = buildScene(project, seq, frame)
  const layer = scene.items.find((i): i is Layer => i.kind === 'layer' && i.key === clip.id)
  if (!layer) return null
  const W = seq.width
  const H = seq.height
  const f = frame - clip.start
  const place: Placement = layer
  const toFrame = (u: number, v: number) => pictureToFrame(place, W, H, u, v)
  const corners = [toFrame(0, 0), toFrame(1, 0), toFrame(1, 1), toFrame(0, 1)]
  const topMid = toFrame(0.5, 0)
  const center = toFrame(0.5, 0.5)
  const away = { x: topMid.x - center.x, y: topMid.y - center.y }
  const len = Math.hypot(away.x, away.y) || 1
  const handleR = Math.max(W, H) / 160
  // The turn handle sits outside the top edge, or inside it when that would leave the frame.
  const reach = handleR * 6
  const outward = { x: topMid.x + (away.x / len) * reach, y: topMid.y + (away.y / len) * reach }
  const fits = outward.x >= 0 && outward.x <= W && outward.y >= 0 && outward.y <= H
  const rotHandle = fits
    ? outward
    : { x: topMid.x - (away.x / len) * reach, y: topMid.y - (away.y / len) * reach }

  const dispatch = (patch: object) =>
    useProject
      .getState()
      .dispatch({ type: 'clip.look', sequenceId: seq.id, clipIds: [clip.id], patch })
  /** Pointer position in sequence pixels. */
  const at = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }

  /** Runs a drag; `apply` gets the start and current points and returns the clip patch. The clip is read once, so a drag is one edit. */
  const drag = (
    e: PointerEvent,
    apply: (start: Pt, now: Pt, ev: globalThis.PointerEvent) => object,
  ) => {
    e.stopPropagation()
    e.preventDefault()
    const start = at(e)
    let last: object | null = null
    const move = (ev: globalThis.PointerEvent) => {
      last = apply(start, at(ev), ev)
      // Live feedback goes through the store without adding undo steps until the drag ends.
      const state = useProject.getState()
      const draft = { ...state.history.project }
      draft.sequences = {
        ...draft.sequences,
        [seq.id]: { ...seq, clips: { ...seq.clips, [clip.id]: { ...clip, ...last } } },
      }
      useProject.setState({ history: { ...state.history, project: draft } })
    }
    const original = useProject.getState().history
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      useProject.setState({ history: original })
      if (last) dispatch(last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const t0 = layer.transform
  const moveBody = (e: PointerEvent) =>
    drag(e, (s, n) => {
      const a = setParam(clip, { kind: 'transform', key: 'x' }, f, t0.x + n.x - s.x)
      const b = setParam({ ...clip, ...a }, { kind: 'transform', key: 'y' }, f, t0.y + n.y - s.y)
      return { ...a, ...b }
    })
  const scaleCorner = (e: PointerEvent) =>
    drag(e, (s, n, ev) => {
      const d0 = Math.hypot(s.x - center.x, s.y - center.y) || 1
      const d1 = Math.hypot(n.x - center.x, n.y - center.y)
      let kx = d1 / d0
      let ky = kx
      if (ev.shiftKey) {
        kx = Math.abs(n.x - center.x) / (Math.abs(s.x - center.x) || 1)
        ky = Math.abs(n.y - center.y) / (Math.abs(s.y - center.y) || 1)
      }
      const a = setParam(clip, { kind: 'transform', key: 'scaleX' }, f, t0.scaleX * kx)
      const b = setParam({ ...clip, ...a }, { kind: 'transform', key: 'scaleY' }, f, t0.scaleY * ky)
      return { ...a, ...b }
    })
  const rotate = (e: PointerEvent) =>
    drag(e, (s, n, ev) => {
      const a0 = Math.atan2(s.y - center.y, s.x - center.x)
      const a1 = Math.atan2(n.y - center.y, n.x - center.x)
      let deg = t0.rotation + ((a1 - a0) * 180) / Math.PI
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15
      return setParam(clip, { kind: 'transform', key: 'rotation' }, f, deg)
    })

  // ---- masks
  const toPic = (p: Pt) => frameToPicture(place, W, H, p.x, p.y)
  const maskOutline = (m: Mask): Pt[] => {
    const g = evaluateVector(m.geometry, f)
    if (m.shape === 'rectangle')
      return [
        toFrame(g[0]!, g[1]!),
        toFrame(g[0]! + g[2]!, g[1]!),
        toFrame(g[0]! + g[2]!, g[1]! + g[3]!),
        toFrame(g[0]!, g[1]! + g[3]!),
      ]
    if (m.shape === 'ellipse') {
      const pts: Pt[] = []
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2
        pts.push(
          toFrame(
            g[0]! + g[2]! / 2 + (Math.cos(a) * g[2]!) / 2,
            g[1]! + g[3]! / 2 + (Math.sin(a) * g[3]!) / 2,
          ),
        )
      }
      return pts
    }
    const pts: Pt[] = []
    for (let i = 0; i + 1 < g.length; i += 6) pts.push(toFrame(g[i]!, g[i + 1]!))
    return pts
  }
  /** New mask shape at this frame: a key when the mask is animated, otherwise its fixed shape. */
  const setGeometry = (m: Mask, geometry: number[]) => {
    const keys = m.geometry.keys.length
      ? [
          ...m.geometry.keys.filter((k) => k.frame !== f),
          { frame: f, value: geometry, ease: 'linear' as const },
        ].sort((a, b) => a.frame - b.frame)
      : []
    return {
      masks: clip.masks.map((x) =>
        x.id === m.id ? { ...x, geometry: { value: geometry, keys } } : x,
      ),
    }
  }
  const dragMaskPoint = (e: PointerEvent, m: Mask, index: number) =>
    drag(e, (_s, n) => {
      const g = [...evaluateVector(m.geometry, f)]
      const p = toPic(n)
      if (m.shape === 'path') {
        g[index * 6] = p.u
        g[index * 6 + 1] = p.v
      } else {
        // Corner `index` of the box: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.
        const x0 = g[0]!
        const y0 = g[1]!
        const x1 = x0 + g[2]!
        const y1 = y0 + g[3]!
        const nx0 = index === 0 || index === 3 ? p.u : x0
        const nx1 = index === 1 || index === 2 ? p.u : x1
        const ny0 = index === 0 || index === 1 ? p.v : y0
        const ny1 = index === 2 || index === 3 ? p.v : y1
        g[0] = Math.min(nx0, nx1)
        g[1] = Math.min(ny0, ny1)
        g[2] = Math.abs(nx1 - nx0)
        g[3] = Math.abs(ny1 - ny0)
      }
      return setGeometry(m, g)
    })
  const dragMaskBody = (e: PointerEvent, m: Mask) =>
    drag(e, (s, n) => {
      const a = toPic(s)
      const b = toPic(n)
      const du = b.u - a.u
      const dv = b.v - a.v
      const g = evaluateVector(m.geometry, f).map((v, i) => {
        if (m.shape !== 'path') return i === 0 ? v + du : i === 1 ? v + dv : v
        return i % 6 === 0 ? v + du : i % 6 === 1 ? v + dv : v
      })
      return setGeometry(m, g)
    })

  // ---- drawing new masks
  const finishPath = (points: Pt[]) => {
    setDraftPath([])
    useEditor.setState({ maskTool: 'none' })
    if (points.length < 3) return
    const m = newMask('path')
    const g = points.flatMap((p) => {
      const q = toPic(p)
      return [q.u, q.v, 0, 0, 0, 0]
    })
    dispatch({ masks: [...clip.masks, { ...m, geometry: { value: g, keys: [] } }] })
  }
  const onDrawDown = (e: PointerEvent) => {
    if (maskTool === 'none') return
    e.stopPropagation()
    const p = at(e)
    if (maskTool === 'path') {
      const first = draftPath[0]
      if (first && draftPath.length >= 3 && Math.hypot(first.x - p.x, first.y - p.y) < handleR * 2)
        finishPath(draftPath)
      else setDraftPath([...draftPath, p])
      return
    }
    setDraftBox({ a: p, b: p })
    const move = (ev: globalThis.PointerEvent) => setDraftBox({ a: p, b: at(ev) })
    const up = (ev: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDraftBox(null)
      const b = at(ev)
      useEditor.setState({ maskTool: 'none' })
      const qa = toPic(p)
      const qb = toPic(b)
      if (Math.abs(qb.u - qa.u) < 0.01 || Math.abs(qb.v - qa.v) < 0.01) return
      const m = newMask(maskTool)
      const g = [
        Math.min(qa.u, qb.u),
        Math.min(qa.v, qb.v),
        Math.abs(qb.u - qa.u),
        Math.abs(qb.v - qa.v),
      ]
      dispatch({ masks: [...clip.masks, { ...m, geometry: { value: g, keys: [] } }] })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const poly = (pts: Pt[]) => pts.map((p) => `${p.x},${p.y}`).join(' ')
  const sw = Math.max(W, H) / 900

  return (
    <svg
      ref={svgRef}
      className={styles.overlay}
      viewBox={`0 0 ${W} ${H}`}
      data-drawing={maskTool !== 'none'}
      onPointerDown={onDrawDown}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && maskTool === 'path') finishPath(draftPath)
        if (e.key === 'Escape') {
          setDraftPath([])
          useEditor.setState({ maskTool: 'none' })
        }
      }}
      tabIndex={maskTool !== 'none' ? 0 : -1}
      role="group"
      aria-label={t('overlay.label')}
    >
      {maskTool === 'none' ? (
        <>
          <polygon
            points={poly(corners)}
            className={styles.body}
            strokeWidth={sw}
            onPointerDown={moveBody}
            aria-label={t('overlay.move')}
          />
          <line
            x1={topMid.x}
            y1={topMid.y}
            x2={rotHandle.x}
            y2={rotHandle.y}
            className={styles.stem}
            strokeWidth={sw}
          />
          <circle
            cx={rotHandle.x}
            cy={rotHandle.y}
            r={handleR}
            className={styles.rotate}
            strokeWidth={sw}
            onPointerDown={rotate}
            aria-label={t('overlay.rotate')}
          />
          {corners.map((c, i) => (
            <rect
              key={i}
              x={c.x - handleR}
              y={c.y - handleR}
              width={handleR * 2}
              height={handleR * 2}
              className={styles.handle}
              strokeWidth={sw}
              onPointerDown={scaleCorner}
              aria-label={t('overlay.scale')}
            />
          ))}
          {clip.masks.map((m) => {
            const outline = maskOutline(m)
            const points =
              m.shape === 'ellipse' ? maskOutline({ ...m, shape: 'rectangle' }) : outline
            return (
              <g key={m.id}>
                <polygon
                  points={poly(outline)}
                  className={styles.mask}
                  strokeWidth={sw * 1.5}
                  onPointerDown={(e) => dragMaskBody(e, m)}
                  aria-label={t('overlay.maskMove')}
                />
                {points.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={handleR * 0.8}
                    className={styles.maskPoint}
                    strokeWidth={sw}
                    onPointerDown={(e) => dragMaskPoint(e, m, i)}
                    aria-label={t('overlay.maskPoint', { n: i + 1 })}
                  />
                ))}
              </g>
            )
          })}
        </>
      ) : null}
      {draftBox ? (
        maskTool === 'ellipse' ? (
          <ellipse
            cx={(draftBox.a.x + draftBox.b.x) / 2}
            cy={(draftBox.a.y + draftBox.b.y) / 2}
            rx={Math.abs(draftBox.b.x - draftBox.a.x) / 2}
            ry={Math.abs(draftBox.b.y - draftBox.a.y) / 2}
            className={styles.mask}
            strokeWidth={sw * 1.5}
          />
        ) : (
          <rect
            x={Math.min(draftBox.a.x, draftBox.b.x)}
            y={Math.min(draftBox.a.y, draftBox.b.y)}
            width={Math.abs(draftBox.b.x - draftBox.a.x)}
            height={Math.abs(draftBox.b.y - draftBox.a.y)}
            className={styles.mask}
            strokeWidth={sw * 1.5}
          />
        )
      ) : null}
      {draftPath.length ? (
        <g>
          <polyline
            points={poly(draftPath)}
            className={styles.mask}
            strokeWidth={sw * 1.5}
            fill="none"
          />
          {draftPath.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={handleR * 0.8}
              className={styles.maskPoint}
              strokeWidth={sw}
            />
          ))}
        </g>
      ) : null}
    </svg>
  )
}
