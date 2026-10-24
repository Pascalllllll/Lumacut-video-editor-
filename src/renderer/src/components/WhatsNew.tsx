import { useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { RELEASES_URL } from '@shared/updates'
import { t } from '../i18n'
import { useSettings } from '../state/settings'
import { startUpdates, useUpdates } from '../state/updates'
import sheet from './Sheet.module.css'
import styles from './WhatsNew.module.css'

/** This version's changes from CHANGELOG.md, once after an update and from the Help menu. */
export function WhatsNew() {
  const loaded = useSettings((s) => s.loaded)
  const onboarded = useSettings((s) => s.settings.onboarded)
  const lastSeen = useSettings((s) => s.settings.lastSeenVersion)
  const update = useSettings((s) => s.update)
  const notes = useUpdates((s) => s.notes)
  const open = useUpdates((s) => s.whatsNew)

  useEffect(() => startUpdates(), [])
  useEffect(() => {
    if (loaded && onboarded && notes?.sections.length && lastSeen !== notes.version)
      useUpdates.setState({ whatsNew: true })
  }, [loaded, onboarded, notes, lastSeen])

  const close = () => {
    useUpdates.setState({ whatsNew: false })
    if (notes && lastSeen !== notes.version) void update({ lastSeenVersion: notes.version })
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className={sheet.overlay} />
        <Dialog.Content className={`${sheet.sheet} ${styles.sheet}`}>
          <Dialog.Title className={sheet.title}>
            {t('whatsNew.title', { version: notes?.version ?? '' })}
          </Dialog.Title>
          <Dialog.Description className={styles.date}>
            {notes?.date ? t('whatsNew.released', { date: notes.date }) : null}
          </Dialog.Description>
          {notes?.sections.length ? (
            notes.sections.map((section) => (
              <section key={section.heading}>
                <h3 className={styles.heading}>{section.heading}</h3>
                <ul className={styles.items}>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <p className={sheet.body}>{t('whatsNew.none')}</p>
          )}
          <div className={sheet.actions}>
            <a
              className={`${sheet.button} ${styles.link}`}
              href={RELEASES_URL}
              target="_blank"
              rel="noreferrer"
            >
              {t('whatsNew.all')}
            </a>
            <button type="button" className={`${sheet.button} ${sheet.primary}`} onClick={close}>
              {t('whatsNew.close')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
