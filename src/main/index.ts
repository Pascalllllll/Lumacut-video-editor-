import { randomUUID } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, isAbsolute, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, Menu, nativeTheme, session, shell } from 'electron'
import { APP_ID, APP_NAME, PROJECT_EXTENSION } from '@shared/constants'
import type { IpcEventName, IpcEventPayload } from '@shared/ipc'
import type { Theme } from '@shared/settings'
import { binaryPath, ffmpegVersion } from './binaries'
import { collectFiles, findByName, missingFiles } from './media-tools'
import { detectHardware } from './hardware'
import { defaultExportOptions, extensionOf, type ExportOptions } from '@shared/export'
import { analyzeBeats, exportSettingsFor, measureLoudness, saveRecording } from './audio-service'
import {
  cleanVoice,
  findScenes,
  findSilences,
  removeBackground,
  stopAiWorker,
  transcribe,
} from './ai-service'
import { cancelModelDownload, deleteModel, downloadModel, modelStatus } from './models-service'
import type { Command } from '@engine/commands'
import { projectSchema, type Project } from '@engine/model'
import { PROVIDERS, staysLocal } from '@shared/providers'
import { toolSpecs } from '../ai/tools'
import {
  checkDestination,
  firstMessage,
  forgetConversation,
  readHistory,
  runCopilot,
  SYSTEM_PROMPT,
} from './copilot/agent'
import { getKey, keyringAvailable, keysSet, setKey } from './copilot/keys'
import { mcpAddress, newMcpToken, startMcp, stopMcp, type McpHost } from './copilot/mcp'
import { listModels } from './copilot/providers'
import { cancelAllExports, cancelExport, startExport, type ExportUpdate } from './export-service'
import {
  cancelAllRenders,
  cancelRender,
  fail,
  finishRender,
  renderFrame,
  renderJob,
  rendererPage,
  startRenderExport,
} from './render-service'
import { registerDecode } from './decode-service'
import { analyzeShake, frameStatsAt, trackRegion } from './analysis-service'
import { needsCompositor } from '@engine/scene'
import { parseCube } from '@engine/color'
import { registerIpc, windowFrom } from './ipc'
import {
  allowMediaPaths,
  handleMediaScheme,
  isAllowedMedia,
  MEDIA_SCHEME,
  registerMediaScheme,
} from './media-protocol'
import {
  importPaths,
  MissingFfmpegError,
  probeFile,
  thumbnail,
  waveform,
  WAVEFORM_RATE,
} from './media-service'
import { proxyStatus, queueProxies } from './proxy-service'
import {
  autosavePath,
  clearAutosaves,
  isNewerThanSource,
  listAutosaves,
  markCleanExit,
  previousRunCrashed,
  writeAutosave,
} from './autosave'
import { envelopeOffset } from '../media/sync'
import { buildMenu } from './menu'
import { loadProjectFile, saveProjectFile } from './project-file'
import { SettingsStore } from './settings-store'
import { Updater } from './updater'
import { RecentProjects } from './recent'
import { AccountService } from './account'
import { projectFromArgs } from '@shared/recent'
import { releaseNotes } from '@shared/updates'

const isDev = !app.isPackaged && Boolean(process.env['ELECTRON_RENDERER_URL'])
const isMac = process.platform === 'darwin'

app.setName(APP_NAME)
if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
if (process.env['LUMACUT_USER_DATA']) app.setPath('userData', process.env['LUMACUT_USER_DATA'])
registerMediaScheme()

const settings = new SettingsStore(app.getPath('userData'))
const recent = new RecentProjects(app.getPath('userData'))
const account = new AccountService(app.getPath('userData'))

// One Lumacut per user: opening a project file while it runs hands the file to the open window.
if (!app.requestSingleInstanceLock()) app.exit(0)

/** A project file Lumacut was started with, until the window asks for it. */
let launchFile: string | null = (() => {
  const file = projectFromArgs(process.argv, PROJECT_EXTENSION)
  return file ? resolve(file) : null
})()

function openFromSystem(path: string) {
  const win = mainWindow
  if (!win || win.isDestroyed()) {
    launchFile = path
    return
  }
  if (win.isMinimized()) win.restore()
  win.focus()
  send(win, 'project:open-file', path)
}

