import catalog from './models.json'

/**
 * Local AI models Lumacut can download. Each file is pinned to a commit and
 * checked against its SHA-256 before it is used; nothing is bundled.
 */
export type ModelTask = 'transcribe' | 'matte' | 'denoise'
export type ModelFile = { path: string; url: string; sha256: string; size: number }
export type ModelInfo = {
  id: string
  task: ModelTask
  /** Folder (under the models folder) the runtime loads the model from. */
  repo: string
  license: string
  source: string
  files: ModelFile[]
}

export const MODELS = catalog.models as ModelInfo[]

export function modelById(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id)
}

export const modelSize = (m: ModelInfo) => m.files.reduce((a, f) => a + f.size, 0)
