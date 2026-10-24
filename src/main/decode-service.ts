import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { binaryPath } from './binaries'
import { MissingFfmpegError } from './media-service'
import type { MediaAsset } from '@engine/model'
import { colorChain, type ColorTarget } from '../media/colorspace'

/**
 * Raw frame streams for the export renderer. A request names a file, a start
 * time and an output size; FFmpeg decodes from there at a constant frame rate
 * and writes RGBA frames, top row first, which the renderer reads through
 * `lumacut-media://decode/<token>`.
 */
export type DecodeRequest = {
  path: string
  /** Seconds into the file. */
  start: number
  /** Seconds to decode; reversed streams decode this range and play it backwards. */
  duration: number
  /** Frames per second of source time in the stream. */
  fps: number
  width: number
  height: number
  reverse: boolean
  /** Slow-motion smoothing, made by FFmpeg at `fps`. */
  interpolation: 'none' | 'blend' | 'optical-flow'
  /** One frame only (images and hold frames). */
  still: boolean
  /** The source's own height, to pick its color matrix. */
  sourceHeight: number
  /** VP9 with an alpha plane. */
  alpha?: boolean
  /** The file's color tags and the sequence's color space, for conversion. */
  color: MediaAsset['color']
  target: ColorTarget
}

const pending = new Map<string, DecodeRequest>()
const running = new Set<ChildProcess>()

export function registerDecode(request: DecodeRequest): string {
  const token = randomUUID()
  pending.set(token, request)
  return token
}

/** Untagged HD video is assumed to be Rec. 709, standard definition Rec. 601. */
function matrixFor(height: number) {
  return height >= 720 ? 'bt709' : 'bt601'
}

export function decodeArgs(r: DecodeRequest): string[] {
  const filters: string[] = []
  if (r.reverse) filters.push('reverse')
  if (r.interpolation === 'blend') filters.push(`minterpolate=fps=${r.fps}:mi_mode=blend`)
  else if (r.interpolation === 'optical-flow')
    filters.push(`minterpolate=fps=${r.fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`)
  else if (!r.still) filters.push(`fps=${r.fps}`)
  const chain = colorChain(r.color, r.target, { width: r.width, height: r.height })
  const scale = `scale=${r.width}:${r.height}:flags=bicubic:in_color_matrix=${matrixFor(r.sourceHeight)}:in_range=auto:out_range=full`
  if (chain.filters.length) filters.push(...chain.filters)
  else filters.push(scale, chain.deep ? 'format=rgba64le' : 'format=rgba')
  const seek = r.start > 0 ? ['-ss', r.start.toFixed(6)] : []
  // FFmpeg's own VP9 decoder drops the alpha plane; libvpx keeps it.
  const decoder = r.alpha ? ['-c:v', 'libvpx-vp9'] : []
  const input = r.still
    ? [...seek, ...decoder, '-i', r.path]
    : [...seek, '-t', Math.max(r.duration, 0.04).toFixed(6), ...decoder, '-i', r.path]
  return [
    '-v',
    'error',
    '-nostdin',
    ...input,
    '-an',
    '-vf',
    filters.join(','),
    ...(r.still ? ['-frames:v', '1'] : []),
    '-f',
    'rawvideo',
    'pipe:1',
  ]
}

/** Starts the decoder for a token and returns its byte stream, or null for an unknown token. */
export function openDecode(token: string): Response | null {
  const request = pending.get(token)
  if (!request) return null
  pending.delete(token)
  const ffmpeg = binaryPath('ffmpeg')
  if (!ffmpeg) throw new MissingFfmpegError()
  const proc = spawn(ffmpeg, decodeArgs(request), { stdio: ['ignore', 'pipe', 'pipe'] })
  running.add(proc)
  proc.on('close', () => running.delete(proc))
  proc.stderr.resume()
  const reader = (Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>).getReader()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    // If the reader stops early, the decoder is no longer needed.
    cancel() {
      proc.kill('SIGKILL')
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/octet-stream', 'Access-Control-Allow-Origin': '*' },
  })
}

export function stopAllDecoders() {
  for (const proc of running) proc.kill('SIGKILL')
  running.clear()
  pending.clear()
}
