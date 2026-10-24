import { BLEND_MODES, TRANSITIONS } from '@engine/model'
import type {
  AdjustmentItem,
  EvaluatedEffect,
  EvaluatedMask,
  Layer,
  Scene,
  TransitionItem,
} from '@engine/scene'
import { EFFECTS_BY_TYPE } from '@engine/effects'
import { balanceGains, sampleCurve, sampleHueCurve } from '@engine/color'
import type { GradeLayer } from '@engine/model'
import { createQuad, createTexture, hexToRgb, Program, TargetPool, type Target } from './gl'
import { MaskPainter } from './masks'
import * as S from './shaders'
import { paintCaption } from './captions'
import { paintTitle } from './titles'
import { Scopes } from './scopes'

/** A picture for a media layer: something the browser can upload, or raw RGBA bytes (top row first). */
/** Raw pictures are 8-bit RGBA bytes, or 0-to-1 floats for HDR. */
export type Picture =
  | TexImageSource
  | {
      data: Uint8Array<ArrayBufferLike> | Float32Array<ArrayBufferLike>
      width: number
      height: number
    }

export interface FrameSource {
  picture(layer: Layer): Picture | null
}

const BLEND_INDEX = new Map(BLEND_MODES.map((m, i) => [m, i]))
const TRANSITION_INDEX = new Map(TRANSITIONS.map((t, i) => [t, i]))
const POINT_KIND: Record<string, number> = {
  sharpen: 1,
  glow: 2,
  vignette: 3,
  grain: 4,
  'chromatic-aberration': 5,
  pixelate: 6,
  posterize: 7,
  mirror: 8,
  wave: 9,
  bulge: 10,
  'lens-correction': 11,
  'chroma-key': 12,
  'luma-key': 13,
  'brightness-contrast': 14,
}
/** Effects that reach outside the picture, applied after it is placed in the frame. */
const FRAME_SPACE = new Set(['drop-shadow', 'stroke'])
/** Pictures larger than this are scaled down on upload. */
const MAX_TEXTURE = 8192

function defaultsOf(type: string): Record<string, number | string | boolean> {
  const spec = EFFECTS_BY_TYPE.get(type)
  const out: Record<string, number | string | boolean> = {}
  for (const p of spec?.params ?? []) out[p.id] = p.default
  return out
}

export class Compositor {
  readonly gl: WebGL2RenderingContext
  private readonly pool: TargetPool
  private readonly vao: WebGLVertexArrayObject
  private readonly programs = new Map<string, Program>()
  private readonly uploads = new Map<string, WebGLTexture>()
  private readonly masks = new Map<string, { painter: MaskPainter; tex: WebGLTexture }>()
  private readonly titleCanvas = new Map<string, OffscreenCanvas>()
  private frameSeed = 0
  private lastFrame: Target | null = null
  private scopes: Scopes | null = null
  private readonly curveTex = new Map<string, WebGLTexture>()
  private readonly lutTex = new Map<string, { tex: WebGLTexture; size: number }>()
  /** Supplies LUT data by source (`bundled:<id>` or a file path); null while a file is still loading. */
  lutSource: (source: string) => { size: number; data: Float32Array } | null = () => null
  /** Output scale relative to the sequence (below 1 for lighter previews). */
  private k = 1

  private readonly float: boolean

  /** `float` keeps 16-bit precision end to end, for HDR exports. */
  constructor(
    readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    opts: { float?: boolean } = {},
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null
    if (!gl)
      throw new Error('WebGL2 is not available, so the viewer cannot draw. Check the GPU driver.')
    this.gl = gl
    this.float = opts.float === true
    if (this.float && !gl.getExtension('EXT_color_buffer_float')) {
      throw new Error("This GPU can't render the floating-point frames HDR export needs.")
    }
    this.pool = new TargetPool(gl, this.float)
    this.vao = createQuad(gl)
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
  }

