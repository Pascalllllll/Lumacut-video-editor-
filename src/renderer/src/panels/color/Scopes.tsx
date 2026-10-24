import { useEffect, useRef, useState } from 'react'
import { t, td } from '../../i18n'
import { Panel } from '../../components/Panel'
import { currentPlayer, onFrameDrawn } from '../../lib/player'
import { usePlayhead } from '../../state/playhead'
import styles from './Color.module.css'

type Kind = 'waveform' | 'parade' | 'vectorscope' | 'histogram'
const KINDS: Kind[] = ['waveform', 'parade', 'vectorscope', 'histogram']
const SIZE = 256

/** 75% color bar targets on the vectorscope, as (Cb, Cr). */
const TARGETS = (() => {
  const bars: [string, [number, number, number]][] = [
    ['R', [0.75, 0, 0]],
    ['Yl', [0.75, 0.75, 0]],
    ['G', [0, 0.75, 0]],
    ['Cy', [0, 0.75, 0.75]],
    ['B', [0, 0, 0.75]],
    ['Mg', [0.75, 0, 0.75]],
  ]
  return bars.map(([name, [r, g, b]]) => ({
    name,
    x: 0.5 + (-0.1146 * r - 0.3854 * g + 0.5 * b),
    y: 0.5 - (0.5 * r - 0.4542 * g - 0.0458 * b),
  }))
})()

/** Live scopes of the frame in the viewer: waveform, RGB parade, vectorscope and histogram. */
export function Scopes() {
  const [kind, setKind] = useState<Kind>('waveform')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playing = usePlayhead((s) => s.playing)

  useEffect(() => {
    let last = 0
    let pending = 0
    const draw = () => {
      const canvas = canvasRef.current
      const player = currentPlayer()
      if (!canvas || !player) return
      const ctx = canvas.getContext('2d')!
      if (kind === 'histogram') {
        const h = player.histogram()
        ctx.fillStyle = '#0b0c0e'
        ctx.fillRect(0, 0, SIZE, SIZE)
        if (!h) return
        // Ignore the two extreme bins when scaling, so clipped areas don't flatten everything else.
        let peak = 1
        for (let i = 1; i < 255; i++) peak = Math.max(peak, h.r[i]!, h.g[i]!, h.b[i]!)
        ctx.globalCompositeOperation = 'lighter'
        for (const [arr, color] of [
          [h.r, 'rgb(230 70 60 / 0.8)'],
          [h.g, 'rgb(80 210 90 / 0.8)'],
          [h.b, 'rgb(90 130 240 / 0.8)'],
        ] as const) {
          ctx.fillStyle = color
          for (let i = 0; i < 256; i++) {
            const v = Math.min(1, arr[i]! / peak)
            ctx.fillRect(i, SIZE - v * SIZE, 1, v * SIZE)
          }
        }
        ctx.globalCompositeOperation = 'source-over'
        return
      }
      const image = player.scope(kind, SIZE)
      if (image) ctx.putImageData(image, 0, 0)
    }
    const schedule = () => {
      // Keep scopes to about 15 updates a second during playback.
      const now = performance.now()
      if (now - last < 66) {
        cancelAnimationFrame(pending)
        pending = requestAnimationFrame(schedule)
        return
      }
      last = now
      draw()
    }
    draw()
    const off = onFrameDrawn(schedule)
    return () => {
      off()
      cancelAnimationFrame(pending)
    }
  }, [kind, playing])

  return (
    <Panel.Root label={t('scopes.title')} area="scopes">
      <Panel.Header>
        <div className={styles.segmented} role="tablist" aria-label={t('scopes.title')}>
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={styles.segment}
              onClick={() => setKind(k)}
            >
              {td(`scopes.${k}`)}
            </button>
          ))}
        </div>
      </Panel.Header>
      <Panel.Body inset>
        <div className={styles.scopeStage}>
          <div className={styles.scopeBox} data-kind={kind}>
            <canvas
              ref={canvasRef}
              width={SIZE}
              height={SIZE}
              className={styles.scopeCanvas}
              data-testid="scope-canvas"
              aria-label={td(`scopes.${kind}`)}
              role="img"
            />
            <svg
              viewBox="0 0 100 100"
              className={styles.graticule}
              aria-hidden="true"
              preserveAspectRatio="none"
            >
              {kind === 'vectorscope' ? (
                <>
                  <circle cx="50" cy="50" r="45" className={styles.grid} />
                  <line x1="50" y1="5" x2="50" y2="95" className={styles.grid} />
                  <line x1="5" y1="50" x2="95" y2="50" className={styles.grid} />
                  {/* Skin tones fall near this line in most footage. */}
                  <line
                    x1="50"
                    y1="50"
                    x2={50 - 45 * Math.sin((33 * Math.PI) / 180)}
                    y2={50 - 45 * Math.cos((33 * Math.PI) / 180)}
                    className={styles.skin}
                  />
                  {TARGETS.map((tg) => (
                    <g key={tg.name}>
                      <rect
                        x={tg.x * 100 - 2.5}
                        y={tg.y * 100 - 2.5}
                        width="5"
                        height="5"
                        className={styles.target}
                      />
                      <text x={tg.x * 100 + 3.5} y={tg.y * 100 + 1.5} className={styles.label}>
                        {tg.name}
                      </text>
                    </g>
                  ))}
                </>
              ) : (
                [0, 25, 50, 75, 100].map((v) => (
                  <g key={v}>
                    <line x1="0" y1={100 - v} x2="100" y2={100 - v} className={styles.grid} />
                    {kind !== 'histogram' ? (
                      <text
                        x="1"
                        y={Math.min(98, 100 - v + (v === 100 ? 4 : -1))}
                        className={styles.label}
                      >
                        {v}
                      </text>
                    ) : null}
                  </g>
                ))
              )}
              {kind === 'parade' ? (
                <>
                  <line x1="33.33" y1="0" x2="33.33" y2="100" className={styles.grid} />
                  <line x1="66.66" y1="0" x2="66.66" y2="100" className={styles.grid} />
                </>
              ) : null}
            </svg>
          </div>
        </div>
      </Panel.Body>
    </Panel.Root>
  )
}
