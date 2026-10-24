import type { ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { still } from '@engine/animation'
import { createEffect, EFFECTS, EFFECTS_BY_TYPE, paramOf, type ParamSpec } from '@engine/effects'
import {
  BLEND_MODES,
  createId,
  defaultTransform,
  type BlendMode,
  type Clip,
  type Effect,
  type Mask,
  type Sequence,
} from '@engine/model'
import { t, td } from '../../i18n'
import { useEditor } from '../../state/editor'
import { notify } from '../../state/notices'
import { useProject } from '../../state/project'
import { GraphEditor } from './GraphEditor'
import { ParamRow } from './ParamRow'
import { FollowTrack, StabilizeButton, TrackMaskButton } from './Tracking'
import styles from './Look.module.css'

type Layout = {
  id:
    | 'full'
    | 'pip-tl'
    | 'pip-tr'
    | 'pip-bl'
    | 'pip-br'
    | 'split-left'
    | 'split-right'
    | 'split-top'
    | 'split-bottom'
}
const LAYOUTS: Layout['id'][] = [
  'full',
  'pip-tl',
  'pip-tr',
  'pip-bl',
  'pip-br',
  'split-left',
  'split-right',
  'split-top',
  'split-bottom',
]

/** Transform values for a picture-in-picture corner or one half of a split screen. */
function layoutTransform(id: Layout['id'], seq: Sequence, picW: number, picH: number) {
  const base = defaultTransform()
  const fit = Math.min(seq.width / picW, seq.height / picH)
  const w = picW * fit
  const h = picH * fit
  const margin = seq.height * 0.04
  const pip = 0.3
  const s = (v: number) => still(v)
  switch (id) {
    case 'full':
      return base
    case 'pip-tl':
    case 'pip-tr':
    case 'pip-bl':
    case 'pip-br': {
      const dx = seq.width / 2 - (w * pip) / 2 - margin
      const dy = seq.height / 2 - (h * pip) / 2 - margin
      return {
        ...base,
        scaleX: s(pip),
        scaleY: s(pip),
        x: s(id.endsWith('l') ? -dx : dx),
        y: s(id.startsWith('pip-t') ? -dy : dy),
      }
    }
    case 'split-left':
    case 'split-right': {
      // Fill half the frame, cropping the picture's sides evenly.
      const scale = Math.max(seq.width / 2 / w, seq.height / h)
      const visible = seq.width / 2 / (w * scale)
      const crop = Math.max(0, (1 - visible) / 2)
      return {
        ...base,
        scaleX: s(scale),
        scaleY: s(scale),
        cropLeft: s(crop),
        cropRight: s(crop),
        x: s(id === 'split-left' ? -seq.width / 4 : seq.width / 4),
      }
    }
    default: {
      const scale = Math.max(seq.height / 2 / h, seq.width / w)
      const visible = seq.height / 2 / (h * scale)
      const crop = Math.max(0, (1 - visible) / 2)
      return {
        ...base,
        scaleX: s(scale),
        scaleY: s(scale),
        cropTop: s(crop),
        cropBottom: s(crop),
        y: s(id === 'split-top' ? -seq.height / 4 : seq.height / 4),
      }
    }
  }
}

export function LookInspector({ clip, sequence }: { clip: Clip; sequence: Sequence }) {
  const project = useProject((s) => s.history.project)
  const asset = project.media[clip.mediaId]
  const picW = asset?.width ?? sequence.width
  const picH = asset?.height ?? sequence.height
  const dispatch = (patch: object) =>
    useProject
      .getState()
      .dispatch({ type: 'clip.look', sequenceId: sequence.id, clipIds: [clip.id], patch })
  const row = (
    key: keyof Clip['transform'],
    label: string,
    extra: Partial<Parameters<typeof ParamRow>[0]> = {},
  ) => (
    <ParamRow
      clip={clip}
      sequence={sequence}
      path={{ kind: 'transform', key }}
      label={label}
      {...extra}
    />
  )
  const selected = useEditor((s) =>
    s.selectedParam?.clipId === clip.id ? s.selectedParam.path : null,
  )

  return (
    <div className={styles.look}>
      <Section title={t('look.transform')}>
        {row('x', t('look.x'), { step: 1, unit: 'px', precision: 1 })}
        {row('y', t('look.y'), { step: 1, unit: 'px', precision: 1 })}
        {row('scaleX', t('look.scaleX'), {
          step: 1,
          display: 100,
          unit: '%',
          min: -20,
          max: 20,
          precision: 1,
        })}
        {row('scaleY', t('look.scaleY'), {
          step: 1,
          display: 100,
          unit: '%',
          min: -20,
          max: 20,
          precision: 1,
        })}
        {row('rotation', t('look.rotation'), { step: 0.5, unit: '°', precision: 1 })}
        {row('anchorX', t('look.anchorX'), { step: 1, unit: 'px', precision: 1 })}
        {row('anchorY', t('look.anchorY'), { step: 1, unit: 'px', precision: 1 })}
        {row('opacity', t('look.opacity'), {
          step: 1,
          display: 100,
          unit: '%',
          min: 0,
          max: 1,
          precision: 0,
        })}
        <div className={styles.inline}>
          <label htmlFor={`blend-${clip.id}`}>{t('look.blend')}</label>
          <select
            id={`blend-${clip.id}`}
            value={clip.blend}
            onChange={(e) => dispatch({ blend: e.target.value as BlendMode })}
          >
            {BLEND_MODES.map((m) => (
              <option key={m} value={m}>
                {td(`blend.${m}`)}
              </option>
            ))}
          </select>
        </div>
        <FollowTrack clip={clip} sequence={sequence} />
        <div className={styles.inline}>
          <label htmlFor={`layout-${clip.id}`}>{t('look.layout')}</label>
          <select
            id={`layout-${clip.id}`}
            value=""
            onChange={(e) =>
              e.target.value &&
              dispatch({
                transform: layoutTransform(e.target.value as Layout['id'], sequence, picW, picH),
              })
            }
          >
            <option value="">{t('look.layoutPick')}</option>
            {LAYOUTS.map((l) => (
              <option key={l} value={l}>
                {td(`layout.${l}`)}
              </option>
            ))}
          </select>
        </div>
      </Section>

      <Section title={t('look.crop')}>
        {row('cropLeft', t('look.cropLeft'), {
          step: 1,
          display: 100,
          unit: '%',
          min: 0,
          max: 1,
          precision: 1,
        })}
        {row('cropRight', t('look.cropRight'), {
          step: 1,
          display: 100,
          unit: '%',
          min: 0,
          max: 1,
          precision: 1,
        })}
        {row('cropTop', t('look.cropTop'), {
          step: 1,
          display: 100,
          unit: '%',
          min: 0,
          max: 1,
          precision: 1,
        })}
        {row('cropBottom', t('look.cropBottom'), {
          step: 1,
          display: 100,
          unit: '%',
          min: 0,
          max: 1,
          precision: 1,
        })}
      </Section>

      <Effects clip={clip} sequence={sequence} />
      <Masks clip={clip} sequence={sequence} />
      {selected ? <GraphEditor clip={clip} sequence={sequence} path={selected} /> : null}
    </div>
  )
}

function Effects({ clip, sequence }: { clip: Clip; sequence: Sequence }) {
  const dispatch = (effects: Effect[]) =>
    useProject.getState().dispatch({
      type: 'clip.look',
      sequenceId: sequence.id,
      clipIds: [clip.id],
      patch: { effects },
    })
  const savePreset = async () => {
    try {
      const saved = await window.lumacut.invoke('preset:save', {
        name: t('look.presetName'),
        effects: clip.effects,
      })
      if (saved) notify('info', t('look.presetSaved'))
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error))
    }
  }
  const loadPreset = async () => {
    try {
      const preset = await window.lumacut.invoke('preset:open')
      // Loaded effects get fresh ids so the same preset can go on a clip twice.
      if (preset)
        dispatch([...clip.effects, ...preset.effects.map((fx) => ({ ...fx, id: createId('fx') }))])
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error))
    }
  }
  const move = (i: number, dir: -1 | 1) => {
    const next = [...clip.effects]
    const [item] = next.splice(i, 1)
    next.splice(i + dir, 0, item!)
    dispatch(next)
  }
  return (
    <Section
      title={t('look.effects')}
      action={
        <Menu.Root>
          <Menu.Trigger asChild>
            <button type="button" className={styles.addButton} aria-label={t('look.addEffect')}>
              <Plus size={13} strokeWidth={1.8} />
              {t('look.add')}
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className={styles.menu} align="end">
              {EFFECTS.map((e) => (
                <Menu.Item
                  key={e.type}
                  className={styles.menuItem}
                  onSelect={() => dispatch([...clip.effects, createEffect(e.type)])}
                >
                  {td(`effect.${e.type}`)}
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      }
    >
      {clip.effects.length === 0 ? <p className={styles.hint}>{t('look.noEffects')}</p> : null}
      <div className={styles.presetRow}>
        <button type="button" className={styles.addButton} onClick={() => void loadPreset()}>
          {t('look.loadPreset')}
        </button>
        <button
          type="button"
          className={styles.addButton}
          disabled={clip.effects.length === 0}
          onClick={() => void savePreset()}
        >
          {t('look.savePreset')}
        </button>
      </div>
      {clip.effects.map((fx, i) => (
        <div key={fx.id} className={styles.effect} data-enabled={fx.enabled}>
          <div className={styles.effectHead}>
            <span className={styles.effectName}>{td(`effect.${fx.type}`)}</span>
            <button
              type="button"
              aria-label={
                fx.enabled
                  ? t('look.disable', { name: td(`effect.${fx.type}`) })
                  : t('look.enable', { name: td(`effect.${fx.type}`) })
              }
              aria-pressed={!fx.enabled}
              onClick={() =>
                dispatch(
                  clip.effects.map((e) => (e.id === fx.id ? { ...e, enabled: !e.enabled } : e)),
                )
              }
            >
              {fx.enabled ? (
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
              disabled={i === clip.effects.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown size={13} strokeWidth={1.7} />
            </button>
            <button
              type="button"
              aria-label={t('look.remove', { name: td(`effect.${fx.type}`) })}
              onClick={() => dispatch(clip.effects.filter((e) => e.id !== fx.id))}
            >
              <Trash2 size={13} strokeWidth={1.7} />
            </button>
          </div>
          {fx.type === 'stabilize' ? (
            <StabilizeButton clip={clip} sequence={sequence} effect={fx} />
          ) : null}
          {(EFFECTS_BY_TYPE.get(fx.type)?.params ?? []).map((p) => (
            <EffectParam
              key={p.id}
              clip={clip}
              sequence={sequence}
              effect={fx}
              spec={p}
              onChange={(v) =>
                dispatch(
                  clip.effects.map((e) =>
                    e.id === fx.id ? { ...e, params: { ...e.params, [p.id]: v } } : e,
                  ),
                )
              }
            />
          ))}
        </div>
      ))}
    </Section>
  )
}

function EffectParam({
  clip,
  sequence,
  effect,
  spec,
  onChange,
}: {
  clip: Clip
  sequence: Sequence
  effect: Effect
  spec: ParamSpec
  onChange: (v: string | boolean) => void
}) {
  const label = td(`param.${spec.id}`)
  if (spec.kind === 'number') {
    // Parameters left at their default have no stored value yet; give the row one to read and key.
    const stored = paramOf(effect, spec.id)
    const filled =
      typeof effect.params[spec.id] === 'object' || typeof stored !== 'object'
        ? effect
        : { ...effect, params: { ...effect.params, [spec.id]: stored } }
    const scaled = spec.unit === '%'
    return (
      <ParamRow
        clip={{ ...clip, effects: clip.effects.map((e) => (e.id === effect.id ? filled : e)) }}
        sequence={sequence}
        path={{ kind: 'effect', effectId: effect.id, param: spec.id }}
        label={label}
        min={spec.min}
        max={spec.max}
        step={scaled ? 1 : spec.step}
        unit={spec.unit === '%' ? '%' : (spec.unit ?? '')}
        display={scaled ? 100 : 1}
        precision={spec.step < 0.1 ? 2 : 1}
      />
    )
  }
  const value = paramOf(effect, spec.id)
  const id = `${effect.id}-${spec.id}`
  if (spec.kind === 'color') {
    return (
      <div className={styles.inline}>
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          type="color"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    )
  }
  if (spec.kind === 'bool') {
    return (
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    )
  }
  return (
    <div className={styles.inline}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {spec.options.map((o) => (
          <option key={o} value={o}>
            {td(`option.${o}`)}
          </option>
        ))}
      </select>
    </div>
  )
}

export function newMask(shape: Mask['shape']): Mask {
  const geometry =
    shape === 'path'
      ? [0.3, 0.3, 0, 0, 0, 0, 0.7, 0.3, 0, 0, 0, 0, 0.7, 0.7, 0, 0, 0, 0, 0.3, 0.7, 0, 0, 0, 0]
      : [0.25, 0.25, 0.5, 0.5]
  return {
    id: createId('msk'),
    shape,
    track: null,
    geometry: { value: geometry, keys: [] },
    feather: still(0),
    expansion: still(0),
    opacity: still(1),
    invert: false,
    mode: 'add',
  }
}

function Masks({ clip, sequence }: { clip: Clip; sequence: Sequence }) {
  const dispatch = (masks: Mask[]) =>
    useProject.getState().dispatch({
      type: 'clip.look',
      sequenceId: sequence.id,
      clipIds: [clip.id],
      patch: { masks },
    })
  const update = (id: string, patch: Partial<Mask>) =>
    dispatch(clip.masks.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  const tool = useEditor((s) => s.maskTool)
  return (
    <Section
      title={t('look.masks')}
      action={
        <Menu.Root>
          <Menu.Trigger asChild>
            <button type="button" className={styles.addButton} aria-label={t('look.addMask')}>
              <Plus size={13} strokeWidth={1.8} />
              {t('look.add')}
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className={styles.menu} align="end">
              {(['rectangle', 'ellipse', 'path'] as const).map((shape) => (
                <Menu.Item
                  key={shape}
                  className={styles.menuItem}
                  onSelect={() => dispatch([...clip.masks, newMask(shape)])}
                >
                  {td(`mask.${shape}`)}
                </Menu.Item>
              ))}
              <Menu.Separator className={styles.menuSeparator} />
              {(['rectangle', 'ellipse', 'path'] as const).map((shape) => (
                <Menu.Item
                  key={`draw-${shape}`}
                  className={styles.menuItem}
                  onSelect={() => useEditor.setState({ maskTool: shape, viewer: 'timeline' })}
                >
                  {td(`mask.draw.${shape}`)}
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      }
    >
      {tool !== 'none' ? (
        <p className={styles.hint} role="status">
          {td(`mask.drawing.${tool}`)}{' '}
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => useEditor.setState({ maskTool: 'none' })}
          >
            {t('look.cancel')}
          </button>
        </p>
      ) : null}
      {clip.masks.length === 0 && tool === 'none' ? (
        <p className={styles.hint}>{t('look.noMasks')}</p>
      ) : null}
      {clip.masks.map((m, i) => (
        <div key={m.id} className={styles.effect}>
          <div className={styles.effectHead}>
            <span className={styles.effectName}>
              {t('look.maskName', { n: i + 1, shape: td(`mask.${m.shape}`) })}
            </span>
            <button
              type="button"
              aria-label={t('look.remove', {
                name: t('look.maskName', { n: i + 1, shape: td(`mask.${m.shape}`) }),
              })}
              onClick={() => dispatch(clip.masks.filter((x) => x.id !== m.id))}
            >
              <Trash2 size={13} strokeWidth={1.7} />
            </button>
          </div>
          <div className={styles.inline}>
            <label htmlFor={`mode-${m.id}`}>{t('look.maskMode')}</label>
            <select
              id={`mode-${m.id}`}
              value={m.mode}
              onChange={(e) => update(m.id, { mode: e.target.value as Mask['mode'] })}
            >
              <option value="add">{t('mask.mode.add')}</option>
              <option value="subtract">{t('mask.mode.subtract')}</option>
              <option value="intersect">{t('mask.mode.intersect')}</option>
            </select>
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={m.invert}
              onChange={(e) => update(m.id, { invert: e.target.checked })}
            />
            {t('look.invert')}
          </label>
          <ParamRow
            clip={clip}
            sequence={sequence}
            path={{ kind: 'mask', maskId: m.id, param: 'feather' }}
            label={t('look.feather')}
            min={0}
            max={500}
            unit="px"
            precision={1}
          />
          <ParamRow
            clip={clip}
            sequence={sequence}
            path={{ kind: 'mask', maskId: m.id, param: 'expansion' }}
            label={t('look.expansion')}
            min={-500}
            max={500}
            unit="px"
            precision={1}
          />
          <ParamRow
            clip={clip}
            sequence={sequence}
            path={{ kind: 'mask', maskId: m.id, param: 'opacity' }}
            label={t('look.opacity')}
            min={0}
            max={1}
            display={100}
            unit="%"
            precision={0}
          />
          <TrackMaskButton clip={clip} sequence={sequence} mask={m} />
        </div>
      ))}
    </Section>
  )
}

export function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}
