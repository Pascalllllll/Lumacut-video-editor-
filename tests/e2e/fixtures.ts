import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { appVersion } from '../settled'

type Fixtures = {
  app: ElectronApplication
  page: Page
  launchArgs: string[]
  firstRun: boolean
  lastSeenVersion: string
  env: Record<string, string>
}

export const test = base.extend<Fixtures>({
  /** Extra Chromium switches for a spec, such as a fake microphone. */
  launchArgs: [[], { option: true }],
  /** A brand-new install shows the welcome sheet; other tests start past it. */
  firstRun: [false, { option: true }],
  /** The version whose notes were last seen; an older one shows What's new. */
  lastSeenVersion: [appVersion, { option: true }],
  /** Extra environment for the app, such as a test sign-in server. */
  env: [{}, { option: true }],
  app: async ({ launchArgs, firstRun, lastSeenVersion, env }, use) => {
    const userData = mkdtempSync(join(tmpdir(), 'lumacut-e2e-'))
    if (!firstRun)
      writeFileSync(
        join(userData, 'settings.json'),
        JSON.stringify({ onboarded: true, lastSeenVersion }),
      )
    const app = await electron.launch({
      args: ['.', ...launchArgs],
      env: { ...process.env, ...env, LUMACUT_USER_DATA: userData, ELECTRON_RENDERER_URL: '' },
    })
    await use(app)
    // Exit directly: a test that ends with unsaved changes would otherwise wait on the "unsaved changes" prompt.
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    await app.close().catch(() => undefined)
  },
  page: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForSelector('[data-loaded="true"]')
    await use(page)
  },
})

export { expect } from '@playwright/test'
