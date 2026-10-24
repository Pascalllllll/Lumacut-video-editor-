import { app } from 'electron'
import electronUpdater from 'electron-updater'
import {
  compareVersions,
  installKind,
  RELEASES_URL,
  REPOSITORY,
  type UpdateMode,
  type UpdateStatus,
} from '@shared/updates'

const { autoUpdater } = electronUpdater
const HOURS = 60 * 60 * 1000

/**
 * Looks for new versions on the GitHub releases page. Copies that can replace
 * themselves (AppImage, the Windows installer) go through electron-updater;
 * the rest only learn that a new version exists and where to get it.
 */
export class Updater {
  private status: UpdateStatus = { state: 'idle' }
  private timer: NodeJS.Timeout | null = null
  private mode: UpdateMode = 'off'
  private readonly selfUpdates = installKind(process.platform, process.env) !== 'other'

  constructor(private readonly emit: (status: UpdateStatus) => void) {
    if (!this.selfUpdates) return
    autoUpdater.logger = null
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-available', (info) => {
      if (this.mode === 'auto')
        this.set({ state: 'downloading', version: info.version, fraction: 0 })
      else this.set(this.available(info.version))
    })
    autoUpdater.on('update-not-available', () =>
      this.set({ state: 'current', version: app.getVersion() }),
    )
    autoUpdater.on('download-progress', (p) => {
      if (this.status.state === 'downloading')
        this.set({ ...this.status, fraction: p.percent / 100 })
    })
    autoUpdater.on('update-downloaded', (info) =>
      this.set({ state: 'ready', version: info.version }),
    )
    autoUpdater.on('error', (error) => this.set({ state: 'failed', message: error.message }))
  }

  /** Off in development and tests, where there is nothing to update. */
  static enabled() {
    return app.isPackaged && !process.env['LUMACUT_NO_UPDATES']
  }

  current(): UpdateStatus {
    return Updater.enabled() ? this.status : { state: 'disabled' }
  }

  setMode(mode: UpdateMode) {
    this.mode = mode
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (mode === 'off' || !Updater.enabled()) return
    autoUpdater.autoDownload = mode === 'auto'
    this.timer = setInterval(() => void this.check(), 6 * HOURS)
  }

  async check(): Promise<UpdateStatus> {
    if (!Updater.enabled()) return this.current()
    if (this.status.state === 'downloading' || this.status.state === 'ready') return this.status
    this.set({ state: 'checking' })
    try {
      if (this.selfUpdates) await autoUpdater.checkForUpdates()
      else await this.checkReleases()
    } catch (error) {
      this.set({ state: 'failed', message: plain(error) })
    }
    return this.status
  }

  async download() {
    if (this.status.state !== 'available' || !this.status.canInstall) return
    this.set({ state: 'downloading', version: this.status.version, fraction: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.set({ state: 'failed', message: plain(error) })
    }
  }

  install() {
    if (this.status.state === 'ready') autoUpdater.quitAndInstall()
  }

  private async checkReleases() {
    const res = await fetch(
      `https://api.github.com/repos/${REPOSITORY.owner}/${REPOSITORY.repo}/releases/latest`,
      { headers: { 'User-Agent': 'Lumacut', Accept: 'application/vnd.github+json' } },
    )
    if (res.status === 404) return this.set({ state: 'current', version: app.getVersion() })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const { tag_name: tag } = (await res.json()) as { tag_name: string }
    const version = tag.replace(/^v/, '')
    if (compareVersions(version, app.getVersion()) > 0) this.set(this.available(version))
    else this.set({ state: 'current', version: app.getVersion() })
  }

  private available(version: string): UpdateStatus {
    return {
      state: 'available',
      version,
      canInstall: this.selfUpdates,
      url: `${RELEASES_URL}/tag/v${version}`,
    }
  }

  private set(status: UpdateStatus) {
    this.status = status
    this.emit(status)
  }
}

function plain(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|net::/i.test(message))
    return 'No connection to GitHub. Check your internet connection and try again.'
  return message.split('\n')[0]!.slice(0, 300)
}
