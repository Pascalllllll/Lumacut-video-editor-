import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { Command } from '@engine/commands'
import type { Project } from '@engine/model'
import { modelById } from '@shared/models'
import { PROVIDERS, staysLocal } from '@shared/providers'
import type { Settings } from '@shared/settings'
import { runTool, toolSpecs, type ToolServices, type ToolSession } from '../../ai/tools'
import { frameJpeg, findSilences, transcribe } from '../ai-service'
import { frameStatsAt } from '../analysis-service'
import { waveform, WAVEFORM_RATE } from '../media-service'
import { modelReady } from '../models-service'
import { getKey } from './keys'
import { createConversation, ProviderError, type Conversation, type ToolOutcome } from './providers'

export const SYSTEM_PROMPT = `You are the editing assistant inside Lumacut, a desktop video editor. You change the user's open sequence only through the tools you are given; each tool call is a real edit, and nothing changes until you call one.

How the timeline works: times are seconds from the start of the sequence. Tracks are named V1, V2 (video, higher covers lower) and A1, A2 (audio). Video clips with sound have a linked audio clip that moves with them. Use get_timeline for clip ids before editing clips.

Work in small, checkable steps and use what the tools return. If a request is unclear or impossible with the tools, say so instead of guessing. The user reviews every change before it is applied, as one step they can undo.

When you finish, reply in two or three plain sentences saying what you changed.`

/** Services the tools use, backed by FFmpeg and the local models. */
export function mainServices(): ToolServices {
  return {
    // The more accurate model when it is downloaded.
    transcribe: (asset, language) =>
      transcribe(
        asset.path,
        modelReady(modelById('whisper-small')!) ? 'whisper-small' : 'whisper-base',
        language,
      ),
    silences: (project, sequenceId, threshold, min) =>
      findSilences(project, sequenceId, threshold, min),
    frame: (asset, seconds) => frameJpeg(asset.path, seconds),
    stats: (asset, seconds) =>
      frameStatsAt(asset.path, seconds, asset.color, asset.width ?? 1920, asset.height ?? 1080),
    waveform: async (asset) => ({ rate: WAVEFORM_RATE, peaks: await waveform(asset.path) }),
  }
}

export type CopilotEvent =
  | { type: 'tool'; name: string; args: unknown; result: string; error: boolean }
  | { type: 'text'; text: string }

export type CopilotResult = {
  message: string
  commands: Command[]
  project: Project
  exportAfterApply: boolean
  usage: { input: number; output: number }
}

const conversations = new Map<string, Conversation>()
const MAX_STEPS = 24

/** Refuses requests that would leave the computer when local-only mode is on. */
export function checkDestination(ai: Settings['ai']) {
  if (!ai.provider) throw new ProviderError('Choose an AI provider in Settings, under AI.')
  if (ai.localOnly && !staysLocal(ai.provider, ai.baseUrl))
    throw new ProviderError(
      'Local-only mode is on, so the copilot only talks to models on this computer (Ollama, LM Studio, or a local address).',
    )
}

/** The first message of a conversation: the request plus a short summary of the project. */
export async function firstMessage(prompt: string, project: Project, sequenceId: string) {
  const session: ToolSession = {
    project,
    sequenceId,
    commands: [],
    services: mainServices(),
    exportAfterApply: false,
  }
  const summary = (await runTool(session, 'get_project_summary', {})).text
  return `${prompt}\n\nThe project right now:\n${summary}`
}

/**
 * Runs one request: the model calls tools against a working copy of the
 * project until it is done. Nothing is applied here; the edits come back as
 * commands for the editor to show and apply as one undo step.
 */
export async function runCopilot(
  req: { conversationId: string; prompt: string; project: Project; sequenceId: string },
  ai: Settings['ai'],
  emit: (e: CopilotEvent) => void,
  signal: AbortSignal,
): Promise<CopilotResult> {
  checkDestination(ai)
  const provider = ai.provider!
  let conv = conversations.get(req.conversationId)
  const fresh = !conv
  if (!conv) {
    conv = createConversation(
      {
        provider,
        model: ai.model || PROVIDERS[provider].defaultModel,
        baseUrl: ai.baseUrl,
        apiKey: await getKey(provider),
      },
      SYSTEM_PROMPT,
      toolSpecs(),
    )
    conversations.set(req.conversationId, conv)
  }
  const session: ToolSession = {
    project: req.project,
    sequenceId: req.sequenceId,
    commands: [],
    services: mainServices(),
    exportAfterApply: false,
  }
  const usage = { input: 0, output: 0 }
  const text = fresh ? await firstMessage(req.prompt, req.project, req.sequenceId) : req.prompt
  let step = await conv.send(text, signal)
  for (let i = 0; i < MAX_STEPS; i++) {
    usage.input += step.usage.input
    usage.output += step.usage.output
    if (step.text && step.stop === 'tools') emit({ type: 'text', text: step.text })
    if (step.stop !== 'tools') break
    const outcomes: ToolOutcome[] = []
    for (const call of step.toolCalls) {
      const r = await runTool(session, call.name, call.args)
      emit({
        type: 'tool',
        name: call.name,
        args: call.args,
        result: r.text.slice(0, 400),
        error: r.error ?? false,
      })
      outcomes.push({
        id: call.id,
        text: r.text,
        ...(r.images ? { images: r.images } : {}),
        ...(r.error ? { error: true } : {}),
      })
    }
    step = await conv.results(outcomes, signal)
  }
  const message =
    step.stop === 'refusal'
      ? 'The model declined this request.'
      : step.stop === 'limit'
        ? `${step.text}\n\nThe reply hit its length limit.`.trim()
        : step.stop === 'tools'
          ? 'The request needed more steps than allowed. Try a smaller request.'
          : step.text || 'Done.'
  await logRun(req, ai, message, session.commands.length)
  return {
    message,
    commands: session.commands,
    project: session.project,
    exportAfterApply: session.exportAfterApply,
    usage,
  }
}

export function forgetConversation(id: string) {
  conversations.delete(id)
}

// ---------------------------------------------------------------- history

export type HistoryEntry = {
  at: string
  provider: string
  model: string
  prompt: string
  reply: string
  changes: number
}

const historyFile = (projectId: string) =>
  join(app.getPath('userData'), 'ai-history', `${projectId.replace(/[^\w-]/g, '')}.jsonl`)

async function logRun(
  req: { prompt: string; project: Project },
  ai: Settings['ai'],
  reply: string,
  changes: number,
) {
  const entry: HistoryEntry = {
    at: new Date().toISOString(),
    provider: ai.provider ?? '',
    model: ai.model,
    prompt: req.prompt,
    reply,
    changes,
  }
  await mkdir(join(app.getPath('userData'), 'ai-history'), { recursive: true })
  await appendFile(historyFile(req.project.id), `${JSON.stringify(entry)}\n`)
}

/** What the copilot did in a project, newest first. */
export async function readHistory(projectId: string): Promise<HistoryEntry[]> {
  const file = historyFile(projectId)
  if (!existsSync(file)) return []
  return (await readFile(file, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as HistoryEntry)
    .reverse()
}
