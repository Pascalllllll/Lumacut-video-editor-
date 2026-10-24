import { existsSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { reverbImpulse } from '../audio/dsp'
import type { ImpulseFile } from './export-plan'

/** A 32-bit float stereo WAV file. */
export function wavFile(left: Float32Array, right: Float32Array, sampleRate: number): Buffer {
  const frames = left.length
  const data = frames * 2 * 4
  const buf = Buffer.alloc(44 + data)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + data, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(3, 20) // IEEE float
  buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 8, 28)
  buf.writeUInt16LE(8, 32)
  buf.writeUInt16LE(32, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(data, 40)
  for (let i = 0; i < frames; i++) {
    buf.writeFloatLE(left[i]!, 44 + i * 8)
    buf.writeFloatLE(right[i]!, 48 + i * 8)
  }
  return buf
}

/** Writes the reverb impulses an export graph reads, if they aren't on disk yet. */
export async function writeImpulses(impulses: ImpulseFile[]) {
  for (const ir of impulses) {
    if (existsSync(ir.path)) continue
    await mkdir(dirname(ir.path), { recursive: true })
    const [l, r] = reverbImpulse(ir.decay, ir.predelay, ir.sampleRate)
    const tmp = `${ir.path}.${process.pid}.tmp`
    await writeFile(tmp, wavFile(l, r, ir.sampleRate))
    await rename(tmp, ir.path)
  }
}
