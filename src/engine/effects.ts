import { still } from './animation'
import { createId, type Effect } from './model'

export type ParamSpec =
  | {
      id: string
      kind: 'number'
      default: number
      min: number
      max: number
      step: number
      unit?: '%' | 'px' | '°' | ''
    }
  | { id: string; kind: 'color'; default: string }
  | { id: string; kind: 'bool'; default: boolean }
  | { id: string; kind: 'choice'; default: string; options: string[] }

export type EffectSpec = {
  type: string
  category: 'blur' | 'stylize' | 'distort' | 'key' | 'shape' | 'adjust'
  params: ParamSpec[]
}

const n = (
  id: string,
  def: number,
  min: number,
  max: number,
  step = 0.01,
  unit: '%' | 'px' | '°' | '' = '',
): ParamSpec => ({
  id,
  kind: 'number',
  default: def,
  min,
  max,
  step,
  unit,
})

/**
 * The effect library. Names and labels come from the `effect.<type>` and
 * `param.<id>` strings; shaders live in the compositor, keyed by `type`.
 */
export const EFFECTS: EffectSpec[] = [
  { type: 'gaussian-blur', category: 'blur', params: [n('radius', 8, 0, 200, 0.5, 'px')] },
  {
    type: 'directional-blur',
    category: 'blur',
    params: [n('length', 24, 0, 400, 1, 'px'), n('angle', 0, -180, 180, 1, '°')],
  },
  {
    type: 'zoom-blur',
    category: 'blur',
    params: [n('amount', 0.2, 0, 1), n('centerX', 0.5, 0, 1), n('centerY', 0.5, 0, 1)],
  },
  { type: 'sharpen', category: 'blur', params: [n('amount', 0.5, 0, 4)] },
  {
    type: 'glow',
    category: 'stylize',
    params: [
      n('threshold', 0.7, 0, 1),
      n('radius', 16, 0, 200, 0.5, 'px'),
      n('intensity', 1, 0, 4),
    ],
  },
  {
    type: 'vignette',
    category: 'stylize',
    params: [n('amount', 0.5, 0, 1), n('size', 0.6, 0, 1.5), n('softness', 0.5, 0.01, 1)],
  },
  {
    type: 'grain',
    category: 'stylize',
    params: [n('amount', 0.15, 0, 1), n('size', 1.5, 0.5, 8, 0.1, 'px')],
  },
  {
    type: 'chromatic-aberration',
    category: 'stylize',
    params: [n('amount', 4, 0, 60, 0.5, 'px'), n('angle', 0, -180, 180, 1, '°')],
  },
  { type: 'pixelate', category: 'stylize', params: [n('size', 16, 1, 200, 1, 'px')] },
  { type: 'posterize', category: 'stylize', params: [n('levels', 6, 2, 32, 1)] },
  {
    type: 'mirror',
    category: 'stylize',
    params: [
      {
        id: 'axis',
        kind: 'choice',
        default: 'vertical',
        options: ['vertical', 'horizontal', 'both'],
      },
    ],
  },
  {
    type: 'wave',
    category: 'distort',
    params: [
      n('amplitude', 10, 0, 200, 0.5, 'px'),
      n('wavelength', 120, 4, 2000, 1, 'px'),
      n('phase', 0, -360, 360, 1, '°'),
    ],
  },
  {
    type: 'bulge',
    category: 'distort',
    params: [
      n('amount', 0.5, -1, 1),
      n('radius', 0.4, 0.01, 1.5),
      n('centerX', 0.5, 0, 1),
      n('centerY', 0.5, 0, 1),
    ],
  },
  {
    type: 'lens-correction',
    category: 'distort',
    params: [n('curvature', 0, -1, 1), n('zoom', 1, 0.5, 2)],
  },
  {
    type: 'chroma-key',
    category: 'key',
    params: [
      { id: 'keyColor', kind: 'color', default: '#00b140' },
      n('similarity', 0.35, 0, 1),
      n('softness', 0.1, 0, 1),
      n('spill', 0.5, 0, 1),
    ],
  },
  {
    type: 'luma-key',
    category: 'key',
    params: [
      n('threshold', 0.1, 0, 1),
      n('softness', 0.05, 0, 1),
      { id: 'invert', kind: 'bool', default: false },
    ],
  },
  {
    type: 'drop-shadow',
    category: 'shape',
    params: [
      n('angle', 135, -180, 180, 1, '°'),
      n('distance', 12, 0, 200, 0.5, 'px'),
      n('blur', 16, 0, 200, 0.5, 'px'),
      n('opacity', 0.6, 0, 1),
      { id: 'color', kind: 'color', default: '#000000' },
    ],
  },
  {
    type: 'stroke',
    category: 'shape',
    params: [n('width', 4, 0, 60, 0.5, 'px'), { id: 'color', kind: 'color', default: '#ffffff' }],
  },
  {
    type: 'stabilize',
    category: 'adjust',
    params: [n('smoothness', 0.5, 0, 1), n('zoom', 1.05, 1, 1.5)],
  },
  {
    type: 'brightness-contrast',
    category: 'adjust',
    params: [n('brightness', 0, -1, 1), n('contrast', 0, -1, 1), n('saturation', 1, 0, 3)],
  },
]

export const EFFECTS_BY_TYPE = new Map(EFFECTS.map((e) => [e.type, e]))

/** A new effect instance with every parameter at its default. */
export function createEffect(type: string): Effect {
  const spec = EFFECTS_BY_TYPE.get(type)
  if (!spec) throw new Error(`Unknown effect ${type}`)
  const params: Effect['params'] = {}
  for (const p of spec.params) params[p.id] = p.kind === 'number' ? still(p.default) : p.default
  return { id: createId('fx'), type, enabled: true, params, data: [] }
}

/** Reads a parameter, falling back to the library default for anything missing. */
export function paramOf(effect: Effect, id: string): Effect['params'][string] | undefined {
  if (effect.params[id] !== undefined) return effect.params[id]
  const spec = EFFECTS_BY_TYPE.get(effect.type)?.params.find((p) => p.id === id)
  if (!spec) return undefined
  return spec.kind === 'number' ? still(spec.default) : spec.default
}
