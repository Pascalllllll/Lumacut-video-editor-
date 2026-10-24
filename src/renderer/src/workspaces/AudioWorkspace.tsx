import { Mixer } from '../panels/mixer/Mixer'
import { Inspector } from '../panels/Inspector'
import { Timeline } from '../panels/timeline/Timeline'
import { Viewer } from '../panels/Viewer'
import { Copilot } from '../panels/copilot/Copilot'
import { useCopilot } from '../state/copilot'
import { useEditor } from '../state/editor'
import { Splitter, useLayout } from '../components/Splitter'
import styles from './Workspace.module.css'

/** Viewer and the clip's sound settings on top, the mixer across the middle, the timeline below. */
export function AudioWorkspace() {
  const copilot = useCopilot((s) => s.open)
  const layout = useLayout('audio')
  return (
    <div className={styles.audio} style={layout}>
      <Viewer />
      {copilot ? (
        <Copilot onOpenSettings={() => useEditor.setState({ settingsOpen: true })} />
      ) : (
        <Inspector />
      )}
      <Mixer />
      <Timeline />
      <Splitter workspace="audio" handle="right" span="top" />
      <Splitter workspace="audio" handle="top" />
    </div>
  )
}
