import { audioParams, dbToGain } from '@engine/audio'
import type { AudioEffect, Bus, Sequence } from '@engine/model'
import type { AudioLeaf } from '@engine/resolve'
import type { LoudnessReading } from '../../../audio/loudness'
import { reverbImpulse } from '../../../audio/dsp'
import workletUrl from './audio-worklet.ts?worker&url'

export type MeterReading = { left: number; right: number }
export type MasterReading = MeterReading & { loudness: LoudnessReading | null }

/**
 * An effect list as audio nodes. Runs of effects share one worklet node;
 * reverb is a native convolver with the same impulse export uses. The nodes
 * are rebuilt only when the list's shape changes; parameter changes are sent
 * to the worklet as messages.
 */
class Chain {
  readonly input: GainNode
  readonly output: GainNode
  private nodes: AudioNode[] = []
  private worklets: { node: AudioWorkletNode; effects: AudioEffect[] }[] = []
  private shape = ''

  constructor(private readonly mixer: Mixer) {
    // Mono sources become two equal channels here, as export does, before any pan.
    this.input = new GainNode(mixer.ctx, {
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    })
    this.output = mixer.ctx.createGain()
    this.input.connect(this.output)
  }

  set(effects: AudioEffect[]) {
    const active = this.mixer.workletReady ? effects.filter((fx) => fx.enabled) : []
    const runs = runsOf(active)
    const shape = runs
      .map((r) => (Array.isArray(r) ? 'dsp' : `reverb:${JSON.stringify(audioParams(r))}`))
      .join('|')
    if (shape !== this.shape) {
      this.shape = shape
      this.rebuild(runs)
      return
    }
    // Same nodes; only the worklets' effect lists may have changed.
    const lists = runs.filter((r): r is AudioEffect[] => Array.isArray(r))
    this.worklets.forEach((w, i) => {
      const next = lists[i]!
      if (JSON.stringify(next) !== JSON.stringify(w.effects)) {
        w.effects = next
        w.node.port.postMessage(next)
      }
    })
  }

  private rebuild(runs: (AudioEffect[] | AudioEffect)[]) {
    const ctx = this.mixer.ctx
    this.input.disconnect()
    for (const n of this.nodes) n.disconnect()
    this.nodes = []
    this.worklets = []
    let cur: AudioNode = this.input
    for (const run of runs) {
      if (Array.isArray(run)) {
        const node = new AudioWorkletNode(ctx, 'lumacut-chain', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: 'explicit',
          channelInterpretation: 'speakers',
          processorOptions: { effects: run },
        })
        this.worklets.push({ node, effects: run })
        cur.connect(node)
        this.nodes.push(node)
        cur = node
      } else {
        const p = audioParams(run)
        const mix = p['mix']! / 100
        const [l, r] = reverbImpulse(p['decay']!, p['predelay']!, ctx.sampleRate)
        const buffer = ctx.createBuffer(2, l.length, ctx.sampleRate)
        buffer.copyToChannel(l, 0)
        buffer.copyToChannel(r, 1)
        const conv = ctx.createConvolver()
        conv.normalize = false
        conv.buffer = buffer
        const dry = ctx.createGain()
        dry.gain.value = 1 - mix
        const wet = ctx.createGain()
        wet.gain.value = mix
        const sum = ctx.createGain()
        cur.connect(dry).connect(sum)
        cur.connect(conv).connect(wet).connect(sum)
        this.nodes.push(conv, dry, wet, sum)
        cur = sum
      }
    }
    cur.connect(this.output)
  }

  dispose() {
    this.input.disconnect()
    this.output.disconnect()
    for (const n of this.nodes) n.disconnect()
  }
}

/** Consecutive non-reverb effects grouped into one list; each reverb on its own. */
function runsOf(effects: AudioEffect[]): (AudioEffect[] | AudioEffect)[] {
  const out: (AudioEffect[] | AudioEffect)[] = []
  for (const fx of effects) {
    if (fx.type === 'reverb') out.push(fx)
    else {
      const last = out[out.length - 1]
      if (Array.isArray(last)) last.push(fx)
      else out.push([fx])
    }
  }
  return out
}

/** A track or the master: effects, fader, pan, and a meter tapped after them. */
class BusNode {
  readonly chain: Chain
  readonly fader: GainNode
  readonly pan: StereoPannerNode
  private meter: AudioWorkletNode | null = null
  reading: MasterReading = { left: 0, right: 0, loudness: null }

  constructor(
    private readonly mixer: Mixer,
    destination: AudioNode,
    private readonly loudness: boolean,
  ) {
    this.chain = new Chain(mixer)
    this.fader = mixer.ctx.createGain()
    this.pan = mixer.ctx.createStereoPanner()
    this.chain.output.connect(this.fader).connect(this.pan).connect(destination)
    this.attachMeter()
  }

  get input() {
    return this.chain.input
  }

