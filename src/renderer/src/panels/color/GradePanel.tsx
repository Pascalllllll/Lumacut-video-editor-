import { useState } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import {
  autoExposure,
  autoWhiteBalance,
  matchColor,
  neutralPrimary,
  writeCube,
  type FrameStats,
} from '@engine/color'
import { LOOK_IDS } from '@engine/looks'
import {
  createId,
  curvesSchema,
  qualifierSchema,
  type Clip,
  type GradeLayer,
  type Primary,
  type Sequence,
} from '@engine/model'
import { framesToSeconds } from '@engine/time'
import { sourceFrameAt } from '@engine/speed'
import { clipEnd } from '@engine/timeline'
import { t, td } from '../../i18n'
import { NumberField } from '../../components/NumberField'
import { Panel } from '../../components/Panel'
import { EmptyState } from '../../components/EmptyState'
import { notify } from '../../state/notices'
import { usePlayhead } from '../../state/playhead'
import { useProject } from '../../state/project'
import { getLut, isBundled } from '../../lib/luts'
import { gradeFunction } from '@engine/grade'
import { ColorWheel } from './ColorWheel'
import { CurveEditor } from './CurveEditor'
import styles from './Grade.module.css'

/** Bakes the clip's grade into a 33-point .cube file other software can use. */
async function exportLut(name: string, layers: GradeLayer[]) {
  const grade = gradeFunction(layers, (source) => {
    const lut = getLut(source)
    return lut ? { ...lut, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } : null
  })
  const stem = name.replace(/\.[^.]+$/, '')
  try {
    const saved = await window.lumacut.invoke('lut:save', {
      content: writeCube(`${stem} grade`, 33, grade),
      suggestedName: `${stem} grade`,
    })
    if (saved) notify('info', t('grade.lutSaved', { name: saved.path.split(/[\\/]/).pop() ?? '' }))
  } catch (error) {
    notify('error', error instanceof Error ? error.message : String(error))
  }
}

/** Grades copied with "Copy grade", ready to paste on other clips. */
let clipboard: GradeLayer[] | null = null

