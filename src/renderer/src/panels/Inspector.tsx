import { useState, type ReactNode } from 'react'
import type { Command } from '@engine/commands'
import { assetSeconds } from '@engine/media'
import {
  MARKER_COLORS,
  type Clip,
  type Interpolation,
  type Marker,
  type MediaAsset,
  type Rational,
  type Sequence,
  type SpeedPoint,
} from '@engine/model'
import { averageSpeed } from '@engine/speed'
import { formatTimecode, fpsValue } from '@engine/time'
import { companions } from '@engine/timeline'
import { t, td } from '../i18n'
import { formatBytes, formatDuration } from '../lib/format'
import { EmptyState } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import { usePlayhead } from '../state/playhead'
import { selectProject, selectSequence, useProject } from '../state/project'
import { useSelectedMedia } from '../state/selection'
import { RampEditor } from './RampEditor'
import * as Tabs from '@radix-ui/react-tabs'
import { useEditor } from '../state/editor'
import { LookInspector } from './look/LookInspector'
import { ColorEditor, TitleEditor } from './look/TitleEditor'
import { TransitionEditor } from './look/TransitionEditor'
import { SoundInspector } from './sound/SoundInspector'
import { PictureAiTools } from './look/AiTools'
import lookStyles from './look/Look.module.css'
import styles from './Inspector.module.css'

const SIZES: { label: string; width: number; height: number }[] = [
  { label: '16:9 · 1920×1080', width: 1920, height: 1080 },
  { label: '16:9 · 3840×2160', width: 3840, height: 2160 },
  { label: '9:16 · 1080×1920', width: 1080, height: 1920 },
  { label: '1:1 · 1080×1080', width: 1080, height: 1080 },
  { label: '4:5 · 1080×1350', width: 1080, height: 1350 },
  { label: '21:9 · 2560×1080', width: 2560, height: 1080 },
]

const RATES: Rational[] = [
  { num: 24000, den: 1001 },
  { num: 24, den: 1 },
  { num: 25, den: 1 },
  { num: 30000, den: 1001 },
  { num: 30, den: 1 },
  { num: 50, den: 1 },
  { num: 60000, den: 1001 },
  { num: 60, den: 1 },
]

const rateLabel = (r: Rational) => String(Number(fpsValue(r).toFixed(3)))

