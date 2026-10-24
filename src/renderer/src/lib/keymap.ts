import { menuCommandSchema, type MenuCommand } from '@shared/ipc'
import { WORKSPACES, type KeymapPreset, type Settings } from '@shared/settings'
import { t, td, type MessageKey } from '../i18n'
import { useCopilot } from '../state/copilot'
import { TOOLS, useEditor } from '../state/editor'
import { useSettings } from '../state/settings'
import { runCommand } from './actions'

/**
 * Everything the keyboard and the command palette can run. Arrow keys,
 * Home/End, J/K/L and the angle numbers stay fixed as navigation keys.
 */
export type Action = { id: string; label: () => string; group: string; run: () => void }

const MENU_LABELS: Record<MenuCommand, MessageKey> = {
  'project.new': 'menu.new',
  'project.open': 'menu.open',
  'project.versions': 'menu.versions',
  'project.save': 'menu.save',
  'project.saveAs': 'menu.saveAs',
  'media.import': 'menu.import',
  'media.proxies': 'menu.proxies',
  'sequence.new': 'menu.newSequence',
  'sequence.export': 'menu.export',
  'edit.undo': 'menu.undo',
  'edit.redo': 'menu.redo',
  'edit.split': 'menu.split',
  'edit.delete': 'menu.delete',
  'edit.rippleDelete': 'menu.rippleDelete',
  'edit.insert': 'menu.insert',
  'edit.overwrite': 'menu.overwrite',
  'edit.replace': 'menu.replace',
  'edit.fitToFill': 'menu.fitToFill',
  'edit.lift': 'menu.lift',
  'edit.extract': 'menu.extract',
  'mark.in': 'menu.markIn',
  'mark.out': 'menu.markOut',
  'mark.clip': 'menu.markClip',
  'mark.clear': 'menu.markClear',
  'marker.add': 'menu.marker',
  'clip.link': 'menu.link',
  'clip.group': 'menu.group',
  'clip.ungroup': 'menu.ungroup',
  'clip.compound': 'menu.compound',
  'clip.transition': 'menu.transition',
  'clip.multicam': 'menu.multicam',
  'timeline.magnetic': 'menu.magnetic',
  'timeline.snapping': 'menu.snapping',
  'timeline.zoomFit': 'menu.zoomFit',
  'view.toggleViewer': 'menu.toggleViewer',
  'playback.toggle': 'menu.play',
  'help.whatsNew': 'menu.whatsNew',
  'help.updates': 'menu.updates',
  'help.tour': 'menu.tour',
  'project.home': 'menu.home',
}

export const ACTIONS: Action[] = [
  ...menuCommandSchema.options.map((id) => ({
    id,
    label: () => t(MENU_LABELS[id]),
    group: id.split('.')[0]!,
    run: () => runCommand(id),
  })),
  ...TOOLS.map((tool) => ({
    id: `tool.${tool.id}`,
    label: () => t('keys.toolAction', { tool: td(`tool.${tool.id}`) }),
    group: 'tool',
    run: () => useEditor.setState({ tool: tool.id }),
  })),
  ...WORKSPACES.map((w) => ({
    id: `workspace.${w}`,
    label: () => t('keys.workspaceAction', { workspace: td(`workspace.${w}`) }),
    group: 'workspace',
    run: () => void useSettings.getState().update({ workspace: w }),
  })),
  {
    id: 'app.palette',
    label: () => t('keys.palette'),
    group: 'app',
    run: () => useEditor.setState({ palette: true }),
  },
  {
    id: 'app.copilot',
    label: () => t('keys.copilot'),
    group: 'app',
    run: () => useCopilot.setState((s) => ({ open: !s.open })),
  },
  {
    id: 'app.settings',
    label: () => t('keys.settings'),
    group: 'app',
    run: () => useEditor.setState({ settingsOpen: true }),
  },
]

export const ACTIONS_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]))

type Keymap = Record<string, string[]>

