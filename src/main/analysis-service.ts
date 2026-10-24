import { spawn } from 'node:child_process'
import {
  frameMotion,
  stabilizeCorrections,
  trackPoint,
  type Gray,
  type Motion,
} from '../media/track'
import { binaryPath } from './binaries'
import { MissingFfmpegError } from './media-service'
import type { MediaAsset } from '@engine/model'
import { frameStats, type FrameStats } from '@engine/color'
import { colorChain } from '../media/colorspace'

/** Analysis runs on small grayscale frames; this is their width. */
const ANALYSIS_WIDTH = 480

type Range = {
  path: string
  start: number
  duration: number
  fps: number
  sourceWidth: number
  sourceHeight: number
}

async function grayFrames(r: Range): Promise<Gray[]> {
  const ffmpeg = binaryPath('ffmpeg')
  if (!ffmpeg) throw new MissingFfmpegError()
  const width = Math.min(ANALYSIS_WIDTH, r.sourceWidth - (r.sourceWidth % 2)) || ANALYSIS_WIDTH
  const height = Math.max(
    2,
    Math.round((width * r.sourceHeight) / Math.max(1, r.sourceWidth) / 2) * 2,
  )
  const size = width * height
  const frames: Gray[] = []
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpeg, [
      '-v',
      'error',
      '-nostdin',
      '-ss',
      r.start.toFixed(6),
      '-t',
      r.duration.toFixed(6),
      '-i',
      r.path,
      '-an',
      '-vf',
      `fps=${r.fps},scale=${width}:${height}:flags=area,format=gray`,
      '-f',
      'rawvideo',
      'pipe:1',
    ])
    let carry: Buffer = Buffer.alloc(0)
    proc.stdout.on('data', (chunk: Buffer) => {
      carry = carry.length ? Buffer.concat([carry, chunk]) : chunk
      while (carry.length >= size) {
        frames.push({ data: new Uint8Array(carry.subarray(0, size)), width, height })
        carry = carry.subarray(size)
      }
    })
    proc.on('error', reject)
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error("Couldn't read the clip's frames for analysis.")),
    )
  })
  return frames
}

const pause = () => new Promise<void>((r) => setImmediate(r))

/** Follows a point (given as 0..1 of the picture) and returns its position per frame, also as 0..1. */
export async function trackRegion(r: Range, point: { x: number; y: number }) {
  const frames = await grayFrames(r)
  if (frames.length === 0) throw new Error('There were no frames to track.')
  await pause()
  const { width, height } = frames[0]!
  const size = Math.max(15, Math.round(Math.min(width, height) * 0.08) | 1)
  const result = trackPoint(frames, point.x * width, point.y * height, size, Math.round(size * 0.9))
  return {
    points: result.flatMap((p) => [p.x / width, p.y / height]),
    lost: result.filter((p) => p.score < 0.5).length,
  }
}

/** Per-frame corrections that remove camera shake, as fractions of the picture and radians. */
export async function analyzeShake(r: Range, smoothness: number) {
  const frames = await grayFrames(r)
  if (frames.length < 2) throw new Error('The clip is too short to stabilize.')
  const motions: Motion[] = []
  for (let i = 1; i < frames.length; i++) {
    motions.push(frameMotion(frames[i - 1]!, frames[i]!))
    if (i % 10 === 0) await pause()
  }
  const window = 3 + smoothness * r.fps * 2
  const corrections = stabilizeCorrections(motions, window)
  const { width, height } = frames[0]!
  const out: number[] = []
  for (let i = 0; i < corrections.length; i += 3)
    out.push(corrections[i]! / width, corrections[i + 1]! / height, corrections[i + 2]!)
  return { corrections: out }
}

/** Average color, spread and brightness range of one frame, for the automatic grading tools. */
export async function frameStatsAt(
  path: string,
  time: number,
  color: MediaAsset['color'],
  width: number,
  height: number,
): Promise<FrameStats> {
  const ffmpeg = binaryPath('ffmpeg')
  if (!ffmpeg) throw new MissingFfmpegError()
  const w = 320
  const h = Math.max(2, Math.round((w * height) / Math.max(1, width) / 2) * 2)
  const chain = colorChain(color, { colorSpace: 'rec709', hdr: 'sdr' }, { width: w, height: h })
  const filters = chain.filters.length
    ? [...chain.filters, 'format=rgb24']
    : [`scale=${w}:${h}:flags=area`, 'format=rgb24']
  const rgb = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const proc = spawn(ffmpeg, [
      '-v',
      'error',
      '-nostdin',
      '-ss',
      Math.max(0, time).toFixed(6),
      '-i',
      path,
      '-frames:v',
      '1',
      '-an',
      '-vf',
      filters.join(','),
      '-f',
      'rawvideo',
      'pipe:1',
    ])
    proc.stdout.on('data', (c: Buffer) => chunks.push(c))
    proc.on('error', reject)
    proc.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error("Couldn't read a frame to measure.")),
    )
  })
  if (rgb.length < 3) throw new Error("Couldn't read a frame to measure.")
  return frameStats(new Uint8Array(rgb))
}
