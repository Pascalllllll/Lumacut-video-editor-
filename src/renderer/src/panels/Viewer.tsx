import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowDownToLine,
  CornerDownRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
} from 'lucide-react'
import { assetSeconds } from '@engine/media'
import { formatTimecode, framesToSeconds, secondsToFrames } from '@engine/time'
import { sequenceDuration } from '@engine/timeline'
import { t } from '../i18n'
import { mark, sourceEdit } from '../lib/actions'
import { playbackUrl } from '../lib/media-url'
import { Player, setCurrentPlayer } from '../lib/player'
import { ViewerOverlay } from './ViewerOverlay'
import { useSettings } from '../state/settings'
import { EmptyState } from '../components/EmptyState'
import { IconButton } from '../components/IconButton'
import { Panel } from '../components/Panel'
import { useEditor } from '../state/editor'
import { usePlayhead } from '../state/playhead'
import { selectProject, selectSequence, useProject } from '../state/project'
import styles from './Viewer.module.css'

const ICON = { size: 15, strokeWidth: 1.6 } as const

export function Viewer() {
  const viewer = useEditor((s) => s.viewer)
  const sourceId = useEditor((s) => s.sourceMediaId)
  const sequence = useProject(selectSequence)

  return (
    <Panel.Root label={t('panel.viewer')} area="viewer">
      <Panel.Header>
        <div className={styles.tabs} role="tablist" aria-label={t('viewer.which')}>
          <button
            type="button"
            role="tab"
            aria-selected={viewer === 'source'}
            className={styles.tab}
            disabled={!sourceId}
            onClick={() => useEditor.setState({ viewer: 'source' })}
          >
            {t('viewer.source')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewer === 'timeline'}
            className={styles.tab}
            onClick={() => useEditor.setState({ viewer: 'timeline' })}
          >
            {t('viewer.timeline')}
          </button>
        </div>
        <span className={`${styles.format} tabular`}>
          {t('viewer.format', {
            width: sequence.width,
            height: sequence.height,
            fps: Number((sequence.fps.num / sequence.fps.den).toFixed(3)),
          })}
        </span>
      </Panel.Header>
      {/* Both stay mounted so switching keeps their position. */}
      <div className={styles.view} hidden={viewer !== 'timeline'}>
        <ProgramView />
      </div>
      <div className={styles.view} hidden={viewer !== 'source'}>
        <SourceView />
      </div>
    </Panel.Root>
  )
}

function ProgramView() {
  const sequence = useProject(selectSequence)
  const hasClips = Object.keys(sequence.clips).length > 0
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const [drawError, setDrawError] = useState<string | null>(null)

  useEffect(() => {
    if (!canvasRef.current || !hostRef.current) return
    // Without WebGL2 this throws, and the panel shows why while the rest of the editor works.
    const player = new Player(
      canvasRef.current,
      hostRef.current,
      {
        project: () => useProject.getState().history.project,
        sequence: () => selectSequence(useProject.getState()),
        url: playbackUrl,
        scale: () =>
          previewScale(
            selectSequence(useProject.getState()).height,
            useSettings.getState().settings.previewQuality,
          ),
      },
      (frame) => usePlayhead.getState().seek(frame),
      () => usePlayhead.getState().setPlaying(false),
      setDrawError,
    )
    setCurrentPlayer(player)
    player.show(usePlayhead.getState().frame)

    // Follow the playhead and play state without re-rendering this component.
    const unsubscribe = usePlayhead.subscribe((state, prev) => {
      if (state.playing !== prev.playing || state.rate !== prev.rate) {
        if (state.playing) player.play(state.frame, state.rate)
        else {
          player.stop()
          player.show(state.frame)
        }
      } else if (!state.playing && state.frame !== prev.frame) {
        player.show(state.frame)
      } else if (state.playing && state.frame !== player.reportedFrame) {
        // Someone moved the playhead during playback: carry on from there, or stop at an end.
        const end = sequenceDuration(selectSequence(useProject.getState()))
        if ((state.rate > 0 && state.frame >= end) || (state.rate < 0 && state.frame <= 0))
          state.setPlaying(false)
        else player.play(state.frame, state.rate)
      }
    })
    const unsubscribeProject = useProject.subscribe((state, prev) => {
      if (state.history.project !== prev.history.project && !usePlayhead.getState().playing)
        player.show(usePlayhead.getState().frame)
    })
    const unsubscribeProxies = useEditor.subscribe((state, prev) => {
      if (state.proxies !== prev.proxies && !usePlayhead.getState().playing)
        player.show(usePlayhead.getState().frame)
    })
    const unsubscribeSettings = useSettings.subscribe((state, prev) => {
      if (
        state.settings.previewQuality !== prev.settings.previewQuality &&
        !usePlayhead.getState().playing
      )
        player.show(usePlayhead.getState().frame)
    })
    return () => {
      unsubscribe()
      unsubscribeProject()
      unsubscribeProxies()
      unsubscribeSettings()
      player.dispose()
    }
  }, [])

  return (
    <>
      <div className={styles.body}>
        <div className={styles.stage}>
          <div
            className={styles.frame}
            style={{ '--ar': sequence.width / sequence.height } as CSSProperties}
          >
            <canvas
              ref={canvasRef}
              className={styles.media}
              data-testid="program-canvas"
              aria-label={t('viewer.picture')}
            />
            <ViewerOverlay />
            <div ref={hostRef} hidden />
          </div>
        </div>
        {drawError ? (
          <div className={styles.drawError} role="alert">
            {t('viewer.drawError', { reason: drawError })}
          </div>
        ) : null}
        {hasClips ? null : (
          <div className={styles.overlay}>
            <EmptyState title={t('empty.viewer.title')} body={t('empty.viewer.body')} />
          </div>
        )}
      </div>
      <ProgramTransport />
    </>
  )
}

