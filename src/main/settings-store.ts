import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { defaultSettings, settingsSchema, type Settings } from '@shared/settings'

export class SettingsStore {
  private current: Settings = defaultSettings
  private readonly file: string

  constructor(dir: string) {
    this.file = join(dir, 'settings.json')
  }

  async load(): Promise<Settings> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      const parsed = settingsSchema.safeParse(raw)
      // A damaged or outdated file falls back to defaults instead of blocking startup.
      this.current = parsed.success ? parsed.data : defaultSettings
    } catch {
      this.current = defaultSettings
    }
    return this.current
  }

  get(): Settings {
    return this.current
  }

  private writing: Promise<void> = Promise.resolve()

  async update(patch: Partial<Settings>): Promise<Settings> {
    this.current = settingsSchema.parse({ ...this.current, ...patch })
    const snapshot = JSON.stringify(this.current, null, 2)
    // Saves run one after another; two at once would race on the temporary file.
    const write = this.writing.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`
      await writeFile(tmp, snapshot)
      await rename(tmp, this.file)
    })
    this.writing = write.catch(() => undefined)
    await write
    return this.current
  }
}
