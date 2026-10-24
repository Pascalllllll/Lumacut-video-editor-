import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import type { SourceWord } from '@engine/captions'
import type { MediaAsset, Project } from '@engine/model'
import { buildMixAnalysisArgs, parseSilences } from '../media/export-plan'
import { writeImpulses } from '../media/impulses'
import type { WorkerReply, WorkerRequest } from './ai-worker'
import { impulseDir } from './audio-service'
import { binaryPath } from './binaries'
import { MissingFfmpegError } from './media-service'
import { modelsDir, requireModel } from './models-service'
import { cacheDir } from './paths'

function ffmpeg(): string {
  const path = binaryPath('ffmpeg')
  if (!path) throw new MissingFfmpegError()
  return path
}

/** Runs FFmpeg to the end, collecting stdout as a buffer and the tail of stderr. */
function runFfmpeg(args: string[], stdin?: (proc: ChildProcess) => void) {
  return new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
    const proc = spawn(ffmpeg(), args, { stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let stderr = ''
    proc.stdout!.on('data', (c: Buffer) => chunks.push(c))
    proc.stderr!.setEncoding('utf8')
    proc.stderr!.on('data', (c: string) => (stderr = (stderr + c).slice(-200_000)))
    proc.on('error', reject)
    proc.on('close', (code) =>
      code === 0
        ? resolve({ stdout: Buffer.concat(chunks), stderr })
        : reject(
            new Error(`FFmpeg stopped with an error. ${stderr.trim().split('\n').pop() ?? ''}`),
          ),
    )
    stdin?.(proc)
  })
}

// ---------------------------------------------------------------- worker

let worker: UtilityProcess | null = null
let nextId = 1
const waiting = new Map<number, (reply: WorkerReply) => void>()

function ensureWorker(): UtilityProcess {
  if (worker) return worker
  const proc = utilityProcess.fork(join(app.getAppPath(), 'out', 'main', 'ai-worker.js'), [], {
    serviceName: 'Lumacut AI',
    stdio: 'ignore',
  })
  proc.on('message', (reply: WorkerReply) => {
    waiting.get(reply.id)?.(reply)
    waiting.delete(reply.id)
  })
  proc.on('exit', () => {
    worker = null
    for (const [id, done] of waiting) done({ id, ok: false, message: 'The AI process stopped.' })
    waiting.clear()
  })
  worker = proc
  return proc
}

type Payload = WorkerRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, 'id'>
    : never
  : never

function ask(request: Payload): Promise<Extract<WorkerReply, { ok: true }>> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, (reply) => (reply.ok ? resolve(reply) : reject(new Error(reply.message))))
    ensureWorker().postMessage({ ...request, id })
  })
}

export function stopAiWorker() {
  worker?.kill()
  worker = null
}

// ---------------------------------------------------------------- transcription

async function fileKey(path: string, extra: string) {
  const info = await stat(path)
  return createHash('sha1').update(`${path}\0${info.size}\0${info.mtimeMs}\0${extra}`).digest('hex')
}

/** Words spoken in a file, in seconds from its start. Results are cached per file, model and language. */
export async function transcribe(
  path: string,
  modelId: string,
  language: string | null,
): Promise<SourceWord[]> {
  const model = requireModel(modelId)
  const dir = join(cacheDir(), 'transcripts')
  const out = join(dir, `${await fileKey(path, `${modelId}\0${language ?? 'auto'}`)}.json`)
  if (existsSync(out)) return JSON.parse(await readFile(out, 'utf8')) as SourceWord[]
  const { stdout } = await runFfmpeg([
    '-v',
    'error',
    '-nostdin',
    '-i',
    path,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-f',
    'f32le',
    '-',
  ])
  if (stdout.byteLength < 16000 * 4 * 0.2) return []
  const audio = new Float32Array(
    stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength),
  )
  const reply = await ask({
    type: 'transcribe',
    modelsDir: modelsDir(),
    repo: model.repo,
    audio,
    language,
  })
  const words = reply.words ?? []
  await mkdir(dir, { recursive: true })
  await writeFile(out, JSON.stringify(words))
  return words
}

// ---------------------------------------------------------------- analysis

/** Quiet stretches of the sequence's mix, in seconds. */
export async function findSilences(
  project: Project,
  sequenceId: string,
  thresholdDb: number,
  minSeconds: number,
): Promise<[number, number][]> {
  const seq = project.sequences[sequenceId]
  if (!seq) throw new Error('The sequence no longer exists.')
  const plan = buildMixAnalysisArgs(
    project,
    seq,
    impulseDir(),
    `silencedetect=noise=${thresholdDb}dB:d=${minSeconds}`,
  )
  await writeImpulses(plan.impulses)
  const { stderr } = await runFfmpeg(plan.args)
  return parseSilences(stderr, plan.durationSeconds)
}

/** Cuts in a stretch of a file, in seconds from `start`. */
export async function findScenes(
  path: string,
  start: number,
  duration: number,
  threshold: number,
): Promise<number[]> {
  const { stderr } = await runFfmpeg([
    '-hide_banner',
    '-nostdin',
    '-ss',
    start.toFixed(6),
    '-t',
    duration.toFixed(6),
    '-i',
    path,
    '-an',
    '-vf',
    `scale=320:-2,scdet=threshold=${threshold}`,
    '-f',
    'null',
    '-',
  ])
  return [...stderr.matchAll(/lavfi\.scd\.time: ([\d.]+)/g)].map((m) => Number(m[1]))
}

