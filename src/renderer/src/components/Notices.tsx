import { X } from 'lucide-react'
import { t } from '../i18n'
import { useNotices } from '../state/notices'
import styles from './Notices.module.css'

export function Notices() {
  const notices = useNotices((s) => s.notices)
  const dismiss = useNotices((s) => s.dismiss)
  return (
    <div className={styles.stack} aria-live="polite">
      {notices.map((n) => (
        <div
          key={n.id}
          className={styles.notice}
          data-kind={n.kind}
          role={n.kind === 'error' ? 'alert' : 'status'}
        >
          <span>{n.message}</span>
          <button
            type="button"
            className={styles.close}
            aria-label={t('notice.dismiss')}
            onClick={() => dismiss(n.id)}
          >
            <X size={13} strokeWidth={1.8} />
          </button>
        </div>
      ))}
    </div>
  )
}
