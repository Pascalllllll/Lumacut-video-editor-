import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { settledSettings } from '../settled'
import { test, expect } from './fixtures'
import { haveFfmpeg, importFiles, makeMedia, stubDialogs } from './helpers'

test.describe('the tour', () => {
  test.use({ firstRun: true })

  test('starts from the welcome sheet, walks the Edit workspace and is remembered', async ({
    page,
  }) => {
    await page
      .getByRole('dialog', { name: 'Welcome to Lumacut' })
      .getByRole('button', { name: 'Take the tour' })
      .click()
    const titles: string[] = []
    for (;;) {
      const card = page.getByRole('dialog').last()
      titles.push((await card.getByRole('heading').textContent()) ?? '')
      const done = card.getByRole('button', { name: 'Start editing' })
      if (await done.isVisible()) {
        await done.click()
        break
      }
      await card.getByRole('button', { name: 'Next' }).click()
    }
    expect(titles).toEqual([
      'Bring in your media',
      'Watch your edit',
      'Build the story',
      'Fine-tune a clip',
      'Switch workspaces',
      'Share it',
      'Find any command',
    ])
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const settings = await page.evaluate(() => window.lumacut.invoke('settings:get'))
    expect(settings.tourDone).toBe(true)
  })
})

test('the tour can be run again from the command palette and skipped with Escape', async ({
  page,
}) => {
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Run a command' }).fill('tour')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Bring in your media' })).toBeVisible()
  // Keys go to the tour, not to the timeline behind it.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('dialog', { name: 'Watch your edit' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

async function launch(userData: string, args: string[] = []) {
  const app = await electron.launch({
    args: ['.', ...args],
    env: { ...process.env, LUMACUT_USER_DATA: userData, ELECTRON_RENDERER_URL: '' },
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-loaded="true"]')
  return { app, page }
}
const quit = (app: ElectronApplication) =>
  app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)

test('the start screen continues the last project, and a project file opens directly', async () => {
  test.skip(!haveFfmpeg, 'FFmpeg not fetched; run pnpm fetch:binaries')
  const media = makeMedia()
  const userData = mkdtempSync(join(tmpdir(), 'lumacut-home-'))
  writeFileSync(join(userData, 'settings.json'), settledSettings)
  const film = join(media.dir, 'Holiday film.lumacut')

  const first = await launch(userData)
  await expect(first.page.getByRole('region', { name: 'Start' })).toHaveCount(0)
  await importFiles(first.app, first.page, [media.a])
  await stubDialogs(first.app, [], film)
  await first.page.keyboard.press('Control+s')
  await expect(first.page.getByText('Saved Holiday film.lumacut')).toBeVisible()
  await quit(first.app)

  const second = await launch(userData)
  const home = second.page.getByRole('region', { name: 'Start' })
  await expect(home).toBeVisible()
  await expect(home.getByText('Continue where you left off')).toBeVisible()
  // Editing keys do nothing here.
  await second.page.keyboard.press('s')
  await home.getByRole('button', { name: /Holiday film/ }).click()
  await expect(home).toBeHidden()
  await expect(second.page.getByRole('listitem', { name: 'alpha.mp4', exact: true })).toBeVisible()
  // Help or the menu brings it back; a workspace tab leaves it.
  await second.page.keyboard.press('Control+k')
  await second.page.getByRole('combobox', { name: 'Run a command' }).fill('start screen')
  await second.page.keyboard.press('Enter')
  await expect(home).toBeVisible()
  await second.page.getByRole('tab', { name: 'Color', exact: true }).click()
  await expect(home).toBeHidden()
  await quit(second.app)

  // Started with a project file, Lumacut opens it instead of the start screen.
  const third = await launch(userData, [film])
  await expect(third.page.locator('header').getByText('Holiday film')).toBeVisible()
  await expect(third.page.getByRole('region', { name: 'Start' })).toHaveCount(0)
  await quit(third.app)
})

test.describe('Google sign-in', () => {
  test.use({ env: { LUMACUT_GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com' } })

  let server: Server
  let base = ''
  const seen: { challenge?: string; verifier?: string; revoked?: string; secret?: string } = {}

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString()))
      req.on('end', () => {
        const form = new URLSearchParams(body)
        if (url.pathname === '/auth') {
          seen.challenge = url.searchParams.get('code_challenge') ?? undefined
          res.end('ok')
        } else if (url.pathname === '/token') {
          seen.verifier = form.get('code_verifier') ?? undefined
          seen.secret = form.get('client_secret') ?? undefined
          const ok =
            form.get('code') === 'good-code' &&
            createHash('sha256')
              .update(seen.verifier ?? '')
              .digest('base64url') === seen.challenge
          res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(ok ? { access_token: 'at-1', token_type: 'Bearer' } : {}))
        } else if (url.pathname === '/userinfo') {
          const ok = req.headers.authorization === 'Bearer at-1'
          res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              name: 'Test Person',
              email: 'test@example.com',
              // Not a Google host, so it must not be fetched.
              picture: `http://127.0.0.1:${(server.address() as AddressInfo).port}/pic.png`,
            }),
          )
        } else if (url.pathname === '/revoke') {
          seen.revoked = form.get('token') ?? undefined
          res.end('')
        } else {
          res.writeHead(404).end()
        }
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  test.afterAll(() => server.close())

  test('signs in through the browser with PKCE, keeps only the profile, and signs out', async ({
    app,
    page,
  }) => {
    // The "browser": visit the sign-in page, then come back to Lumacut's redirect with a code.
    await app.evaluate(({ shell }, base) => {
      process.env['LUMACUT_OAUTH_BASE'] = base
      shell.openExternal = async (raw: string) => {
        const url = new URL(raw)
        await fetch(raw)
        const back = new URL(url.searchParams.get('redirect_uri')!)
        // Something else knocking first is ignored.
        await fetch(`${back.origin}/callback?code=evil&state=wrong`)
        back.searchParams.set('code', 'good-code')
        back.searchParams.set('state', url.searchParams.get('state')!)
        await fetch(back)
      }
    }, base)

    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    const section = dialog.getByRole('region', { name: 'Account' })
    await section.getByRole('button', { name: 'Sign in with Google' }).click()
    await expect(section.getByText('test@example.com')).toBeVisible()
    await expect(section.getByText('Test Person')).toBeVisible()
    expect(seen.revoked).toBe('at-1')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Signed in as Test Person' })).toBeVisible()

    const saved = await page.evaluate(() => window.lumacut.invoke('account:get'))
    expect(saved.account).toMatchObject({ name: 'Test Person', picture: null })
    expect(JSON.stringify(saved)).not.toContain('at-1')

    await page.getByRole('button', { name: 'Signed in as Test Person' }).click()
    await section.getByRole('button', { name: 'Sign out' }).click()
    await expect(section.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Signed in as Test Person' })).toHaveCount(0)
  })
})

test('without a Google client, there is no sign-in to offer', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Settings' }).getByRole('region', { name: 'Account' }),
  ).toHaveCount(0)
})
