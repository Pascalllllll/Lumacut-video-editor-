import { produce } from 'immer'
import { applyCommand, pruneTransitions, type Command } from './commands'
import type { MediaAsset, Project, Sequence } from './model'

/**
 * Builds the command that takes `after` back to `before`: every sequence or
 * media item that changed is put back as it was. Immer shares unchanged
 * objects between versions, so keeping the old objects costs almost nothing
 * and no command needs a hand-written inverse.
 */
export function inverseOf(before: Project, after: Project): Command {
  const sequences: Record<string, Sequence | null> = {}
  const media: Record<string, MediaAsset | null> = {}
  if (before.sequences !== after.sequences) {
    for (const sid of new Set([
      ...Object.keys(before.sequences),
      ...Object.keys(after.sequences),
    ])) {
      if (before.sequences[sid] !== after.sequences[sid])
        sequences[sid] = before.sequences[sid] ?? null
    }
  }
  if (before.media !== after.media) {
    for (const mid of new Set([...Object.keys(before.media), ...Object.keys(after.media)])) {
      if (before.media[mid] !== after.media[mid]) media[mid] = before.media[mid] ?? null
    }
  }
  return { type: 'restore', sequences, media }
}

type Entry = { label: string; redo: Command; undo: Command }

export type HistoryState = { project: Project; past: Entry[]; future: Entry[] }

export function labelOf(cmd: Command): string {
  return cmd.type === 'batch' ? cmd.label : cmd.type
}

/** Applies a command and records it. Throws (leaving state untouched) if the command is invalid. */
export function execute(state: HistoryState, cmd: Command, limit = 500): HistoryState {
  const next = produce(state.project, (draft) => {
    applyCommand(draft, cmd)
    pruneTransitions(draft)
  })
  if (next === state.project) return state
  const entry: Entry = { label: labelOf(cmd), redo: cmd, undo: inverseOf(state.project, next) }
  return { project: next, past: [...state.past, entry].slice(-limit), future: [] }
}

export function undo(state: HistoryState): HistoryState {
  const entry = state.past.at(-1)
  if (!entry) return state
  const project = produce(state.project, (draft) => applyCommand(draft, entry.undo))
  return { project, past: state.past.slice(0, -1), future: [entry, ...state.future] }
}

export function redo(state: HistoryState): HistoryState {
  const entry = state.future[0]
  if (!entry) return state
  // Recompute the inverse: the project may hold view changes (like the open sequence) made since.
  const project = produce(state.project, (draft) => {
    applyCommand(draft, entry.redo)
    pruneTransitions(draft)
  })
  const fresh = { ...entry, undo: inverseOf(state.project, project) }
  return { project, past: [...state.past, fresh], future: state.future.slice(1) }
}
