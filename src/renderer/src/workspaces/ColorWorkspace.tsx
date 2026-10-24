import { ClipStrip } from '../panels/color/ClipStrip'
import { GradePanel } from '../panels/color/GradePanel'
import { Scopes } from '../panels/color/Scopes'
import { Viewer } from '../panels/Viewer'
import { Splitter, useLayout } from '../components/Splitter'
import styles from './Workspace.module.css'

/** Viewer and scopes on top, the clips to grade in a strip, and the grade controls below. */
export function ColorWorkspace() {
  const layout = useLayout('color')
  return (
    <div className={styles.color} style={layout}>
      <Viewer />
      <Scopes />
      <ClipStrip />
      <GradePanel />
      <Splitter workspace="color" handle="right" span="top" />
      <Splitter workspace="color" handle="top" />
    </div>
  )
}
