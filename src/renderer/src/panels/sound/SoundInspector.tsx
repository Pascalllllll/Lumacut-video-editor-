import { useState } from 'react'
import { cutAtFrames } from '@engine/edits'
import { createId, type Clip, type ClipSound, type Sequence } from '@engine/model'
import { sourceFrameAt } from '@engine/speed'
import { fpsValue, framesToSeconds, secondsToFrames } from '@engine/time'
import { clipEnd, companions } from '@engine/timeline'
import { t } from '../../i18n'
import { NumberField } from '../../components/NumberField'
import { notify } from '../../state/notices'
import { selectProject, useProject } from '../../state/project'
import { Section } from '../look/LookInspector'
import { ParamRow } from '../look/ParamRow'
import { AudioEffects } from './AudioEffects'
import { SoundAiTools } from '../look/AiTools'
import styles from '../look/Look.module.css'

/** A clip's sound: level, pan, fades, effects, and beat tools. */
export function SoundInspector({ clip, sequence }: { clip: Clip; sequence: Sequence }) {
  const fps = fpsValue(sequence.fps)
  const set = (patch: Partial<ClipSound>) =>
    useProject.getState().dispatch({
      type: 'clip.look',
      sequenceId: sequence.id,
      clipIds: [clip.id],
      patch: { sound: { ...clip.sound, ...patch } },
    })
  const s = clip.sound
  const maxFade = (other: number) => Math.max(0, (clip.duration - other) / fps)

  return (
    <>
      <Section title={t('sound.level')}>
        <div className={styles.inline}>
          <span>{t('sound.gain')}</span>
          <NumberField
            label={t('sound.gain')}
            value={s.gain}
            min={-96}
            max={24}
            step={0.5}
            unit=" dB"
            precision={1}
            onChange={(gain) => set({ gain })}
          />
        </div>
        <ParamRow
          clip={clip}
          sequence={sequence}
          path={{ kind: 'sound', param: 'volume' }}
          label={t('sound.volume')}
          min={-96}
          max={12}
          step={0.5}
          unit=" dB"
          precision={1}
        />
        <div className={styles.inline}>
          <span>{t('sound.pan')}</span>
          <NumberField
            label={t('sound.pan')}
            value={s.pan}
            min={-1}
            max={1}
            step={0.01}
            display={100}
            precision={0}
            onChange={(pan) => set({ pan })}
          />
        </div>
        <div className={styles.inline}>
          <span>{t('sound.fadeIn')}</span>
          <NumberField
            label={t('sound.fadeIn')}
            value={s.fadeIn / fps}
            min={0}
            max={maxFade(s.fadeOut)}
            step={1 / fps}
            unit={` ${t('sound.seconds')}`}
            precision={2}
            onChange={(v) => set({ fadeIn: Math.round(v * fps) })}
          />
        </div>
        <div className={styles.inline}>
          <span>{t('sound.fadeOut')}</span>
          <NumberField
            label={t('sound.fadeOut')}
            value={s.fadeOut / fps}
            min={0}
            max={maxFade(s.fadeIn)}
            step={1 / fps}
            unit={` ${t('sound.seconds')}`}
            precision={2}
            onChange={(v) => set({ fadeOut: Math.round(v * fps) })}
          />
        </div>
        <p className={styles.hint}>{t('sound.hint')}</p>
      </Section>
      <AudioEffects
        title={t('sound.effects')}
        effects={s.effects}
        empty={t('sound.noEffects')}
        onChange={(effects) => set({ effects })}
      />
      <Beats clip={clip} sequence={sequence} />
      <SoundAiTools clip={clip} />
    </>
  )
}

function Beats({ clip, sequence }: { clip: Clip; sequence: Sequence }) {
  const project = useProject(selectProject)
  const [busy, setBusy] = useState(false)
  const asset = project.media[clip.mediaId]
  const canListen =
    Boolean(asset?.hasAudio) &&
    asset?.kind !== 'sequence' &&
    clip.speed === 1 &&
    !clip.ramp &&
    !clip.reverse

  const findBeats = async () => {
    if (!asset) return
    setBusy(true)
    try {
      const start = framesToSeconds(sourceFrameAt(clip, 0), sequence.fps)
      const duration = framesToSeconds(clip.duration, sequence.fps)
      const { bpm, times } = await window.lumacut.invoke('analyze:beats', {
        path: asset.path,
        start,
        duration,
      })
      const frames = [
        ...new Set(times.map((s) => clip.start + secondsToFrames(s, sequence.fps))),
      ].filter((f) => f >= clip.start && f < clipEnd(clip))
      if (frames.length === 0) {
        notify('info', t('sound.noBeats'))
        return
      }
      const taken = new Set(Object.values(sequence.markers).map((m) => m.frame))
      useProject.getState().dispatch({
        type: 'batch',
        label: t('sound.findBeats'),
        commands: frames
          .filter((f) => !taken.has(f))
          .map((frame, i) => ({
            type: 'marker.add' as const,
            sequenceId: sequence.id,
            marker: {
              id: createId('mrk'),
              frame,
              name: `${t('sound.beats')} ${i + 1}`,
              note: '',
              color: 'yellow' as const,
            },
          })),
      })
      notify('info', t('sound.beatsAdded', { count: frames.length, bpm: Math.round(bpm) }))
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const cut = () => {
    const inside = Object.values(sequence.markers)
      .map((m) => m.frame)
      .filter((f) => f > clip.start && f < clipEnd(clip))
    if (inside.length === 0) {
      notify('info', t('sound.noMarkersInside'))
      return
    }
    const cmd = cutAtFrames(sequence, [...companions(sequence, [clip.id])], inside)
    if (cmd?.type !== 'batch') return
    useProject.getState().dispatch({ ...cmd, label: t('history.cutAtMarkers') })
    notify('info', t('sound.cut', { count: inside.length + 1 }))
  }

  return (
    <Section title={t('sound.beats')}>
      <div className={styles.presetRow}>
        <button
          type="button"
          className={styles.addButton}
          disabled={!canListen || busy}
          onClick={() => void findBeats()}
        >
          {busy ? t('sound.findingBeats') : t('sound.findBeats')}
        </button>
        <button type="button" className={styles.addButton} onClick={cut}>
          {t('sound.cutAtMarkers')}
        </button>
      </div>
      <p className={styles.hint}>{t('sound.cutAtMarkersHint')}</p>
      {!canListen ? <p className={styles.hint}>{t('sound.needsNormalSpeed')}</p> : null}
    </Section>
  )
}