/** One frame of a file as a JPEG at most 512 pixels wide, base64. */
export async function frameJpeg(path: string, seconds: number): Promise<string> {
  const { stdout } = await runFfmpeg([
    '-v',
    'error',
    '-nostdin',
    '-ss',
    Math.max(0, seconds).toFixed(3),
    '-i',
    path,
    '-frames:v',
    '1',
    '-vf',
    "scale='min(512,iw)':-2",
    '-q:v',
    '4',
    '-f',
    'image2',
    '-c:v',
    'mjpeg',
    '-',
  ])
  return stdout.toString('base64')
}

// ---------------------------------------------------------------- derived media

/** Where processed copies go: next to the project, or the app data folder for an unsaved one. */
function derivedDir(projectPath: string | null) {
  return projectPath
    ? join(dirname(projectPath), 'Processed')
    : join(app.getPath('userData'), 'processed')
}

async function freePath(dir: string, name: string, ext: string) {
  await mkdir(dir, { recursive: true })
  let path = join(dir, `${name}${ext}`)
  for (let n = 2; existsSync(path); n++) path = join(dir, `${name} ${n}${ext}`)
  return path
}

const stem = (path: string) => basename(path, extname(path))

/** A copy of the file's sound with background noise taken out by the RNNoise speech model. */
export async function cleanVoice(asset: MediaAsset, projectPath: string | null): Promise<string> {
  const model = requireModel('rnnoise-speech')
  const weights = join(modelsDir(), model.files[0]!.path).replace(/\\/g, '/').replace(/'/g, "\\'")
  const out = await freePath(derivedDir(projectPath), `${stem(asset.path)} (voice cleaned)`, '.wav')
  const tmp = `${out}.part.wav`
  await runFfmpeg([
    '-v',
    'error',
    '-nostdin',
    '-y',
    '-i',
    asset.path,
    '-vn',
    '-af',
    `arnndn=m='${weights}'`,
    '-c:a',
    'pcm_s16le',
    tmp,
  ])
  await rename(tmp, out)
  return out
}

/**
 * A copy of a video with the background made transparent: each frame goes to
 * the matting model at a reduced size, and the matte is scaled back up and
 * merged as the alpha plane of a VP9 WebM.
 */
export async function removeBackground(
  asset: MediaAsset,
  projectPath: string | null,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const model = requireModel('modnet')
  if (!asset.width || !asset.height || !asset.fps || !asset.duration)
    throw new Error('Background removal works on video files.')
  const fps = asset.fps.num / asset.fps.den
  const total = Math.max(1, Math.round(asset.duration * fps))
  // The model's input: shortest edge 512, both sides a multiple of 32.
  const scale = 512 / Math.min(asset.width, asset.height)
  const w = Math.max(32, Math.round((asset.width * scale) / 32) * 32)
  const h = Math.max(32, Math.round((asset.height * scale) / 32) * 32)
  const out = await freePath(derivedDir(projectPath), `${stem(asset.path)} (cutout)`, '.webm')
  const tmp = `${out}.part.webm`

  const encoder = spawn(
    ffmpeg(),
    [
      '-v',
      'error',
      '-nostdin',
      '-y',
      '-i',
      asset.path,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      '-s',
      `${w}x${h}`,
      '-framerate',
      `${asset.fps.num}/${asset.fps.den}`,
      '-i',
      'pipe:0',
      '-filter_complex',
      `[0:v]setpts=PTS-STARTPTS,format=yuv420p[v];[1:v]setpts=PTS-STARTPTS,scale=${asset.width}:${asset.height}:flags=bicubic[a];[v][a]alphamerge,format=yuva420p[o]`,
      '-map',
      '[o]',
      '-an',
      '-c:v',
      'libvpx-vp9',
      '-pix_fmt',
      'yuva420p',
      '-b:v',
      '0',
      '-crf',
      '28',
      '-deadline',
      'realtime',
      '-cpu-used',
      '6',
      '-row-mt',
      '1',
      tmp,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  )
  let encErr = ''
  encoder.stderr.setEncoding('utf8')
  encoder.stderr.on('data', (c: string) => (encErr = (encErr + c).slice(-4000)))
  encoder.stdin.on('error', () => undefined)
  const encoded = new Promise<void>((resolve, reject) => {
    encoder.on('error', reject)
    encoder.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Couldn't write the cutout. ${encErr.trim().split('\n').pop() ?? ''}`)),
    )
  })

  const decoder = spawn(
    ffmpeg(),
    [
      '-v',
      'error',
      '-nostdin',
      '-i',
      asset.path,
      '-an',
      '-vf',
      `scale=${w}:${h}:flags=area,format=rgb24`,
      '-f',
      'rawvideo',
      '-',
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  const size = w * h * 3
  let carry: Buffer = Buffer.alloc(0)
  let done = 0
  try {
    for await (const chunk of decoder.stdout as AsyncIterable<Buffer>) {
      carry = carry.length ? Buffer.concat([carry, chunk]) : chunk
      while (carry.length >= size) {
        const rgb = new Uint8Array(carry.subarray(0, size))
        carry = carry.subarray(size)
        const reply = await ask({
          type: 'matte',
          modelsDir: modelsDir(),
          repo: model.repo,
          rgb,
          width: w,
          height: h,
        })
        if (!encoder.stdin.write(Buffer.from(reply.alpha!)))
          await new Promise<void>((r) => encoder.stdin.once('drain', () => r()))
        done++
        if (done % 5 === 0) onProgress(Math.min(0.99, done / total))
      }
    }
    encoder.stdin.end()
    await encoded
    await rename(tmp, out)
  } catch (error) {
    decoder.kill()
    encoder.kill()
    await rm(tmp, { force: true })
    throw error
  }
  onProgress(1)
  return out
}
