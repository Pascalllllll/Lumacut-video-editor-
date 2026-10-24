import { FolderOpen, X } from 'lucide-react'
import { t, td } from '../../i18n'
import { formatDuration } from '../../lib/format'
import { IconButton } from '../../components/IconButton'
import { Panel } from '../../components/Panel'
import { useExport, type ExportJob } from '../../state/export'
import styles from './Export.module.css'

function status(job: ExportJob): string {
  if (job.state === 'running') {
    const pct = t('export.status.running', { percent: Math.round(job.progress * 100) })
    return job.etaSeconds === null
      ? pct
      : `${pct} · ${t('export.remaining', { time: formatDuration(job.etaSeconds) })}`
  }
  if (job.state === 'failed') return `${t('export.status.failed')}: ${job.message}`
  return td(`export.status.${job.state}`)
}

/** Every export of this session; they run one after another while you keep editing. */
export function ExportQueue() {
  const jobs = useExport((s) => s.jobs)
  return (
    <Panel.Root label={t('export.queue')} area="queue">
      <Panel.Header>
        <Panel.Title>{t('export.queue')}</Panel.Title>
      </Panel.Header>
      <Panel.Body>
        {jobs.length === 0 ? <p className={styles.empty}>{t('export.queueEmpty')}</p> : null}
        <ol className={styles.jobs}>
          {jobs.map((job) => (
            <li key={job.jobId} className={styles.job} data-state={job.state}>
              <div className={styles.jobText}>
                <span className={styles.jobName}>{job.name}</span>
                <span className={styles.jobMeta}>
                  {td(`export.preset.${job.preset}`)} · {status(job)}
                </span>
                {job.state === 'running' ? (
                  <progress
                    className={styles.progress}
                    value={job.progress}
                    max={1}
                    aria-label={job.name}
                  />
                ) : null}
              </div>
              {job.state === 'running' || job.state === 'queued' ? (
                <IconButton
                  label={t('export.cancel')}
                  onClick={() => void window.lumacut.invoke('export:cancel', { jobId: job.jobId })}
                >
                  <X size={14} strokeWidth={1.7} />
                </IconButton>
              ) : job.state === 'done' ? (
                <IconButton
                  label={t('export.reveal')}
                  onClick={() => void window.lumacut.invoke('export:reveal', { path: job.path })}
                >
                  <FolderOpen size={14} strokeWidth={1.7} />
                </IconButton>
              ) : (
                <IconButton
                  label={t('export.remove')}
                  onClick={() =>
                    useExport.setState((s) => ({
                      jobs: s.jobs.filter((j) => j.jobId !== job.jobId),
                    }))
                  }
                >
                  <X size={14} strokeWidth={1.7} />
                </IconButton>
              )}
            </li>
          ))}
        </ol>
      </Panel.Body>
    </Panel.Root>
  )
}
