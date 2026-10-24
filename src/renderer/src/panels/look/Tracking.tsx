import { useState } from 'react'
import { evaluateVector } from '@engine/animation'
import type { Clip, Effect, Mask, Sequence } from '@engine/model'
import { sourceFrameAt } from '@engine/speed'
import { framesToSeconds, fpsValue } from '@engine/time'
import { clipEnd } from '@engine/timeline'
import { t, td } from '../../i18n'
import { notify } from '../../state/notices'
import { useProject } from '../../state/project'
import { useClipFrame } from './ParamRow'
import styles from './Look.module.css'

function message(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Analysis reads the file directly, so it needs the clip at normal speed and direction. */
function analysable(clip: Clip): boolean {
  return !clip.ramp && clip.speed === 1 && !clip.reverse
}

function useSource(clip: Clip) {
  return useProject((s) => s.history.project.media[clip.mediaId])
}

/** Centre of a mask's shape, 0 to 1 of the picture. */
function maskCenter(mask: Mask, frame: number): { x: number; y: number } {
  const g = evaluateVector(mask.geometry, frame)
  if (mask.shape !== 'path')
    return { x: (g[0] ?? 0) + (g[2] ?? 0) / 2, y: (g[1] ?? 0) + (g[3] ?? 0) / 2 }
  let x = 0
  let y = 0
  const n = Math.max(1, Math.floor(g.length / 6))
  for (let i = 0; i < n; i++) {
    x += g[i * 6] ?? 0
    y += g[i * 6 + 1] ?? 0
  }
  return { x: x / n, y: y / n }
}

/** Moves a mask shape by (dx, dy), in picture fractions. */
function shifted(mask: Mask, geometry: number[], dx: number, dy: number): number[] {
  if (mask.shape !== 'path')
    return [geometry[0]! + dx, geometry[1]! + dy, geometry[2]!, geometry[3]!]
  return geometry.map((v, i) => (i % 6 === 0 ? v + dx : i % 6 === 1 ? v + dy : v))
}

/** Tracks the mask's centre from the playhead to the end of the clip and keys the mask to follow it. */
export function TrackMaskButton({
  clip,
  sequence,
  mask,
}: {
  clip: Clip
  sequence: Sequence
  mask: Mask
}) {
  const asset = useSource(clip)
  const frame = useClipFrame(clip)
  const [busy, setBusy] = useState(false)
  if (!asset || asset.kind !== 'video') return null

  const run = async () => {
    if (!analysable(clip)) {
      notify('error', t('track.needsNormalSpeed'))
      return
    }
    setBusy(true)
    try {
      const fps = fpsValue(sequence.fps)
      const frames = clip.duration - frame
      const start = framesToSeconds(sourceFrameAt(clip, frame), sequence.fps)
      const center = maskCenter(mask, frame)
      const result = await window.lumacut.invoke('analyze:track', {
        path: asset.path,
        start,
        duration: framesToSeconds(frames, sequence.fps),
        fps,
        sourceWidth: asset.width ?? sequence.width,
        sourceHeight: asset.height ?? sequence.height,
        point: center,
      })
      const base = evaluateVector(mask.geometry, frame)
      const keys = []
      for (let i = 0; i * 2 < result.points.length; i++) {
        const dx = result.points[i * 2]! - result.points[0]!
        const dy = result.points[i * 2 + 1]! - result.points[1]!
        keys.push({ frame: frame + i, value: shifted(mask, base, dx, dy), ease: 'linear' as const })
      }
      // Keys before the tracked range stay as they were.
      const earlier = mask.geometry.keys.filter((k) => k.frame < frame)
      const next: Mask = {
        ...mask,
        geometry: { value: base, keys: [...earlier, ...keys] },
        track: { start: frame, points: result.points },
      }
      useProject.getState().dispatch({
        type: 'clip.look',
        sequenceId: sequence.id,
        clipIds: [clip.id],
        patch: { masks: clip.masks.map((m) => (m.id === mask.id ? next : m)) },
      })
      notify(
        'info',
        result.lost > 0
          ? t('track.doneLost', { n: result.lost })
          : t('track.done', { n: keys.length }),
      )
    } catch (error) {
      notify('error', message(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className={styles.wideButton}
      disabled={busy}
      onClick={() => void run()}
      aria-busy={busy}
    >
      {busy ? t('track.tracking') : t('track.forward')}
    </button>
  )
}

/** Measures camera shake over the whole clip and stores the corrections on the effect. */
export function StabilizeButton({
  clip,
  sequence,
  effect,
}: {
  clip: Clip
  sequence: Sequence
  effect: Effect
}) {
  const asset = useSource(clip)
  const [busy, setBusy] = useState(false)
  if (!asset || asset.kind !== 'video') return <p className={styles.hint}>{t('track.videoOnly')}</p>
  const run = async () => {
    if (!analysable(clip)) {
      notify('error', t('track.needsNormalSpeed'))
      return
    }
    setBusy(true)
    try {
      const smooth = effect.params['smoothness']
      const result = await window.lumacut.invoke('analyze:shake', {
        path: asset.path,
        start: framesToSeconds(clip.sourceIn, sequence.fps),
        duration: framesToSeconds(clip.duration, sequence.fps),
        fps: fpsValue(sequence.fps),
        sourceWidth: asset.width ?? sequence.width,
        sourceHeight: asset.height ?? sequence.height,
        smoothness: typeof smooth === 'object' ? smooth.value : 0.5,
      })
      useProject.getState().dispatch({
        type: 'clip.look',
        sequenceId: sequence.id,
        clipIds: [clip.id],
        patch: {
          effects: clip.effects.map((e) =>
            e.id === effect.id ? { ...e, data: result.corrections } : e,
          ),
        },
      })
      notify('info', t('stabilize.done'))
    } catch (error) {
      notify('error', message(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <p className={styles.hint}>
        {effect.data.length ? t('stabilize.ready') : t('stabilize.needed')}
      </p>
      <button
        type="button"
        className={styles.wideButton}
        disabled={busy}
        onClick={() => void run()}
        aria-busy={busy}
      >
        {busy
          ? t('stabilize.analyzing')
          : effect.data.length
            ? t('stabilize.again')
            : t('stabilize.analyze')}
      </button>
    </>
  )
}

/**
 * Makes this clip's position follow a tracked mask on another clip: a title
 * can ride along with something filmed.
 */
export function FollowTrack({ clip, sequence }: { clip: Clip; sequence: Sequence }) {
  const project = useProject((s) => s.history.project)
  const sources = Object.values(sequence.clips).flatMap((other) =>
    other.id === clip.id || clipEnd(other) <= clip.start || other.start >= clipEnd(clip)
      ? []
      : other.masks
          .filter((m) => m.track)
          .map((m, i) => ({
            other,
            mask: m,
            label: `${project.media[other.mediaId]?.name ?? ''} · ${t('look.maskName', { n: i + 1, shape: td(`mask.${m.shape}`) })}`,
          })),
  )
  if (sources.length === 0) return null

  const follow = (value: string) => {
    const pick = sources.find((s) => `${s.other.id}/${s.mask.id}` === value)
    if (!pick?.mask.track) return
    const { other, mask } = pick
    const track = mask.track!
    const asset = project.media[other.mediaId]
    const w = asset?.width ?? sequence.width
    const h = asset?.height ?? sequence.height
    const fit = Math.min(sequence.width / w, sequence.height / h)
    const sx = other.transform.scaleX.value * fit * w
    const sy = other.transform.scaleY.value * fit * h
    const x0 = clip.transform.x.value
    const y0 = clip.transform.y.value
    const xKeys = []
    const yKeys = []
    for (let i = 0; i * 2 < track.points.length; i++) {
      const timeline = other.start + track.start + i
      const f = timeline - clip.start
      if (f < 0 || f >= clip.duration) continue
      xKeys.push({
        frame: f,
        value: x0 + (track.points[i * 2]! - track.points[0]!) * sx,
        ease: 'linear' as const,
      })
      yKeys.push({
        frame: f,
        value: y0 + (track.points[i * 2 + 1]! - track.points[1]!) * sy,
        ease: 'linear' as const,
      })
    }
    if (xKeys.length === 0) {
      notify('error', t('track.noOverlap'))
      return
    }
    useProject.getState().dispatch({
      type: 'clip.look',
      sequenceId: sequence.id,
      clipIds: [clip.id],
      patch: {
        transform: {
          ...clip.transform,
          x: { value: x0, keys: xKeys },
          y: { value: y0, keys: yKeys },
        },
      },
    })
    notify('info', t('track.following'))
  }

  return (
    <div className={styles.inline}>
      <label htmlFor={`follow-${clip.id}`}>{t('track.follow')}</label>
      <select
        id={`follow-${clip.id}`}
        value=""
        onChange={(e) => e.target.value && follow(e.target.value)}
      >
        <option value="">{t('track.followPick')}</option>
        {sources.map((s) => (
          <option key={`${s.other.id}/${s.mask.id}`} value={`${s.other.id}/${s.mask.id}`}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  )
}
