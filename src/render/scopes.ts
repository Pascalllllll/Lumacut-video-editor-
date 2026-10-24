import { Program } from './gl'

export type ScopeKind = 'waveform' | 'parade' | 'vectorscope' | 'histogram'

/**
 * One point per sampled pixel of the frame, placed by the scope's rule.
 * Points add up in a float buffer, so dense areas glow brighter.
 */
const SCATTER_VERT = `#version 300 es
precision highp float;
uniform sampler2D u_frame;
uniform ivec2 u_grid;
uniform int u_mode;     // 0 waveform, 1 parade, 2 vectorscope, 3 histogram
uniform int u_channel;  // parade and histogram: 0 red, 1 green, 2 blue
out vec3 v_color;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
void main() {
  ivec2 p = ivec2(gl_VertexID % u_grid.x, gl_VertexID / u_grid.x);
  vec2 uv = (vec2(p) + 0.5) / vec2(u_grid);
  vec4 c = texture(u_frame, uv);
  vec3 rgb = clamp(c.rgb, 0.0, 1.0); // over black: premultiplied color is the visible color
  vec2 pos;
  if (u_mode == 0) {
    pos = vec2(uv.x, dot(rgb, LUMA));
    v_color = vec3(1.0);
  } else if (u_mode == 1) {
    float v = u_channel == 0 ? rgb.r : u_channel == 1 ? rgb.g : rgb.b;
    pos = vec2((uv.x + float(u_channel)) / 3.0, v);
    v_color = u_channel == 0 ? vec3(1.0, 0.25, 0.2) : u_channel == 1 ? vec3(0.3, 1.0, 0.35) : vec3(0.35, 0.5, 1.0);
  } else if (u_mode == 2) {
    float cb = dot(rgb, vec3(-0.1146, -0.3854, 0.5));
    float cr = dot(rgb, vec3(0.5, -0.4542, -0.0458));
    pos = vec2(cb, cr) + 0.5;
    v_color = mix(vec3(1.0), rgb, 0.6);
  } else {
    float v = u_channel == 0 ? rgb.r : u_channel == 1 ? rgb.g : rgb.b;
    pos = vec2((floor(v * 255.0 + 0.5) + 0.5) / 256.0, 0.5);
    v_color = vec3(1.0);
  }
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`

const SCATTER_FRAG = `#version 300 es
precision highp float;
in vec3 v_color;
out vec4 o;
uniform float u_weight;
void main() { o = vec4(v_color * u_weight, u_weight); }`

/** Turns accumulated density into a visible trace on a dark background. */
const TONE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_acc;
uniform float u_gain;
void main() {
  vec4 a = texture(u_acc, v_uv);
  float k = log(1.0 + a.a * u_gain) / log(1.0 + u_gain);
  vec3 tint = a.a > 0.0 ? a.rgb / a.a : vec3(0.0);
  o = vec4(clamp(tint * k, 0.0, 1.0), 1.0);
}`

const POINT_VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`

export class Scopes {
  private scatter: Program
  private tone: Program
  private acc: { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null
  private out: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null
  private readonly emptyVao: WebGLVertexArrayObject
  readonly float: boolean

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly quad: WebGLVertexArrayObject,
  ) {
    this.float = Boolean(gl.getExtension('EXT_color_buffer_float'))
    this.scatter = new Program(gl, SCATTER_FRAG, SCATTER_VERT)
    this.tone = new Program(gl, TONE_FRAG, POINT_VERT)
    this.emptyVao = gl.createVertexArray()!
  }

