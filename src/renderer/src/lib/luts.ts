import { bakeLook } from '@engine/looks'
import type { Project } from '@engine/model'

type Lut = { size: number; data: Float32Array }

const cache = new Map<string, Lut>()
const loading = new Map<string, Promise<Lut | null>>()
const failed = new Set<string>()

/** Built-in looks are written `bundled:<id>`; anything else is a .cube file path. */
export function isBundled(source: string) {
  return source.startsWith('bundled:')
}

function load(source: string): Promise<Lut | null> {
  let pending = loading.get(source)
  if (!pending) {
    pending = window.lumacut
      .invoke('lut:read', { path: source })
      .then((r) => {
        const lut = { size: r.size, data: Float32Array.from(r.data) }
        cache.set(source, lut)
        window.dispatchEvent(new Event('lumacut:lut-loaded'))
        return lut
      })
      .catch(() => {
        failed.add(source)
        return null
      })
    loading.set(source, pending)
  }
  return pending
}

/** LUT data for the compositor. Files load in the background; until then the layer is skipped. */
export function getLut(source: string): Lut | null {
  const hit = cache.get(source)
  if (hit) return hit
  if (isBundled(source)) {
    const lut = { size: 33, data: bakeLook(source.slice('bundled:'.length), 33) }
    cache.set(source, lut)
    return lut
  }
  if (!failed.has(source)) void load(source)
  return null
}

/** Loads every LUT file a project uses, for exports that must not skip any. */
export async function preloadLuts(project: Project): Promise<void> {
  const sources = new Set<string>()
  for (const seq of Object.values(project.sequences))
    for (const clip of Object.values(seq.clips))
      for (const g of clip.grade) if (g.lut && !isBundled(g.lut.source)) sources.add(g.lut.source)
  const results = await Promise.all([...sources].map(load))
  const missing = [...sources].filter((_, i) => !results[i])
  if (missing.length)
    throw new Error(
      `Couldn't read the LUT ${missing[0]}. Move it back or choose another LUT, then export again.`,
    )
}