function message(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function newLayer(kind: GradeLayer['kind']): GradeLayer {
  return {
    id: createId('grd'),
    kind,
    enabled: true,
    mix: 1,
    qualifier: null,
    primary: kind === 'primary' ? neutralPrimary() : null,
    curves: kind === 'curves' ? curvesSchema.parse({}) : null,
    lut: kind === 'lut' ? { source: 'bundled:teal-orange', intensity: 1 } : null,
  }
}

/** The clip the Color workspace works on: the selected video clip, or the top one under the playhead. */
export function useGradeClip(): { clip: Clip | undefined; sequence: Sequence } {
  const project = useProject((s) => s.history.project)
  const selection = useProject((s) => s.selection)
  const frame = usePlayhead((s) => s.frame)
  const sequence = project.sequences[project.activeSequenceId]!
  const isVideo = (c: Clip | undefined) =>
    Boolean(c) && sequence.tracks.find((tr) => tr.id === c!.trackId)?.kind === 'video'
  const selected = selection.map((id) => sequence.clips[id]).find(isVideo)
  if (selected) return { clip: selected, sequence }
  const videos = sequence.tracks.filter((tr) => tr.kind === 'video' && !tr.hidden).reverse()
  for (const tr of videos) {
    const c = Object.values(sequence.clips).find(
      (x) => x.trackId === tr.id && frame >= x.start && frame < clipEnd(x),
    )
    if (c && project.media[c.mediaId]?.kind === 'video') return { clip: c, sequence }
  }
  return { clip: undefined, sequence }
}

async function statsFor(clip: Clip, sequence: Sequence, atFrame: number): Promise<FrameStats> {
  const project = useProject.getState().history.project
  const asset = project.media[clip.mediaId]
  if (!asset || asset.kind !== 'video') throw new Error(t('grade.videoOnly'))
  const f = Math.min(clip.duration - 1, Math.max(0, atFrame - clip.start))
  const time = framesToSeconds(sourceFrameAt(clip, f), sequence.fps)
  return window.lumacut.invoke('analyze:stats', {
    path: asset.path,
    time,
    color: asset.color,
    width: asset.width ?? 1920,
    height: asset.height ?? 1080,
  })
}

export function GradePanel() {
  const { clip, sequence } = useGradeClip()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const project = useProject((s) => s.history.project)

  if (!clip) {
    return (
      <Panel.Root label={t('grade.title')} area="grade">
        <Panel.Header>
          <Panel.Title>{t('grade.title')}</Panel.Title>
        </Panel.Header>
        <Panel.Body>
          <EmptyState title={t('grade.emptyTitle')} body={t('grade.emptyBody')} />
        </Panel.Body>
      </Panel.Root>
    )
  }

  const layers = clip.grade
  const selected = layers.find((l) => l.id === selectedId) ?? layers[0]
  const setLayers = (grade: GradeLayer[]) =>
    useProject.getState().dispatch({
      type: 'clip.look',
      sequenceId: sequence.id,
      clipIds: [clip.id],
      patch: { grade },
    })
  const update = (id: string, patch: Partial<GradeLayer>) =>
    setLayers(layers.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  const add = (kind: GradeLayer['kind']) => {
    const layer = newLayer(kind)
    setLayers([...layers, layer])
    setSelectedId(layer.id)
  }
  const move = (i: number, d: -1 | 1) => {
    const next = [...layers]
    const [item] = next.splice(i, 1)
    next.splice(i + d, 0, item!)
    setLayers(next)
  }
  /** The first primary layer, created if needed, for the automatic tools to write into. */
  const withPrimary = (make: (p: Primary) => Primary) => {
    const existing = layers.find((l) => l.kind === 'primary' && l.primary && !l.qualifier)
    if (existing) update(existing.id, { primary: make(existing.primary!) })
    else {
      const layer = newLayer('primary')
      setLayers([...layers, { ...layer, primary: make(layer.primary!) }])
      setSelectedId(layer.id)
    }
  }
  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    try {
      await task()
    } catch (error) {
      notify('error', message(error))
    } finally {
      setBusy(false)
    }
  }
  const frame = usePlayhead.getState().frame
  const others = Object.values(sequence.clips).filter(
    (c) =>
      c.id !== clip.id &&
      project.media[c.mediaId]?.kind === 'video' &&
      sequence.tracks.find((tr) => tr.id === c.trackId)?.kind === 'video',
  )

  return (
    <Panel.Root label={t('grade.title')} area="grade">
      <Panel.Header>
        <Panel.Title>
          {t('grade.titleFor', { name: project.media[clip.mediaId]?.name ?? '' })}
        </Panel.Title>
        <div className={styles.tools}>
          <button
            type="button"
            className={styles.tool}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const measured = await statsFor(clip, sequence, frame)
                withPrimary((p) => autoWhiteBalance(measured, p))
              })
            }
          >
            {t('grade.autoBalance')}
          </button>
          <button
            type="button"
            className={styles.tool}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const measured = await statsFor(clip, sequence, frame)
                withPrimary((p) => autoExposure(measured, p))
              })
            }
          >
            {t('grade.autoExposure')}
          </button>
          <select
            className={styles.toolSelect}
            aria-label={t('grade.matchTo')}
            value=""
            disabled={busy || others.length === 0}
            onChange={(e) => {
              const ref = sequence.clips[e.target.value]
              if (!ref) return
              void run(async () => {
                const [target, reference] = await Promise.all([
                  statsFor(clip, sequence, frame),
                  statsFor(ref, sequence, ref.start + Math.floor(ref.duration / 2)),
                ])
                withPrimary((p) => matchColor(target, reference, p))
                notify('info', t('grade.matched'))
              })
            }}
          >
            <option value="">{t('grade.matchTo')}</option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {project.media[c.mediaId]?.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.tool}
            disabled={layers.length === 0}
            onClick={() => void exportLut(project.media[clip.mediaId]?.name ?? 'Grade', layers)}
          >
            {t('grade.exportLut')}
          </button>
          <button
            type="button"
            className={styles.tool}
            disabled={layers.length === 0}
            onClick={() => {
              clipboard = layers
              notify('info', t('grade.copied'))
            }}
          >
            {t('grade.copy')}
          </button>
          <button
            type="button"
            className={styles.tool}
            disabled={!clipboard}
            onClick={() => {
              const selection = useProject
                .getState()
                .selection.filter(
                  (id) =>
                    sequence.clips[id] &&
                    sequence.tracks.find((tr) => tr.id === sequence.clips[id]!.trackId)?.kind ===
                      'video',
                )
              const targets = selection.length ? selection : [clip.id]
              // Pasted layers get fresh ids so each clip's grade stays its own.
              const grade = (clipboard ?? []).map((l) => ({ ...l, id: createId('grd') }))
              useProject.getState().dispatch({
                type: 'clip.look',
                sequenceId: sequence.id,
                clipIds: targets,
                patch: { grade },
              })
            }}
          >
            {t('grade.paste')}
          </button>
        </div>
      </Panel.Header>
      <Panel.Body>
        <div className={styles.layout}>
          <div className={styles.stack}>
            <div className={styles.stackHead}>
              <span>{t('grade.layers')}</span>
              <Menu.Root>
                <Menu.Trigger asChild>
                  <button type="button" className={styles.add} aria-label={t('grade.addLayer')}>
                    <Plus size={13} strokeWidth={1.8} />
                  </button>
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Content className={styles.menu} align="start">
                    {(['primary', 'curves', 'lut'] as const).map((k) => (
                      <Menu.Item key={k} className={styles.menuItem} onSelect={() => add(k)}>
                        {td(`grade.kind.${k}`)}
                      </Menu.Item>
                    ))}
                  </Menu.Content>
                </Menu.Portal>
              </Menu.Root>
            </div>
            {layers.length === 0 ? <p className={styles.hint}>{t('grade.noLayers')}</p> : null}
            <ul className={styles.layerList} aria-label={t('grade.layers')}>
              {layers.map((l, i) => (
                <li
                  key={l.id}
                  className={styles.layer}
                  data-selected={selected?.id === l.id}
                  data-enabled={l.enabled}
                >
                  <button
                    type="button"
                    className={styles.layerName}
                    onClick={() => setSelectedId(l.id)}
                    aria-pressed={selected?.id === l.id}
                  >
                    {i + 1}. {td(`grade.kind.${l.kind}`)}
                    {l.qualifier ? (
                      <span className={styles.badge}>{t('grade.qualified')}</span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    aria-label={
                      l.enabled ? t('grade.turnOff', { n: i + 1 }) : t('grade.turnOn', { n: i + 1 })
                    }
                    onClick={() => update(l.id, { enabled: !l.enabled })}
                  >
                    {l.enabled ? (
                      <Eye size={13} strokeWidth={1.7} />
                    ) : (
                      <EyeOff size={13} strokeWidth={1.7} />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={t('look.moveUp')}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp size={13} strokeWidth={1.7} />
                  </button>
                  <button
                    type="button"
                    aria-label={t('look.moveDown')}
                    disabled={i === layers.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown size={13} strokeWidth={1.7} />
                  </button>
                  <button
                    type="button"
                    aria-label={t('grade.removeLayer', { n: i + 1 })}
                    onClick={() => setLayers(layers.filter((x) => x.id !== l.id))}
                  >
                    <Trash2 size={13} strokeWidth={1.7} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.controls}>
            {selected ? (
              <LayerControls layer={selected} update={(patch) => update(selected.id, patch)} />
            ) : null}
          </div>
        </div>
      </Panel.Body>
    </Panel.Root>
  )
}

function LayerControls({
  layer,
  update,
}: {
  layer: GradeLayer
  update: (patch: Partial<GradeLayer>) => void
}) {
  return (
    <div className={styles.layerControls}>
      <div className={styles.row}>
        <span>{t('grade.mix')}</span>
        <NumberField
          label={t('grade.mix')}
          value={layer.mix}
          min={0}
          max={1}
          step={1}
          display={100}
          unit="%"
          precision={0}
          onChange={(v) => update({ mix: v })}
        />
      </div>
      {layer.kind === 'primary' && layer.primary ? (
        <PrimaryControls primary={layer.primary} onChange={(primary) => update({ primary })} />
      ) : null}
      {layer.kind === 'curves' && layer.curves ? (
        <CurveEditor curves={layer.curves} onChange={(curves) => update({ curves })} />
      ) : null}
      {layer.kind === 'lut' && layer.lut ? (
        <LutControls lut={layer.lut} onChange={(lut) => update({ lut })} />
      ) : null}
      <Qualifier layer={layer} update={update} />
    </div>
  )
}

function PrimaryControls({
  primary,
  onChange,
}: {
  primary: Primary
  onChange: (p: Primary) => void
}) {
  const set = (patch: Partial<Primary>) => onChange({ ...primary, ...patch })
  return (
    <>
      <div className={styles.wheels}>
        <ColorWheel
          label={t('grade.lift')}
          value={primary.lift}
          range={0.25}
          onChange={(lift) => set({ lift })}
        />
        <ColorWheel
          label={t('grade.gamma')}
          value={primary.gamma}
          range={0.5}
          onChange={(gamma) => set({ gamma })}
        />
        <ColorWheel
          label={t('grade.gain')}
          value={primary.gain}
          range={0.5}
          onChange={(gain) => set({ gain })}
        />
        <ColorWheel
          label={t('grade.offset')}
          value={primary.offset}
          range={0.15}
          onChange={(offset) => set({ offset })}
        />
      </div>
      <div className={styles.sliders}>
        {(
          [
            ['exposure', -4, 4, 0.05, 1, ''],
            ['contrast', 0, 3, 0.01, 100, '%'],
            ['pivot', 0, 1, 0.005, 100, '%'],
            ['saturation', 0, 3, 0.01, 100, '%'],
            ['temperature', -1, 1, 0.01, 100, ''],
            ['tint', -1, 1, 0.01, 100, ''],
          ] as const
        ).map(([key, min, max, step, display, unit]) => (
          <div key={key} className={styles.row}>
            <span>{td(`grade.${key}`)}</span>
            <NumberField
              label={td(`grade.${key}`)}
              value={primary[key]}
              min={min}
              max={max}
              step={step * display}
              display={display}
              unit={unit}
              precision={display === 1 ? 2 : 0}
              onChange={(v) => set({ [key]: v })}
            />
          </div>
        ))}
        <button type="button" className={styles.reset} onClick={() => onChange(neutralPrimary())}>
          {t('grade.resetAll')}
        </button>
      </div>
    </>
  )
}

function LutControls({
  lut,
  onChange,
}: {
  lut: NonNullable<GradeLayer['lut']>
  onChange: (l: NonNullable<GradeLayer['lut']>) => void
}) {
  const fileName = isBundled(lut.source) ? null : lut.source.split(/[\\/]/).pop()
  return (
    <div className={styles.sliders}>
      <div className={styles.row}>
        <label htmlFor="lut-source">{t('grade.look')}</label>
        <select
          id="lut-source"
          value={isBundled(lut.source) ? lut.source : 'file'}
          onChange={async (e) => {
            if (e.target.value !== 'file') return onChange({ ...lut, source: e.target.value })
            const picked = await window.lumacut.invoke('lut:pick')
            if (picked) onChange({ ...lut, source: picked.path })
          }}
        >
          {LOOK_IDS.map((id) => (
            <option key={id} value={`bundled:${id}`}>
              {td(`look.builtin.${id}`)}
            </option>
          ))}
          <option value="file">
            {fileName ? t('grade.lutFile', { name: fileName }) : t('grade.loadCube')}
          </option>
        </select>
      </div>
      <div className={styles.row}>
        <span>{t('grade.intensity')}</span>
        <NumberField
          label={t('grade.intensity')}
          value={lut.intensity}
          min={0}
          max={1}
          step={1}
          display={100}
          unit="%"
          precision={0}
          onChange={(v) => onChange({ ...lut, intensity: v })}
        />
      </div>
    </div>
  )
}

function Qualifier({
  layer,
  update,
}: {
  layer: GradeLayer
  update: (patch: Partial<GradeLayer>) => void
}) {
  const q = layer.qualifier
  const set = (patch: Partial<NonNullable<GradeLayer['qualifier']>>) =>
    update({ qualifier: { ...q!, ...patch } })
  return (
    <div className={styles.qualifier}>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={Boolean(q)}
          onChange={(e) =>
            update({ qualifier: e.target.checked ? qualifierSchema.parse({}) : null })
          }
        />
        {t('grade.qualify')}
      </label>
      {q ? (
        <>
          <div className={styles.hueBar} aria-hidden="true">
            <div
              className={styles.hueWindow}
              style={{
                left: `${(q.hueCenter - q.hueWidth / 2) * 100}%`,
                width: `${q.hueWidth * 100}%`,
              }}
            />
          </div>
          {(
            [
              ['hueCenter', 0, 1, 360, '°'],
              ['hueWidth', 0, 1, 360, '°'],
              ['satLow', 0, 1, 100, '%'],
              ['satHigh', 0, 1, 100, '%'],
              ['lumLow', 0, 1, 100, '%'],
              ['lumHigh', 0, 1, 100, '%'],
              ['softness', 0, 0.5, 100, '%'],
            ] as const
          ).map(([key, min, max, display, unit]) => (
            <div key={key} className={styles.row}>
              <span>{td(`grade.q.${key}`)}</span>
              <NumberField
                label={td(`grade.q.${key}`)}
                value={q[key]}
                min={min}
                max={max}
                step={1}
                display={display}
                unit={unit}
                precision={0}
                onChange={(v) => set({ [key]: v })}
              />
            </div>
          ))}
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={q.invert}
              onChange={(e) => set({ invert: e.target.checked })}
            />
            {t('grade.q.invert')}
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={q.show}
              onChange={(e) => set({ show: e.target.checked })}
            />
            {t('grade.q.show')}
          </label>
        </>
      ) : null}
    </div>
  )
}
