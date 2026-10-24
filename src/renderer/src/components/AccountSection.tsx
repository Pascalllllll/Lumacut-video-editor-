import { t } from '../i18n'
import { cancelSignIn, signIn, signOut, useAccount } from '../state/account'
import styles from './SettingsDialog.module.css'

/** Google's "G", as its sign-in button guidelines ask. */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

export function Avatar({ size }: { size: number }) {
  const account = useAccount((s) => s.account)
  if (!account) return null
  const initial = (account.name.trim()[0] ?? '?').toUpperCase()
  return account.picture ? (
    <img
      className={styles.avatar}
      src={account.picture}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
    />
  ) : (
    <span className={styles.avatar} style={{ width: size, height: size }} aria-hidden="true">
      {initial}
    </span>
  )
}

/** Settings > Account: optional, and only in builds that have a Google client. */
export function AccountSection() {
  const { available, account, signingIn, error } = useAccount()
  if (!available && !account) return null

  return (
    <section className={styles.section} aria-labelledby="settings-account">
      <h3 id="settings-account" className={styles.sectionTitle}>
        {t('account.title')}
      </h3>
      {account ? (
        <div className={styles.modelRow}>
          <span className={styles.accountWho}>
            <Avatar size={36} />
            <span className={styles.modelText}>
              <span>{account.name}</span>
              <span className={styles.modelMeta}>{account.email}</span>
            </span>
          </span>
          <button type="button" className={styles.button} onClick={() => void signOut()}>
            {t('account.signOut')}
          </button>
        </div>
      ) : (
        <>
          <p className={styles.note}>{t('account.why')}</p>
          <div className={styles.modelRow}>
            <span className={styles.modelReady} role="status">
              {signingIn ? t('account.waiting') : null}
            </span>
            {signingIn ? (
              <button type="button" className={styles.button} onClick={cancelSignIn}>
                {t('account.cancel')}
              </button>
            ) : (
              <button
                type="button"
                className={`${styles.button} ${styles.googleButton}`}
                onClick={() => void signIn()}
              >
                <GoogleMark />
                {t('account.signIn')}
              </button>
            )}
          </div>
        </>
      )}
      {error ? (
        <p className={styles.modelError} role="alert">
          {t('account.failed', { reason: error })}
        </p>
      ) : null}
    </section>
  )
}