export function Inspector() {
  const project = useProject(selectProject)
  const sequence = useProject(selectSequence)
  const selection = useProject((s) => s.selection)
  const markerId = useProject((s) => s.selectedMarker)
  const selectedTransition = useProject((s) => s.selectedTransition)
  const inspectorTab = useEditor((s) => s.inspectorTab)
  const mediaId = useSelectedMedia((s) => s.mediaId)

  let content: ReactNode
  // A linked pair counts as one selection; show its picture clip.
  const groups = new Set(selection.map((id) => [...companions(sequence, [id])].sort().join()))
  const clips = selection.map((id) => sequence.clips[id]).filter((c): c is Clip => Boolean(c))
  const primary =
    clips.find((c) => sequence.tracks.find((tr) => tr.id === c.trackId)?.kind === 'video') ??
    clips[0]
  const marker = markerId ? sequence.markers[markerId] : undefined

  const transition = selectedTransition ? sequence.transitions[selectedTransition] : undefined
  if (marker) {
    content = <MarkerEditor key={marker.id} marker={marker} sequence={sequence} />
  } else if (transition) {
    content = <TransitionEditor key={transition.id} transition={transition} sequence={sequence} />
  } else if (primary && groups.size === 1) {
    const asset = project.media[primary.mediaId]
    const onVideo = sequence.tracks.find((tr) => tr.id === primary.trackId)?.kind === 'video'
    const extra =
      asset?.generator === 'title' ? 'title' : asset?.generator === 'color' ? 'color' : null
    // The sound of a linked pair lives on its audio clip.
    const soundClip = clips.find(
      (c) => sequence.tracks.find((tr) => tr.id === c.trackId)?.kind === 'audio',
    )
    const tab =
      (inspectorTab === 'title' && !extra) ||
      (inspectorTab === 'look' && !onVideo) ||
      (inspectorTab === 'sound' && !soundClip)
        ? 'clip'
        : inspectorTab
    content = (
      <Tabs.Root
        value={tab}
        onValueChange={(v) => useEditor.setState({ inspectorTab: v as typeof inspectorTab })}
      >
        <Tabs.List className={lookStyles.tabs} aria-label={t('inspector.tabs')}>
          <Tabs.Trigger value="clip" className={lookStyles.tab}>
            {t('inspector.clip')}
          </Tabs.Trigger>
          {onVideo ? (
            <Tabs.Trigger value="look" className={lookStyles.tab}>
              {t('inspector.look')}
            </Tabs.Trigger>
          ) : null}
          {extra ? (
            <Tabs.Trigger value="title" className={lookStyles.tab}>
              {extra === 'title' ? t('inspector.titleTab') : t('inspector.colorTab')}
            </Tabs.Trigger>
          ) : null}
          {soundClip ? (
            <Tabs.Trigger value="sound" className={lookStyles.tab}>
              {t('inspector.sound')}
            </Tabs.Trigger>
          ) : null}
        </Tabs.List>
        <Tabs.Content value="clip">
          <Section title={t('inspector.clip')}>
            <Row label={t('inspector.name')} value={asset?.name ?? t('timeline.missingMedia')} />
            <Row
              label={t('inspector.start')}
              value={formatTimecode(primary.start, sequence.fps)}
              mono
            />
            <Row
              label={t('inspector.duration')}
              value={formatTimecode(primary.duration, sequence.fps)}
              mono
            />
            <Row
              label={t('inspector.sourceIn')}
              value={formatTimecode(primary.sourceIn, sequence.fps)}
              mono
            />
          </Section>
          {primary.angle !== null && asset?.sequenceId ? (
            <Angles
              clip={primary}
              sequence={sequence}
              inner={project.sequences[asset.sequenceId]}
            />
          ) : null}
          <SpeedSection key={primary.id} clip={primary} clips={clips} sequence={sequence} />
          {onVideo && asset?.kind === 'video' ? <PictureAiTools clip={primary} /> : null}
          {asset ? <MediaInfo asset={asset} /> : null}
        </Tabs.Content>
        {onVideo ? (
          <Tabs.Content value="look">
            <LookInspector clip={primary} sequence={sequence} />
          </Tabs.Content>
        ) : null}
        {extra ? (
          <Tabs.Content value="title">
            {extra === 'title' ? (
              <TitleEditor clip={primary} sequence={sequence} />
            ) : (
              <ColorEditor clip={primary} sequence={sequence} />
            )}
          </Tabs.Content>
        ) : null}
        {soundClip ? (
          <Tabs.Content value="sound">
            <SoundInspector key={soundClip.id} clip={soundClip} sequence={sequence} />
          </Tabs.Content>
        ) : null}
      </Tabs.Root>
    )
  } else if (clips.length > 1) {
    content = (
      <EmptyState
        title={t('inspector.multiple', { count: clips.length })}
        body={t('inspector.multipleBody')}
      />
    )
  } else if (mediaId && project.media[mediaId]) {
    content = <MediaInfo asset={project.media[mediaId]} />
  } else {
    content = <SequenceSettings sequence={sequence} />
  }

  return (
    <Panel.Root label={t('panel.inspector')} area="inspector">
      <Panel.Header>
        <Panel.Title>{t('panel.inspector')}</Panel.Title>
      </Panel.Header>
      <Panel.Body>{content}</Panel.Body>
    </Panel.Root>
  )
}

