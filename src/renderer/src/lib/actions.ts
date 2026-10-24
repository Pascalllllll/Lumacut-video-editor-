import { applyTransitionAtPlayhead } from '../panels/Library'
import type { Command } from '@engine/commands'
import {
  angleCommand,
  bladeCommand,
  clipsUnder,
  compoundCommand,
  groupCommand,
  linkCommand,
  markerCommand,
  multicamAt,
  multicamCommand,
  newSequenceCommand,
  sourceEditCommand,
  type SourceEdit,
} from '@engine/edits'
import { activeSequence, createProject, type Clip, type MediaAsset } from '@engine/model'
import { clipEnd, sequenceDuration } from '@engine/timeline'
import type { ExportOptions } from '@shared/export'
import type { MenuCommand } from '@shared/ipc'
import { t } from '../i18n'
import { askToSave } from '../state/confirm'
import { useEditor } from '../state/editor'
import { addJob } from '../state/export'
import { notify } from '../state/notices'
import { usePlayhead } from '../state/playhead'
import { selectDirty, selectSequence, useProject } from '../state/project'
import { useSelectedMedia } from '../state/selection'
import { useSettings } from '../state/settings'
import { checkForUpdates, useUpdates } from '../state/updates'
import { useVersions } from '../state/versions'
import { needsProxy } from './media-url'

