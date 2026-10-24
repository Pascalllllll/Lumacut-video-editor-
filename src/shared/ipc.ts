import { z } from 'zod'
import { commandSchema } from '@engine/commands'
import { effectSchema, mediaAssetSchema, projectSchema } from '@engine/model'
import { defaultExportOptions, exportOptionsSchema } from './export'
import { PROVIDER_IDS } from './providers'
import { settingsPatchSchema, settingsSchema } from './settings'
import { releaseNotesSchema, updateStatusSchema } from './updates'
import { recentProjectSchema } from './recent'
import { accountSchema } from './account'

/**
 * Every renderer-to-main call is declared here once. The preload and the main
 * process both validate against these schemas, so a malformed message fails on
 * whichever side produced it.
 */
export const ipcContract = {
  'app:info': {
    request: z.void(),
    response: z.object({
      version: z.string(),
      platform: z.enum(['linux', 'win32', 'darwin', 'other']),
      arch: z.string(),
      electron: z.string(),
      chrome: z.string(),
      ffmpeg: z.object({ found: z.boolean(), version: z.string().nullable() }),
    }),
  },
  'settings:get': { request: z.void(), response: settingsSchema },
  'settings:set': { request: settingsPatchSchema, response: settingsSchema },

  'window:minimize': { request: z.void(), response: z.void() },
  'window:toggle-maximize': { request: z.void(), response: z.boolean() },
  'window:close': { request: z.void(), response: z.void() },
  'window:is-maximized': { request: z.void(), response: z.boolean() },

  /** Opens a file dialog when no paths are given. */
  'media:import': {
    request: z.object({ paths: z.array(z.string()).max(1000).optional() }),
    response: z.object({
      assets: z.array(mediaAssetSchema),
      errors: z.array(z.string()),
      cancelled: z.boolean(),
    }),
  },
  'media:thumbnail': {
    request: mediaAssetSchema.pick({ path: true, kind: true, duration: true }),
    response: z.object({ name: z.string().nullable() }),
  },
  /** Which of these media files can't be found. */
  'media:missing': {
    request: z.object({ paths: z.array(z.string()).max(10000) }),
    response: z.array(z.string()),
  },
  /** Asks for the new place of one missing file; null if cancelled. */
  'media:relink': {
    request: z.object({ name: z.string(), kind: mediaAssetSchema.shape.kind }),
    response: z.object({ path: z.string(), size: z.number() }).nullable(),
  },
  /** Asks for a folder and finds missing files in it by name. */
  'media:locate': {
    request: z.object({ names: z.array(z.string()).max(10000) }),
    response: z.record(z.string(), z.object({ path: z.string(), size: z.number() })).nullable(),
  },
  /** Asks for a folder and copies the media there; returns the new place of each item. */
  'media:collect': {
    request: z.object({
      files: z.array(z.object({ id: z.string(), path: z.string() })).max(10000),
      suggested: z.string(),
    }),
    response: z.record(z.string(), z.object({ path: z.string(), size: z.number() })).nullable(),
  },
  'media:waveform': {
    request: z.object({ path: z.string() }),
    response: z.object({ rate: z.number(), peaks: z.string() }),
  },

  /** Opens a file dialog when no path is given. Resolves null if the dialog is cancelled. */
  'project:open': {
    request: z.object({ path: z.string().optional() }),
    response: z.object({ project: projectSchema, path: z.string() }).nullable(),
  },
  /** Shows a save dialog when path is null. Resolves null if the dialog is cancelled. */
  'project:save': {
    request: z.object({ project: projectSchema, path: z.string().nullable() }),
    /** The project takes its name from the file, so the saved name is returned. */
    response: z.object({ path: z.string(), name: z.string() }).nullable(),
  },

  /** Tells the main process whether closing the window would lose changes. */
  'project:set-dirty': {
    request: z.object({ dirty: z.boolean(), name: z.string() }),
    response: z.void(),
  },

  'proxy:status': {
    request: z.object({ paths: z.array(z.string()).max(5000) }),
    response: z.record(z.string(), z.string().nullable()),
  },
  'proxy:create': {
    request: z.object({
      items: z
        .array(
          z.object({
            path: z.string(),
            duration: z.number().nonnegative(),
            color: mediaAssetSchema.shape.color,
            width: z.number().int().nonnegative(),
            height: z.number().int().nonnegative(),
          }),
        )
        .max(1000),
    }),
    response: z.void(),
  },
  /** For each file, how many seconds after the first file it started recording, found from the sound. */
  'media:sync': {
    request: z.object({ paths: z.array(z.string()).min(2).max(16) }),
    response: z.object({ offsets: z.array(z.number()), confidence: z.array(z.number()) }),
  },

  /** Follows a point through a range of a file; positions are 0 to 1 of the picture. */
  'analyze:track': {
    request: z.object({
      path: z.string(),
      start: z.number().nonnegative(),
      duration: z.number().positive(),
      fps: z.number().positive(),
      sourceWidth: z.number().int().positive(),
      sourceHeight: z.number().int().positive(),
      point: z.object({ x: z.number(), y: z.number() }),
    }),
    response: z.object({ points: z.array(z.number()), lost: z.number().int() }),
  },
  /** Shake corrections per frame: dx and dy as fractions of the picture, angle in radians. */
  'analyze:shake': {
    request: z.object({
      path: z.string(),
      start: z.number().nonnegative(),
      duration: z.number().positive(),
      fps: z.number().positive(),
      sourceWidth: z.number().int().positive(),
      sourceHeight: z.number().int().positive(),
      smoothness: z.number().min(0).max(1),
    }),
    response: z.object({ corrections: z.array(z.number()) }),
  },

  /** Effect presets are JSON files holding an effect stack; dialogs pick where. */
  'preset:save': {
    request: z.object({ name: z.string(), effects: z.array(effectSchema).min(1) }),
    response: z.object({ path: z.string() }).nullable(),
  },
  'preset:open': {
    request: z.void(),
    response: z.object({ name: z.string(), effects: z.array(effectSchema) }).nullable(),
  },

  /** Color statistics of one frame of a file, for auto balance, auto exposure and color match. */
  'analyze:stats': {
    request: z.object({
      path: z.string(),
      time: z.number().nonnegative(),
      color: mediaAssetSchema.shape.color,
      width: z.number().int(),
      height: z.number().int(),
    }),
    response: z.object({
      mean: z.tuple([z.number(), z.number(), z.number()]),
      std: z.tuple([z.number(), z.number(), z.number()]),
      low: z.number(),
      high: z.number(),
    }),
  },
  /** Integrated loudness (LUFS), true peak (dBTP) and loudness range (LU) of a sequence's mix; null when silent. */
  'audio:loudness': {
    request: z.object({ project: projectSchema, sequenceId: z.string() }),
    response: z.object({
      integrated: z.number().nullable(),
      truePeak: z.number().nullable(),
      range: z.number(),
    }),
  },
  /** Beats in a stretch of a file, in seconds from `start`. */
  'analyze:beats': {
    request: z.object({
      path: z.string(),
      start: z.number().nonnegative(),
      duration: z.number().positive().max(3600),
    }),
    response: z.object({ bpm: z.number(), times: z.array(z.number()) }),
  },
  /** Stores a recorded take and returns its path, ready to import. */
  'voiceover:save': {
    request: z.object({
      data: z.instanceof(Uint8Array).refine((d) => d.byteLength <= 2 * 1024 * 1024 * 1024),
      projectPath: z.string().nullable(),
    }),
    response: z.object({ path: z.string() }),
  },
  /** Local AI models and whether each is downloaded. */
  'models:list': {
    request: z.void(),
    response: z.array(
      z.object({ id: z.string(), ready: z.boolean(), bytes: z.number(), downloading: z.boolean() }),
    ),
  },
  /** Starts a download; progress arrives as `models:progress` events. */
  'models:download': { request: z.object({ id: z.string() }), response: z.void() },
  'models:cancel': { request: z.object({ id: z.string() }), response: z.boolean() },
  'models:delete': { request: z.object({ id: z.string() }), response: z.void() },

  /** Words spoken in a file, in seconds from its start. */
  'ai:transcribe': {
    request: z.object({
      path: z.string(),
      model: z.string(),
      language: z.string().min(2).max(8).nullable(),
    }),
    response: z.array(z.object({ text: z.string(), start: z.number(), end: z.number() })),
  },
  /** Quiet stretches of a sequence's mix, in seconds. */
  'ai:silences': {
    request: z.object({
      project: projectSchema,
      sequenceId: z.string(),
      threshold: z.number().min(-90).max(-10),
      minSeconds: z.number().min(0.1).max(10),
    }),
    response: z.array(z.tuple([z.number(), z.number()])),
  },
  /** Cuts between shots in a stretch of a file, in seconds from `start`. */
  'ai:scenes': {
    request: z.object({
      path: z.string(),
      start: z.number().nonnegative(),
      duration: z.number().positive(),
      threshold: z.number().min(1).max(100),
    }),
    response: z.array(z.number()),
  },
  /** Makes a processed copy of a file and returns its path, ready to import. */
  'ai:clean-voice': {
    request: z.object({ asset: mediaAssetSchema, projectPath: z.string().nullable() }),
    response: z.object({ path: z.string() }),
  },
  'ai:remove-background': {
    request: z.object({
      asset: mediaAssetSchema,
      projectPath: z.string().nullable(),
      jobId: z.string(),
    }),
    response: z.object({ path: z.string() }),
  },
  /** Saves caption text through a save dialog; null if cancelled. */
  'captions:save': {
    request: z.object({
      content: z.string(),
      suggestedName: z.string(),
      format: z.enum(['srt', 'vtt', 'ass']),
    }),
    response: z.object({ path: z.string() }).nullable(),
  },
  /** Opens a subtitle file through a dialog; null if cancelled. */
  'captions:open': {
    request: z.void(),
    response: z.object({ text: z.string(), name: z.string() }).nullable(),
  },
  /** Runs a copilot request; tool activity arrives as `copilot:event`. Nothing is applied. */
  'copilot:run': {
    request: z.object({
      conversationId: z.string(),
      prompt: z.string().min(1).max(20000),
      project: projectSchema,
      sequenceId: z.string(),
    }),
    response: z.object({
      message: z.string(),
      commands: z.array(commandSchema),
      project: projectSchema,
      exportAfterApply: z.boolean(),
      usage: z.object({ input: z.number(), output: z.number() }),
    }),
  },
  'copilot:cancel': { request: z.object({ conversationId: z.string() }), response: z.void() },
  'copilot:reset': { request: z.object({ conversationId: z.string() }), response: z.void() },
  /** What the first request of a conversation would send, and where. */
  'copilot:preview': {
    request: z.object({
      prompt: z.string().max(20000),
      project: projectSchema,
      sequenceId: z.string(),
    }),
    response: z.object({
      destination: z.string(),
      local: z.boolean(),
      system: z.string(),
      message: z.string(),
      tools: z.number(),
      estimatedTokens: z.number(),
    }),
  },
  'copilot:history': {
    request: z.object({ projectId: z.string() }),
    response: z.array(
      z.object({
        at: z.string(),
        provider: z.string(),
        model: z.string(),
        prompt: z.string(),
        reply: z.string(),
        changes: z.number(),
      }),
    ),
  },
  /** Which providers have a stored key; keys themselves never leave the main process. */
  'ai:keys': {
    request: z.void(),
    response: z.object({ set: z.array(z.enum(PROVIDER_IDS)), keyring: z.boolean() }),
  },
  'ai:set-key': {
    request: z.object({ provider: z.enum(PROVIDER_IDS), key: z.string().max(4000).nullable() }),
    response: z.void(),
  },
  /** Model ids from the provider, using its stored key; doubles as a connection test. */
  'ai:models': {
    request: z.object({ provider: z.enum(PROVIDER_IDS), baseUrl: z.string().max(500) }),
    response: z.array(z.string()),
  },
  'mcp:status': {
    request: z.void(),
    response: z.object({
      running: z.boolean(),
      url: z.string().nullable(),
      token: z.string().nullable(),
      stdio: z.object({
        command: z.string(),
        args: z.array(z.string()),
        env: z.record(z.string(), z.string()),
      }),
    }),
  },
  'mcp:new-token': { request: z.void(), response: z.void() },
  /** The editor's answer to an `mcp:request` event. */
  'mcp:reply': {
    request: z.object({
      id: z.string(),
      project: projectSchema.optional(),
      sequenceId: z.string().optional(),
      applied: z.boolean().optional(),
    }),
    response: z.void(),
  },
  /** Reads a .cube LUT file. */
  'lut:read': {
    request: z.object({ path: z.string() }),
    response: z.object({ size: z.number().int(), data: z.array(z.number()) }),
  },
  /** Saves a .cube LUT through a save dialog; null if cancelled. */
  'lut:save': {
    request: z.object({ content: z.string().max(20_000_000), suggestedName: z.string() }),
    response: z.object({ path: z.string() }).nullable(),
  },
  /** Asks for a .cube file; null if cancelled. */
  'lut:pick': { request: z.void(), response: z.object({ path: z.string() }).nullable() },

  'app:session': { request: z.void(), response: z.object({ crashed: z.boolean() }) },
  /** The project file Lumacut was started with, once; null after that or if there was none. */
  'app:launch-file': { request: z.void(), response: z.string().nullable() },
  'recent:list': { request: z.void(), response: z.array(recentProjectSchema) },
  /** Whether this build can sign in with Google, and who is signed in. */
  'account:get': {
    request: z.void(),
    response: z.object({ available: z.boolean(), account: accountSchema.nullable() }),
  },
  /** Opens the browser and waits for the sign-in to finish. */
  'account:sign-in': { request: z.void(), response: accountSchema },
  'account:cancel': { request: z.void(), response: z.void() },
  'account:sign-out': { request: z.void(), response: z.void() },
  'recent:remove': { request: z.object({ path: z.string() }), response: z.void() },
  'recent:clear': { request: z.void(), response: z.void() },
  /** This version's section of the bundled CHANGELOG.md; no sections if it has none. */
  'app:release-notes': { request: z.void(), response: releaseNotesSchema },
  'update:status': { request: z.void(), response: updateStatusSchema },
  'update:check': { request: z.void(), response: updateStatusSchema },
  'update:download': { request: z.void(), response: z.void() },
  /** Quits and installs a downloaded update. */
  'update:install': { request: z.void(), response: z.void() },
  'autosave:write': {
    request: z.object({ project: projectSchema, sourcePath: z.string().nullable() }),
    response: z.void(),
  },
  'autosave:list': {
    request: z.void(),
    response: z.array(
      z.object({
        file: z.string(),
        projectId: z.string(),
        name: z.string(),
        savedAt: z.string(),
        sourcePath: z.string().nullable(),
        newer: z.boolean(),
      }),
    ),
  },
  'autosave:open': {
    request: z.object({ file: z.string() }),
    response: z.object({ project: projectSchema, sourcePath: z.string().nullable() }),
  },
  'autosave:clear': { request: z.object({ projectId: z.string() }), response: z.void() },

  'export:start': {
    request: z.object({
      project: projectSchema,
      sequenceId: z.string(),
      suggestedName: z.string(),
      options: exportOptionsSchema.default(defaultExportOptions),
      range: z
        .object({ start: z.number().int().nonnegative(), end: z.number().int().positive() })
        .nullable()
        .default(null),
    }),
    response: z.object({ jobId: z.string(), path: z.string() }).nullable(),
  },
  'export:cancel': { request: z.object({ jobId: z.string() }), response: z.boolean() },
  /** Hardware encoders that work on this machine, by codec. */
  'export:hardware': {
    request: z.void(),
    response: z.object({
      h264: z.string().nullable(),
      hevc: z.string().nullable(),
      av1: z.string().nullable(),
      vaapiDevice: z.string().nullable(),
    }),
  },

  /** Used by the hidden export window. */
  'render:job': {
    request: z.object({ jobId: z.string() }),
    response: z.object({
      project: projectSchema,
      sequenceId: z.string(),
      start: z.number().int(),
      frames: z.number().int(),
      alpha: z.boolean(),
    }),
  },
  'render:decode': {
    request: z.object({
      path: z.string(),
      start: z.number(),
      duration: z.number(),
      fps: z.number().positive(),
      width: z.number().int().positive().max(16384),
      height: z.number().int().positive().max(16384),
      reverse: z.boolean(),
      interpolation: z.enum(['none', 'blend', 'optical-flow']),
      still: z.boolean(),
      sourceHeight: z.number().int().nonnegative(),
      alpha: z.boolean().default(false),
      color: mediaAssetSchema.shape.color,
      target: z.object({
        colorSpace: z.enum(['rec709', 'p3', 'rec2020']),
        hdr: z.enum(['sdr', 'pq', 'hlg']),
      }),
    }),
    response: z.object({ url: z.string(), deep: z.boolean() }),
  },
  'render:frame': {
    request: z.object({ jobId: z.string(), data: z.instanceof(Uint8Array) }),
    response: z.boolean(),
  },
  'render:finish': { request: z.object({ jobId: z.string() }), response: z.void() },
  'render:fail': {
    request: z.object({ jobId: z.string(), message: z.string() }),
    response: z.void(),
  },
  'export:reveal': { request: z.object({ path: z.string() }), response: z.void() },
} as const