function SpeedSection({
  clip,
  clips,
  sequence,
}: {
  clip: Clip
  clips: Clip[]
  sequence: Sequence
}) {
  const dispatch = useProject((s) => s.dispatch)
  const [ripple, setRipple] = useState(true)
  const [draft, setDraft] = useState(String(Math.round(averageSpeed(clip) * 100)))
  const frozen = !clip.ramp && clip.speed === 0

  const apply = (patch: {
    speed?: number
    reverse?: boolean
    ramp?: SpeedPoint[] | null
    interpolation?: Interpolation
  }) => {
    // Linked clips change speed together so picture and sound stay in sync.
    const commands: Command[] = clips.map((c) => ({
      type: 'clip.speed',
      sequenceId: sequence.id,
      clipId: c.id,
      speed: patch.speed ?? c.speed,
      reverse: patch.reverse ?? c.reverse,
      ramp: patch.ramp === undefined ? c.ramp : patch.ramp,
      interpolation: patch.interpolation ?? c.interpolation,
      ripple,
    }))
    dispatch({ type: 'batch', label: t('history.speed'), commands })
  }

  const commitPercent = () => {
    const pct = Number(draft)
    if (!Number.isFinite(pct) || pct < 5 || pct > 2000) {
      setDraft(String(Math.round(averageSpeed(clip) * 100)))
      return
    }
    apply({ speed: pct / 100, ramp: null })
  }

  return (
    <Section title={t('inspector.speed')}>
      <label className={styles.field}>
        <span>{t('inspector.speedPercent')}</span>
        <input
          type="number"
          min={5}
          max={2000}
          step={5}
          value={draft}
          disabled={frozen || Boolean(clip.ramp)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitPercent}
          onKeyDown={(e) => e.key === 'Enter' && commitPercent()}
        />
      </label>
      <div className={styles.presets}>
        {[25, 50, 100, 200, 400].map((p) => (
          <button
            key={p}
            type="button"
            className={styles.chip}
            onClick={() => {
              setDraft(String(p))
              apply({ speed: p / 100, ramp: null })
            }}
          >
            {p}%
          </button>
        ))}
      </div>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={clip.reverse}
          onChange={(e) => apply({ reverse: e.target.checked })}
        />
        {t('inspector.reverse')}
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={frozen}
          onChange={(e) => apply({ speed: e.target.checked ? 0 : 1, ramp: null })}
        />
        {t('inspector.hold')}
      </label>
      <label className={styles.check}>
        <input type="checkbox" checked={ripple} onChange={(e) => setRipple(e.target.checked)} />
        {t('inspector.rippleSpeed')}
      </label>
      <label className={styles.field}>
        <span>{t('inspector.interpolation')}</span>
        <select
          value={clip.interpolation}
          onChange={(e) => apply({ interpolation: e.target.value as Interpolation })}
        >
          <option value="none">{t('inspector.interp.none')}</option>
          <option value="blend">{t('inspector.interp.blend')}</option>
          <option value="optical-flow">{t('inspector.interp.flow')}</option>
        </select>
      </label>
      <p className={styles.hint}>{t('inspector.interpHint')}</p>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={Boolean(clip.ramp)}
          disabled={frozen}
          onChange={(e) =>
            apply({
              ramp: e.target.checked
                ? [
                    { at: 0, speed: clip.speed || 1 },
                    { at: clip.duration, speed: clip.speed || 1 },
                  ]
                : null,
              speed: clip.ramp ? averageSpeed(clip) : clip.speed,
            })
          }
        />
        {t('inspector.ramp')}
      </label>
      {clip.ramp ? <RampEditor clip={clip} onChange={(ramp) => apply({ ramp })} /> : null}
    </Section>
  )
}

function Angles({
  clip,
  sequence,
  inner,
}: {
  clip: Clip
  sequence: Sequence
  inner: Sequence | undefined
}) {
  const dispatch = useProject((s) => s.dispatch)
  if (!inner) return null
  const angles = inner.tracks.filter((tr) => tr.kind === 'video')
  return (
    <Section title={t('inspector.angles')}>
      <div className={styles.presets} role="radiogroup" aria-label={t('inspector.angles')}>
        {angles.map((tr, i) => (
          <button
            key={tr.id}
            type="button"
            role="radio"
            aria-checked={clip.angle === i}
            className={styles.chip}
            data-active={clip.angle === i}
            onClick={() =>
              dispatch({
                type: 'clip.update',
                sequenceId: sequence.id,
                clipIds: [clip.id],
                patch: { angle: i },
              })
            }
          >
            {i + 1}. {tr.name}
          </button>
        ))}
      </div>
      <p className={styles.hint}>{t('inspector.anglesHint')}</p>
    </Section>
  )
}

