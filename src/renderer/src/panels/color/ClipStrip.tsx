import type { Clip } from '@engine/model'
import { clipsOnTrack } from '@engine/timeline'
import { t } from '../../i18n'
import { useThumbnail } from '../../lib/media-cache'
import { usePlayhead } from '../../state/playhead'
import { selectProject, useProject } from '../../state/project'
import { useGradeClip } from './GradePanel'
import styles from './ClipStrip.module.css'

/** Every video clip in timeline order; click one to grade it. Graded clips are marked. */
export function ClipStrip() {
  const project = useProject(selectProject)
  const seq = project.sequences[project.activeSequenceId]!
  const { clip: current } = useGradeClip()
  const clips = seq.tracks
    .filter((tr) => tr.kind === 'video')
    .flatMap((tr) => clipsOnTrack(seq, tr.id))
    .filter((c) => project.media[c.mediaId]?.kind === 'video')
    .sort((a, b) => a.start - b.start)

  return (
    <section className={styles.strip} aria-label={t('grade.clips')} style={{ gridArea: 'strip' }}>
      {clips.length === 0 ? <p className={styles.empty}>{t('grade.noClips')}</p> : null}
      <ul className={styles.list}>
        {clips.map((c, i) => (
          <Thumb key={c.id} clip={c} index={i + 1} active={current?.id === c.id} />
        ))}
      </ul>
    </section>
  )
}

function Thumb({ clip, index, active }: { clip: Clip; index: number; active: boolean }) {
  const asset = useProject((s) => s.history.project.media[clip.mediaId])
  const thumb = useThumbnail(asset)
  return (
    <li>
      <button
        type="button"
        className={styles.thumb}
        data-active={active}
        aria-pressed={active}
        aria-label={t('grade.clipN', { n: index, name: asset?.name ?? '' })}
        onClick={() => {
          useProject.getState().select([clip.id])
          usePlayhead.getState().seek(clip.start + Math.floor(clip.duration / 2))
        }}
      >
        {thumb ? <img src={thumb} alt="" /> : null}
        <span className={styles.number}>{index}</span>
        {clip.grade.some((g) => g.enabled) ? (
          <span className={styles.graded}>{t('grade.graded')}</span>
        ) : null}
      </button>
    </li>
  )
}
