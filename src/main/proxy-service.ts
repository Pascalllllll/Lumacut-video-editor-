import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { binaryPath } from './binaries'
import { MissingFfmpegError } from './media-service'
import { cacheDir } from './paths'
import type { MediaAsset } from '@engine/model'
import { colorChain } from '../media/colorspace'

export type ProxyUpdate =
  | { path: string; state: 'queued' }
  | { path: string; state: 'running'; progress: number }
  | { path: string; state: 'done'; proxy: string }
  | { path: string; state: 'failed'; message: string }

/** Proxies are 720p H.264 with a keyframe every half second, so the viewer can seek quickly. */
const ENCODE_ARGS = [
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '26',
  '-g',
  '15',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  '-movflags',
  '+faststart',
]

export function proxyDir() {
  return join(cacheDir(), 'proxies')
}

export async function proxyName(path: string): Promise<string> {
  const info = await stat(path)
  return `${createHash('sha1').update(`${path}\0${info.size}\0${info.mtimeMs}`).digest('hex')}.mp4`
}

export async function proxyStatus(paths: string[]): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {}
  await Promise.all(
    paths.map(async (p) => {
      try {
        const name = await proxyName(p)
        result[p] = existsSync(join(proxyDir(), name)) ? name : null
      } catch {
        result[p] = null
      }
    }),
  )
  return result
}

export type ProxyItem = {
  path: string
  duration: number
  color: MediaAsset['color']
  width: number
  height: number
}

/**
 * The picture filter for a proxy: scaled to 720 lines, and converted to
 * Rec. 709 SDR when the file is HDR or wide gamut, so the viewer shows it right.
 */
export function proxyFilter(item: ProxyItem): string {
  const h = Math.min(720, item.height || 720)
  const w = Math.max(2, Math.round(((item.width || 1280) * h) / (item.height || 720) / 2) * 2)
  const chain = colorChain(
    item.color,
    { colorSpace: 'rec709', hdr: 'sdr' },
    { width: w, height: h },
  )
  if (chain.filters.length)
    return [...chain.filters, 'scale=out_color_matrix=bt709:out_range=tv', 'format=yuv420p'].join(
      ',',
    )
  return `scale=-2:'min(720,ih)':flags=bicubic`
}

const queue: ProxyItem[] = []
const pending = new Set<string>()
let running = false

export function queueProxies(items: ProxyItem[], notify: (u: ProxyUpdate) => void) {
  for (const item of items) {
    if (pending.has(item.path)) continue
    pending.add(item.path)
    queue.push(item)
    notify({ path: item.path, state: 'queued' })
  }
  void pump(notify)
}

async function pump(notify: (u: ProxyUpdate) => void) {
  if (running) return
  running = true
  try {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        const name = await makeProxy(item, (progress) =>
          notify({ path: item.path, state: 'running', progress }),
        )
        notify({ path: item.path, state: 'done', proxy: name })
      } catch (error) {
        notify({
          path: item.path,
          state: 'failed',
          message: error instanceof Error ? error.message : String(error),
        })
      } finally {
        pending.delete(item.path)
      }
    }
  } finally {
    running = false
  }
}

async function makeProxy(item: ProxyItem, onProgress: (p: number) => void): Promise<string> {
  const { path, duration } = item
  const ffmpeg = binaryPath('ffmpeg')
  if (!ffmpeg) throw new MissingFfmpegError()
  const name = await proxyName(path)
  const dir = proxyDir()
  const out = join(dir, name)
  if (existsSync(out)) return name
  await mkdir(dir, { recursive: true })
  const tmp = `${out}.${process.pid}.part.mp4`
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      ffmpeg,
      [
        '-v',
        'error',
        '-y',
        '-i',
        path,
        '-vf',
        proxyFilter(item),
        ...ENCODE_ARGS,
        '-progress',
        'pipe:1',
        '-nostats',
        tmp,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let tail = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      const m = /out_time_us=(\d+)/.exec(chunk)
      if (m && duration > 0) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration))
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (c: string) => (tail = (tail + c).slice(-2000)))
    proc.on('error', reject)
    proc.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Couldn't make a proxy. ${tail.trim().split('\n').pop() ?? ''}`.trim())),
    )
  }).catch(async (error: unknown) => {
    await rm(tmp, { force: true })
    throw error
  })
  await rename(tmp, out)
  return name
}
