/** Grayscale frame, one byte per pixel, row by row. */
export type Gray = { data: Uint8Array; width: number; height: number }

/**
 * Normalized cross-correlation of a template against a frame at (x, y), the
 * template's top-left corner. 1 is a perfect match; brightness changes don't matter.
 */
function ncc(
  frame: Gray,
  tpl: Float32Array,
  tMean: number,
  tNorm: number,
  size: number,
  x: number,
  y: number,
): number {
  let sum = 0
  let sum2 = 0
  let cross = 0
  const n = size * size
  for (let j = 0; j < size; j++) {
    const row = (y + j) * frame.width + x
    for (let i = 0; i < size; i++) {
      const v = frame.data[row + i]!
      sum += v
      sum2 += v * v
      cross += v * tpl[j * size + i]!
    }
  }
  const mean = sum / n
  const norm = Math.sqrt(Math.max(sum2 - n * mean * mean, 1e-6))
  return (cross - n * mean * tMean) / (norm * tNorm)
}

function cut(
  frame: Gray,
  x: number,
  y: number,
  size: number,
): { tpl: Float32Array; mean: number; norm: number } {
  const tpl = new Float32Array(size * size)
  let sum = 0
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const v = frame.data[(y + j) * frame.width + x + i]!
      tpl[j * size + i] = v
      sum += v
    }
  const mean = sum / (size * size)
  let norm = 0
  for (const v of tpl) norm += (v - mean) * (v - mean)
  return { tpl, mean, norm: Math.sqrt(Math.max(norm, 1e-6)) }
}

export type TrackResult = { x: number; y: number; score: number }[]

/**
 * Follows the patch around (x, y) through the frames. The search starts where
 * the patch should be if it keeps its last velocity. The template is refreshed
 * from good matches so slow changes in appearance don't lose the track.
 */
export function trackPoint(
  frames: Gray[],
  x0: number,
  y0: number,
  size = 31,
  radius = 24,
): TrackResult {
  const first = frames[0]
  if (!first) return []
  const half = Math.floor(size / 2)
  const clampX = (x: number) => Math.min(first.width - size, Math.max(0, Math.round(x)))
  const clampY = (y: number) => Math.min(first.height - size, Math.max(0, Math.round(y)))
  let px = clampX(x0 - half)
  let py = clampY(y0 - half)
  let template = cut(first, px, py, size)
  let vx = 0
  let vy = 0
  const result: TrackResult = [{ x: px + half, y: py + half, score: 1 }]
  for (let f = 1; f < frames.length; f++) {
    const frame = frames[f]!
    const cx = clampX(px + vx)
    const cy = clampY(py + vy)
    let best = { x: cx, y: cy, score: -2 }
    for (let dy = -radius; dy <= radius; dy++) {
      const y = cy + dy
      if (y < 0 || y > frame.height - size) continue
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx
        if (x < 0 || x > frame.width - size) continue
        const s = ncc(frame, template.tpl, template.mean, template.norm, size, x, y)
        if (s > best.score) best = { x, y, score: s }
      }
    }
    vx = best.x - px
    vy = best.y - py
    px = best.x
    py = best.y
    if (best.score > 0.85) {
      // Blend in the new look of the patch.
      const fresh = cut(frame, px, py, size)
      for (let i = 0; i < template.tpl.length; i++)
        template.tpl[i] = template.tpl[i]! * 0.7 + fresh.tpl[i]! * 0.3
      let sum = 0
      for (const v of template.tpl) sum += v
      const mean = sum / template.tpl.length
      let norm = 0
      for (const v of template.tpl) norm += (v - mean) * (v - mean)
      template = { tpl: template.tpl, mean, norm: Math.sqrt(Math.max(norm, 1e-6)) }
    }
    result.push({ x: px + half, y: py + half, score: best.score })
  }
  return result
}

export type Motion = { dx: number; dy: number; angle: number }

/**
 * Camera movement from one frame to the next, from blocks on a grid that are
 * searched for in the next frame. Flat blocks are skipped; the median
 * displacement gives the shift and a least-squares fit gives the rotation.
 */
export function frameMotion(prev: Gray, cur: Gray, block = 24, radius = 16): Motion {
  const vectors: { px: number; py: number; dx: number; dy: number }[] = []
  const cols = 5
  const rows = 4
  const cx = prev.width / 2
  const cy = prev.height / 2
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const bx = Math.round(((c + 0.5) / cols) * prev.width - block / 2)
      const by = Math.round(((r + 0.5) / rows) * prev.height - block / 2)
      if (
        bx - radius < 0 ||
        by - radius < 0 ||
        bx + block + radius > prev.width ||
        by + block + radius > prev.height
      )
        continue
      const t = cut(prev, bx, by, block)
      if (t.norm / block < 6) continue // too flat to match reliably
      let best = { dx: 0, dy: 0, score: -2 }
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const s = ncc(cur, t.tpl, t.mean, t.norm, block, bx + dx, by + dy)
          if (s > best.score) best = { dx, dy, score: s }
        }
      }
      if (best.score > 0.6)
        vectors.push({ px: bx + block / 2 - cx, py: by + block / 2 - cy, dx: best.dx, dy: best.dy })
    }
  }
  if (vectors.length === 0) return { dx: 0, dy: 0, angle: 0 }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
  }
  const dx = median(vectors.map((v) => v.dx))
  const dy = median(vectors.map((v) => v.dy))
  // Small-angle rotation about the centre: d - t ≈ θ × p.
  let num = 0
  let den = 0
  for (const v of vectors) {
    const rx = v.dx - dx
    const ry = v.dy - dy
    num += v.px * ry - v.py * rx
    den += v.px * v.px + v.py * v.py
  }
  return { dx, dy, angle: den > 0 ? num / den : 0 }
}

/**
 * Turns frame-to-frame motion into per-frame corrections that remove shake
 * but keep slow, intentional camera moves. `window` is the smoothing length
 * in frames. Returns dx, dy (pixels) and angle (radians) per frame, flattened.
 */
export function stabilizeCorrections(motions: Motion[], window: number): number[] {
  const path: Motion[] = [{ dx: 0, dy: 0, angle: 0 }]
  for (const m of motions) {
    const last = path[path.length - 1]!
    path.push({ dx: last.dx + m.dx, dy: last.dy + m.dy, angle: last.angle + m.angle })
  }
  const half = Math.max(1, Math.round(window / 2))
  const out: number[] = []
  for (let i = 0; i < path.length; i++) {
    let sx = 0
    let sy = 0
    let sa = 0
    let n = 0
    for (let j = Math.max(0, i - half); j <= Math.min(path.length - 1, i + half); j++) {
      sx += path[j]!.dx
      sy += path[j]!.dy
      sa += path[j]!.angle
      n++
    }
    out.push(sx / n - path[i]!.dx, sy / n - path[i]!.dy, sa / n - path[i]!.angle)
  }
  return out
}
