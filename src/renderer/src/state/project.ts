import { produce } from 'immer'
import { create } from 'zustand'
import type { Command } from '@engine/commands'
import { execute, redo, undo, type HistoryState } from '@engine/history'
import { activeSequence, createProject, type Clip, type Project } from '@engine/model'
import { companions } from '@engine/timeline'
import { t } from '../i18n'
import { notify } from './notices'
import { usePlayhead } from './playhead'
import { useSettings } from './settings'

type ProjectState = {
  history: HistoryState
  path: string | null
  savedProject: Project
  selection: string[]
  selectedMarker: string | null
  selectedTransition: string | null
  importing: number
  /** Sequences with a tab in the timeline, in tab order. */
  openSequences: string[]
  dispatch: (cmd: Command) => boolean
  undo: () => void
  redo: () => void
  select: (clipIds: string[], opts?: { expand?: boolean }) => void
  replace: (project: Project, path: string | null, saved?: Project) => void
  openSequence: (sequenceId: string) => void
  closeSequence: (sequenceId: string) => void
}

const initial = createProject(t('project.untitled'))

export const useProject = create<ProjectState>((set, get) => ({
  history: { project: initial, past: [], future: [] },
  path: null,
  savedProject: initial,
  selection: [],
  selectedMarker: null,
  selectedTransition: null,
  importing: 0,
  openSequences: [initial.activeSequenceId],
  dispatch: (cmd) => {
    try {
      set((s) => ({ history: execute(s.history, cmd) }))
      prune()
      return true
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error))
      return false
    }
  },
  undo: () => {
    set((s) => ({ history: undo(s.history) }))
    prune()
  },
  redo: () => {
    set((s) => ({ history: redo(s.history) }))
    prune()
  },
  select: (ids, opts) => {
    const expand = opts?.expand ?? useSettings.getState().settings.linkedSelection
    const seq = activeSequence(get().history.project)
    set({
      selection: expand ? [...companions(seq, ids)] : ids,
      selectedMarker: null,
      selectedTransition: null,
    })
  },
  replace: (project, path, saved) => {
    set({
      history: { project, past: [], future: [] },
      path,
      savedProject: saved ?? project,
      selection: [],
      selectedMarker: null,
      selectedTransition: null,
      openSequences: [project.activeSequenceId],
    })
    usePlayhead.getState().seek(0)
  },
  openSequence: (sequenceId) => {
    const { history, openSequences } = get()
    if (!history.project.sequences[sequenceId]) return
    // Switching sequences is a view change: it isn't an undo step.
    const project = produce(history.project, (draft) => {
      draft.activeSequenceId = sequenceId
    })
    set({
      history: { ...history, project },
      savedProject:
        get().savedProject.activeSequenceId === sequenceId
          ? get().savedProject
          : withActive(get().savedProject, sequenceId),
      openSequences: openSequences.includes(sequenceId)
        ? openSequences
        : [...openSequences, sequenceId],
      selection: [],
      selectedMarker: null,
      selectedTransition: null,
    })
    usePlayhead.getState().seek(0)
  },
  closeSequence: (sequenceId) => {
    const { openSequences, history } = get()
    if (openSequences.length <= 1) return
    const remaining = openSequences.filter((id) => id !== sequenceId)
    set({ openSequences: remaining })
    if (history.project.activeSequenceId === sequenceId)
      get().openSequence(remaining[remaining.length - 1]!)
  },
}))

/** The saved snapshot follows view changes too, so switching tabs doesn't mark the project as edited. */
function withActive(project: Project, sequenceId: string): Project {
  return project.sequences[sequenceId] ? { ...project, activeSequenceId: sequenceId } : project
}

function prune() {
  const { selection, selectedMarker, selectedTransition, history, openSequences } =
    useProject.getState()
  const project = history.project
  if (!project.sequences[project.activeSequenceId]) {
    const fallback = Object.keys(project.sequences)[0]
    if (fallback) useProject.getState().openSequence(fallback)
    return
  }
  const seq = activeSequence(project)
  const kept = selection.filter((id) => seq.clips[id])
  const open = openSequences.filter((id) => project.sequences[id])
  useProject.setState({
    ...(kept.length !== selection.length ? { selection: kept } : {}),
    ...(selectedMarker && !seq.markers[selectedMarker] ? { selectedMarker: null } : {}),
    ...(selectedTransition && !seq.transitions[selectedTransition]
      ? { selectedTransition: null }
      : {}),
    ...(open.length !== openSequences.length
      ? { openSequences: open.length ? open : [project.activeSequenceId] }
      : {}),
  })
}

export const selectProject = (s: ProjectState) => s.history.project
export const selectSequence = (s: ProjectState) => activeSequence(s.history.project)
export const selectDirty = (s: ProjectState) => {
  const a = s.history.project
  const b = s.savedProject
  return a.media !== b.media || a.sequences !== b.sequences || a.name !== b.name
}

/** The clip a placement command adds first, so a caller can line up the next one. */
export function addedClip(cmd: Command): Clip | undefined {
  if (cmd.type === 'clip.add' || cmd.type === 'clip.insert') return cmd.clips[0]
  if (cmd.type === 'batch') {
    for (const sub of cmd.commands) {
      const found = addedClip(sub)
      if (found) return found
    }
  }
  return undefined
}
