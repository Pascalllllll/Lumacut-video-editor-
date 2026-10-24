import { z } from 'zod'

export const REPOSITORY = { owner: 'Pascalllllll', repo: 'Lumacut-video-editor-' } as const
export const RELEASES_URL = `https://github.com/${REPOSITORY.owner}/${REPOSITORY.repo}/releases`

export const updateModeSchema = z.enum(['auto', 'notify', 'off'])
export type UpdateMode = z.infer<typeof updateModeSchema>

/**
 * How this copy was installed. Only these can replace themselves; system
 * packages (deb, rpm), Flatpak and plain folders are updated by whatever
 * installed them, so for those Lumacut only says a new version exists. macOS
 * can only replace a signed app, and the builds aren't signed yet.
 */
export type InstallKind = 'appimage' | 'nsis' | 'other'

export function installKind(
  platform: string,
  env: Record<string, string | undefined>,
): InstallKind {
  if (platform === 'linux') return env['APPIMAGE'] ? 'appimage' : 'other'
  if (platform === 'win32') return env['PORTABLE_EXECUTABLE_DIR'] ? 'other' : 'nsis'
  return 'other'
}

export const updateStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('idle') }),
  /** Development builds and tests never look for updates. */
  z.object({ state: z.literal('disabled') }),
  z.object({ state: z.literal('checking') }),
  z.object({ state: z.literal('current'), version: z.string() }),
  z.object({
    state: z.literal('available'),
    version: z.string(),
    /** False when the system's own package manager has to install it. */
    canInstall: z.boolean(),
    url: z.string(),
  }),
  z.object({ state: z.literal('downloading'), version: z.string(), fraction: z.number() }),
  z.object({ state: z.literal('ready'), version: z.string() }),
  z.object({ state: z.literal('failed'), message: z.string() }),
])
export type UpdateStatus = z.infer<typeof updateStatusSchema>

const parse = (v: string) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim())
  return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null
}

/** Negative when a is older than b, positive when newer, 0 when equal or unreadable. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i]! - y.core[i]!
  if (x.pre === y.pre) return 0
  if (x.pre === null) return 1
  if (y.pre === null) return -1
  return x.pre < y.pre ? -1 : 1
}

export const releaseNotesSchema = z.object({
  version: z.string(),
  date: z.string().nullable(),
  sections: z.array(z.object({ heading: z.string(), items: z.array(z.string()) })),
})
export type ReleaseNotes = z.infer<typeof releaseNotesSchema>

/** The section of a Keep a Changelog file for one version, or null if it has none. */
export function releaseNotes(changelog: string, version: string): ReleaseNotes | null {
  if (!parse(version)) return null
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((l) => {
    const m = /^## \[([^\]]+)\]/.exec(l)
    return m !== null && parse(m[1]!) !== null && compareVersions(m[1]!, version) === 0
  })
  if (start === -1) return null
  const date = /\]\s*-\s*(\d{4}-\d{2}-\d{2})/.exec(lines[start]!)?.[1] ?? null
  const sections: ReleaseNotes['sections'] = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break
    const heading = /^### (.+)/.exec(line)
    if (heading) sections.push({ heading: heading[1]!.trim(), items: [] })
    else if (line.startsWith('- ')) {
      if (!sections.length) sections.push({ heading: 'Changes', items: [] })
      sections.at(-1)!.items.push(line.slice(2).trim())
    }
  }
  return { version, date, sections: sections.filter((s) => s.items.length) }
}
