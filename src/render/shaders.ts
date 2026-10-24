/**
 * GLSL for the compositor. Every texture inside the compositor holds
 * premultiplied alpha with OpenGL's bottom-up rows; the ingest shader turns
 * uploaded pictures (top-down, straight alpha) into that form once.
 */

const HEAD = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
`

const UNPREMUL = `
vec3 unpremul(vec4 c) { return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`

export const INGEST = `${HEAD}
uniform sampler2D u_tex;
uniform float u_premul;
void main() {
  vec4 c = texture(u_tex, vec2(v_uv.x, 1.0 - v_uv.y));
  o = u_premul > 0.5 ? vec4(c.rgb * c.a, c.a) : c;
}`

export const COPY = `${HEAD}
uniform sampler2D u_tex;
uniform float u_flip;
void main() { o = texture(u_tex, u_flip > 0.5 ? vec2(v_uv.x, 1.0 - v_uv.y) : v_uv); }`

/** Undoes premultiplied alpha for exports that keep transparency. */
export const STRAIGHT = `${HEAD}
uniform sampler2D u_tex;
uniform float u_flip;
void main() {
  vec4 c = texture(u_tex, u_flip > 0.5 ? vec2(v_uv.x, 1.0 - v_uv.y) : v_uv);
  o = c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0);
}`

/** Draws `over` on a solid background color (the final frame is opaque). */
export const FLATTEN = `${HEAD}
uniform sampler2D u_tex;
uniform vec3 u_bg;
uniform float u_flip;
void main() {
  vec4 c = texture(u_tex, u_flip > 0.5 ? vec2(v_uv.x, 1.0 - v_uv.y) : v_uv);
  o = vec4(c.rgb + u_bg * (1.0 - c.a), 1.0);
}`

/**
 * Places a picture in the frame. u_inv maps frame pixels (centred, y up) to
 * picture pixels (centred, y up). Crop and mask cut the picture; edges get
 * one pixel of antialiasing.
 */
export const PLACE = `${HEAD}
uniform sampler2D u_tex;
uniform sampler2D u_mask;
uniform float u_hasMask;
uniform vec2 u_frame;
uniform vec2 u_src;
uniform mat3 u_inv;
uniform vec4 u_crop; // left, right, top, bottom as fractions
uniform float u_opacity;
void main() {
  vec2 p = v_uv * u_frame - u_frame * 0.5;
  vec2 s = (u_inv * vec3(p, 1.0)).xy;
  vec2 uv = s / u_src + 0.5;
  vec2 lo = vec2(u_crop.x, u_crop.w);
  vec2 hi = vec2(1.0 - u_crop.y, 1.0 - u_crop.z);
  vec2 px = fwidth(uv) + 1e-6;
  vec2 inside = smoothstep(lo - px * 0.5, lo + px * 0.5, uv) * (1.0 - smoothstep(hi - px * 0.5, hi + px * 0.5, uv));
  float a = inside.x * inside.y;
  if (a <= 0.0) { o = vec4(0.0); return; }
  vec4 c = texture(u_tex, clamp(uv, 0.0, 1.0));
  // Masks are uploaded top-down, straight from their canvas.
  if (u_hasMask > 0.5) c *= texture(u_mask, vec2(uv.x, 1.0 - uv.y)).a;
  o = c * a * u_opacity;
}`

/** W3C compositing: blend the layer's color with what's below, then source-over. */
export const BLEND = `${HEAD}${UNPREMUL}
uniform sampler2D u_base;
uniform sampler2D u_layer;
uniform int u_mode;

vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5, h = 0.0, s = 0.0, d = mx - mn;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}
float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 h) {
  if (h.y < 1e-6) return vec3(h.z);
  float q = h.z < 0.5 ? h.z * (1.0 + h.y) : h.z + h.y - h.z * h.y;
  float p = 2.0 * h.z - q;
  return vec3(hue2rgb(p, q, h.x + 1.0 / 3.0), hue2rgb(p, q, h.x), hue2rgb(p, q, h.x - 1.0 / 3.0));
}
float softLight(float b, float s) {
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return s <= 0.5 ? b - (1.0 - 2.0 * s) * b * (1.0 - b) : b + (2.0 * s - 1.0) * (d - b);
}
vec3 blendColor(vec3 b, vec3 s) {
  if (u_mode == 1) return b * s;
  if (u_mode == 2) return b + s - b * s;
  if (u_mode == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (u_mode == 4) return min(b, s);
  if (u_mode == 5) return max(b, s);
  if (u_mode == 6) return mix(min(vec3(1.0), b / max(1.0 - s, 1e-5)), vec3(0.0), step(b, vec3(0.0)));
  if (u_mode == 7) return mix(1.0 - min(vec3(1.0), (1.0 - b) / max(s, 1e-5)), vec3(1.0), step(vec3(1.0), b));
  if (u_mode == 8) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, s));
  if (u_mode == 9) return vec3(softLight(b.r, s.r), softLight(b.g, s.g), softLight(b.b, s.b));
  if (u_mode == 10) return abs(b - s);
  if (u_mode == 11) return b + s - 2.0 * b * s;
  if (u_mode == 12) return min(vec3(1.0), b + s);
  if (u_mode == 13) return max(vec3(0.0), b - s);
  vec3 hb = rgb2hsl(b), hs = rgb2hsl(s);
  if (u_mode == 14) return hsl2rgb(vec3(hs.x, hb.y, hb.z));
  if (u_mode == 15) return hsl2rgb(vec3(hb.x, hs.y, hb.z));
  if (u_mode == 16) return hsl2rgb(vec3(hs.x, hs.y, hb.z));
  if (u_mode == 17) return hsl2rgb(vec3(hb.x, hb.y, hs.z));
  return s;
}
void main() {
  vec4 b = texture(u_base, v_uv);
  vec4 s = texture(u_layer, v_uv);
  if (s.a <= 0.0) { o = b; return; }
  vec3 cb = unpremul(b), cs = unpremul(s);
  vec3 mixed = (1.0 - b.a) * cs + b.a * clamp(blendColor(cb, cs), 0.0, 1.0);
  o = vec4(s.a * mixed + (1.0 - s.a) * b.rgb, s.a + b.a * (1.0 - s.a));
}`

/** Mixes an effect's output with its input, for adjustment layer opacity and masks. */
export const MIX = `${HEAD}
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform sampler2D u_mask;
uniform float u_hasMask;
uniform float u_amount;
void main() {
  float k = u_amount * (u_hasMask > 0.5 ? texture(u_mask, vec2(v_uv.x, 1.0 - v_uv.y)).a : 1.0);
  o = mix(texture(u_a, v_uv), texture(u_b, v_uv), k);
}`

// ------------------------------------------------------------------ effects

export const GAUSSIAN = `${HEAD}
uniform sampler2D u_tex;
uniform vec2 u_dir;     // one texel step along the blur direction
uniform float u_sigma;
void main() {
  if (u_sigma < 0.3) { o = texture(u_tex, v_uv); return; }
  int r = int(min(ceil(u_sigma * 3.0), 96.0));
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -96; i <= 96; i++) {
    if (i < -r || i > r) continue;
    float w = exp(-float(i * i) / (2.0 * u_sigma * u_sigma));
    acc += texture(u_tex, v_uv + u_dir * float(i)) * w;
    wsum += w;
  }
  o = acc / wsum;
}`

export const DIRECTIONAL = `${HEAD}
uniform sampler2D u_tex;
uniform vec2 u_step; // total blur vector in uv
void main() {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 48; i++) acc += texture(u_tex, v_uv + u_step * (float(i) / 47.0 - 0.5));
  o = acc / 48.0;
}`

export const ZOOM = `${HEAD}
uniform sampler2D u_tex;
uniform vec2 u_center;
uniform float u_amount;
void main() {
  vec4 acc = vec4(0.0);
  vec2 d = v_uv - u_center;
  for (int i = 0; i < 48; i++) acc += texture(u_tex, u_center + d * (1.0 - u_amount * float(i) / 47.0));
  o = acc / 48.0;
}`

/** Single-pass effects that only look at nearby pixels, chosen by u_kind. */
export const POINT = `${HEAD}${UNPREMUL}
uniform sampler2D u_tex;
uniform sampler2D u_aux;   // blurred copy for sharpen and glow
uniform vec2 u_size;
uniform int u_kind;
uniform vec4 u_p;          // up to four numeric parameters
uniform vec3 u_color;
uniform float u_seed;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + u_seed) * 43758.5453); }

