import { test, expect } from './fixtures'

test('opens the edit workspace with every panel', async ({ page }) => {
  await expect(page).toHaveTitle(/Lumacut$/)
  for (const name of ['Media', 'Viewer', 'Inspector', 'Timeline']) {
    await expect(page.getByRole('region', { name })).toBeVisible()
  }
})

test('settings change the theme and survive a reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()

  await dialog.getByRole('radio', { name: 'Light' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await dialog.getByRole('radio', { name: 'Blue' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue')

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await page.reload()
  await page.waitForSelector('[data-loaded="true"]')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue')
})

test('rejects calls on unknown channels from the renderer', async ({ page }) => {
  const message = await page.evaluate(async () => {
    try {
      // @ts-expect-error deliberately calling a channel that is not in the contract
      await window.lumacut.invoke('fs:read', '/etc/passwd')
      return 'resolved'
    } catch (error) {
      return String(error)
    }
  })
  expect(message).toContain('Unknown channel')
})

test('renderer has no Node access', async ({ page }) => {
  const types = await page.evaluate(() => [
    typeof (globalThis as Record<string, unknown>)['require'],
    typeof (globalThis as Record<string, unknown>)['process'],
  ])
  expect(types).toEqual(['undefined', 'undefined'])
})
