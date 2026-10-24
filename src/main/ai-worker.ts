/*
 * Runs in an Electron utility process so model inference never blocks the
 * app. It only reads models from the local models folder; remote loading is
 * switched off, so it works with no network at all.
 */
import type { AutomaticSpeechRecognitionPipeline, PreTrainedModel } from '@huggingface/transformers'

export type WorkerRequest =
  | {
      id: number
      type: 'transcribe'
      modelsDir: string
      repo: string
      /** 16 kHz mono samples. */
      audio: Float32Array
      language: string | null
    }
  | {
      id: number
      type: 'matte'
      modelsDir: string
      repo: string
      /** RGB frame at the model's input size. */
      rgb: Uint8Array
      width: number
      height: number
    }

export type WorkerWord = { text: string; start: number; end: number }
export type WorkerReply =
  | { id: number; ok: true; words?: WorkerWord[]; language?: string; alpha?: Uint8Array }
  | { id: number; ok: false; message: string }

type Port = {
  on(event: 'message', fn: (e: { data: WorkerRequest }) => void): void
  postMessage(message: WorkerReply): void
}
const port = (process as unknown as { parentPort: Port }).parentPort

let transformers: typeof import('@huggingface/transformers') | null = null
async function lib(modelsDir: string) {
  transformers ??= await import('@huggingface/transformers')
  transformers.env.allowRemoteModels = false
  transformers.env.allowLocalModels = true
  transformers.env.localModelPath = modelsDir.endsWith('/') ? modelsDir : `${modelsDir}/`
  return transformers
}

const asr = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>()
const mattes = new Map<string, Promise<PreTrainedModel>>()

async function transcribe(req: Extract<WorkerRequest, { type: 'transcribe' }>) {
  const t = await lib(req.modelsDir)
  let pipe = asr.get(req.repo)
  if (!pipe) {
    pipe = t.pipeline('automatic-speech-recognition', req.repo, {
      dtype: 'q8',
      device: 'cpu',
    }) as Promise<AutomaticSpeechRecognitionPipeline>
    asr.set(req.repo, pipe)
  }
  const out = await (
    await pipe
  )(req.audio, {
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
    ...(req.language ? { language: req.language, task: 'transcribe' } : {}),
  })
  const result = Array.isArray(out) ? out[0]! : out
  const chunks = (result.chunks ?? []) as { text: string; timestamp: [number, number | null] }[]
  const words: WorkerWord[] = chunks
    .map((c) => ({
      text: c.text.trim(),
      start: c.timestamp[0],
      end: c.timestamp[1] ?? c.timestamp[0] + 0.3,
    }))
    .filter((w) => w.text.length > 0)
  return { words }
}

/**
 * The frame arrives already at the model's size (shortest edge 512, sides a
 * multiple of 32), so the input is built here directly: RawImage resizing
 * goes through sharp, which crashes inside Electron on Linux.
 */
async function matte(req: Extract<WorkerRequest, { type: 'matte' }>) {
  const t = await lib(req.modelsDir)
  let model = mattes.get(req.repo)
  if (!model) {
    model = t.AutoModel.from_pretrained(req.repo, { dtype: 'q8', device: 'cpu' })
    mattes.set(req.repo, model)
  }
  const { width: w, height: h, rgb } = req
  const plane = w * h
  const input = new Float32Array(plane * 3)
  for (let i = 0; i < plane; i++) {
    input[i] = rgb[i * 3]! / 127.5 - 1
    input[plane + i] = rgb[i * 3 + 1]! / 127.5 - 1
    input[plane * 2 + i] = rgb[i * 3 + 2]! / 127.5 - 1
  }
  const { output } = (await (
    await model
  )({
    input: new t.Tensor('float32', input, [1, 3, h, w]),
  })) as { output: { data: Float32Array } }
  const alpha = new Uint8Array(plane)
  for (let i = 0; i < plane; i++)
    alpha[i] = Math.round(Math.min(1, Math.max(0, output.data[i]!)) * 255)
  return { alpha }
}

port.on('message', ({ data }) => {
  const run = data.type === 'transcribe' ? transcribe(data) : matte(data)
  run.then(
    (result) => port.postMessage({ id: data.id, ok: true, ...result }),
    (error: unknown) =>
      port.postMessage({
        id: data.id,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }),
  )
})
