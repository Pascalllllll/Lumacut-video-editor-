import { useEffect, useRef, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { RotateCcw, X } from 'lucide-react'
import { PROVIDERS } from '@shared/providers'
import type { IpcResponse } from '@shared/ipc'
import { t, td } from '../../i18n'
import { IconButton } from '../../components/IconButton'
import { Panel } from '../../components/Panel'
import {
  applyChanges,
  askCopilot,
  discardChanges,
  newChat,
  stopCopilot,
  useCopilot,
} from '../../state/copilot'
import { selectProject, selectSequence, useProject } from '../../state/project'
import { useSettings } from '../../state/settings'
import look from '../look/Look.module.css'
import { DiffView } from './DiffView'
import styles from './Copilot.module.css'

const QUICK = ['silences', 'highlight', 'chapters', 'translate'] as const

/** A chat that edits the timeline through the same commands as the editor, reviewed before they land. */
export function Copilot({ onOpenSettings }: { onOpenSettings: () => void }) {
  const ai = useSettings((s) => s.settings.ai)
  return (
    <Panel.Root label={t('copilot.title')} area="inspector">
      <Panel.Header>
        <Panel.Title>{t('copilot.title')}</Panel.Title>
        <span className={styles.model}>
          {ai.provider
            ? `${td(`copilot.provider.${ai.provider}`)} · ${ai.model || PROVIDERS[ai.provider].defaultModel || t('copilot.noModel')}`
            : ''}
        </span>
        <IconButton label={t('copilot.newChat')} onClick={newChat}>
          <RotateCcw size={14} strokeWidth={1.7} />
        </IconButton>
        <IconButton label={t('copilot.close')} onClick={() => useCopilot.setState({ open: false })}>
          <X size={14} strokeWidth={1.7} />
        </IconButton>
      </Panel.Header>
      <Panel.Body>
        {ai.provider ? (
          <Tabs.Root defaultValue="chat" className={styles.root}>
            <Tabs.List className={look.tabs} aria-label={t('copilot.views')}>
              <Tabs.Trigger value="chat" className={look.tab}>
                {t('copilot.chat')}
              </Tabs.Trigger>
              <Tabs.Trigger value="history" className={look.tab}>
                {t('copilot.history')}
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="chat" className={styles.chatTab}>
              <Chat />
            </Tabs.Content>
            <Tabs.Content value="history">
              <History />
            </Tabs.Content>
          </Tabs.Root>
        ) : (
          <div className={styles.setup}>
            <p>{t('copilot.setup')}</p>
            <button type="button" className={look.addButton} onClick={onOpenSettings}>
              {t('copilot.openSettings')}
            </button>
          </div>
        )}
      </Panel.Body>
    </Panel.Root>
  )
}

function Chat() {
  const lines = useCopilot((s) => s.lines)
  const running = useCopilot((s) => s.running)
  const pending = useCopilot((s) => s.pending)
  const [draft, setDraft] = useState('')
  const end = useRef<HTMLDivElement>(null)
  // Braces matter: scrollIntoView returns a promise in Chromium, and an effect must not return one.
  useEffect(() => {
    void end.current?.scrollIntoView({ block: 'end' })
  }, [lines.length, pending])
  const send = (text = draft) => {
    const prompt = text.trim()
    if (!prompt || running) return
    setDraft('')
    void askCopilot(prompt)
  }
  return (
    <div className={styles.chat}>
      <div className={styles.lines} aria-live="polite">
        {lines.length === 0 ? (
          <div className={styles.quick}>
            <p className={look.hint}>{t('copilot.intro')}</p>
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                className={styles.chip}
                onClick={() => send(td(`copilot.quick.${q}`))}
              >
                {td(`copilot.quick.${q}`)}
              </button>
            ))}
          </div>
        ) : null}
        {lines.map((l, i) =>
          l.kind === 'tool' ? (
            <p key={i} className={styles.tool} data-error={l.error}>
              <span className={styles.toolName}>{l.name.replace(/_/g, ' ')}</span> {l.result}
            </p>
          ) : (
            <p key={i} className={styles.line} data-kind={l.kind}>
              {l.text}
            </p>
          ),
        )}
        {running ? <p className={styles.working}>{t('copilot.working')}</p> : null}
        {pending ? (
          <section className={styles.pending} aria-label={t('copilot.review')}>
            <h3 className={styles.pendingTitle}>{t('copilot.review')}</h3>
            <DiffView diff={pending.diff} />
            <div className={styles.pendingActions}>
              <button type="button" className={styles.secondary} onClick={discardChanges}>
                {t('copilot.discard')}
              </button>
              <button type="button" className={styles.primary} onClick={applyChanges}>
                {t('copilot.apply')}
              </button>
            </div>
            <p className={look.hint}>{t('copilot.undoHint')}</p>
          </section>
        ) : null}
        <div ref={end} />
      </div>
      <Outgoing prompt={draft} />
      <div className={styles.composer}>
        <textarea
          className={styles.input}
          aria-label={t('copilot.prompt')}
          placeholder={t('copilot.placeholder')}
          value={draft}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              send()
            }
          }}
        />
        {running ? (
          <button type="button" className={styles.secondary} onClick={stopCopilot}>
            {t('copilot.stop')}
          </button>
        ) : (
          <button
            type="button"
            className={styles.primary}
            disabled={!draft.trim()}
            onClick={() => send()}
          >
            {t('copilot.send')}
          </button>
        )}
      </div>
    </div>
  )
}

/** What the first request sends and where, with a rough token count. */
function Outgoing({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<IpcResponse<'copilot:preview'> | null>(null)
  useEffect(() => {
    if (!open) return
    const state = useProject.getState()
    let live = true
    const timer = setTimeout(() => {
      void window.lumacut
        .invoke('copilot:preview', {
          prompt,
          project: selectProject(state),
          sequenceId: selectSequence(state).id,
        })
        .then((p) => live && setPreview(p))
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [open, prompt])
  return (
    <details
      className={styles.outgoing}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>{t('copilot.whatIsSent')}</summary>
      {preview ? (
        <div className={styles.outgoingBody}>
          <p>
            {preview.local
              ? t('copilot.sentLocal', { to: preview.destination })
              : t('copilot.sentCloud', { to: preview.destination })}
          </p>
          <p>
            {t('copilot.estimate', {
              tokens: preview.estimatedTokens.toLocaleString(),
              tools: preview.tools,
            })}
          </p>
          <p className={look.hint}>{t('copilot.alsoSent')}</p>
          <pre className={styles.pre}>{preview.message}</pre>
        </div>
      ) : (
        <p className={look.hint}>{t('copilot.loading')}</p>
      )}
    </details>
  )
}

function History() {
  const projectId = useProject((s) => s.history.project.id)
  const [entries, setEntries] = useState<IpcResponse<'copilot:history'>>([])
  const lines = useCopilot((s) => s.lines.length)
  useEffect(() => {
    void window.lumacut.invoke('copilot:history', { projectId }).then(setEntries)
  }, [projectId, lines])
  if (!entries.length) return <p className={styles.empty}>{t('copilot.noHistory')}</p>
  return (
    <ol className={styles.history}>
      {entries.map((e) => (
        <li key={e.at}>
          <span className={styles.when}>
            {new Date(e.at).toLocaleString()} · {e.model}
          </span>
          <span className={styles.prompt}>{e.prompt}</span>
          <span className={look.hint}>
            {e.reply} {t('copilot.changes', { count: e.changes })}
          </span>
        </li>
      ))}
    </ol>
  )
}