export type IpcContract = typeof ipcContract
export type IpcChannel = keyof IpcContract
export type IpcRequest<C extends IpcChannel> = z.input<IpcContract[C]['request']>
/** A request after validation, with defaults filled in. */
export type IpcParsedRequest<C extends IpcChannel> = z.output<IpcContract[C]['request']>
export type IpcResponse<C extends IpcChannel> = z.output<IpcContract[C]['response']>

export const exportUpdateSchema = z.discriminatedUnion('state', [
  z.object({ jobId: z.string(), state: z.literal('queued'), position: z.number().int() }),
  z.object({
    jobId: z.string(),
    state: z.literal('running'),
    progress: z.number(),
    etaSeconds: z.number().nullable(),
  }),
  z.object({ jobId: z.string(), state: z.literal('done'), path: z.string() }),
  z.object({ jobId: z.string(), state: z.literal('failed'), message: z.string() }),
  z.object({ jobId: z.string(), state: z.literal('cancelled') }),
])

export const proxyUpdateSchema = z.discriminatedUnion('state', [
  z.object({ path: z.string(), state: z.literal('queued') }),
  z.object({ path: z.string(), state: z.literal('running'), progress: z.number() }),
  z.object({ path: z.string(), state: z.literal('done'), proxy: z.string() }),
  z.object({ path: z.string(), state: z.literal('failed'), message: z.string() }),
])

