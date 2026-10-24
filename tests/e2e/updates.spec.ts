import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { releaseNotes } from '../../src/shared/updates'
import { appVersion } from '../settled'
import { test, expect } from './fixtures'

const notes = releaseNotes(
  readFileSync(join(import.meta.dirname, '../../CHANGELOG.md'), 'utf8'),
  appVersion,
)

test('updates can be turned off, and a development build never checks', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  const updates = dialog.getByRole('region', { name: 'Updates' })
  await expect(updates.getByRole('status')).toHaveText(/built from source/)
  await updates.getByRole('radio', { name: 'Don’t check' }).click()
  const settings = await page.evaluate(() => window.lumacut.invoke('settings:get'))
  expect(settings.updates).toBe('off')
})

test('What’s new opens from the command palette', async ({ page }) => {
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Run a command' }).fill('what')
  await page.keyboard.press('Enter')
  const sheet = page.getByRole('dialog', { name: `What’s new in Lumacut ${appVersion}` })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Continue' }).click()
  await expect(sheet).toBeHidden()
})

test.describe('after an update', () => {
  test.use({ lastSeenVersion: '0.0.1' })
  test.skip(!notes?.sections.length, 'This version has no CHANGELOG section yet')

  test('What’s new shows once, with this version’s changes', async ({ page }) => {
    const sheet = page.getByRole('dialog', { name: `What’s new in Lumacut ${appVersion}` })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('listitem').first()).toHaveText(notes!.sections[0]!.items[0]!)
    await sheet.getByRole('button', { name: 'Continue' }).click()
    await expect(sheet).toBeHidden()
    const settings = await page.evaluate(() => window.lumacut.invoke('settings:get'))
    expect(settings.lastSeenVersion).toBe(appVersion)
  })
})

test.describe('first start', () => {
  test.use({ firstRun: true })

  test('the welcome sheet counts as having seen this version', async ({ page }) => {
    await page
      .getByRole('dialog', { name: 'Welcome to Lumacut' })
      .getByRole('button', { name: 'Skip the tour' })
      .click()
    await expect(page.getByRole('dialog', { name: /^What’s new/ })).toBeHidden()
    const settings = await page.evaluate(() => window.lumacut.invoke('settings:get'))
    expect(settings.lastSeenVersion).toBe(appVersion)
  })
})
