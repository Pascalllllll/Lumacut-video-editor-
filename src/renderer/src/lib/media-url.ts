import type { MediaAsset } from '@engine/model'
import { needsConversion } from '../../../media/colorspace'
import { useEditor } from '../state/editor'
import { useSettings } from '../state/settings'

export function mediaUrl(path: string): string {
  return `lumacut-media://file/${encodeURIComponent(path)}`
}

export function thumbUrl(name: string): string {
  return `lumacut-media://thumb/${name}`
}

export function proxyUrl(name: string): string {
  return `lumacut-media://proxy/${name}`
}

/** What the viewer plays for an item: its proxy when proxies are on and one exists. */
export function playbackUrl(asset: MediaAsset): string {
  if (useSettings.getState().settings.useProxies) {
    const proxy = useEditor.getState().proxies[asset.path]
    if (proxy) return proxyUrl(proxy)
  }
  return mediaUrl(asset.path)
}

/** Codecs Chromium decodes itself; anything else gets a proxy when automatic proxies are on. */
const PLAYABLE = new Set(['h264', 'vp8', 'vp9', 'av1', 'theora', 'mpeg4'])

export function needsProxy(asset: MediaAsset, rule: 'off' | 'unplayable' | 'large'): boolean {
  // A proxy would lose the transparency of a cutout.
  if (asset.kind !== 'video' || rule === 'off' || asset.alpha) return false
  // HDR and wide-gamut files also get one: the proxy is converted to Rec. 709 for the viewer.
  const unplayable =
    !PLAYABLE.has(asset.videoCodec ?? '') ||
    needsConversion(asset.color, { colorSpace: 'rec709', hdr: 'sdr' })
  if (rule === 'unplayable') return unplayable
  return unplayable || (asset.height ?? 0) > 1080
}
