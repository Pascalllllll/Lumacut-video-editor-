import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { ProviderId } from '@shared/providers'

/**
 * API keys, encrypted with the system keyring through safeStorage and kept in
 * the app data folder. They never go into project files, settings or logs, and
 * never reach the renderer: it only learns whether a key is set.
 */
const file = () => join(app.getPath('userData'), 'keys.json')

async function load(): Promise<Partial<Record<ProviderId, string>>> {
  if (!existsSync(file())) return {}
  try {
    return JSON.parse(await readFile(file(), 'utf8')) as Partial<Record<ProviderId, string>>
  } catch {
    return {}
  }
}

async function save(keys: Partial<Record<ProviderId, string>>) {
  const tmp = `${file()}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(keys), { mode: 0o600 })
  await rename(tmp, file())
}

/** True when keys are protected by a real keyring rather than an obfuscated file. */
export function keyringAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
}

export async function setKey(provider: ProviderId, key: string | null) {
  const keys = await load()
  if (!key) delete keys[provider]
  else {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("This system can't encrypt the key, so it wasn't saved.")
    keys[provider] = safeStorage.encryptString(key).toString('base64')
  }
  await save(keys)
}

export async function getKey(provider: ProviderId): Promise<string | null> {
  const stored = (await load())[provider]
  if (!stored) return null
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return null
  }
}

export async function keysSet(): Promise<ProviderId[]> {
  return Object.keys(await load()) as ProviderId[]
}