app.on('second-instance', (_event, argv, cwd) => {
  const file = projectFromArgs(argv, PROJECT_EXTENSION)
  if (file) openFromSystem(resolve(cwd, file))
  else if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})
// macOS hands over files this way, including the one Lumacut was started with.
app.on('open-file', (event, path) => {
  event.preventDefault()
  if (path.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`)) openFromSystem(path)
})
const exportedPaths = new Set<string>()
/** Exports still measuring loudness; cancelling removes the id. */
const preparing = new Set<string>()
const unsaved = { dirty: false, name: '' }
let mainWindow: BrowserWindow | null = null

const MEDIA_FILTERS = [
  {
    name: 'Media',
    extensions: [
      'mp4',
      'm4v',
      'mov',
      'mkv',
      'webm',
      'avi',
      'mxf',
      'mts',
      'm2ts',
      'mpg',
      'mpeg',
      'wmv',
      'flv',
      '3gp',
      'mp3',
      'm4a',
      'aac',
      'wav',
      'flac',
      'ogg',
      'opus',
      'aif',
      'aiff',
      'wma',
      'png',
      'jpg',
      'jpeg',
      'webp',
      'bmp',
      'tif',
      'tiff',
      'gif',
      'svg',
      'avif',
      'heic',
    ],
  },
  { name: 'All files', extensions: ['*'] },
]
const CONTAINER_NAMES: Record<string, string> = {
  mp4: 'MP4 video',
  mov: 'QuickTime movie',
  mkv: 'Matroska video',
  webm: 'WebM video',
  gif: 'Animated GIF',
  wav: 'WAV audio',
  m4a: 'AAC audio',
  mp3: 'MP3 audio',
  flac: 'FLAC audio',
}
const PROJECT_FILTERS = [{ name: `${APP_NAME} project`, extensions: [PROJECT_EXTENSION] }]
const PRESET_FILTERS = [{ name: 'Effect preset', extensions: ['lumacut-fx'] }]

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // React inline style props and Vite's dev style injection need inline styles.
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${MEDIA_SCHEME}:`,
  `media-src 'self' blob: ${MEDIA_SCHEME}:`,
  "font-src 'self' data:",
  isDev
    ? `connect-src 'self' ws: http://localhost:* ${MEDIA_SCHEME}:`
    : `connect-src 'self' ${MEDIA_SCHEME}:`,
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join('; ')

function themeSource(theme: Theme): 'system' | 'light' | 'dark' {
  return theme === 'auto' ? 'system' : theme
}

const APP_PAGE = join(app.getAppPath(), 'out', 'renderer', 'index.html')
const samePath = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

/**
 * Only Lumacut's own page gets the preload API and may call IPC. Any other
 * local file (an HTML or SVG file dropped on the window, say) is not trusted.
 */
function isTrustedUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'file:') {
    try {
      return samePath(normalize(fileURLToPath(parsed)), normalize(APP_PAGE))
    } catch {
      return false
    }
  }
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  return Boolean(isDev && devUrl && parsed.origin === new URL(devUrl).origin)
}

function send<E extends IpcEventName>(
  win: BrowserWindow | null,
  event: E,
  payload: IpcEventPayload<E>,
) {
  if (win && !win.isDestroyed()) win.webContents.send(event, payload)
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141518' : '#e7e7ea',
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 14, y: 13 },
    vibrancy: isMac ? 'sidebar' : undefined,
    backgroundMaterial: process.platform === 'win32' ? 'mica' : undefined,
    icon: join(app.getAppPath(), 'resources', 'icons', 'icon.png'),
    webPreferences: {
      preload: join(app.getAppPath(), 'out', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  win.on('ready-to-show', () => win.show())
  win.on('close', (event) => {
    if (!unsaved.dirty) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Close without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `"${unsaved.name}" has changes that aren't saved.`,
      detail: 'If you close now, those changes are lost.',
    })
    if (choice === 1) event.preventDefault()
  })
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(settings.get().uiScale))
  win.on('maximize', () => send(win, 'window:maximized-changed', true))
  win.on('unmaximize', () => send(win, 'window:maximized-changed', false))

  // Nothing remote ever loads in the main window; links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(app.getAppPath(), 'out', 'renderer', 'index.html'))

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
  // Every web contents, not just the main window, stays on Lumacut's own page.
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })
  contents.on('will-redirect', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })
})

