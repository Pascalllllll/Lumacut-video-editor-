import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type RefObject,
} from 'react'
import {
  ArrowLeftRight,
  Blend,
  Maximize2,
  Gauge,
  Link2,
  Magnet,
  MousePointer2,
  Move,
  Plus,
  Scissors,
  SeparatorVertical,
  SquareSplitHorizontal,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { dropCommand } from '@engine/edits'
import { createTrack, type Clip, type MediaAsset, type Track, type Transition } from '@engine/model'
import { formatTimecode, fpsValue } from '@engine/time'
import { clipEnd, sequenceDuration } from '@engine/timeline'
import { t } from '../../i18n'
import { importMedia } from '../../lib/actions'
import { EmptyState } from '../../components/EmptyState'
import { IconButton } from '../../components/IconButton'
import { Panel } from '../../components/Panel'
import { TOOLS, useEditor, type Tool } from '../../state/editor'
import { notify } from '../../state/notices'
import { usePlayhead } from '../../state/playhead'
import { addedClip, selectProject, useProject } from '../../state/project'
import { useSettings } from '../../state/settings'
import { useSelectedMedia } from '../../state/selection'
import { filesFromDrop, MEDIA_DRAG_TYPE } from '../MediaBin'
import {
  EFFECT_DRAG,
  GENERATOR_DRAG,
  generatorPlacement,
  TRANSITION_DRAG,
  type GeneratorItem,
} from '../Library'
import { createEffect } from '@engine/effects'
import { transitionCommand } from '@engine/edits'
import { allKeyFrames } from '@engine/look'
import { TransitionBlock } from './TransitionBlock'
import { ClipView } from './ClipView'
import { displayTracks, HEADER_W, RULER_H, snap, trackHeight, ZOOM_MAX, ZOOM_MIN } from './geometry'
import { beginClipPointer, beginScrub, type DragPreview } from './interactions'
import { Ruler } from './Ruler'
import { TrackHeader } from './TrackHeader'
import styles from './Timeline.module.css'

const TOOL_ICON: Record<Tool, typeof MousePointer2> = {
  select: MousePointer2,
  blade: Scissors,
  ripple: SquareSplitHorizontal,
  roll: SeparatorVertical,
  slip: ArrowLeftRight,
  slide: Move,
  rate: Gauge,
}

export function Timeline() {
  const project = useProject(selectProject)
  const sequence = project.sequences[project.activeSequenceId]!
  const selection = useProject((s) => s.selection)
  const tool = useEditor((s) => s.tool)
  const snapping = useSettings((s) => s.settings.snapping)
  const linkedSelection = useSettings((s) => s.settings.linkedSelection)
  const [pxPerFrame, setPxPerFrame] = useState(2)
  const [preview, setPreview] = useState<DragPreview | null>(null)
  const [dropTrack, setDropTrack] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(800)

  const duration = sequenceDuration(sequence)
  const fps = fpsValue(sequence.fps)
  const laneWidth = Math.max(viewport - HEADER_W, (duration + fps * 10) * pxPerFrame)
  const isEmpty = Object.keys(sequence.clips).length === 0
  const tracks = displayTracks(sequence)
  const clipsByTrack = new Map<string, (typeof sequence.clips)[string][]>()
  for (const c of Object.values(sequence.clips)) {
    const trackId =
      preview?.kind === 'move' && preview.anchorId === c.id ? preview.trackId : c.trackId
    clipsByTrack.set(trackId, [...(clipsByTrack.get(trackId) ?? []), c])
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewport(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Fit the whole sequence the first time clips arrive in a sequence.
  const fittedFor = useRef<string | null>(null)
  useEffect(() => {
    if (isEmpty) fittedFor.current = null
    else if (fittedFor.current !== sequence.id && duration > 0) {
      fittedFor.current = sequence.id
      setPxPerFrame(
        Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, ((viewport - HEADER_W) * 0.85) / duration)),
      )
    }
  }, [isEmpty, duration, viewport, sequence.id])

  const frameAt = useCallback(
    (clientX: number) => {
      const el = scrollRef.current
      if (!el) return 0
      const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - HEADER_W
      return Math.max(0, Math.round(x / pxPerFrame))
    },
    [pxPerFrame],
  )

  const zoomBy = (factor: number, anchorClientX?: number) => {
    const el = scrollRef.current
    if (!el) return
    const anchorX =
      (anchorClientX === undefined
        ? HEADER_W + (el.clientWidth - HEADER_W) / 2
        : anchorClientX - el.getBoundingClientRect().left) - HEADER_W
    const frame = (anchorX + el.scrollLeft) / pxPerFrame
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pxPerFrame * factor))
    setPxPerFrame(next)
    requestAnimationFrame(() => {
      el.scrollLeft = frame * next - anchorX
    })
  }

  const fitAll = useCallback(() => {
    if (duration > 0)
      setPxPerFrame(
        Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, ((viewport - HEADER_W) * 0.95) / duration)),
      )
    if (scrollRef.current) scrollRef.current.scrollLeft = 0
  }, [duration, viewport])

  useEffect(() => {
    window.addEventListener('lumacut:zoom-fit', fitAll)
    return () => window.removeEventListener('lumacut:zoom-fit', fitAll)
  }, [fitAll])

  const ctx = {
    sequence,
    tool,
    pxPerFrame,
    frameAt,
    setPreview,
    formatDelta: (frames: number) =>
      `${frames < 0 ? '−' : '+'}${formatTimecode(Math.abs(frames), sequence.fps)}`,
  }

  const onLaneDrop = async (e: DragEvent, track: Track) => {
    e.preventDefault()
    setDropTrack(null)
    const points = [
      0,
      usePlayhead.getState().frame,
      ...Object.values(sequence.clips).flatMap((c) => [c.start, clipEnd(c)]),
    ]
    const frame = snap(frameAt(e.clientX), points, pxPerFrame, snapping)
    const generator = e.dataTransfer.getData(GENERATOR_DRAG)
    if (generator) {
      if (track.kind !== 'video') {
        notify('error', t('errors.generatorOnAudio'))
        return
      }
      try {
        useProject
          .getState()
          .dispatch(generatorPlacement(JSON.parse(generator) as GeneratorItem, track.id, frame))
      } catch (error) {
        notify('error', error instanceof Error ? error.message : String(error))
      }
      return
    }
    const mediaId = e.dataTransfer.getData(MEDIA_DRAG_TYPE)
    let assets: MediaAsset[] = []
    if (mediaId) {
      const asset = useProject.getState().history.project.media[mediaId]
      if (asset) assets = [asset]
    } else {
      const paths = filesFromDrop(e)
      if (paths.length) assets = await importMedia(paths)
    }
    let at = frame
    for (const asset of assets) {
      try {
        const state = useProject.getState()
        const seq = state.history.project.sequences[state.history.project.activeSequenceId]!
        if (asset.kind === 'audio' && track.kind === 'video')
          throw new Error(t('errors.audioOnVideoTrack'))
        const cmd = dropCommand(state.history.project, seq, asset, at, track.id)
        const added = addedClip(cmd)
        if (state.dispatch(cmd) && added) at = clipEnd(added)
      } catch (error) {
        notify('error', error instanceof Error ? error.message : String(error))
      }
    }
  }

  /** Effects and transitions dropped straight onto a clip. */
  const dropOnClip = (e: DragEvent, clip: Clip) => {
    const effect = e.dataTransfer.getData(EFFECT_DRAG)
    const transition = e.dataTransfer.getData(TRANSITION_DRAG)
    if (!effect && !transition) return false
    e.preventDefault()
    e.stopPropagation()
    setDropTrack(null)
    const state = useProject.getState()
    const seq = state.history.project.sequences[state.history.project.activeSequenceId]!
    try {
      if (effect) {
        state.dispatch({
          type: 'clip.look',
          sequenceId: seq.id,
          clipIds: [clip.id],
          patch: { effects: [...clip.effects, createEffect(effect)] },
        })
      } else {
        const at = frameAt(e.clientX)
        const edge = at - clip.start < clipEnd(clip) - at ? 'start' : 'end'
        state.dispatch(
          transitionCommand(
            seq,
            clip.id,
            edge,
            transition as Transition['type'],
            Math.round(fpsValue(seq.fps)),
          ),
        )
      }
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error))
    }
    return true
  }

  const addTrack = (kind: Track['kind']) => {
    const count = sequence.tracks.filter((tr) => tr.kind === kind).length
    useProject.getState().dispatch({
      type: 'track.add',
      sequenceId: sequence.id,
      track: createTrack(kind, `${kind === 'video' ? 'V' : 'A'}${count + 1}`),
    })
  }

  const contentHeight = RULER_H + tracks.reduce((sum, tr) => sum + trackHeight(tr), 0)
  const range =
    sequence.inPoint !== null && sequence.outPoint !== null && sequence.outPoint > sequence.inPoint
      ? {
          left: sequence.inPoint * pxPerFrame,
          width: (sequence.outPoint - sequence.inPoint) * pxPerFrame,
        }
      : null

  return (
    <Panel.Root label={t('panel.timeline')} area="timeline">
      <SequenceTabs />
      <div className={styles.toolbar}>
        <div className={styles.tools} role="radiogroup" aria-label={t('timeline.tools')}>
          {TOOLS.map(({ id, key }) => {
            const Icon = TOOL_ICON[id]
            return (
              <IconButton
                key={id}
                label={`${t(`tool.${id}`)} (${key})`}
                role="radio"
                aria-checked={tool === id}
                data-active={tool === id}
                className={styles.toolButton}
                onClick={() => useEditor.setState({ tool: id })}
              >
                <Icon size={14} strokeWidth={1.6} />
              </IconButton>
            )
          })}
        </div>
        <div className={styles.toggles}>
          <IconButton
            label={t('timeline.snapping')}
            aria-pressed={snapping}
            data-active={snapping}
            className={styles.toolButton}
            onClick={() => void useSettings.getState().update({ snapping: !snapping })}
          >
            <Blend size={14} strokeWidth={1.6} />
          </IconButton>
          <IconButton
            label={t('timeline.linked')}
            aria-pressed={linkedSelection}
            data-active={linkedSelection}
            className={styles.toolButton}
            onClick={() =>
              void useSettings.getState().update({ linkedSelection: !linkedSelection })
            }
          >
            <Link2 size={14} strokeWidth={1.6} />
          </IconButton>
          <IconButton
            label={t('timeline.magnetic')}
            aria-pressed={sequence.magnetic}
            data-active={sequence.magnetic}
            className={styles.toolButton}
            onClick={() =>
              useProject.getState().dispatch({
                type: 'sequence.settings',
                sequenceId: sequence.id,
                magnetic: !sequence.magnetic,
              })
            }
          >
            <Magnet size={14} strokeWidth={1.6} />
          </IconButton>
        </div>
        <div className={styles.zoom}>
          <IconButton
            label={t('timeline.zoomOut')}
            className={styles.toolButton}
            onClick={() => zoomBy(1 / 1.5)}
          >
            <ZoomOut size={14} strokeWidth={1.6} />
          </IconButton>
          <IconButton
            label={t('timeline.zoomIn')}
            className={styles.toolButton}
            onClick={() => zoomBy(1.5)}
          >
            <ZoomIn size={14} strokeWidth={1.6} />
          </IconButton>
          <IconButton label={t('timeline.zoomFit')} className={styles.toolButton} onClick={fitAll}>
            <Maximize2 size={14} strokeWidth={1.6} />
          </IconButton>
        </div>
        <HeaderTimecode />
      </div>
      <div
        ref={scrollRef}
        className={styles.scroll}
        data-tool={tool}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX)
          }
        }}
      >
        <div
          className={styles.content}
          style={{ width: HEADER_W + laneWidth, height: contentHeight }}
        >
          <div className={styles.rulerRow} style={{ height: RULER_H }}>
            <div className={styles.corner} style={{ width: HEADER_W }}>
              <IconButton
                label={t('track.addVideo')}
                className={styles.toolButton}
                onClick={() => addTrack('video')}
              >
                <Plus size={13} strokeWidth={1.7} />
                <span className={styles.cornerLabel}>V</span>
              </IconButton>
              <IconButton
                label={t('track.addAudio')}
                className={styles.toolButton}
                onClick={() => addTrack('audio')}
              >
                <Plus size={13} strokeWidth={1.7} />
                <span className={styles.cornerLabel}>A</span>
              </IconButton>
            </div>
            <Ruler
              pxPerFrame={pxPerFrame}
              sequence={sequence}
              width={laneWidth}
              onPointerDown={(e) => beginScrub(e, frameAt)}
            />
          </div>
          {tracks.map((track, i) => (
            <div
              key={track.id}
              className={styles.row}
              data-first-audio={track.kind === 'audio' && tracks[i - 1]?.kind === 'video'}
            >
              <TrackHeader track={track} sequence={sequence} />
              <div
                className={styles.lane}
                data-track-id={track.id}
                data-kind={track.kind}
                data-drop={dropTrack === track.id}
                data-locked={track.locked}
                data-off={track.hidden || track.muted}
                style={{ width: laneWidth, height: trackHeight(track) }}
                onPointerDown={(e) => {
                  if (tool !== 'blade') {
                    useProject.getState().select([])
                    // An empty spot on the timeline shows the sequence's settings in the inspector.
                    useSelectedMedia.setState({ mediaIds: [], mediaId: null })
                  }
                  beginScrub(e, frameAt)
                }}
                onDragOver={(e) => {
                  if (
                    e.dataTransfer.types.includes(MEDIA_DRAG_TYPE) ||
                    e.dataTransfer.types.includes(GENERATOR_DRAG) ||
                    e.dataTransfer.types.includes('Files')
                  ) {
                    e.preventDefault()
                    setDropTrack(track.id)
                  }
                }}
                onDragLeave={() => setDropTrack(null)}
                onDrop={(e) => void onLaneDrop(e, track)}
                aria-label={t('timeline.track', { name: track.name })}
                role="list"
              >
                {(clipsByTrack.get(track.id) ?? []).map((clip) => (
                  <ClipView
                    key={clip.id}
                    clip={clip}
                    asset={project.media[clip.mediaId]}
                    sequence={sequence}
                    pxPerFrame={pxPerFrame}
                    selected={selection.includes(clip.id)}
                    preview={preview}
                    onPointerDown={(e, c) =>
                      track.locked ? undefined : beginClipPointer(e, c, ctx)
                    }
                    onDropLook={track.kind === 'video' && !track.locked ? dropOnClip : undefined}
                    laneHeight={trackHeight(track)}
                    locked={track.locked}
                    keyFrames={
                      selection.length === 1 && selection[0] === clip.id ? allKeyFrames(clip) : null
                    }
                  />
                ))}
                {Object.values(sequence.transitions)
                  .filter((tr) => tr.trackId === track.id)
                  .map((tr) => (
                    <TransitionBlock
                      key={tr.id}
                      transition={tr}
                      sequence={sequence}
                      pxPerFrame={pxPerFrame}
                    />
                  ))}
              </div>
            </div>
          ))}
          {range ? (
            <div
              className={styles.rangeShade}
              style={{ left: HEADER_W + range.left, width: range.width, top: RULER_H }}
              aria-hidden="true"
            />
          ) : null}
          <PlayheadLine pxPerFrame={pxPerFrame} scrollRef={scrollRef} />
        </div>
        {isEmpty ? (
          <div className={styles.empty} style={{ left: HEADER_W, top: RULER_H }}>
            <EmptyState title={t('empty.timeline.title')} body={t('empty.timeline.bodyReady')} />
          </div>
        ) : null}
      </div>
    </Panel.Root>
  )
}

