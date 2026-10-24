import type { EvaluatedTransform } from './scene'

/** Enough of a layer to place its picture in the frame. */
export type Placement = {
  width: number
  height: number
  fit: number
  transform: EvaluatedTransform
}

/**
 * Picture coordinates (0 to 1, y down) to frame pixels (y down). Same mapping
 * the compositor uses: scale and turn around the anchor, then move.
 */
export function pictureToFrame(
  p: Placement,
  frameW: number,
  frameH: number,
  u: number,
  v: number,
): { x: number; y: number } {
  const t = p.transform
  const sx = (u - 0.5) * p.width - t.anchorX
  const sy = (v - 0.5) * p.height - t.anchorY
  const kx = p.fit * t.scaleX
  const ky = p.fit * t.scaleY
  const a = (t.rotation * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return {
    x: frameW / 2 + t.x + cos * sx * kx - sin * sy * ky,
    y: frameH / 2 + t.y + sin * sx * kx + cos * sy * ky,
  }
}

export function frameToPicture(
  p: Placement,
  frameW: number,
  frameH: number,
  x: number,
  y: number,
): { u: number; v: number } {
  const t = p.transform
  const dx = x - frameW / 2 - t.x
  const dy = y - frameH / 2 - t.y
  const a = (t.rotation * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const rx = cos * dx + sin * dy
  const ry = -sin * dx + cos * dy
  const sx = rx / (p.fit * t.scaleX || 1e-6) + t.anchorX
  const sy = ry / (p.fit * t.scaleY || 1e-6) + t.anchorY
  return { u: sx / p.width + 0.5, v: sy / p.height + 0.5 }
}
