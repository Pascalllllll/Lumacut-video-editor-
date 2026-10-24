import { describe, expect, it } from 'vitest'
import { colorChain, encodeColor, needsConversion } from '../../src/media/colorspace'

const sdr709 = {
  primaries: 'bt709',
  transfer: 'bt709',
  matrix: 'bt709',
  range: 'tv' as const,
  bitDepth: 8,
}
const hdr10 = {
  primaries: 'bt2020',
  transfer: 'smpte2084',
  matrix: 'bt2020nc',
  range: 'tv' as const,
  bitDepth: 10,
}
const size = { width: 1920, height: 1080 }

describe('color conversion', () => {
  it('leaves Rec. 709 footage alone in a Rec. 709 sequence', () => {
    expect(needsConversion(sdr709, { colorSpace: 'rec709', hdr: 'sdr' })).toBe(false)
    expect(needsConversion(null, { colorSpace: 'rec709', hdr: 'sdr' })).toBe(false)
    expect(colorChain(sdr709, { colorSpace: 'rec709', hdr: 'sdr' }, size).filters).toEqual([])
  })
  it('tone maps HDR footage into an SDR sequence', () => {
    const chain = colorChain(hdr10, { colorSpace: 'rec709', hdr: 'sdr' }, size)
    expect(chain.filters.join(',')).toMatch(/tin=smpte2084.*tonemap=hable.*format=rgba$/)
    expect(chain.deep).toBe(false)
  })
  it('lifts SDR footage into a PQ sequence at reference white', () => {
    const chain = colorChain(sdr709, { colorSpace: 'rec2020', hdr: 'pq' }, size)
    expect(chain.filters.join(',')).toMatch(/npl=203.*p=bt2020:t=smpte2084.*rgba64le/)
    expect(chain.deep).toBe(true)
  })
  it('converts gamut for a P3 sequence', () => {
    expect(colorChain(sdr709, { colorSpace: 'p3', hdr: 'sdr' }, size).filters[0]).toMatch(
      /p=smpte432/,
    )
  })
  it('encodes HDR as 10-bit HEVC with HDR tags', () => {
    const e = encodeColor({ colorSpace: 'rec2020', hdr: 'hlg' })
    expect(e.codec).toContain('libx265')
    expect(e.args).toContain('arib-std-b67')
    expect(e.filter).toMatch(/yuv420p10le/)
  })
})