function MarkerEditor({ marker, sequence }: { marker: Marker; sequence: Sequence }) {
  const dispatch = useProject((s) => s.dispatch)
  const update = (patch: Partial<Marker>) =>
    dispatch({ type: 'marker.update', sequenceId: sequence.id, markerId: marker.id, patch })
  return (
    <Section title={t('inspector.marker')}>
      <Row
        label={t('inspector.position')}
        value={formatTimecode(marker.frame, sequence.fps)}
        mono
      />
      <label className={styles.field}>
        <span>{t('inspector.name')}</span>
        <input
          defaultValue={marker.name}
          onBlur={(e) => e.target.value !== marker.name && update({ name: e.target.value })}
        />
      </label>
      <label className={styles.fieldStack}>
        <span>{t('inspector.note')}</span>
        <textarea
          rows={3}
          defaultValue={marker.note}
          onBlur={(e) => e.target.value !== marker.note && update({ note: e.target.value })}
        />
      </label>
      <div className={styles.field}>
        <span id="marker-color">{t('inspector.color')}</span>
        <div className={styles.swatches} role="radiogroup" aria-labelledby="marker-color">
          {MARKER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={marker.color === c}
              aria-label={td(`marker.${c}`)}
              className={styles.swatch}
              data-color={c}
              onClick={() => update({ color: c })}
            />
          ))}
        </div>
      </div>
      <div className={styles.presets}>
        <button
          type="button"
          className={styles.chip}
          onClick={() => usePlayhead.getState().seek(marker.frame)}
        >
          {t('inspector.goToMarker')}
        </button>
        <button
          type="button"
          className={styles.chip}
          onClick={() =>
            dispatch({ type: 'marker.remove', sequenceId: sequence.id, markerIds: [marker.id] })
          }
        >
          {t('inspector.deleteMarker')}
        </button>
      </div>
    </Section>
  )
}

function MediaInfo({ asset }: { asset: MediaAsset }) {
  const project = useProject(selectProject)
  const seconds = assetSeconds(project, asset)
  return (
    <Section title={t('inspector.media')}>
      <Row label={t('inspector.name')} value={asset.name} />
      <Row label={t('inspector.type')} value={td(`inspector.kind.${asset.kind}`)} />
      {asset.width && asset.height ? (
        <Row label={t('inspector.size')} value={`${asset.width}×${asset.height}`} mono />
      ) : null}
      {asset.fps ? (
        <Row
          label={t('inspector.frameRate')}
          value={
            asset.vfr ? t('inspector.vfr', { fps: rateLabel(asset.fps) }) : rateLabel(asset.fps)
          }
          mono
        />
      ) : null}
      {seconds !== null ? (
        <Row label={t('inspector.length')} value={formatDuration(seconds)} mono />
      ) : null}
      {asset.videoCodec && asset.kind !== 'image' ? (
        <Row label={t('inspector.videoCodec')} value={asset.videoCodec} />
      ) : null}
      {asset.audioCodec ? (
        <Row
          label={t('inspector.audio')}
          value={t('inspector.audioValue', {
            codec: asset.audioCodec,
            rate: asset.sampleRate ?? 0,
            channels: asset.channels ?? 0,
          })}
        />
      ) : null}
      {asset.marks.in !== null || asset.marks.out !== null ? (
        <Row
          label={t('inspector.marks')}
          value={`${asset.marks.in === null ? '–' : formatDuration(asset.marks.in)} → ${asset.marks.out === null ? '–' : formatDuration(asset.marks.out)}`}
          mono
        />
      ) : null}
      {asset.kind !== 'sequence' ? (
        <Row label={t('inspector.fileSize')} value={formatBytes(asset.size)} mono />
      ) : null}
      {asset.kind !== 'sequence' ? (
        <Row label={t('inspector.location')} value={asset.path} wrap />
      ) : null}
    </Section>
  )
}

