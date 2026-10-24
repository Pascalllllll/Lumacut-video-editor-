import { evaluate, setAt, toggleAnimation, type Animated, type Ease } from './animation'
import type { Clip, Effect, Mask, Transform } from './model'

/**
 * Addresses one animatable number on a clip, so editors, keyframe buttons and
 * the graph editor can all point at the same thing.
 */
export type ParamPath =
  | { kind: 'transform'; key: keyof Transform }
  | { kind: 'effect'; effectId: string; param: string }
  | { kind: 'mask'; maskId: string; param: 'feather' | 'expansion' | 'opacity' }
  | { kind: 'sound'; param: 'volume' }

export function samePath(a: ParamPath | null, b: ParamPath | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function getAnimated(clip: Clip, path: ParamPath): Animated | undefined {
  if (path.kind === 'transform') return clip.transform[path.key]
  if (path.kind === 'sound') return clip.sound.volume
  if (path.kind === 'effect') {
    const v = clip.effects.find((e) => e.id === path.effectId)?.params[path.param]
    return v && typeof v === 'object' ? v : undefined
  }
  return clip.masks.find((m) => m.id === path.maskId)?.[path.param]
}

/** The clip's look with one animated value replaced; returns the fields to put in a `clip.look` command. */
export function withAnimated(
  clip: Clip,
  path: ParamPath,
  next: Animated,
): Partial<Pick<Clip, 'transform' | 'effects' | 'masks' | 'sound'>> {
  if (path.kind === 'transform') return { transform: { ...clip.transform, [path.key]: next } }
  if (path.kind === 'sound') return { sound: { ...clip.sound, volume: next } }
  if (path.kind === 'effect') {
    return {
      effects: clip.effects.map((e): Effect =>
        e.id === path.effectId ? { ...e, params: { ...e.params, [path.param]: next } } : e,
      ),
    }
  }
  return {
    masks: clip.masks.map((m): Mask => (m.id === path.maskId ? { ...m, [path.param]: next } : m)),
  }
}

/** Sets a value at a clip frame: on the key there (or a new one) when animated, otherwise the still value. */
export function setParam(clip: Clip, path: ParamPath, frame: number, value: number) {
  const anim = getAnimated(clip, path) ?? { value, keys: [] }
  return withAnimated(clip, path, setAt(anim, frame, value))
}

/** The keyframe button: start animating, add a key, or remove the key under the playhead. */
export function toggleKey(clip: Clip, path: ParamPath, frame: number) {
  const anim = getAnimated(clip, path)
  if (!anim) return {}
  if (anim.keys.length === 0) return withAnimated(clip, path, toggleAnimation(anim, frame))
  const at = anim.keys.findIndex((k) => k.frame === frame)
  if (at >= 0) {
    const keys = anim.keys.filter((_, i) => i !== at)
    // Removing the last key leaves the value it had.
    return withAnimated(
      clip,
      path,
      keys.length ? { value: anim.value, keys } : { value: evaluate(anim, frame), keys: [] },
    )
  }
  return withAnimated(clip, path, setAt(anim, frame, evaluate(anim, frame)))
}

export function stopAnimating(clip: Clip, path: ParamPath, frame: number) {
  const anim = getAnimated(clip, path)
  if (!anim) return {}
  return withAnimated(clip, path, { value: evaluate(anim, frame), keys: [] })
}

export function setKeyEase(clip: Clip, path: ParamPath, keyFrame: number, ease: Ease) {
  const anim = getAnimated(clip, path)
  if (!anim) return {}
  return withAnimated(clip, path, {
    ...anim,
    keys: anim.keys.map((k) => (k.frame === keyFrame ? { ...k, ease } : k)),
  })
}

/** Moves a key to another frame and value, keeping keys in order and never stacking two on one frame. */
export function moveKey(
  clip: Clip,
  path: ParamPath,
  fromFrame: number,
  toFrame: number,
  value: number,
) {
  const anim = getAnimated(clip, path)
  if (!anim) return {}
  const others = anim.keys.filter((k) => k.frame !== fromFrame)
  if (toFrame !== fromFrame && others.some((k) => k.frame === toFrame)) return {}
  const moved = anim.keys.find((k) => k.frame === fromFrame)
  if (!moved) return {}
  const keys = [...others, { ...moved, frame: toFrame, value }].sort((a, b) => a.frame - b.frame)
  return withAnimated(clip, path, { ...anim, keys })
}

/** Nearest key before or after a clip frame, for the previous/next keyframe buttons. */
export function adjacentKey(
  anim: Animated | undefined,
  frame: number,
  direction: 1 | -1,
): number | null {
  if (!anim?.keys.length) return null
  const frames = anim.keys.map((k) => k.frame)
  const found =
    direction > 0 ? frames.find((f) => f > frame) : [...frames].reverse().find((f) => f < frame)
  return found ?? null
}

/** All keyframe positions on a clip, for drawing them on the timeline. */
export function allKeyFrames(clip: Clip): number[] {
  const frames = new Set<number>()
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit)
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (Array.isArray(o['keys']) && 'value' in o)
        for (const k of o['keys'] as { frame: number }[]) frames.add(k.frame)
      else Object.values(o).forEach(visit)
    }
  }
  visit(clip.transform)
  visit(clip.effects)
  visit(clip.masks)
  visit(clip.sound.volume)
  return [...frames].sort((a, b) => a - b)
}
