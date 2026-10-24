import type { Project, Sequence } from '@engine/model'
import { resolveAudio, type Leaf } from '@engine/resolve'
import { buildScene, mediaLayers, type Layer } from '@engine/scene'
import { fpsValue } from '@engine/time'
import { sequenceDuration } from '@engine/timeline'
import { Compositor, type FrameSource, type Picture } from '../../../render/compositor'
import { getLut } from './luts'
import { Mixer } from './mixer'

/** Media elements are re-seeked when they drift further than this from the clock. */
const MAX_DRIFT = 0.12
/** Chromium's playbackRate limits. */
const MIN_RATE = 0.0625
const MAX_RATE = 16

export type PlayerSource = {
  project: () => Project
  sequence: () => Sequence
  /** URL to play for a media item: its proxy when one should be used, otherwise the file. */
  url: (asset: Leaf['asset']) => string
  /** Preview size relative to the sequence. */
  scale: () => number
}

/**
 * Drives the viewer from one clock. Each visible media layer gets its own
 * video (or image) element; the compositor draws the scene from them onto a
 * canvas. Every audible clip gets an audio element, routed through the mixer.
 * Elements are pointed at the time the scene asks for and pulled back into
 * line when they drift.
 */
const drawListeners = new Set<() => void>()
let current: Player | null = null

/** The viewer registers its player here so other panels (scopes) can read its last frame. */
export function setCurrentPlayer(player: Player | null) {
  current = player
}

/** The viewer's player, for panels that read its last frame (scopes). */
export function currentPlayer(): Player | null {
  return current
}

/** Calls `fn` after every frame the viewer draws; returns an unsubscribe function. */
export function onFrameDrawn(fn: () => void): () => void {
  drawListeners.add(fn)
  return () => drawListeners.delete(fn)
}