function ProgramTransport() {
  const playing = usePlayhead((s) => s.playing)
  const rate = usePlayhead((s) => s.rate)
  const frame = usePlayhead((s) => s.frame)
  const sequence = useProject(selectSequence)
  const end = sequenceDuration(sequence)
  const { seek, setPlaying } = usePlayhead.getState()
  const disabled = end === 0

  return (
    <div className={styles.transport}>
      <span className={`${styles.timecode} tabular`} aria-label={t('panel.playhead')}>
        {formatTimecode(frame, sequence.fps)}
        {playing && rate !== 1 ? (
          <span className={styles.rate}>{rate > 0 ? `${rate}×` : `−${-rate}×`}</span>
        ) : null}
      </span>
      <div className={styles.controls}>
        <IconButton label={t('transport.start')} disabled={disabled} onClick={() => seek(0)}>
          <SkipBack {...ICON} />
        </IconButton>
        <IconButton label={t('transport.back')} disabled={disabled} onClick={() => seek(frame - 1)}>
          <StepBack {...ICON} />
        </IconButton>
        <IconButton
          label={playing ? t('transport.pause') : t('transport.play')}
          disabled={disabled}
          onClick={() => setPlaying(!playing)}
          className={styles.play}
        >
          {playing ? <Pause {...ICON} /> : <Play {...ICON} />}
        </IconButton>
        <IconButton
          label={t('transport.forward')}
          disabled={disabled}
          onClick={() => seek(Math.min(end, frame + 1))}
        >
          <StepForward {...ICON} />
        </IconButton>
        <IconButton label={t('transport.end')} disabled={disabled} onClick={() => seek(end)}>
          <SkipForward {...ICON} />
        </IconButton>
      </div>
      <span className={`${styles.duration} tabular`} aria-label={t('transport.duration')}>
        {formatTimecode(end, sequence.fps)}
      </span>
    </div>
  )
}

