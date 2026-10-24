import { formatTimecode } from '@engine/time'
import { clipEnd } from '@engine/timeline'
import { t, td } from '../../i18n'
import type { SequenceDiff } from '../../lib/diff'
import styles from './Copilot.module.css'

/**
 * A change shown before it is applied: a small timeline of the result with
 * added, changed and removed clips marked, and a line per kind of change.
 */
export function DiffView({ diff }: { diff: SequenceDiff }) {
  const { before, after } = diff
  const tracks = after.tracks
  const total = Math.max(diff.durationBefore, diff.durationAfter, 1)
  const counts = { added: 0, removed: 0, changed: 0 }
  for (const c of diff.clips) counts[c.status]++
  const lines: string[] = []
  if (counts.added) lines.push(t('copilot.diff.added', { count: counts.added }))
  if (counts.removed) lines.push(t('copilot.diff.removed', { count: counts.removed }))
  if (counts.changed) lines.push(t('copilot.diff.changed', { count: counts.changed }))
  if (diff.durationAfter !== diff.durationBefore)
    lines.push(
      t('copilot.diff.length', {
        from: formatTimecode(diff.durationBefore, after.fps),
        to: formatTimecode(diff.durationAfter, after.fps),
      }),
    )
  if (diff.captions.changed)
    lines.push(t('copilot.diff.captions', { from: diff.captions.before, to: diff.captions.after }))
  if (diff.markers > 0) lines.push(t('copilot.diff.markers', { count: diff.markers }))
  for (const s of diff.settings)
    lines.push(td(`copilot.diff.setting.${s.includes('x') ? 'size' : s}`, { size: s }))

  // Rows are drawn tall in the 1000-wide box so they read at panel width.
  const rowH = 70
  const status = new Map(diff.clips.map((c) => [c.clip.id, c.status]))
  return (
    <figure className={styles.diff}>
      <svg
        className={styles.mini}
        viewBox={`0 0 1000 ${tracks.length * (rowH + 14)}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t('copilot.diff.picture')}
      >
        {tracks.map((tr, i) => {
          const y = i * (rowH + 14)
          const removed = Object.values(before.clips).filter(
            (c) => c.trackId === tr.id && !after.clips[c.id],
          )
          return (
            <g key={tr.id}>
              <rect className={styles.miniLane} x={0} y={y} width={1000} height={rowH} />
              {Object.values(after.clips)
                .filter((c) => c.trackId === tr.id)
                .map((c) => (
                  <rect
                    key={c.id}
                    className={styles.miniClip}
                    data-kind={tr.kind}
                    data-status={status.get(c.id) ?? 'same'}
                    x={(c.start / total) * 1000}
                    y={y}
                    width={Math.max(2, ((clipEnd(c) - c.start) / total) * 1000)}
                    height={rowH}
                  />
                ))}
              {removed.map((c) => (
                <rect
                  key={c.id}
                  className={styles.miniRemoved}
                  x={(c.start / total) * 1000}
                  y={y + 4}
                  width={Math.max(2, ((clipEnd(c) - c.start) / total) * 1000)}
                  height={rowH - 8}
                />
              ))}
            </g>
          )
        })}
      </svg>
      <figcaption>
        <ul className={styles.diffLines}>
          {lines.length ? (
            lines.map((l) => <li key={l}>{l}</li>)
          ) : (
            <li>{t('copilot.diff.none')}</li>
          )}
        </ul>
        <p className={styles.legend}>
          <span data-status="added">{t('copilot.diff.legendAdded')}</span>
          <span data-status="changed">{t('copilot.diff.legendChanged')}</span>
          <span data-status="removed">{t('copilot.diff.legendRemoved')}</span>
        </p>
      </figcaption>
    </figure>
  )
}
