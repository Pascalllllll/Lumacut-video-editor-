import * as Menu from '@radix-ui/react-dropdown-menu'
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { AUDIO_EFFECT_SPECS, audioParams, createAudioEffect } from '@engine/audio'
import { AUDIO_EFFECTS, type AudioEffect } from '@engine/model'
import { t, td } from '../../i18n'
import { NumberField } from '../../components/NumberField'
import { Section } from '../look/LookInspector'
import styles from '../look/Look.module.css'

/** An ordered list of sound effects with their settings; used for clips, tracks and the master. */
export function AudioEffects({
  title,
  effects,
  empty,
  onChange,
}: {
  title: string
  effects: AudioEffect[]
  empty: string
  onChange: (effects: AudioEffect[]) => void
}) {
  const move = (i: number, dir: -1 | 1) => {
    const next = [...effects]
    const [item] = next.splice(i, 1)
    next.splice(i + dir, 0, item!)
    onChange(next)
  }
  return (
    <Section
      title={title}
      action={
        <Menu.Root>
          <Menu.Trigger asChild>
            <button type="button" className={styles.addButton} aria-label={t('sound.addEffect')}>
              <Plus size={13} strokeWidth={1.8} />
              {t('sound.add')}
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className={styles.menu} align="end">
              {AUDIO_EFFECTS.map((type) => (
                <Menu.Item
                  key={type}
                  className={styles.menuItem}
                  onSelect={() => onChange([...effects, createAudioEffect(type)])}
                >
                  {td(`audioEffect.${type}`)}
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      }
    >
      {effects.length === 0 ? <p className={styles.hint}>{empty}</p> : null}
      {effects.map((fx, i) => {
        const name = td(`audioEffect.${fx.type}`)
        const values = audioParams(fx)
        return (
          <div key={fx.id} className={styles.effect} data-enabled={fx.enabled}>
            <div className={styles.effectHead}>
              <span className={styles.effectName}>{name}</span>
              <button
                type="button"
                aria-label={fx.enabled ? t('look.disable', { name }) : t('look.enable', { name })}
                aria-pressed={!fx.enabled}
                onClick={() =>
                  onChange(effects.map((e) => (e.id === fx.id ? { ...e, enabled: !e.enabled } : e)))
                }
              >
                {fx.enabled ? (
                  <Eye size={13} strokeWidth={1.7} />
                ) : (
                  <EyeOff size={13} strokeWidth={1.7} />
                )}
              </button>
              <button
                type="button"
                aria-label={t('look.moveUp')}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={13} strokeWidth={1.7} />
              </button>
              <button
                type="button"
                aria-label={t('look.moveDown')}
                disabled={i === effects.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={13} strokeWidth={1.7} />
              </button>
              <button
                type="button"
                aria-label={t('look.remove', { name })}
                onClick={() => onChange(effects.filter((e) => e.id !== fx.id))}
              >
                <Trash2 size={13} strokeWidth={1.7} />
              </button>
            </div>
            {AUDIO_EFFECT_SPECS[fx.type].map((spec) => (
              <div key={spec.id} className={styles.inline}>
                <span>{td(`audioParam.${spec.id}`)}</span>
                <NumberField
                  label={td(`audioParam.${spec.id}`)}
                  value={values[spec.id]!}
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  unit={spec.unit === ':1' ? ':1' : spec.unit ? ` ${spec.unit}` : ''}
                  precision={spec.step < 0.1 ? 2 : spec.step < 1 ? 1 : 0}
                  onChange={(v) =>
                    onChange(
                      effects.map((e) =>
                        e.id === fx.id ? { ...e, params: { ...values, [spec.id]: v } } : e,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>
        )
      })}
    </Section>
  )
}
