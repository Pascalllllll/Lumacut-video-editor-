import { TRANSITIONS, type Sequence, type Transition } from '@engine/model'
import { framesToSeconds } from '@engine/time'
import { t, td } from '../../i18n'
import { NumberField } from '../../components/NumberField'
import { useProject } from '../../state/project'
import { Section } from './LookInspector'
import styles from './Look.module.css'

export function TransitionEditor({
  transition,
  sequence,
}: {
  transition: Transition
  sequence: Sequence
}) {
  const update = (patch: Partial<Pick<Transition, 'type' | 'duration' | 'ease'>>) =>
    useProject.getState().dispatch({
      type: 'transition.update',
      sequenceId: sequence.id,
      transitionId: transition.id,
      patch,
    })
  return (
    <div className={styles.look}>
      <Section title={t('transition.title')}>
        <div className={styles.inline}>
          <label htmlFor="transition-type">{t('transition.type')}</label>
          <select
            id="transition-type"
            value={transition.type}
            onChange={(e) => update({ type: e.target.value as Transition['type'] })}
          >
            {TRANSITIONS.map((tr) => (
              <option key={tr} value={tr}>
                {td(`transition.name.${tr}`)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.inline}>
          <span>{t('transition.duration')}</span>
          <NumberField
            label={t('transition.duration')}
            value={transition.duration}
            min={2}
            max={600}
            step={1}
            precision={0}
            unit="f"
            onChange={(v) => update({ duration: Math.round(v) })}
          />
        </div>
        <p className={styles.hint}>
          {t('transition.seconds', {
            s: framesToSeconds(transition.duration, sequence.fps).toFixed(2),
          })}
        </p>
        <div className={styles.inline}>
          <label htmlFor="transition-ease">{t('graph.ease')}</label>
          <select
            id="transition-ease"
            value={transition.ease}
            onChange={(e) => update({ ease: e.target.value as Transition['ease'] })}
          >
            {(['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const).map((e) => (
              <option key={e} value={e}>
                {td(`ease.${e}`)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className={styles.wideButton}
          onClick={() =>
            useProject.getState().dispatch({
              type: 'transition.remove',
              sequenceId: sequence.id,
              transitionIds: [transition.id],
            })
          }
        >
          {t('transition.remove')}
        </button>
      </Section>
    </div>
  )
}
