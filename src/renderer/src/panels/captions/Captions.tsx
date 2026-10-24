import { useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Trash2 } from 'lucide-react'
import { joinWords, parseSubtitles, toAss, toSrt, toVtt } from '@engine/captions'
import {
  CAPTION_TEMPLATES,
  type CaptionCue,
  type CaptionStyle,
  type CaptionTrack,
  type Sequence,
} from '@engine/model'
import { formatTimecode, fpsValue } from '@engine/time'
import { t, td } from '../../i18n'
import { NumberField } from '../../components/NumberField'
import { Panel } from '../../components/Panel'
import { fillerWordRanges, removeRanges, silenceRanges, transcribeSequence } from '../../lib/ai'
import { notify } from '../../state/notices'
import { usePlayhead } from '../../state/playhead'
import { selectSequence, useProject } from '../../state/project'
import { Section } from '../look/LookInspector'
import look from '../look/Look.module.css'
import styles from './Captions.module.css'

const LANGUAGES = ['auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ja', 'zh', 'ko', 'hi', 'id']

function setCaptions(seq: Sequence, captions: CaptionTrack) {
  useProject.getState().dispatch({ type: 'captions.set', sequenceId: seq.id, captions })
}

export function Captions() {
  const sequence = useProject(selectSequence)
  const captions = sequence.captions
  return (
    <Panel.Root label={t('captions.title')} area="captions">
      <Panel.Header>
        <Panel.Title>{t('captions.title')}</Panel.Title>
      </Panel.Header>
      <Panel.Body>
        <Transcribe />
        <Tabs.Root defaultValue="cues">
          <Tabs.List className={look.tabs} aria-label={t('captions.views')}>
            <Tabs.Trigger value="cues" className={look.tab}>
              {t('captions.cues')}
            </Tabs.Trigger>
            <Tabs.Trigger value="text" className={look.tab}>
              {t('captions.transcript')}
            </Tabs.Trigger>
            <Tabs.Trigger value="style" className={look.tab}>
              {t('captions.style')}
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="cues">
            <CueList sequence={sequence} />
            <Files sequence={sequence} />
          </Tabs.Content>
          <Tabs.Content value="text">
            <Transcript sequence={sequence} />
            <Cleanup sequence={sequence} />
          </Tabs.Content>
          <Tabs.Content value="style">
            <StyleEditor sequence={sequence} captions={captions} />
          </Tabs.Content>
        </Tabs.Root>
      </Panel.Body>
    </Panel.Root>
  )
}

function Transcribe() {
  const [model, setModel] = useState('whisper-base')
  const [language, setLanguage] = useState('auto')
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const count = await transcribeSequence(model, language === 'auto' ? null : language)
      if (count) notify('info', t('captions.made', { count }))
      else notify('info', t('captions.noSpeech'))
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={t('captions.fromSpeech')}>
      <div className={look.inline}>
        <label htmlFor="cap-model">{t('captions.model')}</label>
        <select id="cap-model" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="whisper-base">{t('models.name.whisper-base')}</option>
          <option value="whisper-small">{t('models.name.whisper-small')}</option>
        </select>
      </div>
      <div className={look.inline}>
        <label htmlFor="cap-lang">{t('captions.language')}</label>
        <select id="cap-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {td(`captions.lang.${l}`)}
            </option>
          ))}
        </select>
      </div>
      <div className={look.presetRow}>
        <button type="button" className={look.addButton} disabled={busy} onClick={() => void run()}>
          {busy ? t('captions.transcribing') : t('captions.transcribe')}
        </button>
      </div>
      <p className={look.hint}>{t('captions.transcribeHint')}</p>
    </Section>
  )
}

function CueList({ sequence }: { sequence: Sequence }) {
  const cues = sequence.captions.cues
  const update = (id: string, patch: Partial<CaptionCue>) =>
    setCaptions(sequence, {
      ...sequence.captions,
      // Edited text no longer matches the timed words, so those are dropped.
      cues: cues.map((c) =>
        c.id === id ? { ...c, ...patch, words: patch.text !== undefined ? [] : c.words } : c,
      ),
    })
  if (cues.length === 0) return <p className={styles.empty}>{t('captions.none')}</p>
  return (
    <ol className={styles.cues} aria-label={t('captions.cues')}>
      {cues.map((c) => (
        <li key={c.id} className={styles.cue}>
          <button
            type="button"
            className={`${styles.time} tabular`}
            aria-label={t('captions.goTo', { time: formatTimecode(c.start, sequence.fps) })}
            onClick={() => usePlayhead.getState().seek(c.start)}
          >
            {formatTimecode(c.start, sequence.fps)}
          </button>
          <textarea
            // Undo can change the text underneath; a new key reloads it.
            key={c.text}
            className={styles.text}
            aria-label={t('captions.textOf', { time: formatTimecode(c.start, sequence.fps) })}
            defaultValue={c.text}
            rows={2}
            onBlur={(e) => {
              const text = e.target.value.replace(/\s+/g, ' ').trim()
              if (text && text !== c.text) update(c.id, { text })
            }}
          />
          <button
            type="button"
            className={styles.remove}
            aria-label={t('captions.removeCue')}
            onClick={() =>
              setCaptions(sequence, {
                ...sequence.captions,
                cues: cues.filter((x) => x.id !== c.id),
              })
            }
          >
            <Trash2 size={13} strokeWidth={1.7} />
          </button>
        </li>
      ))}
    </ol>
  )
}

