import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { NO_HARDWARE, type HardwareEncoders } from '../media/encode'
import { binaryPath } from './binaries'

const run = promisify(execFile)

const CANDIDATES: Record<'h264' | 'hevc' | 'av1', string[]> = {
  h264: ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox', 'h264_vaapi'],
  hevc: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'hevc_videotoolbox', 'hevc_vaapi'],
  av1: ['av1_nvenc', 'av1_qsv', 'av1_amf', 'av1_vaapi'],
}

const VAAPI_DEVICE = '/dev/dri/renderD128'

let detected: Promise<HardwareEncoders> | null = null

/**
 * Finds the hardware encoders that work on this machine. Being listed by
 * FFmpeg isn't enough (the driver or GPU may be missing), so each one encodes
 * a few frames first; the first that succeeds per codec is used. Runs once.
 */
export function detectHardware(): Promise<HardwareEncoders> {
  detected ??= probe().catch(() => NO_HARDWARE)
  return detected
}

async function probe(): Promise<HardwareEncoders> {
  const ffmpeg = binaryPath('ffmpeg')
  if (!ffmpeg || process.env['LUMACUT_NO_HW']) return NO_HARDWARE
  const { stdout } = await run(ffmpeg, ['-hide_banner', '-encoders'], { timeout: 10_000 })
  const listed = new Set(stdout.split('\n').map((l) => l.trim().split(/\s+/)[1]))
  const works = async (name: string) => {
    const vaapi = name.endsWith('_vaapi')
    if (vaapi && !existsSync(VAAPI_DEVICE)) return false
    try {
      await run(
        ffmpeg,
        [
          '-v',
          'error',
          '-nostdin',
          ...(vaapi ? ['-vaapi_device', VAAPI_DEVICE] : []),
          '-f',
          'lavfi',
          '-i',
          'testsrc2=s=320x240:r=25:d=0.2',
          ...(vaapi
            ? ['-vf', 'format=nv12,hwupload']
            : ['-pix_fmt', name.endsWith('_qsv') ? 'nv12' : 'yuv420p']),
          '-frames:v',
          '3',
          '-c:v',
          name,
          '-f',
          'null',
          '-',
        ],
        { timeout: 8_000 },
      )
      return true
    } catch {
      return false
    }
  }
  const result: HardwareEncoders = { ...NO_HARDWARE }
  for (const codec of ['h264', 'hevc', 'av1'] as const) {
    for (const name of CANDIDATES[codec]) {
      if (!listed.has(name)) continue
      if (await works(name)) {
        result[codec] = name
        if (name.endsWith('_vaapi')) result.vaapiDevice = VAAPI_DEVICE
        break
      }
    }
  }
  return result
}
