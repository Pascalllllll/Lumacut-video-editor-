import { useEffect } from 'react'
import { useEditor } from '../state/editor'
import { selectDirty, useProject } from '../state/project'
import { useSettings } from '../state/settings'
import { useVersions } from '../state/versions'

/**
 * Saves a copy of the project in the background while it has unsaved
 * changes, and offers to restore it if the app didn't close cleanly.
 */
export function useAutosave() {
  useEffect(() => {
    let last: unknown = null
    let timer = 0
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(tick, useSettings.getState().settings.autosaveSeconds * 1000)
    }
    const tick = async () => {
      const state = useProject.getState()
      const project = state.history.project
      if (selectDirty(state) && project !== last) {
        last = project
        await window.lumacut
          .invoke('autosave:write', { project, sourcePath: state.path })
          .catch(() => undefined)
      }
      schedule()
    }
    schedule()
    // Lets other parts of the app (and tests) save a copy right away, e.g. before a risky operation.
    const now = () => {
      window.clearTimeout(timer)
      void tick()
    }
    window.addEventListener('lumacut:autosave-now', now)

    void window.lumacut.invoke('app:session').then(async ({ crashed }) => {
      if (!crashed) return
      const versions = await window.lumacut.invoke('autosave:list')
      if (versions.some((v) => v.newer)) useVersions.setState({ open: true, recovery: true })
    })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('lumacut:autosave-now', now)
    }
  }, [])
}

/** Keeps proxy status and progress in step with the background queue. */
export function useProxyUpdates() {
  useEffect(
    () =>
      window.lumacut.on('proxy:update', (update) => {
        useEditor.setState((s) => {
          const progress = { ...s.proxyProgress }
          if (update.state === 'running') progress[update.path] = update.progress
          else if (update.state === 'queued') progress[update.path] = 0
          else delete progress[update.path]
          return {
            proxyProgress: progress,
            ...(update.state === 'done'
              ? { proxies: { ...s.proxies, [update.path]: update.proxy } }
              : {}),
          }
        })
      }),
    [],
  )
}
