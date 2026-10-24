import { useState } from 'react'
import type { Clip } from '@engine/model'
import { t } from '../../i18n'
import { cleanVoice, detectScenes, removeBackground } from '../../lib/ai'
import { notify } from '../../state/notices'
import { Section } from './LookInspector'
import styles from './Look.module.css'

const report = (error: unknown) =>
  notify('error', error instanceof Error ? error.message : String(error))

/** Picture tools for a video clip: cutouts and scene cuts. */
export function PictureAiTools({ clip }: { clip: Clip }) {
  const [progress, setProgress] = useState<number | null>(null)
  const [scanning, setScanning] = useState(false)
  return (
    <Section title={t('ai.tools')}>
      <div className={styles.presetRow}>
        <button
          type="button"
          className={styles.addButton}
          disabled={progress !== null}
          onClick={() => {
            setProgress(0)
            void removeBackground(clip, setProgress).finally(() => setProgress(null))
          }}
        >
          {progress === null
            ? t('ai.removeBackground')
            : t('ai.removingBackground', { percent: Math.round(progress * 100) })}
        </button>
        <button
          type="button"
          className={styles.addButton}
          disabled={scanning}
          onClick={() => {
            setScanning(true)
            void detectScenes(clip)
              .catch(report)
              .finally(() => setScanning(false))
          }}
        >
          {scanning ? t('ai.detectingScenes') : t('ai.detectScenes')}
        </button>
      </div>
      <p className={styles.hint}>{t('ai.removeBackgroundHint')}</p>
    </Section>
  )
}

/** Sound tools for an audio clip. */
export function SoundAiTools({ clip }: { clip: Clip }) {
  const [busy, setBusy] = useState(false)
  return (
    <Section title={t('ai.tools')}>
      <div className={styles.presetRow}>
        <button
          type="button"
          className={styles.addButton}
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void cleanVoice(clip).finally(() => setBusy(false))
          }}
        >
          {busy ? t('ai.cleaningVoice') : t('ai.cleanVoice')}
        </button>
      </div>
      <p className={styles.hint}>{t('ai.cleanVoiceHint')}</p>
    </Section>
  )
}