export const menuCommandSchema = z.enum([
  'project.new',
  'project.open',
  'project.versions',
  'project.save',
  'project.saveAs',
  'media.import',
  'media.proxies',
  'sequence.new',
  'sequence.export',
  'edit.undo',
  'edit.redo',
  'edit.split',
  'edit.delete',
  'edit.rippleDelete',
  'edit.insert',
  'edit.overwrite',
  'edit.replace',
  'edit.fitToFill',
  'edit.lift',
  'edit.extract',
  'mark.in',
  'mark.out',
  'mark.clip',
  'mark.clear',
  'marker.add',
  'clip.link',
  'clip.group',
  'clip.ungroup',
  'clip.compound',
  'clip.transition',
  'clip.multicam',
  'timeline.magnetic',
  'timeline.snapping',
  'timeline.zoomFit',
  'view.toggleViewer',
  'playback.toggle',
  'help.whatsNew',
  'help.updates',
  'help.tour',
  'project.home',
])
export type MenuCommand = z.infer<typeof menuCommandSchema>

/** Events pushed from main to renderer. */
export const ipcEvents = {
  'window:maximized-changed': z.boolean(),
  'export:update': exportUpdateSchema,
  'update:status': updateStatusSchema,
  /** A project file opened from the system while Lumacut runs. */
  'project:open-file': z.string(),
  'menu:command': menuCommandSchema,
  'proxy:update': proxyUpdateSchema,
  'models:progress': z.object({
    id: z.string(),
    state: z.enum(['running', 'done', 'failed', 'cancelled']),
    fraction: z.number(),
    message: z.string().optional(),
  }),
  'ai:progress': z.object({ jobId: z.string(), fraction: z.number() }),
  'copilot:event': z.object({
    conversationId: z.string(),
    event: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('tool'),
        name: z.string(),
        args: z.unknown(),
        result: z.string(),
        error: z.boolean(),
      }),
      z.object({ type: z.literal('text'), text: z.string() }),
    ]),
  }),
  /** The MCP server needs the open project, or wants an edit applied. */
  'mcp:request': z.object({
    id: z.string(),
    kind: z.enum(['snapshot', 'apply']),
    commands: z.array(commandSchema).optional(),
    label: z.string().optional(),
  }),
} as const
export type IpcEventName = keyof typeof ipcEvents
export type IpcEventPayload<E extends IpcEventName> = z.output<(typeof ipcEvents)[E]>
