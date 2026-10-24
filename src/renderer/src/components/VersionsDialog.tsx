import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { IpcResponse } from '@shared/ipc'
import { t } from '../i18n'
import { openVersion } from '../lib/actions'
import { useProject } from '../state/project'
import { useVersions } from '../state/versions'
import styles from './Sheet.module.css'

type Entry = IpcResponse<'autosave:list'>[number]

export function VersionsDialog() {
  const open = useVersions((s) => s.open)
  const recovery = useVersions((s) => s.recovery)
  const projectId = useProject((s) => s.history.project.id)
  const [entries, setEntries] = useState<Entry[] | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    void window.lumacut.invoke('autosave:list').then((list) => {
      if (live)
        setEntries(
          recovery ? list.filter((e) => e.newer) : list.filter((e) => e.projectId === projectId),
        )
    })
    return () => {
      live = false
      setEntries(null)
    }
  }, [open, recovery, projectId])

  const close = () => useVersions.setState({ open: false, recovery: false })
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.sheet}>
          <Dialog.Title className={styles.title}>
            {recovery ? t('versions.recoveryTitle') : t('versions.title')}
          </Dialog.Title>
          <Dialog.Description className={styles.body}>
            {recovery ? t('versions.recoveryBody') : t('versions.body')}
          </Dialog.Description>
          {entries === null ? (
            <div className={styles.listSkeleton} aria-label={t('versions.loading')} />
          ) : entries.length === 0 ? (
            <p className={styles.body}>{t('versions.none')}</p>
          ) : (
            <ul className={styles.list}>
              {entries.map((e) => (
                <li key={e.file} className={styles.listRow}>
                  <span>
                    <strong>{e.name || t('project.untitled')}</strong>
                    <span className={styles.muted}> · {fmt.format(new Date(e.savedAt))}</span>
                  </span>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => void openVersion(e.file)}
                  >
                    {t('versions.restore')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={close}
              autoFocus
            >
              {recovery ? t('versions.skip') : t('export.close')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
