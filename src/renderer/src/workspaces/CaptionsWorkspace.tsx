import { Captions } from '../panels/captions/Captions'
import { Timeline } from '../panels/timeline/Timeline'
import { Viewer } from '../panels/Viewer'
import { Splitter, useLayout } from '../components/Splitter'
import styles from './Workspace.module.css'

/** Viewer and timeline on the left; captions, transcript and their style on the right. */
export function CaptionsWorkspace() {
  const layout = useLayout('captions')
  return (
    <div className={styles.captions} style={layout}>
      <Viewer />
      <Captions />
      <Timeline />
      <Splitter workspace="captions" handle="right" />
      <Splitter workspace="captions" handle="top" />
    </div>
  )
}
