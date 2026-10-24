import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Mic, Square } from 'lucide-react'
import { DEFAULT_DUCK, duckCommand, type Envelope } from '@engine/ducking'
import type { AudioEffect, Bus, Sequence, Track } from '@engine/model'
import { t } from '../../i18n'
import { NumberField } from '../../components/NumberField'
import { Panel } from '../../components/Panel'
import { loadWave } from '../../lib/media-cache'
import { currentPlayer } from '../../lib/player'
import { startRecording, stopRecording, useRecorder } from '../../lib/voiceover'
import { notify } from '../../state/notices'
import { selectProject, selectSequence, useProject } from '../../state/project'
import { AudioEffects } from '../sound/AudioEffects'
import sheet from '../../components/Sheet.module.css'
import styles from './Mixer.module.css'

const FLOOR_DB = -60
const TOP_DB = 6
const TARGETS: { value: number | null; key: Parameters<typeof t>[0] }[] = [
  { value: null, key: 'mixer.targetOff' },
  { value: -14, key: 'mixer.targetStreaming' },
  { value: -16, key: 'mixer.targetPodcast' },
  { value: -23, key: 'mixer.targetBroadcast' },
]

/** Canvases and readouts the meter loop writes to, keyed by track id or 'master'. */
type MeterTargets = Map<string, { canvas: HTMLCanvasElement; hold: [number, number, number] }>

