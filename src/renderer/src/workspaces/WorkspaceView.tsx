import type { Workspace } from '@shared/settings'
import { t } from '../i18n'
import { isWorkspaceAvailable, isWorkspaceBuilt } from '../lib/features'
import { EmptyState } from '../components/EmptyState'
import { EditWorkspace } from './EditWorkspace'
import { AudioWorkspace } from './AudioWorkspace'
import { CaptionsWorkspace } from './CaptionsWorkspace'
import { ExportWorkspace } from './ExportWorkspace'
import { ColorWorkspace } from './ColorWorkspace'
import styles from './Workspace.module.css'

export function WorkspaceView({ workspace }: { workspace: Workspace }) {
  const active = isWorkspaceAvailable(workspace) ? workspace : 'edit'

  if (active === 'edit') return <EditWorkspace />
  if (active === 'color') return <ColorWorkspace />
  if (active === 'audio') return <AudioWorkspace />
  if (active === 'captions') return <CaptionsWorkspace />
  if (active === 'export') return <ExportWorkspace />
  if (!isWorkspaceBuilt(active)) {
    return (
      <div className={styles.unbuilt}>
        <EmptyState
          title={t('empty.unbuilt.title', { workspace: t(`workspace.${active}`) })}
          body={t('empty.unbuilt.body')}
        />
      </div>
    )
  }
  return null
}
