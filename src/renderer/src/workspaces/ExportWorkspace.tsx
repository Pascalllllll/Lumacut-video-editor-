import { ExportPanel } from '../panels/export/ExportPanel'
import { ExportQueue } from '../panels/export/ExportQueue'
import { Viewer } from '../panels/Viewer'
import { Splitter, useLayout } from '../components/Splitter'
import styles from './Workspace.module.css'

/** The viewer and the export queue on the left, presets and settings on the right. */
export function ExportWorkspace() {
  const layout = useLayout('export')
  return (
    <div className={styles.export} style={layout}>
      <Viewer />
      <ExportQueue />
      <ExportPanel />
      <Splitter workspace="export" handle="right" />
      <Splitter workspace="export" handle="top" />
    </div>
  )
}
