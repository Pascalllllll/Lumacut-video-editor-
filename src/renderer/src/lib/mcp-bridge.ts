import { create } from 'zustand'
import type { Command } from '@engine/commands'
import { selectProject, selectSequence, useProject } from '../state/project'
import { useSettings } from '../state/settings'
import { previewCommands, type SequenceDiff } from './diff'

/** An edit from another AI tool, waiting for the user. */
type Review = { id: string; label: string; commands: Command[]; diff: SequenceDiff }

export const useReview = create<{ review: Review | null }>(() => ({ review: null }))

function apply(commands: Command[], label: string): boolean {
  return useProject.getState().dispatch({ type: 'batch', label, commands })
}

let started = false
/** Answers the MCP server: the open project, and edits applied or held for review. */
export function startMcpBridge() {
  if (started) return
  started = true
  window.lumacut.on('mcp:request', (req) => {
    const state = useProject.getState()
    if (req.kind === 'snapshot') {
      void window.lumacut.invoke('mcp:reply', {
        id: req.id,
        project: selectProject(state),
        sequenceId: selectSequence(state).id,
      })
      return
    }
    const commands = req.commands ?? []
    const label = req.label ?? 'MCP edit'
    if (useSettings.getState().settings.ai.applyMode === 'auto') {
      void window.lumacut.invoke('mcp:reply', { id: req.id, applied: apply(commands, label) })
      return
    }
    let diff: SequenceDiff
    try {
      diff = previewCommands(selectProject(state), selectSequence(state).id, commands)
    } catch {
      void window.lumacut.invoke('mcp:reply', { id: req.id, applied: false })
      return
    }
    // A newer request replaces one still on screen, which counts as declined.
    const old = useReview.getState().review
    if (old) void window.lumacut.invoke('mcp:reply', { id: old.id, applied: false })
    useReview.setState({ review: { id: req.id, label, commands, diff } })
  })
}

export function answerReview(accept: boolean) {
  const review = useReview.getState().review
  if (!review) return
  useReview.setState({ review: null })
  const applied = accept && apply(review.commands, review.label)
  void window.lumacut.invoke('mcp:reply', { id: review.id, applied })
}
