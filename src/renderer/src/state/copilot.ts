import { create } from 'zustand'
import type { Command } from '@engine/commands'
import { t } from '../i18n'
import { startExport } from '../lib/actions'
import { diffSequence, isEmptyDiff, type SequenceDiff } from '../lib/diff'
import { notify } from './notices'
import { selectProject, selectSequence, useProject } from './project'
import { useSettings } from './settings'

export type CopilotLine =
  | { kind: 'user' | 'assistant' | 'error'; text: string }
  | { kind: 'tool'; name: string; result: string; error: boolean }

type Pending = {
  commands: Command[]
  diff: SequenceDiff
  exportAfterApply: boolean
  prompt: string
}

type CopilotState = {
  open: boolean
  conversationId: string
  lines: CopilotLine[]
  running: boolean
  pending: Pending | null
}

const newId = () => crypto.randomUUID()

export const useCopilot = create<CopilotState>(() => ({
  open: false,
  conversationId: newId(),
  lines: [],
  running: false,
  pending: null,
}))

const push = (line: CopilotLine) => useCopilot.setState((s) => ({ lines: [...s.lines, line] }))

let listening = false
function listen() {
  if (listening) return
  listening = true
  window.lumacut.on('copilot:event', ({ conversationId, event }) => {
    if (conversationId !== useCopilot.getState().conversationId) return
    if (event.type === 'text') push({ kind: 'assistant', text: event.text })
    else push({ kind: 'tool', name: event.name, result: event.result, error: event.error })
  })
}

/** Sends a request; its edits come back for review, or are applied straight away in automatic mode. */
export async function askCopilot(prompt: string) {
  listen()
  const { conversationId, running, pending } = useCopilot.getState()
  if (running) return
  if (pending) discardChanges()
  const state = useProject.getState()
  const project = selectProject(state)
  const sequence = selectSequence(state)
  push({ kind: 'user', text: prompt })
  useCopilot.setState({ running: true })
  try {
    const result = await window.lumacut.invoke('copilot:run', {
      conversationId,
      prompt,
      project,
      sequenceId: sequence.id,
    })
    push({ kind: 'assistant', text: result.message })
    if (result.commands.length === 0) {
      if (result.exportAfterApply) void startExport()
      return
    }
    const diff = diffSequence(sequence, result.project.sequences[sequence.id]!)
    const next: Pending = {
      commands: result.commands,
      diff,
      exportAfterApply: result.exportAfterApply,
      prompt,
    }
    if (useSettings.getState().settings.ai.applyMode === 'auto' || isEmptyDiff(diff)) {
      useCopilot.setState({ pending: next })
      applyChanges()
    } else useCopilot.setState({ pending: next })
  } catch (error) {
    const text =
      error instanceof Error
        ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        : String(error)
    if (!/abort/i.test(text)) push({ kind: 'error', text })
  } finally {
    useCopilot.setState({ running: false })
  }
}

/** Applies the reviewed change as one undo step. */
export function applyChanges() {
  const pending = useCopilot.getState().pending
  if (!pending) return
  const ok = useProject.getState().dispatch({
    type: 'batch',
    label: t('copilot.undoLabel', { prompt: pending.prompt.slice(0, 40) }),
    commands: pending.commands,
  })
  useCopilot.setState({ pending: null })
  if (ok) {
    push({ kind: 'assistant', text: t('copilot.applied') })
    if (pending.exportAfterApply) void startExport()
  } else notify('error', t('copilot.applyFailed'))
}

export function discardChanges() {
  if (!useCopilot.getState().pending) return
  useCopilot.setState({ pending: null })
  push({ kind: 'assistant', text: t('copilot.discarded') })
}

export function stopCopilot() {
  void window.lumacut.invoke('copilot:cancel', {
    conversationId: useCopilot.getState().conversationId,
  })
}

export function newChat() {
  const old = useCopilot.getState().conversationId
  void window.lumacut.invoke('copilot:reset', { conversationId: old })
  useCopilot.setState({ conversationId: newId(), lines: [], pending: null, running: false })
}
