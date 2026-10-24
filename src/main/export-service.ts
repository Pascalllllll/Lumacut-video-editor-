import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import type { Project } from '@engine/model'
import { buildCopyPlan, buildExportPlan, type ExportSettings } from '../media/export-plan'
import { writeImpulses } from './audio-service'
import { binaryPath } from './binaries'
import { MissingFfmpegError } from './media-service'

export type ExportUpdate =
  | { jobId: string; state: 'queued'; position: number }
  | { jobId: string; state: 'running'; progress: number; etaSeconds: number | null }
  | { jobId: string; state: 'done'; path: string }
  | { jobId: string; state: 'failed'; message: string }
  | { jobId: string; state: 'cancelled' }

const jobs = new Map<string, { proc: ChildProcess; cancel: () => void }>()

export async function startExport(
  jobId: string,
  project: Project,
  sequenceId: string,
  output: string,
  settings: ExportSettings,
  notify: (u: ExportUpdate) => void,
  range?: { start: number; end: number },
) {
  const ffmpeg = binaryPath('ffmpeg')
  if (!ffmpeg) throw new MissingFfmpegError()
  const sequence = project.sequences[sequenceId]
  if (!sequence) throw new Error('The sequence to export no longer exists.')
  // An untouched clip in a matching format is copied rather than encoded.
  const source = Object.values(sequence.clips)
    .map((c) => project.media[c.mediaId])
    .find((m) => m?.kind === 'video')
  const copy =
    !range && source
      ? buildCopyPlan(project, sequence, output, settings, {
          video: source.videoCodec,
          audio: source.audioCodec,
        })
      : null
  const plan = copy ?? buildExportPlan(project, sequence, output, settings, range)
  if (settings.options.container === 'png') await mkdir(output, { recursive: true })
  await writeImpulses(plan.impulses)

  const proc = spawn(ffmpeg, plan.args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const started = Date.now()
  let stderrTail = ''
  let cancelled = false

  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk: string) => {
    const match = /out_time_us=(\d+)/.exec(
      chunk
        .split('\n')
        .reverse()
        .find((l) => l.startsWith('out_time_us=')) ?? '',
    )
    if (!match) return
    const progress = Math.min(1, Number(match[1]) / 1e6 / plan.durationSeconds)
    const elapsed = (Date.now() - started) / 1000
    const etaSeconds = progress > 0.02 ? Math.max(0, elapsed / progress - elapsed) : null
    notify({ jobId, state: 'running', progress, etaSeconds })
  })
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4000)
  })
  proc.on('close', (code) => {
    jobs.delete(jobId)
    if (cancelled) {
      void rm(output, { force: true })
      notify({ jobId, state: 'cancelled' })
    } else if (code === 0) {
      notify({ jobId, state: 'done', path: output })
    } else {
      const reason = stderrTail.trim().split('\n').slice(-2).join(' ')
      notify({ jobId, state: 'failed', message: `FFmpeg stopped with an error. ${reason}`.trim() })
    }
  })
  proc.on('error', (error) => {
    jobs.delete(jobId)
    notify({ jobId, state: 'failed', message: `Couldn't start FFmpeg: ${error.message}` })
  })

  jobs.set(jobId, {
    proc,
    cancel() {
      cancelled = true
      proc.kill('SIGTERM')
    },
  })
}

export function cancelExport(jobId: string): boolean {
  const job = jobs.get(jobId)
  if (!job) return false
  job.cancel()
  return true
}

export function cancelAllExports() {
  for (const job of jobs.values()) job.cancel()
}
