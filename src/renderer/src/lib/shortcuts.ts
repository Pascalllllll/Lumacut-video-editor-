import { useEffect } from 'react'
import { sequenceDuration } from '@engine/timeline'
import { fpsValue } from '@engine/time'
import { jumpToEdit, runCommand, switchAngle } from './actions'
import { bindings, comboOf, runAction } from './keymap'
import { useEditor } from '../state/editor'
import { usePlayhead } from '../state/playhead'
import { selectSequence, useProject } from '../state/project'

const SHUTTLE = [1, 2, 4, 8]

/** Sliders, checkboxes and the like take arrows and Space but no typing, so other shortcuts still apply. */
const TEXT_FIELD =
  'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="button"]), textarea, select, [contenteditable="true"]'

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return Boolean(el?.closest(TEXT_FIELD))
}

/** J/K/L: L plays forward and speeds up on each press, J the same backwards, K stops. */
function shuttle(key: 'J' | 'K' | 'L') {
  const playhead = usePlayhead.getState()
  if (key === 'K') return playhead.setPlaying(false)
  const dir = key === 'L' ? 1 : -1
  const current = playhead.playing ? playhead.rate : 0
  const step =
    Math.sign(current) === dir
      ? SHUTTLE[Math.min(SHUTTLE.length - 1, SHUTTLE.indexOf(Math.abs(current)) + 1)]!
      : 1
  playhead.shuttle(dir * step)
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.defaultPrevented) return
      // Dialogs, sheets and the tour keep their keys; nothing should edit the timeline behind them.
      if ((e.target as HTMLElement | null)?.closest('[role="dialog"], [role="alertdialog"]')) return
      // The start screen only takes commands with a modifier, like opening a project.
      if (useEditor.getState().home && !e.ctrlKey && !e.metaKey) return
      // A focused slider keeps its own arrow, Home, End and Page keys.
      if (
        /^(Arrow|Home$|End$|Page)/.test(e.key) &&
        (e.target as HTMLElement | null)?.closest('input[type="range"], [role="slider"]')
      )
        return
      // Space and Enter on a focused control should press it.
      if (
        (e.code === 'Space' || e.key === 'Enter') &&
        (e.target as HTMLElement | null)?.closest(
          'button, [role="radio"], [role="tab"], [role="menuitem"]',
        )
      )
        return

      const playhead = usePlayhead.getState()
      const seq = selectSequence(useProject.getState())
      const step = e.shiftKey ? Math.round(fpsValue(seq.fps)) : 1
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey
      if (plain && useEditor.getState().viewer === 'timeline') {
        switch (e.key) {
          case 'ArrowLeft':
            e.preventDefault()
            return playhead.seek(playhead.frame - step)
          case 'ArrowRight':
            e.preventDefault()
            return playhead.seek(Math.min(sequenceDuration(seq), playhead.frame + step))
          case 'ArrowUp':
            e.preventDefault()
            return jumpToEdit(-1)
          case 'ArrowDown':
            e.preventDefault()
            return jumpToEdit(1)
          case 'Home':
            e.preventDefault()
            return playhead.seek(0)
          case 'End':
            e.preventDefault()
            return playhead.seek(sequenceDuration(seq))
        }
      }
      if (plain && !e.shiftKey) {
        const upper = e.key.toUpperCase()
        if (upper === 'J' || upper === 'K' || upper === 'L') {
          e.preventDefault()
          if (useEditor.getState().viewer === 'source')
            return window.dispatchEvent(
              new CustomEvent('lumacut:source-shuttle', { detail: upper }),
            )
          return shuttle(upper)
        }
        if (/^[1-9]$/.test(e.key)) {
          e.preventDefault()
          return switchAngle(Number(e.key) - 1)
        }
      }

      const action = bindings().get(comboOf(e))
      if (!action) return
      e.preventDefault()
      runAction(action)
    }
    window.addEventListener('keydown', onKey)
    const offMenu = window.lumacut.on('menu:command', runCommand)
    return () => {
      window.removeEventListener('keydown', onKey)
      offMenu()
    }
  }, [])
}
