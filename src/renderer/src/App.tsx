import { useEffect } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { Workspace } from '@shared/settings'
import { t } from './i18n'
import { useSettings } from './state/settings'
import { useResolvedTheme } from './lib/useResolvedTheme'
import { TitleBar } from './components/TitleBar'
import { SettingsDialog } from './components/SettingsDialog'
import { WorkspaceView } from './workspaces/WorkspaceView'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ExportSheet } from './components/ExportSheet'
import { Notices } from './components/Notices'
import { useShortcuts } from './lib/shortcuts'
import { useAutosave, useProxyUpdates } from './lib/autosave'
import { VersionsDialog } from './components/VersionsDialog'
import { selectDirty, useProject } from './state/project'
import { startMcpBridge } from './lib/mcp-bridge'
import { useMissingMedia } from './lib/missing'
import { ReviewDialog } from './panels/copilot/ReviewDialog'
import { CommandPalette } from './components/CommandPalette'
import { Onboarding } from './components/Onboarding'
import { WhatsNew } from './components/WhatsNew'
import { Home } from './components/Home'
import { Tour } from './components/Tour'
import { importMedia, openProject } from './lib/actions'
import { startAccount } from './state/account'
import { useEditor } from './state/editor'
import styles from './App.module.css'

export function App() {
  const settings = useSettings((s) => s.settings)
  const loaded = useSettings((s) => s.loaded)
  const saveError = useSettings((s) => s.saveError)
  const load = useSettings((s) => s.load)
  const update = useSettings((s) => s.update)
  const theme = useResolvedTheme(settings.theme)
  const settingsOpen = useEditor((s) => s.settingsOpen)
  const setSettingsOpen = (open: boolean) => useEditor.setState({ settingsOpen: open })
  const dirty = useProject(selectDirty)
  const projectName = useProject((s) => s.history.project.name)
  useShortcuts()
  useAutosave()
  useProxyUpdates()
  useMissingMedia()

  useEffect(() => {
    void window.lumacut.invoke('project:set-dirty', { dirty, name: projectName })
  }, [dirty, projectName])

  const home = useEditor((s) => s.home)

  useEffect(() => {
    void load()
    startMcpBridge()
    startAccount()
    return window.lumacut.on('project:open-file', (path) => void openProject(path))
  }, [load])

  // Files dropped outside the media list and timeline are imported (or opened, for a project),
  // never navigated to: Chromium's default would load the file in place of Lumacut.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      const handled = e.defaultPrevented
      e.preventDefault()
      if (handled) return
      const paths = Array.from(e.dataTransfer!.files)
        .map((f) => window.lumacut.pathForFile(f))
        .filter(Boolean)
      const project = paths.find((p) => p.toLowerCase().endsWith('.lumacut'))
      if (project) void openProject(project)
      else if (paths.length) void importMedia(paths)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  // On launch: open the file Lumacut was started with, or show the start screen if there's history.
  useEffect(() => {
    if (!loaded) return
    void (async () => {
      const file = await window.lumacut.invoke('app:launch-file')
      if (file) return void openProject(file)
      const { onboarded, startScreen } = useSettings.getState().settings
      if (!onboarded || !startScreen) return
      const recent = await window.lumacut.invoke('recent:list')
      if (recent.length && !selectDirty(useProject.getState()) && !useProject.getState().path)
        useEditor.setState({ home: true })
    })()
  }, [loaded])

  useEffect(() => {
    const root = document.documentElement
    root.dataset['theme'] = theme
    root.dataset['accent'] = settings.accent
  }, [theme, settings.accent])

  useEffect(() => {
    document.title = `${projectName}${dirty ? ' *' : ''} · ${t('app.name')}`
  }, [projectName, dirty])

  return (
    <Tooltip.Provider delayDuration={500}>
      <div className={styles.app} data-loaded={loaded}>
        {/* One tab set spans the title bar's workspace tabs and the workspace they show. */}
        <Tabs.Root
          className={styles.tabs}
          // While the start screen shows, no workspace tab is selected, so any of them leaves it.
          value={home ? 'home' : settings.workspace}
          onValueChange={(value) => {
            useEditor.setState({ home: false })
            void update({ workspace: value as Workspace })
          }}
        >
          <TitleBar onOpenSettings={() => setSettingsOpen(true)} />
          <Tabs.Content value={home ? 'home' : settings.workspace} asChild>
            <main className={styles.content}>
              {home ? <Home /> : <WorkspaceView workspace={settings.workspace} />}
            </main>
          </Tabs.Content>
        </Tabs.Root>
        {saveError ? (
          <div role="status" className={styles.banner}>
            {t('errors.settingsSave')}
          </div>
        ) : null}
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <ConfirmDialog />
        <VersionsDialog />
        <ExportSheet />
        <ReviewDialog />
        <CommandPalette />
        <Onboarding />
        <WhatsNew />
        <Tour />
        <Notices />
      </div>
    </Tooltip.Provider>
  )
}
