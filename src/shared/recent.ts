import { z } from 'zod'

export const recentProjectSchema = z.object({
  path: z.string(),
  name: z.string(),
  openedAt: z.number(),
  exists: z.boolean(),
  modifiedAt: z.number().nullable(),
})
export type RecentProject = z.infer<typeof recentProjectSchema>

/** A project file given on the command line or by the system, such as a double-click. */
export function projectFromArgs(argv: string[], extension: string): string | null {
  const suffix = `.${extension}`.toLowerCase()
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue
    if (arg.toLowerCase().endsWith(suffix)) return arg
  }
  return null
}