type Pick = { cue: number; word: number }

/** The words of the captions; choose some and take them out of the edit. */
function Transcript({ sequence }: { sequence: Sequence }) {
  const [anchor, setAnchor] = useState<Pick | null>(null)
  const [focus, setFocus] = useState<Pick | null>(null)
  const words = sequence.captions.cues.flatMap((c, ci) =>
    c.words.map((w, wi) => ({ ...w, ci, wi })),
  )
  if (words.length === 0) return <p className={styles.empty}>{t('captions.noWords')}</p>
  const index = (p: Pick | null) =>
    p ? words.findIndex((w) => w.ci === p.cue && w.wi === p.word) : -1
  const a = index(anchor)
  const b = index(focus)
  const [lo, hi] = a < 0 ? [-1, -1] : b < 0 ? [a, a] : [Math.min(a, b), Math.max(a, b)]
  const chosen = lo >= 0 ? words.slice(lo, hi + 1) : []
  const remove = () => {
    if (!chosen.length) return
    removeRanges(
      [[Math.floor(chosen[0]!.start), Math.ceil(chosen[chosen.length - 1]!.end)]],
      t('history.removeWords'),
    )
    setAnchor(null)
    setFocus(null)
  }
  return (
    <Section title={t('captions.editByText')}>
      <p className={look.hint}>{t('captions.editHint')}</p>
      <p
        className={styles.words}
        onKeyDown={(e) => {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            remove()
          }
        }}
      >
        {words.map((w, i) => (
          <button
            key={`${w.ci}-${w.wi}`}
            type="button"
            className={styles.word}
            aria-pressed={i >= lo && i <= hi}
            onClick={(e) => {
              const p = { cue: w.ci, word: w.wi }
              usePlayhead.getState().seek(Math.floor(w.start))
              if (e.shiftKey && anchor) setFocus(p)
              else {
                setAnchor(p)
                setFocus(null)
              }
            }}
          >
            {w.text}
          </button>
        ))}
      </p>
      <div className={look.presetRow}>
        <button type="button" className={look.addButton} disabled={!chosen.length} onClick={remove}>
          {chosen.length
            ? t('captions.removeWords', { text: joinWords(chosen) })
            : t('captions.removeNone')}
        </button>
      </div>
    </Section>
  )
}