  private program(name: keyof typeof S): Program {
    let p = this.programs.get(name)
    if (!p) {
      p = new Program(this.gl, S[name])
      this.programs.set(name, p)
    }
    return p
  }

  private draw(target: Target | null, w?: number, h?: number) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo ?? null)
    gl.viewport(0, 0, target?.w ?? w!, target?.h ?? h!)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  private clear(target: Target, rgba: [number, number, number, number] = [0, 0, 0, 0]) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
    gl.viewport(0, 0, target.w, target.h)
    gl.clearColor(...rgba)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /** Uploads a picture and converts it to the compositor's form at the layer's size. */
  /** With `picture` null, reuses the last upload for this key (a decoder that hasn't caught up yet). */
  private ingest(
    key: string,
    picture: Picture | null,
    w: number,
    h: number,
    premultiply: boolean,
  ): Target | null {
    const gl = this.gl
    let tex = this.uploads.get(key)
    if (!picture && !tex) return null
    if (!tex) {
      tex = createTexture(gl)
      this.uploads.set(key, tex)
    }
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    if (picture) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      if ('data' in picture && picture.data instanceof Float32Array) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA16F,
          picture.width,
          picture.height,
          0,
          gl.RGBA,
          gl.FLOAT,
          picture.data,
        )
      } else if ('data' in picture) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA8,
          picture.width,
          picture.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          picture.data,
        )
      } else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, picture)
    }
    const scale = Math.min(1, MAX_TEXTURE / Math.max(w, h))
    const out = this.pool.get(w * scale, h * scale)
    this.program('INGEST')
      .use()
      .tex('u_tex', 0, tex)
      .f('u_premul', premultiply ? 1 : 0)
    this.draw(out)
    return out
  }

  private copy(src: Target, w: number, h: number): Target {
    const out = this.pool.get(w, h)
    this.program('COPY').use().tex('u_tex', 0, src.tex).f('u_flip', 0)
    this.draw(out)
    return out
  }

  // ---------------------------------------------------------------- effects

  private blur(src: Target, sigmaX: number, sigmaY: number): Target {
    // Big blurs run on a smaller copy; the result is scaled back up.
    const big = Math.max(sigmaX, sigmaY)
    const k = big > 24 ? big / 24 : 1
    let work = k > 1 ? this.copy(src, src.w / k, src.h / k) : src
    const g = this.program('GAUSSIAN')
    const h = this.pool.get(work.w, work.h)
    g.use()
      .tex('u_tex', 0, work.tex)
      .f('u_dir', 1 / work.w, 0)
      .f('u_sigma', sigmaX / k)
    this.draw(h)
    const v = this.pool.get(work.w, work.h)
    g.use()
      .tex('u_tex', 0, h.tex)
      .f('u_dir', 0, 1 / work.h)
      .f('u_sigma', sigmaY / k)
    this.draw(v)
    this.pool.release(h)
    if (work !== src) this.pool.release(work)
    if (k === 1) return v
    work = this.copy(v, src.w, src.h)
    this.pool.release(v)
    return work
  }

  /** Runs one effect; returns a new target (the input is left for the caller to release). */
  private effect(src: Target, fx: EvaluatedEffect, pxScale: number): Target {
    const p = { ...defaultsOf(fx.type), ...fx.params }
    const n = (id: string) => (typeof p[id] === 'number' ? (p[id] as number) : 0)
    const px = (id: string) => n(id) * pxScale
    const out = () => this.pool.get(src.w, src.h)

    switch (fx.type) {
      case 'gaussian-blur': {
        const s = px('radius') / 2
        return this.blur(src, s, s)
      }
      case 'directional-blur': {
        const a = (n('angle') * Math.PI) / 180
        const o = out()
        this.program('DIRECTIONAL')
          .use()
          .tex('u_tex', 0, src.tex)
          .f('u_step', (Math.cos(a) * px('length')) / src.w, (Math.sin(a) * px('length')) / src.h)
        this.draw(o)
        return o
      }
      case 'zoom-blur': {
        const o = out()
        this.program('ZOOM')
          .use()
          .tex('u_tex', 0, src.tex)
          .f('u_center', n('centerX'), 1 - n('centerY'))
          .f('u_amount', n('amount'))
        this.draw(o)
        return o
      }
      case 'sharpen': {
        const b = this.blur(src, 1.5, 1.5)
        const o = out()
        this.program('POINT')
          .use()
          .tex('u_tex', 0, src.tex)
          .tex('u_aux', 1, b.tex)
          .i('u_kind', 1)
          .f('u_p', n('amount'), 0, 0, 0)
          .f('u_size', src.w, src.h)
        this.draw(o)
        this.pool.release(b)
        return o
      }
      case 'glow': {
        const bright = out()
        this.program('POINT')
          .use()
          .tex('u_tex', 0, src.tex)
          .i('u_kind', 15)
          .f('u_p', n('threshold'), 0, 0, 0)
          .f('u_size', src.w, src.h)
        this.draw(bright)
        const s = px('radius') / 2
        const b = this.blur(bright, s, s)
        this.pool.release(bright)
        const o = out()
        this.program('POINT')
          .use()
          .tex('u_tex', 0, src.tex)
          .tex('u_aux', 1, b.tex)
          .i('u_kind', 2)
          .f('u_p', 0, n('intensity'), 0, 0)
          .f('u_size', src.w, src.h)
        this.draw(o)
        this.pool.release(b)
        return o
      }
      case 'drop-shadow':
      case 'stroke': {
        const isShadow = fx.type === 'drop-shadow'
        const shape = isShadow ? this.blur(src, px('blur') / 2, px('blur') / 2) : src
        const a = (n('angle') * Math.PI) / 180
        const o = out()
        const [r, g, b] = hexToRgb(String(p['color'] ?? '#000000'))
        this.program('UNDERLAY')
          .use()
          .tex('u_tex', 0, src.tex)
          .tex('u_shape', 1, shape.tex)
          .f(
            'u_offset',
            isShadow ? (Math.cos(a) * px('distance')) / src.w : 0,
            isShadow ? (-Math.sin(a) * px('distance')) / src.h : 0,
          )
          .f('u_color', r, g, b)
          .f('u_opacity', isShadow ? n('opacity') : 1)
          .f('u_radius', isShadow ? 0 : px('width') / src.w)
          .f('u_texel', 1 / src.w, 1 / src.h)
        this.draw(o)
        if (shape !== src) this.pool.release(shape)
        return o
      }
      default: {
        const kind = POINT_KIND[fx.type]
        if (!kind) return this.copy(src, src.w, src.h)
        const prog = this.program('POINT')
          .use()
          .tex('u_tex', 0, src.tex)
          .tex('u_aux', 1, src.tex)
          .i('u_kind', kind)
          .f('u_size', src.w, src.h)
          .f('u_seed', this.frameSeed)
        switch (fx.type) {
          case 'vignette':
            prog.f('u_p', n('amount'), n('size'), n('softness'), 0)
            break
          case 'grain':
            prog.f('u_p', n('amount'), px('size'), 0, 0)
            break
          case 'chromatic-aberration':
            prog.f('u_p', px('amount'), (n('angle') * Math.PI) / 180, 0, 0)
            break
          case 'pixelate':
            prog.f('u_p', px('size'), 0, 0, 0)
            break
          case 'posterize':
            prog.f('u_p', n('levels'), 0, 0, 0)
            break
          case 'mirror': {
            const axis = String(p['axis'])
            prog.f('u_p', axis !== 'horizontal' ? 1 : 0, axis !== 'vertical' ? 1 : 0, 0, 0)
            break
          }
          case 'wave':
            prog.f('u_p', px('amplitude'), px('wavelength'), (n('phase') * Math.PI) / 180, 0)
            break
          case 'bulge':
            prog
              .f('u_p', n('amount'), 0, n('centerX'), 1 - n('centerY'))
              .f('u_color', n('radius'), 0, 0)
            break
          case 'lens-correction':
            prog.f('u_p', n('curvature'), n('zoom'), 0, 0)
            break
          case 'chroma-key': {
            const [r, g, b] = hexToRgb(String(p['keyColor'] ?? '#00b140'))
            prog.f('u_p', n('similarity'), n('softness'), n('spill'), 0).f('u_color', r, g, b)
            break
          }
          case 'luma-key':
            prog.f('u_p', n('threshold'), n('softness'), p['invert'] === true ? 1 : 0, 0)
            break
          case 'brightness-contrast':
            prog.f('u_p', n('brightness'), n('contrast'), n('saturation'), 0)
            break
        }
        const o = out()
        this.draw(o)
        return o
      }
    }
  }

  private effects(
    src: Target,
    list: EvaluatedEffect[],
    pxScale: number,
    frameSpace: boolean,
  ): Target {
    let cur = src
    for (const fx of list) {
      if (FRAME_SPACE.has(fx.type) !== frameSpace) continue
      const next = this.effect(cur, fx, pxScale)
      if (cur !== src) this.pool.release(cur)
      cur = next
    }
    return cur
  }

  private maskTexture(
    key: string,
    masks: EvaluatedMask[],
    w: number,
    h: number,
  ): WebGLTexture | null {
    if (masks.length === 0) return null
    let entry = this.masks.get(key)
    if (!entry) {
      entry = { painter: new MaskPainter(), tex: createTexture(this.gl) }
      this.masks.set(key, entry)
    }
    const painted = entry.painter.paint(masks, w, h)
    if (!painted) return null
    if (painted.changed) {
      const gl = this.gl
      gl.bindTexture(gl.TEXTURE_2D, entry.tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, painted.canvas)
    }
    return entry.tex
  }

  // ---------------------------------------------------------------- grading

  private floatTexture1D(
    key: string,
    cache: Map<string, WebGLTexture>,
    data: () => Float32Array,
  ): WebGLTexture {
    let tex = cache.get(key)
    if (tex) return tex
    const gl = this.gl
    tex = createTexture(gl)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 256, 1, 0, gl.RGBA, gl.FLOAT, data())
    // Old curves are dropped once the cache grows; a grade rarely has more than a few.
    if (cache.size > 64) {
      for (const [k, t] of cache) {
        gl.deleteTexture(t)
        cache.delete(k)
        if (cache.size <= 32) break
      }
    }
    cache.set(key, tex)
    return tex
  }

  private curveTexture(c: NonNullable<GradeLayer['curves']>): WebGLTexture {
    return this.floatTexture1D(
      `rgb|${c.master.join()}|${c.red.join()}|${c.green.join()}|${c.blue.join()}`,
      this.curveTex,
      () => {
        const master = sampleCurve(c.master)
        const ch = [sampleCurve(c.red), sampleCurve(c.green), sampleCurve(c.blue)]
        const out = new Float32Array(256 * 4)
        for (let i = 0; i < 256; i++) {
          const m = master[i]!
          for (let k = 0; k < 3; k++) {
            // Channel curve applied after the master curve, read with linear interpolation.
            const x = Math.min(255, Math.max(0, m * 255))
            const lo = Math.floor(x)
            const f = x - lo
            const curve = ch[k]!
            out[i * 4 + k] = curve[lo]! * (1 - f) + curve[Math.min(255, lo + 1)]! * f
          }
          out[i * 4 + 3] = 1
        }
        return out
      },
    )
  }

  private hueTexture(c: NonNullable<GradeLayer['curves']>): WebGLTexture {
    return this.floatTexture1D(
      `hue|${c.hueHue.join()}|${c.hueSat.join()}|${c.hueLuma.join()}`,
      this.curveTex,
      () => {
        const h = sampleHueCurve(c.hueHue)
        const s = sampleHueCurve(c.hueSat)
        const l = sampleHueCurve(c.hueLuma)
        const out = new Float32Array(256 * 4)
        for (let i = 0; i < 256; i++) out.set([h[i]!, s[i]!, l[i]!, 1], i * 4)
        return out
      },
    )
  }

  private lutTexture(source: string): { tex: WebGLTexture; size: number } | null {
    const cached = this.lutTex.get(source)
    if (cached) return cached
    const cube = this.lutSource(source)
    if (!cube) return null
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_3D, tex)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
      gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE)
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGB16F,
      cube.size,
      cube.size,
      cube.size,
      0,
      gl.RGB,
      gl.FLOAT,
      cube.data,
    )
    const entry = { tex, size: cube.size }
    this.lutTex.set(source, entry)
    return entry
  }

  /** Applies grade layers in order; returns a new target, or the input when nothing applied. */
  private grade(src: Target, layers: GradeLayer[]): Target {
    let cur = src
    for (const layer of layers) {
      // Every sampler gets its own unit even when unused: a 3D sampler left on the picture's unit fails the draw.
      const prog = this.program('GRADE')
        .use()
        .tex('u_tex', 0, cur.tex)
        .f('u_mix', layer.mix)
        .i('u_curve', 1)
        .i('u_hue', 2)
        .i('u_lut', 3)
      if (layer.kind === 'primary' && layer.primary) {
        const p = layer.primary
        prog
          .i('u_kind', 0)
          .f('u_lift', ...p.lift)
          .f('u_gamma', ...p.gamma)
          .f('u_gain', ...p.gain)
          .f('u_offset', ...p.offset)
        prog
          .f('u_wb', ...balanceGains(p.temperature, p.tint))
          .f('u_exposure', p.exposure)
          .f('u_contrast', p.contrast)
          .f('u_pivot', p.pivot)
          .f('u_sat', p.saturation)
      } else if (layer.kind === 'curves' && layer.curves) {
        const c = layer.curves
        const hasHue = c.hueHue.length + c.hueSat.length + c.hueLuma.length > 0
        prog
          .i('u_kind', 1)
          .tex('u_curve', 1, this.curveTexture(c))
          .f('u_hasHue', hasHue ? 1 : 0)
        prog.tex('u_hue', 2, hasHue ? this.hueTexture(c) : this.curveTexture(c))
      } else if (layer.kind === 'lut' && layer.lut) {
        const lut = this.lutTexture(layer.lut.source)
        if (!lut) continue
        const gl = this.gl
        gl.activeTexture(gl.TEXTURE3)
        gl.bindTexture(gl.TEXTURE_3D, lut.tex)
        prog
          .i('u_kind', 2)
          .i('u_lut', 3)
          .f('u_lutSize', lut.size)
          .f('u_intensity', layer.lut.intensity)
      } else continue
      const q = layer.qualifier
      prog.f('u_qual', q ? 1 : 0)
      if (q)
        prog
          .f('u_qHue', q.hueCenter, q.hueWidth, q.softness, q.invert ? 1 : 0)
          .f('u_qSatLum', q.satLow, q.satHigh, q.lumLow, q.lumHigh)
          .f('u_qShow', q.show ? 1 : 0)
      else prog.f('u_qShow', 0)
      const out = this.pool.get(cur.w, cur.h)
      this.draw(out)
      if (cur !== src) this.pool.release(cur)
      cur = out
    }
    return cur
  }

  // ---------------------------------------------------------------- layers

  private source(layer: Layer, frames: FrameSource): Target | null {
    const src = layer.source
    if (src.kind === 'nested') return this.renderScene(src.scene, frames)
    if (src.kind === 'color') {
      const t = this.pool.get(layer.width, layer.height)
      const [r, g, b] = hexToRgb(src.color)
      this.clear(t, [r, g, b, 1])
      return t
    }
    if (src.kind === 'caption') {
      let canvas = this.titleCanvas.get(layer.key)
      if (!canvas || canvas.width !== layer.width || canvas.height !== layer.height) {
        canvas = new OffscreenCanvas(layer.width, layer.height)
        this.titleCanvas.set(layer.key, canvas)
      }
      paintCaption(
        canvas.getContext('2d')!,
        src.cue,
        src.style,
        src.frame,
        layer.width,
        layer.height,
      )
      return this.ingest(`title:${layer.key}`, canvas, layer.width, layer.height, true)!
    }
    if (src.kind === 'title') {
      let canvas = this.titleCanvas.get(layer.key)
      if (!canvas || canvas.width !== layer.width || canvas.height !== layer.height) {
        canvas = new OffscreenCanvas(layer.width, layer.height)
        this.titleCanvas.set(layer.key, canvas)
      }
      paintTitle(
        canvas.getContext('2d')!,
        src.title,
        src.frame,
        src.duration,
        layer.width,
        layer.height,
      )
      return this.ingest(`title:${layer.key}`, canvas, layer.width, layer.height, true)!
    }
    const picture = frames.picture(layer)
    // Raw decoder frames are opaque unless the file has alpha; browser-decoded pictures may carry it.
    const straight = src.kind === 'media' && src.asset.alpha
    return this.ingest(
      layer.key,
      picture,
      layer.width,
      layer.height,
      !picture || !('data' in picture) || straight,
    )
  }

  /** A layer drawn into the frame: effects, crop, mask, transform and opacity applied. */
  private renderLayer(layer: Layer, frames: FrameSource, W: number, H: number): Target | null {
    const raw = this.source(layer, frames)
    if (!raw) return null
    const t = layer.transform
    const graded = layer.grade.length ? this.grade(raw, layer.grade) : raw
    if (graded !== raw) this.pool.release(raw)
    // Effect sizes are given in full-size frame pixels; convert them to pixels of this picture.
    const pxScale =
      (this.k / Math.max(layer.fit * Math.max(Math.abs(t.scaleX), Math.abs(t.scaleY)), 1e-3)) *
      (graded.w / Math.max(layer.width, 1))
    const fx = this.effects(graded, layer.effects, pxScale, false)
    if (fx !== graded) this.pool.release(graded)

    const mask = this.maskTexture(layer.key, layer.masks, layer.width, layer.height)
    // Frame pixels (centred, y up) to picture pixels (centred, y up).
    const sx = layer.fit * t.scaleX
    const sy = layer.fit * t.scaleY
    const rot = (-t.rotation * Math.PI) / 180
    const cos = Math.cos(-rot)
    const sin = Math.sin(-rot)
    const tx = t.x
    const ty = -t.y
    const ax = t.anchorX
    const ay = -t.anchorY
    // s = A + S^-1 R^-1 (p - T)
    const a = cos / (sx || 1e-6)
    const b = -sin / (sx || 1e-6)
    const c = sin / (sy || 1e-6)
    const d = cos / (sy || 1e-6)
    const inv = new Float32Array([
      a,
      c,
      0,
      b,
      d,
      0,
      ax - (a * tx + b * ty),
      ay - (c * tx + d * ty),
      1,
    ])

    const placed = this.pool.get(W, H)
    const prog = this.program('PLACE')
      .use()
      .tex('u_tex', 0, fx.tex)
      .f('u_frame', W, H)
      .f('u_src', layer.width, layer.height)
      .mat3('u_inv', inv)
      .f('u_crop', t.cropLeft, t.cropRight, t.cropTop, t.cropBottom)
      .f('u_opacity', t.opacity)
      .f('u_hasMask', mask ? 1 : 0)
    if (mask) prog.tex('u_mask', 1, mask)
    else prog.tex('u_mask', 1, fx.tex)
    this.draw(placed)
    this.pool.release(fx)

    const after = this.effects(placed, layer.effects, this.k, true)
    if (after !== placed) this.pool.release(placed)
    return after
  }

  private composite(base: Target, layer: Target, mode: Layer['blend']): Target {
    const out = this.pool.get(base.w, base.h)
    this.program('BLEND')
      .use()
      .tex('u_base', 0, base.tex)
      .tex('u_layer', 1, layer.tex)
      .i('u_mode', BLEND_INDEX.get(mode) ?? 0)
    this.draw(out)
    this.pool.release(base)
    this.pool.release(layer)
    return out
  }

  private transition(item: TransitionItem, frames: FrameSource, W: number, H: number): Target {
    const empty = () => {
      const t = this.pool.get(W, H)
      this.clear(t)
      return t
    }
    const a = (item.from && this.renderLayer(item.from, frames, W, H)) ?? empty()
    const b = (item.to && this.renderLayer(item.to, frames, W, H)) ?? empty()
    const out = this.pool.get(W, H)
    this.program('TRANSITION')
      .use()
      .tex('u_a', 0, a.tex)
      .tex('u_b', 1, b.tex)
      .f('u_p', item.progress)
      .i('u_kind', TRANSITION_INDEX.get(item.type) ?? 0)
      .f('u_size', W, H)
    this.draw(out)
    this.pool.release(a)
    this.pool.release(b)
    return out
  }

  private adjustment(item: AdjustmentItem, base: Target): Target {
    const changed = this.effects(base, item.effects, this.k, false)
    const framed = this.effects(changed, item.effects, this.k, true)
    if (framed !== changed && changed !== base) this.pool.release(changed)
    const mask = this.maskTexture(item.key, item.masks, base.w, base.h)
    const out = this.pool.get(base.w, base.h)
    const prog = this.program('MIX')
      .use()
      .tex('u_a', 0, base.tex)
      .tex('u_b', 1, framed.tex)
      .f('u_amount', item.opacity)
      .f('u_hasMask', mask ? 1 : 0)
    prog.tex('u_mask', 2, mask ?? framed.tex)
    this.draw(out)
    if (framed !== base) this.pool.release(framed)
    this.pool.release(base)
    return out
  }

  /** Composites a scene into a new target (transparent where nothing is drawn). */
  renderScene(scene: Scene, frames: FrameSource): Target {
    const W = scene.width
    const H = scene.height
    let accum = this.pool.get(W, H)
    this.clear(accum)
    for (const item of scene.items) {
      if (item.kind === 'adjustment') {
        accum = this.adjustment(item, accum)
        continue
      }
      const layer =
        item.kind === 'transition'
          ? this.transition(item, frames, W, H)
          : this.renderLayer(item, frames, W, H)
      if (!layer) continue
      accum = this.composite(accum, layer, item.kind === 'layer' ? item.blend : 'normal')
    }
    return accum
  }

  /** Draws a scene to the canvas at `scale` times the sequence size. */
  present(
    full: Scene,
    frames: FrameSource,
    scale = 1,
    background: [number, number, number] = [0, 0, 0],
  ) {
    this.frameSeed = (this.frameSeed + 1) % 1000
    this.k = scale
    const scene = scale === 1 ? full : scaleScene(full, scale)
    const out = this.renderScene(scene, frames)
    const canvas = this.canvas
    if (canvas.width !== scene.width || canvas.height !== scene.height) {
      canvas.width = scene.width
      canvas.height = scene.height
    }
    this.program('FLATTEN')
      .use()
      .tex('u_tex', 0, out.tex)
      .f('u_bg', ...background)
      .f('u_flip', 0)
    this.draw(null, canvas.width, canvas.height)
    // Kept until the next frame so the scopes can read it.
    this.pool.release(this.lastFrame)
    this.lastFrame = out
  }

  /** Renders a scene and returns RGBA bytes, top row first. */
  read(
    scene: Scene,
    frames: FrameSource,
    seed: number,
    background: [number, number, number] = [0, 0, 0],
    /** Keep transparency (straight alpha) instead of flattening onto the background. */
    alpha = false,
  ): Uint8Array<ArrayBuffer> {
    this.frameSeed = seed
    this.k = 1
    const out = this.renderScene(scene, frames)
    const flat = this.pool.get(scene.width, scene.height)
    if (alpha) this.program('STRAIGHT').use().tex('u_tex', 0, out.tex).f('u_flip', 1)
    else
      this.program('FLATTEN')
        .use()
        .tex('u_tex', 0, out.tex)
        .f('u_bg', ...background)
        .f('u_flip', 1)
    this.draw(flat)
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, flat.fbo)
    let pixels: Uint8Array<ArrayBuffer>
    if (this.float) {
      // HDR frames go to the encoder as 16-bit RGBA.
      const f = new Float32Array(scene.width * scene.height * 4)
      gl.readPixels(0, 0, scene.width, scene.height, gl.RGBA, gl.FLOAT, f)
      const u = new Uint16Array(f.length)
      for (let i = 0; i < f.length; i++) u[i] = Math.round(Math.min(1, Math.max(0, f[i]!)) * 65535)
      pixels = new Uint8Array(u.buffer)
    } else {
      pixels = new Uint8Array(scene.width * scene.height * 4)
      gl.readPixels(0, 0, scene.width, scene.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    }
    this.pool.release(out)
    this.pool.release(flat)
    return pixels
  }

  /** A scope of the last frame drawn on the canvas; null before the first frame. */
  scope(kind: 'waveform' | 'parade' | 'vectorscope', size = 256): ImageData | null {
    if (!this.lastFrame) return null
    this.scopes ??= new Scopes(this.gl, this.vao)
    return this.scopes.render(this.lastFrame.tex, this.lastFrame.w, this.lastFrame.h, kind, size)
  }

  histogram(): { r: Float32Array; g: Float32Array; b: Float32Array } | null {
    if (!this.lastFrame) return null
    this.scopes ??= new Scopes(this.gl, this.vao)
    return this.scopes.histogram(this.lastFrame.tex, this.lastFrame.w, this.lastFrame.h)
  }

  /** Forgets cached textures for layers that are gone. */
  prune(liveKeys: Set<string>) {
    for (const [key, tex] of this.uploads) {
      const base = key.startsWith('title:') ? key.slice(6) : key
      if (!liveKeys.has(base)) {
        this.gl.deleteTexture(tex)
        this.uploads.delete(key)
        this.titleCanvas.delete(base)
      }
    }
    for (const [key, entry] of this.masks) {
      if (!liveKeys.has(key)) {
        this.gl.deleteTexture(entry.tex)
        this.masks.delete(key)
      }
    }
  }

  dispose() {
    this.scopes?.dispose()
    this.pool.dispose()
    for (const tex of this.curveTex.values()) this.gl.deleteTexture(tex)
    for (const l of this.lutTex.values()) this.gl.deleteTexture(l.tex)
    this.curveTex.clear()
    this.lutTex.clear()
    for (const tex of this.uploads.values()) this.gl.deleteTexture(tex)
    for (const m of this.masks.values()) this.gl.deleteTexture(m.tex)
    this.uploads.clear()
    this.masks.clear()
  }
}

/** The same scene drawn smaller: frame sizes, fits and positions scale; pictures stay as they are. */
export function scaleScene(scene: Scene, k: number): Scene {
  const layer = (l: Layer): Layer => ({
    ...l,
    fit: l.fit * k,
    width:
      l.source.kind === 'title' || l.source.kind === 'color' || l.source.kind === 'caption'
        ? Math.max(1, Math.round(l.width * k))
        : l.width,
    height:
      l.source.kind === 'title' || l.source.kind === 'color' || l.source.kind === 'caption'
        ? Math.max(1, Math.round(l.height * k))
        : l.height,
    transform: { ...l.transform, x: l.transform.x * k, y: l.transform.y * k },
  })
  return {
    width: Math.max(1, Math.round(scene.width * k)),
    height: Math.max(1, Math.round(scene.height * k)),
    items: scene.items.map((item) => {
      if (item.kind === 'layer') return layer(item)
      if (item.kind === 'transition')
        return { ...item, from: item.from && layer(item.from), to: item.to && layer(item.to) }
      return item
    }),
  }
}
