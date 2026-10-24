#!/usr/bin/env node
// Pre-downloads the local AI models listed in src/shared/models.json into the
// same folder the app uses, verifying each file's SHA-256.
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function modelsDir() {
  if (process.platform === 'win32')
    return join(process.env.APPDATA ?? homedir(), 'Lumacut', 'models')
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'Lumacut', 'models')
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'Lumacut', 'models')
}

const { models } = JSON.parse(await readFile(join(root, 'src', 'shared', 'models.json'), 'utf8'))
const only = process.argv.slice(2)
if (models.length === 0) {
  console.log('This version of Lumacut uses no local models, so there is nothing to download.')
  process.exit(0)
}

const dir = process.env.LUMACUT_MODELS ?? modelsDir()
await mkdir(dir, { recursive: true })
for (const model of models) {
  if (only.length && !only.includes(model.id)) continue
  for (const file of model.files) {
    const dest = join(dir, file.path)
    if (existsSync(dest)) continue
    await mkdir(dirname(dest), { recursive: true })
    console.log(`${model.id}: downloading ${file.path}`)
    const res = await fetch(file.url, { redirect: 'follow' })
    if (!res.ok || !res.body)
      throw new Error(`Download failed with HTTP ${res.status}: ${file.url}`)
    const hash = createHash('sha256')
    const body = Readable.fromWeb(res.body)
    body.on('data', (chunk) => hash.update(chunk))
    const part = `${dest}.part`
    await pipeline(body, createWriteStream(part))
    const actual = hash.digest('hex')
    if (actual !== file.sha256) {
      await rm(part, { force: true })
      throw new Error(
        `${file.path}: checksum mismatch, file deleted (expected ${file.sha256}, got ${actual})`,
      )
    }
    await rename(part, dest)
  }
  console.log(`${model.id}: ready`)
}
