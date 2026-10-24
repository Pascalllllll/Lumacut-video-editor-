import Anthropic from '@anthropic-ai/sdk'
import { PROVIDERS, type ProviderId } from '@shared/providers'

/** What the model asked for after one turn. */
export type Step = {
  text: string
  toolCalls: { id: string; name: string; args: unknown }[]
  /** `refusal` and `limit` end the run with a message. */
  stop: 'tools' | 'end' | 'refusal' | 'limit'
  usage: { input: number; output: number }
}

export type ToolOutcome = { id: string; text: string; images?: string[]; error?: boolean }

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> }

/** A chat with one provider that keeps its own wire-format history. */
export interface Conversation {
  send(text: string, signal: AbortSignal): Promise<Step>
  results(outcomes: ToolOutcome[], signal: AbortSignal): Promise<Step>
}

export type ProviderConfig = {
  provider: ProviderId
  model: string
  baseUrl: string
  apiKey: string | null
}

export class ProviderError extends Error {}

const MAX_TOKENS = 16000

/** Claude models that take the server-side refusal fallback. */
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/

// ---------------------------------------------------------------- Anthropic

class AnthropicConversation implements Conversation {
  private readonly client: Anthropic
  private readonly messages: Anthropic.Beta.BetaMessageParam[] = []
  private readonly tools: Anthropic.Beta.BetaTool[]

  constructor(
    private readonly cfg: ProviderConfig,
    private readonly system: string,
    tools: ToolSpec[],
  ) {
    this.client = new Anthropic({
      apiKey: cfg.apiKey ?? '',
      ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
    })
    this.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
    }))
  }

  private async call(signal: AbortSignal): Promise<Step> {
    const fallback = FALLBACK_MODELS.test(this.cfg.model)
    let response: Anthropic.Beta.BetaMessage
    try {
      response = await this.client.beta.messages.create(
        {
          model: this.cfg.model,
          max_tokens: MAX_TOKENS,
          system: this.system,
          tools: this.tools,
          messages: this.messages,
          ...(fallback
            ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
            : {}),
        },
        { signal },
      )
    } catch (error) {
      throw anthropicError(error)
    }
    // The whole content goes back, thinking and fallback blocks included.
    this.messages.push({ role: 'assistant', content: response.content })
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    const toolCalls = response.content
      .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, args: b.input }))
    const usage = { input: response.usage.input_tokens, output: response.usage.output_tokens }
    if (response.stop_reason === 'refusal') return { text, toolCalls: [], stop: 'refusal', usage }
    if (response.stop_reason === 'max_tokens') return { text, toolCalls: [], stop: 'limit', usage }
    return { text, toolCalls, stop: toolCalls.length ? 'tools' : 'end', usage }
  }

  send(text: string, signal: AbortSignal) {
    this.messages.push({ role: 'user', content: text })
    return this.call(signal)
  }

  results(outcomes: ToolOutcome[], signal: AbortSignal) {
    // Every result of a turn goes back in one message.
    this.messages.push({
      role: 'user',
      content: outcomes.map((o) => ({
        type: 'tool_result' as const,
        tool_use_id: o.id,
        is_error: o.error ?? false,
        content: [
          { type: 'text' as const, text: o.text || '(no output)' },
          ...(o.images ?? []).map((data) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data },
          })),
        ],
      })),
    })
    return this.call(signal)
  }
}

function anthropicError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError)
    return new ProviderError('Anthropic rejected the API key. Check it in Settings, under AI.')
  if (error instanceof Anthropic.PermissionDeniedError)
    return new ProviderError("This API key can't use that model. Pick another model in Settings.")
  if (error instanceof Anthropic.NotFoundError)
    return new ProviderError(
      "Anthropic doesn't know that model. Pick one from the list in Settings.",
    )
  if (error instanceof Anthropic.RateLimitError)
    return new ProviderError(
      'Anthropic is limiting requests right now. Wait a minute and try again.',
    )
  if (error instanceof Anthropic.APIConnectionError)
    return new ProviderError("Couldn't reach Anthropic. Check the internet connection.")
  if (error instanceof Anthropic.APIError)
    return new ProviderError(
      `Anthropic returned an error (${error.status ?? 'no status'}): ${error.message}`,
    )
  return error instanceof Error ? error : new Error(String(error))
}

// ---------------------------------------------------------------- OpenAI-style

type ChatMessage =
  | { role: 'system' | 'user'; content: string | unknown[] }
  | { role: 'assistant'; content: string | null; tool_calls?: unknown[] }
  | { role: 'tool'; tool_call_id: string; content: string }

class ChatConversation implements Conversation {
  private readonly messages: ChatMessage[]
  private readonly tools: unknown[]
  private readonly base: string

