import { useEffect, useState } from 'react'
import {
  ALPHA_CODECS,
  CONTAINER_CODECS,
  CONTAINERS,
  EXPORT_PRESETS,
  HDR_CODECS,
  normalizeOptions,
  presetOptions,
  type ExportOptions,
} from '@shared/export'
import type { IpcResponse } from '@shared/ipc'
import { fpsValue } from '@engine/time'
import { t, td } from '../../i18n'
import { Panel } from '../../components/Panel'
import { startExport } from '../../lib/actions'
import { selectSequence, useProject } from '../../state/project'
import { useSettings } from '../../state/settings'
import styles from './Export.module.css'

const SIZES: [number, number][] = [
  [3840, 2160],
  [2560, 1440],
  [1920, 1080],
  [1280, 720],
  [1080, 1920],
  [1080, 1350],
  [1080, 1080],
]
const RATES = [24, 25, 30, 50, 60]

/** Where the export goes and how it is encoded, starting from a preset. */
export function ExportPanel() {
  const options = useSettings((s) => s.settings.export)
  const update = useSettings((s) => s.update)
  const sequence = useProject(selectSequence)
  const [hw, setHw] = useState<IpcResponse<'export:hardware'> | null>(null)
  useEffect(() => {
    void window.lumacut.invoke('export:hardware').then(setHw)
  }, [])
  const set = (patch: Partial<ExportOptions>) =>
    void update({ export: normalizeOptions({ ...options, ...patch }) })
  const allowed = CONTAINER_CODECS[options.container]
  const hdr = sequence.hdr !== 'sdr'
  const hwList = hw ? [hw.h264, hw.hevc, hw.av1].filter((x): x is string => Boolean(x)) : []
  const sizeValue =
    options.width && options.height
      ? `${options.width}x${options.height}`
      : options.width
        ? `w${options.width}`
        : ''

  return (
    <Panel.Root label={t('export.title')} area="settings">
      <Panel.Header>
        <Panel.Title>{t('export.title')}</Panel.Title>
      </Panel.Header>
      <Panel.Body>
        <section className={styles.section} aria-labelledby="export-presets">
          <h3 id="export-presets" className={styles.heading}>
            {t('export.presets')}
          </h3>
          <div className={styles.presets} role="radiogroup" aria-labelledby="export-presets">
            {EXPORT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={options.preset === p.id}
                className={styles.preset}
                onClick={() =>
                  void update({ export: { ...presetOptions(p.id), range: options.range } })
                }
              >
                <span className={styles.presetName}>{td(`export.preset.${p.id}`)}</span>
                <span className={styles.presetHint}>{td(`export.presetHint.${p.id}`)}</span>
              </button>
            ))}
          </div>
        </section>
        <section className={styles.section} aria-labelledby="export-settings">
          <h3 id="export-settings" className={styles.heading}>
            {t('export.settings')}
          </h3>
          <Field id="ex-format" label={t('export.format')}>
            <select
              id="ex-format"
              value={options.container}
              onChange={(e) => set({ container: e.target.value as ExportOptions['container'] })}
            >
              {CONTAINERS.map((c) => (
                <option key={c} value={c}>
                  {td(`export.container.${c}`)}
                </option>
              ))}
            </select>
          </Field>
          {allowed.video[0] !== 'none' ? (
            <Field id="ex-video" label={t('export.videoCodec')}>
              <select
                id="ex-video"
                value={options.video}
                onChange={(e) => set({ video: e.target.value as ExportOptions['video'] })}
              >
                {allowed.video.map((c) => (
                  <option key={c} value={c} disabled={hdr && !HDR_CODECS.includes(c)}>
                    {td(`export.codec.${c}`)}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {allowed.audio.length > 1 || allowed.audio[0] !== 'none' ? (
            <Field id="ex-audio" label={t('export.audioCodec')}>
              <select
                id="ex-audio"
                value={options.audio}
                onChange={(e) => set({ audio: e.target.value as ExportOptions['audio'] })}
              >
                {allowed.audio.map((c) => (
                  <option key={c} value={c}>
                    {td(`export.codec.${c}`)}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {options.video !== 'none' ? (
            <>
              <Field id="ex-size" label={t('export.size')}>
                <select
                  id="ex-size"
                  value={sizeValue}
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) set({ width: null, height: null })
                    else if (v.startsWith('w')) set({ width: Number(v.slice(1)), height: null })
                    else {
                      const [w, h] = v.split('x').map(Number)
                      set({ width: w!, height: h! })
                    }
                  }}
                >
                  <option value="">
                    {t('export.sizeSequence', { size: `${sequence.width}x${sequence.height}` })}
                  </option>
                  {SIZES.map(([w, h]) => (
                    <option key={`${w}x${h}`} value={`${w}x${h}`}>
                      {w}x{h}
                    </option>
                  ))}
                  {options.width && !options.height ? (
                    <option value={`w${options.width}`}>
                      {t('export.wide', { width: options.width })}
                    </option>
                  ) : null}
                </select>
              </Field>
              {options.width && options.height ? (
                <Field id="ex-fit" label={t('export.fit')}>
                  <select
                    id="ex-fit"
                    value={options.fit}
                    onChange={(e) => set({ fit: e.target.value as ExportOptions['fit'] })}
                  >
                    <option value="fit">{t('export.fitFit')}</option>
                    <option value="fill">{t('export.fitFill')}</option>
                  </select>
                </Field>
              ) : null}
              <Field id="ex-rate" label={t('export.frameRate')}>
                <select
                  id="ex-rate"
                  value={options.fps ?? ''}
                  onChange={(e) => set({ fps: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">
                    {t('export.rateSequence')} ({Number(fpsValue(sequence.fps).toFixed(3))})
                  </option>
                  {[
                    ...RATES,
                    ...(options.fps && !RATES.includes(options.fps) ? [options.fps] : []),
                  ].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : null}
          <Field id="ex-quality" label={t('export.quality')}>
            <select
              id="ex-quality"
              value={options.quality}
              onChange={(e) => set({ quality: e.target.value as ExportOptions['quality'] })}
            >
              <option value="high">{t('export.qualityHigh')}</option>
              <option value="balanced">{t('export.qualityBalanced')}</option>
              <option value="small">{t('export.qualitySmall')}</option>
            </select>
          </Field>
          <Field id="ex-range" label={t('export.range')}>
            <select
              id="ex-range"
              value={options.range}
              onChange={(e) => set({ range: e.target.value as ExportOptions['range'] })}
            >
              <option value="all">{t('export.rangeAll')}</option>
              <option value="inout">{t('export.rangeInout')}</option>
              <option value="selection">{t('export.rangeSelection')}</option>
            </select>
          </Field>
          {['h264', 'hevc', 'av1'].includes(options.video) ? (
            <Check
              label={t('export.hardware')}
              hint={
                hwList.length
                  ? t('export.hardwareHint', { list: hwList.join(', ') })
                  : t('export.hardwareNone')
              }
              checked={options.hardware && hwList.length > 0}
              disabled={!hwList.length || hdr}
              onChange={(hardware) => set({ hardware })}
            />
          ) : null}
          {ALPHA_CODECS.includes(options.video) ? (
            <Check
              label={t('export.alpha')}
              hint={t('export.alphaHint')}
              checked={options.alpha}
              onChange={(alpha) => set({ alpha })}
            />
          ) : null}
          <Check
            label={t('export.smart')}
            hint={t('export.smartHint')}
            checked={options.smart}
            onChange={(smart) => set({ smart })}
          />
        </section>
        <div className={styles.go}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void startExport(options, false)}
          >
            {t('export.start')}
          </button>
        </div>
      </Panel.Body>
    </Panel.Root>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  )
}

function Check({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className={styles.check} data-disabled={disabled}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        <span className={styles.hint}>{hint}</span>
      </span>
    </label>
  )
}