export class Player implements FrameSource {
  private raf = 0
  private startedAt = 0
  private startFrame = 0
  private rate = 1
  private lastFrame = -1
  private playing = false
  private readonly pictures = new Map<string, HTMLVideoElement | HTMLImageElement>()
  private readonly voices = new Map<string, HTMLAudioElement>()
  private readonly compositor: Compositor
  readonly mixer = new Mixer()
  private pendingDraw = 0

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: HTMLElement,
    private readonly source: PlayerSource,
    private readonly onFrame: (frame: number) => void,
    private readonly onEnded: () => void,
    private readonly onError: (message: string | null) => void = () => undefined,
  ) {
    this.compositor = new Compositor(canvas)
    this.compositor.lutSource = getLut
    window.addEventListener('lumacut:lut-loaded', this.onLut)
  }

  /** The last frame this player reported, so outside seeks can be told apart from its own updates. */
  get reportedFrame() {
    return this.lastFrame
  }

  picture(layer: Layer): Picture | null {
    const el = this.pictures.get(layer.key)
    if (!el) return null
    if (el instanceof HTMLImageElement) return el.complete && el.naturalWidth > 0 ? el : null
    // Before a decoded frame exists, keep showing the previous one.
    return el.readyState >= 2 ? el : null
  }

  play(fromFrame: number, rate = 1) {
    cancelAnimationFrame(this.raf)
    const end = sequenceDuration(this.source.sequence())
    this.rate = rate
    this.playing = true
    this.mixer.resume()
    this.startFrame = rate > 0 && fromFrame >= end ? 0 : fromFrame
    this.startedAt = performance.now()
    this.lastFrame = this.startFrame
    this.sync(this.startFrame)
    const tick = () => {
      const seq = this.source.sequence()
      const total = sequenceDuration(seq)
      const elapsed = (performance.now() - this.startedAt) / 1000
      const frame = this.startFrame + Math.trunc(elapsed * fpsValue(seq.fps) * this.rate)
      if (frame >= total || frame < 0) {
        this.stop()
        this.lastFrame = frame < 0 ? 0 : total
        this.onFrame(this.lastFrame)
        this.onEnded()
        return
      }
      if (frame !== this.lastFrame) {
        this.lastFrame = frame
        this.sync(frame)
        this.onFrame(frame)
      } else {
        // Videos advance between our frames; keep the canvas in step with them.
        this.draw(frame)
      }
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.playing = false
    for (const el of this.pictures.values()) if (el instanceof HTMLVideoElement) el.pause()
    for (const a of this.voices.values()) a.pause()
  }

  /** Shows the frame without playing. */
  show(frame: number) {
    this.lastFrame = frame
    this.sync(frame)
  }

  private readonly onLut = () => this.redrawSoon()

  scope(kind: 'waveform' | 'parade' | 'vectorscope', size = 256) {
    return this.compositor.scope(kind, size)
  }

  histogram() {
    return this.compositor.histogram()
  }

  dispose() {
    if (currentPlayer() === this) setCurrentPlayer(null)
    window.removeEventListener('lumacut:lut-loaded', this.onLut)
    this.stop()
    cancelAnimationFrame(this.pendingDraw)
    for (const el of this.pictures.values()) el.remove()
    for (const a of this.voices.values()) a.remove()
    this.pictures.clear()
    this.voices.clear()
    this.compositor.dispose()
    this.mixer.dispose()
  }

  private draw(frame: number) {
    const project = this.source.project()
    const seq = this.source.sequence()
    this.present(buildScene(project, seq, frame))
  }

  /** Drawing problems stay in the viewer; they must never break the edit that triggered a redraw. */
  private present(scene: ReturnType<typeof buildScene>) {
    try {
      this.compositor.present(scene, this, this.source.scale())
      this.onError(null)
      // The frame is settled once every picture shows the time the scene asked for.
      const fps = fpsValue(this.source.sequence().fps)
      const settled = mediaLayers(scene).every((layer) => {
        const el = this.pictures.get(layer.key)
        if (!(el instanceof HTMLVideoElement) || layer.source.kind !== 'media') return true
        return (
          el.readyState >= 2 &&
          !el.seeking &&
          Math.abs(el.currentTime - layer.source.time) < 0.6 / fps
        )
      })
      if (settled) this.canvas.dataset['settled'] = String(this.lastFrame)
      for (const fn of drawListeners) fn()
    } catch (error) {
      this.onError(error instanceof Error ? error.message : String(error))
    }
  }

  private sync(frame: number) {
    const project = this.source.project()
    const seq = this.source.sequence()
    const scene = buildScene(project, seq, frame)
    const live = new Set<string>()

    for (const layer of mediaLayers(scene)) {
      if (layer.source.kind !== 'media') continue
      live.add(layer.key)
      const asset = layer.source.asset
      let el = this.pictures.get(layer.key)
      const wantImage = asset.kind === 'image'
      if (!el || el instanceof HTMLImageElement !== wantImage) {
        el?.remove()
        if (wantImage) {
          el = document.createElement('img')
          el.crossOrigin = 'anonymous'
        } else {
          const video = document.createElement('video')
          video.crossOrigin = 'anonymous'
          video.muted = true
          video.preload = 'auto'
          video.playsInline = true
          // Redraw once a seek lands, so a paused viewer shows the right picture.
          video.addEventListener('seeked', () => this.redrawSoon())
          video.addEventListener('loadeddata', () => this.redrawSoon())
          el = video
        }
        el.hidden = true
        this.host.append(el)
        this.pictures.set(layer.key, el)
      }
      const src = this.source.url(asset)
      if (el instanceof HTMLImageElement) {
        if (el.getAttribute('src') !== src) {
          el.onload = () => this.redrawSoon()
          el.setAttribute('src', src)
        }
      } else {
        this.drive(el, src, layer.source.time, layer.source.rate)
      }
    }
    for (const [key, el] of this.pictures) {
      if (live.has(key)) continue
      el.remove()
      this.pictures.delete(key)
    }
    this.compositor.prune(new Set([...live, ...this.layerKeys(scene)]))

    const sounds = this.playing && Math.abs(this.rate) <= 4 ? resolveAudio(project, seq, frame) : []
    const audible = new Set<string>()
    for (const leaf of sounds) {
      audible.add(leaf.key)
      let element = this.voices.get(leaf.key)
      if (!element) {
        element = document.createElement('audio')
        // Web Audio only hears media served with CORS when the element asks for it.
        element.crossOrigin = 'anonymous'
        element.preload = 'auto'
        this.host.append(element)
        this.voices.set(leaf.key, element)
        this.mixer.attach(leaf.key, element)
      }
      this.drive(element, this.source.url(leaf.asset), leaf.time, leaf.rate)
    }
    for (const [key, element] of this.voices) {
      if (audible.has(key)) continue
      element.pause()
      element.remove()
      this.voices.delete(key)
      this.mixer.detach(key)
    }
    this.mixer.update(seq, sounds, this.playing ? 1 / fpsValue(seq.fps) : 0)

    this.present(scene)
  }

  private layerKeys(scene: ReturnType<typeof buildScene>): string[] {
    const keys: string[] = []
    const visit = (item: (typeof scene.items)[number] | null) => {
      if (!item) return
      if (item.kind === 'adjustment') keys.push(item.key)
      else if (item.kind === 'transition') {
        visit(item.from)
        visit(item.to)
      } else {
        keys.push(item.key)
        if (item.source.kind === 'nested') item.source.scene.items.forEach(visit)
      }
    }
    scene.items.forEach(visit)
    return keys
  }

  private redrawSoon() {
    if (this.playing) return
    cancelAnimationFrame(this.pendingDraw)
    this.pendingDraw = requestAnimationFrame(() => this.draw(this.lastFrame))
  }

  private drive(element: HTMLMediaElement, src: string, time: number, leafRate: number) {
    const changed = element.getAttribute('src') !== src
    if (changed) element.setAttribute('src', src)
    const rate = leafRate * (this.playing ? this.rate : 1)
    // Elements can't play backwards or hold still while "playing", so those cases step by seeking.
    if (!this.playing || rate <= 0) {
      element.pause()
      if (changed || Math.abs(element.currentTime - time) > 0.001) element.currentTime = time
      return
    }
    element.playbackRate = Math.min(MAX_RATE, Math.max(MIN_RATE, rate))
    if (changed || Math.abs(element.currentTime - time) > MAX_DRIFT * Math.max(1, rate))
      element.currentTime = time
    if (element.paused) void element.play().catch(() => undefined)
  }
}
