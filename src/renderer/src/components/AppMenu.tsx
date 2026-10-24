import * as Menu from '@radix-ui/react-dropdown-menu'
import { Menu as MenuIcon } from 'lucide-react'
import type { MenuCommand } from '@shared/ipc'
import { t, type MessageKey } from '../i18n'
import { runCommand } from '../lib/actions'
import { IconButton } from './IconButton'
import styles from './AppMenu.module.css'

const mod = window.lumacut.platform === 'darwin' ? '⌘' : 'Ctrl+'

const GROUPS: { command: MenuCommand; label: MessageKey; keys: string }[][] = [
  [
    { command: 'project.home', label: 'menu.home', keys: '' },
    { command: 'project.new', label: 'menu.new', keys: `${mod}N` },
    { command: 'project.open', label: 'menu.open', keys: `${mod}O` },
    { command: 'project.versions', label: 'menu.versions', keys: '' },
    { command: 'project.save', label: 'menu.save', keys: `${mod}S` },
    { command: 'project.saveAs', label: 'menu.saveAs', keys: `${mod}Shift+S` },
  ],
  [
    { command: 'media.import', label: 'menu.import', keys: `${mod}I` },
    { command: 'sequence.new', label: 'menu.newSequence', keys: `${mod}Alt+N` },
    { command: 'sequence.export', label: 'menu.export', keys: `${mod}E` },
  ],
  [
    { command: 'edit.undo', label: 'menu.undo', keys: `${mod}Z` },
    { command: 'edit.redo', label: 'menu.redo', keys: `${mod}Shift+Z` },
    { command: 'edit.split', label: 'menu.split', keys: 'S' },
    { command: 'edit.delete', label: 'menu.delete', keys: 'Delete' },
    { command: 'edit.rippleDelete', label: 'menu.rippleDelete', keys: 'Shift+Delete' },
  ],
  [
    { command: 'edit.insert', label: 'menu.insert', keys: ',' },
    { command: 'edit.overwrite', label: 'menu.overwrite', keys: '.' },
    { command: 'edit.replace', label: 'menu.replace', keys: 'Shift+R' },
    { command: 'edit.fitToFill', label: 'menu.fitToFill', keys: 'Shift+F' },
    { command: 'edit.lift', label: 'menu.lift', keys: ';' },
    { command: 'edit.extract', label: 'menu.extract', keys: "'" },
  ],
  [
    { command: 'mark.in', label: 'menu.markIn', keys: 'I' },
    { command: 'mark.out', label: 'menu.markOut', keys: 'O' },
    { command: 'mark.clip', label: 'menu.markClip', keys: 'X' },
    { command: 'mark.clear', label: 'menu.markClear', keys: 'Alt+X' },
    { command: 'marker.add', label: 'menu.marker', keys: 'M' },
  ],
  [
    { command: 'clip.link', label: 'menu.link', keys: `${mod}L` },
    { command: 'clip.group', label: 'menu.group', keys: `${mod}G` },
    { command: 'clip.ungroup', label: 'menu.ungroup', keys: `${mod}Shift+G` },
    { command: 'clip.compound', label: 'menu.compound', keys: 'Alt+G' },
    { command: 'clip.transition', label: 'menu.transition', keys: `${mod}D` },
    { command: 'clip.multicam', label: 'menu.multicam', keys: '' },
    { command: 'media.proxies', label: 'menu.proxies', keys: '' },
  ],
  [
    { command: 'playback.toggle', label: 'menu.play', keys: 'Space' },
    { command: 'view.toggleViewer', label: 'menu.toggleViewer', keys: 'Q' },
    { command: 'timeline.magnetic', label: 'menu.magnetic', keys: 'Shift+M' },
    { command: 'timeline.snapping', label: 'menu.snapping', keys: 'Shift+S' },
    { command: 'timeline.zoomFit', label: 'menu.zoomFit', keys: 'Shift+Z' },
  ],
  [
    { command: 'help.tour', label: 'menu.tour', keys: '' },
    { command: 'help.whatsNew', label: 'menu.whatsNew', keys: '' },
    { command: 'help.updates', label: 'menu.updates', keys: '' },
  ],
]

/** The command list for Windows and Linux, where the frameless window has no menu bar. */
export function AppMenu() {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton label={t('menu.label')}>
          <MenuIcon size={15} strokeWidth={1.6} />
        </IconButton>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className={styles.content} align="start" sideOffset={4}>
          {GROUPS.map((group, i) => (
            <Menu.Group key={i}>
              {i > 0 ? <Menu.Separator className={styles.separator} /> : null}
              {group.map((item) => (
                <Menu.Item
                  key={item.command}
                  className={styles.item}
                  onSelect={() => runCommand(item.command)}
                >
                  <span>{t(item.label)}</span>
                  <kbd className={styles.keys}>{item.keys}</kbd>
                </Menu.Item>
              ))}
            </Menu.Group>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
