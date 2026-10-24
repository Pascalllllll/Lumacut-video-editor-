import { useMemo, useState } from 'react'
import { KEYMAP_PRESETS, type KeymapPreset } from '@shared/settings'
import { t, td } from '../i18n'
import {
  ACTIONS,
  ACTIONS_BY_ID,
  comboOf,
  effectiveKeymap,
  keyLabel,
  presetKeymap,
} from '../lib/keymap'
import { notify } from '../state/notices'
import { useSettings } from '../state/settings'
import styles from './SettingsDialog.module.css'

/** Shortcut presets, and every command's keys, changeable by pressing new ones. */
export function KeymapSection() {
  const keymap = useSettings((s) => s.settings.keymap)
  const update = useSettings((s) => s.update)
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<string | null>(null)
  const keys = useMemo(() => effectiveKeymap(keymap), [keymap])
  const shown = ACTIONS.filter((a) => a.label().toLowerCase().includes(query.toLowerCase()))

  const assign = (id: string, combo: string | null) => {
    const custom = { ...keymap.custom }
    if (combo) {
      // A key belongs to one command: take it from whichever had it.
      const owner = Object.entries(keys).find(
        ([other, list]) => other !== id && list.includes(combo),
      )?.[0]
      if (owner) {
        custom[owner] = keys[owner]!.filter((k) => k !== combo)
        notify(
          'info',
          t('keys.moved', {
            keys: keyLabel(combo),
            from: ACTIONS_BY_ID.get(owner)?.label() ?? owner,
          }),
        )
      }
      custom[id] = [combo]
    } else {
      delete custom[id]
    }
    void update({ keymap: { ...keymap, custom } })
  }

  return (
    <section className={styles.section} aria-labelledby="settings-keys">
      <h3 id="settings-keys" className={styles.sectionTitle}>
        {t('keys.title')}
      </h3>
      <div className={styles.row}>
        <label className={styles.label} htmlFor="keys-preset">
          {t('keys.preset')}
        </label>
        <select
          id="keys-preset"
          className={styles.select}
          value={keymap.preset}
          onChange={(e) =>
            void update({ keymap: { preset: e.target.value as KeymapPreset, custom: {} } })
          }
        >
          {KEYMAP_PRESETS.map((p) => (
            <option key={p} value={p}>
              {td(`keys.presets.${p}`)}
            </option>
          ))}
        </select>
      </div>
      <p className={styles.note}>{t('keys.fixed')}</p>
      <div className={styles.row}>
        <input
          className={styles.text}
          type="search"
          aria-label={t('keys.search')}
          placeholder={t('keys.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {Object.keys(keymap.custom).length ? (
          <button
            type="button"
            className={styles.button}
            onClick={() => void update({ keymap: { ...keymap, custom: {} } })}
          >
            {t('keys.resetAll')}
          </button>
        ) : null}
      </div>
      <ul className={styles.keyList} aria-label={t('keys.title')}>
        {shown.map((a) => {
          const isRecording = recording === a.id
          const changed = a.id in keymap.custom
          return (
            <li key={a.id} className={styles.keyRow}>
              <span>{a.label()}</span>
              <span className={styles.keyCombo}>
                {isRecording
                  ? t('keys.press')
                  : (keys[a.id] ?? []).map(keyLabel).join(', ') || t('keys.none')}
              </span>
              <button
                type="button"
                className={styles.button}
                aria-label={`${t('keys.change')}: ${a.label()}`}
                onClick={() => setRecording(a.id)}
                onKeyDown={(e) => {
                  if (!isRecording) return
                  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
                  e.preventDefault()
                  e.stopPropagation()
                  setRecording(null)
                  if (e.key === 'Escape') return
                  assign(a.id, comboOf(e))
                }}
                onBlur={() => setRecording(null)}
              >
                {t('keys.change')}
              </button>
              {changed ? (
                <button
                  type="button"
                  className={styles.button}
                  aria-label={`${t('keys.reset')}: ${a.label()}`}
                  onClick={() => assign(a.id, null)}
                  title={(presetKeymap(keymap.preset)[a.id] ?? []).map(keyLabel).join(', ')}
                >
                  {t('keys.reset')}
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
