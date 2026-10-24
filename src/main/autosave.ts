import { existsSync, rmSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { Project } from '@engine/model'
import { saveProjectFile } from './project-file'

/** How many autosaved versions to keep per project. */
const KEEP = 10

export function autosaveDir() {
  return join(app.getPath('userData'), 'autosave')
}

const lockFile = () => join(app.getPath('userData'), 'running.lock')

/** True if the previous run ended without a clean quit. Call once at startup. */
export async function previousRunCrashed(): Promise<boolean> {
  const crashed = existsSync(lockFile())
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(lockFile(), String(process.pid))
  return crashed
}

/** Synchronous: it runs while the app is quitting, when async work may never finish. */
export function markCleanExit() {
  rmSync(lockFile(), { force: true })
}

export type AutosaveEntry = {
  file: string
  projectId: string
  name: string
  savedAt: string
  sourcePath: string | null
}

const FILE_RE = /^(prj_[0-9a-f]{16})-(\d+)\.lumacut$/

export async function writeAutosave(project: Project, sourcePath: string | null) {
  const dir = autosaveDir()
  await mkdir(dir, { recursive: true })
  const file = `${project.id}-${Date.now()}.lumacut`
  await saveProjectFile(join(dir, file), project, app.getVersion())
  await writeFile(join(dir, `${file}.json`), JSON.stringify({ name: project.name, sourcePath }))
  const versions = (await listAutosaves()).filter((e) => e.projectId === project.id)
  for (const old of versions.slice(KEEP)) await removeAutosave(old.file)
}

export async function listAutosaves(): Promise<AutosaveEntry[]> {
  const dir = autosaveDir()
  if (!existsSync(dir)) return []
  const entries: AutosaveEntry[] = []
  for (const file of await readdir(dir)) {
    const m = FILE_RE.exec(file)
    if (!m) continue
    let meta = { name: '', sourcePath: null as string | null }
    try {
      meta = {
        ...meta,
        ...(JSON.parse(await readFile(join(dir, `${file}.json`), 'utf8')) as object),
      }
    } catch {
      // A version without its note still opens; it just shows no name.
    }
    entries.push({
      file,
      projectId: m[1]!,
      name: meta.name,
      savedAt: new Date(Number(m[2])).toISOString(),
      sourcePath: meta.sourcePath,
    })
  }
  return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export function autosavePath(file: string): string {
  if (!FILE_RE.test(file)) throw new Error('Not an autosave file')
  return join(autosaveDir(), file)
}

export async function removeAutosave(file: string) {
  const path = autosavePath(file)
  await rm(path, { force: true })
  await rm(`${path}.json`, { force: true })
}

export async function clearAutosaves(projectId: string) {
  for (const e of await listAutosaves()) if (e.projectId === projectId) await removeAutosave(e.file)
}

/** Whether an autosave is newer than the project file it came from. */
export async function isNewerThanSource(entry: AutosaveEntry): Promise<boolean> {
  if (!entry.sourcePath) return true
  try {
    return (await stat(entry.sourcePath)).mtimeMs < Date.parse(entry.savedAt)
  } catch {
    return true
  }
}
