import { useCallback, useLayoutEffect, useState, type CSSProperties } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { t, type MessageKey } from '../i18n'
import { useEditor } from '../state/editor'
import { useSettings } from '../state/settings'
import sheet from './Sheet.module.css'
import styles from './Tour.module.css'

const mod = window.lumacut.platform === 'darwin' ? '⌘' : 'Ctrl+'

/** Each step points at a part of the Edit workspace by its data-tour name; the last one at nothing. */
export const TOUR_STEPS: { target: string | null; title: MessageKey; body: MessageKey }[] = [
  { target: 'media', title: 'tour.mediaTitle', body: 'tour.media' },
  { target: 'viewer', title: 'tour.viewerTitle', body: 'tour.viewer' },
  { target: 'timeline', title: 'tour.timelineTitle', body: 'tour.timeline' },
  { target: 'inspector', title: 'tour.inspectorTitle', body: 'tour.inspector' },
  { target: 'workspaces', title: 'tour.workspacesTitle', body: 'tour.workspaces' },
  { target: 'export', title: 'tour.exportTitle', body: 'tour.export' },
  { target: null, title: 'tour.paletteTitle', body: 'tour.palette' },
]

const GAP = 12
const PAD = 6
const CARD_W = 340
const CARD_H = 200

type Box = { top: number; left: number; width: number; height: number }

function place(target: Box | null): CSSProperties {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(CARD_W, vw - 32)
  if (!target) return { top: Math.max(16, vh / 2 - CARD_H / 2), left: vw / 2 - w / 2 }
  const clampTop = (y: number) => Math.min(Math.max(16, y), vh - CARD_H - 16)
  const clampLeft = (x: number) => Math.min(Math.max(16, x), vw - w - 16)
  const right = target.left + target.width + GAP
  if (right + w <= vw - 16) return { top: clampTop(target.top), left: right }
  if (target.left - GAP - w >= 16) return { top: clampTop(target.top), left: target.left - GAP - w }
  const below = target.top + target.height + GAP
  if (below + CARD_H <= vh - 16) return { top: below, left: clampLeft(target.left) }
  return { top: clampTop(target.top - GAP - CARD_H), left: clampLeft(target.left) }
}

/** A short walk through the Edit workspace, shown after the welcome sheet and from Help. */
export function Tour() {
  const step = useEditor((s) => s.tour)
  const update = useSettings((s) => s.update)
  const workspace = useSettings((s) => s.settings.workspace)
  const [box, setBox] = useState<Box | null>(null)
  const current = step === null ? null : TOUR_STEPS[step]

  const measure = useCallback(() => {
    const el = current?.target
      ? document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`)
      : null
    const r = el?.getBoundingClientRect()
    setBox(
      r && r.width > 0
        ? {
            top: r.top - PAD,
            left: r.left - PAD,
            width: r.width + PAD * 2,
            height: r.height + PAD * 2,
          }
        : null,
    )
  }, [current])

  // The tour shows the Edit workspace, so it switches there first.
  useLayoutEffect(() => {
    if (step !== null && workspace !== 'edit') void update({ workspace: 'edit' })
  }, [step, workspace, update])

  useLayoutEffect(() => {
    if (!current) return
    const frame = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
    }
  }, [current, measure, workspace])

  if (step === null || !current) return null

  const finish = () => {
    useEditor.setState({ tour: null })
    void update({ tourDone: true })
  }
  const go = (next: number) => {
    if (next >= TOUR_STEPS.length) finish()
    else useEditor.setState({ tour: Math.max(0, next) })
  }
  const last = step === TOUR_STEPS.length - 1

  return (
    <Dialog.Root open onOpenChange={(open) => !open && finish()}>
      <Dialog.Portal>
        {box ? (
          <div className={styles.spotlight} style={box} aria-hidden />
        ) : (
          <div className={styles.dim} aria-hidden />
        )}
        <Dialog.Content
          className={styles.card}
          style={place(box)}
          aria-describedby="tour-body"
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') go(step + 1)
            else if (e.key === 'ArrowLeft') go(step - 1)
          }}
        >
          <p className={styles.step}>
            {t('tour.step', { n: String(step + 1), total: String(TOUR_STEPS.length) })}
          </p>
          <Dialog.Title className={styles.title}>{t(current.title)}</Dialog.Title>
          <Dialog.Description id="tour-body" className={styles.body}>
            {t(current.body, { mod })}
          </Dialog.Description>
          <div className={styles.actions}>
            {last ? null : (
              <button type="button" className={styles.skip} onClick={finish}>
                {t('tour.skip')}
              </button>
            )}
            {step > 0 ? (
              <button type="button" className={sheet.button} onClick={() => go(step - 1)}>
                {t('tour.back')}
              </button>
            ) : null}
            <button
              type="button"
              className={`${sheet.button} ${sheet.primary}`}
              autoFocus
              onClick={() => go(step + 1)}
            >
              {last ? t('tour.done') : t('tour.next')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
