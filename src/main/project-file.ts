import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Project } from '@engine/model'
import { migrateProject, ProjectFormatError } from '@engine/migrations'
import { APP_NAME } from '@shared/constants'

/** A .lumacut file is a zip holding project.json and meta.json. */
export async function saveProjectFile(path: string, project: Project, appVersion: string) {
  const meta = {
    app: APP_NAME,
    appVersion,
    schemaVersion: project.schemaVersion,
    savedAt: new Date().toISOString(),
  }
  const zipped = zipSync(
    {
      'project.json': strToU8(JSON.stringify(project)),
      'meta.json': strToU8(JSON.stringify(meta, null, 2)),
    },
    { level: 6 },
  )
  // Write next to the target and swap, so a crash mid-save never leaves half a file.
  const tmp = `${path}.saving`
  await writeFile(tmp, zipped)
  await rename(tmp, path)
}

/** Far above any real project; a file claiming more is damaged or built to exhaust memory. */
const MAX_FILE = 256 * 1024 * 1024
const MAX_JSON = 512 * 1024 * 1024

export async function loadProjectFile(path: string): Promise<Project> {
  if ((await stat(path)).size > MAX_FILE)
    throw new ProjectFormatError(`${path} is too large to be a Lumacut project.`)
  let files: Record<string, Uint8Array>
  try {
    // Only the project data is unpacked, and only if its stated size is sane.
    files = unzipSync(new Uint8Array(await readFile(path)), {
      filter: (f) => f.name === 'project.json' && f.originalSize <= MAX_JSON,
    })
  } catch {
    throw new ProjectFormatError(`${path} isn't a Lumacut project, or it is damaged.`)
  }
  const json = files['project.json']
  if (!json) throw new ProjectFormatError('The project file has no project data inside.')
  return migrateProject(JSON.parse(strFromU8(json)))
}