  private target(w: number, h: number) {
    const gl = this.gl
    if (this.acc && this.acc.w === w && this.acc.h === h) return this.acc
    if (this.acc) {
      gl.deleteTexture(this.acc.tex)
      gl.deleteFramebuffer(this.acc.fbo)
    }
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    if (this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    this.acc = { fbo, tex, w, h }
    return this.acc
  }

  /** Scatters the frame into the accumulation buffer. */
  private accumulate(
    frame: WebGLTexture,
    frameW: number,
    frameH: number,
    kind: ScopeKind,
    w: number,
    h: number,
  ) {
    const gl = this.gl
    const acc = this.target(w, h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fbo)
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    const gridW = kind === 'histogram' ? Math.min(frameW, 480) : 384
    const gridH = Math.max(1, Math.round((gridW * frameH) / frameW))
    const weight = this.float ? 1 : 1 / 64
    this.scatter
      .use()
      .tex('u_frame', 0, frame)
      .i('u_mode', ['waveform', 'parade', 'vectorscope', 'histogram'].indexOf(kind))
    this.scatter.f('u_weight', weight)
    this.gl.uniform2i(this.scatter.loc('u_grid'), gridW, gridH)
    gl.bindVertexArray(this.emptyVao)
    const passes = kind === 'parade' || kind === 'histogram' ? 3 : 1
    for (let ch = 0; ch < passes; ch++) {
      if (kind === 'histogram') gl.colorMask(ch === 0, ch === 1, ch === 2, false)
      this.scatter.i('u_channel', ch)
      gl.drawArrays(gl.POINTS, 0, gridW * gridH)
    }
    gl.colorMask(true, true, true, true)
    gl.disable(gl.BLEND)
    return { acc, samples: gridW * gridH }
  }

  /** Draws a scope and returns its pixels (top row first) for a 2D canvas. */
  render(
    frame: WebGLTexture,
    frameW: number,
    frameH: number,
    kind: Exclude<ScopeKind, 'histogram'>,
    size = 256,
  ): ImageData {
    const gl = this.gl
    const { acc, samples } = this.accumulate(frame, frameW, frameH, kind, size, size)
    if (!this.out) {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      this.out = { fbo, tex }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.out.fbo)
    gl.viewport(0, 0, size, size)
    // Gain scales with how many samples land in one cell on average.
    const gain = this.float ? (size * size * 40) / samples : 8
    this.tone.use().tex('u_acc', 0, acc.tex).f('u_gain', gain)
    gl.bindVertexArray(this.quad)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    const px = new Uint8ClampedArray(size * size * 4)
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px)
    // GL rows run bottom-up; images run top-down.
    const flipped = new Uint8ClampedArray(px.length)
    const row = size * 4
    for (let y = 0; y < size; y++)
      flipped.set(px.subarray(y * row, (y + 1) * row), (size - 1 - y) * row)
    return new ImageData(flipped, size, size)
  }

  /** Counts per level (0 to 255) for red, green and blue. */
  histogram(
    frame: WebGLTexture,
    frameW: number,
    frameH: number,
  ): { r: Float32Array; g: Float32Array; b: Float32Array } {
    const gl = this.gl
    const { acc } = this.accumulate(frame, frameW, frameH, 'histogram', 256, 1)
    const r = new Float32Array(256)
    const g = new Float32Array(256)
    const b = new Float32Array(256)
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fbo)
    if (this.float) {
      const px = new Float32Array(256 * 4)
      gl.readPixels(0, 0, 256, 1, gl.RGBA, gl.FLOAT, px)
      for (let i = 0; i < 256; i++) {
        r[i] = px[i * 4]!
        g[i] = px[i * 4 + 1]!
        b[i] = px[i * 4 + 2]!
      }
    } else {
      const px = new Uint8Array(256 * 4)
      gl.readPixels(0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      for (let i = 0; i < 256; i++) {
        r[i] = px[i * 4]!
        g[i] = px[i * 4 + 1]!
        b[i] = px[i * 4 + 2]!
      }
    }
    return { r, g, b }
  }

  dispose() {
    const gl = this.gl
    if (this.acc) {
      gl.deleteTexture(this.acc.tex)
      gl.deleteFramebuffer(this.acc.fbo)
    }
    if (this.out) {
      gl.deleteTexture(this.out.tex)
      gl.deleteFramebuffer(this.out.fbo)
    }
  }
}