function withExtension(path: string, ext: string) {
  return path.toLowerCase().endsWith(`.${ext}`) ? path : `${path}.${ext}`
}

/**
 * Starts an export to a chosen file; progress goes to the window as
 * `export:update` events. Returns the job id.
 */
const copilotRuns = new Map<string, AbortController>()
type EditorAnswer = { project?: Project; sequenceId?: string; applied?: boolean }
const editorWaits = new Map<string, (answer: EditorAnswer) => void>()

/** Asks the editor window for the open project, or to apply an edit, and waits for its answer. */
function askEditor(
  kind: 'snapshot' | 'apply',
  extra: { commands?: Command[]; label?: string },
  timeoutMs: number,
): Promise<EditorAnswer> {
  const id = randomUUID()
  if (!mainWindow || mainWindow.isDestroyed())
    return Promise.reject(new Error('Lumacut has no project window open.'))
  send(mainWindow, 'mcp:request', { id, kind, ...extra })
  return new Promise((resolve, reject) => {
    editorWaits.set(id, resolve)
    setTimeout(() => {
      if (editorWaits.delete(id)) reject(new Error('Lumacut did not answer in time.'))
    }, timeoutMs)
  })
}

const mcpHost: McpHost = {
  snapshot: async () => {
    const answer = await askEditor('snapshot', {}, 10_000)
    return { project: projectSchema.parse(answer.project), sequenceId: answer.sequenceId ?? '' }
  },
  apply: async (commands, label) =>
    (await askEditor('apply', { commands, label }, 10 * 60_000)).applied ?? false,
  exportTo: async (project, sequenceId, path) => {
    if (!isAbsolute(path)) throw new Error('Give a full path for the export file.')
    const output = withExtension(path, 'mp4')
    // Requests from other AI tools never replace a file that is already there.
    if (existsSync(output)) throw new Error(`${output} already exists. Choose a new file name.`)
    beginExport(mainWindow, project, sequenceId, output)
    return output
  },
}

async function syncMcp(enabled: boolean) {
  if (enabled) await startMcp(mcpHost)
  else await stopMcp()
}

type ExportRequest = {
  jobId: string
  win: BrowserWindow | null
  project: Project
  sequenceId: string
  output: string
  options: ExportOptions
  range: { start: number; end: number } | null
}
const exportQueue: ExportRequest[] = []
let exportRunning: string | null = null

/**
 * Queues an export to a chosen file. Exports run one at a time, in the
 * background; progress goes to the window as `export:update` events.
 */
function beginExport(
  win: BrowserWindow | null,
  project: Project,
  sequenceId: string,
  output: string,
  options: ExportOptions = defaultExportOptions(),
  range: { start: number; end: number } | null = null,
): string {
  if (!binaryPath('ffmpeg')) throw new MissingFfmpegError()
  const jobId = randomUUID()
  exportQueue.push({ jobId, win, project, sequenceId, output, options, range })
  send(win, 'export:update', { jobId, state: 'queued', position: exportQueue.length })
  pumpExports()
  return jobId
}

function pumpExports() {
  if (exportRunning) return
  const next = exportQueue.shift()
  if (!next) return
  exportRunning = next.jobId
  runExport(next)
}