function SequenceTabs() {
  const open = useProject((s) => s.openSequences)
  const active = useProject((s) => s.history.project.activeSequenceId)
  const sequences = useProject((s) => s.history.project.sequences)
  return (
    <div className={styles.tabs} role="tablist" aria-label={t('timeline.sequences')}>
      {open.map((id) => {
        const seq = sequences[id]
        if (!seq) return null
        return (
          <div key={id} className={styles.tab} data-active={id === active}>
            <button
              type="button"
              role="tab"
              aria-selected={id === active}
              className={styles.tabButton}
              onClick={() => useProject.getState().openSequence(id)}
            >
              {seq.name}
              {seq.multicam ? (
                <span className={styles.badge}>{t('timeline.badge.multicam')}</span>
              ) : null}
            </button>
            {open.length > 1 ? (
              <button
                type="button"
                className={styles.tabClose}
                aria-label={t('timeline.closeTab', { name: seq.name })}
                onClick={() => useProject.getState().closeSequence(id)}
              >
                <X size={11} strokeWidth={2} />
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function HeaderTimecode() {
  const frame = usePlayhead((s) => s.frame)
  const fps = useProject(
    (s) => s.history.project.sequences[s.history.project.activeSequenceId]!.fps,
  )
  return (
    <span className={`${styles.timecode} tabular`} aria-label={t('panel.playhead')}>
      {formatTimecode(frame, fps)}
    </span>
  )
}

function PlayheadLine({
  pxPerFrame,
  scrollRef,
}: {
  pxPerFrame: number
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  const lineRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const place = (frame: number, playing: boolean) => {
      const x = frame * pxPerFrame
      if (lineRef.current) lineRef.current.style.transform = `translateX(${HEADER_W + x}px)`
      const el = scrollRef.current
      // Page the view along during playback so the playhead stays visible.
      if (
        el &&
        playing &&
        (x > el.scrollLeft + el.clientWidth - HEADER_W - 40 || x < el.scrollLeft)
      )
        el.scrollLeft = Math.max(0, x - 40)
    }
    place(usePlayhead.getState().frame, false)
    return usePlayhead.subscribe((s) => place(s.frame, s.playing))
  }, [pxPerFrame, scrollRef])
  return (
    <div ref={lineRef} className={styles.playhead} aria-hidden="true">
      <div className={styles.playheadKnob} />
    </div>
  )
}