  constructor(
    private readonly cfg: ProviderConfig,
    system: string,
    tools: ToolSpec[],
  ) {
    this.messages = [{ role: 'system', content: system }]
    this.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
    this.base = (cfg.baseUrl || PROVIDERS[cfg.provider].baseUrl).replace(/\/+$/, '')
  }

  private async call(signal: AbortSignal): Promise<Step> {
    let res: Response
    try {
      res = await fetch(`${this.base}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.cfg.model,
          messages: this.messages,
          tools: this.tools,
          tool_choice: 'auto',
          max_tokens: MAX_TOKENS,
        }),
      })
    } catch (error) {
      if (signal.aborted) throw error
      throw new ProviderError(
        `Couldn't reach ${this.base}. Check that the server is running and the address is right.`,
      )
    }
    if (!res.ok) throw new ProviderError(await httpMessage(res))
    const body = (await res.json()) as {
      choices?: {
        message?: {
          content?: string | null
          tool_calls?: { id: string; function: { name: string; arguments: string } }[]
        }
        finish_reason?: string
      }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const choice = body.choices?.[0]
    const message = choice?.message ?? {}
    this.messages.push({
      role: 'assistant',
      content: message.content ?? null,
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    })
    const toolCalls = (message.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.function.name,
      args: parseArgs(c.function.arguments),
    }))
    const usage = {
      input: body.usage?.prompt_tokens ?? 0,
      output: body.usage?.completion_tokens ?? 0,
    }
    const text = (message.content ?? '').trim()
    if (choice?.finish_reason === 'length') return { text, toolCalls: [], stop: 'limit', usage }
    return { text, toolCalls, stop: toolCalls.length ? 'tools' : 'end', usage }
  }

  send(text: string, signal: AbortSignal) {
    this.messages.push({ role: 'user', content: text })
    return this.call(signal)
  }

  results(outcomes: ToolOutcome[], signal: AbortSignal) {
    for (const o of outcomes)
      this.messages.push({
        role: 'tool',
        tool_call_id: o.id,
        content: o.error ? `Error: ${o.text}` : o.text || '(no output)',
      })
    // Chat-style APIs take pictures only in user messages.
    const images = outcomes.flatMap((o) => o.images ?? [])
    if (images.length)
      this.messages.push({
        role: 'user',
        content: [
          { type: 'text', text: 'The frames requested with sample_frames:' },
          ...images.map((data) => ({
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${data}` },
          })),
        ],
      })
    return this.call(signal)
  }
}

/** Tool arguments arrive as a JSON string; a bad one is passed on so the tool reports it. */
function parseArgs(text: string): unknown {
  try {
    return JSON.parse(text || '{}')
  } catch {
    return { __unparsed: text }
  }
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } | string }
    return typeof j.error === 'string' ? j.error : (j.error?.message ?? '')
  } catch {
    return ''
  }
}

async function httpMessage(res: Response): Promise<string> {
  const detail = await errorDetail(res)
  if (res.status === 401 || res.status === 403)
    return 'The provider rejected the API key. Check it in Settings, under AI.'
  if (res.status === 404) return `The provider doesn't know that model or address. ${detail}`.trim()
  if (res.status === 429)
    return 'The provider is limiting requests right now. Wait a minute and try again.'
  return `The provider returned an error (${res.status}). ${detail}`.trim()
}

// ---------------------------------------------------------------- entry points

export function createConversation(
  cfg: ProviderConfig,
  system: string,
  tools: ToolSpec[],
): Conversation {
  if (!cfg.model) throw new ProviderError('Choose a model in Settings, under AI.')
  if (PROVIDERS[cfg.provider].key && !cfg.apiKey)
    throw new ProviderError('Add an API key for this provider in Settings, under AI.')
  return PROVIDERS[cfg.provider].format === 'anthropic'
    ? new AnthropicConversation(cfg, system, tools)
    : new ChatConversation(cfg, system, tools)
}

/** Model ids the provider offers; doubles as a connection test. */
export async function listModels(cfg: ProviderConfig): Promise<string[]> {
  if (PROVIDERS[cfg.provider].format === 'anthropic') {
    const client = new Anthropic({
      apiKey: cfg.apiKey ?? '',
      ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
    })
    try {
      const ids: string[] = []
      for await (const m of client.models.list()) ids.push(m.id)
      return ids
    } catch (error) {
      throw anthropicError(error)
    }
  }
  const base = (cfg.baseUrl || PROVIDERS[cfg.provider].baseUrl).replace(/\/+$/, '')
  if (!base) throw new ProviderError('Enter the address of the server.')
  let res: Response
  try {
    res = await fetch(`${base}/models`, {
      headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new ProviderError(
      `Couldn't reach ${base}. Check that the server is running and the address is right.`,
    )
  }
  if (!res.ok) throw new ProviderError(await httpMessage(res))
  const body = (await res.json()) as { data?: { id: string }[] }
  return (body.data ?? []).map((m) => m.id).sort()
}
