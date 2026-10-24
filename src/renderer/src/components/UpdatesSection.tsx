import * as RadioGroup from '@radix-ui/react-radio-group'
import { updateModeSchema, type UpdateMode, type UpdateStatus } from '@shared/updates'
import { t } from '../i18n'
import { useSettings } from '../state/settings'
import { checkForUpdates, useUpdates } from '../state/updates'
import styles from './SettingsDialog.module.css'

function describe(status: UpdateStatus): string | null {
  switch (status.state) {
    case 'disabled':
      return t('updates.devBuild')
    case 'checking':
      return t('updates.checking')
    case 'current':
      return t('updates.current', { version: status.version })
    case 'available':
      return status.canInstall
        ? t('updates.available', { version: status.version })
        : t('updates.availablePackage', { version: status.version })
    case 'downloading':
      return t('updates.downloading', {
        version: status.version,
        percent: String(Math.round(status.fraction * 100)),
      })
    case 'ready':
      return t('updates.ready', { version: status.version })
    case 'failed':
      return t('updates.failed', { message: status.message })
    default:
      return null
  }
}

/** Settings > Updates: whether to look for new versions, and what to do about one. */
export function UpdatesSection() {
  const mode = useSettings((s) => s.settings.updates)
  const update = useSettings((s) => s.update)
  const status = useUpdates((s) => s.status)
  const line = describe(status)
  const busy = status.state === 'checking' || status.state === 'downloading'

  return (
    <section className={styles.section} aria-labelledby="settings-updates">
      <h3 id="settings-updates" className={styles.sectionTitle}>
        {t('updates.title')}
      </h3>
      <div className={styles.row}>
        <span id="settings-update-mode" className={styles.label}>
          {t('updates.mode')}
        </span>
        <RadioGroup.Root
          aria-labelledby="settings-update-mode"
          aria-describedby="settings-update-hint"
          className={styles.segmented}
          value={mode}
          onValueChange={(value) => void update({ updates: value as UpdateMode })}
        >
          {updateModeSchema.options.map((m) => (
            <RadioGroup.Item key={m} value={m} className={styles.segment}>
              {t(`updates.${m}`)}
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </div>
      <p id="settings-update-hint" className={styles.note}>
        {t('updates.modeHint')}
      </p>
      <div className={styles.modelRow}>
        <span className={styles.modelReady} role="status">
          {line}
        </span>
        <span className={styles.modelActions}>
          {status.state === 'available' && status.canInstall ? (
            <button
              type="button"
              className={styles.button}
              onClick={() => void window.lumacut.invoke('update:download')}
            >
              {t('updates.download')}
            </button>
          ) : null}
          {status.state === 'available' && !status.canInstall ? (
            <a
              className={`${styles.button} ${styles.linkButton}`}
              href={status.url}
              target="_blank"
              rel="noreferrer"
            >
              {t('updates.open')}
            </a>
          ) : null}
          {status.state === 'ready' ? (
            <button
              type="button"
              className={styles.button}
              onClick={() => void window.lumacut.invoke('update:install')}
            >
              {t('updates.restart')}
            </button>
          ) : null}
          {status.state !== 'disabled' && status.state !== 'ready' ? (
            <button
              type="button"
              className={styles.button}
              disabled={busy}
              onClick={() => void checkForUpdates()}
            >
              {t('updates.check')}
            </button>
          ) : null}
        </span>
      </div>
    </section>
  )
}