void main() {
  vec2 uv = v_uv;
  vec4 c = texture(u_tex, uv);
  if (u_kind == 1) { // sharpen: unsharp mask
    vec4 b = texture(u_aux, uv);
    o = clamp(c + (c - b) * u_p.x, 0.0, 1.0);
    o.a = c.a;
  } else if (u_kind == 2) { // glow: add the blurred bright parts
    vec4 b = texture(u_aux, uv);
    o = vec4(min(vec3(1.0), c.rgb + b.rgb * u_p.y), max(c.a, b.a));
  } else if (u_kind == 3) { // vignette
    vec2 d = (uv - 0.5) * vec2(u_size.x / u_size.y, 1.0);
    float v = smoothstep(u_p.y, u_p.y - u_p.z, length(d) * 1.4);
    o = vec4(c.rgb * mix(1.0 - u_p.x, 1.0, v), c.a);
  } else if (u_kind == 4) { // grain
    vec2 cell = floor(uv * u_size / max(u_p.y, 0.5));
    float n = hash(cell) - 0.5;
    o = vec4(clamp(c.rgb + n * u_p.x * c.a, 0.0, 1.0), c.a);
  } else if (u_kind == 5) { // chromatic aberration
    vec2 dir = vec2(cos(u_p.y), sin(u_p.y)) * u_p.x / u_size;
    vec4 r = texture(u_tex, uv + dir), b = texture(u_tex, uv - dir);
    o = vec4(r.r, c.g, b.b, max(c.a, max(r.a, b.a)));
  } else if (u_kind == 6) { // pixelate
    vec2 cell = max(u_p.x, 1.0) / u_size;
    o = texture(u_tex, (floor(uv / cell) + 0.5) * cell);
  } else if (u_kind == 7) { // posterize
    float l = max(u_p.x, 2.0) - 1.0;
    vec3 s = unpremul(c);
    o = vec4(floor(s * l + 0.5) / l * c.a, c.a);
  } else if (u_kind == 8) { // mirror: x = vertical axis, y = horizontal axis
    vec2 m = uv;
    if (u_p.x > 0.5 && m.x > 0.5) m.x = 1.0 - m.x;
    if (u_p.y > 0.5 && m.y < 0.5) m.y = 1.0 - m.y;
    o = texture(u_tex, m);
  } else if (u_kind == 9) { // wave
    float w = sin((uv.y * u_size.y) / max(u_p.y, 1.0) * 6.2831853 + u_p.z) * u_p.x / u_size.x;
    o = texture(u_tex, uv + vec2(w, 0.0));
  } else if (u_kind == 10) { // bulge (negative pinches)
    vec2 center = u_p.zw;
    vec2 d = (uv - center) * vec2(u_size.x / u_size.y, 1.0);
    float r = length(d);
    float rad = u_color.x;
    if (r < rad) {
      float k = r / rad;
      float f = mix(1.0, smoothstep(0.0, 1.0, k), u_p.x);
      d *= f;
    }
    o = texture(u_tex, center + d / vec2(u_size.x / u_size.y, 1.0));
  } else if (u_kind == 11) { // lens correction
    vec2 d = (uv - 0.5) * 2.0;
    float r2 = dot(d, d);
    vec2 m = d * (1.0 + u_p.x * r2) / max(u_p.y, 0.01);
    vec2 s = m * 0.5 + 0.5;
    o = (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) ? vec4(0.0) : texture(u_tex, s);
  } else if (u_kind == 12) { // chroma key with spill suppression
    vec3 s = unpremul(c);
    vec3 k = u_color;
    // Distance in chroma (Cb, Cr) so brightness changes on the backdrop don't matter.
    vec2 cs = vec2(dot(s, vec3(-0.1146, -0.3854, 0.5)), dot(s, vec3(0.5, -0.4542, -0.0458)));
    vec2 ck = vec2(dot(k, vec3(-0.1146, -0.3854, 0.5)), dot(k, vec3(0.5, -0.4542, -0.0458)));
    float d = distance(cs, ck);
    float a = smoothstep(u_p.x * 0.4, u_p.x * 0.4 + u_p.y * 0.4 + 1e-4, d);
    float spill = clamp(1.0 - d / max(u_p.x * 0.4 + 0.15, 1e-4), 0.0, 1.0) * u_p.z;
    vec3 desat = mix(s, vec3(luma(s)), spill);
    o = vec4(desat * a * c.a, a * c.a);
  } else if (u_kind == 13) { // luma key
    float l = luma(unpremul(c));
    float a = smoothstep(u_p.x, u_p.x + u_p.y + 1e-4, l);
    if (u_p.z > 0.5) a = 1.0 - a;
    o = c * a;
  } else if (u_kind == 14) { // brightness, contrast, saturation
    vec3 s = unpremul(c);
    s = (s - 0.5) * (1.0 + u_p.y) + 0.5 + u_p.x;
    s = mix(vec3(luma(s)), s, u_p.z);
    o = vec4(clamp(s, 0.0, 1.0) * c.a, c.a);
  } else if (u_kind == 15) { // glow threshold pass
    vec3 s = unpremul(c);
    float k = smoothstep(u_p.x, u_p.x + 0.1, luma(s));
    o = vec4(s * k * c.a, c.a * k);
  } else {
    o = c;
  }
}`

/** Shadow and stroke: the blurred or grown alpha, colored, placed under the picture. */
export const UNDERLAY = `${HEAD}
uniform sampler2D u_tex;
uniform sampler2D u_shape; // blurred alpha for shadows, the picture itself for strokes
uniform vec2 u_offset;     // uv offset of the shadow
uniform vec3 u_color;
uniform float u_opacity;
uniform float u_radius;    // stroke: grow radius in uv along x; 0 for shadows
uniform vec2 u_texel;
void main() {
  vec4 c = texture(u_tex, v_uv);
  float a;
  if (u_radius > 0.0) {
    a = 0.0;
    for (int i = 0; i < 24; i++) {
      float ang = float(i) / 24.0 * 6.2831853;
      for (int j = 1; j <= 4; j++) {
        vec2 d = vec2(cos(ang), sin(ang)) * u_radius * float(j) / 4.0;
        a = max(a, texture(u_shape, v_uv + d * vec2(1.0, u_texel.y / u_texel.x)).a);
      }
    }
  } else {
    a = texture(u_shape, v_uv - u_offset).a;
  }
  vec4 under = vec4(u_color, 1.0) * a * u_opacity;
  o = c + under * (1.0 - c.a);
}`

// ------------------------------------------------------------------ transitions

export const TRANSITION = `${HEAD}
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_p;
uniform int u_kind;
uniform vec2 u_size;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec4 at(sampler2D t, vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(t, uv); }
void main() {
  vec2 uv = v_uv;
  float p = clamp(u_p, 0.0, 1.0);
  vec4 a = texture(u_a, uv), b = texture(u_b, uv);
  float edge = 0.02;
  if (u_kind == 0) o = mix(a, b, p);
  else if (u_kind == 1 || u_kind == 2) { // dip to black / white
    vec4 dip = u_kind == 1 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(1.0);
    o = p < 0.5 ? mix(a, dip, p * 2.0) : mix(dip, b, (p - 0.5) * 2.0);
  }
  else if (u_kind == 3) o = mix(a, b, smoothstep(p - edge, p + edge, 1.0 - uv.x + edge * (1.0 - 2.0 * p)));
  else if (u_kind == 4) o = mix(a, b, smoothstep(p - edge, p + edge, uv.x + edge * (1.0 - 2.0 * p)));
  else if (u_kind == 5) o = mix(a, b, smoothstep(p - edge, p + edge, uv.y + edge * (1.0 - 2.0 * p)));
  else if (u_kind == 6) o = mix(a, b, smoothstep(p - edge, p + edge, 1.0 - uv.y + edge * (1.0 - 2.0 * p)));
  else if (u_kind == 7) { // clock wipe
    float ang = atan(uv.x - 0.5, uv.y - 0.5) / 6.2831853 + 0.5;
    o = mix(a, b, smoothstep(ang - 0.01, ang + 0.01, p));
  }
  else if (u_kind == 8) { vec4 bb = at(u_b, uv + vec2(1.0 - p, 0.0)); o = bb + a * (1.0 - bb.a); } // slide in from the right
  else if (u_kind == 9) { vec4 bb = at(u_b, uv - vec2(1.0 - p, 0.0)); o = bb + a * (1.0 - bb.a); } // slide in from the left
  else if (u_kind == 10) { vec4 aa = at(u_a, uv + vec2(p, 0.0)); vec4 bb = at(u_b, uv + vec2(p - 1.0, 0.0)); o = aa + bb; } // push left
  else if (u_kind == 11) { vec4 aa = at(u_a, uv - vec2(p, 0.0)); vec4 bb = at(u_b, uv - vec2(p - 1.0, 0.0)); o = aa + bb; } // push right
  else if (u_kind == 12) { // zoom in: push into the outgoing clip, the incoming one settles from close up
    vec4 za = at(u_a, (uv - 0.5) / (1.0 + p * 2.0) + 0.5);
    vec4 zb = at(u_b, (uv - 0.5) / (2.0 - p) + 0.5);
    o = mix(za, zb, smoothstep(0.3, 0.7, p));
  }
  else if (u_kind == 13) { // zoom out: the outgoing clip shrinks away, the incoming one grows to fill the frame
    vec4 za = at(u_a, (uv - 0.5) * (1.0 + p) + 0.5);
    vec4 zb = at(u_b, (uv - 0.5) * (2.0 - p) + 0.5);
    o = mix(za, zb, smoothstep(0.3, 0.7, p));
  }
  else if (u_kind == 14) { // blur dissolve: soften both sides around the middle
    float r = sin(p * 3.14159) * 12.0 / u_size.y;
    vec4 acc = vec4(0.0);
    for (int i = -4; i <= 4; i++) for (int j = -4; j <= 4; j++) {
      vec2 d = vec2(float(i), float(j)) * r;
      acc += mix(texture(u_a, uv + d), texture(u_b, uv + d), p);
    }
    o = acc / 81.0;
  }
  else if (u_kind == 15) { // glitch: blocky offsets and split channels around the cut
    float s = sin(p * 3.14159);
    float band = floor(uv.y * 24.0);
    float shift = (hash(vec2(band, floor(p * 20.0))) - 0.5) * 0.12 * s;
    vec2 g = vec2(uv.x + shift, uv.y);
    vec4 src = p < 0.5 ? texture(u_a, g) : texture(u_b, g);
    vec4 rr = p < 0.5 ? texture(u_a, g + vec2(0.01 * s, 0.0)) : texture(u_b, g + vec2(0.01 * s, 0.0));
    o = vec4(rr.r, src.g, src.b, src.a);
  }
  else if (u_kind == 16) { // light leak: a warm glow that washes across
    float s = sin(p * 3.14159);
    float glow = smoothstep(0.9, 0.0, distance(uv, vec2(p * 1.4 - 0.2, 0.6))) * s;
    vec4 base = mix(a, b, p);
    o = vec4(min(vec3(1.0), base.rgb + vec3(1.0, 0.62, 0.3) * glow * 1.2), max(base.a, glow));
  }
  else if (u_kind == 17) { // iris
    float d = distance((uv - 0.5) * vec2(u_size.x / u_size.y, 1.0), vec2(0.0));
    float r = p * length(vec2(u_size.x / u_size.y, 1.0)) * 0.5;
    o = mix(a, b, 1.0 - smoothstep(r - 0.01, r + 0.01, d));
  }
  else o = mix(a, b, p);
}`

// ------------------------------------------------------------------ grading

/**
 * One grade layer: primary correction, curves or a 3D LUT, limited by an
 * optional HSL qualifier and blended by `u_mix`. Works on straight colors and
 * keeps alpha as it was.
 */
export const GRADE = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_tex;
uniform int u_kind;          // 0 primary, 1 curves, 2 LUT
uniform float u_mix;
// primary
uniform vec4 u_lift;
uniform vec4 u_gamma;
uniform vec4 u_gain;
uniform vec4 u_offset;
uniform vec3 u_wb;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_pivot;
uniform float u_sat;
// curves
uniform sampler2D u_curve;   // r, g, b: per channel after master
uniform sampler2D u_hue;     // r: hue shift, g: saturation, b: luma, all centred on 0.5
uniform float u_hasHue;
// LUT
uniform sampler3D u_lut;
uniform float u_lutSize;
uniform float u_intensity;
// qualifier
uniform float u_qual;        // 1 when a qualifier limits this layer
uniform vec4 u_qHue;         // center, width, softness, invert
uniform vec4 u_qSatLum;      // sat low, sat high, lum low, lum high
uniform float u_qShow;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5, h = 0.0, s = 0.0, d = mx - mn;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}
float hue2rgb(float p, float q, float t) {
  t = fract(t);
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 h) {
  if (h.y < 1e-6) return vec3(h.z);
  float q = h.z < 0.5 ? h.z * (1.0 + h.y) : h.z + h.y - h.z * h.y;
  float p = 2.0 * h.z - q;
  return vec3(hue2rgb(p, q, h.x + 1.0 / 3.0), hue2rgb(p, q, h.x), hue2rgb(p, q, h.x - 1.0 / 3.0));
}
// Fully selected inside [lo, hi]; softness only fades outside it.
float band(float v, float lo, float hi, float soft) {
  float s = max(soft, 1e-4);
  return smoothstep(lo - s, lo, v) * (1.0 - smoothstep(hi, hi + s, v));
}

vec3 primary(vec3 c) {
  c *= exp2(u_exposure) * u_wb;
  c *= 1.0 + u_gain.rgb + u_gain.a;
  c += (u_lift.rgb + u_lift.a) * (1.0 - c);
  c = pow(max(c, 0.0), 1.0 / max(1.0 + u_gamma.rgb + u_gamma.a, vec3(0.05)));
  c += u_offset.rgb + u_offset.a;
  c = (c - u_pivot) * u_contrast + u_pivot;
  float y = dot(c, LUMA);
  return clamp(y + (c - y) * u_sat, 0.0, 1.0);
}

vec3 curves(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  // Sample at texel centres of the 256-wide curve.
  vec3 x = c * (255.0 / 256.0) + 0.5 / 256.0;
  c = vec3(texture(u_curve, vec2(x.r, 0.5)).r, texture(u_curve, vec2(x.g, 0.5)).g, texture(u_curve, vec2(x.b, 0.5)).b);
  if (u_hasHue > 0.5) {
    vec3 h = rgb2hsl(c);
    vec3 k = texture(u_hue, vec2(h.x * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb;
    h.x = fract(h.x + (k.r - 0.5));
    h.y = clamp(h.y * k.g * 2.0, 0.0, 1.0);
    h.z = clamp(h.z + (k.b - 0.5) * 0.5, 0.0, 1.0);
    c = hsl2rgb(h);
  }
  return c;
}

vec3 lut(vec3 c) {
  vec3 x = clamp(c, 0.0, 1.0) * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize;
  return mix(c, texture(u_lut, x).rgb, u_intensity);
}

void main() {
  vec4 src = texture(u_tex, v_uv);
  vec3 c = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
  vec3 g = u_kind == 0 ? primary(c) : u_kind == 1 ? curves(c) : lut(c);
  float key = 1.0;
  if (u_qual > 0.5) {
    vec3 h = rgb2hsl(c);
    float dh = abs(fract(h.x - u_qHue.x + 0.5) - 0.5);
    float hk = 1.0 - smoothstep(u_qHue.y * 0.5, u_qHue.y * 0.5 + max(u_qHue.z, 1e-4), dh);
    key = hk * band(h.y, u_qSatLum.x, u_qSatLum.y, u_qHue.z) * band(h.z, u_qSatLum.z, u_qSatLum.w, u_qHue.z);
    if (u_qHue.w > 0.5) key = 1.0 - key;
    if (u_qShow > 0.5) {
      o = vec4(vec3(key) * src.a, src.a);
      return;
    }
  }
  vec3 outc = mix(c, g, key * u_mix);
  o = vec4(outc * src.a, src.a);
}`
