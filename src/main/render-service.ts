import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import type { Project } from '@engine/model'
import { buildEncodeArgs, type ExportSettings } from '../media/export-plan'
import { writeImpulses } from './audio-service'
import { binaryPath } from './binaries'
import { stopAllDecoders } from './decode-service'
import type { ExportUpdate } from './export-service'
import { MissingFfmpegError } from './media-service'

type Job = {
  id: string
  project: Project
  sequenceId: string
  output: string
  start: number
  frames: number
  /** Frames keep their transparency for the encoder. */
  alpha: boolean
  done: number
  started: number
  encoder: ChildProcess
  window: BrowserWindow
  notify: (u: ExportUpdate) => void
  cancelled: boolean
  failed: boolean
  stderr: string
}

const jobs = new Map<string, Job>()

/**
 * Exports through the compositor: a hidden window renders each frame with the
 * same code as the viewer and hands the pixels to an FFmpeg encoder, which also
 * mixes the sound.
 */
export async function startRenderExport(
  id: string,
  project: Project,
  sequenceId: string,
  output: string,
  settings: ExportSettings,
  preload: string,
  page: { url?: string; file: string },
  notify: (u: ExportUpdate) => void,
  range?: { start: number; end: number },
) {
  const ffmpeg = binaryPath('ffmpeg')
  if (!ffmpeg) throw new MissingFfmpegError()
  const sequence = project.sequences[sequenceId]
  if (!sequence) throw new Error('The sequence to export no longer exists.')
  const plan = buildEncodeArgs(project, sequence, output, settings, range)
  if (settings.options.container === 'png') await mkdir(output, { recursive: true })
  await writeImpulses(plan.impulses)
  const encoder = spawn(ffmpeg, plan.args, { stdio: ['pipe', 'ignore', 'pipe'] })
  const window = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  const job: Job = {
    id,
    project,
    sequenceId,
    output,
    start: plan.start,
    frames: plan.frames,
    alpha: settings.options.alpha,
    done: 0,
    started: Date.now(),
    encoder,
    window,
    notify,
    cancelled: false,
    failed: false,
    stderr: '',
  }
  jobs.set(id, job)

  encoder.stderr.setEncoding('utf8')
  encoder.stderr.on('data', (c: string) => (job.stderr = (job.stderr + c).slice(-4000)))
  encoder.stdin.on('error', () => undefined)
  encoder.on('close', (code) => {
    jobs.delete(id)
    if (!window.isDestroyed()) window.destroy()
    if (job.cancelled) {
      void rm(output, { force: true })
      notify({ jobId: id, state: 'cancelled' })
    } else if (job.failed) {
      void rm(output, { force: true })
    } else if (code === 0) {
      notify({ jobId: id, state: 'done', path: output })
    } else {
      notify({
        jobId: id,
        state: 'failed',
        message:
          `FFmpeg stopped with an error. ${job.stderr.trim().split('\n').slice(-2).join(' ')}`.trim(),
      })
    }
  })
  window.webContents.on('render-process-gone', () =>
    fail(id, 'The export renderer stopped unexpectedly.'),
  )

  const hash = `render=${encodeURIComponent(id)}`
  if (page.url) void window.loadURL(`${page.url}#${hash}`)
  else void window.loadFile(page.file, { hash })
}

export function renderJob(id: string) {
  const job = jobs.get(id)
  if (!job) throw new Error('This export is no longer running.')
  return {
    project: job.project,
    sequenceId: job.sequenceId,
    start: job.start,
    frames: job.frames,
    alpha: job.alpha,
  }
}

/** Writes one frame to the encoder; resolves once the encoder has room for more. */
export async function renderFrame(id: string, data: Uint8Array): Promise<boolean> {
  const job = jobs.get(id)
  if (!job || job.cancelled || job.failed) return false
  const ok = job.encoder.stdin!.write(data)
  if (!ok) await new Promise<void>((resolve) => job.encoder.stdin!.once('drain', () => resolve()))
  job.done++
  const progress = job.done / job.frames
  const elapsed = (Date.now() - job.started) / 1000
  if (job.done % 5 === 0 || job.done === job.frames) {
    job.notify({
      jobId: id,
      state: 'running',
      progress,
      etaSeconds: progress > 0.02 ? Math.max(0, elapsed / progress - elapsed) : null,
    })
  }
  return true
}

export function finishRender(id: string) {
  jobs.get(id)?.encoder.stdin!.end()
}

export function fail(id: string, message: string) {
  const job = jobs.get(id)
  if (!job || job.failed) return
  job.failed = true
  job.notify({ jobId: id, state: 'failed', message })
  job.encoder.kill('SIGKILL')
  stopAllDecoders()
}

export function cancelRender(id: string): boolean {
  const job = jobs.get(id)
  if (!job) return false
  job.cancelled = true
  job.encoder.kill('SIGKILL')
  stopAllDecoders()
  return true
}

export function isRenderWindow(contentsId: number): boolean {
  for (const job of jobs.values())
    if (!job.window.isDestroyed() && job.window.webContents.id === contentsId) return true
  return false
}

export function cancelAllRenders() {
  for (const id of [...jobs.keys()]) cancelRender(id)
}

export function rendererPage(isDev: boolean): { url?: string; file: string } {
  const url = isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  return { ...(url ? { url } : {}), file: join(app.getAppPath(), 'out', 'renderer', 'index.html') }
}
