/** Small WebGL2 helpers: programs, a full-screen quad, and a pool of render targets. */

export type Target = { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

export const VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

export class Program {
  readonly program: WebGLProgram
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>()

  constructor(
    private readonly gl: WebGL2RenderingContext,
    fragment: string,
    vertex = VERTEX,
  ) {
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error(`Shader failed: ${gl.getShaderInfoLog(sh)}\n${src}`)
      return sh
    }
    const p = gl.createProgram()!
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex))
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment))
    gl.bindAttribLocation(p, 0, 'a_pos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(`Program failed: ${gl.getProgramInfoLog(p)}`)
    this.program = p
  }

  use() {
    this.gl.useProgram(this.program)
    return this
  }

  loc(name: string) {
    if (!this.uniforms.has(name))
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name))
    return this.uniforms.get(name)!
  }

  f(name: string, ...v: number[]) {
    const l = this.loc(name)
    if (!l) return this
    const gl = this.gl
    if (v.length === 1) gl.uniform1f(l, v[0]!)
    else if (v.length === 2) gl.uniform2f(l, v[0]!, v[1]!)
    else if (v.length === 3) gl.uniform3f(l, v[0]!, v[1]!, v[2]!)
    else gl.uniform4f(l, v[0]!, v[1]!, v[2]!, v[3]!)
    return this
  }

  i(name: string, v: number) {
    const l = this.loc(name)
    if (l) this.gl.uniform1i(l, v)
    return this
  }

  mat3(name: string, m: Float32Array) {
    const l = this.loc(name)
    if (l) this.gl.uniformMatrix3fv(l, false, m)
    return this
  }

  /** Binds a texture to a sampler uniform on the given unit. */
  tex(name: string, unit: number, tex: WebGLTexture) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    return this.i(name, unit)
  }
}

export function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

/** Render targets are reused by size so a frame allocates nothing once warmed up. */
export class TargetPool {
  private free = new Map<string, Target[]>()
  private all: Target[] = []

  /** With `float`, targets hold half floats so HDR values and gradients keep their precision. */
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly float = false,
  ) {}

  get(w: number, h: number): Target {
    w = Math.max(1, Math.round(w))
    h = Math.max(1, Math.round(h))
    const key = `${w}x${h}`
    const list = this.free.get(key)
    const reused = list?.pop()
    if (reused) return reused
    const gl = this.gl
    const tex = createTexture(gl)
    if (this.float)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    const target = { fbo, tex, w, h }
    this.all.push(target)
    return target
  }

  release(t: Target | null | undefined) {
    if (!t) return
    const key = `${t.w}x${t.h}`
    const list = this.free.get(key) ?? []
    list.push(t)
    this.free.set(key, list)
  }

  dispose() {
    for (const t of this.all) {
      this.gl.deleteFramebuffer(t.fbo)
      this.gl.deleteTexture(t.tex)
    }
    this.all = []
    this.free.clear()
  }
}

export function createQuad(gl: WebGL2RenderingContext) {
  const vao = gl.createVertexArray()!
  gl.bindVertexArray(vao)
  const buf = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  return vao
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex)
  if (!m) return [0, 0, 0]
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255]
}
