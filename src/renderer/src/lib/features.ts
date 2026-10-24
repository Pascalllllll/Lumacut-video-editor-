import type { Workspace } from '@shared/settings'

/**
 * Workspaces that aren't finished stay out of release builds. Development builds
 * show them so the shell can be checked as a whole.
 */
const BUILT_WORKSPACES: ReadonlySet<Workspace> = new Set([
  'edit',
  'color',
  'audio',
  'captions',
  'export',
])

export function isWorkspaceAvailable(workspace: Workspace): boolean {
  return import.meta.env.DEV || BUILT_WORKSPACES.has(workspace)
}

export function isWorkspaceBuilt(workspace: Workspace): boolean {
  return BUILT_WORKSPACES.has(workspace)
}
