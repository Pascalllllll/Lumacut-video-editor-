import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Command } from '@engine/commands'
import { bladeCommand, clipsUnder } from '@engine/edits'
import type { Clip, Sequence } from '@engine/model'
import { clipEnd, clipsOnTrack, companions } from '@engine/timeline'
import type { Tool } from '../../state/editor'
import { usePlayhead } from '../../state/playhead'
import { useProject } from '../../state/project'
import { useSettings } from '../../state/settings'
import { EDGE_PX, snap } from './geometry'

/** What a drag in progress looks like, for drawing previews. */
export type DragPreview =
  | { kind: 'move'; ids: Set<string>; delta: number; trackId: string; anchorId: string }
  | {
      kind: 'trim'
      ids: Set<string>
      edge: 'start' | 'end'
      delta: number
      ripple: boolean
      rate: boolean
    }
  | { kind: 'label'; clipId: string; text: string }

type Ctx = {
  sequence: Sequence
  tool: Tool
  pxPerFrame: number
  frameAt: (clientX: number) => number
  setPreview: (p: DragPreview | null) => void
  formatDelta: (frames: number) => string
}

function snapPoints(seq: Sequence, exclude: ReadonlySet<string>): number[] {
  const points = [0, usePlayhead.getState().frame]
  if (seq.inPoint !== null) points.push(seq.inPoint)
  if (seq.outPoint !== null) points.push(seq.outPoint)
  for (const m of Object.values(seq.markers)) points.push(m.frame)
  for (const c of Object.values(seq.clips)) {
    if (exclude.has(c.id)) continue
    points.push(c.start, clipEnd(c))
  }
  return points
}

function drag(onMove: (ev: PointerEvent) => void, onUp: (ev: PointerEvent) => void) {
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', up)
    onUp(ev)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', up)
}

function dispatch(cmd: Command | null) {
  if (cmd) useProject.getState().dispatch(cmd)
}

/** The neighbour touching a clip's edge on the same track, if any. */
function neighbour(seq: Sequence, clip: Clip, edge: 'start' | 'end'): Clip | undefined {
  return clipsOnTrack(seq, clip.trackId).find((c) =>
    edge === 'end' ? c.start === clipEnd(clip) : clipEnd(c) === clip.start,
  )
}

/**
 * Pointer handling for a clip, by tool. Each drag shows a preview while the
 * pointer moves and turns into a single command on release.
 */
