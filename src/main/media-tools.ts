import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

/** Which of these files no longer exist. */
export function missingFiles(paths: string[]): string[] {
  return paths.filter((p) => p && !existsSync(p))
}

/**
 * Looks for files by name under a folder (four levels deep, up to 20,000
 * entries), for relinking media that moved together.
 */
export async function findByName(folder: string, names: string[]): Promise<Record<string, string>> {
  const wanted = new Set(names)
  const found: Record<string, string> = {}
  let seen = 0
  const walk = async (dir: string, depth: number) => {
    if (depth > 4 || seen > 20_000 || Object.keys(found).length === wanted.size) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      seen++
      const full = join(dir, e.name)
      if (e.isFile() && wanted.has(e.name) && !found[e.name]) found[e.name] = full
      else if (e.isDirectory() && !e.name.startsWith('.')) await walk(full, depth + 1)
    }
  }
  await walk(folder, 0)
  return found
}

/**
 * Copies media files into `folder`, keeping names unique, and returns where
 * each one went. Files already in the folder stay where they are.
 */
export async function collectFiles(
  files: { id: string; path: string }[],
  folder: string,
  onProgress: (done: number, total: number) => void,
): Promise<Record<string, { path: string; size: number }>> {
  await mkdir(folder, { recursive: true })
  const out: Record<string, { path: string; size: number }> = {}
  const used = new Set<string>()
  let done = 0
  for (const f of files) {
    if (!existsSync(f.path)) continue
    if (f.path.startsWith(folder)) {
      out[f.id] = { path: f.path, size: (await stat(f.path)).size }
      continue
    }
    const ext = extname(f.path)
    const stem = basename(f.path, ext)
    let name = `${stem}${ext}`
    for (let n = 2; used.has(name) || existsSync(join(folder, name)); n++)
      name = `${stem} ${n}${ext}`
    used.add(name)
    const target = join(folder, name)
    await copyFile(f.path, target)
    out[f.id] = { path: target, size: (await stat(target)).size }
    onProgress(++done, files.length)
  }
  return out
}
