import { z } from 'zod'

/**
 * How a value travels from one keyframe to the next. Named eases are CSS's
 * cubic curves; `bezier` takes custom control points from the graph editor;
 * `hold` keeps the value until the next key.
 */
export const easeSchema = z.union([
  z.enum(['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out']),
  z.object({ bezier: z.tuple([z.number(), z.number(), z.number(), z.number()]) }),
])
export type Ease = z.infer<typeof easeSchema>

export const NAMED_EASES: Record<
  'ease-in' | 'ease-out' | 'ease-in-out',
  [number, number, number, number]
> = {
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
}

/** A keyframe; `frame` counts from the start of the clip. */
export const keyframeSchema = z.object({
  frame: z.number().int(),
  value: z.number(),
  ease: easeSchema.default('linear'),
})
export type Keyframe = z.infer<typeof keyframeSchema>

/** A number that may change over time. With no keys it is simply `value`. */
export const animatedSchema = z.object({
  value: z.number(),
  keys: z.array(keyframeSchema).default([]),
})
export type Animated = z.infer<typeof animatedSchema>

/** A list of numbers that animates element by element (mask outlines). Every key holds the same count. */
export const vectorKeyframeSchema = z.object({
  frame: z.number().int(),
  value: z.array(z.number()),
  ease: easeSchema.default('linear'),
})
export const animatedVectorSchema = z.object({
  value: z.array(z.number()),
  keys: z.array(vectorKeyframeSchema).default([]),
})
export type AnimatedVector = z.infer<typeof animatedVectorSchema>

export function still(value: number): Animated {
  return { value, keys: [] }
}

/** Solves a CSS-style cubic bezier for y at x, by Newton's method with a bisection fallback. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  let t = x
  for (let i = 0; i < 8; i++) {
    const err = sampleX(t) - x
    if (Math.abs(err) < 1e-6) return sampleY(t)
    const d = slopeX(t)
    if (Math.abs(d) < 1e-6) break
    t -= err / d
  }
  let lo = 0
  let hi = 1
  t = x
  for (let i = 0; i < 40; i++) {
    const v = sampleX(t)
    if (Math.abs(v - x) < 1e-7) break
    if (v < x) lo = t
    else hi = t
    t = (lo + hi) / 2
  }
  return sampleY(t)
}

/** Progress 0..1 through a segment after easing. */
export function applyEase(ease: Ease, k: number): number {
  if (ease === 'linear') return k
  if (ease === 'hold') return 0
  const [x1, y1, x2, y2] = typeof ease === 'string' ? NAMED_EASES[ease] : ease.bezier
  return cubicBezier(x1, y1, x2, y2, k)
}

function segment<T extends { frame: number }>(
  keys: T[],
  frame: number,
): { a: T; b: T | undefined; k: number } | { only: T } {
  if (frame <= keys[0]!.frame) return { only: keys[0]! }
  const last = keys[keys.length - 1]!
  if (frame >= last.frame) return { only: last }
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!
    if (frame < b.frame) {
      const a = keys[i - 1]!
      return { a, b, k: (frame - a.frame) / (b.frame - a.frame) }
    }
  }
  return { only: last }
}

/** The value at a (possibly fractional) frame inside the clip. Keys must be sorted by frame. */
export function evaluate(anim: Animated, frame: number): number {
  if (anim.keys.length === 0) return anim.value
  const s = segment(anim.keys, frame)
  if ('only' in s) return s.only.value
  const k = applyEase(s.a.ease, s.k)
  return s.a.value + (s.b!.value - s.a.value) * k
}

export function evaluateVector(anim: AnimatedVector, frame: number): number[] {
  if (anim.keys.length === 0) return anim.value
  const s = segment(anim.keys, frame)
  if ('only' in s) return s.only.value
  const k = applyEase(s.a.ease, s.k)
  return s.a.value.map((v, i) => v + ((s.b!.value[i] ?? v) - v) * k)
}

/** Sets a value at a frame: updates the key there, adds one, or sets the still value when not animated. */
export function setAt(anim: Animated, frame: number, value: number): Animated {
  if (anim.keys.length === 0) return { value, keys: [] }
  const existing = anim.keys.findIndex((k) => k.frame === frame)
  const keys = [...anim.keys]
  if (existing >= 0) keys[existing] = { ...keys[existing]!, value }
  else keys.push({ frame, value, ease: 'linear' })
  keys.sort((a, b) => a.frame - b.frame)
  return { value, keys }
}

/** Turns animation on (a first key at `frame` with the current value) or off (keeps the value at `frame`). */
export function toggleAnimation(anim: Animated, frame: number): Animated {
  if (anim.keys.length) return { value: evaluate(anim, frame), keys: [] }
  return { value: anim.value, keys: [{ frame, value: anim.value, ease: 'linear' }] }
}

/** Shifts keys when a clip's start is trimmed so they stay on the same picture. */
export function shiftKeys<T extends { keys: { frame: number }[] }>(anim: T, by: number): T {
  if (!anim.keys.length || by === 0) return anim
  return { ...anim, keys: anim.keys.map((k) => ({ ...k, frame: k.frame - by })) }
}
