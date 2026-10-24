import type { Clip } from './model'

function shiftDeep<T>(value: T, by: number): T {
  if (Array.isArray(value)) return value.map((v) => shiftDeep(v, by)) as T
  if (!value || typeof value !== 'object') return value
  const obj = value as Record<string, unknown>
  // An animated value: { value, keys: [{ frame, ... }] }
  if (Array.isArray(obj['keys']) && 'value' in obj) {
    const keys = obj['keys'] as { frame: number }[]
    return (
      keys.length ? { ...obj, keys: keys.map((k) => ({ ...k, frame: k.frame - by })) } : value
    ) as T
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) out[k] = shiftDeep(v, by)
  return out as T
}

/** Moves every keyframe on a clip (transform, effects, masks, volume) back by `by` frames. */
export function shiftClipKeys(clip: Clip, by: number): Clip {
  if (by === 0) return clip
  return {
    ...clip,
    transform: shiftDeep(clip.transform, by),
    effects: shiftDeep(clip.effects, by),
    masks: shiftDeep(clip.masks, by),
    sound: shiftDeep(clip.sound, by),
  }
}
