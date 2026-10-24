import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createId, type MediaAsset } from '@engine/model'
import { assetFromProbe, UnsupportedMediaError, type ProbeOutput } from '../media/probe'
import { binaryPath } from './binaries'
import { cacheDir } from './paths'

const run = promisify(execFile)

/** Peaks per second stored for waveforms. */
export const WAVEFORM_RATE = 100

export class MissingFfmpegError extends Error {
  constructor() {
    super('FFmpeg is missing from this installation. Reinstall Lumacut to restore it.')
  }
}

function tool(name: 'ffmpeg' | 'ffprobe'): string {
  const path = binaryPath(name)
  if (!path) throw new MissingFfmpegError()
  return path
}

async function cacheKey(path: string): Promise<string> {
  const info = await stat(path)
  return createHash('sha1').update(`${path}\0${info.size}\0${info.mtimeMs}`).digest('hex')
}

export async function probeFile(path: string): Promise<MediaAsset> {
  const info = await stat(path)
  if (!info.isFile()) throw new UnsupportedMediaError(`${path} is a folder, not a file.`)
  let stdout: string
  try {
    ;({ stdout } = await run(
      tool('ffprobe'),
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
      {
        maxBuffer: 16 * 1024 * 1024,
        timeout: 30_000,
      },
    ))
  } catch (error) {
    if (error instanceof MissingFfmpegError) throw error
    throw new UnsupportedMediaError(
      `Couldn't read ${path}. The file may be damaged or in a format Lumacut doesn't support.`,
    )
  }
  return assetFromProbe(JSON.parse(stdout) as ProbeOutput, {
    id: createId('med'),
    path,
    size: info.size,
    now: new Date().toISOString(),
  })
}

export async function importPaths(paths: string[]) {
  const results = await Promise.allSettled(paths.map((p) => probeFile(p)))
  const assets: MediaAsset[] = []
  const errors: string[] = []
  results.forEach((r) => {
    if (r.status === 'fulfilled') assets.push(r.value)
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
  })
  return { assets, errors }
}

/** A poster frame as JPEG in the cache; returns the file name inside the cache's thumbs folder. */
export async function thumbnail(
  asset: Pick<MediaAsset, 'path' | 'kind' | 'duration'>,
): Promise<string | null> {
  if (asset.kind === 'audio') return null
  const dir = join(cacheDir(), 'thumbs')
  const name = `${await cacheKey(asset.path)}.jpg`
  const out = join(dir, name)
  if (existsSync(out)) return name
  await mkdir(dir, { recursive: true })
  const at = asset.kind === 'video' && asset.duration ? Math.min(asset.duration * 0.1, 3) : 0
  const tmp = `${out}.${process.pid}.tmp.jpg`
  await run(
    tool('ffmpeg'),
    [
      '-v',
      'error',
      '-y',
      '-ss',
      at.toFixed(3),
      '-i',
      asset.path,
      '-frames:v',
      '1',
      '-vf',
      'scale=320:-2:flags=bicubic',
      '-q:v',
      '4',
      tmp,
    ],
    { timeout: 60_000 },
  )
  await rename(tmp, out)
  return name
}

/** Peak levels (0 to 255) at WAVEFORM_RATE per second, cached on disk. */
export async function waveform(path: string): Promise<Uint8Array> {
  const dir = join(cacheDir(), 'waveforms')
  const out = join(dir, `${await cacheKey(path)}.peaks`)
  if (existsSync(out)) return new Uint8Array(await readFile(out))

  const sampleRate = 8000
  const perPeak = sampleRate / WAVEFORM_RATE
  const peaks: number[] = []
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(tool('ffmpeg'), [
      '-v',
      'error',
      '-i',
      path,
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      's16le',
      '-',
    ])
    let carry: Buffer = Buffer.alloc(0)
    let peak = 0
    let count = 0
    proc.stdout.on('data', (chunk: Buffer) => {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk
      const usable = buf.length - (buf.length % 2)
      for (let i = 0; i < usable; i += 2) {
        const v = Math.abs(buf.readInt16LE(i))
        if (v > peak) peak = v
        if (++count === perPeak) {
          peaks.push(Math.min(255, Math.round((peak / 32768) * 255)))
          peak = 0
          count = 0
        }
      }
      carry = buf.subarray(usable)
    })
    proc.on('error', reject)
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Couldn't read the audio in ${path}.`)),
    )
  })
  const data = Uint8Array.from(peaks)
  await mkdir(dir, { recursive: true })
  await writeFile(out, data)
  return data
}