  attachMeter() {
    if (this.meter || !this.mixer.workletReady) return
    this.meter = new AudioWorkletNode(this.mixer.ctx, 'lumacut-meter', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 2,
      channelCountMode: 'explicit',
      processorOptions: { loudness: this.loudness },
    })
    this.meter.port.onmessage = (e: MessageEvent<MasterReading>) => {
      this.reading = e.data
    }
    this.pan.connect(this.meter)
  }

  resetLoudness() {
    this.meter?.port.postMessage('reset')
  }

  set(bus: Bus, audible = true) {
    const t = this.mixer.ctx.currentTime
    this.fader.gain.setTargetAtTime(audible ? dbToGain(bus.volume) : 0, t, 0.01)
    this.pan.pan.setTargetAtTime(bus.pan, t, 0.01)
    this.chain.set(bus.effects)
  }

  dispose() {
    this.chain.dispose()
    this.fader.disconnect()
    this.pan.disconnect()
    this.meter?.disconnect()
  }
}

type Voice = {
  source: MediaElementAudioSourceNode
  chain: Chain
  gain: GainNode
  pan: StereoPannerNode
  trackId: string | null
}

/**
 * The sound side of the player: every audible clip's media element is routed
 * through its clip settings into its track's bus, then the master, with the
 * same order and math as export.
 */
export class Mixer {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' })
  workletReady = false
  private readonly master: BusNode
  private readonly tracks = new Map<string, BusNode>()
  private readonly voices = new Map<string, Voice>()
  private last: { seq: Sequence; leaves: AudioLeaf[] } | null = null

  constructor() {
    this.master = new BusNode(this, this.ctx.destination, true)
    void this.ctx.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        this.workletReady = true
        this.master.attachMeter()
        for (const b of this.tracks.values()) b.attachMeter()
        // Build the effect chains that were waiting for the worklet.
        if (this.last) this.update(this.last.seq, this.last.leaves, 0)
      })
      .catch(() => undefined)
  }

  resume() {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  attach(key: string, element: HTMLMediaElement) {
    if (this.voices.has(key)) return
    const source = this.ctx.createMediaElementSource(element)
    const chain = new Chain(this)
    const gain = this.ctx.createGain()
    gain.gain.value = 0
    const pan = this.ctx.createStereoPanner()
    source.connect(chain.input)
    chain.output.connect(gain).connect(pan)
    this.voices.set(key, { source, chain, gain, pan, trackId: null })
  }

  detach(key: string) {
    const v = this.voices.get(key)
    if (!v) return
    v.source.disconnect()
    v.chain.dispose()
    v.gain.disconnect()
    v.pan.disconnect()
    this.voices.delete(key)
  }

  /**
   * Brings the graph in line with the sequence: buses for its audio tracks and
   * each playing clip's level, pan and effects. `frameSeconds` is how long the
   * level takes to reach the new value (one frame while playing).
   */
  update(seq: Sequence, leaves: AudioLeaf[], frameSeconds: number) {
    this.last = { seq, leaves }
    const soloed = seq.tracks.some((t) => t.kind === 'audio' && t.solo)
    const live = new Set<string>()
    for (const track of seq.tracks) {
      if (track.kind !== 'audio') continue
      live.add(track.id)
      let bus = this.tracks.get(track.id)
      if (!bus) {
        bus = new BusNode(this, this.master.input, false)
        this.tracks.set(track.id, bus)
      }
      bus.set(track.bus, soloed ? track.solo : !track.muted)
    }
    for (const [id, bus] of this.tracks) {
      if (live.has(id)) continue
      bus.dispose()
      this.tracks.delete(id)
    }
    this.master.set(seq.master)

    const now = this.ctx.currentTime
    for (const leaf of leaves) {
      const v = this.voices.get(leaf.key)
      if (!v) continue
      if (v.trackId !== leaf.trackId) {
        v.pan.disconnect()
        const bus = this.tracks.get(leaf.trackId)
        if (bus) v.pan.connect(bus.input)
        v.trackId = leaf.trackId
      }
      v.gain.gain.cancelScheduledValues(now)
      if (frameSeconds > 0) {
        v.gain.gain.setValueAtTime(v.gain.gain.value, now)
        v.gain.gain.linearRampToValueAtTime(leaf.gain, now + frameSeconds)
      } else {
        v.gain.gain.setValueAtTime(leaf.gain, now)
      }
      v.pan.pan.setValueAtTime(leaf.clip.sound.pan, now)
      v.chain.set(leaf.clip.sound.effects)
    }
  }

  /** Moves a fader or pan right away, ahead of the edit that will follow, so a drag is heard live. */
  preview(busId: string | 'master', patch: { volume?: number; pan?: number }) {
    const bus = busId === 'master' ? this.master : this.tracks.get(busId)
    if (!bus) return
    const t = this.ctx.currentTime
    if (patch.volume !== undefined) bus.fader.gain.setTargetAtTime(dbToGain(patch.volume), t, 0.01)
    if (patch.pan !== undefined) bus.pan.pan.setTargetAtTime(patch.pan, t, 0.01)
  }

  meters(): { master: MasterReading; tracks: Map<string, MeterReading> } {
    const tracks = new Map<string, MeterReading>()
    for (const [id, bus] of this.tracks) tracks.set(id, bus.reading)
    return { master: this.master.reading, tracks }
  }

  resetLoudness() {
    this.master.resetLoudness()
  }

  dispose() {
    for (const key of [...this.voices.keys()]) this.detach(key)
    for (const bus of this.tracks.values()) bus.dispose()
    this.master.dispose()
    void this.ctx.close()
  }
}
