import type { AudioEffect } from '@engine/model'
import { createProcessor, type Processor } from '../../../audio/dsp'
import { LoudnessMeter } from '../../../audio/loudness'

/*
 * Runs on the audio thread. Two processors: `lumacut-chain` applies a list of
 * effects with the same code export is tested against, and `lumacut-meter`
 * reports peaks (and, on the master, loudness) about twenty times a second.
 */

declare const sampleRate: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}
type Options = { processorOptions?: Record<string, unknown> }

class ChainProcessor extends AudioWorkletProcessor {
  private processors: Processor[] = []

  constructor(options: Options) {
    super()
    this.set((options.processorOptions?.['effects'] as AudioEffect[] | undefined) ?? [])
    this.port.onmessage = (e: MessageEvent<AudioEffect[]>) => this.set(e.data)
  }

  private set(effects: AudioEffect[]) {
    this.processors = effects
      .filter((fx) => fx.enabled)
      .map((fx) => createProcessor(fx, sampleRate))
      .filter((p): p is Processor => p !== null)
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]
    const output = outputs[0]
    if (!output || output.length < 2) return true
    const left = output[0]!
    const right = output[1]!
    if (!input || input.length === 0) {
      left.fill(0)
      right.fill(0)
      return true
    }
    left.set(input[0]!)
    right.set(input[1] ?? input[0]!)
    for (const p of this.processors) p.process(left, right, left.length)
    return true
  }
}

const REPORT_EVERY = 2048

class MeterProcessor extends AudioWorkletProcessor {
  private peakL = 0
  private peakR = 0
  private count = 0
  private readonly loudness: LoudnessMeter | null

  constructor(options: Options) {
    super()
    this.loudness = options.processorOptions?.['loudness'] ? new LoudnessMeter(sampleRate) : null
    this.port.onmessage = (e: MessageEvent<string>) => {
      if (e.data === 'reset') this.loudness?.reset()
    }
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]
    const left = input?.[0]
    if (left) {
      const right = input[1] ?? left
      for (let i = 0; i < left.length; i++) {
        const l = Math.abs(left[i]!)
        const r = Math.abs(right[i]!)
        if (l > this.peakL) this.peakL = l
        if (r > this.peakR) this.peakR = r
      }
      this.loudness?.push(left, right, left.length)
    }
    // With nothing playing there is no input; keep reporting so meters fall back.
    this.count += left?.length ?? 128
    if (this.count >= REPORT_EVERY) {
      this.port.postMessage({
        left: this.peakL,
        right: this.peakR,
        loudness: this.loudness?.read() ?? null,
      })
      this.peakL = 0
      this.peakR = 0
      this.count = 0
    }
    return true
  }
}

registerProcessor('lumacut-chain', ChainProcessor)
registerProcessor('lumacut-meter', MeterProcessor)
