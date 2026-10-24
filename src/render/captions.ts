import { cueLines } from '@engine/captions'
import type { CaptionCue, CaptionStyle } from '@engine/model'

/**
 * Draws one caption into a frame-sized canvas. Templates: clean (white text
 * with a soft shadow), boxed (on a dark band), bold (heavier, outlined) and
 * karaoke (the word being spoken in the highlight colour).
 */
export function paintCaption(
  ctx: OffscreenCanvasRenderingContext2D,
  cue: CaptionCue,
  style: CaptionStyle,
  frame: number,
  width: number,
  height: number,
) {
  const scale = height / 1080
  const size = style.size * scale
  const weight = style.template === 'bold' || style.template === 'karaoke' ? 800 : 600
  ctx.clearRect(0, 0, width, height)
  ctx.save()
  ctx.font = `${weight} ${size}px "${style.font}", "Inter Variable", sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  const upper = (s: string) => (style.uppercase ? s.toUpperCase() : s)
  const lines = cueLines(upper(cue.text))
  const lineHeight = size * 1.25
  const centreY = style.position * height
  const top = centreY - (lineHeight * lines.length) / 2
  const widths = lines.map((l) => ctx.measureText(l).width)

  if (style.template === 'boxed') {
    const pad = size * 0.35
    const w = Math.max(...widths)
    ctx.fillStyle = 'rgb(0 0 0 / 0.62)'
    ctx.beginPath()
    ctx.roundRect(
      (width - w) / 2 - pad,
      top - pad * 0.5,
      w + pad * 2,
      lineHeight * lines.length + pad,
      size * 0.18,
    )
    ctx.fill()
  }

  // The word being spoken, counted across the caption's words, for karaoke.
  const active =
    style.template === 'karaoke'
      ? cue.words.findIndex((w) => frame >= w.start && frame < w.end)
      : -1
  let wordIndex = 0
  lines.forEach((line, li) => {
    const y = top + lineHeight * (li + 0.5)
    let x = (width - widths[li]!) / 2
    for (const word of line.split(' ')) {
      const w = ctx.measureText(word).width
      const lit = wordIndex === active
      if (style.template === 'bold' || style.template === 'karaoke') {
        ctx.lineJoin = 'round'
        ctx.lineWidth = size * 0.14
        ctx.strokeStyle = 'rgb(0 0 0 / 0.85)'
        ctx.strokeText(word, x, y)
      } else if (style.template === 'clean') {
        ctx.shadowColor = 'rgb(0 0 0 / 0.7)'
        ctx.shadowBlur = size * 0.18
        ctx.shadowOffsetY = size * 0.04
      }
      ctx.fillStyle = lit ? style.highlight : style.color
      ctx.fillText(word, x, y)
      ctx.shadowColor = 'transparent'
      x += w + ctx.measureText(' ').width
      wordIndex++
    }
  })
  ctx.restore()
}