function Cleanup({ sequence }: { sequence: Sequence }) {
  const [threshold, setThreshold] = useState(-40)
  const [minSeconds, setMin] = useState(0.6)
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<{
    ranges: [number, number][]
    kind: 'silence' | 'filler'
  } | null>(null)
  const [keep, setKeep] = useState<Set<number>>(new Set())
  const fps = fpsValue(sequence.fps)
  const show = (ranges: [number, number][], kind: 'silence' | 'filler') => {
    setFound({ ranges, kind })
    setKeep(new Set())
    if (!ranges.length)
      notify('info', kind === 'silence' ? t('captions.noSilence') : t('captions.noFillers'))
  }
  const findSilence = async () => {
    setBusy(true)
    try {
      show(await silenceRanges(threshold, minSeconds), 'silence')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const apply = () => {
    if (!found) return
    const chosen = found.ranges.filter((_, i) => !keep.has(i))
    removeRanges(
      chosen,
      found.kind === 'silence' ? t('history.removeSilence') : t('history.removeFillers'),
    )
    notify('info', t('captions.removed', { count: chosen.length }))
    setFound(null)
  }
  return (
    <Section title={t('captions.cleanup')}>
      <div className={look.inline}>
        <span>{t('captions.quieterThan')}</span>
        <NumberField
          label={t('captions.quieterThan')}
          value={threshold}
          min={-80}
          max={-15}
          step={1}
          unit=" dB"
          precision={0}
          onChange={setThreshold}
        />
      </div>
      <div className={look.inline}>
        <span>{t('captions.longerThan')}</span>
        <NumberField
          label={t('captions.longerThan')}
          value={minSeconds}
          min={0.2}
          max={5}
          step={0.1}
          unit=" s"
          precision={1}
          onChange={setMin}
        />
      </div>
      <div className={look.presetRow}>
        <button
          type="button"
          className={look.addButton}
          disabled={busy}
          onClick={() => void findSilence()}
        >
          {busy ? t('captions.listening') : t('captions.findSilence')}
        </button>
        <button
          type="button"
          className={look.addButton}
          onClick={() => show(fillerWordRanges(), 'filler')}
        >
          {t('captions.findFillers')}
        </button>
      </div>
      {found && found.ranges.length ? (
        <>
          <ul className={styles.review} aria-label={t('captions.review')}>
            {found.ranges.map(([a, b], i) => (
              <li key={`${a}-${b}`}>
                <label className={look.check}>
                  <input
                    type="checkbox"
                    checked={!keep.has(i)}
                    onChange={(e) => {
                      const next = new Set(keep)
                      if (e.target.checked) next.delete(i)
                      else next.add(i)
                      setKeep(next)
                    }}
                  />
                  <span className="tabular">
                    {t('captions.range', {
                      at: formatTimecode(a, sequence.fps),
                      length: ((b - a) / fps).toFixed(1),
                    })}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className={look.presetRow}>
            <button type="button" className={look.addButton} onClick={apply}>
              {t('captions.removeChosen', { count: found.ranges.length - keep.size })}
            </button>
          </div>
        </>
      ) : null}
    </Section>
  )
}

function StyleEditor({ sequence, captions }: { sequence: Sequence; captions: CaptionTrack }) {
  const s = captions.style
  const set = (patch: Partial<CaptionStyle>) =>
    setCaptions(sequence, { ...captions, style: { ...s, ...patch } })
  return (
    <Section title={t('captions.look')}>
      <label className={look.check}>
        <input
          type="checkbox"
          checked={captions.show}
          onChange={(e) => setCaptions(sequence, { ...captions, show: e.target.checked })}
        />
        {t('captions.show')}
      </label>
      <div className={styles.templates} role="radiogroup" aria-label={t('captions.template')}>
        {CAPTION_TEMPLATES.map((tpl) => (
          <button
            key={tpl}
            type="button"
            role="radio"
            aria-checked={s.template === tpl}
            className={styles.template}
            onClick={() => set({ template: tpl })}
          >
            {td(`captions.templates.${tpl}`)}
          </button>
        ))}
      </div>
      <div className={look.inline}>
        <span>{t('captions.size')}</span>
        <NumberField
          label={t('captions.size')}
          value={s.size}
          min={12}
          max={200}
          step={1}
          unit=" px"
          precision={0}
          onChange={(size) => set({ size })}
        />
      </div>
      <div className={look.inline}>
        <span>{t('captions.position')}</span>
        <NumberField
          label={t('captions.position')}
          value={s.position}
          min={0}
          max={1}
          step={0.01}
          display={100}
          unit="%"
          precision={0}
          onChange={(position) => set({ position })}
        />
      </div>
      <div className={look.inline}>
        <label htmlFor="cap-color">{t('captions.color')}</label>
        <input
          id="cap-color"
          type="color"
          value={s.color}
          onChange={(e) => set({ color: e.target.value })}
        />
      </div>
      <div className={look.inline}>
        <label htmlFor="cap-highlight">{t('captions.highlight')}</label>
        <input
          id="cap-highlight"
          type="color"
          value={s.highlight}
          onChange={(e) => set({ highlight: e.target.value })}
        />
      </div>
      <label className={look.check}>
        <input
          type="checkbox"
          checked={s.uppercase}
          onChange={(e) => set({ uppercase: e.target.checked })}
        />
        {t('captions.uppercase')}
      </label>
    </Section>
  )
}

function Files({ sequence }: { sequence: Sequence }) {
  const fps = fpsValue(sequence.fps)
  const save = async (format: 'srt' | 'vtt' | 'ass') => {
    const c = sequence.captions
    const content =
      format === 'srt'
        ? toSrt(c, fps)
        : format === 'vtt'
          ? toVtt(c, fps)
          : toAss(c, fps, sequence.width, sequence.height)
    try {
      const saved = await window.lumacut.invoke('captions:save', {
        content,
        suggestedName: sequence.name,
        format,
      })
      if (saved)
        notify('info', t('captions.saved', { name: saved.path.split(/[\\/]/).pop() ?? '' }))
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error))
    }
  }
  const open = async () => {
    try {
      const file = await window.lumacut.invoke('captions:open')
      if (!file) return
      const cues = parseSubtitles(file.text, fps)
      if (!cues.length) {
        notify('error', t('captions.unreadable', { name: file.name }))
        return
      }
      setCaptions(sequence, { ...sequence.captions, cues })
      notify('info', t('captions.imported', { count: cues.length }))
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error))
    }
  }
  const none = sequence.captions.cues.length === 0
  return (
    <Section title={t('captions.files')}>
      <div className={look.presetRow}>
        <button type="button" className={look.addButton} onClick={() => void open()}>
          {t('captions.import')}
        </button>
        {(['srt', 'vtt', 'ass'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={look.addButton}
            disabled={none}
            onClick={() => void save(f)}
          >
            {td(`captions.export.${f}`)}
          </button>
        ))}
      </div>
      <p className={look.hint}>{t('captions.filesHint')}</p>
    </Section>
  )
}
