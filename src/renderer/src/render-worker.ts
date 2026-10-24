import { buildScene, mediaLayers, type Layer } from '@engine/scene'
import { fpsValue } from '@engine/time'
import { Compositor, type FrameSource, type Picture } from '../../render/compositor'
import { getLut, preloadLuts } from './lib/luts'

type MediaSource = Extract<Layer['source'], { kind: 'media' }>

/**
 * Reads raw RGBA frames for one layer from FFmpeg and hands out the frame
 * closest to each requested source time. Forward streams only move forward;
 * reversed ones are decoded backwards by FFmpeg and read the same way.
 */
class LayerDecoder {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private carry = new Uint8Array(0)
  private current: Uint8Array | null = null
  private next: Uint8Array | null = null
  private index = -1
  private ended = false
  readonly frameBytes: number

  constructor(
    private readonly src: MediaSource,
    readonly width: number,
    readonly height: number,
    private readonly startTime: number,
    private readonly fps: number,
    private readonly reverse: boolean,
    private readonly still: boolean,
    private readonly target: { colorSpace: 'rec709' | 'p3' | 'rec2020'; hdr: 'sdr' | 'pq' | 'hlg' },
    readonly deep: boolean,
  ) {
    this.frameBytes = width * height * (deep ? 8 : 4)
  }

  async open() {
    const asset = this.src.asset
    const duration = (asset.duration ?? 0) - this.startTime
    const { url } = await window.lumacut.invoke('render:decode', {
      path: asset.path,
      start: this.reverse ? this.src.rangeStart : this.startTime,
      duration: this.reverse
        ? Math.max(0.04, this.startTime - this.src.rangeStart + 1 / this.fps)
        : Math.max(0.04, duration + 1),
      fps: this.fps,
      width: this.width,
      height: this.height,
      reverse: this.reverse,
      interpolation: this.src.interpolation,
      still: this.still,
      sourceHeight: asset.height ?? this.height,
      alpha: asset.alpha,
      color: asset.color,
      target: this.target,
    })
    const res = await fetch(url)
    if (!res.ok || !res.body) throw new Error(`Couldn't decode ${asset.name}.`)
    this.reader = res.body.getReader()
  }

  private async readFrame(): Promise<Uint8Array | null> {
    if (this.ended || !this.reader) return null
    while (this.carry.length < this.frameBytes) {
      const { value, done } = await this.reader.read()
      if (done) {
        this.ended = true
        return null
      }
      const merged = new Uint8Array(this.carry.length + value.length)
      merged.set(this.carry)
      merged.set(value, this.carry.length)
      this.carry = merged
    }
    const frame = this.carry.slice(0, this.frameBytes)
    this.carry = this.carry.subarray(this.frameBytes)
    return frame
  }

  /** Time of the i-th decoded frame. */
  private timeOf(i: number) {
    if (this.reverse) return this.startTime - i / this.fps
    return this.startTime + i / this.fps
  }

  async frameAt(time: number): Promise<Uint8Array | null> {
    if (this.still) {
      if (!this.current) this.current = await this.readFrame()
      return this.current
    }
    if (!this.current) {
      this.current = await this.readFrame()
      this.index = 0
    }
    // Move on while the next frame is closer to the wanted time.
    for (;;) {
      const nextTime = this.timeOf(this.index + 1)
      const closer = this.reverse
        ? nextTime >= time - 0.5 / this.fps
        : nextTime <= time + 0.5 / this.fps
      if (!closer) break
      this.next = await this.readFrame()
      if (!this.next) break
      this.current = this.next
      this.index++
    }
    return this.current
  }

  /** Whether `time` can still be served without going back. */
  canServe(time: number) {
    if (this.still) return true
    const at = this.timeOf(Math.max(this.index, 0))
    return this.reverse ? time <= at + 1e-6 : time >= at - 1e-6
  }

  close() {
    void this.reader?.cancel().catch(() => undefined)
  }
}

/** 16-bit little-endian RGBA to 0-to-1 floats for the compositor. */
function toFloat(bytes: Uint8Array): Float32Array {
  const u = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
  const f = new Float32Array(u.length)
  for (let i = 0; i < u.length; i++) f[i] = u[i]! / 65535
  return f
}

/** Decode size: no bigger than the picture needs to be at its largest on screen. */
function decodeSize(layer: Layer, seqW: number, seqH: number): { w: number; h: number } {
  const scale = Math.max(1, layer.transform.scaleX, layer.transform.scaleY)
  const k = Math.min(
    1,
    Math.max(layer.fit * scale, Math.min(seqW / layer.width, seqH / layer.height)),
  )
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return { w: even(layer.width * k), h: even(layer.height * k) }
}

export async function runRender(jobId: string) {
  try {
    await document.fonts.ready
    const job = await window.lumacut.invoke('render:job', { jobId })
    const seq = job.project.sequences[job.sequenceId]
    if (!seq) throw new Error('The sequence to export no longer exists.')
    const canvas = document.createElement('canvas')
    const deep = seq.hdr !== 'sdr'
    const target = { colorSpace: seq.colorSpace, hdr: seq.hdr }
    const compositor = new Compositor(canvas, { float: deep })
    await preloadLuts(job.project)
    compositor.lutSource = getLut
    const decoders = new Map<string, LayerDecoder>()
    const pictures = new Map<string, Picture>()
    const source: FrameSource = { picture: (layer) => pictures.get(layer.key) ?? null }

    for (let i = 0; i < job.frames; i++) {
      const frame = job.start + i
      const scene = buildScene(job.project, seq, frame)
      pictures.clear()
      const live = new Set<string>()
      for (const layer of mediaLayers(scene)) {
        if (layer.source.kind !== 'media') continue
        const src = layer.source
        live.add(layer.key)
        let dec = decoders.get(layer.key)
        const reverse = src.rate < 0
        if (!dec || !dec.canServe(src.time)) {
          dec?.close()
          const { w, h } = decodeSize(layer, seq.width, seq.height)
          const speed = Math.abs(src.rate)
          // Slow motion with smoothing asks FFmpeg for one frame per output frame.
          const smooth = src.interpolation !== 'none' && speed > 0 && speed < 1
          const fps = smooth
            ? fpsValue(seq.fps) / speed
            : src.asset.fps
              ? fpsValue(src.asset.fps)
              : fpsValue(seq.fps)
          dec = new LayerDecoder(
            src,
            w,
            h,
            src.time,
            fps,
            reverse,
            src.asset.kind === 'image' || src.rate === 0,
            target,
            deep,
          )
          await dec.open()
          decoders.set(layer.key, dec)
        }
        const data = await dec.frameAt(src.time)
        if (data)
          pictures.set(layer.key, {
            data: dec.deep ? toFloat(data) : data,
            width: dec.width,
            height: dec.height,
          })
      }
      for (const [key, dec] of decoders) {
        if (live.has(key)) continue
        dec.close()
        decoders.delete(key)
      }
      const pixels = compositor.read(scene, source, frame, [0, 0, 0], job.alpha)
      const accepted = await window.lumacut.invoke('render:frame', { jobId, data: pixels })
      if (!accepted) break
    }
    for (const dec of decoders.values()) dec.close()
    compositor.dispose()
    await window.lumacut.invoke('render:finish', { jobId })
  } catch (error) {
    await window.lumacut.invoke('render:fail', {
      jobId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
