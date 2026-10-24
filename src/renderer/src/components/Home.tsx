import { useEffect, useState } from 'react'
import { FilePlus2, FolderOpen, Import } from 'lucide-react'
import type { RecentProject } from '@shared/recent'
import { t } from '../i18n'
import { importMedia, newProject, openProject } from '../lib/actions'
import { formatDate } from '../lib/format'
import { useAccount } from '../state/account'
import { useEditor } from '../state/editor'
import { useSettings } from '../state/settings'
import styles from './Home.module.css'

const ICON = { size: 16, strokeWidth: 1.7 } as const

const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')

/** The start screen: pick up the last project, open another, or start a new one. */
export function Home() {
  const [recent, setRecent] = useState<RecentProject[] | null>(null)
  const startScreen = useSettings((s) => s.settings.startScreen)
  const update = useSettings((s) => s.update)
  const account = useAccount((s) => s.account)

  const refresh = () => void window.lumacut.invoke('recent:list').then(setRecent)
  useEffect(refresh, [])

  const open = (path?: string) => void openProject(path)
  const remove = async (path: string) => {
    await window.lumacut.invoke('recent:remove', { path })
    refresh()
  }

  const [last, ...rest] = recent ?? []
  const lastUsable = last?.exists ? last : null
  const others = lastUsable ? rest : (recent ?? [])

  return (
    <div className={styles.home} role="region" aria-label={t('home.title')}>
      <div className={styles.side}>
        <h1 className={styles.hello}>
          {account ? t('home.welcomeBack', { name: account.name }) : t('home.title')}
        </h1>
        <button
          type="button"
          className={`${styles.action} ${lastUsable ? '' : styles.primary}`}
          onClick={() => void newProject()}
        >
          <FilePlus2 {...ICON} aria-hidden />
          {t('home.new')}
        </button>
        <button type="button" className={styles.action} onClick={() => open()}>
          <FolderOpen {...ICON} aria-hidden />
          {t('home.open')}
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={async () => {
            if (await newProject()) await importMedia()
          }}
        >
          <Import {...ICON} aria-hidden />
          {t('home.import')}
        </button>
        <div className={styles.links}>
          <button
            type="button"
            className={styles.link}
            onClick={() => useEditor.setState({ home: false, tour: 0 })}
          >
            {t('home.tour')}
          </button>
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={startScreen}
            onChange={(e) => void update({ startScreen: e.target.checked })}
          />
          {t('home.showOnStart')}
        </label>
      </div>

      <div className={styles.main}>
        {lastUsable ? (
          <>
            <h2 className={styles.heading}>{t('home.continue')}</h2>
            <button
              type="button"
              className={styles.continue}
              onClick={() => open(lastUsable.path)}
              autoFocus
            >
              <span>
                <span className={styles.continueName}>{lastUsable.name}</span>
                <span className={styles.meta}>
                  {t('home.lastOpened', { date: formatDate(lastUsable.openedAt) })} ·{' '}
                  {folderOf(lastUsable.path)}
                </span>
              </span>
              <span className={styles.open}>{t('home.openThis')}</span>
            </button>
          </>
        ) : null}

        <h2 className={styles.heading}>{t('home.recent')}</h2>
        {recent && others.length === 0 ? (
          <p className={styles.empty}>{t(lastUsable ? 'home.noOthers' : 'home.none')}</p>
        ) : (
          <ul className={styles.list} aria-label={t('home.recent')}>
            {others.map((p) => (
              <li key={p.path} className={styles.row}>
                <button
                  type="button"
                  className={styles.rowButton}
                  disabled={!p.exists}
                  onClick={() => open(p.path)}
                >
                  <span className={styles.rowName}>
                    {p.name}
                    {p.exists ? null : <span className={styles.missing}>{t('home.notFound')}</span>}
                  </span>
                  <span className={styles.meta}>
                    {t('home.lastOpened', { date: formatDate(p.openedAt) })} · {folderOf(p.path)}
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={t('home.removeNamed', { name: p.name })}
                  onClick={() => void remove(p.path)}
                >
                  {t('home.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
