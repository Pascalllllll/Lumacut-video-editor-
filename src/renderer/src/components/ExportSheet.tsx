import * as Dialog from '@radix-ui/react-dialog'
import { t } from '../i18n'
import { formatDuration } from '../lib/format'
import { focusedJob, useExport } from '../state/export'
import styles from './Sheet.module.css'

export function ExportSheet() {
  const job = useExport(focusedJob)
  const close = () => useExport.setState({ focus: null })
  const fileName = job?.path.split(/[\\/]/).pop() ?? ''

  return (
    <Dialog.Root open={job !== null} onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.sheet}>
          {job?.state === 'queued' ? (
            <>
              <Dialog.Title className={styles.title}>
                {t('export.queued', { name: job.name })}
              </Dialog.Title>
              <Dialog.Description className={styles.body}>
                {t('export.queuedBody')}
              </Dialog.Description>
              <div className={styles.actions}>
                <button type="button" className={styles.button} onClick={close}>
                  {t('export.keepWorking')}
                </button>
              </div>
            </>
          ) : null}
          {job?.state === 'running' ? (
            <>
              <Dialog.Title className={styles.title}>
                {t('export.running', { name: fileName })}
              </Dialog.Title>
              <Dialog.Description className={styles.body}>
                {t('export.runningBody')}
              </Dialog.Description>
              <div
                className={styles.progress}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(job.progress * 100)}
              >
                <div className={styles.progressFill} style={{ width: `${job.progress * 100}%` }} />
              </div>
              <div className={`${styles.status} tabular`}>
                <span>{Math.round(job.progress * 100)}%</span>
                <span>
                  {job.etaSeconds === null
                    ? t('export.estimating')
                    : t('export.remaining', { time: formatDuration(job.etaSeconds) })}
                </span>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => void window.lumacut.invoke('export:cancel', { jobId: job.jobId })}
                >
                  {t('export.cancel')}
                </button>
                <button type="button" className={styles.button} onClick={close}>
                  {t('export.keepWorking')}
                </button>
              </div>
            </>
          ) : null}
          {job?.state === 'done' ? (
            <>
              <Dialog.Title className={styles.title}>{t('export.done')}</Dialog.Title>
              <Dialog.Description className={styles.body}>{job.path}</Dialog.Description>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => void window.lumacut.invoke('export:reveal', { path: job.path })}
                >
                  {t('export.reveal')}
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.primary}`}
                  onClick={close}
                  autoFocus
                >
                  {t('export.close')}
                </button>
              </div>
            </>
          ) : null}
          {job?.state === 'failed' ? (
            <>
              <Dialog.Title className={styles.title}>{t('export.failed')}</Dialog.Title>
              <Dialog.Description className={styles.body}>{job.message}</Dialog.Description>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.primary}`}
                  onClick={close}
                  autoFocus
                >
                  {t('export.close')}
                </button>
              </div>
            </>
          ) : null}
          {job?.state === 'cancelled' ? (
            <>
              <Dialog.Title className={styles.title}>{t('export.cancelled')}</Dialog.Title>
              <Dialog.Description className={styles.body}>
                {t('export.cancelledBody')}
              </Dialog.Description>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.primary}`}
                  onClick={close}
                  autoFocus
                >
                  {t('export.close')}
                </button>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
