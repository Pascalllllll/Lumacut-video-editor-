import { create } from 'zustand'

type Base = { jobId: string; path: string; name: string; preset: string }
export type ExportJob =
  | (Base & { state: 'queued'; position: number })
  | (Base & { state: 'running'; progress: number; etaSeconds: number | null })
  | (Base & { state: 'done' })
  | (Base & { state: 'failed'; message: string })
  | (Base & { state: 'cancelled' })

type ExportState = {
  /** Every export of this session, newest first. */
  jobs: ExportJob[]
  /** The export the progress sheet follows (quick exports from the title bar). */
  focus: string | null
}

export const useExport = create<ExportState>(() => ({ jobs: [], focus: null }))

export const focusedJob = (s: ExportState) => s.jobs.find((j) => j.jobId === s.focus) ?? null

export function addJob(job: ExportJob, focus: boolean) {
  useExport.setState((s) => ({
    jobs: [job, ...s.jobs.filter((j) => j.jobId !== job.jobId)],
    focus: focus ? job.jobId : s.focus,
  }))
}

window.lumacut.on('export:update', (update) => {
  useExport.setState((s) => ({
    jobs: s.jobs.map((j) =>
      j.jobId === update.jobId
        ? ({ ...update, path: j.path, name: j.name, preset: j.preset } as ExportJob)
        : j,
    ),
  }))
})
