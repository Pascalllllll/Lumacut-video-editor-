import * as Dialog from '@radix-ui/react-dialog'
import * as RadioGroup from '@radix-ui/react-radio-group'
import { KEYMAP_PRESETS, type KeymapPreset } from '@shared/settings'
import { t, td } from '../i18n'
import { useEditor } from '../state/editor'
import { useSettings } from '../state/settings'
import { useUpdates } from '../state/updates'
import sheet from './Sheet.module.css'
import styles from './Onboarding.module.css'

/** Shown once: what Lumacut does with your data, which shortcuts feel familiar, and a way to start. */
export function Onboarding() {
  const loaded = useSettings((s) => s.loaded)
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const open = loaded && !settings.onboarded
  // This version's notes would only repeat the welcome, so they count as seen.
  const finish = () =>
    void update({ onboarded: true, lastSeenVersion: useUpdates.getState().notes?.version ?? '' })
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && finish()}>
      <Dialog.Portal>
        <Dialog.Overlay className={sheet.overlay} />
        <Dialog.Content className={`${sheet.sheet} ${styles.sheet}`}>
          <Dialog.Title className={sheet.title}>{t('onboarding.title')}</Dialog.Title>
          <Dialog.Description className={sheet.body}>{t('onboarding.body')}</Dialog.Description>
          <ul className={styles.points}>
            <li>{t('onboarding.local')}</li>
            <li>{t('onboarding.undo')}</li>
            <li>{t('onboarding.palette')}</li>
          </ul>
          <h3 id="onboarding-keys" className={styles.heading}>
            {t('onboarding.keys')}
          </h3>
          <RadioGroup.Root
            className={styles.choices}
            aria-labelledby="onboarding-keys"
            value={settings.keymap.preset}
            onValueChange={(v) =>
              void update({ keymap: { preset: v as KeymapPreset, custom: {} } })
            }
          >
            {KEYMAP_PRESETS.map((p) => (
              <RadioGroup.Item key={p} value={p} className={styles.choice}>
                {td(`keys.presets.${p}`)}
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
          <div className={sheet.actions}>
            <button type="button" className={sheet.button} onClick={finish}>
              {t('onboarding.skipTour')}
            </button>
            <button
              type="button"
              className={`${sheet.button} ${sheet.primary}`}
              autoFocus
              onClick={() => {
                finish()
                useEditor.setState({ tour: 0 })
              }}
            >
              {t('onboarding.tour')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