function SequenceSettings({ sequence }: { sequence: Sequence }) {
  const dispatch = useProject((s) => s.dispatch)
  const hasClips = Object.keys(sequence.clips).length > 0
  const sizeValue = `${sequence.width}x${sequence.height}`
  const known = SIZES.some((s) => `${s.width}x${s.height}` === sizeValue)

  return (
    <Section title={t('inspector.sequence')}>
      <label className={styles.field}>
        <span>{t('inspector.name')}</span>
        <input
          key={sequence.id}
          defaultValue={sequence.name}
          onBlur={(e) => {
            const name = e.target.value.trim()
            if (name && name !== sequence.name)
              dispatch({ type: 'sequence.settings', sequenceId: sequence.id, name })
          }}
        />
      </label>
      <label className={styles.field}>
        <span>{t('inspector.size')}</span>
        <select
          value={sizeValue}
          onChange={(e) => {
            const [width, height] = e.target.value.split('x').map(Number)
            dispatch({
              type: 'sequence.settings',
              sequenceId: sequence.id,
              width: width!,
              height: height!,
            })
          }}
        >
          {known ? null : (
            <option value={sizeValue}>{`${sequence.width}×${sequence.height}`}</option>
          )}
          {SIZES.map((s) => (
            <option key={s.label} value={`${s.width}x${s.height}`}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>{t('inspector.frameRate')}</span>
        <select
          value={`${sequence.fps.num}/${sequence.fps.den}`}
          disabled={hasClips}
          onChange={(e) => {
            const [num, den] = e.target.value.split('/').map(Number)
            dispatch({
              type: 'sequence.settings',
              sequenceId: sequence.id,
              fps: { num: num!, den: den! },
            })
          }}
        >
          {RATES.some((r) => r.num === sequence.fps.num && r.den === sequence.fps.den) ? null : (
            <option value={`${sequence.fps.num}/${sequence.fps.den}`}>
              {rateLabel(sequence.fps)}
            </option>
          )}
          {RATES.map((r) => (
            <option key={`${r.num}/${r.den}`} value={`${r.num}/${r.den}`}>
              {rateLabel(r)}
            </option>
          ))}
        </select>
      </label>
      <p className={styles.hint}>
        {hasClips ? t('inspector.rateLocked') : t('inspector.rateHint')}
      </p>
      <label className={styles.field}>
        <span>{t('inspector.colorSpace')}</span>
        <select
          value={sequence.colorSpace}
          disabled={sequence.hdr !== 'sdr'}
          onChange={(e) =>
            dispatch({
              type: 'sequence.settings',
              sequenceId: sequence.id,
              colorSpace: e.target.value as Sequence['colorSpace'],
            })
          }
        >
          <option value="rec709">{t('inspector.space.rec709')}</option>
          <option value="p3">{t('inspector.space.p3')}</option>
          <option value="rec2020">{t('inspector.space.rec2020')}</option>
        </select>
      </label>
      <label className={styles.field}>
        <span>{t('inspector.dynamicRange')}</span>
        <select
          value={sequence.hdr}
          onChange={(e) =>
            dispatch({
              type: 'sequence.settings',
              sequenceId: sequence.id,
              hdr: e.target.value as Sequence['hdr'],
            })
          }
        >
          <option value="sdr">{t('inspector.hdr.sdr')}</option>
          <option value="pq">{t('inspector.hdr.pq')}</option>
          <option value="hlg">{t('inspector.hdr.hlg')}</option>
        </select>
      </label>
      {sequence.hdr !== 'sdr' ? <p className={styles.hint}>{t('inspector.hdrHint')}</p> : null}
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={sequence.magnetic}
          onChange={(e) =>
            dispatch({
              type: 'sequence.settings',
              sequenceId: sequence.id,
              magnetic: e.target.checked,
            })
          }
        />
        {t('inspector.magnetic')}
      </label>
      <p className={styles.hint}>{t('inspector.magneticHint')}</p>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  )
}

function Row({
  label,
  value,
  mono = false,
  wrap = false,
}: {
  label: string
  value: string
  mono?: boolean
  wrap?: boolean
}) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span
        className={[styles.value, mono ? 'tabular' : '', wrap ? styles.wrap : ''].join(' ')}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}