function useMeterLoop(targets: MeterTargets, loudness: React.RefObject<HTMLDListElement | null>) {
  useEffect(() => {
    let raf = 0
    const draw = () => {
      const meters = currentPlayer()?.mixer.meters()
      const now = performance.now()
      for (const [id, target] of targets) {
        const r = id === 'master' ? meters?.master : meters?.tracks.get(id)
        drawMeter(target.canvas, r?.left ?? 0, r?.right ?? 0, target.hold, now)
      }
      const l = meters?.master.loudness
      const el = loudness.current
      if (el) {
        const fmt = (v: number | undefined) =>
          v === undefined || !Number.isFinite(v) ? '--' : v.toFixed(1)
        const values = el.querySelectorAll('dd')
        values[0]!.textContent = fmt(l?.momentary)
        values[1]!.textContent = fmt(l?.shortTerm)
        values[2]!.textContent = fmt(l?.integrated)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [targets, loudness])
}

const toY = (db: number, h: number) =>
  h * (1 - (Math.min(TOP_DB, Math.max(FLOOR_DB, db)) - FLOOR_DB) / (TOP_DB - FLOOR_DB))

/** Two bars, left and right, with a peak hold that falls back after a second. */
function drawMeter(
  canvas: HTMLCanvasElement,
  left: number,
  right: number,
  hold: [number, number, number],
  now: number,
) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const css = getComputedStyle(canvas)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = css.getPropertyValue('--meter-bed')
  ctx.fillRect(0, 0, w, h)
  const levels = [left, right].map((v) => (v > 0 ? 20 * Math.log10(v) : -Infinity))
  if (now - hold[2] > 1000) {
    hold[0] = Math.max(-Infinity, hold[0] - 0.6)
    hold[1] = Math.max(-Infinity, hold[1] - 0.6)
  }
  const bar = (w - 3) / 2
  levels.forEach((db, i) => {
    if (db > hold[i]!) {
      hold[i] = db
      hold[2] = now
    }
    const x = 1 + i * (bar + 1)
    const top = toY(db, h)
    const zones: [number, number, string][] = [
      [FLOOR_DB, -12, '--meter-ok'],
      [-12, 0, '--meter-hot'],
      [0, TOP_DB, '--meter-over'],
    ]
    for (const [lo, hi, token] of zones) {
      const y0 = toY(hi, h)
      const y1 = toY(lo, h)
      const from = Math.max(top, y0)
      if (from >= y1) continue
      ctx.fillStyle = css.getPropertyValue(token)
      ctx.fillRect(x, from, bar, y1 - from)
    }
    if (Number.isFinite(hold[i]!) && hold[i]! > FLOOR_DB) {
      ctx.fillStyle = css.getPropertyValue(hold[i]! > 0 ? '--meter-over' : '--text-primary')
      ctx.fillRect(x, toY(hold[i]!, h), bar, 1)
    }
  })
}

export function Mixer() {
  const project = useProject(selectProject)
  const sequence = useProject(selectSequence)
  const tracks = sequence.tracks.filter((tr) => tr.kind === 'audio')
  const [targets] = useState<MeterTargets>(() => new Map())
  const [refs] = useState(() => new Map<string, (c: HTMLCanvasElement | null) => void>())
  const loudness = useRef<HTMLDListElement>(null)
  useMeterLoop(targets, loudness)
  // One stable callback per meter, so re-renders don't reset its peak hold.
  const meterRef = (id: string) => {
    let ref = refs.get(id)
    if (!ref) {
      ref = (canvas) => {
        if (canvas) targets.set(id, { canvas, hold: [-Infinity, -Infinity, 0] })
        else targets.delete(id)
      }
      refs.set(id, ref)
    }
    return ref
  }

  return (
    <Panel.Root label={t('mixer.title')} area="mixer">
      <Panel.Header>
        <Panel.Title>{t('mixer.title')}</Panel.Title>
        <div className={styles.tools}>
          <Duck sequence={sequence} project={project} />
          <Record />
        </div>
      </Panel.Header>
      <Panel.Body>
        <div className={styles.strips}>
          {tracks.length === 0 ? <p className={styles.empty}>{t('mixer.empty')}</p> : null}
          {tracks.map((track) => (
            <TrackStrip
              key={track.id}
              track={track}
              sequence={sequence}
              meterRef={meterRef(track.id)}
            />
          ))}
          <MasterStrip sequence={sequence} meterRef={meterRef('master')} loudness={loudness} />
        </div>
      </Panel.Body>
    </Panel.Root>
  )
}

function Fader({
  name,
  value,
  onPreview,
  onCommit,
}: {
  name: string
  value: number
  onPreview: (db: number) => void
  onCommit: (db: number) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const timer = useRef(0)
  const shown = draft ?? value
  const commit = () => {
    window.clearTimeout(timer.current)
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  // Arrow-key nudges land as one change once the keys go quiet.
  const commitSoon = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(commit, 400)
  }
  return (
    <input
      type="range"
      className={styles.fader}
      min={FLOOR_DB}
      max={12}
      step={0.5}
      value={Math.max(FLOOR_DB, shown)}
      aria-label={t('mixer.level', { name })}
      aria-valuetext={`${shown.toFixed(1)} dB`}
      onChange={(e) => {
        const db = Number(e.target.value)
        setDraft(db)
        onPreview(db)
      }}
      onPointerUp={commit}
      onKeyUp={commitSoon}
      onBlur={commit}
      onDoubleClick={() => onCommit(0)}
    />
  )
}

function EffectsButton({
  name,
  effects,
  onChange,
}: {
  name: string
  effects: AudioEffect[]
  onChange: (effects: AudioEffect[]) => void
}) {
  const active = effects.filter((e) => e.enabled).length
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={styles.small}
          data-active={active > 0}
          aria-label={t('mixer.effectsOn', { name })}
        >
          {effects.length
            ? t('mixer.effectCount', { count: effects.length })
            : t('mixer.noEffects')}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={sheet.overlay} />
        <Dialog.Content className={`${sheet.sheet} ${styles.effectsSheet}`}>
          <Dialog.Title className={sheet.title}>{t('mixer.effectsOn', { name })}</Dialog.Title>
          <Dialog.Description className={styles.visuallyHidden}>
            {t('mixer.effectsOn', { name })}
          </Dialog.Description>
          <div className={styles.effectsBody}>
            <AudioEffects
              title={t('mixer.effects')}
              effects={effects}
              empty={t('mixer.noEffects')}
              onChange={onChange}
            />
          </div>
          <div className={sheet.actions}>
            <Dialog.Close asChild>
              <button type="button" className={`${sheet.button} ${sheet.primary}`}>
                {t('export.close')}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function StripBody({
  id,
  name,
  bus,
  onBus,
  meterRef,
}: {
  id: string
  name: string
  bus: Bus
  onBus: (bus: Bus) => void
  meterRef: (c: HTMLCanvasElement | null) => void
}) {
  return (
    <>
      <EffectsButton
        name={name}
        effects={bus.effects}
        onChange={(effects) => onBus({ ...bus, effects })}
      />
      <div className={styles.pan}>
        <span>{t('sound.pan')}</span>
        <NumberField
          label={t('mixer.pan', { name })}
          value={bus.pan}
          min={-1}
          max={1}
          step={0.01}
          display={100}
          precision={0}
          onChange={(pan) => onBus({ ...bus, pan })}
        />
      </div>
      <div className={styles.faderRow}>
        <Fader
          name={name}
          value={bus.volume}
          onPreview={(volume) => currentPlayer()?.mixer.preview(id, { volume })}
          onCommit={(volume) => onBus({ ...bus, volume })}
        />
        <canvas
          ref={meterRef}
          className={styles.meter}
          role="img"
          aria-label={t('mixer.meter', { name })}
        />
      </div>
      <NumberField
        label={t('mixer.level', { name })}
        value={bus.volume}
        min={-96}
        max={12}
        step={0.5}
        unit=" dB"
        precision={1}
        onChange={(volume) => onBus({ ...bus, volume })}
      />
    </>
  )
}

function TrackStrip({
  track,
  sequence,
  meterRef,
}: {
  track: Track
  sequence: Sequence
  meterRef: (c: HTMLCanvasElement | null) => void
}) {
  const update = (patch: Partial<Pick<Track, 'bus' | 'role' | 'muted' | 'solo'>>) =>
    useProject
      .getState()
      .dispatch({ type: 'track.update', sequenceId: sequence.id, trackId: track.id, patch })
  return (
    <div className={styles.strip} role="group" aria-label={track.name} data-off={track.muted}>
      <div className={styles.name}>{track.name}</div>
      <select
        className={styles.role}
        aria-label={t('mixer.role', { name: track.name })}
        value={track.role ?? ''}
        onChange={(e) => update({ role: (e.target.value || null) as Track['role'] })}
      >
        <option value="">{t('mixer.roleNone')}</option>
        <option value="dialogue">{t('mixer.roleDialogue')}</option>
        <option value="music">{t('mixer.roleMusic')}</option>
        <option value="effects">{t('mixer.roleEffects')}</option>
      </select>
      <StripBody
        id={track.id}
        name={track.name}
        bus={track.bus}
        onBus={(bus) => update({ bus })}
        meterRef={meterRef}
      />
      <div className={styles.toggles}>
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={track.muted}
          aria-label={
            track.muted
              ? t('track.unmute', { name: track.name })
              : t('track.mute', { name: track.name })
          }
          onClick={() => update({ muted: !track.muted })}
        >
          M
        </button>
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={track.solo}
          aria-label={t('track.solo', { name: track.name })}
          onClick={() => update({ solo: !track.solo })}
        >
          S
        </button>
      </div>
    </div>
  )
}

function MasterStrip({
  sequence,
  meterRef,
  loudness,
}: {
  sequence: Sequence
  meterRef: (c: HTMLCanvasElement | null) => void
  loudness: React.RefObject<HTMLDListElement | null>
}) {
  const [measuring, setMeasuring] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const name = t('mixer.master')
  const set = (patch: { master?: Bus; loudnessTarget?: number | null }) =>
    useProject.getState().dispatch({ type: 'sequence.settings', sequenceId: sequence.id, ...patch })
  const measure = async () => {
    setMeasuring(true)
    setResult(null)
    try {
      const state = useProject.getState()
      const r = await window.lumacut.invoke('audio:loudness', {
        project: selectProject(state),
        sequenceId: sequence.id,
      })
      setResult(
        r.integrated === null
          ? t('mixer.silent')
          : t('mixer.measured', {
              lufs: r.integrated.toFixed(1),
              tp: (r.truePeak ?? -Infinity).toFixed(1),
              lra: r.range.toFixed(1),
            }),
      )
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error))
    } finally {
      setMeasuring(false)
    }
  }
  return (
    <div className={`${styles.strip} ${styles.master}`} role="group" aria-label={name}>
      <div className={styles.masterColumns}>
        <div className={styles.masterControls}>
          <div className={styles.name}>{name}</div>
          <StripBody
            id="master"
            name={name}
            bus={sequence.master}
            onBus={(master) => set({ master })}
            meterRef={meterRef}
          />
        </div>
        <div className={styles.loudness}>
          <dl ref={loudness} className={`${styles.readouts} tabular`}>
            <dt>{t('mixer.momentary')}</dt>
            <dd>--</dd>
            <dt>{t('mixer.shortTerm')}</dt>
            <dd>--</dd>
            <dt>{t('mixer.integrated')}</dt>
            <dd>--</dd>
          </dl>
          <button
            type="button"
            className={styles.small}
            title={t('mixer.resetHint')}
            onClick={() => currentPlayer()?.mixer.resetLoudness()}
          >
            {t('mixer.resetLoudness')}
          </button>
          <label className={styles.target}>
            <span>{t('mixer.target')}</span>
            <select
              value={sequence.loudnessTarget === null ? '' : String(sequence.loudnessTarget)}
              onChange={(e) =>
                set({ loudnessTarget: e.target.value === '' ? null : Number(e.target.value) })
              }
            >
              {TARGETS.map((o) => (
                <option key={o.key} value={o.value === null ? '' : String(o.value)}>
                  {t(o.key)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.small}
            disabled={measuring}
            onClick={() => void measure()}
          >
            {measuring ? t('mixer.measuring') : t('mixer.measure')}
          </button>
          {result ? (
            <p className={styles.result} role="status">
              {result}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Duck({
  sequence,
  project,
}: {
  sequence: Sequence
  project: ReturnType<typeof selectProject>
}) {
  const [amount, setAmount] = useState(DEFAULT_DUCK.amount)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    const audio = sequence.tracks.filter((tr) => tr.kind === 'audio')
    if (!audio.some((tr) => tr.role === 'dialogue') || !audio.some((tr) => tr.role === 'music')) {
      notify('info', t('mixer.duckNeedsRoles'))
      return
    }
    setBusy(true)
    try {
      const dialogueTracks = new Set(
        audio.filter((tr) => tr.role === 'dialogue').map((tr) => tr.id),
      )
      const envelopes = new Map<string, Envelope>()
      await Promise.all(
        Object.values(sequence.clips)
          .filter((c) => dialogueTracks.has(c.trackId))
          .map(async (c) => {
            const asset = project.media[c.mediaId]
            if (asset?.hasAudio && !envelopes.has(c.mediaId))
              envelopes.set(c.mediaId, await loadWave(asset.path))
          }),
      )
      const cmd = duckCommand(project, sequence, (id) => envelopes.get(id), {
        ...DEFAULT_DUCK,
        amount,
      })
      const ducked =
        cmd?.type === 'batch'
          ? cmd.commands.filter(
              (c) => c.type === 'clip.look' && (c.patch.sound?.volume.keys.length ?? 0) > 0,
            ).length
          : 0
      if (cmd?.type !== 'batch' || ducked === 0) {
        notify('info', t('mixer.duckNoSpeech'))
        return
      }
      useProject.getState().dispatch({ ...cmd, label: t('history.duck') })
      notify('info', t('mixer.duckDone'))
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.duck} title={t('mixer.duckHint')}>
      <span>{t('mixer.duckAmount')}</span>
      <NumberField
        label={t('mixer.duckAmount')}
        value={amount}
        min={-40}
        max={-1}
        step={1}
        unit=" dB"
        precision={0}
        onChange={setAmount}
      />
      <button type="button" className={styles.small} disabled={busy} onClick={() => void run()}>
        {t('mixer.duck')}
      </button>
    </div>
  )
}

function Record() {
  const recording = useRecorder((s) => s.trackId)
  const busy = useRecorder((s) => s.busy)
  const sequence = useProject(selectSequence)
  const trackName = sequence.tracks.find((tr) => tr.id === recording)?.name ?? ''
  return recording ? (
    <button type="button" className={styles.record} data-live="true" onClick={stopRecording}>
      <Square size={11} strokeWidth={2} fill="currentColor" />
      {t('mixer.stopRecording')}
      <span className={styles.recordingOn}>{t('mixer.recordingOn', { track: trackName })}</span>
    </button>
  ) : (
    <button
      type="button"
      className={styles.record}
      disabled={busy}
      onClick={() => void startRecording()}
    >
      <Mic size={13} strokeWidth={1.8} />
      {t('mixer.record')}
    </button>
  )
}
