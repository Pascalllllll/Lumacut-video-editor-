import { Inspector } from '../panels/Inspector'
import { MediaBin } from '../panels/MediaBin'
import { Timeline } from '../panels/timeline/Timeline'
import { Viewer } from '../panels/Viewer'
import { Copilot } from '../panels/copilot/Copilot'
import { useCopilot } from '../state/copilot'
import { useEditor } from '../state/editor'
import { Splitter, useLayout } from '../components/Splitter'
import styles from './Workspace.module.css'

export function EditWorkspace() {
  const copilot = useCopilot((s) => s.open)
  const layout = useLayout('edit')
  return (
    <div className={styles.edit} style={layout}>
      <MediaBin />
      <Viewer />
      {copilot ? (
        <Copilot onOpenSettings={() => useEditor.setState({ settingsOpen: true })} />
      ) : (
        <Inspector />
      )}
      <Timeline />
      <Splitter workspace="edit" handle="left" />
      <Splitter workspace="edit" handle="right" span="top" />
      <Splitter workspace="edit" handle="top" />
    </div>
  )
}
