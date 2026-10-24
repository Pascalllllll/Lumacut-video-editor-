import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { t } from '../i18n'
import { ACTIONS, effectiveKeymap, keyLabel } from '../lib/keymap'
import { useEditor } from '../state/editor'
import { useSettings } from '../state/settings'
import styles from './CommandPalette.module.css'

/** Every command by name, with its shortcut; Enter runs the highlighted one. */
export function CommandPalette() {
  const open = useEditor((s) => s.palette)
  const close = () => useEditor.setState({ palette: false })
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.palette} aria-describedby={undefined}>
          <Dialog.Title className={styles.hidden}>{t('keys.palette')}</Dialog.Title>
          {open ? <Search onDone={close} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Search({ onDone }: { onDone: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const keymap = useSettings((s) => s.settings.keymap)
  const keys = useMemo(() => effectiveKeymap(keymap), [keymap])
  const items = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return ACTIONS.filter((a) => a.id !== 'app.palette')
      .map((a) => ({ ...a, text: a.label() }))
      .filter((a) => words.every((w) => a.text.toLowerCase().includes(w)))
  }, [query])
  const at = Math.min(index, Math.max(0, items.length - 1))
  const run = (i: number) => {
    const item = items[i]
    if (!item) return
    onDone()
    // Let the dialog close first so the command sees the editor, not the palette.
    requestAnimationFrame(() => item.run())
  }
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setIndex(Math.min(items.length - 1, at + 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setIndex(Math.max(0, at - 1))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          run(at)
        }
      }}
    >
      <input
        className={styles.input}
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={items[at] ? `palette-${items[at].id}` : undefined}
        aria-label={t('keys.paletteLabel')}
        placeholder={t('keys.paletteLabel')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setIndex(0)
        }}
      />
      <ul id="palette-list" role="listbox" className={styles.list} aria-label={t('keys.palette')}>
        {items.length === 0 ? <li className={styles.empty}>{t('keys.paletteEmpty')}</li> : null}
        {items.map((a, i) => (
          <li
            key={a.id}
            id={`palette-${a.id}`}
            role="option"
            aria-selected={i === at}
            className={styles.item}
            onMouseMove={() => setIndex(i)}
            onClick={() => run(i)}
          >
            <span>{a.text}</span>
            {keys[a.id]?.[0] ? <kbd className={styles.kbd}>{keyLabel(keys[a.id]![0]!)}</kbd> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
