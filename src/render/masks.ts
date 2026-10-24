import type { EvaluatedMask } from '@engine/scene'

type Canvas = OffscreenCanvas
type Ctx = OffscreenCanvasRenderingContext2D

/** Masks are drawn at up to this many pixels on the long side; soft edges don't need more. */
const MAX_SIDE = 1536

function shapePath(mask: EvaluatedMask, w: number, h: number): Path2D {
  const g = mask.geometry
  const path = new Path2D()
  if (mask.shape === 'rectangle') {
    path.rect((g[0] ?? 0) * w, (g[1] ?? 0) * h, (g[2] ?? 1) * w, (g[3] ?? 1) * h)
  } else if (mask.shape === 'ellipse') {
    const rx = ((g[2] ?? 1) * w) / 2
    const ry = ((g[3] ?? 1) * h) / 2
    path.ellipse(
      (g[0] ?? 0) * w + rx,
      (g[1] ?? 0) * h + ry,
      Math.abs(rx),
      Math.abs(ry),
      0,
      0,
      Math.PI * 2,
    )
  } else {
    const count = Math.floor(g.length / 6)
    for (let i = 0; i < count; i++) {
      const [x, y] = [g[i * 6]! * w, g[i * 6 + 1]! * h]
      if (i === 0) {
        path.moveTo(x, y)
        continue
      }
      const p = (i - 1) * 6
      const [px, py] = [g[p]! * w, g[p + 1]! * h]
      path.bezierCurveTo(
        px + g[p + 4]! * w,
        py + g[p + 5]! * h,
        x + g[i * 6 + 2]! * w,
        y + g[i * 6 + 3]! * h,
        x,
        y,
      )
    }
    if (count > 2) {
      // Close back to the first point through its in-handle.
      const l = (count - 1) * 6
      path.bezierCurveTo(
        g[l]! * w + g[l + 4]! * w,
        g[l + 1]! * h + g[l + 5]! * h,
        g[0]! * w + g[2]! * w,
        g[1]! * h + g[3]! * h,
        g[0]! * w,
        g[1]! * h,
      )
    }
    path.closePath()
  }
  return path
}

function drawOne(ctx: Ctx, mask: EvaluatedMask, w: number, h: number, scale: number) {
  const path = shapePath(mask, w, h)
  ctx.save()
  ctx.filter = mask.feather > 0 ? `blur(${(mask.feather * scale) / 2}px)` : 'none'
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'
  ctx.lineJoin = 'round'
  if (mask.invert) {
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'destination-out'
  }
  ctx.fill(path)
  const grow = mask.expansion * scale
  if (grow > 0) {
    ctx.lineWidth = grow * 2
    ctx.stroke(path)
  } else if (grow < 0) {
    // Shrink by cutting a band off the edge.
    ctx.globalCompositeOperation = mask.invert ? 'source-over' : 'destination-out'
    ctx.lineWidth = -grow * 2
    ctx.stroke(path)
  }
  ctx.restore()
}

/**
 * Draws a clip's masks into one alpha canvas in picture space. Returns null
 * when the clip has no masks. `srcW`/`srcH` is the picture's pixel size.
 */
export class MaskPainter {
  private canvas: Canvas | null = null
  private scratch: Canvas | null = null
  private lastKey = ''

  paint(
    masks: EvaluatedMask[],
    srcW: number,
    srcH: number,
  ): { canvas: Canvas; changed: boolean } | null {
    if (masks.length === 0) return null
    const scale = Math.min(1, MAX_SIDE / Math.max(srcW, srcH))
    const w = Math.max(1, Math.round(srcW * scale))
    const h = Math.max(1, Math.round(srcH * scale))
    const key = `${w}x${h}|${JSON.stringify(masks)}`
    if (this.canvas && key === this.lastKey) return { canvas: this.canvas, changed: false }
    this.lastKey = key
    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas = new OffscreenCanvas(w, h)
      this.scratch = new OffscreenCanvas(w, h)
    }
    const ctx = this.canvas.getContext('2d')!
    const sctx = this.scratch!.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    // A first mask that subtracts or intersects starts from the whole picture.
    if (masks[0]!.mode !== 'add') {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
    }
    for (const mask of masks) {
      sctx.clearRect(0, 0, w, h)
      drawOne(sctx, mask, w, h, scale)
      ctx.save()
      ctx.globalAlpha = Math.min(1, Math.max(0, mask.opacity))
      ctx.globalCompositeOperation =
        mask.mode === 'add'
          ? 'source-over'
          : mask.mode === 'subtract'
            ? 'destination-out'
            : 'destination-in'
      ctx.drawImage(this.scratch!, 0, 0)
      ctx.restore()
    }
    return { canvas: this.canvas, changed: true }
  }
}
