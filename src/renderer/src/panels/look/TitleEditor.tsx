import { TEXT_ANIMATIONS, titleSchema, type Clip, type Sequence, type Title } from '@engine/model'
import { t, td } from '../../i18n'
import { NumberField } from '../../components/NumberField'
import { useProject } from '../../state/project'
import { Section } from './LookInspector'
import styles from './Look.module.css'

const FONTS = [
  'Inter Variable',
  'system-ui',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'DejaVu Sans',
  'DejaVu Serif',
  'Liberation Sans',
]

/** Everything about how a title reads: text, type, fill, outline, shadow, box and how it animates. */
export function TitleEditor({ clip, sequence }: { clip: Clip; sequence: Sequence }) {
  const title = clip.title ?? titleSchema.parse({})
  const set = (patch: Partial<Title>) =>
    useProject.getState().dispatch({
      type: 'clip.look',
      sequenceId: sequence.id,
      clipIds: [clip.id],
      patch: { title: { ...title, ...patch } },
    })
  const id = (s: string) => `${clip.id}-${s}`

  return (
    <div className={styles.look}>
      <Section title={t('title.text')}>
        <textarea
          key={clip.id}
          className={styles.textarea}
          aria-label={t('title.text')}
          defaultValue={title.text}
          onBlur={(e) => e.target.value !== title.text && set({ text: e.target.value })}
        />
      </Section>
      <Section title={t('title.type')}>
        <div className={styles.inline}>
          <label htmlFor={id('font')}>{t('title.font')}</label>
          <select
            id={id('font')}
            value={title.font}
            onChange={(e) => set({ font: e.target.value })}
          >
            {(FONTS.includes(title.font) ? FONTS : [title.font, ...FONTS]).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.inline}>
          <span>{t('title.weight')}</span>
          <NumberField
            label={t('title.weight')}
            value={title.weight}
            min={100}
            max={900}
            step={100}
            precision={0}
            onChange={(v) => set({ weight: Math.round(v / 100) * 100 })}
          />
        </div>
        <div className={styles.inline}>
          <span>{t('title.size')}</span>
          <NumberField
            label={t('title.size')}
            value={title.size}
            min={4}
            max={800}
            step={1}
            unit="px"
            precision={0}
            onChange={(v) => set({ size: v })}
          />
        </div>
        <div className={styles.inline}>
          <span>{t('title.tracking')}</span>
          <NumberField
            label={t('title.tracking')}
            value={title.tracking}
            min={-200}
            max={1000}
            step={5}
            precision={0}
            onChange={(v) => set({ tracking: v })}
          />
        </div>
        <div className={styles.inline}>
          <span>{t('title.leading')}</span>
          <NumberField
            label={t('title.leading')}
            value={title.leading}
            min={0.5}
            max={3}
            step={0.05}
            precision={2}
            onChange={(v) => set({ leading: v })}
          />
        </div>
        <div className={styles.inline}>
          <label htmlFor={id('align')}>{t('title.align')}</label>
          <select
            id={id('align')}
            value={title.align}
            onChange={(e) => set({ align: e.target.value as Title['align'] })}
          >
            <option value="left">{t('title.alignLeft')}</option>
            <option value="center">{t('title.alignCenter')}</option>
            <option value="right">{t('title.alignRight')}</option>
          </select>
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={title.italic}
            onChange={(e) => set({ italic: e.target.checked })}
          />
          {t('title.italic')}
        </label>
      </Section>
      <Section title={t('title.fill')}>
        <div className={styles.inline}>
          <label htmlFor={id('fillKind')}>{t('title.fillKind')}</label>
          <select
            id={id('fillKind')}
            value={title.fill.kind}
            onChange={(e) =>
              set({ fill: { ...title.fill, kind: e.target.value as 'solid' | 'gradient' } })
            }
          >
            <option value="solid">{t('title.solid')}</option>
            <option value="gradient">{t('title.gradient')}</option>
          </select>
        </div>
        <div className={styles.inline}>
          <label htmlFor={id('c1')}>
            {title.fill.kind === 'gradient' ? t('title.colorFrom') : t('title.color')}
          </label>
          <input
            id={id('c1')}
            type="color"
            value={title.fill.color}
            onChange={(e) => set({ fill: { ...title.fill, color: e.target.value } })}
          />
        </div>
        {title.fill.kind === 'gradient' ? (
          <>
            <div className={styles.inline}>
              <label htmlFor={id('c2')}>{t('title.colorTo')}</label>
              <input
                id={id('c2')}
                type="color"
                value={title.fill.color2}
                onChange={(e) => set({ fill: { ...title.fill, color2: e.target.value } })}
              />
            </div>
            <div className={styles.inline}>
              <span>{t('title.angle')}</span>
              <NumberField
                label={t('title.angle')}
                value={title.fill.angle}
                min={-360}
                max={360}
                step={1}
                unit="°"
                precision={0}
                onChange={(v) => set({ fill: { ...title.fill, angle: v } })}
              />
            </div>
          </>
        ) : null}
      </Section>
      <Section title={t('title.outline')}>
        <div className={styles.inline}>
          <span>{t('title.outlineWidth')}</span>
          <NumberField
            label={t('title.outlineWidth')}
            value={title.stroke.width}
            min={0}
            max={40}
            step={0.5}
            unit="px"
            precision={1}
            onChange={(v) => set({ stroke: { ...title.stroke, width: v } })}
          />
        </div>
        <div className={styles.inline}>
          <label htmlFor={id('sc')}>{t('title.color')}</label>
          <input
            id={id('sc')}
            type="color"
            value={title.stroke.color}
            onChange={(e) => set({ stroke: { ...title.stroke, color: e.target.value } })}
          />
        </div>
      </Section>
      <Section title={t('title.shadow')}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={title.shadow.enabled}
            onChange={(e) => set({ shadow: { ...title.shadow, enabled: e.target.checked } })}
          />
          {t('title.showShadow')}
        </label>
        {title.shadow.enabled ? (
          <>
            <div className={styles.inline}>
              <span>{t('title.shadowX')}</span>
              <NumberField
                label={t('title.shadowX')}
                value={title.shadow.x}
                min={-200}
                max={200}
                unit="px"
                precision={0}
                onChange={(v) => set({ shadow: { ...title.shadow, x: v } })}
              />
            </div>
            <div className={styles.inline}>
              <span>{t('title.shadowY')}</span>
              <NumberField
                label={t('title.shadowY')}
                value={title.shadow.y}
                min={-200}
                max={200}
                unit="px"
                precision={0}
                onChange={(v) => set({ shadow: { ...title.shadow, y: v } })}
              />
            </div>
            <div className={styles.inline}>
              <span>{t('title.shadowBlur')}</span>
              <NumberField
                label={t('title.shadowBlur')}
                value={title.shadow.blur}
                min={0}
                max={200}
                unit="px"
                precision={0}
                onChange={(v) => set({ shadow: { ...title.shadow, blur: v } })}
              />
            </div>
            <div className={styles.inline}>
              <span>{t('look.opacity')}</span>
              <NumberField
                label={t('look.opacity')}
                value={title.shadow.opacity}
                min={0}
                max={1}
                display={100}
                unit="%"
                precision={0}
                onChange={(v) => set({ shadow: { ...title.shadow, opacity: v } })}
              />
            </div>
            <div className={styles.inline}>
              <label htmlFor={id('shc')}>{t('title.color')}</label>
              <input
                id={id('shc')}
                type="color"
                value={title.shadow.color}
                onChange={(e) => set({ shadow: { ...title.shadow, color: e.target.value } })}
              />
            </div>
          </>
        ) : null}
      </Section>
      <Section title={t('title.box')}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={title.box.enabled}
            onChange={(e) => set({ box: { ...title.box, enabled: e.target.checked } })}
          />
          {t('title.showBox')}
        </label>
        {title.box.enabled ? (
          <>
            <div className={styles.inline}>
              <label htmlFor={id('bc')}>{t('title.color')}</label>
              <input
                id={id('bc')}
                type="color"
                value={title.box.color}
                onChange={(e) => set({ box: { ...title.box, color: e.target.value } })}
              />
            </div>
            <div className={styles.inline}>
              <span>{t('look.opacity')}</span>
              <NumberField
                label={t('title.boxOpacity')}
                value={title.box.opacity}
                min={0}
                max={1}
                display={100}
                unit="%"
                precision={0}
                onChange={(v) => set({ box: { ...title.box, opacity: v } })}
              />
            </div>
            <div className={styles.inline}>
              <span>{t('title.padding')}</span>
              <NumberField
                label={t('title.padding')}
                value={title.box.padding}
                min={0}
                max={300}
                unit="px"
                precision={0}
                onChange={(v) => set({ box: { ...title.box, padding: v } })}
              />
            </div>
            <div className={styles.inline}>
              <span>{t('title.radius')}</span>
              <NumberField
                label={t('title.radius')}
                value={title.box.radius}
                min={0}
                max={200}
                unit="px"
                precision={0}
                onChange={(v) => set({ box: { ...title.box, radius: v } })}
              />
            </div>
          </>
        ) : null}
      </Section>
      <Section title={t('title.animation')}>
        {(['animateIn', 'animateOut'] as const).map((k) => (
          <div key={k} className={styles.inline}>
            <label htmlFor={id(k)}>{t(k === 'animateIn' ? 'title.in' : 'title.out')}</label>
            <select
              id={id(k)}
              value={title[k]}
              onChange={(e) => set({ [k]: e.target.value as Title['animateIn'] })}
            >
              {TEXT_ANIMATIONS.map((a) => (
                <option key={a} value={a}>
                  {td(`textAnim.${a}`)}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div className={styles.inline}>
          <label htmlFor={id('by')}>{t('title.by')}</label>
          <select
            id={id('by')}
            value={title.animateBy}
            onChange={(e) => set({ animateBy: e.target.value as Title['animateBy'] })}
          >
            {(['character', 'word', 'line', 'all'] as const).map((b) => (
              <option key={b} value={b}>
                {td(`title.byOption.${b}`)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.inline}>
          <span>{t('title.frames')}</span>
          <NumberField
            label={t('title.frames')}
            value={title.animateFrames}
            min={1}
            max={600}
            step={1}
            precision={0}
            onChange={(v) => set({ animateFrames: Math.round(v) })}
          />
        </div>
      </Section>
    </div>
  )
}

export function ColorEditor({ clip, sequence }: { clip: Clip; sequence: Sequence }) {
  return (
    <div className={styles.look}>
      <Section title={t('color.title')}>
        <div className={styles.inline}>
          <label htmlFor={`${clip.id}-color`}>{t('title.color')}</label>
          <input
            id={`${clip.id}-color`}
            type="color"
            value={clip.color ?? '#000000'}
            onChange={(e) =>
              useProject.getState().dispatch({
                type: 'clip.look',
                sequenceId: sequence.id,
                clipIds: [clip.id],
                patch: { color: e.target.value },
              })
            }
          />
        </div>
      </Section>
    </div>
  )
}