function SourceView() {
  const sourceId = useEditor((s) => s.sourceMediaId)
  const project = useProject(selectProject)
  const sequence = useProject(selectSequence)
  const asset = sourceId ? project.media[sourceId] : undefined
  const videoRef = useRef<HTMLVideoElement>(null)
  const time = useEditor((s) => s.sourceTime)
  const [playing, setPlaying] = useState(false)
  const length = asset ? (assetSeconds(project, asset) ?? 0) : 0
  const fps = asset?.fps ?? sequence.fps

  // Keep the element on the stored time when it changes from outside (marks, scrubbing).
  useEffect(() => {
    const v = videoRef.current
    if (v && !playing && Math.abs(v.currentTime - time) > 0.01) v.currentTime = time
  }, [time, playing, asset])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const toggle = () => (v.paused ? void v.play() : v.pause())
    const shuttle = (e: Event) => {
      const key = (e as CustomEvent<string>).detail
      if (key === 'K') v.pause()
      else if (key === 'L') {
        v.playbackRate = v.paused ? 1 : Math.min(8, v.playbackRate * 2)
        void v.play()
      } else {
        v.pause()
        useEditor.setState({ sourceTime: Math.max(0, v.currentTime - 1) })
      }
    }
    window.addEventListener('lumacut:source-toggle', toggle)
    window.addEventListener('lumacut:source-shuttle', shuttle)
    return () => {
      window.removeEventListener('lumacut:source-toggle', toggle)
      window.removeEventListener('lumacut:source-shuttle', shuttle)
    }
  }, [])

  if (!asset) {
    return (
      <div className={styles.body}>
        <EmptyState title={t('empty.source.title')} body={t('empty.source.body')} />
      </div>
    )
  }

  const ar = asset.width && asset.height ? asset.width / asset.height : 16 / 9
  const markIn = asset.marks.in
  const markOut = asset.marks.out
  const pct = (s: number | null) => (length > 0 && s !== null ? `${(s / length) * 100}%` : '0%')
  const step = (frames: number) =>
    useEditor.setState({
      sourceTime: Math.min(length, Math.max(0, time + framesToSeconds(frames, fps))),
    })

  return (
    <>
      <div className={styles.body}>
        <div className={styles.stage}>
          <div className={styles.frame} style={{ '--ar': ar } as CSSProperties}>
            {asset.kind === 'image' ? (
              <img className={styles.media} src={playbackUrl(asset)} alt="" />
            ) : (
              <video
                ref={videoRef}
                className={styles.media}
                src={playbackUrl(asset)}
                preload="auto"
                playsInline
                data-testid="source-video"
                onPlay={() => setPlaying(true)}
                onPause={(e) => {
                  setPlaying(false)
                  useEditor.setState({ sourceTime: e.currentTarget.currentTime })
                }}
                onTimeUpdate={(e) =>
                  useEditor.setState({ sourceTime: e.currentTarget.currentTime })
                }
              />
            )}
          </div>
        </div>
      </div>
      <div
        className={styles.scrub}
        role="slider"
        tabIndex={0}
        aria-label={t('viewer.sourcePosition')}
        aria-valuemin={0}
        aria-valuemax={Math.round(length)}
        aria-valuenow={Math.round(time)}
        onPointerDown={(e) => {
          const bar = e.currentTarget.getBoundingClientRect()
          const at = (x: number) =>
            Math.min(length, Math.max(0, ((x - bar.left) / bar.width) * length))
          videoRef.current?.pause()
          useEditor.setState({ sourceTime: at(e.clientX) })
          const move = (ev: PointerEvent) => useEditor.setState({ sourceTime: at(ev.clientX) })
          const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      >
        {markIn !== null || markOut !== null ? (
          <div
            className={styles.range}
            style={{ left: pct(markIn ?? 0), right: `calc(100% - ${pct(markOut ?? length)})` }}
          />
        ) : null}
        <div className={styles.scrubHead} style={{ left: pct(time) }} />
      </div>
      <div className={styles.transport}>
        <span className={`${styles.timecode} tabular`} aria-label={t('viewer.sourceTimecode')}>
          {formatTimecode(secondsToFrames(time, fps), fps)}
        </span>
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.markButton}
            onClick={() => mark('in')}
            title={t('viewer.markInHint')}
          >
            {t('viewer.markIn')}
          </button>
          <IconButton label={t('transport.back')} onClick={() => step(-1)}>
            <StepBack {...ICON} />
          </IconButton>
          <IconButton
            label={playing ? t('transport.pause') : t('transport.play')}
            onClick={() =>
              videoRef.current?.paused ? void videoRef.current.play() : videoRef.current?.pause()
            }
            className={styles.play}
            disabled={asset.kind === 'image'}
          >
            {playing ? <Pause {...ICON} /> : <Play {...ICON} />}
          </IconButton>
          <IconButton label={t('transport.forward')} onClick={() => step(1)}>
            <StepForward {...ICON} />
          </IconButton>
          <button
            type="button"
            className={styles.markButton}
            onClick={() => mark('out')}
            title={t('viewer.markOutHint')}
          >
            {t('viewer.markOut')}
          </button>
        </div>
        <div className={styles.editButtons}>
          <IconButton label={t('viewer.insert')} onClick={() => sourceEdit('insert')}>
            <CornerDownRight {...ICON} />
          </IconButton>
          <IconButton label={t('viewer.overwrite')} onClick={() => sourceEdit('overwrite')}>
            <ArrowDownToLine {...ICON} />
          </IconButton>
        </div>
      </div>
    </>
  )
}

/** Preview size relative to the sequence: automatic keeps previews near 1080 lines tall. */
export function previewScale(
  height: number,
  quality: 'auto' | 'full' | 'half' | 'quarter',
): number {
  if (quality === 'full') return 1
  if (quality === 'half') return 0.5
  if (quality === 'quarter') return 0.25
  return height > 1200 ? 0.5 : 1
}