/** Lumacut's own keys; the other presets change only what differs. */
const BASE: Keymap = {
  'project.new': ['Mod+N'],
  'project.open': ['Mod+O'],
  'project.save': ['Mod+S'],
  'project.saveAs': ['Mod+Shift+S'],
  'media.import': ['Mod+I'],
  'sequence.new': ['Mod+Alt+N'],
  'sequence.export': ['Mod+E'],
  'edit.undo': ['Mod+Z'],
  'edit.redo': ['Mod+Shift+Z', 'Mod+Y'],
  'edit.split': ['S'],
  'edit.delete': ['Delete', 'Backspace'],
  'edit.rippleDelete': ['Shift+Delete', 'Shift+Backspace'],
  'edit.insert': [','],
  'edit.overwrite': ['.'],
  'edit.replace': ['Shift+R'],
  'edit.fitToFill': ['Shift+F'],
  'edit.lift': [';'],
  'edit.extract': ["'"],
  'mark.in': ['I'],
  'mark.out': ['O'],
  'mark.clip': ['X'],
  'mark.clear': ['Alt+X'],
  'marker.add': ['M'],
  'clip.link': ['Mod+L'],
  'clip.group': ['Mod+G'],
  'clip.ungroup': ['Mod+Shift+G'],
  'clip.compound': ['Alt+G'],
  'clip.transition': ['Mod+D'],
  'timeline.magnetic': ['Shift+M'],
  'timeline.snapping': ['Shift+S'],
  'timeline.zoomFit': ['Shift+Z'],
  'view.toggleViewer': ['Q'],
  'playback.toggle': ['Space'],
  ...Object.fromEntries(TOOLS.map((tool) => [`tool.${tool.id}`, [tool.key]])),
  'app.palette': ['Mod+K'],
  'app.copilot': ['Mod+Shift+A'],
  'app.settings': ['Mod+,'],
}

const PRESET_CHANGES: Record<KeymapPreset, Keymap> = {
  lumacut: {},
  // Premiere Pro: Cmd/Ctrl+K adds an edit and Cmd/Ctrl+M exports.
  premiere: {
    'edit.split': ['Mod+K', 'S'],
    'app.palette': ['Mod+Shift+P'],
    'sequence.export': ['Mod+M', 'Mod+E'],
    'marker.add': ['M'],
  },
  // Final Cut Pro: A selects, B is the blade, W/D insert and overwrite, N snaps.
  finalcut: {
    'tool.select': ['A'],
    'tool.blade': ['B'],
    'tool.ripple': ['T'],
    'edit.split': ['Mod+B'],
    'edit.insert': ['W'],
    'edit.overwrite': ['D'],
    'timeline.snapping': ['N'],
    'clip.compound': ['Alt+G'],
  },
  // DaVinci Resolve: A selects, B is the blade, Ctrl+B splits, F9/F10/F11 edit.
  resolve: {
    'tool.select': ['A'],
    'tool.blade': ['B'],
    'tool.ripple': ['T'],
    'edit.split': ['Mod+B', 'Mod+\\'],
    'edit.insert': ['F9'],
    'edit.overwrite': ['F10'],
    'edit.replace': ['F11'],
    'edit.fitToFill': ['Shift+F11'],
    'timeline.snapping': ['N'],
  },
}

/** Applies changes on top of a map; a key taken by a change is removed from its old action. */
function applyChanges(base: Keymap, changes: Keymap): Keymap {
  const out: Keymap = { ...base }
  const taken = new Set(Object.values(changes).flat())
  for (const [id, keys] of Object.entries(out)) out[id] = keys.filter((k) => !taken.has(k))
  return { ...out, ...changes }
}

export function presetKeymap(preset: KeymapPreset): Keymap {
  return applyChanges(BASE, PRESET_CHANGES[preset])
}

/** The keys in force: the preset with the user's own changes on top. */
export function effectiveKeymap(k: Settings['keymap']): Keymap {
  return applyChanges(presetKeymap(k.preset), k.custom)
}

let cache: { key: Settings['keymap']; map: Map<string, string> } | null = null
/** Key combo to action id, for the shortcut handler. */
export function bindings(): Map<string, string> {
  const k = useSettings.getState().settings.keymap
  if (cache?.key === k) return cache.map
  const map = new Map<string, string>()
  for (const [id, keys] of Object.entries(effectiveKeymap(k)))
    for (const key of keys) map.set(key, id)
  cache = { key: k, map }
  return map
}

const isMac = window.lumacut.platform === 'darwin'

/** A combo as people read it on this platform. */
export function keyLabel(combo: string): string {
  return combo
    .split('+')
    .map((p) => (p === 'Mod' ? (isMac ? 'Cmd' : 'Ctrl') : p === 'Alt' && isMac ? 'Option' : p))
    .join('+')
}

/** Key combo from a keyboard event, as "Mod+Shift+Z"; Mod is Cmd on macOS and Ctrl elsewhere. */
export function comboOf(e: {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}): string {
  const parts = []
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod')
  if (e.shiftKey && (/^[a-z]$/i.test(e.key) || e.key.length > 1)) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  const key = e.code === 'Space' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  parts.push(key)
  return parts.join('+')
}

export function runAction(id: string) {
  ACTIONS_BY_ID.get(id)?.run()
}
