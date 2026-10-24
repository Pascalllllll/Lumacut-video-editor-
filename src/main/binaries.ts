import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'

const run = promisify(execFile)

export function platformKey(): string {
  return `${process.platform}-${process.arch}`
}

/** Bundled tools live in resources/bin/<os>-<arch> in dev and in <resources>/bin when packaged. */
export function binaryPath(name: 'ffmpeg' | 'ffprobe'): string | null {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  const dir = app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(app.getAppPath(), 'resources', 'bin', platformKey())
  const full = join(dir, exe)
  return existsSync(full) ? full : null
}

export async function ffmpegVersion(): Promise<{ found: boolean; version: string | null }> {
  const bin = binaryPath('ffmpeg')
  if (!bin) return { found: false, version: null }
  try {
    const { stdout } = await run(bin, ['-hide_banner', '-version'], { timeout: 5000 })
    const match = /^ffmpeg version (\S+)/m.exec(stdout)
    return { found: true, version: match?.[1] ?? null }
  } catch {
    return { found: false, version: null }
  }
}
