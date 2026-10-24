import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { APP_NAME } from '@shared/constants'

/** ~/.cache/Lumacut on Linux; inside the app data folder elsewhere. */
export function cacheDir(): string {
  if (process.env['LUMACUT_CACHE']) return process.env['LUMACUT_CACHE']
  if (process.platform === 'linux') {
    return join(process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'), APP_NAME)
  }
  return join(app.getPath('userData'), 'Cache')
}
