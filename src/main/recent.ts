import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { RecentProject } from '@shared/recent'

const MAX = 12

const fileSchema = z.array(
  z.object({ path: z.string().max(4096), name: z.string().max(500), openedAt: z.number() }),
)
type Entry = z.infer<typeof fileSchema>[number]

/** Projects opened or saved lately, newest first, kept in recent.json. */
export class RecentProjects {
  private entries: Entry[] = []
  private readonly file: string
  private writing: Promise<void> = Promise.resolve()

  constructor(dir: string) {
    this.file = join(dir, 'recent.json')
  }

  async load() {
    try {
      const parsed = fileSchema.safeParse(JSON.parse(await readFile(this.file, 'utf8')))
      this.entries = parsed.success ? parsed.data.slice(0, MAX) : []
    } catch {
      this.entries = []
    }
  }

  async add(path: string, name: string) {
    this.entries = [
      { path, name, openedAt: Date.now() },
      ...this.entries.filter((e) => e.path !== path),
    ].slice(0, MAX)
    await this.save()
  }

  async remove(path: string) {
    this.entries = this.entries.filter((e) => e.path !== path)
    await this.save()
  }

  async clear() {
    this.entries = []
    await this.save()
  }

  /** The list with whether each file is still there and when it last changed. */
  async list(): Promise<RecentProject[]> {
    return Promise.all(
      this.entries.map(async (e) => {
        const info = await stat(e.path).catch(() => null)
        return { ...e, exists: Boolean(info?.isFile()), modifiedAt: info?.mtimeMs ?? null }
      }),
    )
  }

  has(path: string) {
    return this.entries.some((e) => e.path === path)
  }

  private async save() {
    const snapshot = JSON.stringify(this.entries, null, 2)
    const write = this.writing.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`
      await writeFile(tmp, snapshot)
      await rename(tmp, this.file)
    })
    this.writing = write.catch(() => undefined)
    await write
  }
}