function runExport({ jobId, win, project, sequenceId, output, options, range }: ExportRequest) {
  const notify = (update: ExportUpdate) => {
    if (update.state === 'done') exportedPaths.add(update.path)
    send(win, 'export:update', update)
    if (update.state !== 'running' && exportRunning === jobId) {
      exportRunning = null
      pumpExports()
    }
  }
  const sequence = project.sequences[sequenceId]
  notify({ jobId, state: 'running', progress: 0, etaSeconds: null })
  preparing.add(jobId)
  const at = range ?? undefined
  void (async () => {
    // Measuring loudness runs first; a cancel during it stops the export before it starts.
    const settings = await exportSettingsFor(project, sequenceId, options)
    if (!preparing.delete(jobId)) return notify({ jobId, state: 'cancelled' })
    // Plain cuts go straight through FFmpeg; anything with a look goes through the compositor.
    if (sequence && needsCompositor(project, sequence)) {
      await startRenderExport(
        jobId,
        project,
        sequenceId,
        output,
        settings,
        join(app.getAppPath(), 'out', 'preload', 'index.cjs'),
        rendererPage(isDev),
        notify,
        at,
      )
    } else {
      await startExport(jobId, project, sequenceId, output, settings, notify, at)
    }
  })().catch((error: unknown) => {
    preparing.delete(jobId)
    notify({
      jobId,
      state: 'failed',
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

let crashed = false
const updater = new Updater((status) => send(mainWindow, 'update:status', status))

/** The bundled CHANGELOG.md; next to the app in development. */
async function changelog() {
  const path = app.isPackaged
    ? join(process.resourcesPath, 'CHANGELOG.md')
    : join(app.getAppPath(), 'CHANGELOG.md')
  return readFile(path, 'utf8').catch(() => '')
}

void app.whenReady().then(async () => {
  await settings.load()
  await recent.load()
  crashed = await previousRunCrashed()
  nativeTheme.themeSource = themeSource(settings.get().theme)
  handleMediaScheme()

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } })
  })
  // The microphone, for voiceover, is the only permission the app grants, and only to its own pages.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    callback(
      permission === 'media' &&
        isTrustedUrl(wc.getURL()) &&
        types.length > 0 &&
        types.every((t) => t === 'audio'),
    )
  })
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission) => permission === 'media' && isTrustedUrl(wc?.getURL() ?? ''),
  )

  registerIpc(
    {
      'app:info': async () => ({
        version: app.getVersion(),
        platform:
          (['linux', 'win32', 'darwin'] as const).find((p) => p === process.platform) ?? 'other',
        arch: process.arch,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        ffmpeg: await ffmpegVersion(),
      }),
      'settings:get': () => settings.get(),
      'settings:set': async (patch) => {
        let next = await settings.update(patch)
        // Someone finishing the welcome sheet doesn't need this version's notes as well.
        if (patch.onboarded && !next.lastSeenVersion)
          next = await settings.update({ lastSeenVersion: app.getVersion() })
        if (patch.updates) updater.setMode(next.updates)
        if (patch.ai) await syncMcp(next.ai.mcp)
        nativeTheme.themeSource = themeSource(next.theme)
        for (const w of BrowserWindow.getAllWindows()) w.webContents.setZoomFactor(next.uiScale)
        return next
      },
      'window:minimize': (_p, e) => {
        windowFrom(e)?.minimize()
      },
      'window:toggle-maximize': (_p, e) => {
        const win = windowFrom(e)
        if (!win) return false
        if (win.isMaximized()) win.unmaximize()
        else win.maximize()
        return win.isMaximized()
      },
      'window:close': (_p, e) => {
        windowFrom(e)?.close()
      },
      'window:is-maximized': (_p, e) => windowFrom(e)?.isMaximized() ?? false,

      'media:import': async ({ paths }, e) => {
        let chosen = paths
        if (!chosen) {
          const win = windowFrom(e)
          const options = {
            title: 'Import media',
            properties: ['openFile', 'multiSelections'] as const,
            filters: MEDIA_FILTERS,
          }
          const result = win
            ? await dialog.showOpenDialog(win, { ...options, properties: [...options.properties] })
            : await dialog.showOpenDialog({ ...options, properties: [...options.properties] })
          if (result.canceled) return { assets: [], errors: [], cancelled: true }
          chosen = result.filePaths
        }
        const { assets, errors } = await importPaths(chosen)
        allowMediaPaths(assets.map((a) => a.path))
        return { assets, errors, cancelled: false }
      },
      'media:thumbnail': async (asset) => ({ name: await thumbnail(asset).catch(() => null) }),
      'media:missing': ({ paths }) => missingFiles(paths),
      'media:relink': async ({ name, kind }, e) => {
        const win = windowFrom(e)
        const options = {
          title: `Find ${name}`,
          properties: ['openFile' as const],
        }
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options)
        const file = result.filePaths[0]
        if (result.canceled || !file) return null
        const probed = await probeFile(file)
        if (probed.kind !== kind && !(kind === 'video' && probed.kind === 'image'))
          throw new Error(
            `${basename(file)} isn't the same kind of media as ${name}. Choose the moved file.`,
          )
        allowMediaPaths([file])
        return { path: file, size: probed.size }
      },
      'media:locate': async ({ names }, e) => {
        const win = windowFrom(e)
        const options = {
          title: 'Find missing media in a folder',
          properties: ['openDirectory' as const],
        }
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options)
        const folder = result.filePaths[0]
        if (result.canceled || !folder) return null
        const found = await findByName(folder, names)
        const out: Record<string, { path: string; size: number }> = {}
        for (const [name, path] of Object.entries(found))
          out[name] = { path, size: (await stat(path)).size }
        allowMediaPaths(Object.values(found))
        return out
      },
      'media:collect': async ({ files, suggested }, e) => {
        const win = windowFrom(e)
        const options = {
          title: 'Collect media into a folder',
          defaultPath: join(app.getPath('videos'), `${suggested} media`),
          properties: [
            'openDirectory' as const,
            'createDirectory' as const,
            'promptToCreate' as const,
          ],
        }
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options)
        const folder = result.filePaths[0]
        if (result.canceled || !folder) return null
        const moved = await collectFiles(files, folder, () => undefined)
        allowMediaPaths(Object.values(moved).map((m) => m.path))
        return moved
      },
      'media:waveform': async ({ path }) => {
        const peaks = await waveform(path)
        return { rate: WAVEFORM_RATE, peaks: Buffer.from(peaks).toString('base64') }
      },

      'project:open': async ({ path }, e) => {
        let target = path
        if (!target) {
          const win = windowFrom(e)
          const options = {
            title: 'Open project',
            properties: ['openFile' as const],
            filters: PROJECT_FILTERS,
          }
          const result = win
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options)
          if (result.canceled || !result.filePaths[0]) return null
          target = result.filePaths[0]
        }
        const project = await loadProjectFile(target)
        allowMediaPaths(Object.values(project.media).map((m) => m.path))
        app.addRecentDocument(target)
        await recent.add(target, project.name)
        return { project, path: target }
      },
      'project:save': async ({ project, path }, e) => {
        let target = path
        if (!target) {
          const win = windowFrom(e)
          const options = {
            title: 'Save project',
            defaultPath: `${project.name}.${PROJECT_EXTENSION}`,
            filters: PROJECT_FILTERS,
          }
          const result = win
            ? await dialog.showSaveDialog(win, options)
            : await dialog.showSaveDialog(options)
          if (result.canceled || !result.filePath) return null
          target = withExtension(result.filePath, PROJECT_EXTENSION)
        }
        const name =
          basename(target).replace(new RegExp(`\\.${PROJECT_EXTENSION}$`, 'i'), '') || project.name
        await saveProjectFile(target, { ...project, name }, app.getVersion())
        app.addRecentDocument(target)
        await recent.add(target, name)
        return { path: target, name }
      },

      'project:set-dirty': ({ dirty, name }) => {
        unsaved.dirty = dirty
        unsaved.name = name
      },

      'proxy:status': ({ paths }) => proxyStatus(paths),
      'proxy:create': ({ items }, e) => {
        const win = windowFrom(e)
        queueProxies(items, (update) => send(win, 'proxy:update', update))
      },
      'media:sync': async ({ paths }) => {
        // Envelopes at 100 per second; search up to two minutes either way.
        const envelopes = await Promise.all(paths.map((p) => waveform(p)))
        const reference = envelopes[0]!.subarray(0, WAVEFORM_RATE * 600)
        const offsets = [0]
        const confidence = [1]
        for (const env of envelopes.slice(1)) {
          const { lag, score } = envelopeOffset(
            reference,
            env.subarray(0, WAVEFORM_RATE * 600),
            WAVEFORM_RATE * 120,
          )
          // A positive lag means this file started recording that much later.
          offsets.push(lag / WAVEFORM_RATE)
          confidence.push(score)
        }
        return { offsets, confidence }
      },

      'analyze:track': ({ point, ...range }) => {
        if (!isAllowedMedia(range.path))
          throw new Error('That file is not part of an open project.')
        return trackRegion(range, point)
      },
      'analyze:shake': ({ smoothness, ...range }) => {
        if (!isAllowedMedia(range.path))
          throw new Error('That file is not part of an open project.')
        return analyzeShake(range, smoothness)
      },
      'preset:save': async ({ name, effects }, e) => {
        const win = windowFrom(e)
        const options = {
          title: 'Save effect preset',
          defaultPath: `${name}.lumacut-fx`,
          filters: PRESET_FILTERS,
        }
        const result = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return null
        const target = withExtension(result.filePath, 'lumacut-fx')
        await writeFile(
          target,
          JSON.stringify(
            { app: APP_NAME, kind: 'effect-preset', version: 1, name, effects },
            null,
            2,
          ),
        )
        return { path: target }
      },
      'preset:open': async (_p, e) => {
        const win = windowFrom(e)
        const options = {
          title: 'Load effect preset',
          properties: ['openFile' as const],
          filters: PRESET_FILTERS,
        }
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options)
        if (result.canceled || !result.filePaths[0]) return null
        const raw = JSON.parse(await readFile(result.filePaths[0], 'utf8')) as {
          name?: unknown
          effects?: unknown
        }
        if (!Array.isArray(raw.effects)) throw new Error("That file isn't a Lumacut effect preset.")
        return {
          name: typeof raw.name === 'string' ? raw.name : basename(result.filePaths[0]),
          effects: raw.effects as never,
        }
      },
      'analyze:stats': ({ path, time, color, width, height }) => {
        if (!isAllowedMedia(path)) throw new Error('That file is not part of an open project.')
        return frameStatsAt(path, time, color, width, height)
      },
      'lut:read': async ({ path }) => {
        if (!path.toLowerCase().endsWith('.cube'))
          throw new Error('Only .cube LUT files can be read.')
        const cube = parseCube(await readFile(path, 'utf8'))
        return { size: cube.size, data: Array.from(cube.data) }
      },
      'lut:save': async ({ content, suggestedName }, e) => {
        const win = windowFrom(e)
        const options = {
          title: 'Export grade as LUT',
          defaultPath: join(app.getPath('documents'), `${suggestedName}.cube`),
          filters: [{ name: 'Cube LUT', extensions: ['cube'] }],
        }
        const result = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return null
        const path = withExtension(result.filePath, 'cube')
        await writeFile(path, content, 'utf8')
        return { path }
      },
      'lut:pick': async (_p, e) => {
        const win = windowFrom(e)
        const options = {
          title: 'Choose a LUT',
          properties: ['openFile' as const],
          filters: [{ name: 'Cube LUT', extensions: ['cube'] }],
        }
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options)
        return result.canceled || !result.filePaths[0] ? null : { path: result.filePaths[0] }
      },
      'app:session': () => ({ crashed }),
      'app:launch-file': () => {
        const file = launchFile
        launchFile = null
        return file
      },
      'recent:list': () => recent.list(),
      'account:get': async () => ({ available: account.available(), account: await account.get() }),
      'account:sign-in': () => account.signIn(),
      'account:cancel': () => account.cancel(),
      'account:sign-out': () => account.signOut(),
      'recent:remove': ({ path }) => recent.remove(path),
      'recent:clear': () => recent.clear(),
      'app:release-notes': async () =>
        releaseNotes(await changelog(), app.getVersion()) ?? {
          version: app.getVersion(),
          date: null,
          sections: [],
        },
      'update:status': () => updater.current(),
      'update:check': () => updater.check(),
      'update:download': () => updater.download(),
      'update:install': () => updater.install(),
      'autosave:write': ({ project, sourcePath }) => writeAutosave(project, sourcePath),
      'autosave:list': async () =>
        Promise.all(
          (await listAutosaves()).map(async (entry) => ({
            ...entry,
            newer: await isNewerThanSource(entry),
          })),
        ),
      'autosave:open': async ({ file }) => {
        const entry = (await listAutosaves()).find((e) => e.file === file)
        const project = await loadProjectFile(autosavePath(file))
        allowMediaPaths(
          Object.values(project.media)
            .map((m) => m.path)
            .filter(Boolean),
        )
        return { project, sourcePath: entry?.sourcePath ?? null }
      },
      'autosave:clear': ({ projectId }) => clearAutosaves(projectId),

      'export:start': async ({ project, sequenceId, suggestedName, options, range }, e) => {
        const win = windowFrom(e)
        const ext = extensionOf(options)
        const folder = ext === 'png'
        const dialogOptions = {
          title: folder ? 'Export frames to a new folder' : 'Export',
          defaultPath: join(
            app.getPath('videos'),
            folder ? `${suggestedName} frames` : `${suggestedName}.${ext}`,
          ),
          filters: folder ? [] : [{ name: CONTAINER_NAMES[ext] ?? ext, extensions: [ext] }],
        }
        const result = win
          ? await dialog.showSaveDialog(win, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions)
        if (result.canceled || !result.filePath) return null
        const output = folder ? result.filePath : withExtension(result.filePath, ext)
        if (Object.values(project.media).some((m) => m.path === output)) {
          throw new Error(
            `${basename(output)} is used in this project. Choose another name for the export.`,
          )
        }
        const jobId = beginExport(win, project, sequenceId, output, options, range)
        return { jobId, path: output }
      },
      'export:cancel': ({ jobId }, e) => {
        const queued = exportQueue.findIndex((j) => j.jobId === jobId)
        if (queued >= 0) {
          exportQueue.splice(queued, 1)
          send(windowFrom(e), 'export:update', { jobId, state: 'cancelled' })
          return true
        }
        return preparing.delete(jobId) || cancelExport(jobId) || cancelRender(jobId)
      },
      'export:hardware': () => detectHardware(),
      'render:job': ({ jobId }) => renderJob(jobId),
      'render:decode': (request) => {
        if (!isAllowedMedia(request.path))
          throw new Error('That file is not part of an open project.')
        return {
          url: `${MEDIA_SCHEME}://decode/${registerDecode(request)}`,
          deep: request.target.hdr !== 'sdr',
        }
      },
      'render:frame': ({ jobId, data }) => renderFrame(jobId, data),
      'render:finish': ({ jobId }) => finishRender(jobId),
      'render:fail': ({ jobId, message }) => fail(jobId, message),
      'audio:loudness': async ({ project, sequenceId }) => {
        const s = await measureLoudness(project, sequenceId)
        const finite = (n: number) => (Number.isFinite(n) ? n : null)
        return { integrated: finite(s.integrated), truePeak: finite(s.truePeak), range: s.range }
      },
      'analyze:beats': ({ path, start, duration }) => {
        if (!isAllowedMedia(path)) throw new Error('That file is not part of an open project.')
        return analyzeBeats(path, start, duration)
      },
      'voiceover:save': async ({ data, projectPath }) => ({
        path: await saveRecording(data, projectPath, join(app.getPath('userData'), 'recordings')),
      }),
      'models:list': () => modelStatus(),
      'models:download': ({ id }, e) => {
        const win = windowFrom(e)
        void downloadModel(id, (fraction) =>
          send(win, 'models:progress', { id, state: 'running', fraction }),
        ).then(
          () => send(win, 'models:progress', { id, state: 'done', fraction: 1 }),
          (error: unknown) =>
            send(win, 'models:progress', {
              id,
              state: error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed',
              fraction: 0,
              message: error instanceof Error ? error.message : String(error),
            }),
        )
      },
      'models:cancel': ({ id }) => cancelModelDownload(id),
      'models:delete': ({ id }) => deleteModel(id),
      'ai:transcribe': ({ path, model, language }) => {
        if (!isAllowedMedia(path)) throw new Error('That file is not part of an open project.')
        return transcribe(path, model, language)
      },
      'ai:silences': ({ project, sequenceId, threshold, minSeconds }) =>
        findSilences(project, sequenceId, threshold, minSeconds),
      'ai:scenes': ({ path, start, duration, threshold }) => {
        if (!isAllowedMedia(path)) throw new Error('That file is not part of an open project.')
        return findScenes(path, start, duration, threshold)
      },
      'ai:clean-voice': async ({ asset, projectPath }) => {
        if (!isAllowedMedia(asset.path))
          throw new Error('That file is not part of an open project.')
        return { path: await cleanVoice(asset, projectPath) }
      },
      'ai:remove-background': async ({ asset, projectPath, jobId }, e) => {
        if (!isAllowedMedia(asset.path))
          throw new Error('That file is not part of an open project.')
        const win = windowFrom(e)
        const path = await removeBackground(asset, projectPath, (fraction) =>
          send(win, 'ai:progress', { jobId, fraction }),
        )
        return { path }
      },
      'captions:save': async ({ content, suggestedName, format }, e) => {
        const win = windowFrom(e)
        const names = {
          srt: 'SubRip subtitles',
          vtt: 'WebVTT captions',
          ass: 'Styled subtitles (ASS)',
        }
        const options = {
          title: 'Export captions',
          defaultPath: join(app.getPath('documents'), `${suggestedName}.${format}`),
          filters: [{ name: names[format], extensions: [format] }],
        }
        const result = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return null
        const path = withExtension(result.filePath, format)
        await writeFile(path, content, 'utf8')
        return { path }
      },
      'captions:open': async (_req, e) => {
        const win = windowFrom(e)
        const options = {
          title: 'Import captions',
          properties: ['openFile' as const],
          filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }],
        }
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options)
        const file = result.filePaths[0]
        if (result.canceled || !file) return null
        return { text: await readFile(file, 'utf8'), name: basename(file) }
      },
      'copilot:run': async (req, e) => {
        const win = windowFrom(e)
        const abort = new AbortController()
        copilotRuns.get(req.conversationId)?.abort()
        copilotRuns.set(req.conversationId, abort)
        try {
          return await runCopilot(
            req,
            settings.get().ai,
            (event) => send(win, 'copilot:event', { conversationId: req.conversationId, event }),
            abort.signal,
          )
        } finally {
          if (copilotRuns.get(req.conversationId) === abort) copilotRuns.delete(req.conversationId)
        }
      },
      'copilot:cancel': ({ conversationId }) => {
        copilotRuns.get(conversationId)?.abort()
      },
      'copilot:reset': ({ conversationId }) => {
        copilotRuns.get(conversationId)?.abort()
        forgetConversation(conversationId)
      },
      'copilot:preview': async ({ prompt, project, sequenceId }) => {
        const ai = settings.get().ai
        const base = ai.provider ? ai.baseUrl || PROVIDERS[ai.provider].baseUrl : ''
        const message = await firstMessage(prompt, project, sequenceId)
        const tools = toolSpecs()
        const chars = SYSTEM_PROMPT.length + message.length + JSON.stringify(tools).length
        return {
          destination: base,
          local: ai.provider ? staysLocal(ai.provider, ai.baseUrl) : true,
          system: SYSTEM_PROMPT,
          message,
          tools: tools.length,
          estimatedTokens: Math.ceil(chars / 4),
        }
      },
      'copilot:history': ({ projectId }) => readHistory(projectId),
      'ai:keys': async () => ({ set: await keysSet(), keyring: keyringAvailable() }),
      'ai:set-key': ({ provider, key }) => setKey(provider, key),
      'ai:models': async ({ provider, baseUrl }) => {
        checkDestination({ ...settings.get().ai, provider, baseUrl })
        return listModels({ provider, model: '', baseUrl, apiKey: await getKey(provider) })
      },
      'mcp:status': () => {
        const address = mcpAddress()
        return {
          running: address !== null,
          url: address ? `http://127.0.0.1:${address.port}/mcp` : null,
          token: address?.token ?? null,
          stdio: {
            command: process.execPath,
            args: [join(app.getAppPath(), 'out', 'main', 'mcp-stdio.js')],
            env: {
              ELECTRON_RUN_AS_NODE: '1',
              LUMACUT_MCP_CONFIG: join(app.getPath('userData'), 'mcp.json'),
            },
          },
        }
      },
      'mcp:new-token': async () => {
        await newMcpToken()
        if (mcpAddress()) {
          await stopMcp()
          await startMcp(mcpHost)
        }
      },
      'mcp:reply': ({ id, ...answer }) => {
        const done = editorWaits.get(id)
        editorWaits.delete(id)
        done?.(answer)
      },
      'export:reveal': ({ path }) => {
        if (exportedPaths.has(path)) shell.showItemInFolder(path)
      },
    },
    (event) => isTrustedUrl(event.senderFrame?.url ?? ''),
  )

  Menu.setApplicationMenu(buildMenu(isDev, (command) => send(mainWindow, 'menu:command', command)))
  createWindow()
  if (settings.get().ai.mcp) void syncMcp(true)
  updater.setMode(settings.get().updates)
  // Look once shortly after starting, then every few hours.
  if (settings.get().updates !== 'off') setTimeout(() => void updater.check(), 10_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  cancelAllExports()
  cancelAllRenders()
  stopAiWorker()
  void stopMcp()
})
app.on('will-quit', () => markCleanExit())

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
