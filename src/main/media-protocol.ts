import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { cacheDir } from './paths'
import { proxyDir } from './proxy-service'
import { openDecode } from './decode-service'

export const MEDIA_SCHEME = 'lumacut-media'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
}

/** Only files the user imported or opened can be read through the protocol. */
const allowed = new Set<string>()

export function allowMediaPaths(paths: Iterable<string>) {
  for (const p of paths) allowed.add(normalize(p))
}

export function isAllowedMedia(path: string): boolean {
  return allowed.has(normalize(path))
}

export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ])
}

/** Media is only ever data: never sniffed as something else, and never a page that runs code. */
const SAFE = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
}

async function serveFile(path: string, request: Request): Promise<Response> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return new Response('Not found', { status: 404 })
  }
  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        // The compositor draws these pictures with WebGL, which needs them marked as shareable.
        'Access-Control-Allow-Origin': '*',
        ...SAFE,
      },
    })
  }
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream
  return new Response(body, {
    headers: {
      'Content-Type': type,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      ...SAFE,
    },
  })
}

export function handleMediaScheme() {
  protocol.handle(MEDIA_SCHEME, (request) => {
    const url = new URL(request.url)
    const name = decodeURIComponent(url.pathname.slice(1))
    if (url.host === 'file') {
      const path = normalize(name)
      if (!allowed.has(path)) return new Response('Forbidden', { status: 403 })
      return serveFile(path, request)
    }
    if (url.host === 'thumb' && /^[0-9a-f]{40}\.jpg$/.test(name)) {
      return serveFile(join(cacheDir(), 'thumbs', name), request)
    }
    if (url.host === 'decode') {
      return openDecode(name) ?? new Response('Not found', { status: 404 })
    }
    if (url.host === 'proxy' && /^[0-9a-f]{40}\.mp4$/.test(name)) {
      return serveFile(join(proxyDir(), name), request)
    }
    return new Response('Not found', { status: 404 })
  })
}
