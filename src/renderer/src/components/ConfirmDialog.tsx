import * as Dialog from '@radix-ui/react-dialog'
import { t } from '../i18n'
import { useConfirm } from '../state/confirm'
import styles from './Sheet.module.css'

export function ConfirmDialog() {
  const request = useConfirm((s) => s.request)
  return (
    <Dialog.Root
      open={request !== null}
      onOpenChange={(open) => !open && request?.resolve('cancel')}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.sheet}>
          <Dialog.Title className={styles.title}>{request?.title}</Dialog.Title>
          <Dialog.Description className={styles.body}>{request?.body}</Dialog.Description>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.button} ${styles.spacer}`}
              onClick={() => request?.resolve('discard')}
            >
              {t('confirm.discard')}
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() => request?.resolve('cancel')}
            >
              {t('confirm.cancel')}
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={() => request?.resolve('save')}
              autoFocus
            >
              {t('confirm.save')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
