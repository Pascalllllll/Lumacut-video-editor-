import type { Title } from '@engine/model'

type Unit = { text: string; line: number; x: number; width: number }

function unitProgress(
  index: number,
  count: number,
  frame: number,
  duration: number,
  frames: number,
  kind: 'in' | 'out',
): number {
  // Units start one after another across the first half of the animation and each takes the other half.
  const span = Math.max(1, frames / 2)
  const stagger = count > 1 ? span / (count - 1) : 0
  if (kind === 'in') return Math.min(1, Math.max(0, (frame - index * stagger) / span))
  const start = duration - frames + index * stagger
  return 1 - Math.min(1, Math.max(0, (frame - start) / span))
}

const ease = (k: number) => 1 - (1 - k) ** 3

/**
 * Draws a title into a canvas the size of the frame. `scale` converts the
 * title's sizes (set for a 1080-pixel-tall frame) to the sequence height.
 */
export function paintTitle(
  ctx: OffscreenCanvasRenderingContext2D,
  title: Title,
  frame: number,
  duration: number,
  width: number,
  height: number,
) {
  const scale = height / 1080
  const size = title.size * scale
  ctx.clearRect(0, 0, width, height)
  ctx.save()
  const font = `${title.italic ? 'italic ' : ''}${title.weight} ${size}px "${title.font}", "Inter Variable", sans-serif`
  ctx.font = font
  ctx.textBaseline = 'alphabetic'
  ;(ctx as unknown as { letterSpacing: string }).letterSpacing =
    `${(title.tracking / 1000) * size}px`

  const lines = title.text.split('\n')
  const lineHeight = size * title.leading
  const metrics = lines.map((l) => ctx.measureText(l || ' '))
  const blockW = Math.max(...metrics.map((m) => m.width))
  const blockH = lineHeight * lines.length
  const top = (height - blockH) / 2
  const lineX = (i: number) => {
    const w = metrics[i]!.width
    if (title.align === 'left') return (width - blockW) / 2
    if (title.align === 'right') return (width + blockW) / 2 - w
    return (width - w) / 2
  }

  // Background box behind the whole block.
  if (title.box.enabled) {
    const pad = title.box.padding * scale
    ctx.save()
    ctx.globalAlpha = title.box.opacity
    ctx.fillStyle = title.box.color
    ctx.beginPath()
    ctx.roundRect(
      (width - blockW) / 2 - pad,
      top - pad + (lineHeight - size) / 2,
      blockW + pad * 2,
      blockH + pad * 2 - (lineHeight - size),
      title.box.radius * scale,
    )
    ctx.fill()
    ctx.restore()
  }

  // Split into animation units with their positions.
  const units: Unit[] = []
  lines.forEach((line, li) => {
    const x0 = lineX(li)
    if (title.animateBy === 'line' || title.animateBy === 'all') {
      units.push({ text: line, line: li, x: x0, width: metrics[li]!.width })
      return
    }
    const parts = title.animateBy === 'word' ? line.split(/(\s+)/) : [...line]
    let consumed = ''
    for (const part of parts) {
      const x = x0 + ctx.measureText(consumed).width
      consumed += part
      if (part.trim()) units.push({ text: part, line: li, x, width: ctx.measureText(part).width })
    }
  })
  const allAtOnce = title.animateBy === 'all'

  const fill = (() => {
    if (title.fill.kind === 'solid') return title.fill.color
    const rad = ((title.fill.angle - 90) * Math.PI) / 180
    const cx = width / 2
    const cy = top + blockH / 2
    const r = Math.max(blockW, blockH) / 2
    const g = ctx.createLinearGradient(
      cx - Math.cos(rad) * r,
      cy - Math.sin(rad) * r,
      cx + Math.cos(rad) * r,
      cy + Math.sin(rad) * r,
    )
    g.addColorStop(0, title.fill.color)
    g.addColorStop(1, title.fill.color2)
    return g
  })()

  units.forEach((unit, i) => {
    const index = allAtOnce ? 0 : i
    const count = allAtOnce ? 1 : units.length
    let k = 1
    let style: Title['animateIn'] = 'none'
    const pin =
      title.animateIn !== 'none'
        ? unitProgress(index, count, frame, duration, title.animateFrames, 'in')
        : 1
    const pout =
      title.animateOut !== 'none'
        ? unitProgress(index, count, frame, duration, title.animateFrames, 'out')
        : 1
    if (pin < 1) {
      k = ease(pin)
      style = title.animateIn
    } else if (pout < 1) {
      k = ease(pout)
      style = title.animateOut
    }
    if (k <= 0 && style !== 'none') return
    const baseY = top + unit.line * lineHeight + (lineHeight + size * 0.7) / 2
    ctx.save()
    let alpha = 1
    let dy = 0
    let s = 1
    if (style === 'typewriter') alpha = k > 0 ? 1 : 0
    else if (style !== 'none') alpha = k
    if (style === 'rise') dy = (1 - k) * size * 0.6
    if (style === 'drop') dy = -(1 - k) * size * 0.6
    if (style === 'scale') s = 0.5 + 0.5 * k
    if (style === 'blur') ctx.filter = `blur(${(1 - k) * size * 0.25}px)`
    ctx.globalAlpha = alpha
    const cx = unit.x + unit.width / 2
    ctx.translate(cx, baseY + dy)
    ctx.scale(s, s)
    ctx.translate(-cx, -baseY)
    if (title.shadow.enabled) {
      ctx.shadowColor = hexWithAlpha(title.shadow.color, title.shadow.opacity)
      ctx.shadowBlur = title.shadow.blur * scale
      ctx.shadowOffsetX = title.shadow.x * scale
      ctx.shadowOffsetY = title.shadow.y * scale
    }
    if (title.stroke.width > 0) {
      ctx.lineJoin = 'round'
      ctx.lineWidth = title.stroke.width * 2 * scale
      ctx.strokeStyle = title.stroke.color
      ctx.strokeText(unit.text, unit.x, baseY)
      ctx.shadowColor = 'transparent'
    }
    ctx.fillStyle = fill
    ctx.fillText(unit.text, unit.x, baseY)
    ctx.restore()
  })
  ctx.restore()
}

function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex)
  if (!m) return `rgba(0,0,0,${alpha})`
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${alpha})`
}
