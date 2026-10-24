import { z } from 'zod'
import { defaultExportOptions, exportOptionsSchema } from './export'
import { PROVIDER_IDS } from './providers'
import { updateModeSchema } from './updates'

export const themeSchema = z.enum(['auto', 'light', 'dark'])
export type Theme = z.infer<typeof themeSchema>

export const ACCENTS = ['amber', 'blue', 'green', 'red', 'violet', 'graphite'] as const
export const accentSchema = z.enum(ACCENTS)
export type Accent = z.infer<typeof accentSchema>

export const workspaceSchema = z.enum(['edit', 'color', 'audio', 'captions', 'export'])
export type Workspace = z.infer<typeof workspaceSchema>
export const WORKSPACES = workspaceSchema.options

export const KEYMAP_PRESETS = ['lumacut', 'premiere', 'finalcut', 'resolve'] as const
export type KeymapPreset = (typeof KEYMAP_PRESETS)[number]

export const settingsSchema = z.object({
  theme: themeSchema.default('auto'),
  accent: accentSchema.default('amber'),
  uiScale: z.number().min(0.9).max(1.5).default(1),
  workspace: workspaceSchema.default('edit'),
  /** Which imports get a proxy automatically. */
  autoProxy: z.enum(['off', 'unplayable', 'large']).default('unplayable'),
  /** Play proxies in the viewer when they exist. Export always uses the original files. */
  useProxies: z.boolean().default(true),
  /** Viewer resolution; export is always full size. */
  previewQuality: z.enum(['auto', 'full', 'half', 'quarter']).default('auto'),
  snapping: z.boolean().default(true),
  linkedSelection: z.boolean().default(true),
  /** Seconds between autosaves while a project has unsaved changes. */
  autosaveSeconds: z.number().int().min(15).max(3600).default(60),
  ai: z
    .object({
      provider: z.enum(PROVIDER_IDS).nullable().default(null),
      model: z.string().max(200).default(''),
      /** Overrides the provider's address (custom endpoints, other ports). */
      baseUrl: z.string().max(500).default(''),
      /** Blocks every request that would leave this computer. */
      localOnly: z.boolean().default(false),
      /** Copilot changes wait for review, or apply straight away. */
      applyMode: z.enum(['ask', 'auto']).default('ask'),
      /** The local MCP server for other AI tools. */
      mcp: z.boolean().default(false),
    })
    .default({
      provider: null,
      model: '',
      baseUrl: '',
      localOnly: false,
      applyMode: 'ask',
      mcp: false,
    }),
  keymap: z
    .object({
      preset: z.enum(KEYMAP_PRESETS).default('lumacut'),
      /** Actions whose keys the user changed, by action id. */
      custom: z.record(z.string(), z.array(z.string().max(40)).max(4)).default({}),
    })
    .default({ preset: 'lumacut', custom: {} }),
  /** Panel sizes per workspace, as percentages of the window. */
  layouts: z.record(z.string(), z.record(z.string(), z.number().min(5).max(85))).default({}),
  /** Shown once, on the first start. */
  onboarded: z.boolean().default(false),
  /** The start screen with recent projects, shown on launch when there are any. */
  startScreen: z.boolean().default(true),
  /** The guided tour was finished or skipped. */
  tourDone: z.boolean().default(false),
  /** Install new versions by themselves, only say they exist, or never look. */
  updates: updateModeSchema.default('notify'),
  /** The version whose notes were last shown, for the What's new sheet. */
  lastSeenVersion: z.string().max(50).default(''),
  /** The last export settings, used by the Export button. */
  export: exportOptionsSchema.default(defaultExportOptions),
})
export type Settings = z.infer<typeof settingsSchema>

export const defaultSettings: Settings = settingsSchema.parse({})

/**
 * A change to some settings. Field defaults are stripped: with them, every
 * missing field would arrive filled in and overwrite what the user had.
 */
export const settingsPatchSchema = z.object(
  Object.fromEntries(
    Object.entries(settingsSchema.shape).map(([key, field]) => [
      key,
      (field instanceof z.ZodDefault ? field.unwrap() : field).optional(),
    ]),
  ),
) as unknown as z.ZodType<Partial<Settings>>
