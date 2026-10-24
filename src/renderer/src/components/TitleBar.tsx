import { useEffect, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Copy, MessageSquareText, Minus, Settings2, Square, X } from 'lucide-react'
import { WORKSPACES } from '@shared/settings'
import { t } from '../i18n'
import { isWorkspaceAvailable } from '../lib/features'
import { useCopilot } from '../state/copilot'
import { IconButton } from './IconButton'
import { Avatar } from './AccountSection'
import { useAccount } from '../state/account'
import { AppMenu } from './AppMenu'
import { startExport } from '../lib/actions'
import { selectDirty, useProject } from '../state/project'
import styles from './TitleBar.module.css'

const ICON = { size: 15, strokeWidth: 1.6 } as const
const platform = window.lumacut.platform
const isMac = platform === 'darwin'
const visibleWorkspaces = WORKSPACES.filter(isWorkspaceAvailable)

export function TitleBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const copilotOpen = useCopilot((s) => s.open)

  return (
    <header
      className={styles.bar}
      data-platform={platform}
      onDoubleClick={(e) => {
        // Windows and macOS handle double-click on the drag region natively.
        if (platform === 'linux' && e.target === e.currentTarget) {
          void window.lumacut.invoke('window:toggle-maximize')
        }
      }}
    >
      <div className={styles.left}>
        {isMac ? null : <AppMenu />}
        <ProjectName />
      </div>

      {visibleWorkspaces.length > 1 ? (
        <div className={styles.tabsRoot}>
          <Tabs.List
            aria-label={t('titlebar.workspaces')}
            className={styles.tabs}
            data-tour="workspaces"
          >
            {visibleWorkspaces.map((w) => (
              <Tabs.Trigger key={w} value={w} className={styles.tab}>
                {t(`workspace.${w}`)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </div>
      ) : (
        <div />
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.export}
          data-tour="export"
          onClick={() => void startExport()}
        >
          {t('titlebar.export')}
        </button>
        <IconButton
          label={t('titlebar.copilot')}
          aria-pressed={copilotOpen}
          onClick={() => useCopilot.setState((s) => ({ open: !s.open }))}
        >
          <MessageSquareText {...ICON} />
        </IconButton>
        <AccountButton onOpenSettings={onOpenSettings} />
        <IconButton label={t('titlebar.settings')} onClick={onOpenSettings}>
          <Settings2 {...ICON} />
        </IconButton>
        {isMac ? null : <WindowControls />}
      </div>
    </header>
  )
}

function AccountButton({ onOpenSettings }: { onOpenSettings: () => void }) {
  const account = useAccount((s) => s.account)
  if (!account) return null
  return (
    <IconButton label={t('titlebar.account', { name: account.name })} onClick={onOpenSettings}>
      <Avatar size={20} />
    </IconButton>
  )
}

function ProjectName() {
  const name = useProject((s) => s.history.project.name)
  const dirty = useProject(selectDirty)
  return (
    <div className={styles.project}>
      <span className={styles.brand}>{t('app.name')}</span>
      <span className={styles.projectName}>{name}</span>
      {dirty ? <span className={styles.edited}>{t('titlebar.edited')}</span> : null}
    </div>
  )
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.lumacut.invoke('window:is-maximized').then(setMaximized)
    return window.lumacut.on('window:maximized-changed', setMaximized)
  }, [])

  return (
    <div className={styles.windowControls}>
      <IconButton
        variant="window"
        label={t('titlebar.minimize')}
        onClick={() => void window.lumacut.invoke('window:minimize')}
      >
        <Minus {...ICON} />
      </IconButton>
      <IconButton
        variant="window"
        label={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
        onClick={() => void window.lumacut.invoke('window:toggle-maximize').then(setMaximized)}
      >
        {maximized ? <Copy size={13} strokeWidth={1.6} /> : <Square size={12} strokeWidth={1.6} />}
      </IconButton>
      <IconButton
        variant="window-close"
        label={t('titlebar.close')}
        onClick={() => void window.lumacut.invoke('window:close')}
      >
        <X {...ICON} />
      </IconButton>
    </div>
  )
}
