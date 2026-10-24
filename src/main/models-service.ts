import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { MODELS, modelById, modelSize, type ModelInfo } from '@shared/models'
import { APP_NAME } from '@shared/constants'

/** Where models live; the same folder `pnpm fetch:models` fills. */
export function modelsDir(): string {
  if (process.env['LUMACUT_MODELS']) return process.env['LUMACUT_MODELS']
  if (process.platform === 'win32')
    return join(process.env['APPDATA'] ?? homedir(), APP_NAME, 'models')
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', APP_NAME, 'models')
  return join(
    process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'),
    APP_NAME,
    'models',
  )
}

/** Files are renamed into place only after their checksum matches, so present means verified. */
export function modelReady(model: ModelInfo): boolean {
  return model.files.every((f) => {
    const p = join(modelsDir(), f.path)
    return existsSync(p) && statSync(p).size === f.size
  })
}

/** The model, if all its files are downloaded; otherwise an error that says where to get it. */
export function requireModel(id: string): ModelInfo {
  const model = modelById(id)
  if (!model) throw new Error(`Unknown model ${id}.`)
  if (!modelReady(model))
    throw new Error('This model is not downloaded yet. Download it in Settings, under AI models.')
  return model
}

export type ModelStatus = { id: string; ready: boolean; bytes: number; downloading: boolean }

const downloads = new Map<string, AbortController>()

export function modelStatus(): ModelStatus[] {
  return MODELS.map((m) => ({
    id: m.id,
    ready: modelReady(m),
    bytes: modelSize(m),
    downloading: downloads.has(m.id),
  }))
}

/** Downloads every missing file of a model, checking each SHA-256 before keeping it. */
export async function downloadModel(id: string, onProgress: (fraction: number) => void) {
  const model = modelById(id)
  if (!model) throw new Error(`Unknown model ${id}.`)
  if (downloads.has(id)) return
  const abort = new AbortController()
  downloads.set(id, abort)
  const total = modelSize(model)
  let done = 0
  try {
    for (const file of model.files) {
      const dest = join(modelsDir(), file.path)
      if (existsSync(dest) && statSync(dest).size === file.size) {
        done += file.size
        continue
      }
      await mkdir(dirname(dest), { recursive: true })
      const res = await fetch(file.url, { redirect: 'follow', signal: abort.signal })
      if (!res.ok || !res.body)
        throw new Error(`The download stopped with HTTP ${res.status}. Try again later.`)
      const hash = createHash('sha256')
      let last = 0
      const count = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hash.update(chunk)
          done += chunk.length
          const now = Date.now()
          if (now - last > 150) {
            last = now
            onProgress(Math.min(1, done / total))
          }
          cb(null, chunk)
        },
      })
      const part = `${dest}.part`
      await pipeline(Readable.fromWeb(res.body), count, createWriteStream(part), {
        signal: abort.signal,
      })
      if (hash.digest('hex') !== file.sha256) {
        await rm(part, { force: true })
        throw new Error(
          `${file.path} didn't match its checksum, so it was deleted. Try the download again.`,
        )
      }
      await rename(part, dest)
    }
    onProgress(1)
  } finally {
    downloads.delete(id)
  }
}

export function cancelModelDownload(id: string): boolean {
  const abort = downloads.get(id)
  if (!abort) return false
  abort.abort()
  return true
}

export async function deleteModel(id: string) {
  const model = modelById(id)
  if (!model) return
  cancelModelDownload(id)
  for (const f of model.files) {
    const p = join(modelsDir(), f.path)
    await rm(p, { force: true })
    await rm(`${p}.part`, { force: true })
  }
}
