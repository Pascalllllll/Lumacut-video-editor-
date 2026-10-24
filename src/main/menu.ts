import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/ipc'

/**
 * The native menu is the full command list on macOS. On Windows and Linux the
 * window is frameless, so the same commands are also in the app's own menu
 * button; shortcuts are handled by the renderer on every platform.
 */
export function buildMenu(isDev: boolean, run: (command: MenuCommand) => void): Menu {
  const isMac = process.platform === 'darwin'
  const item = (
    label: string,
    command: MenuCommand,
    accelerator?: string,
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    // The renderer already handles the key; the accelerator is shown for reference only.
    registerAccelerator: false,
    click: () => run(command),
  })
  const sep = { type: 'separator' as const }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        item('Start screen', 'project.home'),
        item('New project', 'project.new', 'CmdOrCtrl+N'),
        item('Open project…', 'project.open', 'CmdOrCtrl+O'),
        item('Restore an earlier version…', 'project.versions'),
        sep,
        item('Save', 'project.save', 'CmdOrCtrl+S'),
        item('Save as…', 'project.saveAs', 'CmdOrCtrl+Shift+S'),
        sep,
        item('Import media…', 'media.import', 'CmdOrCtrl+I'),
        item('Create proxies for selected media', 'media.proxies'),
        item('New sequence', 'sequence.new', 'CmdOrCtrl+Alt+N'),
        item('Export…', 'sequence.export', 'CmdOrCtrl+E'),
        ...(isMac ? [] : [sep, { role: 'quit' as const }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        item('Undo', 'edit.undo', 'CmdOrCtrl+Z'),
        item('Redo', 'edit.redo', 'CmdOrCtrl+Shift+Z'),
        sep,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        sep,
        item('Split at playhead', 'edit.split', 'S'),
        item('Delete', 'edit.delete', 'Delete'),
        item('Ripple delete', 'edit.rippleDelete', 'Shift+Delete'),
        sep,
        item('Insert from source', 'edit.insert', ','),
        item('Overwrite from source', 'edit.overwrite', '.'),
        item('Replace with source', 'edit.replace', 'Shift+R'),
        item('Fit to fill', 'edit.fitToFill', 'Shift+F'),
        item('Lift range', 'edit.lift', ';'),
        item('Extract range', 'edit.extract', "'"),
      ],
    },
    {
      label: 'Mark',
      submenu: [
        item('Set in point', 'mark.in', 'I'),
        item('Set out point', 'mark.out', 'O'),
        item('Mark selected clip', 'mark.clip', 'X'),
        item('Clear in and out', 'mark.clear', 'Alt+X'),
        sep,
        item('Add marker', 'marker.add', 'M'),
      ],
    },
    {
      label: 'Clip',
      submenu: [
        item('Link or unlink', 'clip.link', 'CmdOrCtrl+L'),
        item('Group', 'clip.group', 'CmdOrCtrl+G'),
        item('Ungroup', 'clip.ungroup', 'CmdOrCtrl+Shift+G'),
        sep,
        item('Make compound clip', 'clip.compound', 'Alt+G'),
        item('Add default transition', 'clip.transition', 'CmdOrCtrl+D'),
        item('Create multicam clip from selected media', 'clip.multicam'),
      ],
    },
    {
      label: 'Timeline',
      submenu: [
        item('Play or pause', 'playback.toggle', 'Space'),
        item('Switch between source and timeline', 'view.toggleViewer', 'Q'),
        sep,
        item('Magnetic timeline', 'timeline.magnetic', 'Shift+M'),
        item('Snapping', 'timeline.snapping', 'Shift+S'),
        item('Zoom to fit', 'timeline.zoomFit', 'Shift+Z'),
      ],
    },
    {
      label: 'View',
      submenu: [
        ...(isDev ? ([{ role: 'reload' }, { role: 'toggleDevTools' }, sep] as const) : []),
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        item('Take the tour', 'help.tour'),
        item('What’s new', 'help.whatsNew'),
        item('Check for updates…', 'help.updates'),
        sep,
        { label: `${app.getName()} ${app.getVersion()}`, enabled: false },
      ],
    },
  ]
  return Menu.buildFromTemplate(template)
}
