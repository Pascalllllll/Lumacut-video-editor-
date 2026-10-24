import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { colorChain } from '../../src/media/colorspace'

const ffmpeg = join(
  'resources',
  'bin',
  `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
)

describe.skipIf(!existsSync(ffmpeg))('color chains run in FFmpeg', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumacut-color-'))
  const sdr = join(dir, 'sdr.mp4')
  const hdr = join(dir, 'hdr.mp4')
  const run = (args: string[]) =>
    execFileSync(ffmpeg, ['-v', 'error', '-y', ...args], { maxBuffer: 64 * 1024 * 1024 })
  run([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x180:d=0.2:r=10',
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'libx264',
    sdr,
  ])
  run([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x180:d=0.2:r=10',
    '-vf',
    'zscale=tin=bt709:pin=bt709:min=709:t=smpte2084:p=bt2020:m=bt2020nc:npl=203,format=yuv420p10le',
    '-c:v',
    'libx265',
    '-x265-params',
    'log-level=error',
    '-color_primaries',
    'bt2020',
    '-color_trc',
    'smpte2084',
    '-colorspace',
    'bt2020nc',
    hdr,
  ])
  const size = { width: 320, height: 180 }
  const frame = (file: string, filters: string[]) =>
    run(['-i', file, '-frames:v', '1', '-an', '-vf', filters.join(','), '-f', 'rawvideo', '-'])
  const sdrTags = {
    primaries: 'bt709',
    transfer: 'bt709',
    matrix: 'bt709',
    range: 'tv' as const,
    bitDepth: 8,
  }
  const hdrTags = {
    primaries: 'bt2020',
    transfer: 'smpte2084',
    matrix: 'bt2020nc',
    range: 'tv' as const,
    bitDepth: 10,
  }

  it('tone maps HDR to SDR RGBA', () => {
    expect(
      frame(hdr, colorChain(hdrTags, { colorSpace: 'rec709', hdr: 'sdr' }, size).filters).length,
    ).toBe(320 * 180 * 4)
  })
  it('lifts SDR into 16-bit PQ', () => {
    expect(
      frame(sdr, colorChain(sdrTags, { colorSpace: 'rec2020', hdr: 'pq' }, size).filters).length,
    ).toBe(320 * 180 * 8)
  })
  it('converts SDR to P3', () => {
    expect(
      frame(sdr, colorChain(sdrTags, { colorSpace: 'p3', hdr: 'sdr' }, size).filters).length,
    ).toBe(320 * 180 * 4)
  })
  it('passes HDR through into an HLG sequence', () => {
    expect(
      frame(hdr, colorChain(hdrTags, { colorSpace: 'rec2020', hdr: 'hlg' }, size).filters).length,
    ).toBe(320 * 180 * 8)
  })
})
