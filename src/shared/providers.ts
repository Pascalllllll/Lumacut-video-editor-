/**
 * AI providers for the copilot. Two wire formats cover them all: the
 * Anthropic Messages API, and OpenAI-style chat completions, which the others
 * (and local servers like Ollama and LM Studio) speak.
 */
export const PROVIDER_IDS = [
  'anthropic',
  'openai',
  'gemini',
  'openrouter',
  'mistral',
  'ollama',
  'lmstudio',
  'custom',
] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

export type ProviderInfo = {
  id: ProviderId
  format: 'anthropic' | 'openai'
  baseUrl: string
  /** Needs an API key. */
  key: boolean
  /** Runs on this computer, so allowed in local-only mode. */
  local: boolean
  defaultModel: string
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    format: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    key: true,
    local: false,
    defaultModel: 'claude-opus-5-5',
  },
  openai: {
    id: 'openai',
    format: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    key: true,
    local: false,
    defaultModel: '',
  },
  gemini: {
    id: 'gemini',
    format: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    key: true,
    local: false,
    defaultModel: '',
  },
  openrouter: {
    id: 'openrouter',
    format: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    key: true,
    local: false,
    defaultModel: '',
  },
  mistral: {
    id: 'mistral',
    format: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    key: true,
    local: false,
    defaultModel: '',
  },
  ollama: {
    id: 'ollama',
    format: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    key: false,
    local: true,
    defaultModel: '',
  },
  lmstudio: {
    id: 'lmstudio',
    format: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    key: false,
    local: true,
    defaultModel: '',
  },
  custom: {
    id: 'custom',
    format: 'openai',
    baseUrl: '',
    key: false,
    local: false,
    defaultModel: '',
  },
}

/** A URL on this computer. */
export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  } catch {
    return false
  }
}

/** Whether requests to this provider stay on this computer. */
export function staysLocal(id: ProviderId, baseUrl: string): boolean {
  const p = PROVIDERS[id]
  return isLocalUrl(baseUrl || p.baseUrl)
}
