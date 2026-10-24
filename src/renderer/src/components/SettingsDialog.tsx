import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as RadioGroup from '@radix-ui/react-radio-group'
import { ACCENTS, type Theme } from '@shared/settings'
import type { IpcResponse } from '@shared/ipc'
import { t } from '../i18n'
import { useSettings } from '../state/settings'
import { AccountSection } from './AccountSection'
import { AiSection } from './AiSection'
import { KeymapSection } from './KeymapSection'
import { ModelsSection } from './ModelsSection'
import { UpdatesSection } from './UpdatesSection'
import styles from './SettingsDialog.module.css'

const THEMES: { value: Theme; label: () => string }[] = [
  { value: 'auto', label: () => t('settings.themeAuto') },
  { value: 'light', label: () => t('settings.themeLight') },
  { value: 'dark', label: () => t('settings.themeDark') },
]

const SCALES = [0.9, 1, 1.1, 1.25, 1.5]

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const [info, setInfo] = useState<IpcResponse<'app:info'> | null>(null)

  useEffect(() => {
    if (open && !info) void window.lumacut.invoke('app:info').then(setInfo)
  }, [open, info])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.sheet}>
          <Dialog.Title className={styles.title}>{t('settings.title')}</Dialog.Title>
          <Dialog.Description className={styles.description}>
            {t('settings.description')}
          </Dialog.Description>

          <AccountSection />

          <section className={styles.section} aria-labelledby="settings-appearance">
            <h3 id="settings-appearance" className={styles.sectionTitle}>
              {t('settings.appearance')}
            </h3>

            <div className={styles.row}>
              <span id="settings-theme" className={styles.label}>
                {t('settings.theme')}
              </span>
              <RadioGroup.Root
                aria-labelledby="settings-theme"
                className={styles.segmented}
                value={settings.theme}
                onValueChange={(value) => void update({ theme: value as Theme })}
              >
                {THEMES.map((option) => (
                  <RadioGroup.Item
                    key={option.value}
                    value={option.value}
                    className={styles.segment}
                  >
                    {option.label()}
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            </div>

            <div className={styles.row}>
              <span id="settings-accent" className={styles.label}>
                {t('settings.accent')}
              </span>
              <RadioGroup.Root
                aria-labelledby="settings-accent"
                className={styles.swatches}
                value={settings.accent}
                onValueChange={(value) =>
                  void update({ accent: value as (typeof ACCENTS)[number] })
                }
              >
                {ACCENTS.map((accent) => (
                  <RadioGroup.Item
                    key={accent}
                    value={accent}
                    className={styles.swatch}
                    data-swatch={accent}
                    aria-label={t(`settings.accentName.${accent}`)}
                    title={t(`settings.accentName.${accent}`)}
                  />
                ))}
              </RadioGroup.Root>
            </div>

            <div className={styles.row}>
              <span id="settings-scale" className={styles.label}>
                {t('settings.uiScale')}
              </span>
              <RadioGroup.Root
                aria-labelledby="settings-scale"
                className={styles.segmented}
                value={String(settings.uiScale)}
                onValueChange={(value) => void update({ uiScale: Number(value) })}
              >
                {SCALES.map((scale) => (
                  <RadioGroup.Item
                    key={scale}
                    value={String(scale)}
                    className={`${styles.segment} tabular`}
                  >
                    {Math.round(scale * 100)}%
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            </div>
          </section>

          <KeymapSection />

          <AiSection />

          <ModelsSection />

          <UpdatesSection />

          <section className={styles.section} aria-labelledby="settings-about">
            <h3 id="settings-about" className={styles.sectionTitle}>
              {t('settings.about')}
            </h3>
            {info ? (
              <dl className={styles.about}>
                <dt>{t('app.name')}</dt>
                <dd className="tabular">{t('settings.version', { version: info.version })}</dd>
                <dt>{t('settings.runtimeLabel')}</dt>
                <dd className="tabular">
                  {t('settings.runtime', { electron: info.electron, chrome: info.chrome })}
                </dd>
                <dt>{t('settings.ffmpegLabel')}</dt>
                <dd className="tabular">
                  {info.ffmpeg.found
                    ? t('settings.ffmpegFound', { version: info.ffmpeg.version ?? '' })
                    : t('settings.ffmpegMissing')}
                </dd>
              </dl>
            ) : (
              <div className={styles.aboutSkeleton} aria-hidden="true" />
            )}
          </section>

          <div className={styles.footer}>
            <Dialog.Close className={styles.primary}>{t('settings.done')}</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
