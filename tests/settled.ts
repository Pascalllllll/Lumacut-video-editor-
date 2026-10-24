import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const appVersion = (
  JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
    version: string
  }
).version

/** settings.json for a start past the welcome sheet and this version's notes. */
export const settledSettings = JSON.stringify({ onboarded: true, lastSeenVersion: appVersion })
