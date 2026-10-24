import { useEffect } from 'react'
import type { Command } from '@engine/commands'
import type { MediaAsset } from '@engine/model'
import { t } from '../i18n'
import { useEditor } from '../state/editor'
import { notify } from '../state/notices'
import { selectProject, useProject } from '../state/project'

const fileMedia = (m: MediaAsset) =>
  m.path !== '' && m.kind !== 'sequence' && m.kind !== 'generator'

/**
 * Looks for missing media whenever the project's set of files changes, and
 * when the window comes back into focus (files are usually moved elsewhere).
 */
export function useMissingMedia() {
  const key = useProject((s) =>
    Object.values(selectProject(s).media)
      .filter(fileMedia)
      .map((m) => m.path)
      .sort()
      .join('\n'),
  )
  useEffect(() => {
    const paths = key ? key.split('\n') : []
    let live = true
    const check = () =>
      void window.lumacut.invoke('media:missing', { paths }).then((missing) => {
        if (live)
          useEditor.setState({
            missing: Object.fromEntries(missing.map((p) => [p, true as const])),
          })
      })
    check()
    window.addEventListener('focus', check)
    return () => {
      live = false
      window.removeEventListener('focus', check)
    }
  }, [key])
}

const message = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  )

export async function relink(asset: MediaAsset) {
  try {
    const found = await window.lumacut.invoke('media:relink', {
      name: asset.name,
      kind: asset.kind,
    })
    if (!found) return
    useProject.getState().dispatch({ type: 'media.update', mediaId: asset.id, patch: found })
    notify('info', t('media.relinked', { name: asset.name }))
  } catch (error) {
    notify('error', message(error))
  }
}

/** Finds every missing file in one folder by name, and relinks what it finds in one step. */
export async function locateMissing() {
  const project = selectProject(useProject.getState())
  const missing = useEditor.getState().missing
  const lost = Object.values(project.media).filter((m) => fileMedia(m) && missing[m.path])
  if (!lost.length) {
    notify('info', t('media.noneMissing'))
    return
  }
  try {
    const found = await window.lumacut.invoke('media:locate', {
      names: lost.map((m) => m.path.split(/[\\/]/).pop() ?? m.name),
    })
    if (!found) return
    const commands: Command[] = lost.flatMap((m) => {
      const hit = found[m.path.split(/[\\/]/).pop() ?? m.name]
      return hit ? [{ type: 'media.update' as const, mediaId: m.id, patch: hit }] : []
    })
    if (commands.length)
      useProject.getState().dispatch({ type: 'batch', label: t('media.relinkAll'), commands })
    notify('info', t('media.located', { found: commands.length, total: lost.length }))
  } catch (error) {
    notify('error', message(error))
  }
}

/** Copies every media file into one folder and points the project at the copies. */
export async function collectFiles() {
  const state = useProject.getState()
  const project = selectProject(state)
  const files = Object.values(project.media)
    .filter(fileMedia)
    .map((m) => ({ id: m.id, path: m.path }))
  if (!files.length) return
  try {
    const moved = await window.lumacut.invoke('media:collect', { files, suggested: project.name })
    if (!moved) return
    const commands: Command[] = Object.entries(moved).map(([id, patch]) => ({
      type: 'media.update',
      mediaId: id,
      patch,
    }))
    state.dispatch({ type: 'batch', label: t('media.collect'), commands })
    notify('info', t('media.collected', { count: commands.length }))
  } catch (error) {
    notify('error', message(error))
  }
}
