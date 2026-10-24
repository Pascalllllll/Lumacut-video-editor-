import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Project } from '@engine/model'
import { findBeats, type Beats } from '../audio/beats'
import {
  buildLoudnessArgs,
  defaultExportSettings,
  loudnessGain,
  parseLoudness,
  type ExportSettings,
  type LoudnessSummary,
} from '../media/export-plan'
import { writeImpulses } from '../media/impulses'
import { defaultExportOptions, forSequence, type ExportOptions } from '@shared/export'
import { NO_HARDWARE } from '../media/encode'
import { binaryPath } from './binaries'
import { detectHardware } from './hardware'
import { MissingFfmpegError } from './media-service'
import { cacheDir } from './paths'

export { writeImpulses }

export function impulseDir(): string {
  return join(cacheDir(), 'impulses')
}

function ffmpeg(): string {
  const path = binaryPath('ffmpeg')
  if (!path) throw new MissingFfmpegError()
  return path
}

/** Integrated loudness, true peak and loudness range of a sequence's mix. */
export async function measureLoudness(
  project: Project,
  sequenceId: string,
  range?: { start: number; end: number },
): Promise<LoudnessSummary> {
  const sequence = project.sequences[sequenceId]
  if (!sequence) throw new Error('The sequence to measure no longer exists.')
  const plan = buildLoudnessArgs(project, sequence, impulseDir(), range)
  await writeImpulses(plan.impulses)
  const stderr = await new Promise<string>((resolve, reject) => {
    const proc = spawn(ffmpeg(), plan.args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let text = ''
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (c: string) => {
      text = (text + c).slice(-20000)
    })
    proc.on('error', reject)
    proc.on('close', (code) =>
      code === 0
        ? resolve(text)
        : reject(
            new Error(`Couldn't measure the loudness. ${text.trim().split('\n').pop() ?? ''}`),
          ),
    )
  })
  const summary = parseLoudness(stderr)
  if (!summary) throw new Error("Couldn't read the loudness measurement from FFmpeg.")
  return summary
}

/** Export settings for a sequence, measuring the mix first when it has a loudness target. */
export async function exportSettingsFor(
  project: Project,
  sequenceId: string,
  options: ExportOptions = defaultExportOptions(),
): Promise<ExportSettings> {
  const hdr = (project.sequences[sequenceId]?.hdr ?? 'sdr') !== 'sdr'
  const base: ExportSettings = {
    ...defaultExportSettings,
    options: forSequence(options, hdr),
    hardware: options.hardware ? await detectHardware() : NO_HARDWARE,
    irDir: impulseDir(),
  }
  const target = project.sequences[sequenceId]?.loudnessTarget ?? null
  if (target === null || options.audio === 'none') return base
  const summary = await measureLoudness(project, sequenceId)
  // A silent mix has no loudness to correct.
  if (!Number.isFinite(summary.integrated)) return base
  return { ...base, loudness: loudnessGain(summary, target) }
}

const BEAT_RATE = 22050

/** Beats in a stretch of a file, in seconds from `start`. */
export async function analyzeBeats(path: string, start: number, duration: number): Promise<Beats> {
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpeg(), [
      '-v',
      'error',
      '-nostdin',
      '-ss',
      start.toFixed(6),
      '-t',
      duration.toFixed(6),
      '-i',
      path,
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(BEAT_RATE),
      '-f',
      'f32le',
      '-',
    ])
    proc.stdout.on('data', (c: Buffer) => chunks.push(c))
    proc.on('error', reject)
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Couldn't read the sound in ${path}.`)),
    )
  })
  const buf = Buffer.concat(chunks)
  const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
  return findBeats(Float32Array.from(samples), BEAT_RATE)
}

/**
 * Saves a voiceover take next to the project (or in the app data folder for an
 * unsaved project). The recorder's WebM has no duration in its header, so the
 * take is stored as a WAV file instead.
 */
export async function saveRecording(
  bytes: Uint8Array,
  projectPath: string | null,
  fallbackDir: string,
): Promise<string> {
  const dir = projectPath ? join(dirname(projectPath), 'Recordings') : fallbackDir
  await mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  let path = join(dir, `Voiceover ${stamp}.wav`)
  for (let n = 2; existsSync(path); n++) path = join(dir, `Voiceover ${stamp} ${n}.wav`)
  const tmp = `${path}.webm`
  await writeFile(tmp, bytes)
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpeg(), [
        '-v',
        'error',
        '-nostdin',
        '-y',
        '-i',
        tmp,
        '-vn',
        '-c:a',
        'pcm_s16le',
        '-ar',
        '48000',
        path,
      ])
      proc.on('error', reject)
      proc.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error("Couldn't save the recording.")),
      )
    })
  } finally {
    await rm(tmp, { force: true })
  }
  return path
}
