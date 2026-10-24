import { useEffect } from 'react'
import { MODELS } from '@shared/models'
import { t, td } from '../i18n'
import { formatBytes } from '../lib/format'
import { useModels, watchModels } from '../state/models'
import styles from './SettingsDialog.module.css'

/** Local AI models: what each is for, its size, and download or delete. */
export function ModelsSection() {
  const models = useModels((s) => s.models)
  useEffect(() => {
    watchModels()
    void useModels.getState().refresh()
  }, [])
  return (
    <section className={styles.section} aria-labelledby="settings-models">
      <h3 id="settings-models" className={styles.sectionTitle}>
        {t('models.title')}
      </h3>
      <p className={styles.note}>{t('models.note')}</p>
      {MODELS.map((m) => {
        const state = models[m.id]
        const name = td(`models.name.${m.id}`)
        return (
          <div key={m.id} className={styles.modelRow} role="group" aria-label={name}>
            <div className={styles.modelText}>
              <span className={styles.label}>{name}</span>
              <span className={styles.modelMeta}>
                {td(`models.task.${m.task}`)} · {formatBytes(state?.bytes ?? 0)} · {m.license}
              </span>
              {state?.error ? (
                <span className={styles.modelError} role="alert">
                  {state.error}
                </span>
              ) : null}
            </div>
            {state?.progress !== null && state?.progress !== undefined ? (
              <div className={styles.modelActions}>
                <progress
                  className={styles.modelProgress}
                  value={state.progress}
                  max={1}
                  aria-label={t('models.downloading', { name })}
                />
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => void window.lumacut.invoke('models:cancel', { id: m.id })}
                >
                  {t('models.cancel')}
                </button>
              </div>
            ) : state?.ready ? (
              <div className={styles.modelActions}>
                <span className={styles.modelReady}>{t('models.ready')}</span>
                <button
                  type="button"
                  className={styles.button}
                  aria-label={t('models.deleteNamed', { name })}
                  onClick={() =>
                    void window.lumacut
                      .invoke('models:delete', { id: m.id })
                      .then(() => useModels.getState().refresh())
                  }
                >
                  {t('models.delete')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.button}
                aria-label={t('models.downloadNamed', { name })}
                onClick={() => {
                  useModels.setState((s) => ({
                    models: {
                      ...s.models,
                      [m.id]: { ...s.models[m.id]!, progress: 0, error: null },
                    },
                  }))
                  void window.lumacut.invoke('models:download', { id: m.id })
                }}
              >
                {t('models.download')}
              </button>
            )}
          </div>
        )
      })}
    </section>
  )
}