function message(error: unknown) {
  // Electron prefixes errors thrown in the main process; people only need the reason.
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function run(build: () => Command | null) {
  try {
    const cmd = build()
    if (cmd) useProject.getState().dispatch(cmd)
  } catch (error) {
    notify('error', message(error))
  }
}

const seq = () => selectSequence(useProject.getState())
const project = () => useProject.getState().history.project
const frame = () => usePlayhead.getState().frame

// ---------------------------------------------------------------- files

/** Returns false if the person cancelled. */
async function settleUnsavedChanges(): Promise<boolean> {
  const state = useProject.getState()
  if (!selectDirty(state)) return true
  const choice = await askToSave(
    t('confirm.unsavedTitle', { name: state.history.project.name }),
    t('confirm.unsavedBody'),
  )
  if (choice === 'cancel') return false
  if (choice === 'save') return saveProject(false)
  // Discarded on purpose: the autosaved copies aren't needed for recovery.
  void window.lumacut.invoke('autosave:clear', { projectId: state.history.project.id })
  return true
}

/** Returns false if the person cancelled. */
export async function newProject(): Promise<boolean> {
  if (!(await settleUnsavedChanges())) return false
  useProject.getState().replace(createProject(t('project.untitled')), null)
  useEditor.setState({ home: false })
  return true
}

/** Returns true once the project is open. */
export async function openProject(path?: string): Promise<boolean> {
  if (!(await settleUnsavedChanges())) return false
  try {
    const result = await window.lumacut.invoke('project:open', path ? { path } : {})
    if (!result) return false
    useProject.getState().replace(result.project, result.path)
    useEditor.setState({ home: false })
    void refreshProxies(Object.values(result.project.media))
    return true
  } catch (error) {
    notify('error', message(error))
    return false
  }
}

export async function saveProject(saveAs: boolean): Promise<boolean> {
  const { history, path } = useProject.getState()
  try {
    const result = await window.lumacut.invoke('project:save', {
      project: history.project,
      path: saveAs ? null : path,
    })
    if (!result) return false
    const fileName = result.path.split(/[\\/]/).pop() ?? result.path
    const named =
      result.name === history.project.name
        ? history.project
        : { ...history.project, name: result.name }
    useProject.setState((s) => ({
      path: result.path,
      savedProject: named,
      history: { ...s.history, project: named },
    }))
    void window.lumacut.invoke('autosave:clear', { projectId: named.id })
    notify('info', t('notice.saved', { name: fileName }))
    return true
  } catch (error) {
    notify('error', t('errors.saveFailed', { reason: message(error) }))
    return false
  }
}

export async function openVersion(file: string) {
  if (!(await settleUnsavedChanges())) return
  try {
    const result = await window.lumacut.invoke('autosave:open', { file })
    // The restored copy counts as unsaved until it is saved over the original.
    useProject
      .getState()
      .replace(result.project, result.sourcePath, { ...result.project, sequences: {} })
    useVersions.setState({ open: false, recovery: false })
    void refreshProxies(Object.values(result.project.media))
  } catch (error) {
    notify('error', message(error))
  }
}

// ---------------------------------------------------------------- media

export async function refreshProxies(assets: MediaAsset[]) {
  const paths = assets.filter((a) => a.kind === 'video').map((a) => a.path)
  if (!paths.length) return
  const status = await window.lumacut.invoke('proxy:status', { paths })
  useEditor.setState((s) => ({ proxies: { ...s.proxies, ...status } }))
}

export function createProxies(assets: MediaAsset[]) {
  const items = assets
    .filter((a) => a.kind === 'video' && !useEditor.getState().proxies[a.path])
    .map((a) => ({
      path: a.path,
      duration: a.duration ?? 0,
      color: a.color,
      width: a.width ?? 0,
      height: a.height ?? 0,
    }))
  if (items.length) void window.lumacut.invoke('proxy:create', { items })
}

export async function importMedia(paths?: string[]): Promise<MediaAsset[]> {
  useEditor.setState({ home: false })
  useProject.setState((s) => ({ importing: s.importing + 1 }))
  try {
    const result = await window.lumacut.invoke('media:import', paths ? { paths } : {})
    if (result.assets.length) {
      useProject.getState().dispatch({ type: 'media.add', assets: result.assets })
      await refreshProxies(result.assets)
      const rule = useSettings.getState().settings.autoProxy
      createProxies(result.assets.filter((a) => needsProxy(a, rule)))
    }
    for (const error of result.errors) notify('error', error)
    return result.assets
  } catch (error) {
    notify('error', message(error))
    return []
  } finally {
    useProject.setState((s) => ({ importing: s.importing - 1 }))
  }
}

export function openInSource(mediaId: string) {
  const asset = project().media[mediaId]
  if (!asset) return
  if (asset.kind === 'sequence' && asset.sequenceId) {
    useProject.getState().openSequence(asset.sequenceId)
    useEditor.setState({ viewer: 'timeline' })
    return
  }
  usePlayhead.getState().setPlaying(false)
  useEditor.setState({ viewer: 'source', sourceMediaId: mediaId, sourceTime: asset.marks.in ?? 0 })
}

export function newSequence() {
  const p = project()
  const n = Object.keys(p.sequences).length + 1
  run(() => newSequenceCommand(p, t('sequence.defaultName', { n }), seq()))
}

export async function createMulticam(mediaIds: string[]) {
  const assets = mediaIds
    .map((id) => project().media[id])
    .filter((a): a is MediaAsset => Boolean(a) && a!.kind === 'video')
  if (assets.length < 2) {
    notify('error', t('errors.multicamNeedsTwo'))
    return
  }
  try {
    let offsets = assets.map(() => 0)
    if (assets.every((a) => a.hasAudio)) {
      const result = await window.lumacut.invoke('media:sync', { paths: assets.map((a) => a.path) })
      offsets = result.offsets
      if (result.confidence.slice(1).some((c) => c < 0.3)) notify('info', t('notice.syncUnsure'))
    } else {
      notify('info', t('notice.syncNoAudio'))
    }
    const n = Object.values(project().sequences).filter((s) => s.multicam).length + 1
    const { command } = multicamCommand(
      project(),
      assets,
      offsets,
      t('sequence.multicamName', { n }),
    )
    useProject.getState().dispatch(command)
  } catch (error) {
    notify('error', message(error))
  }
}

// ---------------------------------------------------------------- timeline edits

export function splitAtPlayhead() {
  const { selection } = useProject.getState()
  const s = seq()
  const under = clipsUnder(s, frame())
  // Split the selected clips under the playhead, or every clip under it when nothing is selected.
  const targets = selection.length ? under.filter((id) => selection.includes(id)) : under
  run(() => bladeCommand(s, targets, frame()))
}

export function deleteSelection(ripple: boolean) {
  const { selection, selectedMarker, selectedTransition } = useProject.getState()
  if (selectedTransition && selection.length === 0) {
    run(() => ({
      type: 'transition.remove',
      sequenceId: seq().id,
      transitionIds: [selectedTransition],
    }))
    return
  }
  if (selectedMarker && selection.length === 0) {
    run(() => ({ type: 'marker.remove', sequenceId: seq().id, markerIds: [selectedMarker] }))
    return
  }
  if (selection.length === 0) return
  run(() => ({ type: 'clip.remove', sequenceId: seq().id, clipIds: selection, ripple }))
}

export function sourceEdit(mode: SourceEdit) {
  const { sourceMediaId } = useEditor.getState()
  const mediaId = sourceMediaId ?? useSelectedMedia.getState().mediaId
  const asset = mediaId ? project().media[mediaId] : undefined
  if (!asset) {
    notify('error', t('errors.noSource'))
    return
  }
  run(() => sourceEditCommand(project(), seq(), asset, mode, frame()))
}

export function liftOrExtract(kind: 'lift' | 'extract') {
  const s = seq()
  if (s.inPoint === null || s.outPoint === null) {
    notify('error', t('errors.needRange'))
    return
  }
  run(() => ({
    type: kind === 'lift' ? 'range.lift' : 'range.extract',
    sequenceId: s.id,
    start: s.inPoint!,
    end: s.outPoint!,
    trackIds: s.tracks.map((tr) => tr.id),
  }))
}

/** I and O mark the source item when the source viewer is showing, otherwise the timeline. */
export function mark(which: 'in' | 'out' | 'clear') {
  const editor = useEditor.getState()
  if (editor.viewer === 'source' && editor.sourceMediaId) {
    const asset = project().media[editor.sourceMediaId]
    if (!asset) return
    const marks =
      which === 'clear' ? { in: null, out: null } : { ...asset.marks, [which]: editor.sourceTime }
    run(() => ({ type: 'media.update', mediaId: asset.id, patch: { marks } }))
    return
  }
  const s = seq()
  if (which === 'clear')
    run(() => ({ type: 'sequence.settings', sequenceId: s.id, inPoint: null, outPoint: null }))
  else
    run(() => ({
      type: 'sequence.settings',
      sequenceId: s.id,
      [which === 'in' ? 'inPoint' : 'outPoint']: frame(),
    }))
}

export function markSelectedClip() {
  const { selection } = useProject.getState()
  const s = seq()
  const clips = selection.map((id) => s.clips[id]).filter(Boolean)
  if (clips.length === 0) return
  run(() => ({
    type: 'sequence.settings',
    sequenceId: s.id,
    inPoint: Math.min(...clips.map((c) => c!.start)),
    outPoint: Math.max(...clips.map((c) => clipEnd(c!))),
  }))
}

export function addMarker() {
  run(() => markerCommand(seq(), frame()))
}

export function toggleLink() {
  const { selection } = useProject.getState()
  if (selection.length === 0) return
  const s = seq()
  const links = new Set(selection.map((id) => s.clips[id]?.linkId ?? null))
  const allLinked = links.size === 1 && !links.has(null)
  run(() => linkCommand(s, selection, !allLinked))
}

export function group(on: boolean) {
  const { selection } = useProject.getState()
  if (selection.length === 0) return
  run(() => groupCommand(seq(), selection, on))
}

export function makeCompound() {
  const { selection } = useProject.getState()
  const n = Object.values(project().media).filter((m) => m.kind === 'sequence').length
  run(() => compoundCommand(project(), seq(), selection, t('sequence.compoundName', { n })))
}

export function switchAngle(angle: number) {
  const s = seq()
  const clip = multicamAt(project(), s, frame())
  if (!clip) return
  run(() => angleCommand(s, clip.id, angle, frame()))
}

export function toggleMagnetic() {
  const s = seq()
  run(() => ({ type: 'sequence.settings', sequenceId: s.id, magnetic: !s.magnetic }))
}

/** Jumps to the previous or next cut on any track. */
export function jumpToEdit(direction: 1 | -1) {
  const s = seq()
  const now = frame()
  const points = new Set<number>([0, sequenceDuration(s)])
  for (const c of Object.values(s.clips)) {
    points.add(c.start)
    points.add(clipEnd(c))
  }
  const sorted = [...points].sort((a, b) => a - b)
  const target = direction > 0 ? sorted.find((p) => p > now) : sorted.reverse().find((p) => p < now)
  if (target !== undefined) usePlayhead.getState().seek(target)
}

// ---------------------------------------------------------------- export

/** The part of the sequence an export covers, or null for all of it. */
export function exportRange(range: ExportOptions['range']): { start: number; end: number } | null {
  const state = useProject.getState()
  const s = activeSequence(state.history.project)
  if (range === 'inout') {
    const start = s.inPoint ?? 0
    const end = s.outPoint ?? sequenceDuration(s)
    if (s.inPoint === null && s.outPoint === null) throw new Error(t('export.noInOut'))
    return { start, end }
  }
  if (range === 'selection') {
    const clips = state.selection.map((id) => s.clips[id]).filter((c): c is Clip => Boolean(c))
    if (!clips.length) throw new Error(t('export.noSelection'))
    return {
      start: Math.min(...clips.map((c) => c.start)),
      end: Math.max(...clips.map((c) => clipEnd(c))),
    }
  }
  return null
}

/**
 * Queues an export with the given settings (the remembered ones by default).
 * `follow` shows its progress sheet, as the title bar's Export button does.
 */
export async function startExport(
  options: ExportOptions = useSettings.getState().settings.export,
  follow = true,
) {
  const { history } = useProject.getState()
  const s = activeSequence(history.project)
  if (Object.keys(s.clips).length === 0) {
    notify('error', t('errors.exportEmpty'))
    return
  }
  try {
    const result = await window.lumacut.invoke('export:start', {
      project: history.project,
      sequenceId: s.id,
      suggestedName: history.project.name,
      options,
      range: exportRange(options.range),
    })
    if (result)
      addJob(
        {
          jobId: result.jobId,
          path: result.path,
          name: result.path.split(/[\\/]/).pop() ?? '',
          preset: options.preset,
          state: 'queued',
          position: 0,
        },
        follow,
      )
  } catch (error) {
    notify('error', message(error))
  }
}

// ---------------------------------------------------------------- command routing

export function runCommand(command: MenuCommand) {
  const store = useProject.getState()
  switch (command) {
    case 'project.new':
      return void newProject()
    case 'project.open':
      return void openProject()
    case 'project.versions':
      return useVersions.setState({ open: true, recovery: false })
    case 'project.save':
      return void saveProject(false)
    case 'project.saveAs':
      return void saveProject(true)
    case 'media.import':
      return void importMedia()
    case 'media.proxies':
      return createProxies(
        useSelectedMedia
          .getState()
          .mediaIds.map((id) => project().media[id])
          .filter((a): a is MediaAsset => Boolean(a)),
      )
    case 'sequence.new':
      return newSequence()
    case 'sequence.export':
      return void startExport()
    case 'edit.undo':
      return store.undo()
    case 'edit.redo':
      return store.redo()
    case 'edit.split':
      return splitAtPlayhead()
    case 'edit.delete':
      return deleteSelection(false)
    case 'edit.rippleDelete':
      return deleteSelection(true)
    case 'edit.insert':
      return sourceEdit('insert')
    case 'edit.overwrite':
      return sourceEdit('overwrite')
    case 'edit.replace':
      return sourceEdit('replace')
    case 'edit.fitToFill':
      return sourceEdit('fit')
    case 'edit.lift':
      return liftOrExtract('lift')
    case 'edit.extract':
      return liftOrExtract('extract')
    case 'mark.in':
      return mark('in')
    case 'mark.out':
      return mark('out')
    case 'mark.clip':
      return markSelectedClip()
    case 'mark.clear':
      return mark('clear')
    case 'marker.add':
      return addMarker()
    case 'clip.link':
      return toggleLink()
    case 'clip.group':
      return group(true)
    case 'clip.ungroup':
      return group(false)
    case 'clip.compound':
      return makeCompound()
    case 'clip.multicam':
      return void createMulticam(useSelectedMedia.getState().mediaIds)
    case 'timeline.magnetic':
      return toggleMagnetic()
    case 'timeline.snapping':
      return void useSettings
        .getState()
        .update({ snapping: !useSettings.getState().settings.snapping })
    case 'clip.transition':
      return applyTransitionAtPlayhead()
    case 'timeline.zoomFit':
      return window.dispatchEvent(new Event('lumacut:zoom-fit'))
    case 'view.toggleViewer': {
      const editor = useEditor.getState()
      return useEditor.setState({
        viewer: editor.viewer === 'source' || !editor.sourceMediaId ? 'timeline' : 'source',
      })
    }
    case 'help.whatsNew':
      return useUpdates.setState({ whatsNew: true })
    case 'help.tour':
      return useEditor.setState({ home: false, tour: 0 })
    case 'project.home':
      return useEditor.setState({ home: true, tour: null })
    case 'help.updates':
      useEditor.setState({ settingsOpen: true })
      return void checkForUpdates()
    case 'playback.toggle': {
      const editor = useEditor.getState()
      if (editor.viewer === 'source')
        return window.dispatchEvent(new CustomEvent('lumacut:source-toggle'))
      const playhead = usePlayhead.getState()
      return playhead.setPlaying(!playhead.playing)
    }
  }
}