export function beginClipPointer(e: ReactPointerEvent, clip: Clip, ctx: Ctx) {
  if (e.button !== 0) return
  e.stopPropagation()
  const { sequence: seq, tool, pxPerFrame, frameAt, setPreview } = ctx
  const store = useProject.getState()
  const snapping = useSettings.getState().settings.snapping

  if (tool === 'blade') {
    const at = snap(frameAt(e.clientX), snapPoints(seq, new Set()), pxPerFrame, snapping)
    const ids = e.shiftKey
      ? clipsUnder(seq, at)
      : [...(e.altKey ? new Set([clip.id]) : companions(seq, [clip.id]))]
    dispatch(bladeCommand(seq, ids, at))
    return
  }

  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    const current = store.selection
    const group = companions(seq, [clip.id])
    const has = current.includes(clip.id)
    store.select(has ? current.filter((id) => !group.has(id)) : [...current, ...group], {
      expand: false,
    })
    return
  }
  if (!store.selection.includes(clip.id))
    store.select([clip.id], e.altKey ? { expand: false } : undefined)

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const offset = e.clientX - rect.left
  const edge: 'start' | 'end' | null =
    offset < EDGE_PX ? 'start' : offset > rect.width - EDGE_PX ? 'end' : null
  const startX = e.clientX
  const rawDelta = (ev: PointerEvent) => Math.round((ev.clientX - startX) / pxPerFrame)
  const linked = e.altKey
    ? new Set([clip.id])
    : new Set(useProject.getState().selection.filter((id) => seq.clips[id]))
  linked.add(clip.id)

  // ---- trims: select (overwrite), ripple, rate stretch
  if (edge && (tool === 'select' || tool === 'ripple' || tool === 'rate')) {
    // Linked clips that share the dragged edge trim with it.
    const ids = new Set(
      [...linked].filter((id) => {
        const c = seq.clips[id]
        return c && (edge === 'start' ? c.start === clip.start : clipEnd(c) === clipEnd(clip))
      }),
    )
    const points = snapPoints(seq, ids)
    let delta = 0
    const ripple = tool === 'ripple'
    const rate = tool === 'rate'
    drag(
      (ev) => {
        const edgeFrame = (edge === 'start' ? clip.start : clipEnd(clip)) + rawDelta(ev)
        const target = snap(edgeFrame, points, pxPerFrame, snapping)
        delta = target - (edge === 'start' ? clip.start : clipEnd(clip))
        if (edge === 'start') delta = Math.min(delta, clip.duration - 1)
        else delta = Math.max(delta, 1 - clip.duration)
        setPreview({ kind: 'trim', ids, edge, delta, ripple, rate })
      },
      () => {
        setPreview(null)
        if (delta === 0) return
        const commands: Command[] = [...ids].map((id) => {
          const c = seq.clips[id]!
          const frame = (edge === 'start' ? c.start : clipEnd(c)) + delta
          return rate
            ? {
                type: 'clip.rateStretch',
                sequenceId: seq.id,
                clipId: id,
                edge,
                frame: Math.max(0, frame),
              }
            : {
                type: 'clip.trim',
                sequenceId: seq.id,
                clipId: id,
                edge,
                frame: Math.max(0, frame),
                ripple,
              }
        })
        dispatch({
          type: 'batch',
          label: rate ? 'Rate stretch' : ripple ? 'Ripple trim' : 'Trim',
          commands,
        })
      },
    )
    return
  }

  // ---- roll: drag an edit point shared with a neighbour
  if (tool === 'roll') {
    const side = edge ?? (offset < rect.width / 2 ? 'start' : 'end')
    const other = neighbour(seq, clip, side)
    if (!other) return
    const left = side === 'end' ? clip : other
    const right = side === 'end' ? other : clip
    const points = snapPoints(seq, new Set([left.id, right.id]))
    let target = right.start
    drag(
      (ev) => {
        target = snap(right.start + rawDelta(ev), points, pxPerFrame, snapping)
        setPreview({ kind: 'label', clipId: clip.id, text: ctx.formatDelta(target - right.start) })
      },
      () => {
        setPreview(null)
        if (target !== right.start)
          dispatch({
            type: 'clip.roll',
            sequenceId: seq.id,
            leftId: left.id,
            rightId: right.id,
            frame: target,
          })
      },
    )
    return
  }

  // ---- slip and slide: drag the body
  if (tool === 'slip' || tool === 'slide') {
    let delta = 0
    drag(
      (ev) => {
        // Slip: the picture follows the pointer, so the source moves the other way.
        delta = tool === 'slip' ? -rawDelta(ev) : rawDelta(ev)
        setPreview({ kind: 'label', clipId: clip.id, text: ctx.formatDelta(delta) })
      },
      () => {
        setPreview(null)
        if (delta === 0) return
        dispatch(
          tool === 'slip'
            ? { type: 'clip.slip', sequenceId: seq.id, clipId: clip.id, delta }
            : { type: 'clip.slide', sequenceId: seq.id, clipId: clip.id, delta },
        )
      },
    )
    return
  }

  // ---- move (select and ripple tools)
  const ids = linked
  const points = snapPoints(seq, ids)
  const minStart = Math.min(...[...ids].map((id) => seq.clips[id]!.start))
  let preview: DragPreview = {
    kind: 'move',
    ids,
    delta: 0,
    trackId: clip.trackId,
    anchorId: clip.id,
  }
  drag(
    (ev) => {
      const raw = Math.max(-minStart, rawDelta(ev))
      // Snap whichever edge of the grabbed clip lands closest to something.
      const s = clip.start + raw
      const snappedStart = snap(s, points, pxPerFrame, snapping)
      const snappedEnd = snap(s + clip.duration, points, pxPerFrame, snapping) - clip.duration
      const delta = Math.max(
        -minStart,
        (snappedStart !== s ? snappedStart : snappedEnd !== s ? snappedEnd : s) - clip.start,
      )
      const lane = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>('[data-track-id]')
      const laneTrack = lane?.dataset['trackId']
      const fromKind = seq.tracks.find((tr) => tr.id === clip.trackId)?.kind
      const trackId =
        laneTrack && seq.tracks.find((tr) => tr.id === laneTrack)?.kind === fromKind
          ? laneTrack
          : clip.trackId
      preview = { kind: 'move', ids, delta, trackId, anchorId: clip.id }
      setPreview(preview)
    },
    () => {
      setPreview(null)
      if (preview.kind !== 'move' || (preview.delta === 0 && preview.trackId === clip.trackId))
        return
      const p = preview
      dispatch({
        type: 'clip.move',
        sequenceId: seq.id,
        moves: [...p.ids].map((id) => ({
          clipId: id,
          start: Math.max(0, seq.clips[id]!.start + p.delta),
          ...(id === clip.id ? { trackId: p.trackId } : {}),
        })),
      })
    },
  )
}

/** Clicking or dragging on the ruler or empty track space moves the playhead. */
export function beginScrub(e: ReactPointerEvent, frameAt: (x: number) => number) {
  if (e.button !== 0) return
  const playhead = usePlayhead.getState()
  playhead.setPlaying(false)
  playhead.seek(frameAt(e.clientX))
  drag(
    (ev) => usePlayhead.getState().seek(frameAt(ev.clientX)),
    () => undefined,
  )
}
