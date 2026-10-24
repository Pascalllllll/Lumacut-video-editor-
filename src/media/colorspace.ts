import type { MediaAsset, Sequence } from '@engine/model'

export type ColorTarget = Pick<Sequence, 'colorSpace' | 'hdr'>

const PRIMARIES: Record<Sequence['colorSpace'], string> = {
  rec709: 'bt709',
  p3: 'smpte432',
  rec2020: 'bt2020',
}
const HDR_TRANSFER = { pq: 'smpte2084', hlg: 'arib-std-b67' } as const

/** ffprobe names that zscale knows under another name. */
function normPrimaries(p: string | null | undefined): string {
  if (!p) return 'bt709'
  if (p === 'smpte170m' || p === 'bt470bg') return '170m'
  if (p === 'smpte432') return 'smpte432'
  return p
}

function normTransfer(t: string | null | undefined): string {
  if (!t) return 'bt709'
  if (t === 'smpte170m' || t === 'bt470bg' || t === 'bt470m') return '601'
  if (t === 'iec61966-2-1') return 'iec61966-2-1'
  return t
}

export function isHdrTransfer(t: string | null | undefined) {
  return t === 'smpte2084' || t === 'arib-std-b67'
}

/** Whether a file's picture needs converting to show correctly in the target space. */
export function needsConversion(color: MediaAsset['color'], target: ColorTarget): boolean {
  const prim = normPrimaries(color?.primaries)
  const sourceHdr = isHdrTransfer(color?.transfer)
  if (target.hdr !== 'sdr') return true
  if (sourceHdr) return true
  const want = PRIMARIES[target.colorSpace]
  return !(prim === want || (want === 'bt709' && (prim === 'bt709' || prim === '170m')))
}

/**
 * zscale filters that take a picture from its own color encoding to the
 * sequence's, ending in RGBA. HDR into SDR is tone mapped (Hable, which keeps
 * highlights soft); SDR into HDR places SDR white at 203 nits (ITU-R BT.2408).
 * Returns no filters when nothing needs converting; `deep` says the output
 * is 16 bits per channel (HDR sequences).
 */
export function colorChain(
  color: MediaAsset['color'],
  target: ColorTarget,
  size: { width: number; height: number },
): { filters: string[]; deep: boolean } {
  const deep = target.hdr !== 'sdr'
  if (!needsConversion(color, target)) return { filters: [], deep }
  const pin = normPrimaries(color?.primaries)
  const tin = normTransfer(color?.transfer)
  const min =
    color?.matrix && color.matrix !== 'unknown' ? color.matrix : size.height >= 720 ? '709' : '170m'
  const rin = color?.range === 'pc' ? 'full' : 'limited'
  // Input primaries go on the stage that changes primaries; zscale finds no path otherwise.
  const inTags = `tin=${tin}:min=${min}:rin=${rin}`
  const sourceHdr = isHdrTransfer(color?.transfer)
  const scale = `w=${size.width}:h=${size.height}:filter=bicubic`

  if (target.hdr !== 'sdr') {
    const t = HDR_TRANSFER[target.hdr]
    // HDR output always uses Rec. 2020; SDR material is placed at reference white.
    const npl = sourceHdr ? '' : ':npl=203'
    return {
      filters: [
        `zscale=${scale}:${inTags}:t=linear${npl}`,
        'format=gbrpf32le',
        `zscale=pin=${pin}:p=bt2020:t=${t}:m=bt2020nc:r=full`,
        'format=rgba64le',
      ],
      deep,
    }
  }
  const p = PRIMARIES[target.colorSpace]
  if (sourceHdr) {
    return {
      filters: [
        `zscale=${scale}:${inTags}:t=linear:npl=100`,
        'format=gbrpf32le',
        `zscale=pin=${pin}:p=${p}`,
        'tonemap=tonemap=hable:desat=0',
        `zscale=t=bt709:m=bt709:r=full`,
        'format=rgba',
      ],
      deep,
    }
  }
  return {
    filters: [`zscale=${scale}:${inTags}:pin=${pin}:p=${p}:t=bt709:m=bt709:r=full`, 'format=rgba'],
    deep,
  }
}

/** Encoder tags and pixel format for a sequence's color space. */
export function encodeColor(target: ColorTarget): {
  args: string[]
  inputPixFmt: 'rgba' | 'rgba64le'
  filter: string
  codec: string[]
} {
  if (target.hdr !== 'sdr') {
    const trc = HDR_TRANSFER[target.hdr]
    return {
      inputPixFmt: 'rgba64le',
      filter: 'scale=out_color_matrix=bt2020:out_range=tv,format=yuv420p10le',
      codec: [
        '-c:v',
        'libx265',
        '-x265-params',
        `colorprim=bt2020:transfer=${trc}:colormatrix=bt2020nc:range=limited${target.hdr === 'pq' ? ':hdr10=1' : ''}`,
        '-tag:v',
        'hvc1',
      ],
      args: [
        '-color_primaries',
        'bt2020',
        '-color_trc',
        trc,
        '-colorspace',
        'bt2020nc',
        '-color_range',
        'tv',
      ],
    }
  }
  const prim = PRIMARIES[target.colorSpace]
  const matrix = target.colorSpace === 'rec2020' ? 'bt2020nc' : 'bt709'
  return {
    inputPixFmt: 'rgba',
    filter: `scale=out_color_matrix=${target.colorSpace === 'rec2020' ? 'bt2020' : 'bt709'}:out_range=tv,format=yuv420p`,
    codec: ['-c:v', 'libx264'],
    args: [
      '-color_primaries',
      prim,
      '-color_trc',
      'bt709',
      '-colorspace',
      matrix,
      '-color_range',
      'tv',
    ],
  }
}
